/**
 * Правила инбокса онлайн-заказов — чистые функции без сети.
 *
 * Отделено от `orders.js` намеренно: статусы, возраст, корзины и поиск
 * решают, как менеджер видит работу, и должны проверяться тестами, а не
 * кликами. Всё, что ходит в Supabase, осталось в `orders.js`.
 */

// Зональные помощники общие для кабинета: «сегодня» в часах точки
// считается одинаково для броней и заказов. Расширение указано явно —
// модуль обязан импортироваться и голым Node в тестах.
import { todayInZone, zonedToUtc } from './timeline.js'

export const ACTIVE_STATUSES = ['new', 'accepted', 'preparing', 'ready']
export const DONE_STATUSES = ['completed', 'rejected', 'cancelled']

export const STATUS_LABELS = {
  new: 'New',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready',
  completed: 'Completed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

/** Кнопки перевода статуса — зеркало переходов set_online_order_status_web. */
export const NEXT_ACTIONS = {
  new: [
    { to: 'accepted', label: 'Accept', tone: 'primary' },
    { to: 'rejected', label: 'Reject', tone: 'danger' },
  ],
  accepted: [
    { to: 'preparing', label: 'Start preparing' },
    { to: 'ready', label: 'Ready', tone: 'primary' },
    { to: 'cancelled', label: 'Cancel', tone: 'danger' },
  ],
  preparing: [
    { to: 'ready', label: 'Ready', tone: 'primary' },
    { to: 'cancelled', label: 'Cancel', tone: 'danger' },
  ],
  ready: [
    { to: 'completed', label: 'Complete', tone: 'primary' },
    { to: 'cancelled', label: 'Cancel', tone: 'danger' },
  ],
}

/**
 * Режим обслуживания точки — зеркало online_fulfilment_mode (101):
 * явная настройка сильнее дефолта по модулю pos.
 */
export function fulfilmentMode(products, settings) {
  const explicit = settings?.online_orders?.fulfilment
  if (explicit === 'pos' || explicit === 'standalone') return explicit
  const hasPos = !Array.isArray(products) || products.includes('pos')
  return hasPos ? 'pos' : 'standalone'
}

// ── Инбокс: возраст, корзины, поиск (Phase 3) ────────────────

export const ORDER_CHANNEL_LABELS = {
  link: 'Link',
  counter_qr: 'Counter QR',
  table_qr: 'Table QR',
  website: 'Website',
  social: 'Social',
}

export const ORDER_TYPE_LABELS = {
  here: 'Dine in',
  takeaway: 'Takeaway',
  delivery: 'Delivery',
}

/**
 * Короткая ссылка на заявку. Сквозной нумерации у online_orders нет, а
 * называть гостю UUID нельзя — берём хвост идентификатора: он стабилен,
 * произносится по телефону и годится для поиска.
 */
export function orderRef(id) {
  const hex = String(id ?? '').replace(/-/g, '')
  return hex ? `#${hex.slice(-5).toUpperCase()}` : '#—'
}

/** Начало текущего «ресторанного дня» точки — граница «сегодня/раньше» */
export function dayStartMs(nowMs, tz) {
  return zonedToUtc(todayInZone(nowMs, tz), 0, tz).getTime()
}

/**
 * Корзины инбокса. Ключевое здесь — `stale`: незакрытая заявка вчерашнего
 * дня не должна лежать рядом со свежими и выглядеть текущей работой.
 * Возраст считается по началу дня точки, а не по «минус 24 часа»: смена
 * ориентируется на календарный день, а не на скользящее окно.
 */
export function bucketOrders(orders, startOfDayMs) {
  const buckets = { fresh: [], progress: [], ready: [], stale: [] }
  for (const order of orders ?? []) {
    const created = new Date(order.created_at).getTime()
    if (Number.isFinite(startOfDayMs) && created < startOfDayMs) {
      buckets.stale.push(order)
      continue
    }
    if (order.status === 'new') buckets.fresh.push(order)
    else if (order.status === 'ready') buckets.ready.push(order)
    else buckets.progress.push(order)
  }
  // Свежие и текущие — по возрасту (дольше всех ждёт — первым),
  // просроченные — новыми вперёд: до конца списка никто не долистает.
  const byOldest = (a, b) => new Date(a.created_at) - new Date(b.created_at)
  buckets.fresh.sort(byOldest)
  buckets.progress.sort(byOldest)
  buckets.ready.sort(byOldest)
  buckets.stale.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  return buckets
}

/**
 * «12 min», «2 h 05 min» — сколько заказ уже ждёт.
 *
 * Метка времени приходит с сервера, а «сейчас» берётся из браузера:
 * при расхождении часов заказ оказывается «из будущего». Это не повод
 * рисовать пустоту — такой заказ только что создан.
 */
export function elapsedLabel(iso, nowMs) {
  const ms = nowMs - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return 'just now'
  if (ms < 60000) return 'just now'
  const minutes = Math.floor(ms / 60000)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `${hours} h ${String(minutes % 60).padStart(2, '0')} min`
}

/**
 * Время заявки. Внутри текущего дня — часы, за его пределами обязательно
 * с датой: без неё вчерашний заказ читается как сегодняшний.
 */
export function orderTimeLabel(iso, startOfDayMs, tz) {
  const at = new Date(iso)
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(at)
  if (Number.isFinite(startOfDayMs) && at.getTime() >= startOfDayMs) return time
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, day: 'numeric', month: 'short',
  }).format(at)
  return `${date} · ${time}`
}

/** Текст заявки для поиска: имя, телефон, ссылка, стол и позиции */
export function orderSearchText(order) {
  const items = Array.isArray(order.items)
    ? order.items.map((i) => [i.name, i.variant_name].filter(Boolean).join(' ')).join(' ')
    : ''
  return [
    order.customer_name,
    order.customer_phone,
    orderRef(order.id),
    order.table_label,
    order.pos?.daily_number ? `#${order.pos.daily_number}` : '',
    order.note,
    items,
  ].filter(Boolean).join(' ').toLowerCase()
}

/**
 * Фильтр инбокса. Пустой фильтр ничего не отсекает: менеджер, открывший
 * раздел, должен видеть работу, а не результат чужих настроек.
 */
export function filterOrders(orders, { query = '', status = 'all', type = 'all', channel = 'all' } = {}) {
  const needle = query.trim().toLowerCase()
  return (orders ?? []).filter((order) => {
    if (status !== 'all' && order.status !== status) return false
    if (type !== 'all' && order.order_type !== type) return false
    if (channel !== 'all' && (order.order_channel ?? 'link') !== channel) return false
    if (needle && !orderSearchText(order).includes(needle)) return false
    return true
  })
}

/** Деньги — целые агороты (инвариант кассы); наружу — шекели. */
export function formatAgorot(agorot) {
  return `₪${((agorot ?? 0) / 100).toFixed(2).replace(/\.00$/, '')}`
}

/** Строки позиций из снапшота заявки: «2 × Латте · גדול · שיבולת שועל». */
export function orderItemLines(items) {
  if (!Array.isArray(items)) return []
  return items.map((item, index) => {
    const parts = [item.name]
    if (item.variant_name) parts.push(item.variant_name)
    for (const mod of item.mods ?? []) parts.push(mod.name)
    return {
      key: `${item.menu_item_id ?? 'i'}-${index}`,
      qty: item.qty ?? 1,
      text: parts.filter(Boolean).join(' · '),
      total: item.line_total ?? 0,
    }
  })
}

