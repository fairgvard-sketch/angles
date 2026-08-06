import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  attentionItems, chartSummary, currentHour, fleetSummary, heroKind, hourlyComparison,
  ordersSummary, reservationsSummary, todayBars, worstDeviceLine,
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

  it('вчерашняя заявка, принятая на кассе, в незакрытые не попадает (142)', () => {
    // Иначе главная звала «разобрать» туда, где раздел заказов пуст: он
    // это правило знает с 142, а дашборд считал по-своему
    const s = ordersSummary([
      ...orders,
      { id: 'o5', status: 'accepted', created_at: yesterday(19), order_id: 'ord-1' },
    ], NOW, TZ)
    assert.equal(s.stale, 1, 'долгом остаётся только незакрытое кабинетом')
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

  it('худшая выбирается, а не берётся первой из ответа сервера', () => {
    const s = fleetSummary([
      { id: 'a', name: 'Молчит день', silence_seconds: 86400, outbox_failed: 0, archived_at: null },
      { id: 'b', name: 'Молчит неделю', silence_seconds: 604800, outbox_failed: 0, archived_at: null },
      { id: 'c', name: 'Очередь встала', silence_seconds: 120, outbox_failed: 3, archived_at: null },
    ])
    assert.equal(s.problems, 3)
    assert.equal(s.worst.id, 'c', 'непроданное в очереди дороже молчания')

    const silent = fleetSummary([
      { id: 'a', name: 'Молчит день', silence_seconds: 86400, outbox_failed: 0, archived_at: null },
      { id: 'b', name: 'Молчит неделю', silence_seconds: 604800, outbox_failed: 0, archived_at: null },
    ])
    assert.equal(silent.worst.id, 'b', 'из молчунов — самый долгий')
  })

  it('о нескольких кассах говорят про худшую, а не советуют как про одну', () => {
    assert.equal(
      worstDeviceLine({ name: 'Стойка 2', silence_seconds: 604800, outbox_failed: 0 }),
      'Silent the longest: Стойка 2, last seen 7d ago.'
    )
    assert.equal(
      worstDeviceLine({ name: 'Стойка 3', silence_seconds: 120, outbox_failed: 2 }),
      'Стойка 3 has sales stuck in its queue.'
    )
    assert.equal(
      worstDeviceLine({ name: 'Стойка 4', silence_seconds: null, outbox_failed: 0 }),
      'Стойка 4 has never reported in.'
    )
  })
})

describe('кривая дня', () => {
  const report = {
    by_hour: [
      { hour: 8, amount: 100_00, count: 3 },
      { hour: 10, amount: 50_00, count: 1 },
    ],
  }

  it('ось идёт до текущего часа, а тихие часы — нули, а не пропуски', () => {
    const bars = todayBars(report, NOW, TZ)
    assert.equal(currentHour(NOW, TZ), 12)
    assert.deepEqual(bars.map((b) => b.label), ['08', '09', '10', '11', '12'])
    assert.deepEqual(bars.map((b) => b.amount), [100_00, 0, 50_00, 0, 0])
  })

  it('чек в часе, которого по часам браузера ещё нет, не отрезается', () => {
    const bars = todayBars({ by_hour: [{ hour: 14, amount: 30_00, count: 1 }] }, NOW, TZ)
    assert.deepEqual(bars.map((b) => b.label), ['14'])
  })

  it('без продаж оси нет вовсе — рисовать плоский день значит соврать', () => {
    assert.deepEqual(todayBars({ by_hour: [] }, NOW, TZ), [])
    assert.deepEqual(todayBars(null, NOW, TZ), [])
  })

  it('кривая рассказана словами: окно и самый занятый час', () => {
    const text = chartSummary(todayBars(report, NOW, TZ), (v) => `₪${v / 100}`)
    assert.match(text, /Sales by hour, 08:00 to 13:00\./)
    assert.match(text, /Busiest 08:00–09:00, ₪100\./)
  })
})

describe('сравнение с вчера', () => {
  const today = { by_hour: [{ hour: 8, amount: 100_00 }, { hour: 12, amount: 999_00 }] }
  const before = { by_hour: [{ hour: 8, amount: 80_00 }, { hour: 12, amount: 500_00 }] }

  it('текущий час не считается: у вчера он прожит целиком, у сегодня — нет', () => {
    const c = hourlyComparison(today, before, NOW, TZ)
    assert.equal(c.current, 100_00, 'идущий час в сумму не входит')
    assert.equal(c.previous, 80_00)
    assert.equal(c.text, '+25%')
    assert.equal(c.direction, 'up')
    assert.equal(c.at, '12:00', 'подпись называет границу сравнения')
  })

  it('вчера в это время не было продаж — «было пусто», а не бесконечный рост', () => {
    const c = hourlyComparison(today, { by_hour: [] }, NOW, TZ)
    assert.equal(c.text, 'was none')
  })

  it('обе стороны пусты — сравнивать нечего, и это честный ответ', () => {
    assert.equal(hourlyComparison({ by_hour: [] }, { by_hour: [] }, NOW, TZ), null)
  })

  it('до первого закрытого часа сравнения нет', () => {
    const midnight = new Date('2026-08-02T00:20:00+03:00').getTime()
    assert.equal(hourlyComparison(today, before, midnight, TZ), null)
  })

  it('вчера не приехало — блок живёт без сравнения', () => {
    assert.equal(hourlyComparison(today, null, NOW, TZ), null)
  })
})

describe('чем открывается день', () => {
  it('касса меряет день деньгами, standalone-заказы — очередью, Reserve — визитами', () => {
    assert.equal(heroKind(posContext), 'sales')
    assert.equal(heroKind({ capabilities: ['orders_desk', 'public_menu'] }), 'orders')
    assert.equal(heroKind(reserveOnly), 'bookings')
  })

  it('Menu-клиенту мерить нечем — блока нет вовсе', () => {
    assert.equal(heroKind({ capabilities: ['public_menu'] }), null)
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

  it('заявка на активацию видна здесь — карточка продуктов уехала в аккаунт', () => {
    const items = attentionItems({
      ...base,
      context: { ...posContext, products: ['pos'], product_requests: ['reservations'] },
    })
    const pending = items.find((i) => i.id === 'products-pending')
    assert.match(pending.title, /ANGLE Reserve/)
    assert.equal(pending.action.view, 'settings')
    assert.equal(items[items.length - 1].id, 'products-pending', 'ждать оператора — последнее по срочности')
  })

  it('активный продукт заявкой не считается', () => {
    const items = attentionItems({
      ...base,
      context: { ...posContext, products: ['pos', 'reservations'], product_requests: [] },
    })
    assert.ok(!items.some((i) => i.id === 'products-pending'))
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
