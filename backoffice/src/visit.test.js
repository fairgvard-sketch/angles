import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  dayDataWindow, guestSummary, orderSummary, primaryAction, rangeDataWindow,
  secondaryActions, toBooking, toTable, trimToWindow, visitHistory,
} from './visit.js'
import { blockState } from './timeline.js'

/**
 * Правила визита.
 *
 * Проверяется то, из-за чего модуль и появился: окно запроса не должно
 * зависеть от часового пояса, приехавшего в ответе (иначе полотно
 * грузится дважды), контекст гостя не должен состоять из нулей, а
 * история — из выдуманных по статусу событий.
 */

describe('окно данных', () => {
  it('не зависит от часового пояса точки и берёт сутки с запасом', () => {
    const win = dayDataWindow('2026-05-17')
    assert.equal(new Date(win.fromMs).toISOString(), '2026-05-16T00:00:00.000Z')
    assert.equal(new Date(win.toMs).toISOString(), '2026-05-19T00:00:00.000Z')
  })

  it('запас покрывает любой пояс: полночь в Окленде и в Гонолулу внутри окна', () => {
    const win = dayDataWindow('2026-05-17')
    // UTC+13 и UTC−10 — крайние обитаемые смещения
    assert.ok(Date.parse('2026-05-16T11:00:00Z') > win.fromMs)
    assert.ok(Date.parse('2026-05-18T10:00:00Z') < win.toMs)
  })

  it('отрезок в днях берёт тот же запас по краям', () => {
    const win = rangeDataWindow('2026-05-17', 7)
    assert.equal(new Date(win.fromMs).toISOString(), '2026-05-16T00:00:00.000Z')
    assert.equal(new Date(win.toMs).toISOString(), '2026-05-25T00:00:00.000Z')
  })

  it('мусорная дата не превращается в NaN-окно', () => {
    assert.equal(dayDataWindow('позавчера'), null)
    assert.equal(rangeDataWindow('', 7), null)
  })

  it('запас обрезается по настоящему окну, а не показывается лишним днём', () => {
    const rows = [
      { reserved_at: '2026-05-16T20:00:00Z' },
      { reserved_at: '2026-05-17T12:00:00Z' },
      { reserved_at: '2026-05-18T09:00:00Z' },
    ]
    const kept = trimToWindow(rows,
      Date.parse('2026-05-17T00:00:00Z'), Date.parse('2026-05-18T00:00:00Z'))
    assert.equal(kept.length, 1)
    assert.equal(kept[0].reserved_at, '2026-05-17T12:00:00Z')
  })
})

describe('строка визита', () => {
  const base = {
    id: 'r1', reserved_at: '2026-05-17T16:00:00Z', duration_min: 90,
    status: 'confirmed', customer_name: 'Мири', party_size: 3,
    customer_phone: '0501112233', table_ids: ['t2', 't5'],
  }

  it('столы берутся связью, основной остаётся первым', () => {
    const b = toBooking(base, blockState)
    assert.deepEqual(b.tableIds, ['t2', 't5'])
    assert.equal(b.endMs - b.startMs, 90 * 60_000)
  })

  it('бронь без связи не теряет столы: запасной путь через table_id', () => {
    const b = toBooking(
      { ...base, table_ids: [], table_id: 't9', hold_table_ids: ['t10'] }, blockState)
    assert.deepEqual(b.tableIds, ['t9', 't10'])
  })

  it('длительность по умолчанию совпадает с серверной', () => {
    const b = toBooking({ ...base, duration_min: null }, blockState)
    assert.equal(b.endMs - b.startMs, 90 * 60_000)
  })

  it('посадка в POS-заказ помечена', () => {
    assert.equal(toBooking(base, blockState).posSeated, false)
    assert.equal(toBooking({ ...base, order_id: 'o1' }, blockState).posSeated, true)
  })

  it('выключенный стол приезжает с признаком, а не пропадает', () => {
    const t = toTable({ id: 't1', label: '1', seats: 4, blocked: true, zone_name: 'Зал' })
    assert.equal(t.blocked, true)
    assert.equal(t.zoneName, 'Зал')
    assert.equal(t.seats, 4)
  })
})

