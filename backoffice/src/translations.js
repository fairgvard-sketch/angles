/**
 * Переводы QR-меню (Kassa 184).
 *
 * Каталог хранит названия на языке заведения (иврит), переводы — рядом, в
 * колонке translations: {"en": {"name", "description"}, "ru": {...}}.
 * Гость видит перевод, если выбрал этот язык в QR-меню; пустой перевод —
 * гость видит оригинальное название. Касса, тикеты и чеки переводов не
 * читают: заказ всегда записывается базовыми названиями.
 */

export const MENU_TRANSLATION_LANGS = [
  { code: 'en', label: 'English' },
  { code: 'ru', label: 'Russian' },
]

const EDITED = new Set(MENU_TRANSLATION_LANGS.map((lang) => lang.code))

/** Черновик полей формы: всегда строки, по полю на язык. */
export function translationDraft(raw, withDescription = false) {
  const draft = {}
  for (const { code } of MENU_TRANSLATION_LANGS) {
    const entry = raw?.[code] ?? {}
    draft[code] = withDescription
      ? { name: entry.name ?? '', description: entry.description ?? '' }
      : { name: entry.name ?? '' }
  }
  return draft
}

/**
 * Черновик → значение колонки. Пустые поля и языки выбрасываются. Языки,
 * которых в форме нет (например, ивритская правка для позиции с базовым
 * именем на другом языке), переносятся из прежнего значения как есть —
 * сохранение из кабинета не имеет права их стереть.
 */
export function translationPayload(draft, previous = {}) {
  const out = {}
  for (const [code, fields] of Object.entries(previous ?? {})) {
    if (!EDITED.has(code)) out[code] = fields
  }
  for (const { code } of MENU_TRANSLATION_LANGS) {
    const clean = {}
    for (const [field, value] of Object.entries(draft?.[code] ?? {})) {
      const text = String(value ?? '').trim()
      if (text) clean[field] = text
    }
    if (Object.keys(clean).length > 0) out[code] = clean
  }
  return out
}

/** Языки, на которые переведено название: «English, Russian». */
export function translatedLanguages(raw) {
  return MENU_TRANSLATION_LANGS
    .filter(({ code }) => typeof raw?.[code]?.name === 'string' && raw[code].name.trim())
    .map(({ label }) => label)
}

export function translationSummary(raw) {
  const langs = translatedLanguages(raw)
  return langs.length > 0 ? langs.join(', ') : 'Not translated'
}

/**
 * Покрытие переводом блюд точки, которые гость видит: доступные позиции
 * активных категорий этой точки. Возвращает { en: { done, total }, ... }.
 */
export function translationCoverage({ categories, items }, locationId) {
  const visible = new Set(
    (categories ?? [])
      .filter((c) => c.is_active !== false && (!locationId || c.location_id === locationId))
      .map((c) => c.id),
  )
  const shown = (items ?? []).filter((item) => item.is_available !== false && visible.has(item.category_id))
  const coverage = {}
  for (const { code } of MENU_TRANSLATION_LANGS) {
    coverage[code] = {
      done: shown.filter((item) => typeof item.translations?.[code]?.name === 'string'
        && item.translations[code].name.trim()).length,
      total: shown.length,
    }
  }
  return coverage
}
