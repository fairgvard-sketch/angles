import test, { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  bulkOutcome, bulkPreview, canReorder, changedCount, filterGroups, filterItems,
  filterStations, groupGaps, groupUsage, itemGaps, itemsByStation, modifierDelta,
  moveInOrder, money, nextPrice, priceLabel, ruleError, selectionRule, sizesLabel,
  sortItems, unassignedItems, undoPlan,
} from './catalog.js'

/**
 * Каталог: поиск, пробелы позиций и предпросмотр массовой правки.
 *
 * Главное здесь — предпросмотр: он показывает владельцу, что именно
 * уедет в меню, ДО того как это уедет. Ошибка в нём стоит переоценённого
 * меню, поэтому округление обязано совпадать с серверным.
 */

const CATEGORIES = [
  { id: 'c1', name: 'Coffee' },
  { id: 'c2', name: 'Bakery' },
]

const ITEMS = [
  {
    id: 'i1', name: 'Latte', category_id: 'c1', price: 1000, is_available: true,
    description: 'Espresso and milk', image_url: 'x.jpg', sku: 'COF-1', variantCount: 2,
  },
  {
    id: 'i2', name: 'Espresso', category_id: 'c1', price: 705, is_available: false,
    description: '', image_url: null, sku: 'COF-2', variantCount: 0,
  },
  {
    id: 'i3', name: 'Croissant', category_id: 'c2', price: 0, is_available: true,
    description: 'Butter', image_url: 'y.jpg', sku: null, variantCount: 0,
  },
]

const ids = (list) => list.map((i) => i.id)

test('пробелы считаются по тому, что видит гость', () => {
  assert.deepEqual(itemGaps(ITEMS[0]), [])
  assert.deepEqual(itemGaps(ITEMS[1]), ['image', 'description'])
  assert.deepEqual(itemGaps(ITEMS[2]), ['price'])
  // Артикул и себестоимость гостю не видны — их отсутствие не «пробел»
  assert.deepEqual(itemGaps({ price: 100, image_url: 'a', description: 'b' }), [])
})

test('поиск находит по имени, описанию, артикулу и категории', () => {
  const find = (q) => ids(filterItems(ITEMS, CATEGORIES, { query: q }))
  assert.deepEqual(find('latte'), ['i1'])
  assert.deepEqual(find('milk'), ['i1'])
  assert.deepEqual(find('COF-2'), ['i2'])
  assert.deepEqual(find('bakery'), ['i3'])
  assert.deepEqual(find('нет такого'), [])
})

test('пустой фильтр отдаёт весь каталог', () => {
  assert.equal(filterItems(ITEMS, CATEGORIES, {}).length, 3)
  assert.equal(filterItems(ITEMS, CATEGORIES).length, 3)
})

test('фильтры по категории, доступности и неполноте складываются', () => {
  assert.deepEqual(ids(filterItems(ITEMS, CATEGORIES, { categoryId: 'c1' })), ['i1', 'i2'])
  assert.deepEqual(ids(filterItems(ITEMS, CATEGORIES, { availability: 'hidden' })), ['i2'])
  assert.deepEqual(ids(filterItems(ITEMS, CATEGORIES, { state: 'incomplete' })), ['i2', 'i3'])
  assert.deepEqual(
    ids(filterItems(ITEMS, CATEGORIES, { categoryId: 'c1', state: 'incomplete' })),
    ['i2']
  )
})

test('переоценка округляется до агоры так же, как на сервере', () => {
  assert.equal(nextPrice(1000, { percent: 10 }), 1100)
  assert.equal(nextPrice(705, { percent: 10 }), 776) // 775.5 → 776
  assert.equal(nextPrice(1000, { delta: -100 }), 900)
  // Отрицательная цена ломает чек, а не даёт скидку
  assert.equal(nextPrice(500, { delta: -999999 }), 0)
  assert.equal(nextPrice(1000, { percent: -100 }), 0)
})

