/**
 * Правила клиентской базы — чистые функции без сети.
 *
 * Сегменты, выгрузка, разбор меток и человеческие тексты ошибок решают,
 * сможет ли владелец работать с базой, а не только смотреть на неё.
 * Всё это проверяется тестами, а не взглядом на прод.
 */

// ── Формат ───────────────────────────────────────────────────

/**
 * Деньги приходят целыми агоротами (инвариант кассы) — форматируем в ₪.
 *
 * Разряды разделены, как в заказах и отчётах: «₪1284.50» в колонке сумм
 * читается как «₪128450», и глазу приходится считать нули. Формат
 * создаётся один раз: в списке на 200 строк он вызывается сотни раз.
 */
const MONEY = (() => {
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency', currency: 'ILS', currencyDisplay: 'narrowSymbol',
    })
  } catch {
    return null
  }
})()

export function formatMoney(agorot) {
  const value = (agorot ?? 0) / 100
  return MONEY ? MONEY.format(value) : `₪${value.toFixed(2)}`
}

/** Телефон хранится одними цифрами: 0501234567 → 050-123-4567 */
export function formatPhone(digits) {
  if (!digits) return ''
  return digits.length === 10
    ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
    : digits
}

/** Ввод телефона нормализуем так же, как сервер: ключ узнавания один */
export function normalizePhoneInput(value) {
  return String(value ?? '').replace(/\D/g, '')
}

