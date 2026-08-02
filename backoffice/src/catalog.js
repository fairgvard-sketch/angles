/**
 * Правила каталога — чистые функции без сети.
 *
 * Поиск, фильтры и предпросмотр массовой правки решают, что владелец
 * увидит и что применит к десяткам позиций разом. Такие вещи проверяются
 * тестами: ошибка тут стоит переоценённого меню, а не косого отступа.
 *
 * Расширение в импорте указано явно — модуль обязан запускаться голым
 * Node в тестах.
 */

/** Чего не хватает позиции, чтобы гость понял, что покупает */
export const GAP_LABELS = {
  price: 'no price',
  image: 'no photo',
  description: 'no description',
}

/**
 * Пробелы позиции. Намеренно НЕ считаем недостачей отсутствие SKU или
 * себестоимости: они нужны складу и отчётам, а не гостю, и «неполными»
 * из-за них оказалось бы всё меню.
 */
export function itemGaps(item) {
  const gaps = []
  if (!item.price) gaps.push('price')
  if (!item.image_url) gaps.push('image')
  if (!String(item.description ?? '').trim()) gaps.push('description')
  return gaps
}

/** Текст позиции для поиска: имя, описание, артикул, категория */
export function itemSearchText(item, categoryName) {
  return [item.name, item.description, item.sku, categoryName]
    .filter(Boolean).join(' ').toLowerCase()
}

/**
 * Отбор позиций. Пустой фильтр ничего не отсекает: владелец, открывший
 * каталог, должен видеть каталог, а не результат чужих настроек.
 *
 * `availability`: all | available | hidden
 * `state`: all | incomplete
 */
export function filterItems(items, categories, {
  query = '', categoryId = 'all', availability = 'all', state = 'all',
} = {}) {
  const names = new Map((categories ?? []).map((c) => [c.id, c.name]))
  const needle = query.trim().toLowerCase()
  return (items ?? []).filter((item) => {
    if (categoryId !== 'all' && item.category_id !== categoryId) return false
    if (availability === 'available' && !item.is_available) return false
    if (availability === 'hidden' && item.is_available) return false
    if (state === 'incomplete' && itemGaps(item).length === 0) return false
    if (needle && !itemSearchText(item, names.get(item.category_id)).includes(needle)) return false
    return true
  })
}

/** Целые агороты → строка «₪12.50»; дробей в деньгах не бывает */
export function money(agorot) {
  return `₪${((agorot ?? 0) / 100).toFixed(2).replace(/\.00$/, '')}`
}

/**
 * Новая цена при массовой переоценке. Округление — до агоры и тем же
 * правилом, что на сервере (ROUND), иначе предпросмотр покажет одно, а
 * применится другое.
 */
export function nextPrice(price, { percent = null, delta = null }) {
  const base = price ?? 0
  const raw = percent !== null && percent !== undefined
    ? Math.round(base * (1 + Number(percent) / 100))
    : base + Number(delta ?? 0)
  return Math.max(0, raw)
}

/**
 * Предпросмотр массовой правки: что именно изменится и во что.
 *
 * Это и есть обязательный шаг «покажи перед тем, как применить» — без
 * него владелец узнаёт о переоценке всего меню по выручке за день.
 */
export function bulkPreview(items, categories, selectedIds, action, params = {}, format = money) {
  const byId = new Map((items ?? []).map((i) => [i.id, i]))
  const catNames = new Map((categories ?? []).map((c) => [c.id, c.name]))
  const picked = [...(selectedIds ?? [])].map((id) => byId.get(id)).filter(Boolean)

  return picked.map((item) => {
    if (action === 'availability') {
      const next = Boolean(params.available)
      return {
        id: item.id,
        name: item.name,
        from: item.is_available ? 'On sale' : 'Hidden',
        to: next ? 'On sale' : 'Hidden',
        changes: item.is_available !== next,
        // Прежнее значение машиночитаемо: из него собирается отмена
        prev: { available: Boolean(item.is_available) },
      }
    }
    if (action === 'category') {
      return {
        id: item.id,
        name: item.name,
        from: catNames.get(item.category_id) ?? '—',
        to: catNames.get(params.categoryId) ?? '—',
        changes: item.category_id !== params.categoryId,
        prev: { categoryId: item.category_id ?? null },
      }
    }
    const to = nextPrice(item.price, params)
    return {
      id: item.id,
      name: item.name,
      // Формат денег берём с экрана: в диалоге и в списке цена обязана
      // выглядеть одинаково, иначе владелец сверяет одно с другим.
      from: format(item.price),
      to: format(to),
      // Цена товара с размерами берётся из варианта — предупреждаем,
      // что переоценка достанет и их.
      note: item.variantCount > 0 ? `${item.variantCount} sizes change too` : null,
      changes: to !== (item.price ?? 0),
    }
  })
}

