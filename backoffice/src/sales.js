import { supabase } from './supabase'

/**
 * Отчёт «Продажи» для владельца. Данные те же, что видит касса
 * (RPC sales_report), но право подтверждает членство в бэкофисе (089),
 * а не PIN-сессия: в вебе сотрудника за кассой нет.
 *
 * Деньги приходят целыми агоротами и такими же остаются до вывода —
 * инвариант кассы: во float их переводит только форматирование.
 */

export const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'year', label: 'Year' },
  { key: 'custom', label: 'Dates' },
]

export function startOfDay(offsetDays = 0) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + offsetDays)
  return d
}

/** Диапазон [from, to). Для custom — по выбранным датам (to эксклюзивна). */
export function periodRange(period, custom) {
  if (period === 'today') return { from: startOfDay(0), to: startOfDay(1) }
  if (period === '7d') return { from: startOfDay(-6), to: startOfDay(1) }
  if (period === '30d') return { from: startOfDay(-29), to: startOfDay(1) }
  if (period === 'year') return { from: startOfDay(-364), to: startOfDay(1) }
  if (period === 'custom' && custom?.from && custom?.to) {
    const from = new Date(`${custom.from}T00:00:00`)
    const to = new Date(`${custom.to}T00:00:00`)
    to.setDate(to.getDate() + 1) // включительно по выбранный день
    return { from, to }
  }
  return { from: startOfDay(-6), to: startOfDay(1) }
}

/** Как рисовать график для периода: по часам (день), по дням, по месяцам (год). */
export function chartMode(period, custom) {
  if (period === 'today') return 'hour'
  if (period === 'year') return 'month'
  if (period === 'custom' && custom?.from && custom?.to) {
    const days = (new Date(custom.to) - new Date(custom.from)) / 86400000
    return days > 92 ? 'month' : 'day'
  }
  return 'day'
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

/**
 * Дни диапазона. Ось непрерывна: дни без продаж — пустые слоты, иначе
 * несколько торговых дней растянулись бы на всю ширину графика.
 */
export function dayBars(report, from, to) {
  const acc = new Map((report?.by_day || []).map((d) => [d.day, d]))
  if (!from || !to) {
    // Фолбэк на случай вызова без границ: только дни с данными
    return [...acc.values()].map((d) => {
      const date = new Date(`${d.day}T00:00:00`)
      return {
        key: d.day,
        label: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        full: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', weekday: 'long' }),
        amount: d.amount,
        count: d.count,
      }
    })
  }

  const bars = []
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const last = new Date(to.getTime() - 86400000) // to эксклюзивна
  let prevMonth = null
  while (cursor <= last) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    const d = acc.get(key)
    // Подпись короткая — только число: «14 Jul» для каждого дня не влезает
    // на телефоне. Месяц показываем один раз, на его первом дне в оси.
    const month = cursor.getMonth()
    const showMonth = month !== prevMonth
    prevMonth = month
    bars.push({
      key,
      label: showMonth
        ? cursor.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        : String(cursor.getDate()),
      full: cursor.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', weekday: 'long' }),
      amount: d?.amount ?? 0,
      count: d?.count ?? 0,
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  return bars
}

/**
 * Свод by_day в месяцы: сервер по месяцам не группирует, делаем на клиенте.
 *
 * Ось строится по ВСЕМУ запрошенному диапазону, а не по месяцам с продажами:
 * иначе единственный месяц растягивается на всю ширину. Месяцы без продаж
 * (прошедшие пустые и ещё не наступившие) остаются пустыми слотами — столбика
 * нет, но позиция на оси занята.
 */
export function monthBars(report, from, to) {
  const acc = new Map()
  for (const d of report?.by_day || []) {
    const key = d.day.slice(0, 7) // YYYY-MM
    const cur = acc.get(key) || { amount: 0, count: 0 }
    cur.amount += d.amount
    cur.count += d.count
    acc.set(key, cur)
  }

  const bars = []
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1)
  // to эксклюзивна: последний включённый месяц — тот, в котором лежит to-1 день
  const last = new Date(to.getTime() - 86400000)
  const end = new Date(last.getFullYear(), last.getMonth(), 1)

  while (cursor <= end) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
    const v = acc.get(key)
    bars.push({
      key,
      label: cursor.toLocaleDateString('en-GB', { month: 'short' }),
      full: cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
      amount: v?.amount ?? 0,
      count: v?.count ?? 0,
    })
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return bars
}

/** Выбор набора столбиков под режим графика. */
export function barsFor(mode, report, from, to) {
  if (mode === 'hour') return hourBars(report)
  if (mode === 'month') return monthBars(report, from, to)
  return dayBars(report, from, to)
}
