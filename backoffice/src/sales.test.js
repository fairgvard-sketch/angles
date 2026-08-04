import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PERIODS, periodRange, startOfDay, chartMode, chartTitle, chartScale, barShare,
  ordersLabel, hourBars, dayBars, monthBars, barsFor, formatMoney, methodLabel,
  salesParams,
} from './sales.js'

/**
 * Правила отчёта «Продажи»: какой период спрошен, как он рисуется и что
 * уходит на сервер. Ключи и календарная семантика периодов — не
 * оформление: «месяц» здесь означает календарный месяц, а не тридцать
 * дней назад, и подменить одно другим редизайн не имеет права.
 */

// ── Периоды ──────────────────────────────────────────────────

test('все пять периодов на месте и не переименованы', () => {
  assert.deepEqual(PERIODS.map((p) => p.key), ['today', '7d', 'month', 'year', 'custom'])
})

test('сегодня — это местные сутки, а не последние 24 часа', () => {
  const { from, to } = periodRange('today')
  assert.equal(from.getTime(), startOfDay(0).getTime())
  assert.equal(to.getTime(), startOfDay(1).getTime())
  assert.equal(from.getHours(), 0)
})

test('семь дней — сегодня и шесть предыдущих', () => {
  const { from, to } = periodRange('7d')
  assert.equal(Math.round((to - from) / 86400000), 7)
  assert.equal(to.getTime(), startOfDay(1).getTime())
})

test('месяц и год — КАЛЕНДАРНЫЕ, а не скользящие 30 и 365 дней', () => {
  const month = periodRange('month')
  assert.equal(month.from.getDate(), 1)
  assert.equal(month.from.getMonth(), new Date().getMonth())
  // Конец — первое число следующего месяца: граница `to` эксклюзивна
  assert.equal(month.to.getDate(), 1)
  assert.notEqual(month.to.getMonth(), month.from.getMonth())

  const year = periodRange('year')
  assert.equal(year.from.getMonth(), 0)
  assert.equal(year.from.getDate(), 1)
  assert.equal(year.to.getFullYear(), year.from.getFullYear() + 1)
})

test('выбранные даты включают последний день целиком', () => {
  const { from, to } = periodRange('custom', { from: '2026-08-01', to: '2026-08-03' })
  assert.equal(from.getDate(), 1)
  // 3 августа выбран пользователем, значит граница — 4-е: иначе последний
  // день отчёта потерял бы все свои продажи
  assert.equal(to.getDate(), 4)
})

test('незаполненные даты не превращаются в пустой отчёт', () => {
  const { from, to } = periodRange('custom', { from: '2026-08-01', to: '' })
  assert.equal(Math.round((to - from) / 86400000), 7, 'фолбэк — неделя')
})

// ── Режим графика ────────────────────────────────────────────

test('режим графика: часы у дня, дни у недели и месяца, месяцы у года', () => {
  assert.equal(chartMode('today'), 'hour')
  assert.equal(chartMode('7d'), 'day')
  assert.equal(chartMode('month'), 'day')
  assert.equal(chartMode('year'), 'month')
})

test('длинный произвольный диапазон рисуется по месяцам, короткий — по дням', () => {
  assert.equal(chartMode('custom', { from: '2026-01-01', to: '2026-06-30' }), 'month')
  assert.equal(chartMode('custom', { from: '2026-08-01', to: '2026-08-20' }), 'day')
})

test('название графика — это его режим', () => {
  assert.equal(chartTitle('hour'), 'By hour')
  assert.equal(chartTitle('day'), 'By day')
  assert.equal(chartTitle('month'), 'By month')
})

// ── Непрерывность оси ────────────────────────────────────────

test('часы без продаж остаются на оси пустыми слотами', () => {
  const bars = hourBars({ by_hour: [{ hour: 8, amount: 1000, count: 1 }, { hour: 11, amount: 2000, count: 2 }] })
  assert.deepEqual(bars.map((b) => b.key), ['8', '9', '10', '11'])
  assert.equal(bars[1].amount, 0)
  assert.equal(bars[1].count, 0)
  assert.match(bars[0].full, /08:00–09:00/)
})

test('дни без продаж занимают своё место, а не исчезают', () => {
  const bars = dayBars(
    { by_day: [{ day: '2026-08-03', amount: 5000, count: 2 }] },
    new Date(2026, 7, 1), new Date(2026, 7, 5),
  )
  assert.equal(bars.length, 4, '1–4 августа: граница `to` эксклюзивна')
  assert.equal(bars[2].amount, 5000)
  assert.equal(bars[0].amount, 0)
})

