/**
 * Раскладка таймлайна хостес для кабинета (Kassa 119/120).
 *
 * Порт `src/features/reservations/timeline.ts` из репозитория кассы —
 * там же лежат тесты этой логики (`timeline.test.ts`, 22 проверки), и
 * эталоном считается ОНА: правила здесь менять нельзя в одиночку.
 *
 * Дублируется только геометрия — арифметика процентов. Рискованная часть,
 * «кто какие столы занимает», дублирования не имеет: она приходит из
 * `reservation_tables`, то есть из одной таблицы для обоих контуров.
 */

const HOUR_MS = 3_600_000
const DEFAULT_FROM_MIN = 8 * 60
const DEFAULT_TO_MIN = 24 * 60

/** 'HH:MM' → минуты от полуночи; мусор → null */
export function hmToMin(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value ?? '')
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

function pad(n) {
  return String(n).padStart(2, '0')
}

/** Локальные компоненты момента в зоне точки */
export function partsInZone(at, tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(at)
    const get = (type) => Number(parts.find((p) => p.type === type)?.value)
    const hour = get('hour')
    return {
      year: get('year'), month: get('month'), day: get('day'),
      hour: hour === 24 ? 0 : hour, minute: get('minute'),
    }
  } catch {
    return null
  }
}

export function todayInZone(nowMs, tz) {
  const p = partsInZone(new Date(nowMs), tz)
  if (!p) return new Date(nowMs).toISOString().slice(0, 10)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

export function shiftDate(dateStr, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '')
  if (!m) return dateStr
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  d.setUTCDate(d.getUTCDate() + days)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

function offsetAt(ts, tz) {
  const p = partsInZone(new Date(ts), tz)
  if (!p) return 0
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - ts
}

/** Локальные дата+минуты в зоне точки → абсолютный момент */
export function zonedToUtc(dateStr, minutes, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '')
  if (!m) return new Date(NaN)
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], 0, minutes)
  // Два прохода: смещение зоны зависит от самого момента (перевод часов)
  let guess = new Date(asUtc - offsetAt(asUtc, tz))
  guess = new Date(asUtc - offsetAt(guess.getTime(), tz))
  return guess
}

/** Окна брони на дату: исключение по дате замещает недельное правило */
export function dayWindows(schedule, dateStr) {
  const exception = schedule?.exceptions?.[dateStr]
  if (Array.isArray(exception)) return exception
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '')
  if (!m) return []
  const dow = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()
  const windows = schedule?.weekly?.[String(dow)]
  return Array.isArray(windows) ? windows : []
}

/** Минуты видимого окна от расписания: запас до открытия и после закрытия */
function windowMinutes(schedule, dateStr) {
  const parsed = dayWindows(schedule, dateStr)
    .map((w) => {
      const from = hmToMin(w[0])
      let to = hmToMin(w[1])
      if (from === null || to === null) return null
      if (to < from) to += 1440
      return { from, to }
    })
    .filter(Boolean)

  if (parsed.length === 0) return { fromMin: DEFAULT_FROM_MIN, toMin: DEFAULT_TO_MIN }
  return {
    fromMin: Math.min(...parsed.map((w) => w.from)) - 30,
    toMin: Math.max(...parsed.map((w) => w.to)) + 90,
  }
}

/**
 * Границы выбранного «ресторанного дня» в зоне точки: от полуночи до
 * полуночи, а при ночной смене — до конца её окна (18:00–02:00 → до 02:00
 * следующих суток плюс тот же запас).
 *
 * Это ответ на вопрос «чей это визит»: полотно дня не может растянуться
 * за них, иначе одна вчерашняя бронь превращает сутки в 34 часа.
 */
export function dayBounds(dateStr, tz, schedule) {
  const { toMin } = windowMinutes(schedule, dateStr)
  return {
    startMs: zonedToUtc(dateStr, 0, tz).getTime(),
    endMs: zonedToUtc(dateStr, Math.max(1440, toMin), tz).getTime(),
  }
}

/** Брони выбранного дня: занятость пересекается с его границами */
export function bookingsForDay(bookings, bounds) {
  return bookings.filter((b) => b.endMs > bounds.startMs && b.startMs < bounds.endMs)
}

/**
 * Видимое окно дня: от расписания точки, расширенное под брони вне его.
 * Ручная бронь на нерабочее время обязана быть видна, а не исчезнуть.
 *
 * Запрос броней берётся с запасом в сутки назад (ночная смена начинается
 * вчера), поэтому окно считается ТОЛЬКО по броням выбранного дня и
 * обрезается его границами: визит, зацепивший полночь, показывается
 * обрезанным с края, а не раздувает шкалу на чужие сутки.
 */
export function timelineWindow(dateStr, tz, schedule, bookings = []) {
  const bounds = dayBounds(dateStr, tz, schedule)
  const { fromMin, toMin } = windowMinutes(schedule, dateStr)

  let startMs = zonedToUtc(dateStr, Math.max(0, fromMin), tz).getTime()
  let endMs = zonedToUtc(dateStr, toMin, tz).getTime()

  for (const b of bookingsForDay(bookings, bounds)) {
    if (b.startMs < startMs) startMs = b.startMs
    if (b.endMs > endMs) endMs = b.endMs
  }

  startMs = Math.max(startMs, bounds.startMs)
  endMs = Math.min(endMs, bounds.endMs)
  if (!(endMs > startMs)) {
    endMs = Math.min(startMs + 12 * HOUR_MS, bounds.endMs)
    if (!(endMs > startMs)) endMs = startMs + 12 * HOUR_MS
  }
  return { startMs, endMs }
}