test('предпросмотр цены показывает «из» и «во что» и предупреждает про размеры', () => {
  const rows = bulkPreview(ITEMS, CATEGORIES, ['i1', 'i2'], 'price', { percent: 10 })
  assert.deepEqual(rows.map((r) => [r.name, r.from, r.to]), [
    ['Latte', '₪10', '₪11'],
    ['Espresso', '₪7.05', '₪7.76'],
  ])
  assert.equal(rows[0].note, '2 sizes change too')
  assert.equal(rows[1].note, null)
  assert.equal(changedCount(rows), 2)
})

test('предпросмотр честно отмечает строки, где ничего не изменится', () => {
  const rows = bulkPreview(ITEMS, CATEGORIES, ['i1', 'i2'], 'availability', { available: true })
  assert.deepEqual(rows.map((r) => [r.name, r.from, r.to, r.changes]), [
    ['Latte', 'On sale', 'On sale', false],
    ['Espresso', 'Hidden', 'On sale', true],
  ])
  assert.equal(changedCount(rows), 1)
})

test('предпросмотр переноса называет категории по имени, а не по id', () => {
  const rows = bulkPreview(ITEMS, CATEGORIES, ['i1', 'i3'], 'category', { categoryId: 'c2' })
  assert.deepEqual(rows.map((r) => [r.from, r.to, r.changes]), [
    ['Coffee', 'Bakery', true],
    ['Bakery', 'Bakery', false],
  ])
})

test('в предпросмотр не попадают позиции, которых нет в каталоге', () => {
  const rows = bulkPreview(ITEMS, CATEGORIES, ['i1', 'ghost'], 'availability', { available: false })
  assert.deepEqual(rows.map((r) => r.id), ['i1'])
})

test('перемещение на шаг работает с краями списка', () => {
  const order = ['a', 'b', 'c']
  assert.deepEqual(moveInOrder(order, 'b', 'up'), ['b', 'a', 'c'])
  assert.deepEqual(moveInOrder(order, 'b', 'down'), ['a', 'c', 'b'])
  assert.deepEqual(moveInOrder(order, 'a', 'up'), ['a', 'b', 'c'])
  assert.deepEqual(moveInOrder(order, 'c', 'down'), ['a', 'b', 'c'])
  assert.deepEqual(moveInOrder(order, 'ghost', 'up'), ['a', 'b', 'c'])
  // Исходный список не мутируется — иначе UI «прыгал» бы до ответа сервера
  assert.deepEqual(order, ['a', 'b', 'c'])
})

test('деньги показываются без лишних нулей', () => {
  assert.equal(money(1000), '₪10')
  assert.equal(money(1250), '₪12.50')
  assert.equal(money(0), '₪0')
  assert.equal(money(null), '₪0')
})

// ── Отмена массовой правки ───────────────────────────────────

