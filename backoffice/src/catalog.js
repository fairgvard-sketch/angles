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
 * Порядок каталога. Режимов ровно столько, сколько мы умеем ПОСЧИТАТЬ:
 * выпадающий список с сортировкой, которой нет в данных, — обещание,
 * которое экран не выполнит.
 *
 * `manual` — порядок, заданный владельцем (`sort_order`, `reorder_menu`).
 * Он имеет смысл ВНУТРИ категории, поэтому стрелки показываются только
 * там, где категория одна: см. `canReorder`.
 */
export const SORT_MODES = [
  { key: 'manual', label: 'Manual order' },
  { key: 'name', label: 'Name A–Z' },
  { key: 'price-asc', label: 'Price: low to high' },
  { key: 'price-desc', label: 'Price: high to low' },
]

/** Сортировка списка позиций. Исходный массив не мутируется. */
export function sortItems(items, mode = 'manual') {
  const list = [...(items ?? [])]
  if (mode === 'name') {
    return list.sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))
  }
  if (mode === 'price-asc') return list.sort((a, b) => (a.price ?? 0) - (b.price ?? 0))
  if (mode === 'price-desc') return list.sort((a, b) => (b.price ?? 0) - (a.price ?? 0))
  return list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
}

/**
 * Можно ли двигать позиции руками. Порядок существует внутри категории:
 * в плоском списке из четырёх категорий «выше» не значит ничего, и
 * стрелка там переставила бы позицию относительно чужих блюд.
 */
export function canReorder({ categoryId = 'all', sort = 'manual' } = {}) {
  return categoryId !== 'all' && sort === 'manual'
}

/**
 * Цена позиции. У товара с размерами цена берётся из варианта, поэтому
 * честный ответ — диапазон, а не базовое число, которое в чеке не
 * появится ни разу.
 */
export function priceRange(item) {
  const prices = (item?.item_variants ?? []).map((v) => v.price ?? 0)
  if (prices.length === 0) {
    const base = item?.price ?? 0
    return { from: base, to: base, sizes: 0, range: false }
  }
  const from = Math.min(...prices)
  const to = Math.max(...prices)
  return { from, to, sizes: prices.length, range: from !== to }
}

/** «₪11–₪16» или «₪10» — тем же форматом денег, что и весь экран */
export function priceLabel(item, format = money) {
  const { from, to, range } = priceRange(item)
  return range ? `${format(from)}–${format(to)}` : format(from)
}

/** «3 sizes» рядом с ценой; без размеров — ничего */
export function sizesLabel(item) {
  const { sizes } = priceRange(item)
  return sizes > 0 ? `${sizes} size${sizes === 1 ? '' : 's'}` : null
}

// ── Модификаторы ─────────────────────────────────────────────

/**
 * Правило выбора человеческим языком.
 *
 * `max_select = 0` в схеме означает «без ограничения» (003), поэтому
 * «unlimited» здесь — не выдумка макета, а реальное состояние. Всё
 * остальное описывается точными числами: «Choose 1–3» честнее, чем
 * придуманное слово.
 */
export function selectionRule(group) {
  const min = Number(group?.min_select ?? 0)
  const max = Number(group?.max_select ?? 0)
  const unlimited = max === 0
  if (!unlimited && min > max) return `Invalid rule · min ${min}, max ${max}`
  if (min === 0) return unlimited ? 'Optional · unlimited' : `Optional · up to ${max}`
  if (unlimited) return `Required · at least ${min}`
  if (min === max) return `Required · choose ${min}`
  return `Required · choose ${min}–${max}`
}

/** Правило, которое сервер примет: максимум либо «без ограничения», либо ≥ минимума */
export function ruleError(min, max) {
  const lo = Number(min)
  const hi = Number(max)
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 0 || hi < 0) {
    return 'Minimum and maximum must be whole numbers, zero or more.'
  }
  if (hi > 0 && lo > hi) return 'Minimum cannot be greater than maximum.'
  return null
}

