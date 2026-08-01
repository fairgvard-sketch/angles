import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bucketOrders, dayStartMs, elapsedLabel, filterOrders, fulfilmentMode,
  orderItemLines, orderRef, orderSearchText, orderTimeLabel,
} from './orders-inbox.js'

/**
 * Инбокс заказов: возраст, корзины и поиск.
 *
 * Проверяется главное обещание раздела — незакрытый вчерашний заказ
 * нельзя принять за сегодняшний, а известный заказ находится поиском.
 */

const TZ = 'Asia/Jerusalem'
// 1 августа 2026, летнее время (+03:00)
const at = (day, h, m = 0) => new Date(Date.UTC(2026, 7, day, h - 3, m)).toISOString()
const NOW = Date.UTC(2026, 7, 1, 12 - 3, 30) // 12:30 по времени точки
const DAY_START = dayStartMs(NOW, TZ)

function order(id, over = {}) {
  return {
    id, status: 'new', customer_name: 'Dana', customer_phone: '0500000000',
    order_type: 'takeaway', order_channel: 'counter_qr', items: [],
    total: 3200, created_at: at(1, 12), ...over,
  }
}

test('начало дня считается в зоне точки', () => {
  assert.equal(DAY_START, Date.UTC(2026, 7, 1, 0 - 3, 0))
  // 00:30 по Иерусалиму — это ещё 21:30 UTC предыдущих суток
  assert.equal(dayStartMs(Date.UTC(2026, 7, 0, 21, 30), TZ), DAY_START)
})

test('короткая ссылка стабильна и читаема', () => {
  const id = '3f2a1b4c-5d6e-7f80-9a1b-2c3d4e5f6a7b'
  assert.equal(orderRef(id), '#F6A7B')
  assert.equal(orderRef(id), orderRef(id))
  assert.equal(orderRef(null), '#—')
})

test('незакрытый заказ прошлого дня уходит в отдельную корзину', () => {
  const buckets = bucketOrders([
    order('today-new'),
    order('yesterday-ready', { status: 'ready', created_at: at(0, 19) }),
    order('yesterday-accepted', { status: 'accepted', created_at: at(0, 20) }),
  ], DAY_START)
  assert.deepEqual(buckets.fresh.map((o) => o.id), ['today-new'])
  assert.deepEqual(buckets.stale.map((o) => o.id), ['yesterday-accepted', 'yesterday-ready'])
  assert.equal(buckets.ready.length, 0)
  assert.equal(buckets.progress.length, 0)
})

test('сегодняшние заказы разложены по стадиям', () => {
  const buckets = bucketOrders([
    order('a', { status: 'new', created_at: at(1, 11) }),
    order('b', { status: 'accepted', created_at: at(1, 10) }),
    order('c', { status: 'preparing', created_at: at(1, 9) }),
    order('d', { status: 'ready', created_at: at(1, 8) }),
  ], DAY_START)
  assert.deepEqual(buckets.fresh.map((o) => o.id), ['a'])
  assert.deepEqual(buckets.progress.map((o) => o.id), ['c', 'b'])
  assert.deepEqual(buckets.ready.map((o) => o.id), ['d'])
  assert.equal(buckets.stale.length, 0)
})

test('в очереди первым стоит тот, кто ждёт дольше', () => {
  const buckets = bucketOrders([
    order('late', { created_at: at(1, 12, 20) }),
    order('early', { created_at: at(1, 9) }),
  ], DAY_START)
  assert.deepEqual(buckets.fresh.map((o) => o.id), ['early', 'late'])
})

test('просроченные показываются новыми вперёд', () => {
  const buckets = bucketOrders([
    order('old', { status: 'accepted', created_at: at(0, 9) }),
    order('newer', { status: 'accepted', created_at: at(0, 20) }),
  ], DAY_START)
  assert.deepEqual(buckets.stale.map((o) => o.id), ['newer', 'old'])
})

