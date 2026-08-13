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

/** Custom mode opens with a useful, visible range instead of empty fields. */
export function defaultAnalyticsDates(now = new Date()) {
  const from = new Date(now)
  from.setDate(from.getDate() - 29)
  return { from: iso(from), to: iso(now) }
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
  return defaultAnalyticsDates(now)
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

/**
 * Ниже этого числа сессий доля — не доля, а совпадение: одна бронь из
 * трёх открытий даёт «33 %», которые ничего не предсказывают.
 */
export const MIN_SESSIONS_FOR_RATE = 20

/**
 * КОНТРАКТ ВОРОНКИ.
 *
 * Единица — гостевая СЕССИЯ: анонимный uuid вкладки (`session_id`,
 * Kassa 124), а не клик, не посетитель и не заявка. Сервер (Kassa 125)
 * отдаёт по каждому шагу число РАЗНЫХ сессий, чьё событие попало в
 * период.
 *
 * Шаги упорядочены, и порядок — не оформительский, а фактический: чтобы
 * выбрать время, страницу надо открыть. Поэтому «дошло до шага k» — это
 * сессии, дошедшие до k ИЛИ ДАЛЬШЕ. Такой счёт даёт всем шагам ОДНУ
 * когорту и один знаменатель.
 *
 * Зачем это нужно. Событие верхнего шага законно может не попасть в
 * период:
 *   * вкладку открыли вчера, а время выбрали сегодня — `page_view` лежит
 *     за границей окна;
 *   * после отправленной заявки страница начинает вторую воронку с новой
 *     сессией, а страницу заново никто не открывал;
 *   * событие не доехало: телеметрия уходит фоном и молча проглатывает
 *     ошибки сети — это её правило (бронь важнее отчёта), и менять его
 *     ради отчёта нельзя.
 *
 * Раньше доля считалась как «шаг ÷ page_view», и в этих случаях выходило
 * «2 из 1» — 200 %. Обрезать 200 % до 100 % нельзя: неверно не
 * отображение, а знаменатель. Здесь чинится знаменатель.
 *
 * Для старой схемы это НИЖНЯЯ оценка. Три сессии, каждая со своим
 * единственным шагом, дадут 1/1/1, хотя страницу открывали трижды.
 * Начиная с RPC 134 сервер отдаёт точную когорту с
 * `calculation_version: 2`; её монотонные значения проходят через этот
 * код без изменения. Восстановление остаётся совместимым fallback для
 * ещё не обновлённой схемы.
 */
export function funnelView(funnel) {
  const exact = Number(funnel?.calculation_version) >= 2
  const raw = FUNNEL_STEPS.map((step) => {
    const value = Number(funnel?.[step.key])
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 0
  })

  // Снизу вверх: на шаге k не может быть меньше сессий, чем на любом
  // из последующих.
  const reached = new Array(raw.length)
  let carry = 0
  for (let i = raw.length - 1; i >= 0; i -= 1) {
    carry = Math.max(carry, raw[i])
    reached[i] = carry
  }

  const top = reached[0] ?? 0
  const repaired = raw.some((value, i) => value !== reached[i])
  const enough = top >= MIN_SESSIONS_FOR_RATE
  const rows = FUNNEL_STEPS.map((step, i) => ({
    key: step.key,
    label: step.label,
    value: reached[i],
    reported: raw[i],
    // Ширина полосы — про сравнение шагов между собой, её рисуем всегда.
    // Процент — утверждение о конверсии, и он появляется только когда
    // выборка его выдерживает.
    share: top > 0 ? Math.round((reached[i] / top) * 100) : 0,
    rate: top > 0 && enough ? Math.round((reached[i] / top) * 100) : null,
  }))

  return {
    rows,
    top,
    exact,
    repaired,
    enough,
    booked: reached[reached.length - 1] ?? 0,
    conversion: rows[rows.length - 1]?.rate ?? null,
  }
}

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

/**
 * Возврат когорты — доля от СОЗРЕВШЕЙ базы.
 *
 * Гость, впервые пришедший вчера, не «не вернулся за 90 дней»: у него
 * ещё 89. Делить по всем гостям периода значит занижать возврат тем
 * сильнее, чем свежее период — и владелец сделает вывод об обратном.
 *
 * Пустая созревшая база даёт null, а не ноль: «нет данных» и «никто не
 * вернулся» — разные ответы (то же правило, что у конверсии в 125).
 */
export async function fetchRetention(locationIds, from, to) {
  const { data, error } = await supabase.rpc('guest_retention_analytics_web', {
    p_location_ids: locationIds && locationIds.length ? locationIds : null,
    p_from: from,
    p_to: to,
  })
  if (error) throw new Error(error.message)
  return data
}

export function returnRate(window) {
  const mature = Number(window?.mature) || 0
  if (mature <= 0) return null
  return (Number(window?.returned) || 0) / mature
}

/** Сколько гостей когорты ещё не прожили окно — это надо назвать */
export function immature(cohortSize, window) {
  return Math.max(0, (Number(cohortSize) || 0) - (Number(window?.mature) || 0))
}

/** Новые против вернувшихся — доля новых среди гостей периода */
export function newShare(guests) {
  const total = Number(guests?.total) || 0
  if (total <= 0) return null
  return (Number(guests?.new) || 0) / total
}
