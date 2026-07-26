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
