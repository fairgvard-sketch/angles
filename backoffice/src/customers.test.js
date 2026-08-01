import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SEGMENTS, segmentParams, segmentSummary, parseTagsInput, TAG_LIMIT,
  guestsToCsv, csvFileName, duplicateReason, mergePreview, mergeSources,
  customerErrorText, normalizePhoneInput, formatPhone, formatMoney,
} from './customers.js'

// ── Сегменты считает сервер ──────────────────────────────────

test('сегмент превращается в серверные параметры, а не в фильтр страницы', () => {
  const p = segmentParams({ segment: 'regulars' })
  assert.equal(p.p_min_visits, 3)
  assert.equal(p.p_min_spent, null)
  assert.equal(p.p_limit, 200)
})

test('переключение сегмента не тащит за собой прошлые пороги', () => {
  const spenders = segmentParams({ segment: 'top' })
  assert.equal(spenders.p_min_spent, 20000)
  assert.equal(spenders.p_min_visits, null)

  const lapsed = segmentParams({ segment: 'lapsed' })
  assert.equal(lapsed.p_inactive_days, 90)
  assert.equal(lapsed.p_min_spent, null, 'порог суммы не остался от прошлого среза')
})

test('пустой поиск и пустые метки уходят как NULL', () => {
  const p = segmentParams({ search: '   ', tags: [] })
  assert.equal(p.p_search, null)
  assert.equal(p.p_tags, null)
})

test('метки и поиск живут вместе с сегментом', () => {
  const p = segmentParams({ search: ' Дана ', segment: 'regulars', tags: ['VIP'], sort: 'spend' })
  assert.equal(p.p_search, 'Дана')
  assert.deepEqual(p.p_tags, ['VIP'])
  assert.equal(p.p_min_visits, 3)
  assert.equal(p.p_sort, 'spend')
})

test('неизвестный сегмент не роняет запрос — база показывается целиком', () => {
  const p = segmentParams({ segment: 'nonsense' })
  assert.equal(p.p_min_visits, null)
  assert.equal(p.p_inactive_days, null)
})

test('у каждого сегмента есть подпись — чип без объяснения бесполезен', () => {
  for (const s of SEGMENTS) assert.ok(s.label.length > 0)
})

test('заголовок списка называет активный срез', () => {
  assert.match(segmentSummary({ segment: 'lapsed' }), /lapsed/)
  assert.match(segmentSummary({ segment: 'all', tags: ['VIP'] }), /VIP/)
  assert.match(segmentSummary({ segment: 'all', tags: [], search: '' }), /Most recent/)
})

// ── Метки ────────────────────────────────────────────────────

test('метки разбираются по запятым, дубли и пустые отброшены', () => {
  assert.deepEqual(parseTagsInput('VIP, , regular, vip'), ['VIP', 'regular'])
})

test('кабинет не обещает больше меток, чем примет сервер', () => {
  const many = Array.from({ length: 20 }, (_, i) => `tag${i}`).join(',')
  assert.equal(parseTagsInput(many).length, TAG_LIMIT)
})

test('слишком длинная метка обрезается так же, как на сервере', () => {
  assert.equal(parseTagsInput('x'.repeat(40))[0].length, 24)
})

// ── Выгрузка ─────────────────────────────────────────────────

const ROWS = [
  {
    id: 'g1', name: 'Дана, Леви', phone: '0501234567', visits: 4, total_spent: 14000,
    points: 600, stamps: 3, tags: ['VIP', 'regular'], notes: 'Oat "milk"',
    last_visit_at: '2026-07-31T21:30:00Z', created_at: '2026-01-02T08:00:00Z',
  },
  {
    id: 'g2', name: null, phone: '0521112222', visits: 0, total_spent: 0,
    points: 0, stamps: 0, tags: [], notes: null, last_visit_at: null,
    created_at: '2026-05-05T05:00:00Z',
  },
]

