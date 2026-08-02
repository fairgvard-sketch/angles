import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { EMPTY_FILTERS, ItemsTab, ModifiersTab, StationsTab } from './MenuManager.jsx'

/**
 * Вкладки каталога рендерятся по-настоящему.
 *
 * Мотив конкретный: во вкладку «Модификаторы» был скопирован блок
 * массовой правки из «Товаров», и она обращалась к переменным, которых
 * в ней нет. Сборка проходила, тесты логики проходили, а у владельца
 * вкладка роняла ВЕСЬ кабинет в белый экран. Такую ошибку ловит только
 * рендер, поэтому он здесь и появился.
 */

const context = {
  organization: { name: 'Test cafe' },
  locations: [{ id: 'loc-1', name: 'Main' }],
  capabilities: ['pos_operate'],
}

const emptyData = { categories: [], items: [], modifierGroups: [], stations: [] }

const fullData = {
  categories: [{ id: 'cat-1', name: 'Coffee', location_id: 'loc-1' }],
  items: [
    {
      id: 'item-1', name: 'Espresso', price: 1200, category_id: 'cat-1',
      is_available: true, sku: 'ESP', description: 'Double shot',
      image_url: 'x', station_id: 'st-1', item_variants: [],
    },
    {
      id: 'item-2', name: 'Latte', price: 1600, category_id: 'cat-1',
      is_available: false, sku: null, description: null,
      image_url: null, station_id: null, item_variants: [],
    },
  ],
  modifierGroups: [
    {
      id: 'g-1', name: 'Milk', min_select: 0, max_select: 1,
      modifiers: [
        { id: 'm-1', name: 'Oat', price_delta: 300 },
        { id: 'm-2', name: 'Regular', price_delta: 0 },
      ],
    },
    { id: 'g-2', name: 'Syrup', min_select: 0, max_select: 3, modifiers: [] },
  ],
  stations: [{ id: 'st-1', name: 'Bar' }],
}

const noop = () => {}

const renderItems = (data, filters = EMPTY_FILTERS) => renderToStaticMarkup(
  h(ItemsTab, {
    context, locationId: 'loc-1', data, reload: noop, filters, onFilters: noop,
  })
)
const renderModifiers = (data) => renderToStaticMarkup(
  h(ModifiersTab, { context, data, reload: noop })
)
const renderStations = (data) => renderToStaticMarkup(
  h(StationsTab, { context, data, reload: noop })
)

describe('catalogue tabs render', () => {
  it('walks Items -> Modifiers -> Stations -> Items on a full catalogue', () => {
    const items = renderItems(fullData)
    assert.match(items, /Espresso/)

    const modifiers = renderModifiers(fullData)
    assert.match(modifiers, /Milk/)
    assert.match(modifiers, /Syrup/)
    assert.match(modifiers, /Oat/)

    const stations = renderStations(fullData)
    assert.match(stations, /Bar/)

    // Возврат на «Товары» — тот же экран, а не другой
    assert.equal(renderItems(fullData), items)
  })

  it('opens Modifiers with zero, one and several groups', () => {
    const empty = renderModifiers(emptyData)
    assert.match(empty, /No modifier groups yet/)

    const one = renderModifiers({ ...fullData, modifierGroups: [fullData.modifierGroups[0]] })
    assert.match(one, /Milk/)
    assert.doesNotMatch(one, /No modifier groups yet/)

    const many = renderModifiers(fullData)
    assert.match(many, /Milk/)
    assert.match(many, /Syrup/)
  })

  it('never shows Items bulk actions inside Modifiers', () => {
    const modifiers = renderModifiers(fullData)
    for (const stray of ['Select all shown', 'Put on sale', 'Move to…', 'Change price…']) {
      assert.doesNotMatch(modifiers, new RegExp(stray))
    }
  })

  it('renders every tab on an empty catalogue', () => {
    assert.match(renderItems(emptyData), /catalogue is empty|Nothing matches/)
    assert.match(renderModifiers(emptyData), /No modifier groups yet/)
    assert.match(renderStations(emptyData), /No stations yet/)
  })
})

describe('catalogue filters belong to the section, not to the tab', () => {
  it('renders the filter the section holds, so a tab switch cannot drop it', () => {
    const filtered = renderItems(fullData, { ...EMPTY_FILTERS, query: 'latte' })
    assert.match(filtered, /value="latte"/)
    assert.match(filtered, /Latte/)
    assert.doesNotMatch(filtered, /Espresso/)
    // Счётчик подтверждает, что отбор реально применён
    assert.match(filtered, /1 of 2/)
  })

  it('applies availability and completeness filters from the same object', () => {
    const hidden = renderItems(fullData, { ...EMPTY_FILTERS, availability: 'hidden' })
    assert.match(hidden, /Latte/)
    assert.doesNotMatch(hidden, />Espresso</)

    const incomplete = renderItems(fullData, { ...EMPTY_FILTERS, state: 'incomplete' })
    assert.match(incomplete, /Latte/)
  })
})
