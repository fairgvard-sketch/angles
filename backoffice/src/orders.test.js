import test from 'node:test'
import assert from 'node:assert/strict'
import {
  REALTIME_STALE_MS, STATUS_LABELS, STATUS_TONE,
  activityActor, activityLabel,
  bucketOrders, dayStartMs, elapsedLabel, formatMoney, itemsLabel,
  orderItemLines, orderNumber, orderRef, orderTabs, orderTimeLabel,
  realtimeState, rowContext,
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






test('строки позиций собираются из снапшота заявки', () => {
  const lines = orderItemLines([
    { menu_item_id: 'm1', name: 'Latte', variant_name: 'Large', mods: [{ name: 'Oat' }], qty: 2, line_total: 2400 },
  ])
  assert.equal(lines[0].text, 'Latte · Large · Oat')
  assert.equal(lines[0].qty, 2)
  assert.equal(lines[0].total, 2400)
})

// ── Каркас и строка таблицы (Phase 1–2) ──────────────────────



test('вкладка предзаказов появляется только когда они есть', () => {
  assert.deepEqual(orderTabs(0, 'active').map((t) => t.key), ['active', 'all'])
  assert.deepEqual(orderTabs(2, 'active').map((t) => t.key), ['active', 'scheduled', 'all'])
  // Открытая по ссылке вкладка не должна исчезать под руками, даже если
  // последний предзаказ только что выдали.
  assert.deepEqual(orderTabs(0, 'scheduled').map((t) => t.key), ['active', 'scheduled', 'all'])
})

test('Live обещает свежесть, а не факт подписки', () => {
  const nowMs = NOW
  const fresh = { socket: 'live', lastOkMs: nowMs - 5_000, nowMs }
  assert.equal(realtimeState(fresh), 'live')
  // Сокет жив, а данные протухли — молчать об этом нельзя
  assert.equal(
    realtimeState({ ...fresh, lastOkMs: nowMs - REALTIME_STALE_MS - 1 }),
    'stale'
  )
  assert.equal(realtimeState({ ...fresh, failed: true }), 'stale')
  assert.equal(realtimeState({ ...fresh, socket: 'offline' }), 'reconnecting')
  // До первого удавшегося запроса «живым» называть нечего
  assert.equal(realtimeState({ socket: 'live', lastOkMs: null, nowMs }), 'connecting')
})

test('у каждого состояния заказа есть слово и свой тон', () => {
  for (const status of Object.keys(STATUS_LABELS)) {
    assert.ok(STATUS_LABELS[status], `${status}: нет подписи`)
    assert.ok(STATUS_TONE[status], `${status}: нет тона`)
  }
  // Отказ и отмена — одна и та же остановка, разные причины
  assert.equal(STATUS_TONE.rejected, STATUS_TONE.cancelled)
  // Тона броней в заказах не переиспользуются
  assert.ok(!Object.values(STATUS_TONE).includes('confirmed'))
  assert.ok(!Object.values(STATUS_TONE).includes('seated'))
})

test('заказ зовут номером, а не хвостом UUID', () => {
  assert.equal(orderNumber({ order_number: 1042, id: 'x' }), '#1042')
  // Строка без номера (сервер до 139) всё равно должна быть адресуемой
  assert.equal(
    orderNumber({ id: '3f2a1b4c-5d6e-7f80-9a1b-2c3d4e5f6a7b' }),
    '#F6A7B'
  )
})

test('в колонке гостя всегда есть чей это заказ', () => {
  assert.equal(rowContext({ customer_name: 'Yossi' }), 'Yossi')
  // За столом имя не спрашивают вовсе (099) — показываем стол
  assert.equal(rowContext({ table_label: '7' }), 'Table 7')
  // Безымянная заявка — это заказ у стойки, а не «—»
  assert.equal(rowContext({}), 'Counter')
})

test('позиции считаются штуками', () => {
  assert.equal(itemsLabel(3), '3 items')
  assert.equal(itemsLabel(1), '1 item')
  assert.equal(itemsLabel(0), '0 items')
  assert.equal(itemsLabel(undefined), '0 items')
})

test('сумма показывается в валюте точки, а не всегда в шекелях', () => {
  assert.equal(formatMoney(8600, 'ILS'), '₪86.00')
  assert.equal(formatMoney(8600, 'EUR'), '€86.00')
  assert.equal(formatMoney(null, 'ILS'), '₪0.00')
  // Неизвестный код валюты не повод спрятать сумму
  assert.match(formatMoney(1250, 'XYZ'), /12\.50/)
})

test('лента переходов говорит словами владельца, а не кодами', () => {
  // «new» в ленте читается как «новый», хотя означает «получен»
  assert.equal(activityLabel('new'), 'Received')
  assert.equal(activityLabel('preparing'), 'Preparing')
  assert.equal(activityLabel('weird'), 'weird')
})

test('у каждого события есть автор — человек или место', () => {
  assert.equal(activityActor({ actor_kind: 'guest' }), 'Guest')
  assert.equal(activityActor({ actor_kind: 'backoffice', actor_name: 'Дана' }), 'Дана')
  // Имени может не быть (старая запись) — тогда честнее назвать место
  assert.equal(activityActor({ actor_kind: 'backoffice' }), 'Back office')
  assert.equal(activityActor({ actor_kind: 'pos' }), 'Register')
  assert.equal(activityActor({ actor_kind: 'system' }), null)
})
