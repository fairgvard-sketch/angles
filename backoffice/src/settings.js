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
