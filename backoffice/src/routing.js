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
 * Режим внутри вкладки. Появился, когда экран дублей перестал быть
 * вкладкой Customers: у раздела теперь две настоящие вкладки (Directory и
 * Loyalty), а дубли — это способ смотреть на Directory, а не третья
 * вкладка. Ссылку на них по-прежнему шлют в поддержку, поэтому состояние
 * обязано жить в адресе.
 */
const MODE_KEY = 'mode'
/**
 * Рабочий день раздела. Он общий для всех вкладок броней: полотно,
 * список и лист ожидания отвечают на вопросы про ОДИН день, и ссылка на
 * «субботу» обязана открывать субботу, а не сегодня.
 */
const DATE_KEY = 'd'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Фильтры раздела: состояние (st), зал (zn), источник (sr), глубина
 * (rg), порядок (so), канал (ch), способ выдачи (fl).
 *
 * Живут в адресе, потому что отобранный список — это и есть ответ,
 * который присылают в поддержку и открывают завтра снова: «покажи все
 * неподтверждённые на неделе». Перезагрузка не должна сбрасывать отбор
 * в «всё подряд».
 *
 * Ключи общие для всех разделов, и это безопасно: переход в другой
 * раздел обнуляет отбор (`navigate`), поэтому `st` брони и `st` заказа
 * никогда не встречаются в одном адресе. Список закрытый: адрес — часть
 * интерфейса, и складывать в него что попало нельзя.
 */
const FILTER_KEYS = ['st', 'zn', 'sr', 'rg', 'so', 'ch', 'fl']

/** Значения фильтров из адреса; пустое — «не выбрано» */
function parseFilters(params) {
  const out = {}
  for (const key of FILTER_KEYS) {
    const value = params.get(key)
    if (value) out[key] = value
  }
  return out
}

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
  // Мусор в дате — не ошибка, а испорченная ссылка: раздел открывается
  // на сегодняшнем дне, а не на «Invalid Date».
  const date = params.get(DATE_KEY)
  return {
    view: known ? raw : DEFAULT_VIEW,
    locationId: params.get(LOCATION_KEY) || null,
    tab: params.get(TAB_KEY) || null,
    mode: params.get(MODE_KEY) || null,
    date: date && DATE_RE.test(date) ? date : null,
    filters: parseFilters(params),
    normalized: Boolean(raw) && !known,
  }
}

/**
 * Устаревшие адреса → сегодняшние.
 *
 * Разделы переехали: выгрузка מבנה אחיד ушла из настроек точки в отчёты,
 * лояльность — к клиентам, Sales стал вкладкой Reports. Ссылки на прежние
 * места лежат в закладках владельца и в переписке с поддержкой, и открывать
 * по ним пустой экран нельзя.
 *
 * Функция чистая и применяется ОДИН раз при чтении адреса — до проверки
 * доступности раздела. Дальше кабинет живёт уже в новых координатах и
 * заменой записи истории приводит адресную строку в порядок: Назад не
 * должен возвращать в старую ссылку и снова перебрасывать вперёд.
 */
const LOCATION_TAB_ALIASES = {
  general: 'details',
  receipt: 'receipts',
  register: 'pos',
}

export function canonicalRoute(route) {
  const next = { ...route }

  // Аккаунт: план называет раздел `account`, в коде он `settings`.
  // Принимаем оба, каноническим остаётся тот, что уже в закладках.
  if (next.view === 'account') next.view = 'settings'

  // Sales больше не отдельный раздел — это первая вкладка отчётов
  if (next.view === 'sales') {
    next.view = 'reports'
    next.tab = next.tab || 'sales'
  }

  if (next.view === 'locations') {
    if (next.tab === 'export') {
      // Выгрузка — отчёт, а не настройка. Точка сохраняется: ссылка вела
      // на выгрузку конкретной точки, и она обязана остаться выбранной.
      next.view = 'reports'
      next.tab = 'fiscal'
    } else if (next.tab === 'loyalty') {
      next.view = 'guests'
      next.tab = 'loyalty'
    } else if (LOCATION_TAB_ALIASES[next.tab]) {
      next.tab = LOCATION_TAB_ALIASES[next.tab]
    }
  }

  // Бронь была вкладкой канала, стала своим разделом. Прежний адрес лежит
  // в закладках и в письмах поддержки. `reservations` здесь тоже принимаем:
  // так называла вкладку строка «Table booking is off» на главной, хотя
  // вкладки с таким ключом никогда не было — ссылка молча открывала меню.
  if (next.view === 'online') {
    if (next.tab === 'reserve' || next.tab === 'reservations') {
      next.view = 'reserve'
      next.tab = null
    } else if (next.tab === 'online') {
      // Ключ единственной вкладки в адресе больше ничего не выбирает
      next.tab = null
    }
  }

  // Экран дублей был вкладкой, стал режимом Directory
  if (next.view === 'guests' && next.tab === 'duplicates') {
    next.tab = 'directory'
    next.mode = 'duplicates'
  }

  return next
}

/** Адрес из строки запроса, уже переведённый в сегодняшние координаты */
export function readRoute(search, allowedViews = null) {
  return canonicalRoute(parseRoute(search, allowedViews))
}

/**
 * Адрес раздела. Dashboard остаётся без параметров: базовый адрес
 * кабинета не должен обрастать хвостом при первом же открытии.
 */
export function routeToSearch({
  view, locationId = null, tab = null, mode = null, date = null, filters = null,
} = {}) {
  const params = new URLSearchParams()
  if (view && view !== DEFAULT_VIEW) params.set(VIEW_KEY, view)
  if (locationId) params.set(LOCATION_KEY, locationId)
  if (tab) params.set(TAB_KEY, tab)
  if (mode) params.set(MODE_KEY, mode)
  // Сегодняшний день в адрес не пишем: базовая ссылка на раздел не
  // должна протухать к завтрашнему утру.
  if (date && DATE_RE.test(date)) params.set(DATE_KEY, date)
  // Значение по умолчанию тоже не пишем: адрес отражает выбор человека,
  // а не полный слепок состояния экрана.
  for (const key of FILTER_KEYS) {
    const value = filters?.[key]
    if (value) params.set(key, String(value))
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

/** Полный адрес для history: путь сохраняем, меняем только запрос */
export function routeToUrl(route, pathname = '/account/') {
  return `${pathname}${routeToSearch(route)}`
}

/** Изменился ли адрес — чтобы не плодить одинаковые записи истории */
export function sameRoute(a, b) {
  return a?.view === b?.view
    && a?.locationId === b?.locationId
    && a?.tab === b?.tab
    && (a?.mode ?? null) === (b?.mode ?? null)
    && (a?.date ?? null) === (b?.date ?? null)
    && FILTER_KEYS.every((key) => (a?.filters?.[key] ?? null) === (b?.filters?.[key] ?? null))
}
