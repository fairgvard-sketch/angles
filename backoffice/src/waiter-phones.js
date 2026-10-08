import { supabase } from './supabase'

/**
 * Телефоны официантов (касса 180). Телефон один раз допускается в точку
 * одноразовым кодом; дальше любой официант входит на нём своим PIN.
 * Уволили официанта — удаляете его в Team, и его PIN перестаёт работать
 * на всех телефонах. Сам телефон отключается здесь.
 *
 * Телефон работает только с заказом к столу: оплаты, возвраты, скидки и
 * отчёты на нём недоступны на сервере, а не просто скрыты.
 */

/** Касса и телефон официанта — один фронтенд POS */
export const POS_ORIGIN = import.meta.env?.VITE_POS_ORIGIN || 'https://pos.angle.co.il'

/** Ссылка из QR: код во фрагменте не уходит на сервер и в логи хостинга */
export function pairingUrl(code, origin = POS_ORIGIN) {
  return `${String(origin).replace(/\/+$/, '')}/waiter/pair#${code}`
}

/** «K7M2P9QR» → «K7M2-P9QR»: так код проще продиктовать */
export function formatPairCode(code) {
  const s = String(code ?? '')
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : s
}

export function secondsLeft(expiresAt, now = Date.now()) {
  if (!expiresAt) return 0
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 1000))
}

/** 9:05 — сколько ещё действует код */
export function countdownLabel(seconds) {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function phoneSeenLabel(phone) {
  const s = phone.silence_seconds
  if (s === null || s === undefined) return 'Not used yet'
  if (s < 120) return 'Active now'
  if (s < 3600) return `Last used ${Math.floor(s / 60)}m ago`
  if (s < 86400) return `Last used ${Math.floor(s / 3600)}h ago`
  return `Last used ${Math.floor(s / 86400)}d ago`
}

export function isRevoked(phone) {
  return !!phone.revoked_at
}

export function phoneErrorText(message) {
  const m = String(message ?? '')
  if (m.includes('rate_limited')) return 'Too many unused codes for this location. Wait a few minutes and try again.'
  if (m.includes('module_disabled')) return 'ANGLE POS is not active for this business, so phones cannot be connected.'
  if (m.includes('invalid_location')) return 'Choose a location for the phone.'
  if (m.includes('not_found')) return 'This phone is no longer in the list. Refresh the page.'
  if (/permission|staff session|not authenticated/i.test(m)) return 'Only an owner or manager can manage waiter phones.'
  return 'Something went wrong. Try again.'
}

export async function fetchWaiterPhones() {
  const { data, error } = await supabase.rpc('list_waiter_devices_web', { p_staff_session: null })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function createPairingCode(locationId) {
  const { data, error } = await supabase.rpc('create_waiter_pairing_code', {
    p_location_id: locationId,
    p_staff_session: null,
  })
  if (error) throw new Error(error.message)
  return data
}

export async function revokeWaiterPhone(deviceId) {
  const { error } = await supabase.rpc('revoke_waiter_device_web', {
    p_device_id: deviceId,
    p_staff_session: null,
  })
  if (error) throw new Error(error.message)
}