test('время без даты — только внутри текущего дня', () => {
  assert.equal(orderTimeLabel(at(1, 9, 5), DAY_START, TZ), '09:05')
  assert.equal(orderTimeLabel(at(0, 19, 40), DAY_START, TZ), '31 Jul · 19:40')
})

test('возраст заказа читается словами', () => {
  assert.equal(elapsedLabel(at(1, 12, 29), NOW), '1 min')
  assert.equal(elapsedLabel(at(1, 12, 30), NOW), 'just now')
  // Часы браузера отстают от сервера — заказ «из будущего» только что создан
  assert.equal(elapsedLabel(at(1, 12, 45), NOW), 'just now')
  assert.equal(elapsedLabel(at(1, 11, 30), NOW), '1 h 00 min')
  assert.equal(elapsedLabel(at(1, 10, 25), NOW), '2 h 05 min')
})

test('поиск находит по имени, телефону, ссылке, столу и позиции', () => {
  const list = [
    order('3f2a1b4c-5d6e-7f80-9a1b-2c3d4e5f6a7b', {
      customer_name: 'Yossi Cohen', customer_phone: '0521234567', table_label: '12',
      items: [{ name: 'Latte', variant_name: 'Large' }],
    }),
    order('aaaabbbb-cccc-dddd-eeee-ffff00001111', { customer_name: 'Dana Levi' }),
  ]
  const ids = (q) => filterOrders(list, { query: q }).map((o) => o.id)
  assert.equal(ids('yossi').length, 1)
  assert.equal(ids('1234567').length, 1)
  assert.equal(ids('#F6A7B').length, 1)
  assert.equal(ids('latte').length, 1)
  assert.equal(ids('дана').length, 0)
  assert.equal(filterOrders(list, {}).length, 2)
})

test('фильтры по статусу, типу и каналу складываются', () => {
  const list = [
    order('a', { status: 'ready', order_type: 'here', order_channel: 'table_qr' }),
    order('b', { status: 'ready', order_type: 'takeaway', order_channel: 'link' }),
    order('c', { status: 'new', order_type: 'here', order_channel: 'table_qr' }),
  ]
  assert.deepEqual(filterOrders(list, { status: 'ready' }).map((o) => o.id), ['a', 'b'])
  assert.deepEqual(filterOrders(list, { type: 'here' }).map((o) => o.id), ['a', 'c'])
  assert.deepEqual(
    filterOrders(list, { status: 'ready', channel: 'table_qr' }).map((o) => o.id),
    ['a']
  )
})

test('заявка без канала считается ссылкой — старые строки не пропадают', () => {
  const list = [order('a', { order_channel: undefined })]
  assert.equal(filterOrders(list, { channel: 'link' }).length, 1)
  assert.equal(filterOrders(list, { channel: 'website' }).length, 0)
})

test('номер заказа на кассе попадает в поиск — по нему и спрашивают', () => {
  const withPos = order('x', { pos: { daily_number: 42, status: 'paid' } })
  assert.ok(orderSearchText(withPos).includes('#42'))
  assert.equal(filterOrders([withPos], { query: '#42' }).length, 1)
})

test('режим обслуживания: явная настройка сильнее продукта', () => {
  assert.equal(fulfilmentMode(['pos'], {}), 'pos')
  assert.equal(fulfilmentMode(['online_orders'], {}), 'standalone')
  assert.equal(fulfilmentMode(['pos'], { online_orders: { fulfilment: 'standalone' } }), 'standalone')
  assert.equal(fulfilmentMode(['online_orders'], { online_orders: { fulfilment: 'pos' } }), 'pos')
})

test('строки позиций собираются из снапшота заявки', () => {
  const lines = orderItemLines([
    { menu_item_id: 'm1', name: 'Latte', variant_name: 'Large', mods: [{ name: 'Oat' }], qty: 2, line_total: 2400 },
  ])
  assert.equal(lines[0].text, 'Latte · Large · Oat')
  assert.equal(lines[0].qty, 2)
  assert.equal(lines[0].total, 2400)
})
