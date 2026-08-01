import test from 'node:test'
import assert from 'node:assert/strict'
import {
  blockState, buildRows, dayWindows, groupByZone, hmToMin, hourTicks, nowMarkerPct,
  occupancySummary, positionOf, shiftDate, timelineWindow, todayInZone, zonedToUtc,
} from './timeline.js'

/**
 * Геометрия таймлайна хостес. Проверяется арифметика, а не разметка:
 * если полотно растянулось на чужие сутки или блок налез на соседний, это
 * должно падать здесь, а не обнаруживаться хостес в час пик.
 *
 * Эталон правил — `src/features/reservations/timeline.ts` в репозитории
 * кассы; здесь тот же набор проверок для веб-копии.
 */

const TZ = 'Asia/Jerusalem'
const DATE = '2026-08-01' // суббота, летнее время (+03:00)

/** Локальное время выбранных суток → UTC */
const at = (h, m = 0) => Date.UTC(2026, 7, 1, h - 3, m)
/** Локальное время предыдущих суток → UTC */
const prev = (h, m = 0) => Date.UTC(2026, 6, 31, h - 3, m)

const SCHEDULE = { weekly: { 6: [['08:00', '20:00']] }, exceptions: {} }

function table(id, label, over = {}) {
  return {
    id, label, seats: 4, zoneId: 'z1', zoneName: 'Зал',
    sortOrder: Number(label), blocked: false, ...over,
  }
}

function booking(id, tableIds, startMs, endMs, over = {}) {
  return {
    id, tableIds, startMs, endMs,
    state: 'confirmed', guestName: 'Гость', partySize: 2, ...over,
  }
}

test('hmToMin разбирает время и отбрасывает мусор', () => {
  assert.equal(hmToMin('08:30'), 510)
  assert.equal(hmToMin('00:00'), 0)
  assert.equal(hmToMin('24:00'), null)
  assert.equal(hmToMin('8:5'), null)
  assert.equal(hmToMin(null), null)
})

test('исключение по дате замещает недельное правило', () => {
  const schedule = { weekly: { 6: [['08:00', '20:00']] }, exceptions: { [DATE]: [['18:00', '23:00']] } }
  assert.deepEqual(dayWindows(schedule, DATE), [['18:00', '23:00']])
  assert.deepEqual(dayWindows(schedule, '2026-08-08'), [['08:00', '20:00']])
})

test('shiftDate и todayInZone работают в календаре зоны точки', () => {
  assert.equal(shiftDate(DATE, -1), '2026-07-31')
  assert.equal(shiftDate(DATE, 1), '2026-08-02')
  // 31 июля 23:30 UTC — это уже 1 августа в Иерусалиме (+03:00)
  assert.equal(todayInZone(Date.UTC(2026, 6, 31, 23, 30), TZ), '2026-08-01')
})

test('zonedToUtc учитывает переход на летнее время', () => {
  // Израиль переходит на летнее время в пятницу 27 марта 2026, 02:00 → 03:00
  assert.equal(zonedToUtc('2026-03-26', 12 * 60, TZ).getTime(), Date.UTC(2026, 2, 26, 10, 0))
  assert.equal(zonedToUtc('2026-03-28', 12 * 60, TZ).getTime(), Date.UTC(2026, 2, 28, 9, 0))
})

test('окно дня строится от расписания точки, а не от суток', () => {
  const win = timelineWindow(DATE, TZ, SCHEDULE)
  // 08:00 − 30 мин запаса = 07:30; 20:00 + 90 мин = 21:30
  assert.equal(win.startMs, at(7, 30))
  assert.equal(win.endMs, at(21, 30))
})

test('окно расширяется под бронь вне расписания — ручная бронь не исчезает', () => {
  const win = timelineWindow(DATE, TZ, SCHEDULE, [booking('b1', ['t1'], at(5), at(6))])
  assert.equal(win.startMs, at(5))
  assert.equal(win.endMs, at(21, 30))
})

test('закрытый день не даёт вырожденного окна', () => {
  const win = timelineWindow(DATE, TZ, { weekly: { 6: [] }, exceptions: {} })
  assert.ok(win.endMs > win.startMs)
})

test('час занимает свою долю ширины', () => {
  const win = { startMs: at(8), endMs: at(20) } // 12 часов
  const p = positionOf(at(9), at(10), win)
  assert.ok(Math.abs(p.leftPct - 100 / 12) < 1e-9)
  assert.ok(Math.abs(p.widthPct - 100 / 12) < 1e-9)
  assert.equal(p.clipsStart, false)
  assert.equal(p.clipsEnd, false)
})

