import { supabase } from './supabase'

/**
 * Отчёт «Продажи» для владельца. Данные те же, что видит касса
 * (RPC sales_report), но право подтверждает членство в бэкофисе (089),
 * а не PIN-сессия: в вебе сотрудника за кассой нет.
 *
 * Деньги приходят целыми агоротами и такими же остаются до вывода —
 * инвариант кассы: во float их переводит только форматирование.
 */

export const PERIODS = ['today', 'yesterday', '7d']

export function startOfDay(offsetDays = 0) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + offsetDays)
  return d
}

export function periodRange(period) {
  if (period === 'today') return { from: startOfDay(0), to: startOfDay(1) }
  if (period === 'yesterday') return { from: startOfDay(-1), to: startOfDay(0) }
  return { from: startOfDay(-6), to: startOfDay(1) } // 7 дней включая сегодня
}

export function formatMoney(agorot) {
  const value = (agorot ?? 0) / 100
  return `${value.toLocaleString('he-IL', {
    minimumFractionDigits: (agorot ?? 0) % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })} ₪`
}

const METHOD_LABELS = {
  cash: 'Cash',
  card: 'Card',
  cibus: 'Cibus',
  tenbis: '10bis',
  bit: 'Bit',
}

export function methodLabel(method) {
  return METHOD_LABELS[method] || method
}

export async function fetchSalesReport(from, to) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jerusalem'
  const { data, error } = await supabase.rpc('sales_report', {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_tz: tz,
    // Владельца бэкофиса сервер узнаёт по членству (089) — токен не нужен
    p_staff_session: null,
  })
  if (error) throw new Error(error.message)
  return data
}

/** Часы min..max с заполнением пропусков нулями (ось непрерывна) */
export function hourBars(report) {
  const rows = report?.by_hour || []
  if (rows.length === 0) return []
  const byHour = new Map(rows.map((h) => [h.hour, h]))
  const min = Math.min(...rows.map((h) => h.hour))
  const max = Math.max(...rows.map((h) => h.hour))
  const bars = []
  for (let h = min; h <= max; h++) {
    const row = byHour.get(h)
    bars.push({
      key: String(h),
      label: String(h),
      full: `${String(h).padStart(2, '0')}:00–${String(h + 1).padStart(2, '0')}:00`,
      amount: row?.amount ?? 0,
      count: row?.count ?? 0,
    })
  }
  return bars
}

export function dayBars(report) {
  return (report?.by_day || []).map((d) => {
    const date = new Date(`${d.day}T00:00:00`)
    return {
      key: d.day,
      label: date.toLocaleDateString('en-GB', { weekday: 'short' }),
      full: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', weekday: 'long' }),
      amount: d.amount,
      count: d.count,
    }
  })
}
