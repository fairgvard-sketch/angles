import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import ActivityManager, { JournalRow } from './ActivityManager.jsx'

/**
 * Журнал регистра после редизайна.
 *
 * Проверяется не вёрстка, а то, ради чего в раздел приходят: событие
 * названо словом, у него видны точка, касса, деталь, сумма и точное
 * время; фильтры подписаны; выбор точки появляется только тогда, когда
 * точек больше одной; выгружать нечего — кнопка выключена.
 *
 * Компонент рендерится статически, поэтому эффекты не идут и в сеть
 * никто не ходит: это состояние первой загрузки, каким его видит
 * владелец до ответа сервера.
 */

const render = (el) => renderToStaticMarkup(el)
const TLV = 'Asia/Jerusalem'

const context = (locations) => ({
  organization: { name: 'Bulochka' },
  locations,
})

const ONE = [{ id: 'l1', name: 'Dizengoff', timezone: TLV }]
const TWO = [...ONE, { id: 'l2', name: 'Pinsker', timezone: TLV }]

describe('строка журнала', () => {
  it('возврат: кто, где, чем и почему — и минус только у суммы', () => {
    const html = render(h(JournalRow, {
      timeZone: TLV,
      event: {
        id: 'e1', type: 'refund_issued', created_at: '2026-08-04T07:47:00Z',
        staff_name: 'Eyal Levi', location_name: 'Dizengoff', device_name: 'Register 1',
        amount: 2400, detail: { method: 'card', reason: 'Wrong item' },
      },
    }))
    assert.match(html, /Eyal Levi issued a refund/)
    assert.match(html, /Dizengoff · Register 1 · Card · Wrong item/)
    assert.match(html, /−24 ₪/)
    assert.match(html, /10:47/, 'время точное и в часах точки')
    assert.match(html, /act-mark is-refund/)
  })

  it('открытие смены: вступительная сумма и свой тон', () => {
    const html = render(h(JournalRow, {
      timeZone: TLV,
      event: {
        id: 'e2', type: 'shift_opened', created_at: '2026-08-04T06:02:00Z',
        staff_name: 'Dana Cohen', location_name: 'Dizengoff', device_name: 'Register 2',
        amount: 20000, detail: {},
      },
    }))
    assert.match(html, /Dana Cohen opened a shift/)
    assert.match(html, /Float 200 ₪/)
    assert.match(html, /act-mark is-open/)
    assert.match(html, /09:02/)
  })

  it('закрытие смены: итог, заказы и расхождение кассы', () => {
    const html = render(h(JournalRow, {
      timeZone: TLV,
      event: {
        id: 'e3', type: 'shift_closed', created_at: '2026-08-04T15:13:00Z',
        staff_name: 'Dana Cohen', location_name: 'Dizengoff', device_name: 'Register 2',
        amount: 184250, detail: { orders_count: 63, cash_diff: 320 },
      },
    }))
    assert.match(html, /Dana Cohen closed a shift/)
    assert.match(html, /63 orders · cash \+3\.20 ₪/)
    assert.match(html, /1,842\.50 ₪/)
    assert.match(html, /18:13/)
  })

  it('значок события скрыт от озвучки — тип уже назван словом', () => {
    const html = render(h(JournalRow, {
      timeZone: TLV,
      event: {
        id: 'e4', type: 'shift_opened', created_at: '2026-08-04T06:02:00Z',
        staff_name: 'Dana', location_name: 'Dizengoff', amount: 0, detail: {},
      },
    }))
    assert.match(html, /<span class="act-mark is-open" aria-hidden="true">/)
  })

  it('событие без даты не роняет строку', () => {
    const html = render(h(JournalRow, {
      timeZone: TLV,
      event: {
        id: 'e5', type: 'shift_closed', created_at: null,
        staff_name: 'Dana', location_name: 'Dizengoff', amount: 1000, detail: {},
      },
    }))
    assert.match(html, /Dana closed a shift/)
    assert.match(html, /—/, 'время неизвестно, но событие видно')
  })
})

describe('раздел Activity', () => {
  it('обещает ровно три вида событий и ни одного лишнего', () => {
    const html = render(h(ActivityManager, { context: context(ONE) }))
    // Виды событий обещают сами чипы фильтра, а не подпись под заголовком
    assert.match(html, /<h1>Activity<\/h1>/)
    for (const chip of ['All events', 'Shifts opened', 'Shifts closed', 'Refunds']) {
      assert.ok(html.includes(chip), `чип «${chip}» на месте`)
    }
    assert.doesNotMatch(html, /Logins|Catalogue|Reservations|Permission/)
  })

  it('фильтры подписаны, чипы — множественный выбор', () => {
    const html = render(h(ActivityManager, { context: context(ONE) }))
    assert.match(html, /Search activity/)
    assert.match(html, /Time range/)
    assert.match(html, /aria-label="Event types"/)
    assert.match(html, /aria-pressed="true">All events/)
    assert.match(html, /aria-pressed="false">Shifts opened/)
  })

  it('выбор точки — только у аккаунта с несколькими точками', () => {
    assert.doesNotMatch(render(h(ActivityManager, { context: context(ONE) })), /All locations/)
    const many = render(h(ActivityManager, { context: context(TWO) }))
    assert.match(many, /All locations/)
    assert.match(many, /Pinsker/)
  })

  it('обновление названо словом, выгружать нечего — кнопка выключена', () => {
    const html = render(h(ActivityManager, { context: context(ONE) }))
    assert.match(html, /aria-label="Refresh activity"/)
    assert.match(html, /<button type="button" class="secondary-button" disabled=""/)
    assert.match(html, /Export CSV/)
  })

  it('первая загрузка честно говорит, что идёт, а не рисует пустой журнал', () => {
    const html = render(h(ActivityManager, { context: context(ONE) }))
    assert.match(html, /<p class="act-count" role="status">Loading…<\/p>/)
    assert.doesNotMatch(html, /Load more/)
  })
})
