import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  attentionItems, fleetSummary, ordersSummary, reservationsSummary,
} from './dashboard.js'

/**
 * Правила дашборда.
 *
 * Главное здесь — «требует внимания»: список, который решает, что
 * владелец увидит первым делом. Ошибка в нём дороже вёрстки: лишний
 * пункт превращает экран в шум, пропущенный — в ложное спокойствие.
 */

const TZ = 'Asia/Jerusalem'
const NOW = new Date('2026-08-02T12:00:00+03:00').getTime()
const at = (h, m = 0) => new Date(`2026-08-02T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+03:00`).toISOString()
const yesterday = (h) => new Date(`2026-08-01T${String(h).padStart(2, '0')}:00:00+03:00`).toISOString()

const posContext = {
  capabilities: ['pos_operate', 'pos_reports', 'orders_desk', 'reservations_desk', 'online_orders', 'public_reservations', 'public_menu'],
}
const reserveOnly = { capabilities: ['reservations_desk', 'public_reservations'] }
const locations = [{ id: 'loc-1', name: 'Пинскер 29' }, { id: 'loc-2', name: 'Ротшильд 12' }]

describe('сводка заказов', () => {
  const orders = [
    { id: 'o1', status: 'new', created_at: at(11, 30) },
    { id: 'o2', status: 'preparing', created_at: at(11, 0) },
    { id: 'o3', status: 'ready', created_at: at(10, 0) },
    { id: 'o4', status: 'accepted', created_at: yesterday(20) },
  ]

  it('отделяет незакрытое из прошлых дней от сегодняшней работы', () => {
    const s = ordersSummary(orders, NOW, TZ)
    assert.equal(s.waiting, 1)
    assert.equal(s.inProgress, 1)
    assert.equal(s.ready, 1)
    assert.equal(s.stale, 1)
    assert.equal(s.today, 3, 'вчерашний незакрытый не считается сегодняшним')
  })

  it('дольше всех ждёт — тот, кому ещё не ответили', () => {
    assert.equal(ordersSummary(orders, NOW, TZ).oldestAt, at(11, 30))
  })

  it('без данных возвращает null, а не выдуманные нули', () => {
    assert.equal(ordersSummary(undefined, NOW, TZ), null)
  })
})

describe('сводка визитов', () => {
  const list = [
    { id: 'r1', status: 'new', reserved_at: at(19, 0), party_size: 2, is_test: false },
    { id: 'r2', status: 'confirmed', reserved_at: at(20, 30), party_size: 4, is_test: false },
    { id: 'r3', status: 'confirmed', reserved_at: at(9, 0), party_size: 6, is_test: false },
    { id: 'r4', status: 'confirmed', reserved_at: at(21, 0), party_size: 8, is_test: true },
  ]

  it('тестовая бронь не попадает ни в счёт, ни в ближайшие', () => {
    const s = reservationsSummary(list, NOW)
    assert.equal(s.today, 3)
    assert.equal(s.guests, 12)
    assert.ok(!s.upcoming.some((v) => v.is_test))
  })

  it('следующий — ближайший ещё не наступивший', () => {
    const s = reservationsSummary(list, NOW)
    assert.equal(s.next.id, 'r1')
    assert.equal(s.pending, 1)
  })

  it('когда все визиты уже начались, ближайших нет', () => {
    const past = list.map((v) => ({ ...v, reserved_at: at(9, 0) }))
    assert.equal(reservationsSummary(past, NOW).upcoming.length, 0)
  })
})

describe('сводка парка касс', () => {
  const devices = [
    { id: 'd1', name: 'Стойка 1', silence_seconds: 60, outbox_failed: 0, archived_at: null },
    { id: 'd2', name: 'Стойка 2', silence_seconds: 9000, outbox_failed: 0, archived_at: null },
    { id: 'd3', name: 'Списанная', silence_seconds: 999999, outbox_failed: 0, archived_at: '2026-07-01T00:00:00Z' },
  ]

  it('архивные кассы не считаются проблемой', () => {
    const s = fleetSummary(devices)
    assert.equal(s.total, 2)
    assert.equal(s.online, 1)
    assert.equal(s.problems, 1)
    assert.equal(s.worst.id, 'd2')
  })
})

