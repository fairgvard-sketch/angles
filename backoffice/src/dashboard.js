import { supabase } from './supabase'
import { fetchOnlineOrders } from './orders'
import { bucketOrders, dayStartMs } from './orders-inbox'
import { fetchFleet, deviceStatus, deviceAdvice, isArchived } from './devices'
import { fetchSalesReport } from './sales'
import { fetchLocation, fetchLocationSlug } from './settings'
import { onlineEnabled, reservationsEnabled } from './online'
import { hasCapability } from './navigation'

/**
 * Дашборд владельца.
 *
 * До него главная показывала три счётчика (точки, сотрудники, кассы),
 * список точек и быстрые действия — то есть отвечала на вопрос «из чего
 * состоит мой аккаунт», а не «что сейчас происходит и что требует
 * внимания».
 *
 * Правило, которое важнее вёрстки: показываем ТОЛЬКО то, что есть на
 * сервере. Ни одного придуманного показателя. «Неопубликованных
 * изменений каталога» здесь нет не потому, что забыли, а потому что в
 * базе нет черновиков — и обещать их нельзя.
 *
 * Второе правило: каждый виджет привязан к capability. Reserve-клиенту
 * нечего показывать про смену на кассе, а Menu-клиенту — про заказы.
 */

// ── Загрузка ────────────────────────────────────────────────

/**
 * Открытая смена. Читается прямо из `shifts` под RLS организации
 * (политика 008): у точки не может быть двух открытых смен — на это есть
 * уникальный индекс, поэтому строка максимум одна.
 */
