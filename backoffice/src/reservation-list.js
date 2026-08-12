import { partsInZone } from './timeline'
import { visitState } from './reservation-status'

/**
 * Список броней: отбор, порядок, дни и страницы.
 *
 * Вкладка «List» была тремя панелями карточек — «Requests», «Upcoming &
 * today» и «Recent history». Найти в ней конкретную бронь можно было
 * только глазами: ни фильтра по состоянию, ни по залу, ни сортировки, а
 * история обрывалась на двадцати записях без объяснения.
 *
 * Правила отбора живут здесь, а не в разметке: их видно целиком и можно
 * проверить тестом. Экран остаётся ответственным только за показ.
 */

/** Зона визита: сначала по назначенным столам, потом по полю брони */
export function zoneOf(reservation, tableById) {
  const ids = [
    // Серверная модель (152) отдаёт столы визита готовым списком;
    // `tables_link` — форма прежней прямой выборки, она ещё приходит из
    // кассового зеркала и из тестов, поэтому читаются обе.
    ...(reservation.table_ids ?? []),
    ...(reservation.tables_link ?? []).map((l) => l.table_id),
    reservation.table_id,
    ...(reservation.hold_table_ids ?? []),
  ].filter(Boolean)
  for (const id of ids) {
    const zoneId = tableById?.get(id)?.zoneId
    if (zoneId) return zoneId
  }
  return reservation.zone_id ?? null
}

/**
 * Каким путём заведён визит (миграция 136).
 *
 * Не путать с `source`: там канал привода гостя — instagram, qr, site.
 * Здесь то, кто нажал кнопку: гость сам, касса, кабинет или согласие из
 * листа ожидания.
 *
 * Пусто означает «путь не записан» — так выглядят брони, заведённые до
 * 136. Назвать их гостевыми было бы догадкой, выданной за факт.
 */
export function createdVia(reservation) {
  const via = reservation?.created_via
  return VIA_LABEL[via] ? via : 'unknown'
}

export const VIA_LABEL = {
  public: 'Website',
  pos: 'Register',
  backoffice: 'Back office',
  waitlist: 'Waitlist',
  unknown: 'Not recorded',
}

/** Совпадает ли бронь с поиском по имени или телефону */
export function matchesQuery(reservation, query) {
  const needle = String(query ?? '').trim().toLowerCase()
  if (!needle) return true
  return `${reservation.customer_name ?? ''} ${reservation.customer_phone ?? ''}`
    .toLowerCase().includes(needle)
}

/**
 * Отбор по состоянию, залу, источнику и поиску.
 * Пустой фильтр означает «всё», а не «ничего».
 */
export function filterReservations(rows, {
  status = null, zone = null, via = null, query = '', tableById = null,
} = {}) {
  return (rows ?? []).filter((r) => {
    if (status && visitState(r) !== status) return false
    if (zone && zoneOf(r, tableById) !== zone) return false
    if (via && createdVia(r) !== via) return false
    return matchesQuery(r, query)
  })
}

/**
 * Порядок по времени визита. Обратимый: хостес утром смотрит вперёд, а
 * разбирая вчерашнее — назад.
 */
export function sortByTime(rows, direction = 'asc') {
  const sign = direction === 'desc' ? -1 : 1
  return [...(rows ?? [])].sort((a, b) => {
    const diff = new Date(a.reserved_at) - new Date(b.reserved_at)
    // Одинаковое время — стабильный порядок по имени, иначе строки
    // прыгают при каждой перерисовке realtime
    if (diff !== 0) return sign * diff
    return String(a.customer_name ?? '').localeCompare(String(b.customer_name ?? ''))
  })
}

const dayKey = (iso, tz) => {
  const p = partsInZone(new Date(iso), tz)
  if (!p) return String(iso).slice(0, 10)
  const pad = (n) => String(n).padStart(2, '0')
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** Сдвиг даты 'YYYY-MM-DD' на дни — для подписей «Today»/«Tomorrow» */
function shift(dateStr, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '')
  if (!m) return dateStr
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  d.setUTCDate(d.getUTCDate() + days)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/**
 * Группировка по дню визита в зоне ТОЧКИ, а не браузера: хостес в
 * Тель-Авиве и владелец в отпуске обязаны видеть одинаковые сутки.
 */
export function groupByDay(rows, tz, todayStr) {
  const groups = []
  const index = new Map()
  for (const row of rows ?? []) {
    const key = dayKey(row.reserved_at, tz)
    let group = index.get(key)
    if (!group) {
      group = { key, label: dayLabel(key, todayStr), rows: [] }
      index.set(key, group)
      groups.push(group)
    }
    group.rows.push(row)
  }
  return groups
}

/** «Today», «Tomorrow», «Yesterday» — остальное датой */
export function dayLabel(key, todayStr) {
  if (!todayStr) return key
  if (key === todayStr) return 'Today'
  if (key === shift(todayStr, 1)) return 'Tomorrow'
  if (key === shift(todayStr, -1)) return 'Yesterday'
  return key
}

export const PAGE_SIZE = 25

/**
 * Страница списка. Номер приводится к существующему: после ужесточения
 * фильтра третья страница может исчезнуть, и показывать пустоту вместо
 * результатов нельзя.
 */
export function paginate(rows, page = 1, size = PAGE_SIZE) {
  const total = (rows ?? []).length
  const pages = Math.max(1, Math.ceil(total / size))
  const current = Math.min(Math.max(1, Number(page) || 1), pages)
  const from = (current - 1) * size
  return {
    items: (rows ?? []).slice(from, from + size),
    page: current,
    pages,
    total,
    from: total === 0 ? 0 : from + 1,
    to: Math.min(from + size, total),
  }
}
