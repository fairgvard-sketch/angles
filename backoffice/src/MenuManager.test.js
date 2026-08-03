import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import MenuManager, {
  EMPTY_FILTERS, ItemsTab, ModifiersTab, StationsTab, readFilters, writeFilters,
} from './MenuManager.jsx'

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
  capabilities: ['pos_operate', 'catalog_manage'],
}

const emptyData = { categories: [], items: [], modifierGroups: [], stations: [] }

const fullData = {
  categories: [{ id: 'cat-1', name: 'Coffee', location_id: 'loc-1' }],
  items: [
    {
      id: 'item-1', name: 'Espresso', price: 1200, category_id: 'cat-1',
      is_available: true, sku: 'ESP', description: 'Double shot',
      image_url: 'x', station_id: 'st-1', item_variants: [],
      menu_item_modifier_groups: [{ group_id: 'g-1', sort_order: 0 }],
    },
    {
      id: 'item-2', name: 'Latte', price: 1600, category_id: 'cat-1',
      is_available: false, sku: null, description: null,
      image_url: null, station_id: null, item_variants: [],
      menu_item_modifier_groups: [],
    },
  ],
  modifierGroups: [
    {
      id: 'g-1', name: 'Milk', min_select: 0, max_select: 1, sort_order: 0,
      modifiers: [
        { id: 'm-1', name: 'Oat', price_delta: 300, is_available: true, sort_order: 0 },
        { id: 'm-2', name: 'Regular', price_delta: 0, is_default: true, is_available: true, sort_order: 1 },
      ],
    },
    { id: 'g-2', name: 'Syrup', min_select: 0, max_select: 3, sort_order: 1, modifiers: [] },
  ],
  stations: [{ id: 'st-1', name: 'Bar', sort_order: 0 }],
}

const noop = () => {}

const renderItems = (data, filters = EMPTY_FILTERS, query = '') => renderToStaticMarkup(
  h(ItemsTab, {
    context, locationId: 'loc-1', data, reload: noop, filters, onFilters: noop,
    query, creating: null, onCreating: noop,
  })
)
const renderModifiers = (data, filters = EMPTY_FILTERS, query = '') => renderToStaticMarkup(
  h(ModifiersTab, {
    context, data, reload: noop, filters, onFilters: noop,
    query, creating: null, onCreating: noop,
  })
)
const renderStations = (data, query = '') => renderToStaticMarkup(
  h(StationsTab, {
    context, locationId: 'loc-1', data, reload: noop,
    query, creating: null, onCreating: noop,
  })
)
const renderShell = (tab) => renderToStaticMarkup(
  h(MenuManager, {
    context, locationId: 'loc-1', onLocationChange: noop,
    tab, onTabChange: noop, filters: {}, onFiltersChange: noop,
  })
)

describe('catalogue tabs render', () => {
  it('walks Items -> Modifiers -> Stations -> Items on a full catalogue', () => {
    const items = renderItems(fullData)
    assert.match(items, /Espresso/)

    const modifiers = renderModifiers(fullData)
    assert.match(modifiers, /Milk/)
    assert.match(modifiers, /Syrup/)

    const stations = renderStations(fullData)
    assert.match(stations, /Bar/)

    // Возврат на «Товары» — тот же экран, а не другой
    assert.equal(renderItems(fullData), items)
  })

  it('renders every tab on an empty catalogue', () => {
    assert.match(renderItems(emptyData), /catalogue is empty|No item matches/)
    assert.match(renderModifiers(emptyData), /No modifier groups yet/)
    assert.match(renderStations(emptyData), /No stations yet/)
  })

  it('never shows Items bulk actions inside Modifiers or Stations', () => {
    for (const markup of [renderModifiers(fullData), renderStations(fullData)]) {
      for (const stray of ['Select all shown', 'Put on sale', 'Move to…', 'Change price…']) {
        assert.doesNotMatch(markup, new RegExp(stray))
      }
    }
  })
})