describe('«требует внимания»', () => {
  const base = {
    context: posContext, locations, nowMs: NOW, tz: TZ,
    fleet: [{ id: 'd1', name: 'Стойка 1', silence_seconds: 60, outbox_failed: 0, archived_at: null }],
    orders: [],
    reservations: [],
    shifts: [{ location_id: 'loc-1' }, { location_id: 'loc-2' }],
    channels: { orders: true, reservations: true, slug: 'bulochka', locationId: 'loc-1' },
  }

  it('когда всё в порядке — список пуст, а не заполнен ради вида', () => {
    assert.deepEqual(attentionItems(base), [])
  })

  it('молчащая касса идёт первой и объясняет, что делать', () => {
    const items = attentionItems({
      ...base,
      fleet: [{ id: 'd2', name: 'Стойка 2', silence_seconds: 9000, outbox_failed: 0, archived_at: null }],
      orders: [{ id: 'o1', status: 'new', created_at: at(11, 30) }],
    })
    assert.equal(items[0].id, 'devices')
    assert.match(items[0].title, /Стойка 2/)
    assert.ok(items[0].detail, 'у проблемы должен быть совет')
    assert.equal(items[0].action.view, 'devices')
    assert.equal(items[1].id, 'orders-waiting')
  })

  it('заявка без ответа и вчерашний хвост — разные пункты', () => {
    const items = attentionItems({
      ...base,
      orders: [
        { id: 'o1', status: 'new', created_at: at(11, 30) },
        { id: 'o2', status: 'accepted', created_at: yesterday(20) },
      ],
    })
    const ids = items.map((i) => i.id)
    assert.deepEqual(ids, ['orders-waiting', 'orders-stale'])
    assert.equal(items[0].tone, 'alert')
    assert.equal(items[1].tone, 'warn')
  })

  it('бронь без подтверждения объясняет, чем это грозит гостю', () => {
    const items = attentionItems({
      ...base,
      reservations: [{ id: 'r1', status: 'new', reserved_at: at(19, 0), party_size: 2, is_test: false }],
    })
    assert.equal(items[0].id, 'reservations')
    assert.equal(items[0].action.view, 'reservations')
  })

  it('смена: молчим, когда не открыта нигде — это ночь, а не проблема', () => {
    const none = attentionItems({ ...base, shifts: [] })
    assert.ok(!none.some((i) => i.id === 'shift'), 'ночью кабинет не должен ругаться')

    const partial = attentionItems({ ...base, shifts: [{ location_id: 'loc-1' }] })
    const shift = partial.find((i) => i.id === 'shift')
    assert.ok(shift, 'одна точка работает, другая нет — это стоит показать')
    assert.match(shift.title, /Ротшильд 12/)
  })

  it('выключенный канал ведёт прямо в свою вкладку', () => {
    const items = attentionItems({
      ...base,
      channels: { orders: false, reservations: false, slug: '', locationId: 'loc-1' },
    })
    const rsv = items.find((i) => i.id === 'channel-reservations')
    assert.equal(rsv.action.tab, 'reservations')
  })

  it('reserve-клиенту не показывают ни смену, ни кассы, ни заказы', () => {
    const items = attentionItems({
      ...base,
      context: reserveOnly,
      shifts: [],
      orders: [{ id: 'o1', status: 'new', created_at: at(11, 30) }],
      channels: { orders: false, reservations: false, slug: '', locationId: 'loc-1' },
      reservations: [{ id: 'r1', status: 'new', reserved_at: at(19, 0), party_size: 2, is_test: false }],
    })
    const ids = items.map((i) => i.id)
    assert.ok(ids.includes('reservations'))
    assert.ok(ids.includes('channel-reservations'))
    assert.ok(!ids.includes('shift'), 'у клиента без кассы смены не существует')
    assert.ok(!ids.includes('channel-orders'), 'и онлайн-заказов он не покупал')
    // Заказы приходят из данных, но без capability их не запрашивают —
    // фильтрация происходит на загрузке, а не здесь
  })
})
