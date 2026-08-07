import { dateKey } from './hours'

/**
 * Команда — чистые правила без сети.
 *
 * Раздел отвечает на два вопроса: кто у меня работает и что каждому
 * можно. Второй ответ собирается из трёх мест — базовая роль сотрудника,
 * настройки точки и кастомная роль, — и порядок веток обязан совпадать с
 * сервером (`require_staff_perm`, Kassa 094) и с кассой
 * (`src/lib/perms.ts`). Кабинет, который расходится с ними хотя бы на
 * одну ветку, обещает право, на котором терминал откажет.
 *
 * Сетевая часть и парная реализация — `team.js`.
 */

export const ROLES = ['barista', 'manager', 'owner']

export const ROLE_LABELS = {
  owner: 'Owner',
  manager: 'Manager',
  barista: 'Barista',
}

/** Правила PIN совпадают с серверными (create_staff/set_staff_pin) */
export function isValidPin(pin) {
  return /^\d{4,8}$/.test(pin)
}

// ── Права ────────────────────────────────────────────────────

/**
 * Ключи и дефолты повторяют `src/lib/perms.ts` кассы. Дефолты — поведение
 * до миграции 036; при расхождении источник истины там.
 */
export const PERM_KEYS = [
  'discount', 'price_edit', 'refund', 'void_order', 'close_shift',
  'cash_movement', 'online_pause', 'stock_receive', 'stock_take',
]

export const PERM_DEFAULTS = {
  discount: 'all',
  price_edit: 'all',
  refund: 'manager',
  void_order: 'all',
  close_shift: 'all',
  cash_movement: 'all',
  online_pause: 'all',
  stock_receive: 'all',
  stock_take: 'manager',
}

export const PERM_LABELS = {
  discount: 'Discounts',
  price_edit: 'Price override',
  refund: 'Refunds',
  void_order: 'Void order',
  close_shift: 'Close shift',
  cash_movement: 'Cash in / cash out',
  online_pause: 'Pause online orders',
  stock_receive: 'Receive stock',
  stock_take: 'Stock take',
}

/**
 * Что действие значит на терминале. Владелец раздаёт права по названию
 * кнопки, а не по ключу в базе: «Void order» и «Refunds» звучат похоже, а
 * стоят за ними разные деньги.
 */
export const PERM_HINTS = {
  discount: 'Take money off an order before it is paid',
  price_edit: 'Sell an item for a price that is not in the menu',
  refund: 'Give money back for an order that was already paid',
  void_order: 'Cancel an unpaid order',
  close_shift: 'End the shift and count the drawer',
  cash_movement: 'Put money into the drawer or take it out',
  online_pause: 'Stop taking online orders',
  stock_receive: 'Book in a delivery',
  stock_take: 'Count stock and write off the difference',
}

export function permLevel(settings, key) {
  return settings?.perms?.[key] ?? PERM_DEFAULTS[key]
}

/**
 * Может ли человек выполнить действие на этой точке. Зеркало
 * `require_staff_perm` (094) — ветки в том же порядке:
 *
 *   1) владелец может всё (роль его не ограничивает);
 *   2) есть кастомная роль → решает ТОЛЬКО её набор;
 *   3) роли нет → уровень права точки + базовая роль.
 *
 * Про вторую ветку важно: набор роли ИСЧЕРПЫВАЮЩИЙ. Не отмеченное в роли
 * действие запрещено, даже если точка разрешает его всем, — ни сервер, ни
 * касса в этой ветке настройки точки не смотрят. Прежний кабинет обещал
 * обратное («базовый уровень применяется ко всему, что не перечислено»),
 * и это была неправда.
 */
export function can(member, key, settings, role) {
  if (member?.role === 'owner') return true
  if (role) return (role.perms ?? []).includes(key)
  if (permLevel(settings, key) === 'all') return true
  return member?.role === 'manager'
}

/** Роль сотрудника из списка ролей организации */
export function roleOf(member, roles) {
  if (!member?.role_id) return null
  return (roles ?? []).find((r) => r.id === member.role_id) ?? null
}

/** Все девять действий с ответом «можно/нельзя» — для карточки человека */
export function accessRows(member, settings, role) {
  return PERM_KEYS.map((key) => ({
    key,
    label: PERM_LABELS[key],
    hint: PERM_HINTS[key],
    allowed: can(member, key, settings, role),
  }))
}

/**
 * Откуда взялся ответ. Показывается над списком действий: право можно
 * поменять в трёх разных местах, и человек должен знать, в каком именно.
 */
export function accessSource(member, role, locationName) {
  if (member?.role === 'owner') {
    return 'Owner — every action, always. A role cannot take this away.'
  }
  if (role) {
    return `Role “${role.name}” decides everything below. Location rules do not apply to this person.`
  }
  const where = locationName ? ` at ${locationName}` : ''
  return `Location rules${where}, at the ${ROLE_LABELS[member?.role] || member?.role} level.`
}

/**
 * Точки, по которым считается доступ человека. Сотрудник без точки
 * работает на всех, и права у него могут различаться: настройки живут в
 * `locations.settings`, а не в карточке.
 *
 * Носитель кастомной роли от точки не зависит вовсе — для него список
 * пуст, и звать его надо один раз.
 */
