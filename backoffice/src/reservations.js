import { supabase } from './supabase'

/**
 * Веб-стол хостес (Kassa 102): полный цикл брони без POS.
 *
 * Чтение — прямой select под RLS членства (политика 053, JWT org_id),
 * запись — только RPC set_reservation_status_web (owner/manager,
 * модуль reservations; посаженные на кассе брони с order_id сервер
 * не отдаёт под запись — pos_mode).
 */

export const RESERVATION_STATUS_LABELS = {
  new: 'New',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  completed: 'Completed',
  no_show: 'No-show',
}

/** Кнопки — зеркало переходов set_reservation_status_web. */
export const RESERVATION_ACTIONS = {
  new: [
    { to: 'confirmed', label: 'Confirm', tone: 'primary' },
    { to: 'rejected', label: 'Reject', tone: 'danger' },
  ],
  confirmed: [
    { to: 'completed', label: 'Completed', tone: 'primary' },
    { to: 'no_show', label: 'No-show' },
    { to: 'cancelled', label: 'Cancel', tone: 'danger' },
  ],
}

const SELECT_COLUMNS =
  'id, status, customer_name, customer_phone, party_size, reserved_at, duration_min, note, reject_reason, order_id, table_id, created_at'

/**
 * Актив: заявки new + подтверждённые визиты от начала сегодняшнего дня
 * (прошедшие confirmed остаются видимыми — хостес закрывает их
 * completed/no_show). История — последние решённые.
 */
export async function fetchReservations(locationId) {
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const [active, history] = await Promise.all([
    supabase
      .from('reservations')
      .select(SELECT_COLUMNS)
      .eq('location_id', locationId)
      .in('status', ['new', 'confirmed'])
      .gte('reserved_at', dayStart.toISOString())
      .order('reserved_at', { ascending: true }),
    supabase
      .from('reservations')
      .select(SELECT_COLUMNS)
      .eq('location_id', locationId)
      .in('status', ['completed', 'no_show', 'rejected', 'cancelled'])
      .order('reserved_at', { ascending: false })
      .limit(20),
  ])
  if (active.error) throw active.error
  if (history.error) throw history.error
  return { active: active.data ?? [], history: history.data ?? [] }
}

export async function setReservationStatus(locationId, id, status, reason = null) {
  const { data, error } = await supabase.rpc('set_reservation_status_web', {
    p_location_id: locationId,
    p_id: id,
    p_status: status,
    p_reason: reason,
  })
  if (error) throw error
  return data
}

const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

export function visitLabel(iso) {
  const date = new Date(iso)
  const now = new Date()
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (sameDay(date, now)) return `Today · ${time}`
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  if (sameDay(date, tomorrow)) return `Tomorrow · ${time}`
  return `${date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} · ${time}`
}

// ── Таймлайн хостес (Kassa 119/120) ──────────────────────────

/**
 * Брони суток для полотна. Берём с запасом в сутки назад: ночная смена
 * начинается вчера, а фильтровать по концу визита через PostgREST нельзя —
 * длительность у каждой брони своя. Лишнее отсечёт раскладка по окну дня.
 *
 * `reservation_tables` (119) — источник занятости: столы объединения
 * приходят строками, а не разбором массива на клиенте.
 */
