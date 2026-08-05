import { supabase } from './supabase'
import { dateKey } from './hours'
// Чистые правила табеля — в отдельном модуле под тесты
export {
  HEBREW_DOW, EN_DOW, groupByDay, formatDay, formatTime, formatHm, decimalHours,
  formatRanges, formatDayLine, dayBounds, dayBreakSeconds,
  dateKey, monthRange, monthTitle, shiftMonth,
  hoursToCsv, hoursFileName, idleStaff,
} from './hours'

/**
 * Табель рабочего времени в кабинете — паритет с кассовым разделом «Табель».
 *
 * Отметки делает касса (сотрудник вводит личный PIN на терминале). Кабинет
 * их ЧИТАЕТ за период и ПРАВИТ, когда сотрудник забыл отметиться: Kassa 143
 * пускает веб-владельца по членству (088), PIN-сессия не нужна — поэтому
 * `p_staff_session` всюду null.
 *
 * Записи не удаляются физически: «удалить» = мягкое удаление с пометкой
 * автора (аудит-инвариант кассы 022/027).
 */

/** Часовой пояс точки: по нему сервер режет сутки и считает день недели */
export const TZ = 'Asia/Jerusalem'

/**
 * Часы за период по дням. Границы — КАЛЕНДАРНЫЕ даты: «август» задаётся
 * как 01…31, а не как метки времени браузера.
 */
export async function fetchHours({ from, to, staffIds = null, locationIds = null }) {
  const { data, error } = await supabase.rpc('staff_hours_report', {
    p_from: dateKey(from),
    p_to: dateKey(to),
    p_tz: TZ,
    p_staff_ids: staffIds,
    p_location_ids: locationIds,
    p_staff_session: null,
  })
  if (error) throw new Error(error.message)
  return data
}

/**
 * Добавить смену задним числом (entryId = null) или исправить время.
 * Точка обязательна для новой записи: в JWT веб-владельца её нет, сервер
 * валидирует принадлежность через assert_backoffice_location (091).
 */
export async function saveEntry({ entryId = null, staffId, clockIn, clockOut, note = null, locationId = null }) {
  const { error } = await supabase.rpc('save_time_entry', {
    p_entry_id: entryId,
    p_staff_id: staffId,
    p_clock_in: clockIn.toISOString(),
    p_clock_out: clockOut ? clockOut.toISOString() : null,
    p_actor_id: null,
    p_note: note,
    p_staff_session: null,
    p_location_id: locationId,
  })
  if (error) throw new Error(error.message)
}

/** Мягкое удаление ошибочной записи */
export async function deleteEntry(entryId) {
  const { error } = await supabase.rpc('delete_time_entry', {
    p_entry_id: entryId,
    p_actor_id: null,
    p_staff_session: null,
  })
  if (error) throw new Error(error.message)
}
