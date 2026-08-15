import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CUSTOMER_TABS, LOCATION_TABS, NAV_ITEMS, REPORT_TABS, SETTINGS_TABS,
  groupedNavigation, hasCapability, isLocationScoped, productState,
  visibleCustomerTabs, visibleLocationTabs, visibleNavigation, visibleReportTabs,
  visibleSettingsTabs,
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
    'overview', 'reports', 'activity', 'guests', 'menu', 'locations', 'team', 'devices',
  ])
  assert.ok(!nav.includes('orders'))
  assert.ok(!nav.includes('reservations'))
})

test('Отдельного пункта Sales больше нет — это вкладка Reports', () => {
  for (const shape of [POS_ONLY, MENU_ONLY, ORDERS_ONLY, RESERVE_ONLY, DEVELOPER, {}]) {
    assert.ok(!ids(shape).includes('sales'), 'Sales остался отдельным разделом')
  }
  assert.ok(!NAV_ITEMS.some((item) => item.id === 'sales'))
})

test('Reports виден по pos_reports, а не по «developer»', () => {
  assert.ok(ids(POS_ONLY).includes('reports'))
  for (const digital of [MENU_ONLY, ORDERS_ONLY, RESERVE_ONLY]) {
    assert.ok(!ids(digital).includes('reports'), 'Reports виден аккаунту без отчётности')
  }
})

test('ненаписанные модули не показываются клиенту ни при каких capabilities', () => {
  for (const shape of [POS_ONLY, MENU_ONLY, ORDERS_ONLY, RESERVE_ONLY, {}, { products: ['pos'] }]) {
    assert.ok(!ids(shape).includes('integrations'), 'Integrations виден клиенту')
  }
})

test('developer видит ненаписанные модули — но только он', () => {
  assert.ok(ids(DEVELOPER).includes('integrations'))
  const sameCapsNotDeveloper = { ...DEVELOPER, account_type: 'customer' }
  assert.ok(!ids(sameCapsNotDeveloper).includes('integrations'))
})

test('Menu-only: каталог и гостевые ссылки без разделов кассы', () => {
  const nav = ids(MENU_ONLY)
  assert.deepEqual(nav, ['overview', 'menu', 'locations', 'online'])
  for (const posOnly of ['reports', 'activity', 'team', 'devices', 'integrations']) {
    assert.ok(!nav.includes(posOnly), `${posOnly} не должен быть виден menu-only аккаунту`)
  }
})

test('Orders standalone: инбокс заказов и каталог, без кассовых разделов', () => {
  const nav = ids(ORDERS_ONLY)
  assert.deepEqual(nav, ['overview', 'orders', 'menu', 'locations', 'online'])
})

test('Reserve standalone: стол хостес и гостевая страница, без каталога', () => {
  const nav = ids(RESERVE_ONLY)
  assert.deepEqual(nav, ['overview', 'reservations', 'locations', 'reserve'])
  assert.ok(!nav.includes('menu'))
  // Канал меню не куплен — и раздела меню быть не должно. Пока каналы
  // жили одним пунктом, точка с одной бронью открывала его на вкладке
  // меню, которого у неё нет.
  assert.ok(!nav.includes('online'))
})

test('Menu-only не получает раздел броней', () => {
  assert.ok(!ids(MENU_ONLY).includes('reserve'))
  assert.ok(ids(MENU_ONLY).includes('online'))
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
  assert.equal(isLocationScoped('reserve'), true)
  // Locations выбирает точку внутри своего экрана настроек
  assert.equal(isLocationScoped('locations'), false)
  // Дашборд читает продажи, заказы, брони и каналы одной точки: без
  // переключателя у сети молча выигрывала первая точка в списке
  assert.equal(isLocationScoped('overview'), true)
  // Организационные: каталог, Team, Customers, Activity, Devices, Sales
  assert.equal(isLocationScoped('menu'), false)
  assert.equal(isLocationScoped('team'), false)
  assert.equal(isLocationScoped('guests'), false)
  // Reports: у Sales свой выбор нескольких точек, у Fiscal — свой выбор
  // одной. Третий переключатель в шапке обещал бы им общий скоуп.
  assert.equal(isLocationScoped('reports'), false)
})

// ── Вкладки настроек точки ───────────────────────────────────

const tabKeys = (context) => visibleLocationTabs(context).map((t) => t.key)

test('Locations настраивает точку и только её: Details, Receipts & tax, POS defaults', () => {
  assert.deepEqual(LOCATION_TABS.map((t) => t.key), ['details', 'receipts', 'pos'])
  // Лояльность и фискальная выгрузка отсюда ушли — они не про заведение
  assert.ok(!LOCATION_TABS.some((t) => t.key === 'loyalty' || t.key === 'export'))
})

test('Раздел Locations виден всем — но кассовые вкладки только с кассой', () => {
  assert.deepEqual(tabKeys(POS_ONLY), LOCATION_TABS.map((t) => t.key))
  for (const digital of [MENU_ONLY, ORDERS_ONLY, RESERVE_ONLY]) {
    assert.deepEqual(tabKeys(digital), ['details'])
  }
})

test('Организация без продуктов настраивает только имя и режим точки', () => {
  assert.deepEqual(tabKeys({ products: [], capabilities: [] }), ['details'])
})

test('Старый контекст без capabilities и products показывает все вкладки', () => {
  assert.deepEqual(tabKeys({}), LOCATION_TABS.map((t) => t.key))
})

test('Контекст до 105: кассовые вкладки приближаются по продукту pos', () => {
  assert.deepEqual(tabKeys({ products: ['pos'] }), LOCATION_TABS.map((t) => t.key))
  assert.deepEqual(tabKeys({ products: ['menu'] }), ['details'])
})

test('Details остаётся всегда — иначе раздел открывается пустым', () => {
  for (const shape of [POS_ONLY, MENU_ONLY, ORDERS_ONLY, RESERVE_ONLY, DEVELOPER, {}]) {
    assert.equal(visibleLocationTabs(shape)[0].key, 'details')
  }
})

// ── Вкладки Customers, Reports и Settings ────────────────────

test('Customers: Directory всем, Loyalty — только с кассой', () => {
  assert.deepEqual(CUSTOMER_TABS.map((t) => t.key), ['directory', 'loyalty'])
  assert.deepEqual(visibleCustomerTabs(POS_ONLY).map((t) => t.key), ['directory', 'loyalty'])
  // Программу исполняет касса (pay_order): без неё она ничего не начислит
  for (const digital of [MENU_ONLY, ORDERS_ONLY, RESERVE_ONLY]) {
    assert.deepEqual(visibleCustomerTabs(digital).map((t) => t.key), ['directory'])
  }
})

test('Reports: продажи и фискальный набор', () => {
  assert.deepEqual(REPORT_TABS.map((t) => t.key), ['sales', 'fiscal'])
  assert.deepEqual(visibleReportTabs(POS_ONLY).map((t) => t.key), ['sales', 'fiscal'])
})

test('Settings: workspace, продукты, аккаунт — и никакого Legal & tax', () => {
  assert.deepEqual(SETTINGS_TABS.map((t) => t.key), ['business', 'products', 'account'])
  assert.deepEqual(SETTINGS_TABS.map((t) => t.label), ['Workspace', 'Plans & products', 'Account'])
  assert.deepEqual(visibleSettingsTabs(POS_ONLY).map((t) => t.key), ['business', 'products', 'account'])
  // Модели юрлиц ещё нет — пустая вкладка обещала бы её наличие
  assert.ok(!SETTINGS_TABS.some((t) => t.key === 'legal'))
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
