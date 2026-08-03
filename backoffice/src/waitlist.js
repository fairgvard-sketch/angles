/**
 * Правила очереди ожидания: состояния, порядок и время.
 *
 * Панель показывала два списка — «кто подходит на слот» и «ждущие»,
 * оба карточками и без ответа на главные вопросы стойки: сколько человек
 * уже ждёт, кого звать следующим и сколько мы ему пообещали.
 *
 * Состояния очереди — не то же самое, что состояния брони, но говорить
 * они обязаны на одном языке: «Seated» значит «сидит» и там, и там.
 */

/** Состояние записи из её статуса в базе */
export const QUEUE_STATUS = {
  waiting: { label: 'Waiting', className: 'is-pending', group: 'waiting' },
  offered: { label: 'Notified', className: 'is-confirmed', group: 'notified' },
  converted: { label: 'Seated', className: 'is-arrived', group: 'seated' },
  cancelled: { label: 'Removed', className: 'is-cancelled', group: 'closed' },
  expired: { label: 'Expired', className: 'is-cancelled', group: 'closed' },
}

/** Группы очереди в том порядке, в каком они нужны у стойки */
export const QUEUE_GROUPS = [
  { key: 'waiting', label: 'Waiting now' },
  { key: 'notified', label: 'Notified' },
  { key: 'seated', label: 'Seated' },
  { key: 'closed', label: 'Removed / expired' },
]

export const statusLabel = (status) => QUEUE_STATUS[status]?.label ?? String(status ?? '')
export const statusClass = (status) => QUEUE_STATUS[status]?.className ?? ''
export const groupOf = (status) => QUEUE_STATUS[status]?.group ?? 'closed'

/** Запись ещё живая: её можно посадить, подвинуть или закрыть */
export const isOpen = (entry) => entry?.status === 'waiting' || entry?.status === 'offered'

/**
 * Стоит ли гость в очереди на вызов.
 *
 * Уведомлённого уже позвали — он думает, а не ждёт своей очереди.
 * Оставлять ему номер значит показывать очередь, в которой «первый»
 * никого не ждёт: хостес звонит второму и путается.
 */
export const isQueued = (entry) => entry?.status === 'waiting'

/**
 * Порядок очереди: сначала переставленные вручную, потом по времени
 * записи. Без второго правила гость, которого никто не двигал, уезжал бы
 * в конец списка при первой же перестановке соседа.
 */
export function sortQueue(entries) {
  return [...(entries ?? [])].sort((a, b) => {
    const pa = a.position ?? Number.MAX_SAFE_INTEGER
    const pb = b.position ?? Number.MAX_SAFE_INTEGER
    if (pa !== pb) return pa - pb
    return new Date(a.created_at) - new Date(b.created_at)
  })
}

/** Разложить очередь по группам, сохранив внутри них порядок */
export function groupQueue(entries) {
  const sorted = sortQueue(entries)
  return QUEUE_GROUPS
    .map((group) => ({
      ...group,
      rows: sorted.filter((entry) => groupOf(entry.status) === group.key),
    }))
    .filter((group) => group.rows.length > 0)
}

/**
 * Сколько гость ждёт, в минутах.
 *
 * Считается от записи и ДО посадки: у посаженного счётчик обязан
 * замереть, иначе «ждёт 90 минут» будет висеть на человеке, который час
 * назад уже поел и ушёл.
 */
export function waitedMin(entry, nowMs = Date.now()) {
  if (!entry?.created_at) return null
  const from = new Date(entry.created_at).getTime()
  if (!Number.isFinite(from)) return null
  if (isOpen(entry)) return Math.max(0, Math.round((nowMs - from) / 60_000))
  // Запись закрыта. Момента посадки схема не хранит, и единственная
  // честная отметка — время предложения. Без неё ответ неизвестен, и
  // «0 min» был бы не нулём, а выдумкой: гость ждал, просто мы не
  // записали сколько.
  const until = entry.offer_at ? new Date(entry.offer_at).getTime() : null
  if (!Number.isFinite(until)) return null
  return Math.max(0, Math.round((until - from) / 60_000))
}

/**
 * Перебрал ли гость обещанное время. Это не украшение: именно здесь
 * очередь превращается в скандал, и хостес должен увидеть это раньше
 * гостя.
 */
export function isOverdue(entry, nowMs = Date.now()) {
  if (!isOpen(entry) || entry?.quoted_min == null) return false
  const waited = waitedMin(entry, nowMs)
  return waited != null && waited > entry.quoted_min
}

/** «12 min» / «1 h 05 min» — время у стойки читают на бегу */
export function formatWait(minutes) {
  if (minutes == null) return '—'
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h} h ${String(m).padStart(2, '0')} min`
}

/**
 * Новый порядок после перемещения записи на шаг вверх или вниз.
 *
 * Двигать очередь мышью — не единственный способ: с клавиатуры и с
 * телефона перетаскивание недоступно, а переставить гостя нужно всем.
 * Возвращает массив id в новом порядке — его и отправляем серверу.
 */
export function moveInQueue(entries, id, direction) {
  const open = sortQueue(entries).filter(isQueued)
  const index = open.findIndex((entry) => entry.id === id)
  if (index < 0) return null
  const target = index + (direction === 'up' ? -1 : 1)
  if (target < 0 || target >= open.length) return null
  const next = [...open]
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved)
  return next.map((entry) => entry.id)
}

/** Человеческий текст ошибок очереди */
export function queueErrorText(message) {
  const m = String(message || '')
  if (m.includes('full_slot')) {
    return 'No free table for this party right now — free one up or seat a smaller group first.'
  }
  if (m.includes('table_busy')) return 'That table is taken — pick another one.'
  if (m.includes('already_closed')) return 'This entry is already closed — reload the page.'
  if (m.includes('name_required')) return 'Enter the guest name.'
  if (m.includes('invalid_quote')) return 'Quoted wait must be between 0 and 600 minutes.'
  if (m.includes('invalid_zone')) return 'That zone no longer exists — reload the page.'
  if (m.includes('module_disabled')) return 'Reserve is not active for this account.'
  if (m.includes('backoffice access denied')) return 'Only an owner or a manager can manage the queue.'
  if (m.includes('not_found')) return 'That entry no longer exists — reload the page.'
  return m
}
