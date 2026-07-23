import { supabase } from './supabase'

/**
 * Парк устройств организации для раздела «Девайсы». Данные из телеметрии
 * кассы (heartbeat 074), право подтверждает членство в бэкофисе (RPC
 * get_backoffice_fleet, 097) — PIN-сессии в вебе нет.
 *
 * Сервер уже отсортировал парк по «молчанию» (молчащие сверху) и посчитал
 * silence_seconds на своих часах — фронт не пересчитывает время, только
 * форматирует.
 */

export async function fetchFleet() {
  const { data, error } = await supabase.rpc('get_backoffice_fleet', {
    // Владельца бэкофиса сервер узнаёт по членству (097) — токен не нужен
    p_staff_session: null,
  })
  if (error) throw new Error(error.message)
  return data ?? []
}

/**
 * Статус устройства по «молчанию» и здоровью очереди. Пороги подобраны под
 * heartbeat раз в несколько минут: до 10 мин — на связи, до часа — задержка,
 * дальше — offline. Отдельно поднимаем проблему очереди, даже если касса на
 * связи: зависшая отправка важнее, чем «молчание».
 */
export function deviceStatus(device) {
  const s = device.silence_seconds
  if (device.outbox_failed) return 'error'
  if (s === null || s === undefined) return 'never'
  if (s > 3600) return 'offline'
  if (s > 600) return 'stale'
  return 'online'
}

export const STATUS_LABEL = {
  online: 'On line',
  stale: 'Delayed',
  offline: 'Offline',
  error: 'Queue stuck',
  never: 'Never seen',
}

/** Человекочитаемое «последний раз на связи»: 3m ago / 2h ago / 4d ago */
export function lastSeenLabel(device) {
  const s = device.silence_seconds
  if (s === null || s === undefined) return 'Never'
  if (s < 60) return 'Just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

/** Возраст самой старой неотправленной операции: «oldest 3h» */
export function outboxAgeLabel(device) {
  if (!device.outbox_oldest_at) return null
  const ms = Date.now() - new Date(device.outbox_oldest_at).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}
