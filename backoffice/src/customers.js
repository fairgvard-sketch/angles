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
/**
 * Канонический счётчик визитов гостя.
 *
 * На живой приёмке один человек показывался с 6 визитами в списке и 4 в
 * карточке, а читалка называла третье число: часть экранов читала
 * `guests.visits` — счётчик лояльности, который заполняет только касса,
 * — а часть считала состоявшиеся визиты.
 *
 * Складывать брони и заказы ЗДЕСЬ нельзя: визит, посаженный в заказ,
 * дал бы двойку. Величину считает сервер (155/161), где вычет уже
 * сделан; клиент только выбирает правильное поле и переживает старый
 * ответ без него.
 */
export function combinedVisits(guest) {
  const canonical = guest?.combined_visits
  if (Number.isFinite(Number(canonical))) return Number(canonical)
  const fromFacts = guest?.why_segment?.visits
  if (Number.isFinite(Number(fromFacts))) return Number(fromFacts)
  // Совсем старый ответ: лучше показать счётчик лояльности, чем ноль
  return Number(guest?.visits) || 0
}

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
  parts.push(visitsLabel(combinedVisits(guest)))
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
/**
 * Сегменты считает СЕРВЕР (155) и присылает готовым набором вместе с
 * доказательством. Здесь остаются только подписи и подсказки.
 *
 * Раньше это были фильтры по тратам — «три визита лояльности», «200 ₪»,
 * «90 дней без покупки». Все три считались по колонкам, которые
 * заполняет касса, поэтому у точки с одним ANGLE Reserve не работал ни
 * один: гость, бронирующий стол каждую пятницу, не попадал никуда.
 *
 * Порядок — по тому, как часто владелец сюда приходит: сначала «кто
 * придёт», потом «кого теряем», потом остальное.
 */
export const SEGMENTS = [
  { key: 'all', label: 'Everyone', params: {} },
  {
    key: 'upcoming',
    label: 'Coming soon',
    hint: 'Has a future booking',
    params: { p_segment: 'upcoming' },
  },
  {
    key: 'at_risk',
    label: 'At risk',
    hint: 'Overdue against their own rhythm',
    params: { p_segment: 'at_risk' },
  },
  {
    key: 'lost',
    label: 'Lost',
    hint: 'No visit for half a year',
    params: { p_segment: 'lost' },
  },
  {
    key: 'new',
    label: 'New',
    hint: 'First visit, hasn’t come back yet',
    params: { p_segment: 'new' },
  },
  {
    key: 'returning',
    label: 'Returning',
    hint: '2 visits or more',
    params: { p_segment: 'returning' },
  },
  {
    key: 'regular',
    label: 'Regulars',
    hint: '5 visits or more',
    params: { p_segment: 'regular' },
  },
  {
    key: 'vip',
    label: 'VIP',
    hint: 'Top spend, or many visits without a register',
    params: { p_segment: 'vip' },
  },
  {
    key: 'repeat_no_show',
    label: 'Repeated no-shows',
    hint: 'Missed 2 bookings or more',
    params: { p_segment: 'repeat_no_show' },
  },
]

/** Подписи сегментов, приходящих в строке гостя */
export const SEGMENT_LABEL = {
  new: 'New',
  returning: 'Returning',
  regular: 'Regular',
  vip: 'VIP',
  at_risk: 'At risk',
  lost: 'Lost',
  upcoming: 'Coming soon',
  repeat_no_show: 'Repeated no-shows',
}

/**
 * Чем метка заслужена — словами, из чисел сервера.
 *
 * «Пропал» без «был 8 раз, последний — 4 месяца назад» невозможно ни
 * проверить, ни оспорить, и владелец такой метке просто не верит.
 */
