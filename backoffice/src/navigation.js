/**
 * Разделы кабинета и правила их видимости.
 *
 * Вынесено из App.jsx без изменения поведения: логика «какому аккаунту какой
 * раздел виден» — чистая, и её надо проверять тестами, а не кликами. Иконки
 * остались в App.jsx: здесь не должно быть импорта UI-библиотек, иначе модуль
 * перестанет запускаться в `node --test`.
 *
 * Это ТОЛЬКО видимость. Настоящие запреты живут на сервере (RLS + гейты RPC,
 * module_disabled); скрытый пункт меню не является защитой.
 */

export const NAV_ITEMS = [
  { id: 'overview', label: 'Home' },
  { id: 'orders', label: 'Orders' },
  { id: 'reservations', label: 'Reservations' },
  { id: 'sales', label: 'Overview' },
  { id: 'activity', label: 'Activity' },
  { id: 'locations', label: 'Locations' },
  { id: 'menu', label: 'Menu & catalogue' },
  { id: 'team', label: 'Team' },
  { id: 'guests', label: 'Customers' },
  { id: 'online', label: 'QR menu' },
  { id: 'devices', label: 'Devices' },
  { id: 'reports', label: 'Reports' },
  { id: 'integrations', label: 'Integrations' },
]

// ── Продукты и capabilities (100/103/105) ────────────────────
/**
 * Навигация строится из ЭФФЕКТИВНЫХ capabilities контекста (105), а не из
 * сырого ключа продукта: ANGLE Orders даёт публичное меню без покупки Menu,
 * поэтому раздел каталога виден по catalog_manage, а не по products.
 * Контекст без поля capabilities (функция до 105) — фолбэк на прежнюю
 * продуктовую логику.
 */
export function hasProduct(products, product) {
  return !Array.isArray(products) || products.includes(product)
}

export function hasCapability(context, capability) {
  const caps = context?.capabilities
  if (!Array.isArray(caps)) {
    // Старый контекст: приближение по продуктам (как до 105)
    const products = context?.products
    if (!Array.isArray(products)) return true
    const has = (p) => products.includes(p)
    switch (capability) {
      case 'catalog_manage': return has('pos') || has('menu') || has('online_orders')
      case 'public_menu': return has('menu') || has('online_orders')
      case 'online_orders':
      case 'orders_desk': return has('online_orders')
      case 'public_reservations':
      case 'reservations_desk': return has('reservations')
      default: return has('pos')
    }
  }
  return caps.includes(capability)
}

export function visibleNavigation(context) {
  const products = context?.products
  if (!Array.isArray(products) && !Array.isArray(context?.capabilities)) return NAV_ITEMS
  const can = (c) => hasCapability(context, c)
  return NAV_ITEMS.filter(({ id }) => {
    if (id === 'overview' || id === 'locations') return true
    if (id === 'menu') return can('catalog_manage')
    if (id === 'online') {
      return can('public_menu') || can('online_orders')
        || can('public_reservations') || can('reservations_desk')
    }
    // Инбокс заказов (101): capability orders_desk — pos-точки видят его
    // read-only, их цикл живёт на кассе.
    if (id === 'orders') return can('orders_desk')
    // Веб-стол хостес (102): reservations_desk, работает и у POS-точек
    if (id === 'reservations') return can('reservations_desk')
    if (id === 'sales') return can('pos_reports')
    // activity/team/devices/reports/integrations — POS-контур
    return can('pos_operate')
  })
}

/**
 * Жизненный цикл карточки продукта (100/104/105): Active / Developer /
 * Included with ANGLE Orders / Pending activation / Available as add-on.
 */
export function productState(context, productId) {
  const products = Array.isArray(context?.products) ? context.products : []
  const requests = Array.isArray(context?.product_requests) ? context.product_requests : []
  const sources = context?.product_sources || {}
  if (products.includes(productId)) {
    return sources[productId] === 'developer' ? 'developer' : 'active'
  }
  // Orders включает публичное меню технически — вторая покупка не нужна
  if (productId === 'menu' && products.includes('online_orders')) return 'included'
  if (requests.includes(productId)) return 'pending'
  return 'addon'
}