export function positionOf(startMs, endMs, win) {
  const span = win.endMs - win.startMs
  if (span <= 0) return { leftPct: 0, widthPct: 0, clipsStart: false, clipsEnd: false }
  const from = Math.max(startMs, win.startMs)
  const to = Math.min(endMs, win.endMs)
  return {
    leftPct: ((from - win.startMs) / span) * 100,
    widthPct: Math.max(0, ((to - from) / span) * 100),
    clipsStart: startMs < win.startMs,
    clipsEnd: endMs > win.endMs,
  }
}

/**
 * Часовые отметки шкалы. `ts` — ключ отметки: в день перевода часов одна
 * и та же подпись встречается дважды, и подпись ключом быть не может.
 */
export function hourTicks(win, tz) {
  const span = win.endMs - win.startMs
  if (span <= 0) return []
  const out = []
  const first = Math.ceil(win.startMs / HOUR_MS) * HOUR_MS
  for (let ts = first; ts <= win.endMs; ts += HOUR_MS) {
    const p = partsInZone(new Date(ts), tz)
    out.push({
      ts,
      label: p ? `${pad(p.hour)}:${pad(p.minute)}` : '',
      leftPct: ((ts - win.startMs) / span) * 100,
    })
  }
  return out
}

export function nowMarkerPct(nowMs, win) {
  const span = win.endMs - win.startMs
  if (span <= 0 || nowMs < win.startMs || nowMs > win.endMs) return null
  return ((nowMs - win.startMs) / span) * 100
}

function isLive(state) {
  return state === 'pending' || state === 'confirmed' || state === 'arrived'
}

/** Состояние блока из полей брони — одно место, где это решается */
export function blockState(status, arrivedAt, orderId) {
  if (status === 'completed') return 'done'
  if (status === 'no_show') return 'noshow'
  if (status === 'new') return 'pending'
  if (arrivedAt || orderId) return 'arrived'
  return 'confirmed'
}

/** Строки таймлайна: стол → блоки его броней */
export function buildRows(tables, bookings, win) {
  const byTable = new Map()
  for (const b of bookings) {
    for (const tableId of b.tableIds) {
      const list = byTable.get(tableId)
      if (list) list.push(b)
      else byTable.set(tableId, [b])
    }
  }

  return [...tables]
    .sort((a, b) => a.sortOrder - b.sortOrder || String(a.label).localeCompare(String(b.label)))
    .map((table) => {
      const list = (byTable.get(table.id) ?? [])
        .filter((b) => b.endMs > win.startMs && b.startMs < win.endMs)
        .sort((a, b) => a.startMs - b.startMs)

      const blocks = list.map((booking) => ({
        booking,
        ...positionOf(booking.startMs, booking.endMs, win),
        conflict: false,
        combined: booking.tableIds.length > 1,
      }))

      for (let i = 1; i < blocks.length; i += 1) {
        const prev = blocks[i - 1].booking
        const cur = blocks[i].booking
        if (cur.startMs < prev.endMs && isLive(cur.state) && isLive(prev.state)) {
          blocks[i].conflict = true
          blocks[i - 1].conflict = true
        }
      }

      return { table, blocks }
    })
}

/** Группировка строк по зонам; «без зоны» уходит вниз */
export function groupByZone(rows) {
  const zones = []
  const index = new Map()
  for (const row of rows) {
    const key = row.table.zoneId ?? '__none__'
    let zone = index.get(key)
    if (!zone) {
      zone = { id: row.table.zoneId, name: row.table.zoneName, rows: [] }
      index.set(key, zone)
      zones.push(zone)
    }
    zone.rows.push(row)
  }
  return zones.sort((a, b) => Number(a.id === null) - Number(b.id === null))
}

/** Сводка «что происходит» — то, ради чего хостес смотрит на экран */
export function occupancySummary(rows, nowMs, soonMs = HOUR_MS) {
  let busyTables = 0
  let freeSeats = 0
  let totalSeats = 0
  let totalTables = 0
  const soon = new Set()
  const pending = new Set()

  for (const row of rows) {
    if (row.table.blocked) continue
    totalTables += 1
    totalSeats += row.table.seats

    const busyNow = row.blocks.some(
      (b) => isLive(b.booking.state) && b.booking.startMs <= nowMs && b.booking.endMs > nowMs
    )
    if (busyNow) busyTables += 1
    else freeSeats += row.table.seats

    for (const b of row.blocks) {
      if (b.booking.state === 'pending') pending.add(b.booking.id)
      if (isLive(b.booking.state)
          && b.booking.startMs > nowMs
          && b.booking.startMs <= nowMs + soonMs) soon.add(b.booking.id)
    }
  }

  return {
    busyTables, totalTables, freeSeats, totalSeats,
    soon: soon.size, pending: pending.size,
  }
}