describe('undoPlan', () => {
  const categories = [
    { id: 'c1', name: 'Кофе' },
    { id: 'c2', name: 'Выпечка' },
  ]
  const items = [
    { id: 'i1', name: 'Латте', price: 1800, is_available: true, category_id: 'c1' },
    { id: 'i2', name: 'Круассан', price: 1400, is_available: false, category_id: 'c2' },
    { id: 'i3', name: 'Эспрессо', price: 1000, is_available: true, category_id: 'c1' },
  ]

  it('возвращает ровно то, что изменилось', () => {
    // Скрываем три позиции; одна и так была скрыта
    const rows = bulkPreview(items, categories, ['i1', 'i2', 'i3'], 'availability', { available: false })
    const plan = undoPlan(rows, 'availability')
    assert.equal(plan.length, 1)
    assert.deepEqual(plan[0], { action: 'availability', ids: ['i1', 'i3'], params: { available: true } })
  })

  it('категории возвращает по группам прежних значений', () => {
    const rows = bulkPreview(items, categories, ['i1', 'i2'], 'category', { categoryId: 'c1' })
    const plan = undoPlan(rows, 'category')
    // Менялась только i2 (i1 уже в c1)
    assert.deepEqual(plan, [{ action: 'category', ids: ['i2'], params: { categoryId: 'c2' } }])
  })

  it('позицию без прежней категории вернуть нечем — отмены нет вовсе', () => {
    const orphan = [{ id: 'i9', name: 'Без категории', price: 500, is_available: true, category_id: null }]
    const rows = bulkPreview(orphan, categories, ['i9'], 'category', { categoryId: 'c1' })
    assert.equal(undoPlan(rows, 'category'), null, 'неполная отмена хуже её отсутствия')
  })

  it('цену не отменяем: сервер применяет правило, округление необратимо', () => {
    const rows = bulkPreview(items, categories, ['i1'], 'price', { percent: -10 })
    assert.equal(undoPlan(rows, 'price'), null)
  })

  it('когда ничего не изменилось — отменять нечего', () => {
    const rows = bulkPreview(items, categories, ['i1'], 'availability', { available: true })
    assert.deepEqual(undoPlan(rows, 'availability'), [])
  })
})

describe('bulkOutcome', () => {
  const categories = [{ id: 'c1', name: 'Кофе' }]
  const items = [{ id: 'i1', name: 'Латте', price: 1800, is_available: true, category_id: 'c2' }]

  it('говорит, что именно произошло', () => {
    const hide = bulkPreview(items, categories, ['i1'], 'availability', { available: false })
    assert.equal(bulkOutcome(hide, 'availability', { available: false }), '1 item hidden')

    const move = bulkPreview(items, categories, ['i1'], 'category', { categoryId: 'c1' })
    assert.equal(bulkOutcome(move, 'category', { categoryId: 'c1' }, 'Кофе'), '1 item moved to Кофе')

    const price = bulkPreview(items, categories, ['i1'], 'price', { percent: 10 })
    assert.equal(bulkOutcome(price, 'price', { percent: 10 }), '1 item repriced by +10%')
  })

  it('не врёт, когда не изменилось ничего', () => {
    const noop = bulkPreview(items, categories, ['i1'], 'availability', { available: true })
    assert.match(bulkOutcome(noop, 'availability', { available: true }), /Nothing changed/)
  })
})

// ── Правила, добавленные редизайном ──────────────────────────

describe('цена позиции с размерами', () => {
  const plain = { price: 1000, item_variants: [] }
  const sized = {
    price: 1100,
    item_variants: [
      { name: 'S', price: 1100 }, { name: 'M', price: 1400 }, { name: 'L', price: 1600 },
    ],
  }
  const same = { price: 900, item_variants: [{ name: 'One', price: 900 }] }

  it('без размеров показывает базовую цену', () => {
    assert.equal(priceLabel(plain), '₪10')
    assert.equal(sizesLabel(plain), null)
  })

  it('с размерами показывает ДИАПАЗОН: базовая цена в чеке не появится', () => {
    assert.equal(priceLabel(sized), '₪11–₪16')
    assert.equal(sizesLabel(sized), '3 sizes')
  })

  it('одинаковые цены размеров не превращает в фальшивый диапазон', () => {
    assert.equal(priceLabel(same), '₪9')
    assert.equal(sizesLabel(same), '1 size')
  })
})