test('в выгрузке видно валюту и часовой пояс — файл уезжает из кабинета', () => {
  const csv = guestsToCsv(ROWS, { timeZone: 'Asia/Jerusalem' })
  const header = csv.split('\r\n')[0]
  assert.match(header, /Total spent \(ILS\)/)
  assert.match(header, /Last visit \(Asia\/Jerusalem\)/)
})

test('запятые и кавычки в имени не ломают колонки', () => {
  const line = guestsToCsv(ROWS).split('\r\n')[1]
  assert.ok(line.startsWith('"Дана, Леви",0501234567,4,140.00,6.00,3,'))
  assert.match(line, /"Oat ""milk"""/)
})

test('визит после полуночи по UTC остаётся тем же днём в зоне точки', () => {
  const csv = guestsToCsv(ROWS, { timeZone: 'Asia/Jerusalem' })
  // 31 июля 21:30 UTC = 1 августа 00:30 в Иерусалиме
  assert.match(csv.split('\r\n')[1], /,2026-08-01,/)
})

test('пустые поля выгружаются пустыми, а не «null»', () => {
  const line = guestsToCsv(ROWS).split('\r\n')[2]
  // Имя, «последний визит», метки и заметка у этого гостя пусты
  assert.equal(line, ',0521112222,0,0.00,0.00,0,,2026-05-05,,')
})

test('имя файла содержит дату выгрузки', () => {
  assert.equal(csvFileName(new Date('2026-08-01T10:00:00Z')), 'customers-2026-08-01.csv')
})

// ── Дубли и слияние ──────────────────────────────────────────

const GROUP = {
  reason: 'phone',
  key: '501234567',
  guests: [
    { id: 'g1', name: 'Дана', phone: '0501234567', visits: 3, total_spent: 10000 },
    { id: 'g2', name: 'Дана Леви', phone: '972501234567', visits: 1, total_spent: 4000 },
  ],
}

test('причина дубля названа словами, а не кодом', () => {
  assert.match(duplicateReason(GROUP), /number/i)
  assert.match(duplicateReason({ reason: 'name' }), /name/i)
})

test('предпросмотр слияния называет объём переезда и судьбу старого номера', () => {
  const text = mergePreview(GROUP.guests[0], GROUP.guests[1])
  assert.match(text, /4 visits/)
  assert.match(text, /₪140\.00/)
  assert.match(text, /old number keeps working/i)
})

test('исходники — все, кроме выбранного основным', () => {
  assert.deepEqual(mergeSources(GROUP, 'g1').map((g) => g.id), ['g2'])
  assert.deepEqual(mergeSources(GROUP, 'g2').map((g) => g.id), ['g1'])
})

// ── Ошибки ───────────────────────────────────────────────────

test('занятый номер предлагает слияние, а не «нарушение уникальности»', () => {
  assert.match(customerErrorText('phone_taken'), /Merge/i)
})

test('специфичный код не подменяется общим', () => {
  // 'already_anonymized' содержит 'anonymized' — длинный код должен победить
  assert.match(customerErrorText('already_anonymized'), /already/i)
  assert.notEqual(customerErrorText('already_anonymized'), customerErrorText('guest_anonymized'))
})

test('будущая бронь объясняет, что сделать раньше стирания', () => {
  assert.match(customerErrorText('has_upcoming_reservation'), /Cancel it first/i)
})

test('неизвестная ошибка показывается как есть, а не глотается', () => {
  assert.equal(customerErrorText('boom'), 'boom')
})

// ── Формат ───────────────────────────────────────────────────

test('телефон нормализуется так же, как на сервере', () => {
  assert.equal(normalizePhoneInput('+972 (50) 123-45-67'), '972501234567')
})

test('деньги приходят агоротами и показываются шекелями', () => {
  assert.equal(formatMoney(14000), '₪140.00')
  assert.equal(formatMoney(null), '₪0.00')
})

test('десятизначный номер разбивается на группы, остальные — как есть', () => {
  assert.equal(formatPhone('0501234567'), '050-123-4567')
  assert.equal(formatPhone('972501234567'), '972501234567')
})