describe('contextual creation actions belong to their tab', () => {
  it('shows both Add category and Add item on Items, each named once', () => {
    const shell = renderShell('items')
    assert.match(shell, /Add category/)
    assert.match(shell, /Add item/)
    assert.equal(shell.match(/Add category/g).length, 1)
    assert.equal(shell.match(/>Add item</g)?.length ?? 1, 1)
    // Создание категории не спрятано в меню и не подменено вкладкой
    assert.doesNotMatch(shell, /role="tab"[^>]*>Categories/)
  })

  it('shows only Add modifier group on Modifiers', () => {
    const shell = renderShell('modifiers')
    assert.match(shell, /Add modifier group/)
    assert.doesNotMatch(shell, /Add category/)
    assert.doesNotMatch(shell, /Add station/)
  })

  it('shows only Add station on Stations', () => {
    const shell = renderShell('stations')
    assert.match(shell, /Add station/)
    assert.doesNotMatch(shell, /Add category/)
    assert.doesNotMatch(shell, /Add modifier group/)
  })

  it('keeps the three real tabs and the stations deep link', () => {
    const shell = renderShell('stations')
    for (const label of ['Items', 'Modifiers', 'Stations']) {
      assert.match(shell, new RegExp(`>${label}<`))
    }
    // Вкладка из адреса — выбранная
    assert.match(shell, /aria-selected="true"[^>]*>Stations</)
  })

  it('falls back to Items when the address carries an unknown tab', () => {
    assert.match(renderShell('nonsense'), /aria-selected="true"[^>]*>Items</)
  })
})

describe('Items table shows only what the server really has', () => {
  it('renders the truthful columns', () => {
    const items = renderItems(fullData)
    for (const column of ['Item', 'Category', 'SKU', 'Price', 'Availability', 'Station', 'Status']) {
      assert.match(items, new RegExp(`>${column}<`))
    }
  })

  it('never renders Channels, Duplicate or Archive — the fields do not exist', () => {
    const items = renderItems(fullData)
    for (const invented of ['Channels', 'QR Menu', 'Online ordering', 'Duplicate', 'Archive']) {
      assert.doesNotMatch(items, new RegExp(invented))
    }
  })

  it('states availability and gaps in words, not by colour alone', () => {
    const items = renderItems(fullData)
    assert.match(items, /On sale/)
    assert.match(items, /Hidden/)
    // У Latte нет фото и описания — и это написано
    assert.match(items, /Needs attention/)
    assert.match(items, /no photo, no description/)
  })

  it('counts Needs attention from the catalogue, not from the mockup', () => {
    // Из двух позиций неполна одна
    assert.match(renderItems(fullData), /Needs attention <span>1<\/span>/)
    // Добавили вторую неполную — счётчик обязан вырасти сам
    const more = {
      ...fullData,
      items: [...fullData.items, {
        id: 'item-3', name: 'Tea', price: 0, category_id: 'cat-1', is_available: true,
        sku: null, description: null, image_url: null, station_id: null,
        item_variants: [], menu_item_modifier_groups: [],
      }],
    }
    assert.match(renderItems(more), /Needs attention <span>2<\/span>/)
  })

  it('shows a price range and the number of sizes', () => {
    const sized = {
      ...fullData,
      items: [{
        ...fullData.items[0],
        item_variants: [
          { id: 'v1', name: 'S', price: 1100, sort_order: 0 },
          { id: 'v2', name: 'L', price: 1600, sort_order: 1 },
        ],
      }],
    }
    const markup = renderItems(sized)
    assert.match(markup, /₪11–₪16/)
    assert.match(markup, /2 sizes/)
  })
})

