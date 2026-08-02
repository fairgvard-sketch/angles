import { supabase } from './supabase'
// Чистые правила парка — в отдельном модуле под тесты
export {
  deviceStatus, STATUS_LABEL, lastSeenLabel, outboxAgeLabel,
  deviceAdvice, isArchived, filterFleet, fleetErrorText,
  fleetSection, deleteOutcome, deleteErrorText,
} from './fleet'

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

export async function renameDevice(deviceId, name) {
  const { error } = await supabase.rpc('rename_device_web', {
    p_device_id: deviceId, p_name: name, p_staff_session: null,
  })
  if (error) throw new Error(error.message)
}

/**
 * Архив — только классификация кабинета: терминал продолжает работать,
 * записи и отчёты не трогаются, действие обратимо (130).
 */
/**
 * Окончательное удаление терминала (касса 135).
 *
 * Удаляется строка парка И учётка терминала — иначе касса при следующем
 * запуске зарегистрируется заново (`register_device` идемпотентна) и
 * вернётся в список. Сервер откажет, если терминал не в архиве или у
 * него остались неотправленные операции.
 *
 * Возвращает `{ deleted, access_revoked, reason }`: вход закрывается не
 * всегда — общая на несколько касс или человеческая учётка остаётся, и
 * интерфейс обязан это сказать.
 */
export async function deleteDevice(deviceId) {
  const { data, error } = await supabase.rpc('delete_device_web', {
    p_device_id: deviceId,
    p_staff_session: null,
  })
  if (error) throw new Error(error.message)
  return data ?? { deleted: true, access_revoked: false, reason: null }
}

export async function setDeviceArchived(deviceId, archived) {
  const { error } = await supabase.rpc('set_device_archived_web', {
    p_device_id: deviceId, p_archived: archived, p_staff_session: null,
  })
  if (error) throw new Error(error.message)
}
