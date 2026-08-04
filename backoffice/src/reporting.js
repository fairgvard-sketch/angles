/**
 * Правила отчётности — чистые функции без сети.
 *
 * Число без периода, точек, зоны и валюты проверить нельзя, а сравнить
 * с прошлым — тем более. Здесь живёт всё, что решает, ЧТО именно
 * показано и с чем сравнивается; сеть — в sales.js и activity.js.
 */

// ── Период сравнения ─────────────────────────────────────────

/**
 * Предыдущий сопоставимый период. Календарные периоды сравниваются с
 * календарными (месяц с прошлым месяцем, год с прошлым годом), а
 * скользящие — с окном той же длины сразу перед ними. Иначе «−40%»
 * означало бы всего лишь «в феврале меньше дней».
 */
export function previousRange(period, from, to) {
  if (period === 'month') {
    return {
      from: new Date(from.getFullYear(), from.getMonth() - 1, 1),
      to: new Date(from.getFullYear(), from.getMonth(), 1),
    }
  }
  if (period === 'year') {
    return {
      from: new Date(from.getFullYear() - 1, 0, 1),
      to: new Date(from.getFullYear(), 0, 1),
    }
  }
  const span = to.getTime() - from.getTime()
  return { from: new Date(from.getTime() - span), to: new Date(from.getTime()) }
}

export const PREVIOUS_LABEL = {
  today: 'vs yesterday',
  '7d': 'vs previous 7 days',
  month: 'vs previous month',
  year: 'vs previous year',
  custom: 'vs previous period',
}

/**
 * Изменение к прошлому периоду. Рост с нуля — не «+∞ %», а «был ноль»:
 * процент там не значит ничего, и врать им нельзя.
 */
export function delta(current, previous) {
  const cur = current ?? 0
  const prev = previous ?? 0
  if (prev === 0) {
    if (cur === 0) return { direction: 'flat', text: 'no change' }
    return { direction: 'up', text: 'was none' }
  }
  const ratio = (cur - prev) / Math.abs(prev)
  const pct = Math.round(ratio * 100)
  if (pct === 0) return { direction: 'flat', text: '0%' }
  return { direction: pct > 0 ? 'up' : 'down', text: `${pct > 0 ? '+' : ''}${pct}%` }
}

// ── Охват отчёта ─────────────────────────────────────────────

const DATE_FMT = { day: 'numeric', month: 'short', year: 'numeric' }

/** «1 Aug 2026» или «1–7 Aug 2026»: to в отчёте эксклюзивна */
export function rangeLabel(from, to) {
  const last = new Date(to.getTime() - 86400000)
  const a = from.toLocaleDateString('en-GB', DATE_FMT)
  const b = last.toLocaleDateString('en-GB', DATE_FMT)
  return a === b ? a : `${a} — ${b}`
}

/**
 * Строка охвата под заголовком: период, точки, зона и валюта. Сервер
 * присылает scope вместе с числами (133) — показываем именно его, а не
 * то, что кабинет думал спросить.
 */
export function scopeLine(scope, from, to) {
  if (!scope) return rangeLabel(from, to)
  const locations = scope.all_locations
    ? 'All locations'
    : (scope.locations ?? []).map((l) => l.name).join(', ') || 'No locations'
  const currency = (scope.currencies ?? []).join(', ')
  return [rangeLabel(from, to), locations, scope.tz, currency].filter(Boolean).join(' · ')
}

// ── Разрезы ──────────────────────────────────────────────────

const CHANNEL_LABELS = {
  pos: 'Counter (POS)',
  link: 'Order link',
  counter_qr: 'Counter QR',
  table_qr: 'Table QR',
  website: 'Website',
  social: 'Social',
  site: 'Website',
}

export function channelLabel(channel) {
  return CHANNEL_LABELS[channel] || channel || '—'
}

const TYPE_LABELS = {
  here: 'Eat in',
  takeaway: 'Takeaway',
  delivery: 'Delivery',
}

export function orderTypeLabel(type) {
  return TYPE_LABELS[type] || type || '—'
}