/** Чем группа модификаторов сломана — словами, а не цветом */
export const GROUP_GAP_LABELS = {
  empty: 'no modifiers',
  impossible: 'minimum above maximum',
  no_choice: 'required, but nothing available',
  default_off: 'default choice is unavailable',
}

/**
 * Проблемы группы. Только то, что действительно мешает продавать:
 * выдуманного поля «Active» у группы нет, и зелёный бейдж из макета
 * заменён этим состоянием.
 */
export function groupGaps(group) {
  const gaps = []
  const mods = group?.modifiers ?? []
  const min = Number(group?.min_select ?? 0)
  const max = Number(group?.max_select ?? 0)
  if (mods.length === 0) gaps.push('empty')
  if (max > 0 && min > max) gaps.push('impossible')
  // Обязательная группа без единого доступного выбора останавливает заказ
  if (min >= 1 && mods.length > 0 && mods.every((m) => m.is_available === false)) {
    gaps.push('no_choice')
  }
  if (mods.some((m) => m.is_default && m.is_available === false)) gaps.push('default_off')
  return gaps
}

/**
 * Сколько позиций пользуется каждой группой. Считается ОДИН раз на
 * каталог: иначе каждая строка таблицы заново обходит все товары.
 */
export function groupUsage(items) {
  const usage = new Map()
  for (const item of items ?? []) {
    for (const link of item.menu_item_modifier_groups ?? []) {
      usage.set(link.group_id, (usage.get(link.group_id) ?? 0) + 1)
    }
  }
  return usage
}

/** Отбор групп: поиск идёт и по именам модификаторов, а не только групп */
export function filterGroups(groups, {
  query = '', state = 'all', usage = 'all',
} = {}, usageMap = new Map()) {
  const needle = query.trim().toLowerCase()
  return (groups ?? []).filter((group) => {
    if (state === 'incomplete' && groupGaps(group).length === 0) return false
    const used = usageMap.get(group.id) ?? 0
    if (usage === 'used' && used === 0) return false
    if (usage === 'unused' && used > 0) return false
    if (!needle) return true
    const text = [group.name, ...(group.modifiers ?? []).map((m) => m.name)]
      .filter(Boolean).join(' ').toLowerCase()
    return text.includes(needle)
  })
}

/**
 * Цена модификатора — всегда ДОПЛАТА, а не цена товара. Ноль называется
 * словами: «₪0» рядом с названием читается как «бесплатный товар».
 */
export function modifierDelta(agorot, format = money) {
  const value = Number(agorot ?? 0)
  if (value === 0) return 'No extra charge'
  return value > 0 ? `+${format(value)}` : `−${format(Math.abs(value))}`
}

// ── Станции приготовления ────────────────────────────────────

/** Позиции по станциям — один проход по каталогу на весь экран */
export function itemsByStation(items) {
  const map = new Map()
  for (const item of items ?? []) {
    if (!item.station_id) continue
    const list = map.get(item.station_id) ?? []
    list.push(item)
    map.set(item.station_id, list)
  }
  return map
}

/**
 * Позиции без станции. Пока в организации нет ни одной станции, вопрос
 * «почему не назначена» не задан — и предупреждать не о чем.
 */
export function unassignedItems(items, stations) {
  if ((stations ?? []).length === 0) return []
  return (items ?? []).filter((item) => !item.station_id)
}

/** Отбор станций: ищем и по назначенным позициям, как обещает подсказка */
export function filterStations(stations, { query = '' } = {}, byStation = new Map()) {
  const needle = query.trim().toLowerCase()
  if (!needle) return stations ?? []
  return (stations ?? []).filter((station) => {
    if (String(station.name ?? '').toLowerCase().includes(needle)) return true
    return (byStation.get(station.id) ?? [])
      .some((item) => String(item.name ?? '').toLowerCase().includes(needle))
  })
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
