import test from 'node:test'
import assert from 'node:assert/strict'
import {
  groupByDay, formatDay, formatTime, formatHm, decimalHours, formatRanges,
  formatDayLine, dateKey, monthRange, monthTitle, shiftMonth,
  hoursToCsv, hoursFileName, idleStaff, dayBounds, dayBreakSeconds,
  HEBREW_DOW, EN_DOW,
} from './hours.js'

const TZ = 'Asia/Jerusalem'

function entry(over = {}) {
  return {
    id: 'e1',
    day: '2026-08-01',
    dow: 6,
    clock_in: '2026-08-01T04:00:00Z',  // 07:00 в Израиле летом
    clock_out: '2026-08-01T12:00:00Z', // 15:00
    seconds: 8 * 3600,
    is_open: false,
    note: null,
    location_name: 'Rothschild',
    ...over,
  }
}

// ── Дни ──────────────────────────────────────────────────────

test('смены одного дня складываются в одну строку', () => {
  const days = groupByDay([
    entry({ id: 'a', seconds: 4 * 3600 }),
    entry({ id: 'b', clock_in: '2026-08-01T13:00:00Z', clock_out: '2026-08-01T15:00:00Z', seconds: 2 * 3600 }),
  ])
  assert.equal(days.length, 1)
  assert.equal(days[0].entries.length, 2)
  assert.equal(days[0].seconds, 6 * 3600)
})

test('дни идут по возрастанию, каким бы ни был порядок ответа', () => {
  const days = groupByDay([entry({ day: '2026-08-03' }), entry({ day: '2026-08-02' })])
  assert.deepEqual(days.map((d) => d.day), ['2026-08-02', '2026-08-03'])
})

test('незакрытая смена помечает день', () => {
  const [day] = groupByDay([entry({ clock_out: null, is_open: true })])
  assert.equal(day.hasOpen, true)
})

// ── Форматы ──────────────────────────────────────────────────

test('дата табеля — DD.MM.YYYY', () => {
  assert.equal(formatDay('2026-08-01'), '01.08.2026')
})

test('время берётся в поясе точки, а не браузера', () => {
  assert.equal(formatTime('2026-08-01T04:00:00Z', TZ), '07:00')
  assert.equal(formatTime('2026-08-01T04:00:00Z', 'America/New_York'), '00:00')
})

test('часы читаются как Ч:ММ', () => {
  assert.equal(formatHm(8 * 3600 + 30 * 60), '8:30')
  assert.equal(formatHm(0), '0:00')
  assert.equal(formatHm(undefined), '0:00')
})

test('десятичные часы — с запятой, иначе Excel видит текст', () => {
  assert.equal(decimalHours(8 * 3600 + 30 * 60), '8,50')
})

test('перерыв внутри дня показывается двумя интервалами', () => {
  const [day] = groupByDay([
    entry({ id: 'a' }),
    entry({ id: 'b', clock_in: '2026-08-01T13:00:00Z', clock_out: '2026-08-01T15:00:00Z' }),
  ])
  assert.equal(formatRanges(day, TZ), '07:00 - 15:00, 16:00 - 18:00')
})

test('открытая смена печатается многоточием, а не пустотой', () => {
  const [day] = groupByDay([entry({ clock_out: null, is_open: true })])
  assert.equal(formatRanges(day, TZ), '07:00 - …')
})

test('краткая строка совпадает с кассовой: дата, буква недели, интервал', () => {
  const [day] = groupByDay([entry({ day: '2026-08-02', dow: 0 })])
  assert.equal(formatDayLine(day, TZ), '02.08.2026 א 07:00 - 15:00')
  assert.equal(formatDayLine(day, TZ, EN_DOW), '02.08.2026 Sun 07:00 - 15:00')
})

test('неделя начинается с воскресенья', () => {
  assert.equal(HEBREW_DOW[0], 'א')
  assert.equal(EN_DOW[0], 'Sun')
})

// ── Период ───────────────────────────────────────────────────

test('месяц — календарный, от первого до последнего дня', () => {
  const { from, to } = monthRange(2026, 7)
  assert.equal(dateKey(from), '2026-08-01')
  assert.equal(dateKey(to), '2026-08-31')
})

test('февраль високосного года кончается 29-м', () => {
  assert.equal(dateKey(monthRange(2028, 1).to), '2028-02-29')
})

test('шаг назад с января уводит в декабрь прошлого года', () => {
  assert.deepEqual(shiftMonth({ year: 2026, month: 0 }, -1), { year: 2025, month: 11 })
})

test('у месяца есть человеческое имя', () => {
  assert.match(monthTitle(2026, 7), /August/)
})

// ── Выгрузка ─────────────────────────────────────────────────

const person = {
  staff_id: 's1', name: 'Anna', role: 'barista', is_active: true,
  seconds: 8 * 3600, days: 1, shifts: 1, has_open: false, entries: [entry()],
}

test('выгрузка начинается с BOM — иначе Excel рассыпает иврит', () => {
  assert.ok(hoursToCsv([person], TZ).startsWith('﻿'))
})

test('строка дня: приход, уход, перерыв и часы в двух видах', () => {
  assert.match(hoursToCsv([person], TZ), /Anna;01\.08\.2026;Sat;07:00;15:00;0:00;8:00;8,00;;Rothschild;/)
})

