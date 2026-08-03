import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import ReservationsDesk from './ReservationsDesk.jsx'
import { todayInZone } from './timeline.js'

/**
 * Раздел броней в разметке.
 *
 * До этого он не был покрыт ничем: логика полотна проверялась отдельно,
 * а сам экран — никогда, и свободная переменная в компоненте доезжала до
 * владельца (так уже случилось с вкладкой «Модификаторы»).
 *
 * Проверяется рабочая рамка раздела: день и поиск в шапке, отсутствие
 * метрик над полотном и то, что вкладка приходит из адреса.
 */

const context = {
  organization: { id: 'org-1', name: 'Test cafe' },
  member: { role: 'owner' },
  locations: [{ id: 'loc-1', name: 'Main', currency: 'ILS', timezone: 'Asia/Jerusalem' }],
  capabilities: ['reservations_desk'],
}

const noop = () => {}

function render(props = {}) {
  return renderToStaticMarkup(h(ReservationsDesk, {
    context,
    locationId: 'loc-1',
    tab: 'timeline',
    onTabChange: noop,
    date: null,
    onDateChange: noop,
    ...props,
  }))
}

describe('раздел броней', () => {
  it('шапка держит день, поиск и оба способа завести гостя', () => {
    const html = render()
    assert.match(html, /<h1>Reservations<\/h1>/)
    assert.match(html, /aria-label="Reservations day"/)
    assert.match(html, /aria-label="Previous day"/)
    assert.match(html, /aria-label="Next day"/)
    assert.match(html, /Search reservations/)
    assert.match(html, /New reservation/)
    assert.match(html, /Walk-in/)
  })

  it('день берётся из адреса, а не из «сегодня»', () => {
    const html = render({ date: '2026-05-17' })
    assert.match(html, /value="2026-05-17"/)
  })

  it('без дня в адресе открыт сегодняшний день точки, и кнопки «Today» нет', () => {
    const html = render()
    const today = todayInZone(Date.now(), 'Asia/Jerusalem')
    assert.match(html, new RegExp(`value="${today}"`))
    // Кнопка, которая ничего не изменит, не сообщает ничего: дата в
    // селекторе и есть ответ «сегодня»
    assert.equal(html.includes('rsv-today'), false)
  })

  it('на другом дне «Today» возвращает обратно', () => {
    assert.match(render({ date: '2026-05-17' }), /class="rsv-today"[^>]*>Today</)
  })

  it('над полотном нет метрик — место отдано столам', () => {
    const html = render()
    for (const metric of ['Busy now', 'Seats free', 'Next hour', 'timeline-summary']) {
      assert.equal(html.includes(metric), false, `${metric} не должен возвращаться на полотно`)
    }
  })

  it('вкладка приходит из адреса', () => {
    const timeline = render({ tab: 'timeline' })
    assert.match(timeline, /aria-selected="true"[^>]*>Timeline/)
    const waitlist = render({ tab: 'waitlist' })
    assert.match(waitlist, /aria-selected="true"[^>]*>Waitlist/)
    // Устаревшая ссылка — не ошибка: открывается вид по умолчанию
    const broken = render({ tab: 'nonsense' })
    assert.match(broken, /aria-selected="true"[^>]*>Timeline/)
  })

  it('полотно на загрузке держит геометрию, а не схлопывается в строку', () => {
    const html = render()
    assert.match(html, /timeline-skeleton/)
    assert.match(html, /Loading the timeline…/)
  })
})
