import { patchLocationSettings } from './settings'

/**
 * QR-каналы гостя: онлайн-заказы (050/051) и бронирование столов (053–063).
 *
 * Настройки лежат в locations.settings.online_orders / .reservations и
 * пишутся тем же patch_location_settings_web (Kassa 091), что и реквизиты
 * чека. Оба раздела в allow-листе функции и мержатся ПОКЛЮЧЕВО (jsonb ||),
 * поэтому шлём только изменённые поля — остальные сервер сохраняет сам.
 * Это отличие от save_menu_item (092), который пересоздаёт варианты целиком.
 *
 * Те же ключи правятся из кассы (ServiceSection → OnlineOrdersDetail /
 * ReservationsDetail). Две точки входа — сознательно: сотрудник на смене
 * должен уметь остановить приём заказов, не заходя в веб-кабинет.
 */

// ── Гостевые ссылки ──────────────────────────────────────────
/**
 * Публичные страницы живут на домене КАССЫ, а кабинет — на angle.co.il,
 * поэтому origin отсюда брать нельзя (в кассе он берётся из window).
 * Прод-домен из docs/deployment.md; переопределяется через env для превью.
 */
const POS_ORIGIN = import.meta.env.VITE_POS_ORIGIN || 'https://pos-self-sigma.vercel.app'
const SITE_ORIGIN = import.meta.env.VITE_SITE_ORIGIN || 'https://angle.co.il'

/**
 * Отобранные фоны витрины. В настройках храним не blob и не служебный id,
 * а уже поддерживаемый кассой background_url — публичное меню применяет его
 * без новой миграции и дополнительного API. preview остаётся относительным,
 * чтобы карточки работали и на локальной сборке сайта.
 */
export const ONLINE_BACKGROUND_PRESETS = [
  {
    id: 'clean',
    marker: null,
    label: 'Clean',
    preview: null,
    value: null,
  },
  {
    id: 'ivory',
    marker: 'ivory-food',
    label: 'Ivory',
    preview: '/uploads/menu-backgrounds/ivory-food.webp',
    value: `${SITE_ORIGIN}/uploads/menu-backgrounds/ivory-food.webp`,
  },
  {
    id: 'sage',
    marker: 'sage-food',
    label: 'Sage',
    preview: '/uploads/menu-backgrounds/sage-food.webp',
    value: `${SITE_ORIGIN}/uploads/menu-backgrounds/sage-food.webp`,
  },
  {
    id: 'coral',
    marker: 'coral-food',
    label: 'Coral',
    preview: '/uploads/menu-backgrounds/coral-food.webp',
    value: `${SITE_ORIGIN}/uploads/menu-backgrounds/coral-food.webp`,
  },
  {
    id: 'midnight',
    marker: 'midnight-food',
    label: 'Midnight',
    preview: '/uploads/menu-backgrounds/midnight-food.webp',
    value: `${SITE_ORIGIN}/uploads/menu-backgrounds/midnight-food.webp`,
  },
  {
    id: 'mustard',
    marker: 'mustard-food',
    label: 'Mustard',
    preview: '/uploads/menu-backgrounds/mustard-food.webp',
    value: `${SITE_ORIGIN}/uploads/menu-backgrounds/mustard-food.webp`,
  },
  {
    id: 'mint',
    marker: 'mint-herb-food',
    label: 'Mint',
    preview: '/uploads/menu-backgrounds/mint-herb-food.webp',
    value: `${SITE_ORIGIN}/uploads/menu-backgrounds/mint-herb-food.webp`,
  },
  {
    id: 'apricot',
    marker: 'apricot-bistro-food',
    label: 'Apricot',
    preview: '/uploads/menu-backgrounds/apricot-bistro-food.webp',
    value: `${SITE_ORIGIN}/uploads/menu-backgrounds/apricot-bistro-food.webp`,
  },
  {
    id: 'plum',
    marker: 'plum-evening-food',
    label: 'Plum',
    preview: '/uploads/menu-backgrounds/plum-evening-food.webp',
    value: `${SITE_ORIGIN}/uploads/menu-backgrounds/plum-evening-food.webp`,
  },
]

export function orderUrl(locationId) {
  return `${POS_ORIGIN}/order/${locationId}`
}

export function reserveUrl(locationId) {
  return `${POS_ORIGIN}/reserve/${locationId}`
}

// ── Онлайн-заказы ────────────────────────────────────────────

export const ORDER_TYPES = ['here', 'takeaway', 'delivery']

export const ORDER_TYPE_LABELS = {
  here: 'Dine in',
  takeaway: 'Takeaway',
  delivery: 'Delivery',
}

/** Отсутствие ключа = ВКЛЮЧЕНО (историческое поведение online_orders). */
export function onlineEnabled(settings) {
  return settings?.online_orders?.enabled !== false
}

/** Дефолт до появления ключа order_types (055). */
export function orderTypes(settings) {
  return settings?.online_orders?.order_types ?? ['here', 'takeaway']
}

/**
 * Переключение типа заказа. Последний тип выключить нельзя — гостю нужен
 * хотя бы один способ; порядок канонический, как в кассе.
 */
export function toggleOrderType(current, type) {
  const has = current.includes(type)
  if (has && current.length === 1) return current
  const next = has ? current.filter((x) => x !== type) : [...current, type]
  return ORDER_TYPES.filter((x) => next.includes(x))
}

export async function saveOnlineOrders(locationId, patch) {
  return patchLocationSettings(locationId, { online_orders: patch })
}

// ── Бронирование ─────────────────────────────────────────────

/** Отсутствие ключа = ВЫКЛЮЧЕНО (в отличие от online_orders). */
export function reservationsEnabled(settings) {
  return settings?.reservations?.enabled === true
}

export async function saveReservations(locationId, patch) {
  return patchLocationSettings(locationId, { reservations: patch })
}

// ── Депозит ──────────────────────────────────────────────────

/**
 * Деньги — целые агороты (инвариант кассы, src/lib/money.ts): в JSON уходит
 * целое, в поле показываем шекели. Ввод парсим через округление, чтобы
 * 12.345 не превратилось в дробные агороты.
 */
export function agorotToInput(agorot) {
  if (!agorot) return ''
  return (agorot / 100).toFixed(2).replace(/\.00$/, '')
}

export function inputToAgorot(value) {
  const normalized = String(value).replace(',', '.').trim()
  if (normalized === '') return 0
  const shekels = Number(normalized)
  if (!Number.isFinite(shekels) || shekels < 0) return null
  return Math.round(shekels * 100)
}