/** «Последний визит»: Today / 3d ago / 2mo ago */
export function lastVisitLabel(iso) {
  if (!iso) return 'Never'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

export function formatDateTime(iso) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

/** «4 visits» / «1 visit» — единица нужна там, где нет шапки колонки */
export function visitsLabel(visits) {
  const n = visits ?? 0
  return `${n} visit${n === 1 ? '' : 's'}`
}

// ── Лояльность ───────────────────────────────────────────────

function stampsLabel(stamps) {
  const n = stamps ?? 0
  return `${n} stamp${n === 1 ? '' : 's'}`
}

/**
 * Баланс строки списка. Программа бывает в двух режимах, и цифра без
 * названия врёт: 3 — это три штампа или ₪0.03?
 *
 * Режим знает только сервер и отдаёт его в карточке гостя (115), а список
 * приходит раньше первой открытой карточки. До этого показываем то, что
 * ненулевое: штампы у точки со штампами, баллы у точки с баллами.
 * Жёстко зашивать баллы по картинке макета нельзя — точка со штампами
 * увидела бы «₪0.00» на всей базе.
 */
export function loyaltyLabel(guest, mode) {
  const stamps = guest?.stamps ?? 0
  const points = guest?.points ?? 0
  if (mode === 'stamps') return stampsLabel(stamps)
  if (mode === 'points') return `Points ${formatMoney(points)}`
  return stamps > 0 ? stampsLabel(stamps) : `Points ${formatMoney(points)}`
}

/**
 * Доступное имя строки клиента.
 *
 * Строка — одна кнопка, и её `aria-label` заменяет читалке ВСЁ
 * содержимое: числа из ячеек до скринридера не доходят. Поэтому имя
 * называет то же, что видит глаз, — иначе список для читалки состоит из
 * двухсот безымянных «Open».
 */
export function guestRowLabel(guest, mode) {
  const phone = formatPhone(guest?.phone)
  const parts = [guest?.name || phone]
  if (guest?.name && phone) parts.push(phone)
  parts.push(loyaltyLabel(guest, mode))
  parts.push(visitsLabel(guest?.visits))
  parts.push(`${formatMoney(guest?.total_spent)} spent`)
  parts.push(`last visit ${lastVisitLabel(guest?.last_visit_at).toLowerCase()}`)
  if (guest?.tags?.length) parts.push(`tagged ${guest.tags.join(', ')}`)
  return `Open ${parts.join(' · ')}`
}

// ── Сегменты ─────────────────────────────────────────────────

/**
 * Готовые срезы базы. Считает их СЕРВЕР (131): фильтр по загруженной
 * странице отвечал бы на вопрос «кто из первых двухсот», а не «кто».
 */
export const SEGMENTS = [
  { key: 'all', label: 'Everyone', params: {} },
  {
    key: 'regulars',
    label: 'Regulars',
    hint: '3 visits or more',
    params: { p_min_visits: 3 },
  },
  {
    key: 'top',
    label: 'Top spenders',
    hint: '₪200 and up',
    params: { p_min_spent: 20000 },
  },
  {
    key: 'recent',
    label: 'Seen this month',
    hint: 'Last 30 days',
    params: { p_seen_days: 30 },
  },
  {
    key: 'lapsed',
    label: 'Lapsed',
    hint: 'Came before, not in 90 days',
    params: { p_inactive_days: 90 },
  },
]

export const SORTS = [
  { key: 'recent', label: 'Last visit' },
  { key: 'spend', label: 'Total spent' },
  { key: 'visits', label: 'Visits' },
  { key: 'new', label: 'Newest' },
  { key: 'name', label: 'Name' },
]

/**
 * Сколько строк отдаёт сервер за раз (131). Клиентской «страницы» нет:
 * листать нечем, пока RPC не умеет курсор, — поэтому счётчик над списком
 * честно говорит «первые 200», а не выдумывает размер базы.
 */
export const ROW_LIMIT = 200

/** Аргументы RPC из состояния фильтров. Пустые значения не отправляем. */
export function segmentParams({
  search = '', segment = 'all', tags = [], sort = 'recent', limit = ROW_LIMIT,
} = {}) {
  const preset = SEGMENTS.find((s) => s.key === segment) ?? SEGMENTS[0]
  return {
    p_search: search.trim() || null,
    p_limit: limit,
    // Владельца бэкофиса сервер узнаёт по членству (114) — токен не нужен
    p_staff_session: null,
    p_tags: tags.length ? tags : null,
    p_min_visits: null,
    p_min_spent: null,
    p_seen_days: null,
    p_inactive_days: null,
    ...preset.params,
    p_sort: sort,
  }
}

/** Описание активного среза для заголовка списка */
export function segmentSummary({ segment = 'all', tags = [], search = '' } = {}) {
  const parts = []
  const preset = SEGMENTS.find((s) => s.key === segment)
  if (preset && preset.key !== 'all') parts.push(preset.label.toLowerCase())
  if (tags.length) parts.push(`tagged ${tags.join(' + ')}`)
  if (search.trim()) parts.push(`matching “${search.trim()}”`)
  if (!parts.length) return 'Most recent visitors first.'
  return `Showing ${parts.join(', ')}.`
}

/**
 * Счётчик над списком. Считает ЗАГРУЖЕННЫЕ строки, а не базу: сервер
 * отдаёт срез, и «128 customers» рядом с фильтром означает «столько
 * сейчас на экране». На пределе выборки это сказано словами.
 */
export function loadedCountLabel(total, limit = ROW_LIMIT) {
  const n = total ?? 0
  if (n === 0) return 'No customers'
  const word = n === 1 ? 'customer' : 'customers'
  return n >= limit ? `First ${n} ${word}` : `${n} ${word}`
}

// ── Метки ────────────────────────────────────────────────────

export const TAG_LIMIT = 12
export const TAG_MAX_LENGTH = 24

/**
 * Оттенок метки. Одна и та же метка обязана выглядеть одинаково в строке,
 * в фильтре и в профиле, а «случайный» цвет при каждом рендере превращал
 * бы список в новогоднюю гирлянду — поэтому оттенок вычисляется из самого
 * слова. Их четыре, все бледные: метка — подпись, а не состояние.
 */
export const TAG_TONES = 4

export function tagTone(tag) {
  const text = String(tag ?? '')
  let sum = 0
  for (let i = 0; i < text.length; i += 1) sum = (sum * 31 + text.charCodeAt(i)) % 9973
  return sum % TAG_TONES
}

/**
 * Метки из строки: запятая или перевод строки. Обрезаем, снимаем дубли и
 * держим тот же потолок, что сервер (131) — иначе кабинет пообещал бы
 * больше, чем примет база.
 */
export function parseTagsInput(value) {
  const seen = new Set()
  const out = []
  for (const raw of String(value ?? '').split(/[,\n]/)) {
    const tag = raw.trim().slice(0, TAG_MAX_LENGTH)
    if (!tag) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
    if (out.length >= TAG_LIMIT) break
  }
  return out
}

// ── Выгрузка ─────────────────────────────────────────────────

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Дата в зоне точки: выгрузка без зоны сдвигает визиты на день */
function csvDate(iso, timeZone) {
  if (!iso) return ''
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(iso))
  } catch {
    return new Date(iso).toISOString().slice(0, 10)
  }
}

/**
 * CSV текущего среза. Валюта и часовой пояс стоят в заголовках колонок:
 * файл уезжает из кабинета и должен объяснять себя сам.
 */