/** Сколько строк предпросмотра действительно что-то меняют */
export function changedCount(preview) {
  return (preview ?? []).filter((row) => row.changes).length
}

/**
 * Порядок позиций после перемещения на шаг. Возвращает новый список id
 * для `reorder_menu` — клавиатурой и пальцем это работает одинаково, в
 * отличие от перетаскивания.
 */
export function moveInOrder(ids, id, direction) {
  const list = [...(ids ?? [])]
  const from = list.indexOf(id)
  if (from < 0) return list
  const to = from + (direction === 'up' ? -1 : 1)
  if (to < 0 || to >= list.length) return list
  list.splice(to, 0, list.splice(from, 1)[0])
  return list
}


/**
 * План отмены массовой правки.
 *
 * Отменяется ровно то, что действительно изменилось: если из двенадцати
 * выбранных позиций скрылись девять, вернуть на продажу надо девять, а
 * не двенадцать — иначе отмена сама станет правкой.
 *
 * Цену вернуть нельзя, и это честнее, чем сделать вид: сервер применяет
 * ПРАВИЛО (процент), а не список значений, и округление до агоры
 * необратимо (−10 % и +11,11 % не возвращают исходное). Для цен отдаём
 * `null` — интерфейс обязан сказать, что откат делается новой правкой.
 *
 * Категория возвращается по группам: у изменённых позиций прежние
 * категории могли быть разными, и каждая группа — отдельный вызов того
 * же атомарного RPC.
 */
export function undoPlan(rows, action) {
  const changed = (rows ?? []).filter((row) => row.changes)
  if (changed.length === 0) return []
  if (action === 'availability') {
    const groups = new Map()
    for (const row of changed) {
      const was = Boolean(row.prev?.available)
      if (!groups.has(was)) groups.set(was, [])
      groups.get(was).push(row.id)
    }
    return [...groups.entries()].map(([available, ids]) => ({
      action: 'availability', ids, params: { available },
    }))
  }
  if (action === 'category') {
    const groups = new Map()
    for (const row of changed) {
      const was = row.prev?.categoryId ?? null
      if (was === null) continue // позиция была без категории — вернуть нечем
      if (!groups.has(was)) groups.set(was, [])
      groups.get(was).push(row.id)
    }
    // Хоть одна позиция без прежней категории — отмена будет неполной,
    // а неполная отмена хуже её отсутствия.
    const restorable = [...groups.values()].reduce((sum, ids) => sum + ids.length, 0)
    if (restorable !== changed.length) return null
    return [...groups.entries()].map(([categoryId, ids]) => ({
      action: 'category', ids, params: { categoryId },
    }))
  }
  return null
}

/** Что сказать про результат правки: «12 items hidden» */
export function bulkOutcome(rows, action, params, categoryName) {
  const count = changedCount(rows)
  if (count === 0) return 'Nothing changed — the items already looked like that.'
  const items = `${count} item${count === 1 ? '' : 's'}`
  if (action === 'availability') return params.available ? `${items} put on sale` : `${items} hidden`
  if (action === 'category') return `${items} moved to ${categoryName || 'another category'}`
  const percent = params.percent
  return `${items} repriced by ${percent > 0 ? '+' : ''}${percent}%`
}