describe('главное действие', () => {
  const actions = [
    { key: 'arrived', label: 'Guest seated', tone: 'primary' },
    { key: 'completed', label: 'Completed' },
    { key: 'cancelled', label: 'Cancel booking', tone: 'danger', confirm: true },
  ]

  it('первым стоит то, что нужно сейчас', () => {
    assert.equal(primaryAction(actions).key, 'arrived')
  })

  it('остальное уходит вниз и не дублирует главное', () => {
    const rest = secondaryActions(actions)
    assert.equal(rest.length, 2)
    assert.ok(!rest.some((a) => a.key === 'arrived'))
  })

  it('у терминального визита главного действия нет', () => {
    assert.equal(primaryAction([]), null)
    assert.deepEqual(secondaryActions([]), [])
  })
})

describe('контекст гостя', () => {
  it('у нового гостя контекста нет — три нуля это не контекст', () => {
    assert.equal(guestSummary({ visits: 0, no_shows: 0, cancelled: 0 }), null)
    assert.equal(guestSummary(null), null)
  })

  it('постоянный гость назван словом', () => {
    const s = guestSummary({ visits: 4, no_shows: 0, cancelled: 1 })
    assert.equal(s.text, '4 visits · 1 cancellation')
    assert.equal(s.returning, true)
    assert.equal(s.warn, false)
  })

  it('единственное число не пишется как «1 visits»', () => {
    assert.equal(guestSummary({ visits: 1, no_shows: 1, cancelled: 0 }).text,
      '1 visit · 1 no-show')
  })

  it('повторные неявки предупреждают смену, одна — нет', () => {
    assert.equal(guestSummary({ visits: 0, no_shows: 1, cancelled: 0 }).warn, false)
    assert.equal(guestSummary({ visits: 0, no_shows: 2, cancelled: 0 }).warn, true)
  })
})

describe('сводка заказа', () => {
  const money = (a) => `₪${(a / 100).toFixed(2)}`

  it('без кассы сводки нет, а не ноль', () => {
    assert.equal(orderSummary(null, money), null)
    assert.equal(orderSummary({ id: null }, money), null)
  })

  it('оплата названа отдельно от того, что заказ открыт', () => {
    const paid = orderSummary({ id: 'o1', number: 42, status: 'paid', total: 12500, paid: true }, money)
    assert.equal(paid.total, '₪125.00')
    assert.equal(paid.label, 'Paid')
    const open = orderSummary({ id: 'o2', number: 43, status: 'open', total: 4000, paid: false }, money)
    assert.equal(open.label, 'Not paid yet')
  })
})

describe('история визита', () => {
  it('заведение визита названо по записанному пути, а не по догадке', () => {
    const h = visitHistory({ created_at: '2026-05-17T10:00:00Z', created_via: 'public' })
    assert.equal(h[0].text, 'Booked by the guest online')
  })

  it('у брони без записанного пути путь не выдумывается', () => {
    const h = visitHistory({ created_at: '2026-05-17T10:00:00Z', created_via: null })
    assert.equal(h[0].text, 'Booking created')
  })

  it('события идут по времени и включают только записанные факты', () => {
    const h = visitHistory({
      created_at: '2026-05-17T10:00:00Z',
      created_via: 'public',
      rules_ack: { accepted_at: '2026-05-17T10:00:30Z' },
      confirm_requested_at: '2026-05-17T12:00:00Z',
      guest_confirmed_at: '2026-05-17T12:30:00Z',
      arrived_at: '2026-05-17T16:05:00Z',
    })
    assert.deepEqual(h.map((e) => e.kind),
      ['created', 'rules', 'asked', 'confirmed', 'seated'])
    assert.ok(h[0].at < h[4].at)
  })

  it('незаписанный переход не появляется из статуса', () => {
    const h = visitHistory({
      created_at: '2026-05-17T10:00:00Z', created_via: 'pos', status: 'completed',
    })
    assert.equal(h.length, 1)
    assert.ok(!h.some((e) => e.kind === 'completed'))
  })

  it('записанное событие (153) встаёт в ту же ленту', () => {
    const h = visitHistory(
      { created_at: '2026-05-17T10:00:00Z', created_via: 'pos' },
      [{ type: 'completed', at: '2026-05-17T18:00:00Z', actor_name: 'Дана' }],
    )
    assert.equal(h.length, 2)
    assert.equal(h[1].text, 'Visit completed by Дана')
  })
})
