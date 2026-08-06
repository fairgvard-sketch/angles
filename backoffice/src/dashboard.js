import { supabase } from './supabase'
import { fetchOnlineOrders } from './orders'
import { bucketOrders, dayStartMs } from './orders-inbox'
import { fetchFleet, deviceStatus, deviceAdvice, isArchived, lastSeenLabel } from './devices'
import { fetchSalesReport } from './sales'
import { fetchLocation, fetchLocationSlug } from './settings'
import { onlineEnabled, reservationsEnabled } from './online'
import { PRODUCT_META, hasCapability, productState } from './navigation'
import { delta } from './reporting'

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

/** Зона отчёта: точки, если она известна, иначе браузера */
function salesZone(tz) {
  return tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jerusalem'
}

/**
 * Сутки со сдвигом от сегодня: [начало, начало следующих суток).
 * Границы считаются от полуночи БРАУЗЕРА — ровно как считались всегда и
 * как их считает Sales. Переезд на полночь точки менял бы аргументы
 * отчёта, а не вёрстку, и разводил бы два экрана по разным числам.
 */
function dayRange(offsetDays = 0) {
  const from = new Date()
  from.setHours(0, 0, 0, 0)
  from.setDate(from.getDate() + offsetDays)
  const to = new Date(from)
  to.setDate(to.getDate() + 1)
  return { from, to }
}

/** Отчёт за сутки в том же охвате, в котором работает дашборд */
export function fetchDaySales(locationId, { tz, offsetDays = 0 } = {}) {
  const { from, to } = dayRange(offsetDays)
  return fetchSalesReport(from, to, {
    locationIds: locationId ? [locationId] : [],
    tz: salesZone(tz),
  })
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

  if (can('pos_reports')) jobs.sales = fetchDaySales(locationId, { tz })
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

/**
 * Парк касс: сколько на связи и сколько требует внимания.
 *
 * «Худший» — тот, о ком дашборд говорит вслух, поэтому он выбирается, а
 * не берётся первым попавшимся из ответа сервера: сначала застрявшая
 * очередь (сделанные продажи не дошли), потом ни разу не вышедший на
 * связь, потом самый долгий молчун.
 */
const PROBLEM_RANK = { error: 3, never: 2, offline: 1 }

export function fleetSummary(devices) {
  if (!devices) return null
  const live = devices.filter((d) => !isArchived(d))
  const problems = live.filter((d) => ['offline', 'error', 'never'].includes(deviceStatus(d)))
  const worst = [...problems].sort((a, b) => (
    (PROBLEM_RANK[deviceStatus(b)] ?? 0) - (PROBLEM_RANK[deviceStatus(a)] ?? 0)
    || (b.silence_seconds ?? 0) - (a.silence_seconds ?? 0)
  ))[0] ?? null
  return {
    total: live.length,
    online: live.filter((d) => deviceStatus(d) === 'online').length,
    problems: problems.length,
    worst,
  }
}

/**
 * Строка про худшую кассу, когда их несколько.
 *
 * Совет `deviceAdvice` написан про КОНКРЕТНЫЙ терминал: под заголовком
 * «3 registers are not reporting» он читался как утверждение обо всех
 * трёх и заодно врал о сроке — «не выходит на связь больше часа» стояло
 * и над кассой, молчащей неделю.
 */
export function worstDeviceLine(device) {
  if (!device) return null
  const name = device.name || 'A register'
  const status = deviceStatus(device)
  if (status === 'error') return `${name} has sales stuck in its queue.`
  if (status === 'never') return `${name} has never reported in.`
  return `Silent the longest: ${name}, last seen ${lastSeenLabel(device).toLowerCase()}.`
}

// ── День: кривая по часам и сравнение с вчера ───────────────

/**
 * Текущий час в зоне точки.
 *
 * `hourCycle: 'h23'` обязателен: en-GB с `hour12: false` возвращает для
 * полуночи «24», и час дня уехал бы на сутки вперёд.
 */
export function currentHour(nowMs = Date.now(), tz) {
  const text = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', hourCycle: 'h23', timeZone: tz || undefined,
  }).format(new Date(nowMs))
  return Number(text)
}

/** Дата в зоне точки, «2026-08-02»: ключ «за какой день данные» */
export function dayStamp(nowMs = Date.now(), tz) {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz || undefined,
  }).format(new Date(nowMs))
}

/**
 * Ось дня: от первого часа с продажами до текущего включительно.
 *
 * Тихие часы обязаны быть нулями, а не отсутствовать: иначе кривая
 * заканчивается на последней продаже и день выглядит закончившимся.
 * Правый край берётся с запасом по данным — если чек пробит в час,
 * которого по часам браузера ещё нет (расхождение зоны или времени
 * терминала), ось не должна его отрезать.
 */
