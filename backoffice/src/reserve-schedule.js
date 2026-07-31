/**
 * Недельное расписание брони (Kassa 117) — редакторская половина.
 *
 * Зеркало серверной `reservation_schedule` и клиентской
 * `src/features/reservations/schedule.ts` в репозитории кассы. Формат
 * общий с расписанием онлайн-заказов (101/112), поэтому диалект один:
 *
 *   { weekly:     { "0": [["08:00","20:00"]], "6": [] },
 *     exceptions: { "2026-09-21": [], "2026-10-05": [["18:00","23:00"]] },
 *     lead_min: 30, horizon_days: 30 }
 *
 * До 117 у брони было ДВА источника часов: пара open/close (её проверял
 * сервер) и свободный текст hours (его видел гость). Они расходились, и
 * страница предлагала слоты в день, который сама же объявляла выходным.
 * Этот редактор — единственное место, где часы задаются.
 */

import { WEEK_DAYS } from './online'

export { WEEK_DAYS }

const DEFAULT_WINDOW = ['08:00', '20:00']
export const DEFAULT_LEAD_MIN = 30
export const DEFAULT_HORIZON_DAYS = 30

function isWindow(w) {
  return Array.isArray(w) && typeof w[0] === 'string' && typeof w[1] === 'string'
}

function clampInt(value, def, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

/**
 * settings.reservations → каноническое расписание. Точка без ключа
 * schedule разворачивается из legacy open/close — ровно как на сервере,
 * поэтому редактор открывается уже заполненным и владелец видит то же,
 * что действует сейчас.
 */
export function normalizeSchedule(rsv) {
  const raw = rsv?.schedule
  const weekly = {}

  if (raw && typeof raw.weekly === 'object' && raw.weekly !== null) {
    for (const day of WEEK_DAYS) {
      const windows = raw.weekly[day.key]
      weekly[day.key] = Array.isArray(windows) ? windows.filter(isWindow) : []
    }
  } else {
    const open = rsv?.open || DEFAULT_WINDOW[0]
    const close = rsv?.close || DEFAULT_WINDOW[1]
    for (const day of WEEK_DAYS) weekly[day.key] = [[open, close]]
  }

  const exceptions = {}
  if (raw && typeof raw.exceptions === 'object' && raw.exceptions !== null) {
    for (const key of Object.keys(raw.exceptions)) {
      const windows = raw.exceptions[key]
      exceptions[key] = Array.isArray(windows) ? windows.filter(isWindow) : []
    }
  }

  return {
    weekly,
    exceptions,
    lead_min: clampInt(raw?.lead_min, DEFAULT_LEAD_MIN, 0, 43200),
    horizon_days: clampInt(raw?.horizon_days, DEFAULT_HORIZON_DAYS, 1, 365),
  }
}

/** Окна дня недели */
export function dayWindows(schedule, dayKey) {
  const windows = schedule.weekly?.[dayKey]
  return Array.isArray(windows) ? windows : []
}

/** Заменить окна одного дня недели (пустой массив = выходной) */
export function withDayWindows(schedule, dayKey, windows) {
  return { ...schedule, weekly: { ...schedule.weekly, [dayKey]: windows } }
}

/** Добавить окно дню: первое — 08:00–20:00, следующее — после последнего */
export function withAddedWindow(schedule, dayKey) {
  const windows = dayWindows(schedule, dayKey)
  if (windows.length === 0) return withDayWindows(schedule, dayKey, [[...DEFAULT_WINDOW]])
  const last = windows[windows.length - 1]
  return withDayWindows(schedule, dayKey, [...windows, [last[1], '23:00']])
}

export function withRemovedWindow(schedule, dayKey, index) {
  const windows = dayWindows(schedule, dayKey).filter((_, i) => i !== index)
  return withDayWindows(schedule, dayKey, windows)
}

export function withWindowEdge(schedule, dayKey, index, edge, value) {
  const windows = dayWindows(schedule, dayKey).map((w, i) => (
    i === index ? (edge === 0 ? [value, w[1]] : [w[0], value]) : w
  ))
  return withDayWindows(schedule, dayKey, windows)
}

/** Исключение по дате: [] = закрыто, непустой массив = особые часы */
export function withException(schedule, dateStr, windows) {
  return { ...schedule, exceptions: { ...schedule.exceptions, [dateStr]: windows } }
}

export function withoutException(schedule, dateStr) {
  const exceptions = { ...schedule.exceptions }
  delete exceptions[dateStr]
  return { ...schedule, exceptions }
}

/** Исключения списком, отсортированные по дате */
export function exceptionList(schedule) {
  return Object.keys(schedule.exceptions || {})
    .sort()
    .map((date) => ({ date, windows: schedule.exceptions[date] }))
}

/** 'YYYY-MM-DD' → день недели (0=вс) без участия таймзон */
export function dowOf(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '')
  if (!m) return null
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()
}

