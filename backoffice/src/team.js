import { supabase } from './supabase'
// Чистые правила команды и доступа — в отдельном модуле под тесты
export {
  ROLES, ROLE_LABELS, isValidPin,
  PERM_KEYS, PERM_DEFAULTS, PERM_LABELS, PERM_HINTS, permLevel,
  can, roleOf, accessRows, accessSource, accessScope, accessSummary,
  rolesAllowing, roleHolders,
  locationLabel, roleTitle, lastShiftLabel, daysBetween,
  SHIFT_WINDOW_DAYS, shiftIndex, statusOf, personRowLabel,
  sortRoster, filterRoster,
  TABS, resolveTab, staffErrorText, hasRecords,
} from './roster'

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

/**
 * Патч карточки: имя, роль, is_active, role_id. Шлём только изменённые
 * поля — allow-лист сервера (093/094) ровно этот, точку он не принимает.
 */
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
 * Удаление доступно только сотруднику без истории — аудит-трейл
 * неприкосновенен. Сервер отвечает 'staff has records'; разбор кода и
 * текст для человека — в `roster.js`.
 */
export async function deleteStaff(staffId) {
  const { error } = await supabase.rpc('delete_staff', {
    p_staff_id: staffId,
    p_staff_session: null,
  })
  if (error) throw new Error(error.message)
}

// ── Кастомные роли (094) ─────────────────────────────────────

/**
 * Роль — именованный набор прав. Для своего носителя набор
 * ИСЧЕРПЫВАЮЩИЙ: не отмеченное в роли запрещено, даже если точка
 * разрешает это всем (`can` в roster.js, `require_staff_perm` на сервере).
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