// ── Выгрузка ─────────────────────────────────────────────────

function cell(value) {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const money = (agorot) => ((agorot ?? 0) / 100).toFixed(2)

/**
 * CSV отчёта: сначала охват, потом разрезы. Файл уезжает из кабинета,
 * поэтому обязан отвечать, за какой период, по каким точкам, в какой
 * зоне и валюте посчитаны числа.
 */
export function salesToCsv(report, { from, to } = {}) {
  const scope = report?.scope ?? {}
  const currency = (scope.currencies ?? ['ILS'])[0]
  const rows = [
    ['Report', 'Sales'],
    ['Period', from && to ? rangeLabel(from, to) : ''],
    ['Timezone', scope.tz ?? ''],
    ['Currency', currency],
    ['Locations', scope.all_locations
      ? 'All locations'
      : (scope.locations ?? []).map((l) => l.name).join(' | ')],
    [],
  ]

  const summary = report?.summary ?? {}
  rows.push(['Metric', `Amount (${currency})`, 'Count'])
  rows.push(['Gross sales', money(summary.gross_sales), summary.orders_count ?? 0])
  rows.push(['Discounts', money(summary.discounts), ''])
  rows.push(['Refunds', money(summary.refunds), summary.refunds_count ?? 0])
  rows.push(['Net sales', money((summary.gross_sales ?? 0) - (summary.refunds ?? 0)), ''])
  rows.push(['VAT', money(summary.vat), ''])
  rows.push(['Average check', money(summary.avg_check), ''])
  rows.push([])

  const section = (title, list, nameKey, label = (v) => v) => {
    if (!list?.length) return
    rows.push([title, `Amount (${currency})`, 'Count'])
    for (const item of list) {
      rows.push([label(item[nameKey]), money(item.amount), item.count ?? item.qty ?? ''])
    }
    rows.push([])
  }

  section('Location', report?.by_location, 'name')
  section('Channel', report?.by_channel, 'channel', channelLabel)
  section('Order type', report?.by_type, 'type', orderTypeLabel)
  section('Payment method', report?.by_method, 'method')
  section('Staff', report?.by_staff, 'name')
  section('Category', report?.by_category, 'category')
  section('Item', report?.top_items, 'name')

  return rows.map((r) => r.map(cell).join(',')).join('\r\n')
}

export function salesFileName(from, to) {
  const iso = (d) => d.toISOString().slice(0, 10)
  const last = new Date(to.getTime() - 86400000)
  return iso(from) === iso(last)
    ? `sales-${iso(from)}.csv`
    : `sales-${iso(from)}_${iso(last)}.csv`
}

// ── Журнал событий ───────────────────────────────────────────

export const ACTIVITY_TYPES = [
  { key: 'shift_opened', label: 'Shifts opened' },
  { key: 'shift_closed', label: 'Shifts closed' },
  { key: 'refund_issued', label: 'Refunds' },
]

/**
 * Аргументы RPC журнала. Фильтры считает СЕРВЕР (133): раньше кабинет
 * отбирал по типу уже загруженную страницу и отвечал на вопрос «что было
 * среди последних пятидесяти».
 */
export function activityParams({
  limit = 50, before = null, from = null, to = null, types = [],
  locationId = null, staffId = null, deviceId = null, search = '',
} = {}) {
  return {
    p_limit: limit,
    p_before: before,
    p_location_id: locationId || null,
    p_staff_session: null,
    p_from: from ? from.toISOString() : null,
    p_to: to ? to.toISOString() : null,
    p_types: types.length ? types : null,
    p_staff_id: staffId || null,
    p_device_id: deviceId || null,
    p_search: search.trim() || null,
  }
}

export function activityToCsv(events, { timeZone = 'Asia/Jerusalem' } = {}) {
  const stamp = (iso) => {
    try {
      return new Intl.DateTimeFormat('sv-SE', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      }).format(new Date(iso))
    } catch {
      return iso
    }
  }
  const header = [
    `Time (${timeZone})`, 'Event', 'Staff', 'Location', 'Device',
    'Amount (ILS)', 'Details',
  ]
  const lines = [header.map(cell).join(',')]
  for (const e of events ?? []) {
    const detail = Object.entries(e.detail ?? {})
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')
    lines.push([
      stamp(e.created_at), e.type, e.staff_name ?? '', e.location_name ?? '',
      e.device_name ?? '', money(e.amount), detail,
    ].map(cell).join(','))
  }
  return lines.join('\r\n')
}

