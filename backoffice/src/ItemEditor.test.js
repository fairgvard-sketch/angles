import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import ItemEditor from './ItemEditor.jsx'
import { courseLabel } from './catalog.js'
import { itemPayload } from './menu.js'

/**
 * Курс подачи в карточке позиции (Kassa 179).
 *
 * Курс по умолчанию задаётся здесь, рядом с ценой и станцией: на счёте
 * стола курс 1 уходит на кухню сразу, следующие ждут Fire на кассе.
 */

const context = {
  organization: { id: 'org-1', name: 'Test cafe' },
  locations: [{ id: 'loc-1', name: 'Main' }],
  capabilities: ['pos_operate', 'catalog_manage'],
}

const item = {
  id: 'item-1', name: 'Steak', price: 9000, category_id: 'cat-1',
  is_available: true, sku: null, description: 'Grilled', image_url: null,
  station_id: null, course: 2, item_variants: [], menu_item_modifier_groups: [],
}

const render = (props) => renderToStaticMarkup(h(ItemEditor, {
  context,
  item,
  categories: [{ id: 'cat-1', name: 'Kitchen' }],
  stations: [],
  modifierGroups: [],
  editing: false,
  onEdit: () => {},
  onClose: () => {},
  onSaved: async () => {},
  onDeleted: () => {},
  api: { saveItem: async () => {}, deleteItem: async () => {}, uploadItemImage: async () => '' },
  ...props,
}))

describe('course in the item card', () => {
  it('names the course in words, and the empty course as served right away', () => {
    assert.equal(courseLabel(2), 'Course 2')
    assert.equal(courseLabel(null), 'No course — sent right away')
    assert.equal(courseLabel(7), 'No course — sent right away')
  })

  it('shows the course next to the preparation station', () => {
    const markup = render()
    assert.match(markup, /<dt>Course<\/dt><dd>Course 2<\/dd>/)
  })

  it('the editor keeps the saved course selected', () => {
    const markup = render({ editing: true })
    assert.match(markup, /<option value="2" selected="">Course 2<\/option>/)
    assert.match(markup, /later courses wait until the waiter taps Fire/)
  })
})

describe('course in the save payload', () => {
  const base = { name: 'Steak', category_id: 'cat-1', price: 9000, is_available: true }

  it('sends the course the editor manages, including clearing it', () => {
    assert.equal(itemPayload({ ...base, course: 3 }).course, 3)
    assert.equal(itemPayload({ ...base, course: null }).course, null)
  })

  it('leaves the key out for callers that do not manage the course', () => {
    assert.equal('course' in itemPayload(base), false)
  })
})