export function guestsToCsv(rows, { timeZone = 'Asia/Jerusalem' } = {}) {
  const header = [
    'Name', 'Phone', 'Visits', 'Total spent (ILS)', 'Points (ILS)', 'Stamps',
    `Last visit (${timeZone})`, `Customer since (${timeZone})`, 'Tags', 'Notes',
  ]
  const lines = [header.join(',')]
  for (const g of rows ?? []) {
    lines.push([
      csvCell(g.name ?? ''),
      csvCell(g.phone ?? ''),
      csvCell(g.visits ?? 0),
      csvCell(((g.total_spent ?? 0) / 100).toFixed(2)),
      csvCell(((g.points ?? 0) / 100).toFixed(2)),
      csvCell(g.stamps ?? 0),
      csvCell(csvDate(g.last_visit_at, timeZone)),
      csvCell(csvDate(g.created_at, timeZone)),
      csvCell((g.tags ?? []).join(' | ')),
      csvCell(g.notes ?? ''),
    ].join(','))
  }
  // CRLF: Excel на Windows иначе склеивает строки
  return lines.join('\r\n')
}

export function csvFileName(date = new Date()) {
  return `customers-${date.toISOString().slice(0, 10)}.csv`
}

// ── Дубли и слияние ──────────────────────────────────────────

/** Почему запись попала в подсказку — владельцу решать, тот ли это человек */
export function duplicateReason(group) {
  return group?.reason === 'phone'
    ? 'Same number written two ways'
    : 'Same name, different numbers'
}

/**
 * Что именно произойдёт при слиянии. Показывается ДО нажатия: перенос
 * истории обратим только через журнал, и владелец должен понимать объём.
 */
export function mergePreview(target, source) {
  if (!target || !source) return ''
  const visits = (target.visits ?? 0) + (source.visits ?? 0)
  const spent = (target.total_spent ?? 0) + (source.total_spent ?? 0)
  const name = target.name || formatPhone(target.phone)
  return `Everything from ${source.name || formatPhone(source.phone)} moves to ${name}: `
    + `${visits} visits and ${formatMoney(spent)} in total. `
    + `Tags and notes of both profiles are combined, and the old number keeps `
    + `working — it will lead to this profile.`
}

/**
 * Текст последнего шага слияния.
 *
 * Он обязан назвать ОБЕ стороны: что останется и что исчезнет из
 * списков. Слияние не удаляет исходный профиль (он становится
 * указателем на объединённый), но вернуть его кнопкой нельзя — и об
 * этом говорим прямо, а не «действие необратимо».
 */
export function mergeConfirmText(target, sources) {
  if (!target || !(sources ?? []).length) return ''
  const keep = `${target.name || formatPhone(target.phone)} · ${formatPhone(target.phone)}`
  const gone = sources.map((g) => g.name || formatPhone(g.phone)).join(', ')
  return `Keeping: ${keep}. Disappearing from the list: ${gone}. `
    + 'Visits, spend, points, notes and tags move over; the old numbers keep '
    + 'leading to this profile. This cannot be undone from the back office.'
}

/** Кандидаты группы, кроме выбранного основным */
export function mergeSources(group, targetId) {
  return (group?.guests ?? []).filter((g) => g.id !== targetId)
}

// ── Ошибки ───────────────────────────────────────────────────

/**
 * Коды сервера (131) → человеческий текст. Сопоставление ТОЧНОЕ по коду:
 * подстрока однажды уже подменила специфичный код общим, и владелец видел
 * не ту причину отказа.
 */
const ERRORS = {
  phone_taken: 'Another customer already has this number. Merge the two profiles instead.',
  phone_invalid: 'That does not look like a phone number.',
  too_many_tags: `Up to ${TAG_LIMIT} tags per customer.`,
  guest_merged: 'This profile has been merged into another one — refresh the list.',
  guest_anonymized: 'This customer’s personal data was erased and cannot be edited.',
  already_anonymized: 'This customer’s personal data has already been erased.',
  same_guest: 'Pick two different profiles to merge.',
  confirm_mismatch: 'The phone number does not match this customer.',
  has_upcoming_reservation: 'This customer has an upcoming booking. Cancel it first, then erase the data.',
  'guest not found': 'This customer is no longer in your organisation — refresh the list.',
  'staff session required': 'Your role cannot change customers.',
}

export function customerErrorText(message) {
  const text = String(message || '')
  // Длинные коды первыми: 'already_anonymized' содержит 'anonymized'
  const code = Object.keys(ERRORS)
    .sort((a, b) => b.length - a.length)
    .find((key) => text.includes(key))
  if (code) return ERRORS[code]
  if (text.includes('permission') || text.includes('denied')) {
    return 'Your role cannot change customers.'
  }
  return text
}
