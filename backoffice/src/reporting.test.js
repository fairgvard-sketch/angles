import test from 'node:test'
import assert from 'node:assert/strict'
import {
  previousRange, PREVIOUS_LABEL, delta, rangeLabel, scopeLine,
  channelLabel, orderTypeLabel, salesToCsv, salesFileName,
  activityParams, activityToCsv, ACTIVITY_TYPES,
  activityDayKey, activityDayLabel, activityDays, activityTime,
} from './reporting.js'

// ── Период сравнения ─────────────────────────────────────────

test('месяц сравнивается с календарным прошлым месяцем, а не с 30 днями', () => {
  const from = new Date(2026, 2, 1)   // 1 марта
  const to = new Date(2026, 3, 1)     // 1 апреля
  const prev = previousRange('month', from, to)
  assert.equal(prev.from.getMonth(), 1, 'февраль')
  assert.equal(prev.to.getMonth(), 2, 'по 1 марта')
  // Февраль короче марта — именно поэтому окно не сдвигают на длину периода
  assert.notEqual(prev.to - prev.from, to - from)
})

test('год сравнивается с прошлым годом', () => {
  const prev = previousRange('year', new Date(2026, 0, 1), new Date(2027, 0, 1))
  assert.equal(prev.from.getFullYear(), 2025)
  assert.equal(prev.to.getFullYear(), 2026)
})

test('скользящее окно сравнивается с окном той же длины перед ним', () => {
  const from = new Date(2026, 6, 8)
  const to = new Date(2026, 6, 15)
  const prev = previousRange('7d', from, to)
  assert.equal(prev.to.getTime(), from.getTime(), 'прошлый период кончается там, где начался текущий')
  assert.equal(prev.to - prev.from, to - from, 'и длится столько же')
})

test('у каждого периода есть подпись сравнения', () => {
  for (const key of ['today', '7d', 'month', 'year', 'custom']) {
    assert.ok(PREVIOUS_LABEL[key])
  }
})

// ── Изменение ────────────────────────────────────────────────

test('рост и падение считаются в процентах', () => {
  assert.equal(delta(15000, 10000).text, '+50%')
  assert.equal(delta(15000, 10000).direction, 'up')
  assert.equal(delta(5000, 10000).text, '-50%')
  assert.equal(delta(5000, 10000).direction, 'down')
})

test('рост с нуля не превращается в бесконечный процент', () => {
  const d = delta(10000, 0)
  assert.equal(d.text, 'was none')
  assert.equal(d.direction, 'up')
})

test('два нуля — это «без изменений», а не падение', () => {
  assert.equal(delta(0, 0).direction, 'flat')
})

// ── Охват ────────────────────────────────────────────────────

test('однодневный период показывается одной датой', () => {
  const label = rangeLabel(new Date(2026, 7, 1), new Date(2026, 7, 2))
  assert.match(label, /1 Aug 2026/)
  assert.ok(!label.includes('—'), label)
})

test('строка охвата называет период, точки, зону и валюту', () => {
  const line = scopeLine({
    all_locations: false,
    locations: [{ id: 'l1', name: 'Dizengoff' }],
    tz: 'Asia/Jerusalem',
    currencies: ['ILS'],
  }, new Date(2026, 7, 1), new Date(2026, 7, 2))
  assert.match(line, /Dizengoff/)
  assert.match(line, /Asia\/Jerusalem/)
  assert.match(line, /ILS/)
})

test('без выбора точек охват честно говорит «все точки»', () => {
  const line = scopeLine({ all_locations: true, locations: [], tz: 'Asia/Jerusalem', currencies: ['ILS'] },
    new Date(2026, 7, 1), new Date(2026, 7, 2))
  assert.match(line, /All locations/)
})

test('заказ с кассы называется стойкой, а не кодом', () => {
  assert.equal(channelLabel('pos'), 'Counter (POS)')
  assert.equal(channelLabel('table_qr'), 'Table QR')
  assert.equal(orderTypeLabel('here'), 'Eat in')
  // Неизвестный код показываем как есть — выдумывать перевод нельзя
  assert.equal(channelLabel('carrier_pigeon'), 'carrier_pigeon')
})

// ── Выгрузка продаж ──────────────────────────────────────────

