import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  conflictAlternatives, isConflict, nearestFreeTimes, occupancyByTable, tablesFreeAt,
} from './desk-availability.js'

/**
 * Подсказки после отказа сервера.
 *
 * Это подсказка, а не разрешение: занятость решает сервер. Поэтому
 * проверяется ровно одно — что предложенное действительно свободно ПО
 * ТЕМ ЖЕ данным, что видит хостес. Предложить занятый стол хуже, чем не
 * предложить ничего: хостес нажмёт, получит второй отказ и перестанет
 * верить экрану.
 */

const iso = (h, m = 0) => `2026-08-02T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+03:00`
const ms = (h, m = 0) => new Date(iso(h, m)).getTime()

const tables = [
  { id: 't1', label: '1', seats: 2, blocked: false },
  { id: 't2', label: '2', seats: 4, blocked: false },
  { id: 't3', label: '3', seats: 6, blocked: true },
]

const bookings = [
  { id: 'b1', status: 'confirmed', reserved_at: iso(19), duration_min: 90, table_id: 't1' },
  { id: 'b2', status: 'new', reserved_at: iso(19, 30), duration_min: 60, table_id: 't2' },
  { id: 'b3', status: 'cancelled', reserved_at: iso(19), duration_min: 90, table_id: 't2' },
]

describe('занятость столов', () => {
  it('отменённый визит стол не держит', () => {
    const map = occupancyByTable(bookings)
    assert.equal(map.get('t1').length, 1)
    assert.equal(map.get('t2').length, 1, 'отменённая бронь не в счёт')
  })

  it('составная посадка занимает все свои столы', () => {
    const map = occupancyByTable([
      { id: 'b', status: 'confirmed', reserved_at: iso(20), duration_min: 90, table_id: 't1', hold_table_ids: ['t2'] },
    ])
    assert.ok(map.has('t1') && map.has('t2'))
  })

  it('правку самого визита можно исключить — иначе он мешает сам себе', () => {
    const map = occupancyByTable(bookings, { ignoreId: 'b1' })
    assert.equal(map.has('t1'), false)
  })
})

describe('свободные столы на время', () => {
  it('занятый и заблокированный не предлагаются', () => {
    const map = occupancyByTable(bookings)
    const free = tablesFreeAt(tables, map, ms(19, 30), { partySize: 2 })
    assert.deepEqual(free.map((t) => t.id), [], 'в 19:30 оба живых стола заняты')

    const later = tablesFreeAt(tables, map, ms(21, 0), { partySize: 2 })
    assert.deepEqual(later.map((t) => t.id), ['t1', 't2'])
    assert.ok(!later.some((t) => t.id === 't3'), 'заблокированный стол не свободен, он выключен')
  })

  it('маленький стол не предлагается большой компании', () => {
    const map = occupancyByTable([])
    assert.deepEqual(
      tablesFreeAt(tables, map, ms(21), { partySize: 4 }).map((t) => t.id),
      ['t2'],
    )
  })
})

describe('ближайшее свободное время', () => {
  it('предлагает время, когда стол действительно свободен', () => {
    const times = nearestFreeTimes(tables, bookings, ms(19, 30), { partySize: 2, limit: 2 })
    assert.ok(times.length > 0)
    for (const slot of times) {
      const map = occupancyByTable(bookings)
      assert.ok(
        tablesFreeAt(tables, map, slot.at, { partySize: 2 }).length > 0,
        `предложено ${new Date(slot.at).toISOString()}, но там занято`,
      )
    }
  })

  it('ближайшее по времени идёт первым, независимо от стороны', () => {
    const times = nearestFreeTimes(tables, bookings, ms(19, 30), { partySize: 2, limit: 3 })
    const gaps = times.map((t) => Math.abs(t.at - ms(19, 30)))
    assert.deepEqual(gaps, [...gaps].sort((a, b) => a - b))
  })

  it('когда всё занято в окне — пусто, а не «что-нибудь»', () => {
    const full = tables.filter((t) => !t.blocked).map((t, i) => ({
      id: `x${i}`, status: 'confirmed', reserved_at: iso(12), duration_min: 12 * 60, table_id: t.id,
    }))
    assert.deepEqual(nearestFreeTimes(tables, full, ms(19), { partySize: 2 }), [])
  })
})

describe('варианты при конфликте', () => {
  it('отдаёт и столы на это время, и ближайшие времена', () => {
    const alt = conflictAlternatives({
      tables, bookings, wantedMs: ms(19, 30), partySize: 2,
    })
    assert.deepEqual(alt.tables, [])
    assert.ok(alt.times.length > 0)
  })

  it('без валидного времени ничего не выдумывает', () => {
    assert.deepEqual(
      conflictAlternatives({ tables, bookings, wantedMs: NaN }),
      { tables: [], times: [] },
    )
  })

  it('предлагает варианты только там, где есть что предложить', () => {
    assert.equal(isConflict('table_busy'), true)
    assert.equal(isConflict('full_slot'), true)
    assert.equal(isConflict('name_required'), false)
    assert.equal(isConflict('access denied'), false)
  })
})
