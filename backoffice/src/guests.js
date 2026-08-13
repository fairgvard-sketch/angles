import { supabase } from './supabase'
import { segmentParams } from './customers'
// Чистые правила клиентской базы — в отдельном модуле под тесты
export {
  formatMoney, formatPhone, normalizePhoneInput, lastVisitLabel, formatDateTime,
  visitsLabel, loyaltyLabel, guestRowLabel, loadedCountLabel, tagTone,
  SEGMENTS, SORTS, ROW_LIMIT, segmentParams, segmentSummary, parseTagsInput, TAG_LIMIT,
  SEGMENT_LABEL, primarySegment, whySegment, combinedVisits,
  segmentExplanations, explanationIdFor,
  guestsToCsv, csvFileName, duplicateReason, mergeConfirmText, mergePreview, mergeSources,
  customerErrorText,
} from './customers'

/**
 * База клиентов лояльности для раздела «Customers». Данные из guests (031),
 * право подтверждает членство в бэкофисе (RPC get_backoffice_guests, 114) —
 * PIN-сессии в вебе нет, как и в «Девайсах» (097).
 *
 * Гости скоупятся по организации, а не по точке: программа лояльности общая
 * на org. Поиск и сегменты считает сервер (131), чтобы фильтр отвечал на
 * вопрос «кто», а не «кто из первой страницы».
 */

export async function fetchGuests(filters = {}) {
  const { data, error } = await supabase.rpc('get_backoffice_guests', segmentParams(filters))
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Метки, которые реально используются, с числом гостей (131) */
export async function fetchGuestTags() {
  const { data, error } = await supabase.rpc('get_guest_tags_web', { p_staff_session: null })
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

/**
 * Правка профиля. Единственный путь: колоночные гранты UPDATE отозваны
 * (131), право проверяет сервер. NULL означает «не менять».
 */
export async function saveGuestProfile(guestId, { name, phone, notes, tags }) {
  const { error } = await supabase.rpc('set_guest_profile', {
    p_guest_id: guestId,
    p_name: name ?? null,
    p_phone: phone ?? null,
    p_notes: notes ?? null,
    p_tags: tags ?? null,
    p_staff_session: null,
  })
  if (error) throw new Error(error.message)
}

/** Подсказка о дублях: один номер в двух написаниях и одинаковые имена */
export async function fetchDuplicates() {
  const { data, error } = await supabase.rpc('find_guest_duplicates_web', {
    p_limit: 50, p_staff_session: null,
  })
  if (error) throw new Error(error.message)
  return data ?? []
}

/**
 * Слияние: история переезжает к оставшемуся профилю, исходный остаётся
 * указателем — старый номер продолжает узнавать человека (131).
 */
export async function mergeGuests(targetId, sourceId) {
  const { data, error } = await supabase.rpc('merge_guests_web', {
    p_target_id: targetId, p_source_id: sourceId, p_staff_session: null,
  })
  if (error) throw new Error(error.message)
  return data
}

/**
 * Стирание личных данных по просьбе клиента. Заказы и чеки остаются —
 * это документы учёта; сервер сверяет введённый номер с профилем (131).
 */
export async function anonymizeGuest(guestId, confirmPhone) {
  const { data, error } = await supabase.rpc('anonymize_guest_web', {
    p_guest_id: guestId, p_confirm_phone: confirmPhone, p_staff_session: null,
  })
  if (error) throw new Error(error.message)
  return data
}
