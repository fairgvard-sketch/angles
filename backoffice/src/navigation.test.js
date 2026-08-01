import test from 'node:test'
import assert from 'node:assert/strict'
import {
  NAV_ITEMS, groupedNavigation, hasCapability, isLocationScoped, productState,
  visibleNavigation,
} from './navigation.js'

/**
 * Карта «форма аккаунта → разделы кабинета» (Phase 0 baseline).
 *
 * Проверять её кликами по пяти демо-аккаунтам нереально, а именно она
 * решает, увидит ли menu-only клиент разделы кассы. Это тест видимости,
 * не авторизации: настоящие запреты — на сервере.
 */

const ids = (context) => visibleNavigation(context).map((item) => item.id)

const POS_ONLY = {
  products: ['pos'],
  capabilities: ['pos_operate', 'pos_reports', 'catalog_manage'],
}
const MENU_ONLY = {
  products: ['menu'],
  capabilities: ['catalog_manage', 'public_menu'],
}
const ORDERS_ONLY = {
  products: ['online_orders'],
  capabilities: ['catalog_manage', 'public_menu', 'online_orders', 'orders_desk'],
}
const RESERVE_ONLY = {
  products: ['reservations'],
  capabilities: ['public_reservations', 'reservations_desk'],
}
const DEVELOPER = {
  account_type: 'developer',
  products: ['pos', 'menu', 'online_orders', 'reservations'],
  product_sources: { pos: 'developer', menu: 'developer' },
  capabilities: [
    'pos_operate', 'pos_reports', 'catalog_manage', 'public_menu',
    'online_orders', 'orders_desk', 'public_reservations', 'reservations_desk',
  ],
}

test('POS-only: касса, отчёты и каталог; гостевых столов заказов/броней нет', () => {
  const nav = ids(POS_ONLY)
  assert.deepEqual(nav, [
    'overview', 'sales', 'activity', 'guests', 'menu', 'locations', 'team', 'devices',
  ])
  assert.ok(!nav.includes('orders'))
  assert.ok(!nav.includes('reservations'))
})

test('ненаписанные модули не показываются клиенту ни при каких capabilities', () => {
  for (const shape of [POS_ONLY, MENU_ONLY, ORDERS_ONLY, RESERVE_ONLY, {}, { products: ['pos'] }]) {
    const nav = ids(shape)
    assert.ok(!nav.includes('reports'), 'Reports виден клиенту')
    assert.ok(!nav.includes('integrations'), 'Integrations виден клиенту')
  }
})

test('developer видит ненаписанные модули — но только он', () => {
  const nav = ids(DEVELOPER)
  assert.ok(nav.includes('reports'))
  assert.ok(nav.includes('integrations'))
  const sameCapsNotDeveloper = { ...DEVELOPER, account_type: 'customer' }
  assert.ok(!ids(sameCapsNotDeveloper).includes('reports'))
})

test('Menu-only: каталог и гостевые ссылки без разделов кассы', () => {
  const nav = ids(MENU_ONLY)
  assert.deepEqual(nav, ['overview', 'menu', 'locations', 'online'])
  for (const posOnly of ['sales', 'activity', 'team', 'devices', 'reports', 'integrations']) {
    assert.ok(!nav.includes(posOnly), `${posOnly} не должен быть виден menu-only аккаунту`)
  }
})

test('Orders standalone: инбокс заказов и каталог, без кассовых разделов', () => {
  const nav = ids(ORDERS_ONLY)
  assert.deepEqual(nav, ['overview', 'orders', 'menu', 'locations', 'online'])
})

test('Reserve standalone: стол хостес и гостевая страница, без каталога', () => {
  const nav = ids(RESERVE_ONLY)
  assert.deepEqual(nav, ['overview', 'reservations', 'locations', 'online'])
  assert.ok(!nav.includes('menu'))
})

test('Developer: все разделы', () => {
  const nav = ids(DEVELOPER)
  assert.deepEqual(nav, NAV_ITEMS.map((item) => item.id))
})

test('Контекст без capabilities и products — старый сервер, показываем всё готовое', () => {
  assert.deepEqual(ids({}), NAV_ITEMS.filter((i) => !i.planned).map((item) => item.id))
})

test('Контекст без capabilities: видимость приближается по продуктам (до 105)', () => {
  const legacyMenu = { products: ['menu'] }
  assert.equal(hasCapability(legacyMenu, 'catalog_manage'), true)
  assert.equal(hasCapability(legacyMenu, 'pos_operate'), false)
  assert.deepEqual(ids(legacyMenu), ['overview', 'menu', 'locations', 'online'])
})

test('Организация без продуктов не получает ни одного операционного раздела', () => {
  assert.deepEqual(ids({ products: [], capabilities: [] }), ['overview', 'locations'])
})

// ── Группы навигации (Phase 2) ───────────────────────────────

test('Dashboard стоит над группами, а не внутри одной из них', () => {
  const { primary, groups } = groupedNavigation(DEVELOPER)
  assert.deepEqual(primary.map((i) => i.id), ['overview'])
  assert.ok(groups.every((g) => !g.items.some((i) => i.id === 'overview')))
})

test('Пустая группа не рендерится', () => {
  const { groups } = groupedNavigation(MENU_ONLY)
  assert.deepEqual(groups.map((g) => g.id), ['manage', 'channels'])
  assert.deepEqual(
    groups.map((g) => g.items.map((i) => i.id)),
    [['menu', 'locations'], ['online']]
  )
  assert.ok(groups.every((g) => g.items.length > 0))
})

test('Reserve standalone: работа и каналы, без Insights и System', () => {
  const { groups } = groupedNavigation(RESERVE_ONLY)
  assert.deepEqual(groups.map((g) => g.id), ['work', 'manage', 'channels'])
  assert.deepEqual(groups[0].items.map((i) => i.id), ['reservations'])
})

test('Каждый видимый раздел попадает ровно в одну группу', () => {
  for (const shape of [POS_ONLY, MENU_ONLY, ORDERS_ONLY, RESERVE_ONLY, DEVELOPER]) {
    const { primary, groups } = groupedNavigation(shape)
    const flat = [...primary, ...groups.flatMap((g) => g.items)].map((i) => i.id)
    assert.deepEqual(flat.slice().sort(), ids(shape).slice().sort())
    assert.equal(new Set(flat).size, flat.length)
  }
})

test('Разделы одной точки помечены — для них показывается выбранная точка', () => {
  assert.equal(isLocationScoped('reservations'), true)
  assert.equal(isLocationScoped('orders'), true)
  assert.equal(isLocationScoped('online'), true)
  assert.equal(isLocationScoped('locations'), true)
  // Организационные: каталог, Team, Customers, Activity, Devices, Sales
  assert.equal(isLocationScoped('menu'), false)
  assert.equal(isLocationScoped('team'), false)
  assert.equal(isLocationScoped('guests'), false)
  assert.equal(isLocationScoped('sales'), false)
  assert.equal(isLocationScoped('overview'), false)
})

test('Состояние карточки продукта: active / developer / included / pending / addon', () => {
  assert.equal(productState({ products: ['pos'] }, 'pos'), 'active')
  assert.equal(
    productState({ products: ['pos'], product_sources: { pos: 'developer' } }, 'pos'),
    'developer'
  )
  assert.equal(productState({ products: ['online_orders'] }, 'menu'), 'included')
  assert.equal(productState({ products: [], product_requests: ['menu'] }, 'menu'), 'pending')
  assert.equal(productState({ products: [] }, 'reservations'), 'addon')
})