const REPORT = {
  scope: {
    all_locations: false,
    locations: [{ id: 'l1', name: 'Dizengoff' }],
    tz: 'Asia/Jerusalem',
    currencies: ['ILS'],
  },
  summary: {
    gross_sales: 20000, discounts: 500, vat: 3050, orders_count: 3,
    avg_check: 6667, refunds: 6000, refunds_count: 1,
  },
  by_method: [{ method: 'cash', amount: 10000, count: 1 }],
  by_channel: [{ channel: 'pos', amount: 16000, count: 2 }, { channel: 'website', amount: 4000, count: 1 }],
  by_type: [{ type: 'here', amount: 16000, count: 2 }],
  by_location: [{ location_id: 'l1', name: 'Dizengoff', amount: 20000, count: 3 }],
  by_staff: [{ name: 'Дана, Леви', amount: 20000, count: 3 }],
  by_category: [{ category: 'Coffee', qty: 4, amount: 8000 }],
  top_items: [{ name: 'Latte', qty: 4, amount: 8000 }],
}

test('выгрузка начинается с охвата — файл объясняет себя сам', () => {
  const csv = salesToCsv(REPORT, { from: new Date(2026, 7, 1), to: new Date(2026, 7, 2) })
  const head = csv.split('\r\n').slice(0, 5).join('\n')
  assert.match(head, /Timezone,Asia\/Jerusalem/)
  assert.match(head, /Currency,ILS/)
  assert.match(head, /Locations,Dizengoff/)
})

test('в выгрузке деньги в шекелях, а не в агоротах', () => {
  const csv = salesToCsv(REPORT, { from: new Date(2026, 7, 1), to: new Date(2026, 7, 2) })
  assert.match(csv, /Gross sales,200\.00,3/)
  assert.match(csv, /Net sales,140\.00/)
})

test('запятая в имени сотрудника не ломает колонки', () => {
  const csv = salesToCsv(REPORT, { from: new Date(2026, 7, 1), to: new Date(2026, 7, 2) })
  assert.match(csv, /"Дана, Леви",200\.00,3/)
})

test('каналы попадают в выгрузку под человеческими именами', () => {
  const csv = salesToCsv(REPORT, { from: new Date(2026, 7, 1), to: new Date(2026, 7, 2) })
  assert.match(csv, /Counter \(POS\),160\.00,2/)
})

test('пустые разрезы в выгрузку не попадают', () => {
  const csv = salesToCsv({ ...REPORT, by_staff: [] }, { from: new Date(2026, 7, 1), to: new Date(2026, 7, 2) })
  assert.ok(!csv.includes('Staff,'), 'секции без данных нет')
})

test('имя файла содержит период', () => {
  assert.equal(salesFileName(new Date('2026-08-01T00:00:00Z'), new Date('2026-08-02T00:00:00Z')),
    'sales-2026-08-01.csv')
})

// ── Журнал ───────────────────────────────────────────────────

test('фильтры журнала уходят на сервер, а не режут страницу', () => {
  const p = activityParams({
    from: new Date('2026-08-01T00:00:00Z'),
    types: ['refund_issued'],
    search: ' Дана ',
    locationId: 'l1',
  })
  assert.equal(p.p_from, '2026-08-01T00:00:00.000Z')
  assert.deepEqual(p.p_types, ['refund_issued'])
  assert.equal(p.p_search, 'Дана')
  assert.equal(p.p_location_id, 'l1')
})

test('пустые фильтры уходят как NULL — сервер понимает «все»', () => {
  const p = activityParams({})
  assert.equal(p.p_types, null)
  assert.equal(p.p_search, null)
  assert.equal(p.p_from, null)
  assert.equal(p.p_device_id, null)
})

test('типы событий берутся из того, что пишет база', () => {
  assert.deepEqual(ACTIVITY_TYPES.map((t) => t.key),
    ['shift_opened', 'shift_closed', 'refund_issued'])
})

test('выгрузка журнала помечает время зоной точки и не выдумывает терминал', () => {
  const csv = activityToCsv([
    {
      id: 'e1', type: 'refund_issued', created_at: '2026-07-31T21:30:00Z',
      staff_name: 'Дана', location_name: 'Dizengoff', device_name: null,
      amount: 6000, detail: { method: 'card', reason: 'Пролили кофе' },
    },
  ], { timeZone: 'Asia/Jerusalem' })
  const [header, row] = csv.split('\r\n')
  assert.match(header, /Time \(Asia\/Jerusalem\)/)
  // 31 июля 21:30 UTC = 1 августа 00:30 в Иерусалиме
  assert.match(row, /2026-08-01 00:30/)
  assert.match(row, /60\.00/)
  assert.match(row, /method=card/)
  // Устройства не было — пустая ячейка, а не «главная касса»
  assert.match(row, /Dizengoff,,/)
})

