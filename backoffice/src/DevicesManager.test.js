import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DeviceRow } from './DevicesManager.jsx'

/**
 * Строка парка касс после перевода на общие примитивы.
 *
 * Проверяется не внешний вид, а то, что владелец должен получить от
 * строки: состояние словом (а не только цветной точкой), совет по
 * молчащему терминалу и кнопки, называющие КОНКРЕТНУЮ кассу. Последнее
 * уже один раз стоило нам регресса: переименование не сохранялось, и
 * автопроверка этого не поймала, потому что кнопка была безымянной.
 */

const base = {
  id: 'd-1',
  name: 'Стойка 1',
  location_id: 'loc-1',
  location_name: 'Пинскер 29',
  app_version: '1.5.0',
  silence_seconds: 60,
  outbox_pending: 0,
  outbox_failed: 0,
  outbox_oldest_at: null,
  archived_at: null,
}

const noop = () => {}
const row = (device, busy = false) => renderToStaticMarkup(
  h(DeviceRow, { device, busy, onRename: noop, onArchive: noop })
)

describe('строка устройства', () => {
  it('состояние названо словом, а не одним цветом', () => {
    assert.match(row(base), /Online/)
    assert.match(row({ ...base, silence_seconds: 7200 }), /Offline/)
    assert.match(row({ ...base, outbox_failed: 1 }), /Queue stuck/)
    assert.match(row({ ...base, silence_seconds: null }), /Never seen/)
  })

  it('кнопки называют конкретную кассу', () => {
    const html = row(base)
    assert.match(html, /aria-label="Rename Стойка 1"/)
    assert.match(html, /aria-label="Archive Стойка 1"/)
    assert.match(html, /aria-label="Actions for Стойка 1"/)
    assert.match(html, /device-actions-mobile/)
  })

  it('архивная строка предлагает вернуть, а не архивировать снова', () => {
    const html = row({ ...base, archived_at: '2026-08-01T10:00:00Z' })
    assert.match(html, /aria-label="Restore Стойка 1"/)
    assert.match(html, /archived/)
    // Совет по проблеме архивной кассы не показываем: её судьба уже решена
    assert.doesNotMatch(html, /Check the internet connection/)
  })

  it('молчащая касса объясняет, что делать', () => {
    const html = row({ ...base, silence_seconds: 9000 })
    assert.ok(html.includes('device-advice'), 'ожидался совет владельцу')
    assert.match(html, /lucide-triangle-alert/)
  })

  it('во время запроса кнопки строки заблокированы', () => {
    const html = row(base, true)
    // Две быстрые десктопные кнопки и одно мобильное меню.
    assert.equal((html.match(/disabled=""/g) || []).length, 3)
  })

  it('версия показывается, а её отсутствие названо прямо', () => {
    assert.match(row(base), /v1\.5\.0/)
    assert.match(row({ ...base, app_version: null }), /No version reported/)
  })

  it('разделяет статус, имя, версию и последнее подключение по колонкам', () => {
    const html = row(base)
    assert.match(html, /class="device-status is-online"/)
    assert.match(html, /class="device-name"/)
    assert.match(html, /class="device-version"/)
    assert.match(html, /Last seen 1m ago/)
  })
})