export function activityFileName(date = new Date()) {
  return `activity-${date.toISOString().slice(0, 10)}.csv`
}

/**
 * День, к которому относится событие. Считается в часах ТОЧКИ — той же
 * зоне, которой уже подписана выгрузка журнала: закрытие смены в 00:30 по
 * Иерусалиму принадлежит своему дню, а не вчерашнему дню UTC и не тому
 * дню, который показывают часы владельца в другом поясе.
 *
 * Битую дату не прячем и не роняем на ней раздел: у события есть ключ
 * `unknown`, и оно остаётся видимым.
 */
export const UNKNOWN_DAY = 'unknown'

/*
 * `new Date(null)` — это не ошибка, а 1 января 1970 года: пустую отметку
 * времени приходится отсеивать до разбора, иначе событие без даты уедет
 * в группу «1970» и будет выглядеть настоящим.
 */
function activityMoment(value) {
  if (value === null || value === undefined || value === '') return null
  const at = new Date(value)
  return Number.isNaN(at.getTime()) ? null : at
}

export function activityDayKey(iso, timeZone = 'Asia/Jerusalem') {
  const at = activityMoment(iso)
  if (!at) return UNKNOWN_DAY
  try {
    // en-CA даёт ровно YYYY-MM-DD — ключ сортируется как строка
    const key = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(at)
    return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : UNKNOWN_DAY
  } catch {
    return UNKNOWN_DAY
  }
}

/**
 * Заголовок дня: «Today · 4 August», «Yesterday · 3 August», иначе дата
 * словом. Год дописывается, когда он не текущий, — иначе «4 August»
 * прошлого года читается как позавчерашний.
 */
export function activityDayLabel(key, { timeZone = 'Asia/Jerusalem', now = Date.now() } = {}) {
  if (key === UNKNOWN_DAY) return 'Date unknown'
  const today = activityDayKey(now, timeZone)
  const yesterday = activityDayKey(now - 86_400_000, timeZone)
  const human = humanActivityDay(key, key.slice(0, 4) !== today.slice(0, 4))
  if (key === today) return `Today · ${human}`
  if (key === yesterday) return `Yesterday · ${human}`
  return human
}

/*
 * Ключ — уже локальная дата точки, поэтому форматируется как есть, в UTC:
 * подставить сюда зону значило бы сдвинуть день второй раз.
 */
function humanActivityDay(key, withYear) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC', day: 'numeric', month: 'long',
      ...(withYear ? { year: 'numeric' } : {}),
    }).format(new Date(`${key}T12:00:00Z`))
  } catch {
    return key
  }
}

/**
 * Загруженные события, разложенные по дням. Группировка — только
 * оформление: порядок сервера (свежие сверху) сохраняется и внутри дня, и
 * между днями, потому что дни идут в порядке первой встречи. Поэтому
 * дозагрузка следующей страницы дописывает события в конец своего дня и
 * не может ни переставить, ни задвоить уже показанное.
 */
export function activityDays(events, { timeZone = 'Asia/Jerusalem', now = Date.now() } = {}) {
  const groups = new Map()
  for (const event of events ?? []) {
    const key = activityDayKey(event?.created_at, timeZone)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(event)
  }
  return [...groups.entries()].map(([key, list]) => ({
    key,
    label: activityDayLabel(key, { timeZone, now }),
    events: list,
  }))
}

/**
 * Точное время события в часах точки: в журнале за день это единственный
 * способ понять, когда смену открыли, — «4h» на такой вопрос не отвечает.
 */
export function activityTime(iso, timeZone = 'Asia/Jerusalem') {
  const at = activityMoment(iso)
  if (!at) return '—'
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(at)
  } catch {
    return '—'
  }
}
