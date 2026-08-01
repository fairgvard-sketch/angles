import { supabase } from './supabase'

/**
 * Отчёт по броням (Kassa 125). Одна RPC на весь экран: считать конверсию
 * и загрузку на клиенте нельзя — сырых событий он не видит, да и правила
 * должны жить в одном месте.
 *
 * ВАЖНО про две оси времени. Воронка и оформления считаются по моменту
 * ДЕЙСТВИЯ гостя, визиты и загрузка — по моменту ВИЗИТА. Сервер помечает
 * ось в поле `basis` каждого блока, и экран обязан подписывать её гостю:
 * «12 броней» за неделю по одной оси и по другой — разные числа, и
 * владелец имеет право знать, какое из них видит.
 */

export const PERIODS = [
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'month', label: 'Month' },
  { key: 'custom', label: 'Dates' },
]

const iso = (d) => {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

/** Диапазон ВКЛЮЧИТЕЛЬНО по обе даты — так его принимает RPC. */
export function analyticsRange(period, custom) {
  const now = new Date()
  const shifted = (days) => {
    const d = new Date()
    d.setDate(d.getDate() + days)
    return d
  }
  if (period === '7d') return { from: iso(shifted(-6)), to: iso(now) }
  if (period === 'month') {
    return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) }
  }
  if (period === 'custom' && custom?.from && custom?.to) {
    return { from: custom.from, to: custom.to }
  }
  return { from: iso(shifted(-29)), to: iso(now) }
}

/** `locationIds` пуст = все точки организации (сетевой разрез). */
export async function fetchReserveAnalytics(locationIds, from, to) {
  const { data, error } = await supabase.rpc('reserve_analytics_web', {
    p_location_ids: locationIds && locationIds.length > 0 ? locationIds : null,
    p_from: from,
    p_to: to,
  })
  if (error) throw new Error(error.message)
  return data
}

export const FUNNEL_STEPS = [
  { key: 'page_view', label: 'Opened the page' },
  { key: 'availability', label: 'Checked availability' },
  { key: 'slot_selected', label: 'Picked a time' },
  { key: 'form_started', label: 'Started the form' },
  { key: 'submitted', label: 'Booked' },
]

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Проценты показываем только когда знаменатель не ноль (сервер шлёт null). */
export const pct = (value) => (value === null || value === undefined ? '—' : `${value}%`)

export const hours = (value) =>
  value === null || value === undefined ? '—' : `${Number(value).toLocaleString('en-GB')} h`

/** «2 ч 30 мин» из минут: часы читаются, а «150 минут» — нет. */
export function leadTime(minutes) {
  if (minutes === null || minutes === undefined) return '—'
  const m = Math.round(Number(minutes))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 48) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
  return `${Math.round(h / 24)} days`
}

export function analyticsErrorText(message) {
  const m = String(message || '')
  if (m.includes('module_disabled')) return 'The Reserve product is not active for this account.'
  if (m.includes('backoffice access denied')) return 'Only an owner or a manager can see reports.'
  if (m.includes('range_too_wide')) return 'Pick a shorter period — up to about a year.'
  if (m.includes('invalid_range')) return 'The start date must come before the end date.'
  return m
}
