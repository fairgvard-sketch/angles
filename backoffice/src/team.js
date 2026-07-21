import { supabase } from './supabase'

/**
 * Команда в бэкофисе — паритет с кассовым разделом «Сотрудники».
 *
 * Запись идёт через те же RPC, что и в кассе (Kassa 093 сменила им гейт на
 * require_backoffice_or_staff): веб-владельца сервер узнаёт по членству,
 * PIN не нужен — поэтому p_staff_session всюду null.
 *
 * PIN не хранится и не читается клиентом: уходит в SECURITY DEFINER RPC,
 * bcrypt-хеш остаётся в БД (колонка pin_hash закрыта грантами).
 *
 * Права доступа (perms) живут в locations.settings и пишутся отдельным
 * patch_location_settings_web — см. settings.js.
 */

export const ROLES = ['barista', 'manager', 'owner']

export const ROLE_LABELS = {
  owner: 'Owner',
  manager: 'Manager',
  barista: 'Barista',
}

/** Правила PIN совпадают с серверными (create_staff/set_staff_pin). */
export function isValidPin(pin) {
  return /^\d{4,8}$/.test(pin)
}

// ── Чтение ───────────────────────────────────────────────────

/**
 * Список сотрудников организации. RLS скоупит по org из JWT; pin_hash не
 * запрашиваем — колоночных грантов на него нет.
 */
export async function fetchStaff() {
  const { data, error } = await supabase
    .from('staff')
    .select('id, name, role, is_active, location_id, created_at, role_id')
    .order('created_at')
  if (error) throw new Error(error.message)
  return data
}

// ── Запись ───────────────────────────────────────────────────

/**
 * Точка обязательна: в JWT веб-владельца location_id нет, сервер валидирует
 * принадлежность через assert_backoffice_location (091).
 */
export async function createStaff({ name, role, pin, locationId }) {
  const { data, error } = await supabase.rpc('create_staff', {
    p_name: name.trim(),
    p_role: role,
    p_pin: pin,
    p_location_id: locationId,
    p_staff_session: null,
  })
  if (error) throw new Error(error.message)
  return data
}

/** Патч карточки: имя, роль, is_active. Шлём только изменённые поля. */
export async function updateStaff(staffId, patch) {
  const { error } = await supabase.rpc('update_staff', {
    p_staff_id: staffId,
    p_patch: patch,
    p_staff_session: null,
  })
  if (error) throw new Error(error.message)
}

export async function setStaffPin(staffId, pin) {
  const { error } = await supabase.rpc('set_staff_pin', {
    p_staff_id: staffId,
    p_pin: pin,
    p_staff_session: null,
  })
  if (error) throw new Error(error.message)
}

/**
 * Удаление доступно только сотруднику без истории — аудит-трейл неприкосновенен.
 * Сервер отвечает 'staff has records'; помечаем ошибку флагом, чтобы UI
 * предложил деактивацию вместо удаления (как в кассе).
 */
export async function deleteStaff(staffId) {
  const { error } = await supabase.rpc('delete_staff', {
    p_staff_id: staffId,
    p_staff_session: null,
  })
  if (error) {
    const failure = new Error(error.message)
    failure.hasRecords = /staff has records/i.test(error.message)
    throw failure
  }
}

// ── Права доступа (locations.settings.perms) ─────────────────

/**
 * Ключи и дефолты повторяют src/lib/perms.ts кассы. Дефолты — поведение до
 * миграции 036; при расхождении источник истины там.
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

export function permLevel(settings, key) {
  return settings?.perms?.[key] ?? PERM_DEFAULTS[key]
}

// ── Кастомные роли (094) ─────────────────────────────────────

/**
 * Роль — именованный набор прав поверх базового уровня, а не замена
 * owner/manager/barista. У сотрудника без роли (`role_id: null`) права
 * считаются по-старому: настройки точки + базовая роль.
 *
 * 'manage' (управление командой) в набор не входит — сервер его вырезает,
 * иначе носитель роли выдал бы себе любые права.
 */

export async function fetchRoles() {
  const { data, error } = await supabase
    .from('roles')
    .select('id, name, base, perms, created_at')
    .order('created_at')
  if (error) throw new Error(error.message)
  return data
}

export async function saveRole({ id, name, base, perms }) {
  const { data, error } = await supabase.rpc('save_role', {
    p_name: name.trim(),
    p_base: base,
    p_perms: perms,
    p_role_id: id ?? null,
    p_staff_session: null,
  })
  if (error) throw new Error(error.message)
  return data
}

/** Носители роли не теряют доступ: role_id обнуляется, база сохраняется. */
export async function deleteRole(roleId) {
  const { error } = await supabase.rpc('delete_role', {
    p_role_id: roleId,
    p_staff_session: null,
  })
  if (error) throw new Error(error.message)
}
