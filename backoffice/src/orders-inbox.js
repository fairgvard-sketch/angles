/**
 * Правила инбокса онлайн-заказов — чистые функции без сети.
 *
 * Отделено от `orders.js` намеренно: подписи, состояния, возраст и
 * деньги решают, как владелец читает работу, и должны проверяться
 * тестами, а не кликами. Всё, что ходит в Supabase, осталось в
 * `orders.js`; отбор, поиск и разрезы дня живут в SQL (141).
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

/**
 * Кнопки перевода статуса — зеркало переходов
 * `set_online_order_status_web` (101/105), теперь дословное.
 *
 * Клиент был беднее сервера: `accepted → completed` и
 * `preparing → completed` сервер разрешает, а кабинет не предлагал —
 * заказ, который отдали сразу с прилавка, приходилось вести через
 * «Ready». Обратного тоже быть не должно: показать кнопку, которую
 * сервер отклонит, хуже, чем не показать разрешённую.
 */
export const NEXT_ACTIONS = {
  new: [
    { to: 'accepted', label: 'Accept', tone: 'primary' },
    { to: 'rejected', label: 'Reject', tone: 'danger' },
  ],
  accepted: [
    { to: 'preparing', label: 'Start preparing' },
    { to: 'completed', label: 'Complete' },
    { to: 'ready', label: 'Ready', tone: 'primary' },
    { to: 'cancelled', label: 'Cancel', tone: 'danger' },
  ],
  preparing: [
    { to: 'completed', label: 'Complete' },
    { to: 'ready', label: 'Ready', tone: 'primary' },
    { to: 'cancelled', label: 'Cancel', tone: 'danger' },
  ],
  ready: [
    { to: 'completed', label: 'Complete', tone: 'primary' },
    { to: 'cancelled', label: 'Cancel', tone: 'danger' },
  ],
}

/*
 * `fulfilmentMode` жил здесь и повторял серверный online_fulfilment_mode
 * (101) — ровно то дублирование, из-за которого кабинет показывал
 * бухгалтеру кнопки, которые сервер отклонял. С 141 режим точки и право
 * на действие приходят вместе со строками (`mode`, `can_manage`), и
 * второй копии правила больше нет.
 */

// ── Подписи строки, ленты и денег ────────────────────────────

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
 * Тон статуса — семантический токен, а не цвет.
 *
 * Раздел заказов описывает ИСПОЛНЕНИЕ (принят → готовится → готов), а не
 * визит гостя, поэтому у него собственные состояния и собственные
 * названия классов. Совпадение палитры с бронями допустимо и намеренно
 * (это язык платформы), совпадение слов — нет: «Confirmed» и «Seated»
 * в заказах не появляются.
 */
export const STATUS_TONE = {
  new: 'new',
  accepted: 'accepted',
  preparing: 'progress',
  ready: 'ready',
  completed: 'done',
  rejected: 'stopped',
  cancelled: 'stopped',
}

/**
 * Вкладки раздела. Список строится по данным: «Scheduled» показывается
 * только там, где предзаказы действительно есть — вкладка, которая у
 * заведения всегда пуста, отвечает на вопрос, которого никто не задавал.
 */
export function orderTabs(scheduledCount, current) {
  const tabs = [{ key: 'active', label: 'Active' }]
  if (scheduledCount > 0 || current === 'scheduled') {
    tabs.push({ key: 'scheduled', label: 'Scheduled', count: scheduledCount })
  }
  tabs.push({ key: 'all', label: 'All orders' })
  return tabs
}

/**
 * Номер заявки (139). До миграции человеческого номера не было и
 * приходилось звать заказ хвостом UUID; фолбэк оставлен на случай
 * строки, пришедшей мимо рабочего стола.
 */
export function orderNumber(row) {
  return row?.order_number ? `#${row.order_number}` : orderRef(row?.id)
}

/**
 * Контекст строки — чей это заказ. У заказа со стола имя гостя не
 * спрашивают вовсе (099), поэтому колонка обязана уметь показывать
 * стол; безымянная заявка — это заказ у стойки, а не «—».
 */
export function rowContext(row) {
  if (row?.customer_name) return row.customer_name
  if (row?.table_label) return `Table ${row.table_label}`
  return 'Counter'
}

