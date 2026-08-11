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

/**
 * Группы навигации (Phase 2). Плоский список из тринадцати пунктов не
 * отвечал на вопрос «где искать»: работа смены, аналитика и настройка
 * лежали вперемешку. Группы называются глаголом владельца, а не
 * внутренним модулем.
 *
 * Account и Help живут в меню аккаунта (аватар), а не в списке разделов:
 * их ищут у своего имени, а не среди операционных экранов.
 */
export const NAV_GROUPS = [
  { id: 'work', label: 'Work' },
  { id: 'insights', label: 'Insights' },
  { id: 'manage', label: 'Manage' },
  { id: 'channels', label: 'Channels' },
  { id: 'system', label: 'System' },
]

/**
 * `planned: true` — раздела ещё нет. Такой пункт виден только в
 * developer-аккаунте и открывает честное «в планах»: обычный клиент не
 * должен находить в меню обещание, за которым ничего не стоит.
 *
 * `scoped: true` — раздел работает с ОДНОЙ точкой: для него в шапке
 * показывается выбранная точка, иначе владелец сети не понимает, чьи
 * это цифры.
 */
export const NAV_ITEMS = [
  // Дашборд читает продажи, заказы, брони и каналы ОДНОЙ точки. Без
  // `scoped` он показывал их без переключателя, и у сети молча выигрывала
  // первая точка в списке: числа были ничьи. Кассы и предупреждение о
  // смене остаются общими по организации и называют свою точку в строке.
  { id: 'overview', label: 'Dashboard', group: null, scoped: true },
  { id: 'orders', label: 'Orders', group: 'work', scoped: true },
  { id: 'reservations', label: 'Reservations', group: 'work', scoped: true },
  // Reports — то, что произошло и что надо выгрузить: продажи и фискальный
  // набор. Отдельного пункта Sales больше нет: он был тем же отчётом под
  // другим именем, и владелец искал выгрузку для бухгалтера в Locations.
  { id: 'reports', label: 'Reports', group: 'insights' },
  { id: 'activity', label: 'Activity', group: 'insights' },
  { id: 'guests', label: 'Customers', group: 'insights' },
  // Каталог организационный: товары общие для точек, точка нужна только
  // как значение по умолчанию для новой категории — переключатель в шапке
  // обещал бы фильтрацию, которой нет.
  { id: 'menu', label: 'Catalogue', group: 'manage' },
  { id: 'locations', label: 'Locations', group: 'manage', scoped: true },
  { id: 'team', label: 'Team', group: 'manage' },
  { id: 'online', label: 'QR Menu & Online', group: 'channels', scoped: true },
  { id: 'integrations', label: 'Integrations', group: 'channels', planned: true },
  { id: 'devices', label: 'Devices', group: 'system' },
]

/** Раздел работает с одной точкой — её надо показывать и переключать */
export function isLocationScoped(view) {
  return NAV_ITEMS.some((item) => item.id === view && item.scoped)
}

/**
 * Вкладки настроек точки. Правило то же, что у разделов: аккаунт без кассы
 * не должен находить у себя дефолты смены и реквизиты чека — терминала,
 * который их исполняет, у него нет, и настройка выглядит как обещание
 * продукта, который не куплен.
 *
 * Раздел Locations виден всем (там имя, витринное имя, режим и НДС), а вот
 * его наполнение зависит от продуктов — поэтому фильтр здесь, рядом с
 * `visibleNavigation`, а не в самом экране: это одно и то же правило.
 *
 * Лояльность и фискальная выгрузка отсюда ушли. Раздел перестал быть
 * складом всего, у чего есть `location_id`: программа лояльности — вопрос
 * про клиентов, а выгрузка מבנה אחיד — не настройка, а отчёт. Прежние
 * ключи вкладок (`general`/`receipt`/`register`) остаются рабочими
 * ссылками — их переводит `canonicalRoute` в routing.js.
 */