export function todayBars(report, nowMs = Date.now(), tz) {
  const rows = report?.by_hour || []
  if (rows.length === 0) return []
  const byHour = new Map(rows.map((h) => [h.hour, h]))
  const hours = rows.map((h) => h.hour)
  const start = Math.min(...hours)
  const end = Math.max(currentHour(nowMs, tz), ...hours)
  const bars = []
  for (let hour = start; hour <= end; hour++) {
    const row = byHour.get(hour)
    bars.push({
      key: String(hour),
      label: String(hour).padStart(2, '0'),
      full: `${String(hour).padStart(2, '0')}:00–${String(hour + 1).padStart(2, '0')}:00`,
      amount: row?.amount ?? 0,
      count: row?.count ?? 0,
    })
  }
  return bars
}

/** Накоплено с начала дня по указанный час включительно */
export function cumulativeThrough(report, hour) {
  return (report?.by_hour || []).reduce(
    (sum, row) => (row.hour <= hour ? sum + (row.amount || 0) : sum), 0
  )
}

/**
 * Сравнение с вчера.
 *
 * Считается по ПОЛНЫМ часам: сегодняшний час ещё идёт, а вчерашний тот
 * же час прожит целиком — включив его, мы бы каждый раз показывали
 * владельцу падение, которого нет. Поэтому обе стороны обрезаются по
 * последнему завершённому часу, и подпись называет его прямо.
 *
 * Мера — `by_hour.amount`, то есть оплаченные продажи по часам (тот же
 * ряд, что рисует график Sales). Возвраты в нём не сидят, поэтому
 * процент нельзя подписывать чистой выручкой: он про другое число.
 */
export function hourlyComparison(today, yesterday, nowMs = Date.now(), tz) {
  if (!today || !yesterday) return null
  const hour = currentHour(nowMs, tz)
  // До первого закрытого часа сравнивать нечего — и это честный ответ
  if (hour === 0) return null
  const through = hour - 1
  const now = cumulativeThrough(today, through)
  const before = cumulativeThrough(yesterday, through)
  if (now === 0 && before === 0) return null
  return {
    ...delta(now, before),
    at: `${String(hour).padStart(2, '0')}:00`,
    current: now,
    previous: before,
  }
}

/**
 * Что рассказать о кривой тому, кто её не видит. Столбики для читалки —
 * пустое место, поэтому блок несёт то же самое словами.
 */
export function chartSummary(bars, format = (v) => String(v)) {
  if (bars.length === 0) return ''
  const first = bars[0]
  const last = bars[bars.length - 1]
  const top = bars.reduce((best, bar) => (bar.amount > best.amount ? bar : best), bars[0])
  const end = String(Number(last.label) + 1).padStart(2, '0')
  const window = `Sales by hour, ${first.label}:00 to ${end}:00.`
  if (top.amount === 0) return `${window} No sales yet.`
  return `${window} Busiest ${top.full}, ${format(top.amount)}.`
}

/**
 * Чем открывается день у этого аккаунта.
 *
 * Порядок — по тому, чем аккаунт живёт: касса меряет день деньгами,
 * standalone-заказы — очередью, Reserve — визитами. Menu-клиенту мерить
 * нечем: у него нет ни продаж, ни очереди, и выдуманный ноль здесь хуже
 * отсутствующего блока.
 */
export function heroKind(context) {
  if (hasCapability(context, 'pos_reports')) return 'sales'
  if (hasCapability(context, 'orders_desk')) return 'orders'
  if (hasCapability(context, 'reservations_desk')) return 'bookings'
  return null
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
      // Про одну кассу — что с ней делать; про несколько — какая из них
      // хуже всех, потому что совет для одной над списком из трёх врёт
      detail: fleetInfo.problems === 1
        ? deviceAdvice(fleetInfo.worst)
        : worstDeviceLine(fleetInfo.worst),
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

  // Заявка на активацию продукта (100/104). Это состояние несла карточка
  // продуктов на главной; карточка уехала в аккаунт, а сигнал остался
  // здесь — иначе владелец, отправивший заявку, больше нигде не увидит,
  // что она в работе. Пункт последний: ждать всё равно придётся оператора.
  const pending = PRODUCT_META.filter((product) => productState(context, product.id) === 'pending')
  if (pending.length > 0) {
    items.push({
      id: 'products-pending',
      tone: 'info',
      title: pending.length === 1
        ? `${pending[0].label} is waiting for activation`
        : `${pending.length} products are waiting for activation`,
      detail: 'The ANGLE team switches it on — usually within a business day.',
      action: { label: 'Open account', view: 'settings' },
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
