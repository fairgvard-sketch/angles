import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  QUEUE_GROUPS, formatWait, groupQueue, isOpen, isOverdue, moveInQueue,
  queueErrorText, sortQueue, statusLabel, waitedMin,
} from './waitlist.js'

/**
 * Правила очереди.
 *
 * Проверяется то, из-за чего очередь и переделывалась: порядок
 * предсказуем, счётчик ожидания останавливается на посадке, перебор
 * обещанного времени виден, а переставить гостя можно без мыши.
 */

const min = 60_000
const now = Date.UTC(2026, 4, 17, 19, 0)
const ago = (m) => new Date(now - m * min).toISOString()

const entry = (id, over = {}) => ({
  id,
  customer_name: id,
  status: 'waiting',
  created_at: ago(10),
  position: null,
  quoted_min: null,
  ...over,
})

const ids = (list) => list.map((e) => e.id)

describe('порядок очереди', () => {
  it('переставленные вручную идут первыми, остальные по времени записи', () => {
    const rows = [
      entry('c', { created_at: ago(5) }),
      entry('a', { created_at: ago(30), position: 2 }),
      entry('b', { created_at: ago(20), position: 1 }),
    ]
    assert.deepEqual(ids(sortQueue(rows)), ['b', 'a', 'c'])
  })

  it('нетронутый гость не уезжает в конец из-за перестановки соседа', () => {
    const rows = [
      entry('old', { created_at: ago(40) }),
      entry('moved', { created_at: ago(5), position: 1 }),
      entry('newer', { created_at: ago(2) }),
    ]
    assert.deepEqual(ids(sortQueue(rows)), ['moved', 'old', 'newer'])
  })

  it('исходный массив не переворачивается на месте', () => {
    const rows = [entry('b', { position: 2 }), entry('a', { position: 1 })]
    const before = ids(rows)
    sortQueue(rows)
    assert.deepEqual(ids(rows), before)
  })
})

describe('группы', () => {
  it('ждущие, уведомлённые, посаженные и ушедшие разведены', () => {
    const rows = [
      entry('w'),
      entry('n', { status: 'offered' }),
      entry('s', { status: 'converted' }),
      entry('x', { status: 'cancelled' }),
      entry('e', { status: 'expired' }),
    ]
    const groups = groupQueue(rows)
    assert.deepEqual(groups.map((g) => g.key), ['waiting', 'notified', 'seated', 'closed'])
    assert.deepEqual(ids(groups[3].rows), ['x', 'e'])
  })

  it('пустые группы не рисуются', () => {
    assert.deepEqual(groupQueue([entry('w')]).map((g) => g.key), ['waiting'])
    assert.deepEqual(groupQueue([]), [])
  })

  it('состояние очереди говорит теми же словами, что и бронь', () => {
    assert.equal(statusLabel('converted'), 'Seated')
    assert.equal(statusLabel('offered'), 'Notified')
    assert.equal(statusLabel('cancelled'), 'Removed')
  })

  it('двигать и сажать можно только тех, кто ещё ждёт', () => {
    assert.equal(isOpen(entry('w')), true)
    assert.equal(isOpen(entry('n', { status: 'offered' })), true)
    assert.equal(isOpen(entry('s', { status: 'converted' })), false)
  })

  it('порядок групп задан один раз и не зависит от данных', () => {
    assert.deepEqual(QUEUE_GROUPS.map((g) => g.key),
      ['waiting', 'notified', 'seated', 'closed'])
  })
})

describe('время ожидания', () => {
  it('считается от записи', () => {
    assert.equal(waitedMin(entry('a', { created_at: ago(12) }), now), 12)
  })

  it('у посаженного счётчик замирает', () => {
    // Иначе на человеке, который час назад поел и ушёл, будет висеть
    // «ждёт 90 минут»
    const seated = entry('s', { status: 'converted', created_at: ago(90), offer_at: ago(60) })
    assert.equal(waitedMin(seated, now), 30)
  })

  it('у закрытой записи без отметки ответ неизвестен, а не ноль', () => {
    // «0 min» на человеке, который ждал полчаса, — выдумка: момент
    // посадки схема не хранит, и делать вид, что он ноль, нельзя
    const seated = entry('s', { status: 'converted', created_at: ago(40) })
    assert.equal(waitedMin(seated, now), null)
    assert.equal(formatWait(waitedMin(seated, now)), '—')
  })

  it('перебор обещанного времени виден', () => {
    const quoted = entry('q', { created_at: ago(35), quoted_min: 20 })
    assert.equal(isOverdue(quoted, now), true)
    assert.equal(isOverdue(entry('q2', { created_at: ago(10), quoted_min: 20 }), now), false)
  })

  it('без обещания перебора не бывает — и посаженный не «просрочен»', () => {
    assert.equal(isOverdue(entry('a', { created_at: ago(200) }), now), false)
    assert.equal(isOverdue(entry('s', {
      status: 'converted', created_at: ago(200), quoted_min: 10,
    }), now), false)
  })

  it('время читается на бегу', () => {
    assert.equal(formatWait(12), '12 min')
    assert.equal(formatWait(65), '1 h 05 min')
    assert.equal(formatWait(null), '—')
  })
})

describe('перестановка без мыши', () => {
  const rows = [
    entry('a', { created_at: ago(30) }),
    entry('b', { created_at: ago(20) }),
    entry('c', { created_at: ago(10) }),
  ]

  it('вверх меняет местами с предыдущим', () => {
    assert.deepEqual(moveInQueue(rows, 'c', 'up'), ['a', 'c', 'b'])
  })

  it('вниз меняет местами со следующим', () => {
    assert.deepEqual(moveInQueue(rows, 'a', 'down'), ['b', 'a', 'c'])
  })

  it('за край очереди не двигают', () => {
    assert.equal(moveInQueue(rows, 'a', 'up'), null)
    assert.equal(moveInQueue(rows, 'c', 'down'), null)
  })

  it('закрытые и уже позванные в порядке не участвуют', () => {
    // Посаженный между ждущими не должен «съедать» шаг перестановки, а
    // уведомлённый гость уже вызван — его очередь кончилась
    const mixed = [
      entry('a', { created_at: ago(30) }),
      entry('s', { status: 'converted', created_at: ago(25) }),
      entry('n', { status: 'offered', created_at: ago(22) }),
      entry('b', { created_at: ago(20) }),
    ]
    assert.deepEqual(moveInQueue(mixed, 'b', 'up'), ['b', 'a'])
    assert.equal(moveInQueue(mixed, 's', 'up'), null)
    assert.equal(moveInQueue(mixed, 'n', 'up'), null)
  })
})

describe('ошибки сервера объясняются по-человечески', () => {
  it('нет свободного стола — это не «full_slot»', () => {
    assert.match(queueErrorText('full_slot'), /No free table/)
  })

  it('чужие сообщения не проглатываются', () => {
    assert.equal(queueErrorText('boom'), 'boom')
  })
})