export function accessScope(member, role, locations) {
  if (member?.role === 'owner' || role) return []
  if (member?.location_id) {
    return (locations ?? []).filter((l) => l.id === member.location_id)
  }
  return locations ?? []
}

/**
 * Сколько из девяти действий человеку разрешено — колонка списка.
 *
 * Считается по КАЖДОЙ точке, где человек работает: у сотрудника без
 * привязки права на двух точках могут не совпасть, и одно число тогда
 * врёт. Разошлись — так и говорим, точная картина в карточке.
 */
export function accessSummary(member, role, settingsByLocation, locations) {
  const total = PERM_KEYS.length
  const count = (settings) => PERM_KEYS.filter((k) => can(member, k, settings, role)).length

  if (member?.role === 'owner' || role) {
    const n = count(null)
    return { label: n === total ? `All ${total}` : `${n} of ${total}`, allowed: n, total }
  }

  const scope = accessScope(member, role, locations)
  const counts = scope.length
    ? scope.map((l) => count(settingsByLocation?.[l.id]))
    : [count(null)]
  const first = counts[0]
  if (counts.some((n) => n !== first)) {
    return { label: 'Varies', allowed: null, total }
  }
  return { label: first === total ? `All ${total}` : `${first} of ${total}`, allowed: first, total }
}

/** Роли, которые разрешают действие, — колонка «Exceptions» в матрице */
export function rolesAllowing(roles, key) {
  return (roles ?? []).filter((r) => (r.perms ?? []).includes(key))
}

/** Сколько человек носит роль — чтобы удаление роли не было вслепую */
export function roleHolders(staff, roleId) {
  return (staff ?? []).filter((s) => s.role_id === roleId).length
}

// ── Строка списка ────────────────────────────────────────────

/** Точка сотрудника; без привязки — работает на всех */
export function locationLabel(member, locations) {
  if (!member?.location_id) return 'All locations'
  return (locations ?? []).find((l) => l.id === member.location_id)?.name || 'Unknown'
}

/**
 * Кто это в списке: кастомная роль, если она есть, иначе базовый уровень.
 * База под именем роли остаётся видна — по ней человека ищут глазами
 * («кто у меня менеджеры»), и роль её не отменяет.
 */
export function roleTitle(member, role) {
  return role ? role.name : (ROLE_LABELS[member?.role] || member?.role || '')
}

/** Разница в днях между двумя календарными днями `YYYY-MM-DD` */
export function daysBetween(from, to) {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((b - a) / 86400000)
}

/**
 * «Когда работал последний раз». Окно отчёта конечное (`SHIFT_WINDOW_DAYS`),
 * поэтому «нет отметок» — это не «никогда не работал», а «не за этот
 * период»: обещать больше, чем спросили у сервера, нельзя.
 */
export function lastShiftLabel(day, today = dateKey(new Date())) {
  if (!day) return '—'
  const days = daysBetween(day, today)
  if (days === null) return '—'
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
}

/**
 * Глубина окна смен. Месяц — тот же период, которым считают зарплату:
 * «не отмечался месяц» уже говорит владельцу всё, что нужно, а тянуть
 * год отчёта ради одной колонки незачем.
 */
export const SHIFT_WINDOW_DAYS = 30

/** Последняя смена и открытая смена по сотрудникам — из отчёта часов */
export function shiftIndex(report) {
  const index = new Map()
  for (const person of report?.staff ?? []) {
    let last = null
    for (const entry of person.entries ?? []) {
      if (!last || entry.day > last) last = entry.day
    }
    index.set(person.staff_id, { lastDay: last, open: Boolean(person.has_open) })
  }
  return index
}

/**
 * Состояние человека. «На смене» — не украшение: по нему владелец
 * понимает, кто сейчас за терминалом, и почему человека нельзя трогать.
 */
export function statusOf(member, shift) {
  if (!member?.is_active) return { tone: 'off', label: 'Inactive' }
  if (shift?.open) return { tone: 'on', label: 'On shift' }
  return { tone: 'idle', label: 'Active' }
}

/**
 * Доступное имя строки.
 *
 * Строка — одна кнопка, и её `aria-label` заменяет читалке ВСЁ
 * содержимое: значения ячеек до неё не доходят. Иначе список для читалки
 * состоит из десяти безымянных «Open».
 */
export function personRowLabel(member, { role, locations, access, shift }) {
  const parts = [member.name, roleTitle(member, role)]
  if ((locations ?? []).length > 1) parts.push(locationLabel(member, locations))
  if (access) parts.push(`${access.label} actions allowed`)
  const status = statusOf(member, shift)
  parts.push(status.label)
  if (member.is_active && !shift?.open) {
    parts.push(`last shift ${lastShiftLabel(shift?.lastDay).toLowerCase()}`)
  }
  return `Open ${parts.join(' · ')}`
}

/**
 * Порядок списка: сначала те, кто может работать, внутри — по имени.
 * Уволенные не прячутся в отдельную панель (она удлиняла страницу
 * вдвое), но и не мешаются между работающими.
 */