test('день с перерывом остаётся ОДНОЙ строкой — как на экране и на бумаге', () => {
  const split = {
    ...person,
    seconds: 7 * 3600,
    shifts: 2,
    entries: [
      entry({ id: 'a', clock_in: '2026-08-01T04:00:00Z', clock_out: '2026-08-01T08:00:00Z', seconds: 4 * 3600 }),
      entry({ id: 'b', clock_in: '2026-08-01T09:00:00Z', clock_out: '2026-08-01T12:00:00Z', seconds: 3 * 3600 }),
    ],
  }
  const rows = hoursToCsv([split], TZ).split('\r\n')
  assert.match(rows[1], /07:00;15:00;1:00;7:00;7,00/)
  assert.ok(rows[1].includes('07:00 - 11:00, 12:00 - 15:00'))
  assert.equal(rows[2], '', 'после дня сразу блок итогов, второй строки дня нет')
})

test('точка с запятой в заметке экранируется', () => {
  const csv = hoursToCsv([{ ...person, entries: [entry({ note: 'forgot; to punch' })] }], TZ)
  assert.ok(csv.includes('"forgot; to punch"'))
})

test('в конце — итог по людям и общий итог', () => {
  const csv = hoursToCsv([person], TZ)
  assert.ok(csv.includes('Anna;1;1;8:00;8,00'))
  assert.ok(csv.includes('Total;;;8:00;8,00'))
})

test('имя файла называет период и сотрудника', () => {
  const { from, to } = monthRange(2026, 7)
  assert.equal(hoursFileName(from, to, 'Anna'), 'hours_Anna_2026-08-01_2026-08-31.csv')
  assert.equal(hoursFileName(from, to), 'hours_2026-08-01_2026-08-31.csv')
})

// ── Штат без смен ────────────────────────────────────────────

const roster = [
  { id: 's1', name: 'Anna', is_active: true, location_id: null },
  { id: 's2', name: 'Boris', is_active: true, location_id: 'loc-1' },
  { id: 's3', name: 'Vika', is_active: true, location_id: 'loc-2' },
  { id: 's4', name: 'Grisha', is_active: false, location_id: 'loc-1' },
]

test('в списке есть и те, кто в этом месяце не работал — иначе их не открыть', () => {
  assert.deepEqual(idleStaff([], roster, 'loc-1').map((s) => s.id), ['s1', 's2'])
})

test('отработавший не задваивается', () => {
  assert.deepEqual(idleStaff([{ staff_id: 's2' }], roster, 'loc-1').map((s) => s.id), ['s1'])
})

test('уволенный без смен в список не поднимается', () => {
  assert.ok(!idleStaff([], roster, 'loc-1').some((s) => s.id === 's4'))
})

test('фильтр точки не показывает чужих сотрудников', () => {
  assert.ok(!idleStaff([], roster, 'loc-1').some((s) => s.id === 's3'))
})

test('сотрудник без точки работает на всех', () => {
  assert.deepEqual(idleStaff([], roster, 'loc-2').map((s) => s.id), ['s1', 's3'])
})

test('без фильтра точки виден весь активный штат', () => {
  assert.deepEqual(idleStaff([], roster, null).map((s) => s.id), ['s1', 's2', 's3'])
})

test('порядок — по имени', () => {
  const shuffled = [roster[2], roster[0], roster[1]]
  assert.deepEqual(idleStaff([], shuffled, null).map((s) => s.name), ['Anna', 'Boris', 'Vika'])
})

// ── Границы дня и перерыв ────────────────────────────────────

test('день из одной смены: приход и уход её же, перерыва нет', () => {
  const [day] = groupByDay([entry()])
  assert.deepEqual(dayBounds(day), { in: '2026-08-01T04:00:00Z', out: '2026-08-01T12:00:00Z' })
  assert.equal(dayBreakSeconds(day), 0)
})

test('разрыв между сменами дня и есть перерыв', () => {
  // 07:00–11:00 и 12:00–15:00: на работе 8 часов, отработано 7, перерыв час
  const [day] = groupByDay([
    entry({ id: 'a', clock_in: '2026-08-01T04:00:00Z', clock_out: '2026-08-01T08:00:00Z', seconds: 4 * 3600 }),
    entry({ id: 'b', clock_in: '2026-08-01T09:00:00Z', clock_out: '2026-08-01T12:00:00Z', seconds: 3 * 3600 }),
  ])
  assert.equal(dayBreakSeconds(day), 3600)
  assert.equal(day.seconds, 7 * 3600)
})

test('границы берутся по времени, а не по порядку в ответе', () => {
  const [day] = groupByDay([
    entry({ id: 'b', clock_in: '2026-08-01T09:00:00Z', clock_out: '2026-08-01T12:00:00Z', seconds: 3 * 3600 }),
    entry({ id: 'a', clock_in: '2026-08-01T04:00:00Z', clock_out: '2026-08-01T08:00:00Z', seconds: 4 * 3600 }),
  ])
  assert.equal(dayBounds(day).in, '2026-08-01T04:00:00Z')
  assert.equal(dayBreakSeconds(day), 3600)
})

test('незакрытый день перерыва не показывает — он ещё не кончился', () => {
  const [day] = groupByDay([entry({ clock_out: null, is_open: true })])
  assert.equal(dayBounds(day).out, null)
  assert.equal(dayBreakSeconds(day), 0)
})