test('месяцы строятся по всему запрошенному году, а не по месяцам с продажами', () => {
  const bars = monthBars(
    { by_day: [{ day: '2026-03-15', amount: 9000, count: 3 }] },
    new Date(2026, 0, 1), new Date(2027, 0, 1),
  )
  assert.equal(bars.length, 12)
  assert.equal(bars[2].amount, 9000, 'март')
  assert.equal(bars[0].amount, 0, 'январь без продаж остался слотом')
})

test('набор столбиков выбирается режимом', () => {
  const report = { by_hour: [{ hour: 9, amount: 100, count: 1 }], by_day: [{ day: '2026-08-01', amount: 100, count: 1 }] }
  const from = new Date(2026, 7, 1)
  const to = new Date(2026, 7, 2)
  assert.equal(barsFor('hour', report, from, to).length, 1)
  assert.equal(barsFor('day', report, from, to)[0].amount, 100)
  assert.equal(barsFor('month', report, from, to).length, 1)
})

// ── Шкала графика ────────────────────────────────────────────

test('верхняя отметка шкалы не ниже максимума и круглая', () => {
  const { top, ticks } = chartScale(68400)
  assert.ok(top >= 68400, `верх ${top} не ниже максимума`)
  assert.equal(ticks[0], 0, 'шкала начинается с нуля')
  assert.equal(ticks[ticks.length - 1], top)
  // Шаг одинаковый — иначе линии сетки врут о расстоянии
  const step = ticks[1] - ticks[0]
  for (let i = 1; i < ticks.length; i++) assert.equal(ticks[i] - ticks[i - 1], step)
})

test('шкала не мельче шекеля и не делится на ноль', () => {
  assert.deepEqual(chartScale(0), { top: 0, ticks: [] }, 'продаж нет — шкалы нет')
  assert.deepEqual(chartScale(-500), { top: 0, ticks: [] })
  assert.deepEqual(chartScale(undefined), { top: 0, ticks: [] })
  const small = chartScale(120)
  assert.ok(small.ticks[1] - small.ticks[0] >= 100, 'шаг не мельче 1 ₪')
})

test('доля столбика не выходит за края и переживает нулевой знаменатель', () => {
  assert.equal(barShare(5000, 10000), 50)
  assert.equal(barShare(10000, 10000), 100)
  // Сумма способа оплаты складывается с возвратами и бывает нулевой
  assert.equal(barShare(1000, 0), 0)
  assert.equal(barShare(-1000, 10000), 0)
  assert.ok(barShare(20000, 10000) <= 100)
})

// ── Подписи ──────────────────────────────────────────────────

test('счётчик называет, чего он: заказы, платежи и единственное число', () => {
  assert.equal(ordersLabel(18), '18 orders')
  assert.equal(ordersLabel(1), '1 order')
  assert.equal(ordersLabel(0), '0 orders')
  // У способа оплаты сервер считает платежи, а не заказы: чек с двумя
  // способами оплаты — это один заказ и два платежа
  assert.equal(ordersLabel(62, 'payment'), '62 payments')
})

test('деньги показываются в шекелях, а копейки — только когда они есть', () => {
  assert.match(formatMoney(428640), /4,286\.4/)
  assert.match(formatMoney(400000), /4,000/)
  assert.ok(!formatMoney(400000).includes('.00'))
  assert.equal(methodLabel('tenbis'), '10bis')
  // Неизвестный способ показываем как есть — выдумывать перевод нельзя
  assert.equal(methodLabel('crypto'), 'crypto')
})

// ── Аргументы запроса ────────────────────────────────────────

test('пустой выбор точек уходит как NULL — сервер понимает «все точки»', () => {
  const p = salesParams(new Date('2026-08-01T00:00:00Z'), new Date('2026-08-02T00:00:00Z'),
    { locationIds: [], tz: 'Asia/Jerusalem' })
  assert.equal(p.p_location_ids, null)
  assert.equal(p.p_from, '2026-08-01T00:00:00.000Z')
  assert.equal(p.p_to, '2026-08-02T00:00:00.000Z')
  assert.equal(p.p_tz, 'Asia/Jerusalem')
  // Веб-владелец подтверждён членством (089) — PIN-сессии здесь нет
  assert.equal(p.p_staff_session, null)
})

test('несколько точек уходят списком, а не первой из них', () => {
  const p = salesParams(new Date(), new Date(), { locationIds: ['l1', 'l2'], tz: 'UTC' })
  assert.deepEqual(p.p_location_ids, ['l1', 'l2'])
})