export function sortRoster(staff) {
  return [...(staff ?? [])].sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1
    return String(a.name).localeCompare(String(b.name))
  })
}

/** Отбор списка: имя и точка. Роутер тут не нужен — штат уже загружен */
export function filterRoster(staff, { search = '', locationId = '' } = {}) {
  const needle = search.trim().toLowerCase()
  return (staff ?? []).filter((member) => {
    if (needle && !String(member.name).toLowerCase().includes(needle)) return false
    // Человек без привязки работает на всех точках, включая выбранную
    if (locationId && member.location_id && member.location_id !== locationId) return false
    return true
  })
}

// ── Вкладки ──────────────────────────────────────────────────

export const TABS = [
  { key: 'people', label: 'People' },
  { key: 'access', label: 'Access' },
  { key: 'hours', label: 'Hours' },
]

/**
 * Прежние адреса вкладок. Раздел был из четырёх вкладок, роли и права
 * съехались в одну — присланная вчера ссылка не должна открывать не то,
 * что в ней написано.
 */
const LEGACY_TABS = { staff: 'people', roles: 'access', perms: 'access' }

export function resolveTab(tab) {
  if (TABS.some((t) => t.key === tab)) return tab
  return LEGACY_TABS[tab] || TABS[0].key
}

// ── Ошибки ───────────────────────────────────────────────────

/**
 * Коды сервера (093/094) → человеческий текст. Сопоставление по коду, а
 * не по случайной подстроке: «staff has records» — не ошибка ввода, а
 * инвариант аудита, и предложить в ответ надо деактивацию.
 */
const ERRORS = {
  'staff has records': 'This person already has sales or shifts. Deactivate them instead — history cannot be deleted.',
  'role name required': 'Give the role a name.',
  'invalid base role': 'Pick a level for the role.',
  'invalid role': 'That role no longer exists — refresh the section.',
  'invalid pin': 'A PIN is 4 to 8 digits.',
  'owner only': 'Only an owner can change another owner.',
  'not authenticated': 'Your session has expired — sign in again.',
  'staff session required': 'Your role cannot change the team.',
  'forbidden: manage': 'Your role cannot change the team.',
  duplicate: 'A role with this name already exists.',
}

export function staffErrorText(message) {
  const text = String(message || '')
  const code = Object.keys(ERRORS)
    .sort((a, b) => b.length - a.length)
    .find((key) => text.includes(key))
  if (code) return ERRORS[code]
  if (text.includes('permission') || text.includes('denied')) {
    return 'Your role cannot change the team.'
  }
  return text
}

/** Человек с историей не удаляется — сервер говорит это отдельным кодом */
export function hasRecords(message) {
  return /staff has records/i.test(String(message || ''))
}

// ── Предпросмотр эффекта до сохранения (Phase 9) ─────────────

/**
 * Что изменится, если сохранить набор роли.
 *
 * План требует показать «effective access» ДО сохранения. Причина
 * простая: набор роли исчерпывающий — снятая галочка отбирает действие
 * у всех её носителей, даже если точка разрешает это действие всем.
 * Владелец, снимающий «Refunds» у роли «Старший бариста», должен
 * увидеть, что возвраты потеряют трое, а не узнать это от них.
 *
 * Сравнивается набор ролей: до и после. Люди берутся те, у кого эта
 * роль уже стоит; для новой роли (носителей нет) список пуст, и это
 * честный ответ, а не «0 человек потеряют доступ».
 */
export function roleAccessDiff(role, nextPerms, holders = []) {
  const before = new Set(role?.perms ?? [])
  const after = new Set(nextPerms ?? [])
  const gained = PERM_KEYS.filter((key) => after.has(key) && !before.has(key))
  const lost = PERM_KEYS.filter((key) => before.has(key) && !after.has(key))
  return {
    gained: gained.map((key) => ({ key, label: PERM_LABELS[key] })),
    lost: lost.map((key) => ({ key, label: PERM_LABELS[key] })),
    people: holders.length,
    changed: gained.length > 0 || lost.length > 0,
  }
}

/**
 * Кого затронет смена уровня права на точке.
 *
 * Считается по тем же правилам, что `can`: у кого есть своя роль —
 * уровень точки его не касается вовсе, и обещать обратное нельзя.
 * Владелец не считается никогда: он может всё.
 */
export function levelChangeEffect(key, nextLevel, staff, roles, settings) {
  const affected = (staff ?? []).filter((member) => {
    if (member.role === 'owner') return false
    if (roleOf(member, roles)) return false
    return can(member, key, settings, null) !== can(
      member, key, { ...settings, perms: { ...(settings?.perms ?? {}), [key]: nextLevel } }, null,
    )
  })
  return {
    key,
    label: PERM_LABELS[key],
    people: affected.map((m) => m.name).filter(Boolean),
    // С ролью уровень точки не спорит — таких людей называем отдельно,
    // иначе владелец решит, что переключатель их тоже задел.
    withOwnRole: (staff ?? []).filter((m) => m.role !== 'owner' && roleOf(m, roles)).length,
  }
}
