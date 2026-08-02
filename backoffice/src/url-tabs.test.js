import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import MenuManager from './MenuManager.jsx'
import TeamManager from './TeamManager.jsx'
import GuestsManager from './GuestsManager.jsx'
import LocationSettings from './LocationSettings.jsx'

/**
 * Вкладка раздела живёт в адресе.
 *
 * До этого её помнил только раздел броней: во всех остальных перезагрузка
 * страницы и присланная ссылка открывали первую вкладку. Владелец,
 * который прислал в поддержку ссылку на «Станции», получал в ответ
 * «Товары».
 *
 * Проверяется выбор по значению из адреса и то, что мусорное значение —
 * не ошибка, а устаревшая ссылка: раздел открывается на вкладке по
 * умолчанию.
 */

const context = {
  organization: { id: 'org-1', name: 'Test cafe' },
  member: { role: 'owner' },
  locations: [{ id: 'loc-1', name: 'Main', currency: 'ILS', timezone: 'Asia/Jerusalem' }],
  capabilities: ['pos_operate', 'catalog_manage'],
}

const noop = () => {}

/** Подпись выбранной вкладки в отрендеренной разметке */
function selectedTab(html) {
  const match = html.match(/aria-selected="true"[^>]*>([^<]*)/)
  return match ? match[1].trim() : null
}

describe('вкладка приходит из адреса', () => {
  it('каталог открывается на вкладке из ссылки', () => {
    const stations = renderToStaticMarkup(
      h(MenuManager, { context, locationId: 'loc-1', tab: 'stations', onTabChange: noop })
    )
    assert.equal(selectedTab(stations), 'Stations')

    const modifiers = renderToStaticMarkup(
      h(MenuManager, { context, locationId: 'loc-1', tab: 'modifiers', onTabChange: noop })
    )
    assert.equal(selectedTab(modifiers), 'Modifiers')
  })

  it('без вкладки в адресе и с мусором в ней открывается первая', () => {
    for (const tab of [null, undefined, 'nope']) {
      const html = renderToStaticMarkup(
        h(MenuManager, { context, locationId: 'loc-1', tab, onTabChange: noop })
      )
      assert.equal(selectedTab(html), 'Items', `tab=${String(tab)}`)
    }
  })

  it('команда и настройки точки тоже адресуемы', () => {
    const roles = renderToStaticMarkup(h(TeamManager, { context, tab: 'roles', onTabChange: noop }))
    assert.match(roles, /aria-selected="true"/)
    assert.notEqual(selectedTab(roles), 'Staff')

    const receipt = renderToStaticMarkup(
      h(LocationSettings, { context, locationId: 'loc-1', tab: 'receipt', onTabChange: noop })
    )
    assert.match(receipt, /aria-selected="true"/)
  })

  it('экран дублей клиентов открывается по ссылке', () => {
    const dupes = renderToStaticMarkup(
      h(GuestsManager, { context, tab: 'duplicates', onTabChange: noop })
    )
    assert.match(dupes, /Back to list/)

    const list = renderToStaticMarkup(h(GuestsManager, { context, tab: null, onTabChange: noop }))
    assert.doesNotMatch(list, /Back to list/)
  })
})