describe('catalogue filters live in the address', () => {
  it('renders the filter the section holds, so a tab switch cannot drop it', () => {
    const filtered = renderItems(fullData, EMPTY_FILTERS, 'latte')
    assert.match(filtered, /Latte/)
    assert.doesNotMatch(filtered, />Espresso</)
    assert.match(filtered, /1 of 2/)
  })

  it('applies availability and completeness filters from the same object', () => {
    const hidden = renderItems(fullData, { ...EMPTY_FILTERS, availability: 'hidden' })
    assert.match(hidden, /Latte/)
    assert.doesNotMatch(hidden, />Espresso</)

    const incomplete = renderItems(fullData, { ...EMPTY_FILTERS, state: 'incomplete' })
    assert.match(incomplete, /Latte/)
    assert.doesNotMatch(incomplete, />Espresso</)
  })

  it('reads and writes the address without storing defaults', () => {
    assert.deepEqual(readFilters({}), EMPTY_FILTERS)
    assert.deepEqual(writeFilters(EMPTY_FILTERS), {})
    assert.deepEqual(
      writeFilters({ ...EMPTY_FILTERS, state: 'incomplete', category: 'cat-1' }),
      { fl: 'incomplete', zn: 'cat-1' }
    )
    // Круг: адрес → отбор → адрес не меняет значения
    const url = { fl: 'incomplete', zn: 'cat-1', so: 'name' }
    assert.deepEqual(writeFilters(readFilters(url)), url)
  })

  it('keeps Items and Modifiers attention filters apart', () => {
    // «Неполные товары» не должны отфильтровать группы модификаторов
    const filters = { ...EMPTY_FILTERS, state: 'incomplete' }
    const modifiers = renderModifiers(fullData, filters)
    assert.match(modifiers, /Milk/)
    assert.match(modifiers, /Syrup/)
  })
})

describe('manual order stays inside a category', () => {
  it('hides order arrows in a mixed list', () => {
    assert.doesNotMatch(renderItems(fullData), /Move Espresso up/)
  })

  it('shows them when one category is picked and the order is manual', () => {
    const scoped = renderItems(fullData, { ...EMPTY_FILTERS, category: 'cat-1', sort: 'manual' })
    assert.match(scoped, /Move Espresso up/)
    assert.match(scoped, /Move Espresso down/)
    // Первая «вверх» и последняя «вниз» — недоступны
    assert.match(scoped, /disabled[^>]*aria-label="Move Espresso up"|aria-label="Move Espresso up"[^>]*disabled/)
  })

  it('hides them again when the order is not manual', () => {
    const sorted = renderItems(fullData, { ...EMPTY_FILTERS, category: 'cat-1', sort: 'name' })
    assert.doesNotMatch(sorted, /Move Espresso up/)
  })
})

describe('Modifiers speak about rules, not numbers', () => {
  it('turns min/max into a sentence', () => {
    const markup = renderModifiers(fullData)
    assert.match(markup, /Optional · up to 1/)
    assert.match(markup, /Optional · up to 3/)
  })

  it('marks an empty group as needing attention instead of inventing Active', () => {
    const markup = renderModifiers(fullData)
    assert.match(markup, /no modifiers/)
    assert.doesNotMatch(markup, /class="[^"]*"[^>]*>Active</)
  })

  it('counts real usage from item assignments', () => {
    const markup = renderModifiers(fullData)
    assert.match(markup, /1 item/)  // Milk используется Espresso
    assert.match(markup, /0 items/) // Syrup не используется никем
  })

  it('searches modifier names, not only group names', () => {
    const markup = renderModifiers(fullData, EMPTY_FILTERS, 'oat')
    assert.match(markup, /Milk/)
    assert.doesNotMatch(markup, />Syrup</)
  })
})

describe('Stations are preparation routing, not devices', () => {
  it('says so on the page', () => {
    assert.match(renderStations(fullData), /They are not POS devices/)
  })

  it('never shows hardware or connectivity fields', () => {
    const markup = renderStations(fullData)
    for (const invented of ['Online', 'Offline', 'Printer', 'Serial', 'Ticket speed', 'Hardware']) {
      assert.doesNotMatch(markup, new RegExp(invented, 'i'))
    }
  })

  it('counts assigned and unassigned items for real', () => {
    const markup = renderStations(fullData)
    assert.match(markup, /1 item/)      // Bar: Espresso
    assert.match(markup, /Espresso/)    // пример назначенной позиции
    assert.match(markup, /1 catalogue item has no preparation station/)
  })

  it('says nothing about unassigned items when there are no stations at all', () => {
    const markup = renderStations({ ...fullData, stations: [] })
    assert.doesNotMatch(markup, /no preparation station/)
  })

  it('searches stations and their assigned items', () => {
    assert.match(renderStations(fullData, 'espresso'), /Bar/)
    assert.match(renderStations(fullData, 'nothing here'), /No station matches/)
  })
})
