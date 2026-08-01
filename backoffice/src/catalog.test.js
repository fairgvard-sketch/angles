import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bulkPreview, changedCount, filterItems, itemGaps, moveInOrder, money, nextPrice,
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