export async function fetchTimelineReservations(locationId, fromMs, toMs) {
  const { data, error } = await supabase
    .from('reservations')
    .select(
      'id, status, customer_name, customer_phone, party_size, reserved_at, '
      + 'duration_min, note, order_id, arrived_at, table_id, hold_table_ids, zone_id, '
      + 'tables_link:reservation_tables ( table_id, is_primary )'
    )
    .eq('location_id', locationId)
    .gte('reserved_at', new Date(fromMs - 24 * 3600_000).toISOString())
    .lt('reserved_at', new Date(toMs).toISOString())
    .order('reserved_at', { ascending: true })
    .limit(500)
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Столы и зоны точки для строк полотна */
export async function fetchTimelineTables(locationId) {
  const [tables, zones] = await Promise.all([
    supabase.from('tables')
      .select('id, label, seats, zone_id, sort_order, is_active, status')
      .eq('location_id', locationId)
      .order('sort_order'),
    supabase.from('table_zones')
      .select('id, name, sort_order')
      .eq('location_id', locationId).eq('is_active', true)
      .order('sort_order'),
  ])
  if (tables.error) throw new Error(tables.error.message)
  if (zones.error) throw new Error(zones.error.message)
  const zoneName = new Map((zones.data ?? []).map((z) => [z.id, z.name]))
  return (tables.data ?? []).map((t) => ({
    id: t.id,
    label: t.label,
    seats: t.seats ?? 2,
    zoneId: t.zone_id ?? null,
    zoneName: t.zone_id ? zoneName.get(t.zone_id) ?? null : null,
    sortOrder: t.sort_order ?? 0,
    blocked: !t.is_active || t.status === 'disabled',
  }))
}

/** Настройки брони точки — из них берётся окно дня */
export async function fetchReservationSettings(locationId) {
  const { data, error } = await supabase
    .from('locations')
    .select('timezone, rsv:settings->reservations')
    .eq('id', locationId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return {
    timezone: data?.timezone || 'Asia/Jerusalem',
    schedule: data?.rsv?.schedule ?? null,
  }
}

/** Назначить / объединить / разъединить столы визита (120) */
export async function setReservationTables(locationId, id, tableIds) {
  const { error } = await supabase.rpc('set_reservation_tables_web', {
    p_location_id: locationId,
    p_id: id,
    p_table_ids: tableIds,
  })
  if (error) throw new Error(error.message)
}

/** Отметить посадку гостя без POS-заказа (120) */
export async function markReservationArrived(locationId, id) {
  const { error } = await supabase.rpc('mark_reservation_arrived_web', {
    p_location_id: locationId,
    p_id: id,
  })
  if (error) throw new Error(error.message)
}

/** Человеческий текст ошибок стола хостес */
export function deskErrorText(message) {
  const m = String(message || '')
  if (m.includes('pos_mode')) return 'This booking is seated into a POS order — it is handled on the register.'
  if (m.includes('table_busy')) return 'That table is taken for this time — pick another.'
  if (m.includes('not_active')) return 'This booking is no longer active.'
  if (m.includes('not_confirmed')) return 'Confirm the booking before seating the guest.'
  if (m.includes('module_disabled')) return 'The Reserve product is not active for this account.'
  return m
}

// ── Лист ожидания (Kassa 122) ────────────────────────────────

/** Записи листа: ждущие и те, кому уже отправлено предложение */
export async function fetchWaitlist(locationId) {
  const { data, error } = await supabase
    .from('waitlist_entries')
    .select('id, customer_name, customer_phone, party_size, wanted_date, '
      + 'time_from, time_to, zone_ids, note, status, offer_at, offer_expires, created_at')
    .eq('location_id', locationId)
    .in('status', ['waiting', 'offered'])
    .order('created_at')
  if (error) throw new Error(error.message)
  return data ?? []
}

/**
 * Кого можно позвать на освободившееся время. Сервер проверяет не только
 * пожелание гостя, но и реальную возможность посадить: предлагать слот,
 * на который нет стола, значит обмануть дважды.
 */
export async function fetchWaitlistMatches(locationId, atIso) {
  const { data, error } = await supabase.rpc('waitlist_matches', {
    p_location_id: locationId,
    p_at: atIso,
  })
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Отправить предложение на время. Стол не резервируется (Kassa 122). */
export async function offerWaitlistSlot(id, atIso, ttlMin = 30) {
  const { data, error } = await supabase.rpc('offer_waitlist_slot', {
    p_id: id,
    p_at: atIso,
    p_ttl_min: ttlMin,
  })
  if (error) throw new Error(error.message)
  return data
}

/** Разослать просьбы подтвердить приход по броням ближайшего окна */
export async function requestConfirmations(locationId) {
  const { data, error } = await supabase.rpc('request_reservation_confirmations', {
    p_location_id: locationId,
  })
  if (error) throw new Error(error.message)
  return data ?? 0
}
