import { supabase } from './supabase'
import { formatMoney, methodLabel } from './sales'

/**
 * Лента активности кассы для дашборда. События (открытие/закрытие смены,
 * возврат) рождаются триггерами в БД (миграция 098) и читаются через
 * get_activity_feed — право подтверждает членство в бэкофисе, PIN не нужен.
 *
 * Деньги приходят целыми агоротами (инвариант кассы), formatMoney переводит
 * во float только для показа.
 */

export async function fetchActivity({ limit = 50, before = null, locationId = null } = {}) {
  const { data, error } = await supabase.rpc('get_activity_feed', {
    p_limit: limit,
    p_before: before,
    p_location_id: locationId,
    p_staff_session: null,
  })
  if (error) throw new Error(error.message)
  return data ?? []
}

export const TYPE_META = {
  shift_opened: { label: 'Shift opened', tone: 'open' },
  shift_closed: { label: 'Shift closed', tone: 'close' },
  refund_issued: { label: 'Refund', tone: 'refund' },
}

/** Заголовок строки: кто и что сделал */
export function eventTitle(e) {
  const who = e.staff_name || 'Staff'
  switch (e.type) {
    case 'shift_opened': return `${who} opened a shift`
    case 'shift_closed': return `${who} closed a shift`
    case 'refund_issued': return `${who} issued a refund`
    default: return who
  }
}

/** Правая часть: сумма/деталь события */
export function eventAmount(e) {
  switch (e.type) {
    case 'shift_opened':
      return e.amount ? `Float ${formatMoney(e.amount)}` : null
    case 'shift_closed':
      return e.amount != null ? formatMoney(e.amount) : null
    case 'refund_issued':
      return `−${formatMoney(e.amount)}`
    default: return null
  }
}

/** Подстрочник: расхождение кассы / способ возврата / причина */
export function eventDetail(e) {
  const d = e.detail || {}
  if (e.type === 'shift_closed') {
    const parts = []
    if (d.orders_count != null) parts.push(`${d.orders_count} orders`)
    if (d.cash_diff != null && d.cash_diff !== 0) {
      const sign = d.cash_diff > 0 ? '+' : '−'
      parts.push(`cash ${sign}${formatMoney(Math.abs(d.cash_diff))}`)
    }
    return parts.join(' · ') || null
  }
  if (e.type === 'refund_issued') {
    const parts = [methodLabel(d.method)]
    if (d.reason) parts.push(d.reason)
    return parts.filter(Boolean).join(' · ') || null
  }
  return null
}

/** Относительное время: 3m / 2h / 4d, иначе дата */
export function timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days}d`
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}