describe('порядок и сортировка', () => {
  const items = [
    { id: 'a', name: 'Ватрушка', price: 900, sort_order: 2 },
    { id: 'b', name: 'Американо', price: 1200, sort_order: 0 },
    { id: 'c', name: 'Булочка', price: 500, sort_order: 1 },
  ]
  const ids = (list) => list.map((i) => i.id)

  it('ручной порядок идёт по sort_order', () => {
    assert.deepEqual(ids(sortItems(items, 'manual')), ['b', 'c', 'a'])
  })

  it('по имени и по цене — в обе стороны', () => {
    assert.deepEqual(ids(sortItems(items, 'name')), ['b', 'c', 'a'])
    assert.deepEqual(ids(sortItems(items, 'price-asc')), ['c', 'a', 'b'])
    assert.deepEqual(ids(sortItems(items, 'price-desc')), ['b', 'a', 'c'])
  })

  it('исходный список не мутируется — иначе таблица прыгает до ответа сервера', () => {
    sortItems(items, 'name')
    assert.deepEqual(ids(items), ['a', 'b', 'c'])
  })

  it('стрелки порядка живут только внутри одной категории', () => {
    assert.equal(canReorder({ categoryId: 'c1', sort: 'manual' }), true)
    // В смешанном списке «выше» не значит ничего
    assert.equal(canReorder({ categoryId: 'all', sort: 'manual' }), false)
    // При сортировке по имени порядок задаёт не владелец
    assert.equal(canReorder({ categoryId: 'c1', sort: 'name' }), false)
  })
})

describe('правило выбора группы модификаторов', () => {
  const rule = (min, max) => selectionRule({ min_select: min, max_select: max })

  it('переводит min/max в человеческий язык', () => {
    assert.equal(rule(0, 1), 'Optional · up to 1')
    assert.equal(rule(1, 1), 'Required · choose 1')
    assert.equal(rule(0, 3), 'Optional · up to 3')
    assert.equal(rule(2, 2), 'Required · choose 2')
    assert.equal(rule(1, 3), 'Required · choose 1–3')
  })

  it('«unlimited» говорит только там, где это ЕСТЬ в схеме: max_select = 0', () => {
    assert.equal(rule(0, 0), 'Optional · unlimited')
    assert.equal(rule(2, 0), 'Required · at least 2')
    // Ограниченное правило неограниченным не называем
    assert.doesNotMatch(rule(0, 5), /unlimited/)
  })

  it('невозможное правило называет невозможным, а не выдумывает смысл', () => {
    assert.match(rule(3, 1), /Invalid rule/)
  })

  it('невозможные комбинации отклоняются до сохранения', () => {
    assert.equal(ruleError(0, 1), null)
    assert.equal(ruleError(0, 0), null)   // без ограничения
    assert.equal(ruleError(2, 0), null)   // «не меньше двух», без потолка
    assert.match(ruleError(3, 1), /Minimum cannot be greater/)
    assert.match(ruleError(-1, 1), /whole numbers/)
  })
})

describe('проблемы группы модификаторов', () => {
  const group = (patch) => ({ name: 'G', min_select: 0, max_select: 1, modifiers: [], ...patch })
  const ok = { id: 'm1', name: 'Oat', price_delta: 300, is_available: true }

  it('пустая группа не предлагает гостю ничего', () => {
    assert.deepEqual(groupGaps(group({})), ['empty'])
  })

  it('здоровая группа проблем не имеет', () => {
    assert.deepEqual(groupGaps(group({ modifiers: [ok] })), [])
  })

  it('минимум больше максимума — правило, которое не выполнить', () => {
    assert.ok(groupGaps(group({ min_select: 3, max_select: 1, modifiers: [ok] })).includes('impossible'))
  })

  it('обязательная группа без доступного выбора останавливает заказ', () => {
    const gaps = groupGaps(group({
      min_select: 1, max_select: 1,
      modifiers: [{ ...ok, is_available: false }],
    }))
    assert.ok(gaps.includes('no_choice'))
  })

  it('недоступный выбор по умолчанию', () => {
    const gaps = groupGaps(group({
      modifiers: [{ ...ok, is_default: true, is_available: false }],
    }))
    assert.ok(gaps.includes('default_off'))
  })

  it('пустую группу не обвиняет дважды', () => {
    assert.deepEqual(groupGaps(group({ min_select: 1, max_select: 1 })), ['empty'])
  })
})

