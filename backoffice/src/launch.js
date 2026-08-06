import { supabase } from './supabase'

/**
 * Чеклист запуска, предпросмотр и тестовая бронь (Kassa 126).
 *
 * Пункты приходят с сервера ПОСЧИТАННЫМИ по данным, а не по галочкам:
 * «я настроил зал» ничего не гарантирует, а число столов гарантирует.
 * Клиент только рисует и подписывает.
 */

/** Подписи шагов. Ключи задаёт сервер — здесь только человеческий текст. */
export const LAUNCH_STEPS = {
  tables: {
    title: 'Add tables',
    hint: 'Bookings need somewhere to seat the guest.',
    view: 'floor',
  },
  schedule: {
    title: 'Set booking hours',
    hint: 'The one schedule guests see and book by.',
  },
  // Шаг закрывают ДВА поля (Kassa 145/146): правила визита, которые
  // гость читает до заявки, и текст отмены на его странице брони.
  // Подпись называет оба — иначе владелец, написавший правила, идёт
  // искать несуществующее «поле отмены», чтобы снять галочку.
  policy: {
    title: 'Write the rules of the visit',
    hint: 'What the guest must know before booking, or the cancellation text on their booking page.',
  },
  branding: {
    title: 'Name and contacts',
    hint: 'The guest should recognise where they are booking.',
  },
  link: {
    title: 'Claim a short link',
    hint: 'Readable address for flyers and social profiles.',
  },
  test_booking: {
    title: 'Make a test booking',
    hint: 'See how a real visit looks on the timeline before guests arrive.',
  },
}

export async function fetchLaunchChecklist(locationId) {
  const { data, error } = await supabase.rpc('reserve_launch_checklist_web', {
    p_location_id: locationId,
  })
  if (error) throw new Error(error.message)
  return data
}

/** Секрет живёт в настройках точки; повторный вызов отдаёт тот же. */
export async function fetchPreviewToken(locationId, rotate = false) {
  const { data, error } = await supabase.rpc('reserve_preview_token_web', {
    p_location_id: locationId,
    p_rotate: rotate,
  })
  if (error) throw new Error(error.message)
  return data
}

/**
 * Настоящая бронь, помеченная тестовой: занимает стол и видна в
 * таймлайне, но в отчёт не попадает. Владелец отменяет её сам.
 */
export async function createTestBooking(locationId, atIso = null) {
  const { data, error } = await supabase.rpc('create_test_reservation_web', {
    p_location_id: locationId,
    p_at: atIso,
  })
  if (error) throw new Error(error.message)
  return data
}

export function launchErrorText(message) {
  const m = String(message || '')
  if (m.includes('no_tables')) return 'Add at least one table first.'
  if (m.includes('full_slot')) return 'Every table is taken at that time — try another hour.'
  if (m.includes('module_disabled')) return 'The Reserve product is not active for this account.'
  if (m.includes('backoffice access denied')) return 'Only an owner or a manager can do this.'
  return m
}