export function whySegment(segment, why) {
  if (!why) return ''
  const visits = Number(why.visits) || 0
  const days = why.days_since == null ? null : Number(why.days_since)
  const gap = why.avg_gap_days == null ? null : Number(why.avg_gap_days)
  switch (segment) {
    case 'lost':
      return days == null ? '' : `${visits} visits, last one ${days} days ago`
    case 'at_risk':
      return days == null || gap == null ? ''
        : `usually every ${Math.round(gap)} days, silent for ${days}`
    case 'regular':
    case 'returning':
      return gap == null ? `${visits} visits` : `${visits} visits, about every ${Math.round(gap)} days`
    case 'new':
      return days == null ? 'first visit' : `first visit ${days} days ago`
    case 'vip':
      return Number(why.spend) > 0
        ? `${formatMoney(why.spend)} spent over ${visits} visits`
        : `${visits} visits`
    case 'upcoming':
      return Number(why.upcoming) === 1 ? '1 booking ahead' : `${why.upcoming} bookings ahead`
    case 'repeat_no_show':
      return `${why.no_shows} no-shows`
    default:
      return ''
  }
}

/**
 * Основная подпись строки — первый сегмент набора.
 *
 * У гостя их несколько («постоянный» и «с будущей бронью» — разные
 * ответы), но в узкой колонке помещается один; остальные видны в
 * карточке.
 */
export function primarySegment(segments) {
  return Array.isArray(segments) && segments.length > 0 ? segments[0] : null
}


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
  offset = 0, locationIds = null,
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
    p_segment: null,
    // Точки сужают ФАКТЫ, а не гостей: база общая на организацию, и
    // «покажи гостей этой точки» означает «считай по её визитам».
    p_location_ids: locationIds && locationIds.length ? locationIds : null,
    p_offset: offset,
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
    // Сегмент и его доказательство: список «кого позвать» без причины
    // бесполезен тому, кто будет по нему звонить.
    'Segments', 'Why',
  ]
  const lines = [header.join(',')]
  for (const g of rows ?? []) {
    lines.push([
      csvCell(g.name ?? ''),
      csvCell(g.phone ?? ''),
      csvCell(combinedVisits(g)),
      csvCell(((g.total_spent ?? 0) / 100).toFixed(2)),
      csvCell(((g.points ?? 0) / 100).toFixed(2)),
      csvCell(g.stamps ?? 0),
      csvCell(csvDate(g.last_visit_at, timeZone)),
      csvCell(csvDate(g.created_at, timeZone)),
      csvCell((g.tags ?? []).join(' | ')),
      csvCell(g.notes ?? ''),
      csvCell((g.segments ?? []).map((k) => SEGMENT_LABEL[k] ?? k).join(' | ')),
      csvCell(whySegment(primarySegment(g.segments), g.why_segment)),
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
  // 160: стирание — единственное необратимое действие над базой, и оно
  // доступно только владельцу. Менеджеру важно сказать, ЧТО делать,
  // а не «отказано».
  owner_only: 'Only the account owner can erase a customer. Ask them to do it.',
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

/**
 * Объяснение к КАЖДОМУ сегменту карточки.
 *
 * В профиле печаталось одно объяснение под всей группой чипов — то
 * есть причина первого сегмента. Остальные метки («VIP», «Coming
 * soon») стояли рядом без всякого обоснования, хотя в списке у
 * основной метки подсказка есть. Карточка не имеет права объяснять
 * ХУЖЕ, чем строка списка.
 *
 * Одинаковая проза схлопывается: два сегмента, обоснованные одним и тем
 * же числом визитов, не должны печатать это число дважды. Ссылка на
 * общий текст при этом остаётся у обоих чипов, поэтому читалка
 * прочитает обоснование для каждого.
 */
export function segmentExplanations(segments, why) {
  const out = []
  const byText = new Map()
  for (const key of segments ?? []) {
    const text = whySegment(key, why)
    if (!text) continue
    const seen = byText.get(text)
    if (seen) {
      seen.keys.push(key)
      continue
    }
    const entry = { id: `seg-${out.length}`, text, keys: [key] }
    byText.set(text, entry)
    out.push(entry)
  }
  return out
}

/** Какой строкой объяснён конкретный чип (для aria-describedby) */
export function explanationIdFor(explanations, key) {
  return (explanations ?? []).find((e) => e.keys.includes(key))?.id ?? null
}