describe('цена модификатора — это доплата', () => {
  it('ноль называет словами, а не «₪0»', () => {
    assert.equal(modifierDelta(0), 'No extra charge')
    assert.equal(modifierDelta(null), 'No extra charge')
  })

  it('положительную доплату показывает со знаком', () => {
    assert.equal(modifierDelta(300), '+₪3')
    assert.equal(modifierDelta(250), '+₪2.50')
  })

  it('отрицательную не прячет: колонка её допускает', () => {
    assert.equal(modifierDelta(-200), '−₪2')
  })
})

describe('использование групп и отбор', () => {
  const items = [
    { id: 'i1', menu_item_modifier_groups: [{ group_id: 'g1' }, { group_id: 'g2' }] },
    { id: 'i2', menu_item_modifier_groups: [{ group_id: 'g1' }] },
    { id: 'i3', menu_item_modifier_groups: [] },
  ]
  const groups = [
    { id: 'g1', name: 'Milk', min_select: 0, max_select: 1, modifiers: [{ id: 'm1', name: 'Oat', is_available: true }] },
    { id: 'g2', name: 'Syrup', min_select: 0, max_select: 3, modifiers: [{ id: 'm2', name: 'Vanilla', is_available: true }] },
    { id: 'g3', name: 'Doneness', min_select: 1, max_select: 1, modifiers: [] },
  ]

  it('считает использование одним проходом по каталогу', () => {
    const usage = groupUsage(items)
    assert.equal(usage.get('g1'), 2)
    assert.equal(usage.get('g2'), 1)
    assert.equal(usage.get('g3'), undefined)
  })

  it('поиск находит группу по имени её модификатора', () => {
    const found = filterGroups(groups, { query: 'vanilla' }, groupUsage(items))
    assert.deepEqual(found.map((g) => g.id), ['g2'])
  })

  it('отбор по использованию и по проблемам', () => {
    const usage = groupUsage(items)
    assert.deepEqual(filterGroups(groups, { usage: 'unused' }, usage).map((g) => g.id), ['g3'])
    assert.deepEqual(filterGroups(groups, { usage: 'used' }, usage).map((g) => g.id), ['g1', 'g2'])
    assert.deepEqual(filterGroups(groups, { state: 'incomplete' }, usage).map((g) => g.id), ['g3'])
  })
})

describe('станции приготовления', () => {
  const items = [
    { id: 'i1', name: 'Эспрессо', station_id: 's1' },
    { id: 'i2', name: 'Латте', station_id: 's1' },
    { id: 'i3', name: 'Круассан', station_id: 's2' },
    { id: 'i4', name: 'Вода', station_id: null },
  ]
  const stations = [{ id: 's1', name: 'Бар' }, { id: 's2', name: 'Пекарня' }]

  it('раскладывает позиции по станциям одним проходом', () => {
    const map = itemsByStation(items)
    assert.deepEqual(map.get('s1').map((i) => i.id), ['i1', 'i2'])
    assert.deepEqual(map.get('s2').map((i) => i.id), ['i3'])
    assert.equal(map.get('s3'), undefined)
  })

  it('считает непривязанные позиции', () => {
    assert.deepEqual(unassignedItems(items, stations).map((i) => i.id), ['i4'])
  })

  it('пока станций нет — вопрос «почему не назначена» не задан', () => {
    assert.deepEqual(unassignedItems(items, []), [])
  })

  it('поиск идёт и по назначенным позициям, как обещает подсказка', () => {
    const byStation = itemsByStation(items)
    assert.deepEqual(
      filterStations(stations, { query: 'круассан' }, byStation).map((s) => s.id),
      ['s2']
    )
    assert.deepEqual(filterStations(stations, { query: 'бар' }, byStation).map((s) => s.id), ['s1'])
    assert.deepEqual(filterStations(stations, { query: 'нет' }, byStation), [])
    // Пустой запрос ничего не отсекает
    assert.equal(filterStations(stations, { query: '' }, byStation).length, 2)
  })
})