/**
 * Что произошло с заявкой (140). Служебное `new` в ленте выглядит как
 * «новый», хотя означает «получен» — а получен он ровно один раз.
 */
export function activityLabel(status) {
  return status === 'new' ? 'Received' : (STATUS_LABELS[status] ?? status)
}

/**
 * Кто это сделал. Имя снапшотится в момент события, поэтому уволенный
 * сотрудник не превращает историю в «—»; если имени нет вовсе, честнее
 * назвать место, чем оставить пустоту.
 */
export function activityActor(event) {
  if (event?.actor_kind === 'guest') return 'Guest'
  if (event?.actor_kind === 'pos') return event.actor_name || 'Register'
  if (event?.actor_kind === 'backoffice') return event.actor_name || 'Back office'
  return null
}

/**
 * Долг из прошлых дней, разложенный по дням.
 *
 * Четырнадцать незакрытых заявок одним списком — это стена, в которой не
 * видно, вчерашняя это забывчивость или заказ месячной давности.
 * Заголовок дня отвечает на вопрос «насколько это старое» до того, как
 * владелец начнёт читать строки.
 *
 * День считается в часах ТОЧКИ: у владельца в другом поясе «вчера»
 * всё равно вчерашний день его заведения.
 */
export function groupByDay(rows, tz, nowMs = Date.now()) {
  const dayKey = (iso) => {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso))
    } catch {
      return String(iso).slice(0, 10)
    }
  }
  const today = dayKey(new Date(nowMs).toISOString())
  const yesterday = dayKey(new Date(nowMs - 86_400_000).toISOString())
  const groups = new Map()
  for (const row of rows ?? []) {
    const key = dayKey(row.created_at)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  return [...groups.entries()]
    // Свежий долг важнее давнего: с ним ещё можно что-то сделать
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, list]) => ({
      key,
      label: key === today ? 'Today' : key === yesterday ? 'Yesterday' : humanDay(key, tz),
      rows: list,
    }))
}

/** «2 Aug» вместо «2026-08-02»: дату читают, а не парсят */
function humanDay(key, tz) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, day: 'numeric', month: 'short',
    }).format(new Date(`${key}T12:00:00Z`))
  } catch {
    return key
  }
}

/** «3 items» — штуки, а не строки меню (сервер считает qty, 141) */
export function itemsLabel(count) {
  const n = Number(count) || 0
  return n === 1 ? '1 item' : `${n} items`
}

/**
 * Деньги точки. Раньше знак шекеля был вшит в код: сеть с другой
 * валютой увидела бы чужие суммы под ₪. Валюту отдаёт сервер вместе со
 * строками (141), формат — по правилам локали.
 */
export function formatMoney(agorot, currency = 'ILS') {
  const value = (agorot ?? 0) / 100
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency', currency, currencyDisplay: 'narrowSymbol',
    }).format(value)
  } catch {
    // Неизвестный код валюты не повод не показать сумму
    return `${value.toFixed(2)} ${currency}`
  }
}

/**
 * Состояние живой связи. Зелёная точка раньше значила лишь «компонент
 * подписался»: сокет мог быть жив, а данные — часовой давности, и
 * раздел всё равно обещал «Live».
 *
 * Здесь состояние собирается из трёх фактов: что говорит подписка,
 * когда последний раз УДАЛСЯ запрос и не упал ли он вовсе.
 */
export const REALTIME_STALE_MS = 90_000

export function realtimeState({ socket, lastOkMs, nowMs, failed = false }) {
  if (failed) return 'stale'
  if (socket === 'offline') return 'reconnecting'
  if (!Number.isFinite(lastOkMs)) return 'connecting'
  if (nowMs - lastOkMs > REALTIME_STALE_MS) return 'stale'
  return socket === 'live' ? 'live' : 'connecting'
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

/*
 * Поиск и фильтры тоже уехали на сервер (141): здесь они могли отвечать
 * только про загруженное окно в 30 дней, то есть на вопрос «есть ли
 * такой заказ среди последних двухсот», а не «есть ли такой заказ».
 * Правила отбора теперь одни и проверяются pgTAP.
 */

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

