import { supabase } from './supabase'

/**
 * База клиентов лояльности для раздела «Customers». Данные из guests (031),
 * право подтверждает членство в бэкофисе (RPC get_backoffice_guests, 114) —
 * PIN-сессии в вебе нет, как и в «Девайсах» (097).
 *
 * Гости скоупятся по организации, а не по точке: программа лояльности общая
 * на org. Поиск делает сервер (по цифрам телефона либо по имени), чтобы лимит
 * не срезал совпадения за пределами первой страницы.
 */

export async function fetchGuests(search = '') {
  const { data, error } = await supabase.rpc('get_backoffice_guests', {
    p_search: search.trim() || null,
    p_limit: 200,
    // Владельца бэкофиса сервер узнаёт по членству (114) — токен не нужен
    p_staff_session: null,
  })
  if (error) throw new Error(error.message)
  return data ?? []
}

/**
 * Карточка гостя: профиль, заказы С СОСТАВОМ, любимые позиции и журнал
 * начислений — сервер склеивает orders/order_items/loyalty_events сам (114).
 */
export async function fetchGuestCard(guestId) {
  const { data, error } = await supabase.rpc('get_guest_card', {
    p_guest_id: guestId,
    p_limit: 20,
  })
  if (error) throw new Error(error.message)
  return data
}

/** Деньги приходят целыми агоротами (инвариант кассы) — форматируем в ₪ */
export function formatMoney(agorot) {
  return `₪${((agorot ?? 0) / 100).toFixed(2)}`
}

/** Телефон хранится одними цифрами: 0501234567 → 050-123-4567 */
export function formatPhone(digits) {
  if (!digits) return ''
  return digits.length === 10
    ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
    : digits
}

/** «Последний визит»: Today / 3d ago / 2mo ago */
export function lastVisitLabel(iso) {
  if (!iso) return 'Never'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

export function formatDateTime(iso) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}