// ── Журнал: дни и время ──────────────────────────────────────

const TLV = 'Asia/Jerusalem'
const NOW = new Date('2026-08-04T09:00:00Z').getTime() // 4 августа, 12:00 в Тель-Авиве

test('день считается в часах точки, а не в UTC', () => {
  // 31 июля 21:30 UTC — это уже 1 августа в Иерусалиме
  assert.equal(activityDayKey('2026-07-31T21:30:00Z', TLV), '2026-08-01')
  assert.equal(activityDayKey('2026-07-31T21:30:00Z', 'UTC'), '2026-07-31')
})

test('сегодня и вчера названы словом, дата остаётся рядом', () => {
  assert.equal(activityDayLabel('2026-08-04', { timeZone: TLV, now: NOW }), 'Today · 4 August')
  assert.equal(activityDayLabel('2026-08-03', { timeZone: TLV, now: NOW }), 'Yesterday · 3 August')
  assert.equal(activityDayLabel('2026-07-28', { timeZone: TLV, now: NOW }), '28 July')
})

test('у прошлого года дата с годом — иначе она читается как позавчерашняя', () => {
  assert.equal(activityDayLabel('2025-12-31', { timeZone: TLV, now: NOW }), '31 December 2025')
})

test('битая дата не роняет раздел и не прячет событие', () => {
  assert.equal(activityDayKey(null, TLV), 'unknown')
  assert.equal(activityDayKey('позавчера', TLV), 'unknown')
  assert.equal(activityDayLabel('unknown', { timeZone: TLV, now: NOW }), 'Date unknown')
  assert.equal(activityTime(undefined, TLV), '—')

  const days = activityDays([{ id: 'e1', created_at: 'позавчера' }], { timeZone: TLV, now: NOW })
  assert.equal(days.length, 1)
  assert.equal(days[0].events[0].id, 'e1', 'событие осталось в ленте')
})

test('группировка не меняет порядок сервера — ни внутри дня, ни между днями', () => {
  const rows = [
    { id: 'a', created_at: '2026-08-04T06:02:00Z' },
    { id: 'b', created_at: '2026-08-04T05:47:00Z' },
    { id: 'c', created_at: '2026-08-03T14:42:00Z' },
  ]
  const days = activityDays(rows, { timeZone: TLV, now: NOW })
  assert.deepEqual(days.map((d) => d.key), ['2026-08-04', '2026-08-03'])
  assert.deepEqual(days.map((d) => d.label), ['Today · 4 August', 'Yesterday · 3 August'])
  assert.deepEqual(days[0].events.map((e) => e.id), ['a', 'b'])
  assert.deepEqual(days[1].events.map((e) => e.id), ['c'])
})

test('дозагрузка дописывает в конец своего дня, а не задваивает и не переставляет', () => {
  const first = [
    { id: 'a', created_at: '2026-08-04T06:02:00Z' },
    { id: 'b', created_at: '2026-08-03T14:42:00Z' },
  ]
  const next = [
    { id: 'c', created_at: '2026-08-03T08:10:00Z' },
    { id: 'd', created_at: '2026-08-02T17:00:00Z' },
  ]
  const days = activityDays([...first, ...next], { timeZone: TLV, now: NOW })
  assert.deepEqual(days.map((d) => d.key), ['2026-08-04', '2026-08-03', '2026-08-02'])
  assert.deepEqual(days[1].events.map((e) => e.id), ['b', 'c'], 'вчерашний день дополнился')
  assert.equal(days.flatMap((d) => d.events).length, 4, 'ни одно событие не задвоилось')
})

test('в журнале время точное и в часах точки', () => {
  // 21:30 UTC = 00:30 следующего дня в Иерусалиме
  assert.equal(activityTime('2026-07-31T21:30:00Z', TLV), '00:30')
  assert.equal(activityTime('2026-08-04T06:02:00Z', TLV), '09:02')
})
