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
    .select(
      'id, name, currency, vat_rate, timezone, settings, service_mode, logo_url, ' +
      'receipt_business_name, receipt_address, receipt_tax_id, receipt_phone, receipt_footer, ' +
      'loyalty_mode, loyalty_stamps_goal, loyalty_points_percent, loyalty_points_min_redeem'
    )
    .eq('id', locationId)
    .single()
  if (error) throw new Error(error.message)
  return data
}

/**
 * Колонки точки (имя, режим, НДС, реквизиты чека, лояльность) — через
 * update_location_config_web (Kassa 107). Чек печатается кассой из этих
 * колонок, поэтому реквизиты обязаны идти сюда, а не в settings JSONB.
 */
export async function updateLocationConfig(locationId, patch) {
  const { error } = await supabase.rpc('update_location_config_web', {
    p_location_id: locationId,
    p_patch: patch,
    p_staff_session: null,
  })
  if (error) throw new Error(error.message)
}

/**
 * Единый формат 1.31 (מבנה אחיד) — формирование server-side.
 * Возвращает { ini_base64, bkmvdata_zip_base64, control_report, ... };
 * машинный код причины ошибки — в data.error (missing_tax_id и т.п.).
 */
export async function runUfExport(locationId, from, to) {
  const { data, error } = await supabase.functions.invoke('uniform-format-export', {
    body: { location_id: locationId, from, to },
  })
  if (error) {
    const ctx = await error.context?.json?.().catch(() => null)
    throw new Error(ctx?.error || 'export_failed')
  }
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
