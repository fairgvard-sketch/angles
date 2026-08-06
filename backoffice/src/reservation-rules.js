/**
 * Правила брони (Kassa 145) — список условий визита, которые гость
 * читает ПЕРЕД отправкой заявки.
 *
 * До этого правило было одно — свободный абзац `policy`, и показывался
 * он в карточке уже созданной брони. «Стоимость 289 ₪ с человека»,
 * «меню нет», «посадка общая» так работать не могут: их либо видно до
 * согласия, либо нет смысла в самом согласии.
 *
 * Здесь только правка списка. Нормализация, по которой правила
 * показываются гостю и проверяются при заявке, живёт в БД
 * (`reservation_rules`, Kassa 145) — второй нормализатор на клиенте
 * означал бы, что кабинет и сервер по-разному считают, какой пункт
 * обязателен.
 *
 * Инвариант формата (тот же, что читает БД):
 *   { id, text, level: 'normal' | 'important', ack: boolean, url?: string }
 */

/** Потолок как в БД: длиннее сервер всё равно обрежет */
export const RULE_TEXT_MAX = 300
export const RULES_MAX = 20

export const RULE_LEVELS = [
  { value: 'normal', label: 'Normal' },
  { value: 'important', label: 'Highlighted' },
]

/**
 * Идентификатор пункта. Именно он уходит на сервер как «этот пункт
 * отмечен», поэтому переживает правку текста: иначе согласие гостя,
 * оформленное минуту назад, перестало бы совпадать с настройками.
 */
function newId() {
  const rnd = globalThis.crypto?.randomUUID?.()
  if (rnd) return rnd.slice(0, 8)
  return Math.random().toString(36).slice(2, 10)
}

/** Список правил точки из настроек; всегда массив, всегда с id */
export function ruleList(rsv) {
  const raw = Array.isArray(rsv?.rules) ? rsv.rules : []
  return raw
    .filter((r) => r && typeof r === 'object')
    .map((r, i) => ({
      id: typeof r.id === 'string' && r.id.trim() ? r.id.trim() : `r${i + 1}`,
      text: typeof r.text === 'string' ? r.text : '',
      level: r.level === 'important' ? 'important' : 'normal',
      ack: r.ack === true,
      url: typeof r.url === 'string' && r.url.trim() ? r.url.trim() : null,
    }))
}

export function addRule(list) {
  if (list.length >= RULES_MAX) return list
  return [...list, { id: newId(), text: '', level: 'normal', ack: false, url: null }]
}

export function updateRule(list, id, patch) {
  return list.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule))
}

export function removeRule(list, id) {
  return list.filter((rule) => rule.id !== id)
}

/**
 * Порядок задаёт владелец: гость читает пункты сверху вниз, и «важное
 * сначала» — это решение заведения, а не сортировка по важности,
 * которую мы придумали за него.
 */
export function moveRule(list, id, delta) {
  const from = list.findIndex((rule) => rule.id === id)
  if (from === -1) return list
  const to = from + delta
  if (to < 0 || to >= list.length) return list
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * Что уходит в настройки. Пустые пункты выбрасываются здесь, а не
 * прячутся: правило без текста гостю показать нечем, и хранить его
 * значит копить мусор, который однажды покажется.
 */
export function toSettings(list) {
  const clean = list
    .map((rule) => ({
      id: rule.id,
      text: String(rule.text || '').trim().slice(0, RULE_TEXT_MAX),
      level: rule.level === 'important' ? 'important' : 'normal',
      ack: rule.ack === true,
      ...(rule.url ? { url: String(rule.url).trim() } : {}),
    }))
    .filter((rule) => rule.text !== '')
    .slice(0, RULES_MAX)
  // Пустой список отправляем как null: ключ-пустышка в настройках
  // выглядит как «правила заданы», а гостю показывать нечего.
  return clean.length > 0 ? clean : null
}

/** Строка-сводка в свёрнутой группе настроек */
export function rulesSummary(list) {
  const shown = list.filter((rule) => String(rule.text || '').trim() !== '')
  if (shown.length === 0) return 'No rules'
  const acks = shown.filter((rule) => rule.ack).length
  const rules = `${shown.length} ${shown.length === 1 ? 'rule' : 'rules'}`
  return acks > 0 ? `${rules} · ${acks} to confirm` : rules
}
