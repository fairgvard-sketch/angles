import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  blockDetail, blockWidthPx, halfHourMarks, overlappingVisits, showsMeta, showsName,
} from './timeline-view.js'
import { hourTicks } from './timeline.js'

/**
 * Подача блока и разметка получасов.
 *
 * Смысл проверок — в приоритете: короткий визит теряет метаданные, но не
 * время, а получасовые деления встают по часовым отметкам, а не по
 * «каждые 48 пикселей от края».
 */

// Час полотна — 96 px
const minutes = (n) => (n / 60) * 96

describe('подробность блока', () => {
  it('долгий визит показывает и конец времени', () => {
    assert.equal(blockDetail(minutes(150)), 'wide')
  })

  it('обычная бронь на 90 минут говорит состояние словом', () => {
    // Ради этого порог и существует: цвет — подсказка, слово — факт
    const level = blockDetail(minutes(90))
    assert.equal(level, 'full')
    assert.equal(showsMeta(level), true)
  })

  it('часовой визит оставляет время и имя, а метаданные роняет', () => {
    const level = blockDetail(minutes(60))
    assert.equal(level, 'name')
    assert.equal(showsName(level), true)
    assert.equal(showsMeta(level), false)
  })

  it('получасовой визит оставляет только время начала', () => {
    const level = blockDetail(minutes(30))
    assert.equal(level, 'minimal')
    assert.equal(showsName(level), false)
  })

  it('мусор вместо ширины не выдаёт «полный» блок', () => {
    assert.equal(blockDetail(undefined), 'minimal')
    assert.equal(blockDetail(NaN), 'minimal')
  })

  it('ширина считается от доли трека', () => {
    assert.equal(blockWidthPx(25, 800), 200)
    assert.equal(blockWidthPx(undefined, 800), 0)
  })
})

describe('с кем столкнулась бронь', () => {
  const table = { id: 't1', label: '1', seats: 4 }
  const visit = (id, from, to, extra = {}) => ({
    booking: { id, startMs: from, endMs: to, guestName: id, state: 'confirmed', ...extra },
    conflict: false,
  })

  it('называет соседа по столу, а не просто «конфликт»', () => {
    const a = visit('a', 100, 300)
    const b = visit('b', 200, 400)
    a.conflict = true
    b.conflict = true
    const rows = [{ table, blocks: [a, b] }]
    const found = overlappingVisits(rows, 'a')
    assert.equal(found.length, 1)
    assert.equal(found[0].booking.id, 'b')
    assert.equal(found[0].table.label, '1')
  })

  it('соседний по времени, но не пересекающийся визит конфликтом не считается', () => {
    const rows = [{ table, blocks: [visit('a', 100, 200), visit('b', 200, 300)] }]
    assert.deepEqual(overlappingVisits(rows, 'a'), [])
  })

  it('объединённые столы не дублируют один и тот же чужой визит', () => {
    // Бронь занимает два стола, и на обоих пересекается с одной и той же
    const a1 = visit('a', 100, 300); a1.conflict = true
    const b1 = visit('b', 200, 400); b1.conflict = true
    const a2 = visit('a', 100, 300); a2.conflict = true
    const b2 = visit('b', 200, 400); b2.conflict = true
    const rows = [
      { table, blocks: [a1, b1] },
      { table: { id: 't2', label: '2', seats: 2 }, blocks: [a2, b2] },
    ]
    assert.equal(overlappingVisits(rows, 'a').length, 1)
  })

  it('без брони и без строк ничего не выдумывает', () => {
    assert.deepEqual(overlappingVisits(null, 'a'), [])
    assert.deepEqual(overlappingVisits([{ table, blocks: [] }], 'a'), [])
  })
})

describe('получасовые деления', () => {
  const tz = 'Asia/Jerusalem'
  // Окно с 09:30 — начало НЕ ровно час: именно тут ломалась бы раздача
  // делений от левого края
  const win = {
    startMs: Date.UTC(2026, 4, 17, 6, 30),
    endMs: Date.UTC(2026, 4, 17, 12, 0),
  }
  const ticks = hourTicks(win, tz)

  it('деление стоит ровно посередине между часами', () => {
    const marks = halfHourMarks(ticks, win)
    const first = marks[0]
    const hour = ticks[0]
    // Первая отметка — 07:00 UTC, значит первое деление 06:30+... — то,
    // что до неё, приходит из «виртуального» предыдущего часа
    assert.ok(marks.length > 0)
    assert.equal((first.ts - hour.ts) % 1_800_000, 0)
    for (const mark of marks) {
      assert.ok(mark.leftPct > 0 && mark.leftPct < 100)
    }
  })

  it('деления не выходят за окно дня', () => {
    for (const mark of halfHourMarks(ticks, win)) {
      assert.ok(mark.ts > win.startMs && mark.ts < win.endMs)
    }
  })

  it('вырожденное окно не даёт разметки', () => {
    assert.deepEqual(halfHourMarks(ticks, { startMs: 1, endMs: 1 }), [])
    assert.deepEqual(halfHourMarks(null, win), [])
  })
})
