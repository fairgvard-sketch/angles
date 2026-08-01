import { supabase } from './supabase'
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
 * Публичные страницы — отдельный продукт на menu.angle.co.il, а кабинет
 * живёт на angle.co.il. Не используем origin кабинета и не связываем
 * гостевые ссылки с доменом POS. Для отдельного стенда адрес можно
 * переопределить через VITE_PUBLIC_MENU_ORIGIN.
 */
const PUBLIC_MENU_ORIGIN = import.meta.env.VITE_PUBLIC_MENU_ORIGIN || 'https://menu.angle.co.il'
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

/**
 * Публичные ссылки принимают слаг (Kassa 106) или location_id. Слаг
 * читаем на флаере и в адресной строке, UUID остаётся рабочим входом —
 * QR со старыми ссылками уже наклеены на столы.
 */
export function publicRef(locationId, slug) {
  return slug || locationId
}

export function orderUrl(locationId, slug) {
  return `${PUBLIC_MENU_ORIGIN}/order/${publicRef(locationId, slug)}?source=counter_qr`
}

export function tableOrderUrl(locationId, tableToken, slug) {
  const params = new URLSearchParams({ table: tableToken, source: 'table_qr' })
  return `${PUBLIC_MENU_ORIGIN}/order/${publicRef(locationId, slug)}?${params}`
}

/**
 * Ссылка на страницу брони. `src` — канал привода (Kassa 124): страница
 * запоминает его и кладёт в бронь, поэтому в отчёте видно, что дал
 * напечатанный QR, а что — ссылка из профиля.
 *
 * По умолчанию метки НЕТ: ссылка, которую владелец копирует и вставляет
 * куда попало, не должна выдавать себя за QR. Метку получает только то,
 * что мы генерируем сами.
 */
export function reserveUrl(locationId, slug, src = null) {
  const base = `${PUBLIC_MENU_ORIGIN}/reserve/${publicRef(locationId, slug)}`
  return src ? `${base}?src=${encodeURIComponent(src)}` : base
}

// ── Встраивание меню в сайт ресторана ────────────────────────
/**
 * source=website — канал заказа «сайт» (касса различает каналы в
 * orderContext). Гостевые маршруты /order/* отдают
 * Content-Security-Policy: frame-ancestors * (vercel.json кассы),
 * поэтому iframe работает на любом домене ресторана.
 */
export function websiteMenuUrl(locationId, slug) {
  return `${PUBLIC_MENU_ORIGIN}/order/${publicRef(locationId, slug)}?source=website`
}

/** Кнопка «Открыть меню» для сайта ресторана: обычная ссылка, без JS. */
export function embedButtonSnippet(locationId, slug) {
  return [
    `<a href="${websiteMenuUrl(locationId, slug)}" target="_blank" rel="noopener"`,
    '   style="display:inline-block;padding:14px 28px;border-radius:12px;',
    '          background:#16181d;color:#fff;font:600 16px/1 sans-serif;',
    '          text-decoration:none">Open menu</a>',
  ].join('\n')
}

