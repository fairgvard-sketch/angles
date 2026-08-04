import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Button, IconButton } from './Button.jsx'
import Tabs from './Tabs.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import {
  EmptyPanel, EmptyState, ErrorText, PageHeader, Panel, SearchField, StatusBadge,
} from './Layout.jsx'

/**
 * Примитивы проверяются рендером, а не глазами.
 *
 * Смысл именно в тех свойствах, которые раньше зависели от внимательности
 * автора экрана и молча терялись: тип кнопки, доступное имя у иконки,
 * подпись у поля поиска, текст рядом с цветной точкой, roving tabindex у
 * вкладок. Внешний вид (классы) закреплён отдельно — он не должен
 * измениться от появления компонента.
 */

const render = (el) => renderToStaticMarkup(el)
const noop = () => {}

describe('Button', () => {
  it('по умолчанию не отправляет форму', () => {
    assert.match(render(h(Button, null, 'Save')), /type="button"/)
  })

  it('оставляет прежние классы вариантов', () => {
    assert.match(render(h(Button, { variant: 'primary' }, 'A')), /class="primary-button"/)
    assert.match(render(h(Button, { variant: 'secondary' }, 'A')), /class="secondary-button"/)
    assert.match(render(h(Button, { variant: 'text' }, 'A')), /class="text-button"/)
    assert.match(
      render(h(Button, { variant: 'primary', size: 'compact' }, 'A')),
      /class="primary-button compact"/
    )
  })

  it('занятая кнопка заблокирована и говорит об этом', () => {
    const html = render(h(Button, { busy: true, busyLabel: 'Saving…' }, 'Save'))
    assert.match(html, /disabled=""/)
    assert.match(html, /aria-busy="true"/)
    assert.match(html, /Saving…/)
  })

  it('неизвестный вариант не роняет экран, а падает во вторичный', () => {
    assert.match(render(h(Button, { variant: 'nope' }, 'A')), /class="secondary-button"/)
  })
})

describe('IconButton', () => {
  it('всегда имеет доступное имя', () => {
    const html = render(h(IconButton, { label: 'Rename Стойка 1' }, '×'))
    assert.match(html, /aria-label="Rename Стойка 1"/)
    assert.match(html, /class="icon-button"/)
  })
})

describe('SearchField', () => {
  it('подпись есть всегда, даже когда плейсхолдер исчез', () => {
    const html = render(h(SearchField, {
      label: 'Search devices', value: 'касса', onChange: noop, placeholder: 'Name',
    }))
    assert.match(html, /class="visually-hidden">Search devices</)
    assert.match(html, /value="касса"/)
    assert.match(html, /type="search"/)
  })
})

describe('StatusBadge', () => {
  it('состояние передаётся словом, а не только точкой', () => {
    const html = render(h(StatusBadge, { className: 'device-status', tone: 'offline', label: 'Offline' }))
    assert.match(html, /class="device-status is-offline"/)
    assert.match(html, /Offline/)
    // Точка декоративна: скринридер не должен её объявлять
    assert.match(html, /<i aria-hidden="true"/)
  })
})

describe('PageHeader, Panel и пустые состояния', () => {
  it('заголовок раздела — одно название, без организации и описания', () => {
    const html = render(h(PageHeader, { title: 'Devices' }))
    assert.match(html, /class="page-heading"/)
    assert.match(html, /<h1>Devices<\/h1>/)
    // Организация и точка стоят в шапке приложения: дублировать их
    // над каждым разделом незачем
    assert.doesNotMatch(html, /eyebrow/)
  })

  it('панель без заголовка не рисует пустую шапку', () => {
    const bare = render(h(Panel, null, h('p', null, 'x')))
    assert.doesNotMatch(bare, /panel-heading/)
    const titled = render(h(Panel, { title: 'Пинскер 29', description: '2 devices' }))
    assert.match(titled, /panel-heading/)
    assert.match(titled, /2 devices/)
  })

  it('пустые состояния объясняют, что делать', () => {
    assert.match(render(h(EmptyState, null, 'No devices match this search.')), /class="empty-state"/)
    const panel = render(h(EmptyPanel, {
      icon: '□', title: 'No devices yet', description: 'Terminals appear here…',
    }))
    assert.match(panel, /section-placeholder panel/)
    assert.match(panel, /No devices yet/)
  })

  it('ошибка объявляется сразу', () => {
    assert.match(render(h(ErrorText, null, 'boom')), /role="alert"/)
  })
})

describe('Tabs', () => {
  const items = [
    { key: 'items', label: 'Items' },
    { key: 'modifiers', label: 'Modifiers' },
    { key: 'stations', label: 'Stations' },
  ]
  const html = render(h(Tabs, {
    className: 'period-switch menu-tabs', label: 'Menu section',
    items, value: 'modifiers', onChange: noop,
  }))

  it('объявляет группу и выбранную вкладку', () => {
    assert.match(html, /role="tablist"/)
    assert.match(html, /aria-label="Menu section"/)
    assert.equal(html.match(/role="tab"/g).length, 3)
    assert.equal(html.match(/aria-selected="true"/g).length, 1)
  })

  it('в группу ведёт одна точка входа: активная вкладка', () => {
    // roving tabindex: Tab заводит в группу один раз, дальше — стрелки
    assert.equal(html.match(/tabindex="0"/g).length, 1)
    assert.equal(html.match(/tabindex="-1"/g).length, 2)
  })

  it('сохраняет классы экрана — компонент не меняет внешний вид', () => {
    assert.match(html, /class="period-switch menu-tabs"/)
    assert.match(html, /class="is-active"/)
  })
})

describe('ConfirmDialog', () => {
  const props = {
    title: 'Reject this booking?',
    description: 'Мири · 2 Aug 19:00 · 2 guests.',
    confirmLabel: 'Reject booking',
    cancelLabel: 'Keep the booking',
    onConfirm: noop,
    onCancel: noop,
  }

  it('объявляется срочным диалогом с именем', () => {
    const html = render(h(ConfirmDialog, props))
    assert.match(html, /role="alertdialog"/)
    assert.match(html, /aria-modal="true"/)
    assert.match(html, /id="confirm-title">Reject this booking\?/)
    assert.match(html, /Keep the booking/)
  })

  it('поле причины появляется только когда его просят, и подписано как необязательное', () => {
    const bare = render(h(ConfirmDialog, props))
    assert.doesNotMatch(bare, /<input/)

    const withReason = render(h(ConfirmDialog, {
      ...props,
      reason: { label: 'Reason for the guest', placeholder: 'Fully booked…' },
    }))
    assert.match(withReason, /Reason for the guest \(optional\)/)
    assert.match(withReason, /placeholder="Fully booked…"/)
  })

  it('опасное действие не притворяется основным', () => {
    const html = render(h(ConfirmDialog, { ...props, tone: 'danger' }))
    assert.doesNotMatch(html, /class="primary-button compact"/)
    assert.match(html, /is-danger/)
  })
})
