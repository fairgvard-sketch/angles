import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import MenuManager from './MenuManager.jsx'
import TeamManager from './TeamManager.jsx'
import GuestsManager from './GuestsManager.jsx'
import LocationSettings from './LocationSettings.jsx'
import ReportsSection from './ReportsSection.jsx'
import SettingsPage from './SettingsPage.jsx'

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
    // Люди, роли и права съехались на одну страницу: все четыре прежних
    // адреса обязаны открыть её, а не первую попавшуюся вкладку
    for (const legacy of ['access', 'roles', 'perms', 'staff']) {
      const html = renderToStaticMarkup(h(TeamManager, { context, tab: legacy, onTabChange: noop }))
      assert.equal(selectedTab(html), 'People &amp; access', `tab=${legacy}`)
    }
    // Табель остался отдельной вкладкой — у него другой вопрос и свой месяц
    const hours = renderToStaticMarkup(h(TeamManager, { context, tab: 'hours', onTabChange: noop }))
    assert.equal(selectedTab(hours), 'Hours')

    const receipts = renderToStaticMarkup(
      h(LocationSettings, { context, locationId: 'loc-1', tab: 'receipts', onTabChange: noop })
    )
    assert.equal(selectedTab(receipts), 'Receipts &amp; tax')
    assert.match(receipts, /location-settings-picker/)
    assert.match(receipts, /location-settings-tabs/)
    assert.match(receipts, />Main<\/option>/)

    const pos = renderToStaticMarkup(
      h(LocationSettings, { context, locationId: 'loc-1', tab: 'pos', onTabChange: noop })
    )
    assert.equal(selectedTab(pos), 'POS defaults')
  })

  it('настройки точки: мусор в адресе открывает Details', () => {
    for (const tab of [null, 'nope', 'loyalty', 'export']) {
      const html = renderToStaticMarkup(
        h(LocationSettings, { context, locationId: 'loc-1', tab, onTabChange: noop })
      )
      assert.equal(selectedTab(html), 'Details', `tab=${String(tab)}`)
    }
  })

  it('экран дублей клиентов открывается по ссылке — теперь режимом', () => {
    const dupes = renderToStaticMarkup(
      h(GuestsManager, { context, tab: 'directory', mode: 'duplicates', onTabChange: noop })
    )
    assert.match(dupes, /Back to list/)

    const list = renderToStaticMarkup(h(GuestsManager, { context, tab: null, onTabChange: noop }))
    assert.doesNotMatch(list, /Back to list/)
  })

  it('клиенты и отчёты открываются на вкладке из ссылки', () => {
    const loyalty = renderToStaticMarkup(
      h(GuestsManager, { context, tab: 'loyalty', locationId: 'loc-1', onTabChange: noop })
    )
    assert.equal(selectedTab(loyalty), 'Loyalty')
    // Скоуп назван прямо: правила лежат на точке, а не на организации
    assert.match(loyalty, /Applies to/)

    const directory = renderToStaticMarkup(
      h(GuestsManager, { context, tab: 'directory', onTabChange: noop })
    )
    assert.equal(selectedTab(directory), 'Directory')

    const fiscal = renderToStaticMarkup(
      h(ReportsSection, { context, tab: 'fiscal', locationId: 'loc-1', onTabChange: noop })
    )
    assert.equal(selectedTab(fiscal), 'Fiscal')

    const settings = renderToStaticMarkup(
      h(SettingsPage, { context, tab: 'products', email: 'a@b.c', onTabChange: noop })
    )
    assert.equal(selectedTab(settings), 'Plans &amp; products')
  })

  it('Settings не дублирует самостоятельный раздел Locations', () => {
    const html = renderToStaticMarkup(
      h(SettingsPage, {
        context: { ...context, counts: { locations: 1, staff: 2 } },
        tab: 'business', email: 'a@b.c', onTabChange: noop,
      })
    )
    assert.equal(selectedTab(html), 'Workspace')
    assert.match(html, /Workspace identity is read-only/)
    assert.doesNotMatch(html, /<h2>Locations<\/h2>/)
    assert.doesNotMatch(html, /Configure Main/)
  })
})
