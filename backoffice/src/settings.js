import { supabase } from './supabase'

/**
 * Настройки точки из веб-кабинета. Пишем через patch_location_settings_web
 * (Kassa 091): точку выбираем явно (в JWT веб-владельца location_id нет),
 * право даёт членство владельца, PIN не нужен. Server-side JSONB merge —
 * известные разделы мержатся поключево, поэтому шлём только изменённое.
 */

export async function patchLocationSettings(locationId, patch) {
  const { data, error } = await supabase.rpc('patch_location_settings_web', {
    p_location_id: locationId,
    p_patch: patch,
    // Владельца сервер узнаёт по членству (091) — токен не нужен
    p_staff_session: null,
  })
  if (error) throw new Error(error.message)
  return data
}

/** Полные настройки точки для формы (RLS отдаёт только свою org). */
export async function fetchLocation(locationId) {
  const { data, error } = await supabase
    .from('locations')
    .select('id, name, currency, vat_rate, timezone, settings')
    .eq('id', locationId)
    .single()
  if (error) throw new Error(error.message)
  return data
}

/**
 * Слаг точки для публичных ссылок (Kassa 106): /order/bulochka вместо
 * /order/<uuid>. RLS отдаёт только слаги своей организации; отсутствие
 * строки — валидное состояние «слаг не задан», а не ошибка.
 */
export async function fetchLocationSlug(locationId) {
  const { data, error } = await supabase
    .from('location_slugs')
    .select('slug')
    .eq('location_id', locationId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data?.slug || ''
}

/**
 * Занятость, формат и служебные имена проверяет БД (set_location_slug):
 * два владельца могут сохранять один слаг одновременно, и арбитром обязан
 * быть уникальный индекс, а не проверка в форме. Пустая строка снимает слаг.
 */
export async function saveLocationSlug(locationId, slug) {
  const { data, error } = await supabase.rpc('set_location_slug', {
    p_location_id: locationId,
    p_slug: slug,
    p_staff_session: null,
  })
  if (error) throw new Error(slugErrorText(error.message))
  return data?.slug || ''
}

/** Коды БД → человеческий текст для владельца. */
function slugErrorText(message) {
  if (message.includes('slug_taken')) return 'That address is already taken — try another.'
  if (message.includes('slug_reserved')) return 'That word is reserved — try another.'
  if (message.includes('invalid_slug_format')) {
    return 'Use 3–40 characters: lowercase latin letters, digits and dashes.'
  }
  if (message.includes('module_disabled')) return 'The Menu product is not active for this account.'
  return message
}

/** Активные столы точки для генерации безопасных QR-ссылок (099). */
export async function fetchTables(locationId) {
  const { data, error } = await supabase
    .from('tables')
    .select('id, label, zone, public_token, sort_order')
    .eq('location_id', locationId)
    .eq('is_active', true)
    .order('sort_order')
  if (error) throw new Error(error.message)
  return data || []
}
