import test from 'node:test'
import assert from 'node:assert/strict'
import { NAV_ITEMS, hasCapability, productState, visibleNavigation } from './navigation.js'

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
    'overview', 'sales', 'activity', 'locations', 'menu', 'team',
    'guests', 'devices', 'reports', 'integrations',
  ])
  assert.ok(!nav.includes('orders'))
  assert.ok(!nav.includes('reservations'))
})

test('Menu-only: каталог и гостевые ссылки без разделов кассы', () => {
  const nav = ids(MENU_ONLY)
  assert.deepEqual(nav, ['overview', 'locations', 'menu', 'online'])
  for (const posOnly of ['sales', 'activity', 'team', 'devices', 'reports', 'integrations']) {
    assert.ok(!nav.includes(posOnly), `${posOnly} не должен быть виден menu-only аккаунту`)
  }
})

test('Orders standalone: инбокс заказов и каталог, без кассовых разделов', () => {
  const nav = ids(ORDERS_ONLY)
  assert.deepEqual(nav, ['overview', 'orders', 'locations', 'menu', 'online'])
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

test('Контекст без capabilities и products — старый сервер, показываем всё', () => {
  assert.deepEqual(ids({}), NAV_ITEMS.map((item) => item.id))
})

test('Контекст без capabilities: видимость приближается по продуктам (до 105)', () => {
  const legacyMenu = { products: ['menu'] }
  assert.equal(hasCapability(legacyMenu, 'catalog_manage'), true)
  assert.equal(hasCapability(legacyMenu, 'pos_operate'), false)
  assert.deepEqual(ids(legacyMenu), ['overview', 'locations', 'menu', 'online'])
})

test('Организация без продуктов не получает ни одного операционного раздела', () => {
  assert.deepEqual(ids({ products: [], capabilities: [] }), ['overview', 'locations'])
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
