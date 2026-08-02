/**
 * Подсказки хостес после отказа сервера.
 *
 * Сервер отвечает «стол занят» или «нет свободного стола на это время» —
 * и на этом разговор заканчивался: хостес возвращался к сетке и искал
 * дырку глазами, держа введённые данные в голове.
 *
 * Здесь считаются ВАРИАНТЫ из тех же данных, что уже на экране: столы
 * точки и активные визиты дня. Это подсказка, а не разрешение —
 * занятость по-прежнему решает сервер (общий `_pick_tables` и
 * exclusion-constraint), и он проверит ещё раз при отправке. Иначе два
 * хостес за двумя экранами посадили бы гостей на один стол.
 */

const DEFAULT_DURATION_MIN = 90

/** Интервал занятости визита в миллисекундах */
function interval(booking, durationMin = DEFAULT_DURATION_MIN) {
  const start = new Date(booking.reserved_at).getTime()
  const minutes = booking.duration_min || durationMin
  return [start, start + minutes * 60_000]
}

/** Столы, занятые визитом: основной плюс придержанные под составную посадку */
function tablesOf(booking) {
  const ids = [booking.table_id, ...(booking.hold_table_ids ?? [])]
  const linked = (booking.tables_link ?? []).map((l) => l.table_id)
  return [...new Set([...ids, ...linked].filter(Boolean))]
}

/**
 * Занятость по столам: id стола → список интервалов.
 * Учитываются только живые визиты — отменённый стол не держит.
 */
export function occupancyByTable(bookings, { durationMin = DEFAULT_DURATION_MIN, ignoreId = null } = {}) {
  const map = new Map()
  for (const booking of bookings ?? []) {
    if (ignoreId && booking.id === ignoreId) continue
    if (!['new', 'confirmed'].includes(booking.status)) continue
    const span = interval(booking, durationMin)
    for (const tableId of tablesOf(booking)) {
      if (!map.has(tableId)) map.set(tableId, [])
      map.get(tableId).push(span)
    }
  }
  return map
}

const overlaps = (a, b) => a[0] < b[1] && b[0] < a[1]

/**
 * Столы, свободные в это время и вмещающие компанию.
 *
 * Заблокированные столы не предлагаются: они выключены хозяином, а не
 * заняты гостем.
 */
export function tablesFreeAt(tables, occupancy, atMs, {
  durationMin = DEFAULT_DURATION_MIN, partySize = 1,
} = {}) {
  const want = [atMs, atMs + durationMin * 60_000]
  return (tables ?? [])
    .filter((table) => !table.blocked)
    .filter((table) => (table.seats ?? 0) >= partySize)
    .filter((table) => !(occupancy.get(table.id) ?? []).some((busy) => overlaps(want, busy)))
}

/**
 * Ближайшие свободные времена вокруг желаемого.
 *
 * Шаг 15 минут и окно ±3 часа — столько имеет смысл предлагать гостю по
 * телефону; дальше это уже другой визит, а не «чуть позже».
 */
export function nearestFreeTimes(tables, bookings, wantedMs, {
  durationMin = DEFAULT_DURATION_MIN,
  partySize = 1,
  stepMin = 15,
  windowMin = 180,
  limit = 4,
  ignoreId = null,
} = {}) {
  const occupancy = occupancyByTable(bookings, { durationMin, ignoreId })
  const step = stepMin * 60_000
  // Желаемое время округляем к шагу вниз — «19:07» не предлагаем
  const anchor = Math.round(wantedMs / step) * step
  const steps = Math.floor(windowMin / stepMin)
  const found = []
  // Идём в обе стороны, чередуя: ближайшее по времени важнее направления
  for (let i = 1; i <= steps && found.length < limit; i++) {
    for (const at of [anchor + i * step, anchor - i * step]) {
      if (found.length >= limit) break
      const free = tablesFreeAt(tables, occupancy, at, { durationMin, partySize })
      if (free.length > 0) found.push({ at, tables: free })
    }
  }
  return found.sort((a, b) => Math.abs(a.at - wantedMs) - Math.abs(b.at - wantedMs))
}

/**
 * Что показать после отказа сервера: свободные столы на то же время и
 * ближайшие свободные времена. Пусто — значит предложить нечего, и это
 * честнее выдуманного варианта.
 */
export function conflictAlternatives({
  tables, bookings, wantedMs, durationMin = DEFAULT_DURATION_MIN, partySize = 1, ignoreId = null,
}) {
  if (!Number.isFinite(wantedMs)) return { tables: [], times: [] }
  const occupancy = occupancyByTable(bookings, { durationMin, ignoreId })
  return {
    tables: tablesFreeAt(tables, occupancy, wantedMs, { durationMin, partySize }),
    times: nearestFreeTimes(tables, bookings, wantedMs, { durationMin, partySize, ignoreId }),
  }
}

/** Отказ сервера, у которого есть смысл предлагать альтернативу */
export function isConflict(message) {
  const text = String(message || '')
  return text.includes('table_busy') || text.includes('full_slot')
}