/** Окна конкретной даты: исключение замещает недельное правило целиком */
export function windowsForDate(schedule, dateStr) {
  const exception = schedule.exceptions?.[dateStr]
  if (Array.isArray(exception)) return exception
  const dow = dowOf(dateStr)
  if (dow === null) return []
  return dayWindows(schedule, String(dow))
}

function pad(n) {
  return String(n).padStart(2, '0')
}

/** Сегодняшняя дата в часовом поясе ТОЧКИ, а не браузера владельца */
export function todayInZone(tz) {
  const now = new Date()
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'Asia/Jerusalem',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now)
    if (/^\d{4}-\d{2}-\d{2}$/.test(parts)) return parts
  } catch {
    /* движок без поддержки зон — считаем по браузеру */
  }
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function shiftDate(dateStr, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '')
  if (!m) return dateStr
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  d.setUTCDate(d.getUTCDate() + days)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/**
 * Предпросмотр ближайших дней: именно то, что увидит гость. Считается из
 * той же структуры, что уходит на сервер, поэтому «на бумаге открыто, а
 * на странице закрыто» стать не может.
 */
export function previewDays(schedule, tz, count = 7) {
  const today = todayInZone(tz)
  const out = []
  for (let i = 0; i < count; i += 1) {
    const date = shiftDate(today, i)
    out.push({
      date,
      dow: dowOf(date),
      isToday: i === 0,
      isException: Array.isArray(schedule.exceptions?.[date]),
      windows: windowsForDate(schedule, date),
    })
  }
  return out
}

export function formatWindows(windows) {
  if (!Array.isArray(windows) || windows.length === 0) return 'Closed'
  return windows.map((w) => `${w[0]}–${w[1]}`).join(', ')
}

/** Короткая сводка расписания для свёрнутой карточки настроек */
export function scheduleSummary(schedule) {
  const groups = []
  for (const day of WEEK_DAYS) {
    const text = formatWindows(dayWindows(schedule, day.key))
    const last = groups[groups.length - 1]
    if (last && last.text === text) last.end = day.short
    else groups.push({ text, start: day.short, end: day.short })
  }
  const open = groups.filter((g) => g.text !== 'Closed')
  if (open.length === 0) return 'Closed all week'
  return open
    .map((g) => `${g.start === g.end ? g.start : `${g.start}–${g.end}`} ${g.text}`)
    .join(' · ')
}

/** Проверка перед сохранением: пустые/битые окна ловим до отправки */
export function validateSchedule(schedule) {
  const isTime = (v) => /^\d{2}:\d{2}$/.test(v)
  for (const day of WEEK_DAYS) {
    for (const w of dayWindows(schedule, day.key)) {
      if (!isTime(w[0]) || !isTime(w[1])) return `Fill both times for ${day.label}.`
      if (w[0] === w[1]) return `${day.label}: opening and closing times are the same.`
    }
  }
  for (const { date, windows } of exceptionList(schedule)) {
    for (const w of windows) {
      if (!isTime(w[0]) || !isTime(w[1])) return `Fill both times for ${date}.`
      if (w[0] === w[1]) return `${date}: opening and closing times are the same.`
    }
  }
  return null
}