export const LOCATION_TABS = [
  { key: 'details', label: 'Details' },
  { key: 'receipts', label: 'Receipts & tax', capability: 'pos_operate' },
  { key: 'pos', label: 'POS defaults', capability: 'pos_operate' },
]

export function visibleLocationTabs(context) {
  return LOCATION_TABS.filter(({ capability }) => !capability || hasCapability(context, capability))
}

/**
 * Вкладки Customers. Directory — кто это такие, Loyalty — как устроена
 * программа. Программа остаётся POS-контуром: начисление живёт в pay_order
 * на кассе (Kassa 046/113), онлайн-заказ только привязывает гостя, и без
 * кассы настройка не начислит ничего.
 */
export const CUSTOMER_TABS = [
  { key: 'directory', label: 'Directory' },
  { key: 'loyalty', label: 'Loyalty', capability: 'pos_operate' },
]

export function visibleCustomerTabs(context) {
  return CUSTOMER_TABS.filter(({ capability }) => !capability || hasCapability(context, capability))
}

/**
 * Вкладки Reports. Обе живут под `pos_reports` (сам раздел), но выгрузку
 * исполняет сервер по праву `manage` — видимость вкладки авторизацией не
 * является.
 */
export const REPORT_TABS = [
  { key: 'sales', label: 'Sales' },
  { key: 'fiscal', label: 'Fiscal' },
]

export function visibleReportTabs(context) {
  return REPORT_TABS.filter(({ capability }) => !capability || hasCapability(context, capability))
}

/**
 * Вкладки Settings: рабочее пространство, продукты и мой аккаунт. Legal & tax
 * здесь намеренно нет — модели юрлиц не существует (Release B), а пустая
 * вкладка обещала бы её наличие.
 */
export const SETTINGS_TABS = [
  { key: 'business', label: 'Workspace' },
  { key: 'products', label: 'Plans & products' },
  { key: 'account', label: 'Account' },
]

export function visibleSettingsTabs() {
  return SETTINGS_TABS
}

export function isDeveloperAccount(context) {
  return context?.account_type === 'developer'
}

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
  const developer = isDeveloperAccount(context)
  const products = context?.products
  if (!Array.isArray(products) && !Array.isArray(context?.capabilities)) {
    return NAV_ITEMS.filter(({ planned }) => !planned || developer)
  }
  const can = (c) => hasCapability(context, c)
  return NAV_ITEMS.filter(({ id, planned }) => {
    // Ненаписанный модуль не показываем клиенту ни при каких capabilities
    if (planned) return developer
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
    if (id === 'reports') return can('pos_reports')
    // activity/team/devices/guests — POS-контур
    return can('pos_operate')
  })
}

/**
 * Разделы, разложенные по группам. Пустая группа не рендерится: заголовок
 * без пунктов — это обещание раздела, которого у аккаунта нет.
 */
export function groupedNavigation(context) {
  const items = visibleNavigation(context)
  return {
    primary: items.filter((item) => !item.group),
    groups: NAV_GROUPS
      .map((group) => ({
        ...group,
        items: items.filter((item) => item.group === group.id),
      }))
      .filter((group) => group.items.length > 0),
  }
}

/**
 * Продукты ANGLE и как они называются для владельца.
 *
 * Живёт рядом с `productState`, а не в App.jsx: названия нужны и
 * карточке продуктов в аккаунте, и дашборду — он сообщает о заявке,
 * которая ждёт активации. Два списка названий рано или поздно разойдутся.
 */
export const PRODUCT_META = [
  { id: 'menu', label: 'ANGLE Menu', detail: 'QR menu for phones and your website' },
  { id: 'online_orders', label: 'ANGLE Orders', detail: 'Online orders without a register' },
  { id: 'reservations', label: 'ANGLE Reserve', detail: 'Table bookings and host desk' },
  { id: 'pos', label: 'ANGLE POS', detail: 'The register, shifts and receipts' },
]

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