export async function fetchOpenShifts() {
  const { data, error } = await supabase
    .from('shifts')
    .select('id, location_id, opened_at, opening_float')
    .eq('status', 'open')
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Сегодняшние и ближайшие визиты точки: от начала дня и вперёд */
export async function fetchTodayReservations(locationId) {
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const { data, error } = await supabase
    .from('reservations')
    .select('id, status, customer_name, party_size, reserved_at, table_id, is_test')
    .eq('location_id', locationId)
    .in('status', ['new', 'confirmed'])
    .gte('reserved_at', dayStart.toISOString())
    .order('reserved_at', { ascending: true })
  if (error) throw new Error(error.message)
  return data ?? []
}

/**
 * Состояние гостевых каналов точки: включены ли онлайн-заказы и бронь,
 * есть ли короткий адрес. Это настройки точки, а не отдельная сущность.
 */
export async function fetchChannels(locationId) {
  const [location, slug] = await Promise.all([
    fetchLocation(locationId),
    fetchLocationSlug(locationId).catch(() => ''),
  ])
  const settings = location?.settings || {}
  return {
    orders: onlineEnabled(settings),
    reservations: reservationsEnabled(settings),
    slug: slug || '',
    locationId,
  }
}

/**
 * Всё, что нужно дашборду, одним заходом.
 *
 * `allSettled`, а не `all`: частичный отказ — штатное состояние
 * продукта. Если упал отчёт по продажам, владелец всё равно должен
 * увидеть заказы и молчащие кассы, а не пустой экран.
 */
export async function loadDashboard(context, locationId, { tz } = {}) {
  const can = (capability) => hasCapability(context, capability)
  const jobs = {}

  if (can('pos_reports')) {
    const zone = tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jerusalem'
    const from = new Date()
    from.setHours(0, 0, 0, 0)
    const to = new Date(from)
    to.setDate(to.getDate() + 1)
    jobs.sales = fetchSalesReport(from, to, {
      locationIds: locationId ? [locationId] : [],
      tz: zone,
    })
  }
  if (can('pos_operate')) {
    jobs.shifts = fetchOpenShifts()
    jobs.fleet = fetchFleet()
  }
  // Инбоксу нужны и активные, и закрытые; дашборду — только активные:
  // «сколько ждёт ответа» и «что висит с прошлых дней».
  if (can('orders_desk') && locationId) {
    jobs.orders = fetchOnlineOrders(locationId).then((data) => data.active)
  }
  if (can('reservations_desk') && locationId) jobs.reservations = fetchTodayReservations(locationId)
  if ((can('public_menu') || can('online_orders') || can('public_reservations')) && locationId) {
    jobs.channels = fetchChannels(locationId)
  }

  const keys = Object.keys(jobs)
  const results = await Promise.allSettled(keys.map((key) => jobs[key]))
  const data = {}
  const failed = []
  keys.forEach((key, index) => {
    const result = results[index]
    if (result.status === 'fulfilled') data[key] = result.value
    else failed.push(key)
  })
  return { ...data, failed }
}

// ── Сводки ──────────────────────────────────────────────────

/** Заказы: сколько ждёт ответа, сколько в работе и сколько висит с прошлых дней */
export function ordersSummary(orders, nowMs, tz) {
  if (!orders) return null
  const buckets = bucketOrders(orders, dayStartMs(nowMs, tz))
  const waiting = buckets.fresh.length
  const oldest = buckets.fresh[0] || buckets.progress[0] || null
  return {
    waiting,
    inProgress: buckets.progress.length,
    ready: buckets.ready.length,
    stale: buckets.stale.length,
    oldestAt: oldest?.created_at ?? null,
    today: buckets.fresh.length + buckets.progress.length + buckets.ready.length,
  }
}

/**
 * Визиты: сколько сегодня, сколько ждёт подтверждения и кто следующий.
 * Тестовые брони в счёт не идут — они существуют ради проверки экрана.
 */
export function reservationsSummary(list, nowMs) {
  if (!list) return null
  const real = list.filter((r) => !r.is_test)
  const pending = real.filter((r) => r.status === 'new')
  const upcoming = real
    .filter((r) => new Date(r.reserved_at).getTime() >= nowMs)
    .sort((a, b) => new Date(a.reserved_at) - new Date(b.reserved_at))
  return {
    today: real.length,
    pending: pending.length,
    guests: real.reduce((sum, r) => sum + (r.party_size || 0), 0),
    next: upcoming[0] ?? null,
    upcoming: upcoming.slice(0, 3),
  }
}

/** Парк касс: сколько на связи и сколько требует внимания */
export function fleetSummary(devices) {
  if (!devices) return null
  const live = devices.filter((d) => !isArchived(d))
  const problems = live.filter((d) => ['offline', 'error', 'never'].includes(deviceStatus(d)))
  return {
    total: live.length,
    online: live.filter((d) => deviceStatus(d) === 'online').length,
    problems: problems.length,
    worst: problems[0] ?? null,
  }
}

// ── «Требует внимания» ──────────────────────────────────────

/**
 * Список того, что владельцу стоит сделать прямо сейчас.
 *
 * Каждый пункт обязан вести в конкретный экран: «что-то не так» без
 * адреса — это тревога, а не помощь. Порядок — по стоимости
 * бездействия: молчащая касса дороже незакрытого вчерашнего заказа.
 *
 * Пустой список — нормальный ответ, и он лучше выдуманного пункта.
 */
export function attentionItems({
  context, fleet, orders, reservations, shifts, channels, locations, nowMs = Date.now(), tz,
}) {
  const can = (capability) => hasCapability(context, capability)
  const items = []

  const fleetInfo = fleetSummary(fleet)
  if (fleetInfo?.problems > 0) {
    items.push({
      id: 'devices',
      tone: 'alert',
      title: fleetInfo.problems === 1
        ? `${fleetInfo.worst.name || 'A register'} is not reporting`
        : `${fleetInfo.problems} registers are not reporting`,
      detail: fleetInfo.worst ? deviceAdvice(fleetInfo.worst) : null,
      action: { label: 'Open devices', view: 'devices' },
    })
  }

  const ordersInfo = ordersSummary(orders, nowMs, tz)
  if (ordersInfo?.waiting > 0) {
    items.push({
      id: 'orders-waiting',
      tone: 'alert',
      title: ordersInfo.waiting === 1
        ? 'An order is waiting for an answer'
        : `${ordersInfo.waiting} orders are waiting for an answer`,
      detail: 'Guests see nothing until you accept or reject.',
      action: { label: 'Open orders', view: 'orders' },
    })
  }
  if (ordersInfo?.stale > 0) {
    items.push({
      id: 'orders-stale',
      tone: 'warn',
      title: `${ordersInfo.stale} unresolved from earlier days`,
      detail: 'They stay open until someone closes or cancels them.',
      action: { label: 'Review them', view: 'orders' },
    })
  }

  const rsvInfo = reservationsSummary(reservations, nowMs)
  if (rsvInfo?.pending > 0) {
    items.push({
      id: 'reservations',
      tone: 'alert',
      title: rsvInfo.pending === 1
        ? 'A booking request is waiting'
        : `${rsvInfo.pending} booking requests are waiting`,
      detail: 'The guest is holding a table that is not confirmed yet.',
      action: { label: 'Open host desk', view: 'reservations' },
    })
  }

  // Смена: касса, где никто не открыл смену, не может продавать. Но это
  // не тревога рано утром и не тревога у standalone-клиента без POS.
  if (can('pos_operate') && Array.isArray(shifts) && Array.isArray(locations)) {
    const open = new Set(shifts.map((s) => s.location_id))
    const closed = locations.filter((l) => !open.has(l.id))
    if (closed.length > 0 && closed.length < locations.length) {
      items.push({
        id: 'shift',
        tone: 'info',
        title: closed.length === 1
          ? `No open shift at ${closed[0].name}`
          : `No open shift at ${closed.length} locations`,
        detail: 'A register cannot take payments until the shift is opened on it.',
        action: null,
      })
    }
  }

  // Каналы: гостевая страница выключена — значит гость видит «закрыто».
  if (channels && can('online_orders') && !channels.orders) {
    items.push({
      id: 'channel-orders',
      tone: 'info',
      title: 'Online ordering is off',
      detail: 'Guests can open the menu but cannot order.',
      action: { label: 'Open channels', view: 'online' },
    })
  }
  if (channels && can('public_reservations') && !channels.reservations) {
    items.push({
      id: 'channel-reservations',
      tone: 'info',
      title: 'Table booking is off',
      detail: 'The booking page tells guests that bookings are paused.',
      action: { label: 'Open channels', view: 'online', tab: 'reservations' },
    })
  }

  return items
}

/** Заголовок дня: «Sunday, 2 August» в зоне точки */
export function todayLabel(nowMs = Date.now(), tz) {
  return new Date(nowMs).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: tz || undefined,
  })
}

/** Время визита в зоне точки: «19:30» */
export function timeLabel(iso, tz) {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: tz || undefined,
  })
}
