/**
 * Адрес кабинета (Phase 2).
 *
 * Раздел жил в state компонента: адрес всегда оставался `/account`, а
 * Назад в браузере выкидывало из кабинета целиком. Ссылку на раздел
 * нельзя было ни сохранить, ни прислать в поддержку.
 *
 * Формат — `/account/?view=orders`, а не `/account/orders`: Vite собирает
 * кабинет в подкаталог, а Vercel-проект сайта не объявляет SPA-rewrite,
 * поэтому путь второго уровня вернул бы 404 при перезагрузке. Переход на
 * честные пути возможен позже — разбор адреса здесь единственный.
 *
 * В адресе живёт только то, что нужно, чтобы ссылка открыла тот же экран:
 * раздел, выбранная точка и вкладка внутри раздела. Состояние диалогов и
 * форм в адрес не выносится.
 */

export const DEFAULT_VIEW = 'overview'

/** Ключи, которые кабинет сохраняет в адресе */
const VIEW_KEY = 'view'
const LOCATION_KEY = 'loc'
const TAB_KEY = 'tab'

/**
 * Разбор адреса. Неизвестный или недоступный раздел — не ошибка, а
 * устаревшая ссылка: открываем Dashboard и приводим адрес в порядок
 * (`normalized: true` — вызывающему нужно заменить историю).
 */
export function parseRoute(search, allowedViews = null) {
  const params = new URLSearchParams(search || '')
  const raw = params.get(VIEW_KEY)
  const allowed = Array.isArray(allowedViews) ? allowedViews : null
  const known = raw && (!allowed || allowed.includes(raw))
  return {
    view: known ? raw : DEFAULT_VIEW,
    locationId: params.get(LOCATION_KEY) || null,
    tab: params.get(TAB_KEY) || null,
    normalized: Boolean(raw) && !known,
  }
}

/**
 * Адрес раздела. Dashboard остаётся без параметров: базовый адрес
 * кабинета не должен обрастать хвостом при первом же открытии.
 */
export function routeToSearch({ view, locationId = null, tab = null } = {}) {
  const params = new URLSearchParams()
  if (view && view !== DEFAULT_VIEW) params.set(VIEW_KEY, view)
  if (locationId) params.set(LOCATION_KEY, locationId)
  if (tab) params.set(TAB_KEY, tab)
  const query = params.toString()
  return query ? `?${query}` : ''
}

/** Полный адрес для history: путь сохраняем, меняем только запрос */
export function routeToUrl(route, pathname = '/account/') {
  return `${pathname}${routeToSearch(route)}`
}

/** Изменился ли адрес — чтобы не плодить одинаковые записи истории */
export function sameRoute(a, b) {
  return a?.view === b?.view && a?.locationId === b?.locationId && a?.tab === b?.tab
}