test('визит, вышедший за окно, обрезается и помечается', () => {
  const win = { startMs: at(8), endMs: at(20) }
  const left = positionOf(prev(23), at(9), win)
  assert.equal(left.leftPct, 0)
  assert.equal(left.clipsStart, true)
  const right = positionOf(at(19), at(22), win)
  assert.equal(right.clipsEnd, true)
  assert.ok(Math.abs(right.leftPct + right.widthPct - 100) < 1e-9)
})

test('состояние блока выводится из статуса, посадки и заказа', () => {
  assert.equal(blockState('new', null, null), 'pending')
  assert.equal(blockState('confirmed', null, null), 'confirmed')
  assert.equal(blockState('confirmed', '2026-08-01T10:00:00Z', null), 'arrived')
  assert.equal(blockState('confirmed', null, 'order-1'), 'arrived')
  assert.equal(blockState('completed', null, null), 'done')
  assert.equal(blockState('no_show', null, null), 'noshow')
})

test('строки: блоки раскладываются по столам и сортируются по времени', () => {
  const win = { startMs: at(8), endMs: at(22) }
  const rows = buildRows(
    [table('t2', '2'), table('t1', '1')],
    [
      booking('late', ['t1'], at(19), at(20, 30)),
      booking('early', ['t1'], at(12), at(13, 30)),
      booking('other', ['t2'], at(12), at(13, 30)),
    ],
    win
  )
  assert.deepEqual(rows.map((r) => r.table.id), ['t1', 't2'])
  assert.deepEqual(rows[0].blocks.map((b) => b.booking.id), ['early', 'late'])
})

test('пересечение живых броней на одном столе помечается конфликтом', () => {
  const win = { startMs: at(8), endMs: at(22) }
  const rows = buildRows(
    [table('t1', '1')],
    [
      booking('a', ['t1'], at(12), at(14)),
      booking('b', ['t1'], at(13), at(15)),
    ],
    win
  )
  assert.deepEqual(rows[0].blocks.map((b) => b.conflict), [true, true])
})

test('отменённый визит не создаёт конфликта', () => {
  const win = { startMs: at(8), endMs: at(22) }
  const rows = buildRows(
    [table('t1', '1')],
    [
      booking('a', ['t1'], at(12), at(14), { state: 'noshow' }),
      booking('b', ['t1'], at(13), at(15)),
    ],
    win
  )
  assert.deepEqual(rows[0].blocks.map((b) => b.conflict), [false, false])
})

test('объединение столов рисуется на каждом своём столе', () => {
  const win = { startMs: at(8), endMs: at(22) }
  const rows = buildRows(
    [table('t1', '1'), table('t2', '2')],
    [booking('combo', ['t1', 't2'], at(12), at(14))],
    win
  )
  assert.equal(rows[0].blocks[0].combined, true)
  assert.equal(rows[1].blocks[0].combined, true)
})

test('зона «без зоны» уходит вниз списка', () => {
  const win = { startMs: at(8), endMs: at(22) }
  const rows = buildRows(
    [table('t1', '1', { zoneId: null, zoneName: null }), table('t2', '2')],
    [],
    win
  )
  const zones = groupByZone(rows)
  assert.deepEqual(zones.map((z) => z.id), ['z1', null])
})

test('сводка занятости считает столы, места и ближайшие визиты', () => {
  const win = { startMs: at(8), endMs: at(22) }
  const now = at(12, 30)
  const rows = buildRows(
    [table('t1', '1'), table('t2', '2'), table('t3', '3', { blocked: true })],
    [
      booking('busy', ['t1'], at(12), at(14)),
      booking('soon', ['t2'], at(13), at(14, 30)),
      booking('later', ['t2'], at(20), at(21), { state: 'pending' }),
    ],
    win
  )
  const summary = occupancySummary(rows, now)
  assert.equal(summary.totalTables, 2) // выключенный стол не считается
  assert.equal(summary.busyTables, 1)
  assert.equal(summary.freeSeats, 4)
  assert.equal(summary.soon, 1)
  assert.equal(summary.pending, 1)
})

test('метки часов подписаны по времени точки', () => {
  const ticks = hourTicks({ startMs: at(7, 30), endMs: at(10, 30) }, TZ)
  assert.deepEqual(ticks.map((t) => t.label), ['08:00', '09:00', '10:00'])
  assert.equal(ticks[0].leftPct, (30 / 180) * 100)
})

test('маркер «сейчас» показывается только внутри окна', () => {
  const win = { startMs: at(8), endMs: at(20) }
  assert.equal(nowMarkerPct(at(14), win), 50)
  assert.equal(nowMarkerPct(at(7), win), null)
  assert.equal(nowMarkerPct(at(21), win), null)
})
