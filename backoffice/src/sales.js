import { supabase } from './supabase'
// Чистые правила отчётности — в отдельном модуле под тесты
export {
  previousRange, previousName, PREVIOUS_LABEL, delta, rangeLabel, scopeLine,
  locationsSummary, channelLabel, orderTypeLabel, salesToCsv, salesFileName,
} from './reporting'

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
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
  { key: 'custom', label: 'Dates' },
]

export function startOfDay(offsetDays = 0) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + offsetDays)
  return d
}

/**
 * Диапазон [from, to). Месяц и год — КАЛЕНДАРНЫЕ: месяц с 1-го по последнее
 * число текущего месяца, год с 1 января по 31 декабря (а не скользящее окно
 * в 30/365 дней). Для custom — по выбранным датам (to эксклюзивна).
 */
export function periodRange(period, custom) {
  const now = new Date()
  if (period === 'today') return { from: startOfDay(0), to: startOfDay(1) }
  if (period === '7d') return { from: startOfDay(-6), to: startOfDay(1) }
  if (period === 'month') {
    return {
      from: new Date(now.getFullYear(), now.getMonth(), 1),
      to: new Date(now.getFullYear(), now.getMonth() + 1, 1),
    }
  }
  if (period === 'year') {
    return {
      from: new Date(now.getFullYear(), 0, 1),
      to: new Date(now.getFullYear() + 1, 0, 1),
    }
  }
  if (period === 'custom' && custom?.from && custom?.to) {
    const from = new Date(`${custom.from}T00:00:00`)
    const to = new Date(`${custom.to}T00:00:00`)
    to.setDate(to.getDate() + 1) // включительно по выбранный день
    return { from, to }
  }
  return { from: startOfDay(-6), to: startOfDay(1) }
}

/**
 * Как рисовать график: по часам (сегодня), по дням (неделя, календарный
 * месяц), по месяцам (календарный год и длинные custom-диапазоны).
 * Внимание: период 'month' рисуется в режиме 'day' — это дни месяца.
 */
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

/**
 * Аргументы RPC отчёта. Вынесены из запроса, чтобы охват проверялся
 * тестом, а не глазами: пустой список точек обязан уходить как NULL —
 * сервер понимает это как «все точки» (133), а пустой массив вернул бы
 * отчёт ни по чему.
 */
export function salesParams(from, to, { locationIds = [], tz } = {}) {
  const zone = tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jerusalem'
  return {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_tz: zone,
    // Владельца бэкофиса сервер узнаёт по членству (089) — токен не нужен
    p_staff_session: null,
    p_location_ids: locationIds.length ? locationIds : null,
  }
}

/**
 * Отчёт за период. Охват по точкам считает сервер (133): пустой список
 * означает «все точки», и это же он потом называет в блоке scope.
 */
export async function fetchSalesReport(from, to, options = {}) {
  const { data, error } = await supabase.rpc('sales_report', salesParams(from, to, options))
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

/** Название графика — это и есть его режим. */
export function chartTitle(mode) {
  if (mode === 'hour') return 'By hour'
  if (mode === 'month') return 'By month'
  return 'By day'
}

/**
 * Шкала графика: отметки от нуля до «круглой» верхней границы.
 *
 * Без неё столбик отвечал только на вопрос «больше или меньше соседнего»:
 * высота считалась от максимума, и любой день, даже самый тихий,
 * упирался в потолок. Верхняя отметка НЕ МЕНЬШЕ максимума, шаг — 1, 2,
 * 2.5 или 5 в ближайшем порядке, и не мельче шекеля: подпись «12.5 ₪»
 * на оси читается хуже, чем сам столбик.
 */
export function chartScale(maxAmount, steps = 4) {
  const max = Number.isFinite(maxAmount) ? Math.max(maxAmount, 0) : 0
  if (max <= 0) return { top: 0, ticks: [] }
  const rough = max / Math.max(1, steps)
  const power = 10 ** Math.floor(Math.log10(rough))
  const norm = rough / power
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10
  const step = Math.max(100, Math.round(nice * power))
  const top = Math.ceil(max / step) * step
  const ticks = []
  for (let value = 0; value <= top; value += step) ticks.push(value)
  return { top, ticks }
}

/**
 * Доля столбика или полосы в процентах, 0..100.
 *
 * Ноль в знаменателе здесь не гипотетический: у способа оплаты сумма
 * складывается вместе с возвратами (133) и бывает нулевой и даже
 * отрицательной — деления на ноль и полосы отрицательной ширины быть не
 * должно.
 */
export function barShare(amount, top) {
  if (!(top > 0) || !(amount > 0)) return 0
  return Math.min(100, (amount / top) * 100)
}

/** «1 order» / «18 orders»: число само по себе не говорит, чего оно */
export function ordersLabel(count, unit = 'order') {
  const n = Number.isFinite(count) ? count : 0
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}