/** Адаптивный iframe: меню внутри страницы ресторана, высота под мобильный сценарий. */
export function embedIframeSnippet(locationId, slug) {
  return [
    `<iframe src="${websiteMenuUrl(locationId, slug)}"`,
    '        title="Menu"',
    '        style="width:100%;max-width:480px;height:720px;border:0;',
    '               border-radius:16px;box-shadow:0 4px 24px rgb(0 0 0 / 12%)"',
    '        loading="lazy"></iframe>',
  ].join('\n')
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

// ── Hero-видео витрины ───────────────────────────────────────

/**
 * Ограничения совпадают с кассой (OnlineOrdersDetail): браузер ничего не
 * перекодирует, поэтому принимаем только форматы, которые одинаково играют
 * на iOS и Android. MOV с камеры сначала экспортируют в MP4.
 */
export const HERO_VIDEO_TYPES = { 'video/mp4': 'mp4', 'video/webm': 'webm' }
export const HERO_VIDEO_MAX_BYTES = 30 * 1024 * 1024

/**
 * Загрузка ролика в тот же бакет menu-images, что и фото товара (007):
 * политика insert проверяет папку {org_id}, которая берётся из JWT, поэтому
 * веб-кабинету не нужны ни новая миграция, ни отдельные права. Имя файла
 * уникально → кэшируем на год.
 */
export async function uploadHeroVideo(context, file) {
  const org = context?.organization?.id
  if (!org) throw new Error('No organization in session')

  const ext = HERO_VIDEO_TYPES[file.type]
  if (!ext) throw new Error('Only MP4 and WebM videos are supported')
  if (file.size > HERO_VIDEO_MAX_BYTES) throw new Error('Video must be 30 MB or smaller')

  const path = `${org}/hero-videos/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('menu-images').upload(path, file, {
    cacheControl: '31536000',
    contentType: file.type,
    upsert: false,
  })
  if (error) throw new Error(error.message)
  return supabase.storage.from('menu-images').getPublicUrl(path).data.publicUrl
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

// ── Часы работы (Kassa 112) ──────────────────────────────────
/**
 * settings.online_orders.hours — окно приёма заказов: ключ = день недели
 * (0 = воскресенье) в таймзоне точки, значение = массив окон
 * [["08:00","20:00"], ...]. Конец меньше начала = переход через полночь.
 *
 * Отсутствие ключа hours = приём в любое время (обратная совместимость:
 * точки, которые расписание не настраивали, ничего не замечают). День
 * без окон = закрыт. Те же правила проверяет online_hours_open_at в БД
 * и повторяет построение слотов на гостевой странице.
 *
 * Не путать с reservations.hours — там свободный текст для показа гостю.
 */

/** Порядок дней в редакторе: неделя в Израиле начинается с воскресенья. */
export const WEEK_DAYS = [
  { key: '0', label: 'Sunday', short: 'Sun' },
  { key: '1', label: 'Monday', short: 'Mon' },
  { key: '2', label: 'Tuesday', short: 'Tue' },
  { key: '3', label: 'Wednesday', short: 'Wed' },
  { key: '4', label: 'Thursday', short: 'Thu' },
  { key: '5', label: 'Friday', short: 'Fri' },
  { key: '6', label: 'Saturday', short: 'Sat' },
]

const DEFAULT_WINDOW = ['08:00', '20:00']

/** Первое окно дня или null, если день закрыт. Редактор ведёт одно окно. */
export function dayWindow(hours, dayKey) {
  const windows = hours?.[dayKey]
  if (!Array.isArray(windows) || windows.length === 0) return null
  const first = windows[0]
  if (!Array.isArray(first) || first.length < 2) return null
  return [String(first[0]), String(first[1])]
}

export function isDayOpen(hours, dayKey) {
  return dayWindow(hours, dayKey) !== null
}

/**
 * Расписание с изменённым днём. Окно null убирает день (закрыт).
 *
 * Возвращаем полный объект hours: patch_location_settings_web мержит
 * ПОКЛЮЧЕВО на верхнем уровне раздела, а hours — один ключ, поэтому
 * частичный объект затёр бы остальные дни.
 */
export function withDay(hours, dayKey, window) {
  const next = { ...(hours || {}) }
  if (window === null) {
    next[dayKey] = []
  } else {
    next[dayKey] = [[window[0], window[1]]]
  }
  return next
}

/** Расписание «открыто всегда»: ключа hours нет. */
export function clearHours() {
  return null
}

/** Расписание по умолчанию при первом включении — будни 08:00–20:00. */
export function defaultHours() {
  const hours = {}
  for (const day of WEEK_DAYS) hours[day.key] = [[...DEFAULT_WINDOW]]
  return hours
}

/**
 * Короткая сводка для свёрнутой строки: соседние дни с одинаковым окном
 * схлопываются в диапазон («Sun–Thu 08:00–20:00»), закрытые пропускаются.
 */
export function hoursSummary(hours) {
  if (!hours || typeof hours !== 'object' || Object.keys(hours).length === 0) {
    return 'Always open'
  }
  const groups = []
  for (const day of WEEK_DAYS) {
    const window = dayWindow(hours, day.key)
    const text = window ? `${window[0]}–${window[1]}` : null
    const last = groups[groups.length - 1]
    if (last && last.text === text) {
      last.end = day.short
    } else {
      groups.push({ text, start: day.short, end: day.short })
    }
  }
  const open = groups.filter((group) => group.text !== null)
  if (open.length === 0) return 'Closed all week'
  return open
    .map((group) => {
      const days = group.start === group.end ? group.start : `${group.start}–${group.end}`
      return `${days} ${group.text}`
    })
    .join(' · ')
}

export async function saveHours(locationId, hours) {
  return patchLocationSettings(locationId, { online_orders: { hours } })
}
