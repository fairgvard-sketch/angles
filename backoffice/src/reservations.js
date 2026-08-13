import { supabase } from './supabase'
// Чистые правила (время точки, тексты ошибок) — в отдельном модуле
export { deskErrorText, toLocalInput, fromLocalInput } from './reservations-time'

/**
 * Веб-стол хостес (Kassa 102): полный цикл брони без POS.
 *
 * Чтение — одна серверная модель (`get_reservation_desk_web`, 152),
 * запись — RPC с членством owner/manager и модулем reservations;
 * посаженные на кассе брони с order_id сервер под запись не отдаёт
 * (pos_mode).
 *
 * Прямых выборок из `reservations` здесь больше нет. Их было четыре, по
 * одной на компонент, и один рендер раздела стоил четырнадцати
 * запросов; хуже — полотно и список собирали одну и ту же бронь разными
 * выборками, и «что видит хостес» зависело от вкладки, с которой он
 * пришёл.
 */

/**
 * Стол хостес за окно: часы точки, зоны, столы и визиты одним ответом.
 *
 * Окно задаётся в UTC и с запасом (`visit.js`), потому что часовой пояс
 * точки приезжает В ЭТОМ ЖЕ ответе. Считать границы запроса по поясу
 * значит спросить сервер дважды — ровно то, из-за чего полотно
 * загружалось по два раза при каждом открытии.
 */
export async function fetchDesk(locationId, fromMs, toMs, limit = 500) {
  const { data, error } = await supabase.rpc('get_reservation_desk_web', {
    p_location_id: locationId,
    p_from: new Date(fromMs).toISOString(),
    p_to: new Date(toMs).toISOString(),
    p_limit: limit,
  })
  if (error) throw new Error(error.message)
  return data ?? { zones: [], tables: [], visits: [] }
}

/**
 * Подробности открытого визита: профиль гостя с заметкой и метками,
 * полная статистика броней и денежная часть из POS.
 *
 * Панель открывается БЕЗ этого запроса — визит уже есть в списочной
 * модели. Здесь приезжает только то, чего в ней намеренно нет:
 * рассылать внутренние заметки обо всех гостях дня ради одного,
 * которого откроют, нельзя.
 */
export async function fetchVisit(locationId, id) {
  const { data, error } = await supabase.rpc('get_visit_web', {
    p_location_id: locationId,
    p_id: id,
  })
  if (error) throw new Error(error.message)
  return data
}

export async function setReservationStatus(locationId, id, status, reason = null) {
  const { data, error } = await supabase.rpc('set_reservation_status_web', {
    p_location_id: locationId,
    p_id: id,
    p_status: status,
    p_reason: reason,
  })
  if (error) throw error
  return data
}

// ── Действия хостес (Kassa 119/120/127) ──────────────────────

/** Назначить / объединить / разъединить столы визита (120) */
export async function setReservationTables(locationId, id, tableIds) {
  const { error } = await supabase.rpc('set_reservation_tables_web', {
    p_location_id: locationId,
    p_id: id,
    p_table_ids: tableIds,
  })
  if (error) throw new Error(error.message)
}

/**
 * Узнать гостя по телефону при ручной броне (157).
 *
 * Совпадение точное и только по полному номеру: поиск по началу
 * превратил бы форму брони в перебор клиентской базы. Пустой ответ
 * одинаков для «такого гостя нет» и «номер ещё короткий» — по нему
 * нельзя проверить существование чужого номера.
 */
export async function lookupGuestByPhone(locationId, phone) {
  const { data, error } = await supabase.rpc('lookup_guest_by_phone_web', {
    p_location_id: locationId,
    p_phone: phone,
  })
  if (error) throw new Error(error.message)
  return data
}

// ── Ручная бронь и правка визита (Kassa 120/127) ─────────────

/**
 * Завести визит из кабинета: телефонная бронь или walk-in.
 *
 * Стол и доступность считает сервер тем же алгоритмом, что и гостевая
 * страница — клиент не решает, свободно ли место, иначе два хостес за
 * разными экранами посадят на один стол двоих.
 */
export async function createReservation(locationId, {
  name, phone = '', partySize = 2, at = null, note = null, tableIds = null, walkIn = false,
}) {
  const { data, error } = await supabase.rpc('create_reservation_web', {
    p_location_id: locationId,
    p_name: name,
    p_phone: phone,
    p_party_size: partySize,
    p_at: at,
    p_note: note,
    p_table_ids: tableIds,
    p_walk_in: walkIn,
  })
  if (error) throw new Error(error.message)
  return data
}

/** Имя и телефон визита (127) — занятость они не меняют */
export async function updateReservationGuest(locationId, id, { name, phone }) {
  const { data, error } = await supabase.rpc('update_reservation_guest_web', {
    p_location_id: locationId,
    p_id: id,
    p_name: name ?? null,
    p_phone: phone ?? null,
  })
  if (error) throw new Error(error.message)
  return data
}

/**
 * Время, компания, заметка (120). Смена времени или длительности
 * пересчитывает занятость на сервере — конфликт приходит как table_busy.
 */
export async function updateReservation(locationId, id, {
  at = null, partySize = null, note = null, zoneId = null, duration = null,
}) {
  const { data, error } = await supabase.rpc('update_reservation_web', {
    p_location_id: locationId,
    p_id: id,
    p_reserved_at: at,
    p_party_size: partySize,
    p_note: note,
    p_zone_id: zoneId,
    p_duration: duration,
  })
  if (error) throw new Error(error.message)
  return data
}

/** Отметить посадку гостя без POS-заказа (120) */
export async function markReservationArrived(locationId, id) {
  const { error } = await supabase.rpc('mark_reservation_arrived_web', {
    p_location_id: locationId,
    p_id: id,
  })
  if (error) throw new Error(error.message)
}

/**
 * Очередь уведомлений точки (158).
 *
 * Отдаёт и сводку, и записи, и главное — `provider_ready`. Без него
 * интерфейс не отличит «нечего отправлять» от «нечем отправлять» и
 * покажет пустой список как норму.
 */
export async function fetchNotificationOutbox(locationId, status = null) {
  const { data, error } = await supabase.rpc('get_notification_outbox_web', {
    p_location_id: locationId,
    p_status: status,
    p_limit: 50,
    p_offset: 0,
  })
  if (error) throw new Error(error.message)
  return data
}

// ── Лист ожидания (Kassa 122) ────────────────────────────────

/** Записи листа: ждущие и те, кому уже отправлено предложение */
export async function fetchWaitlist(locationId) {
  const { data, error } = await supabase
    .from('waitlist_entries')
    .select('id, customer_name, customer_phone, party_size, wanted_date, '
      + 'time_from, time_to, zone_ids, note, status, offer_at, offer_expires, created_at')
    .eq('location_id', locationId)
    .in('status', ['waiting', 'offered'])
    .order('created_at')
  if (error) throw new Error(error.message)
  return data ?? []
}

/**
 * Кого можно позвать на освободившееся время. Сервер проверяет не только
 * пожелание гостя, но и реальную возможность посадить: предлагать слот,
 * на который нет стола, значит обмануть дважды.
 *
 * Ответ несёт и ПОЧЕМУ кандидат подходит (окно, зоны, обещанное
 * ожидание, 153): без этого список выглядит как «позвоните этим людям»
 * без объяснения, и хостес не может решить, кому звонить первым.
 */
export async function fetchWaitlistMatches(locationId, atIso) {
  const { data, error } = await supabase.rpc('waitlist_matches_web', {
    p_location_id: locationId,
    p_at: atIso,
  })
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Отправить предложение на время. Стол не резервируется (Kassa 122). */
export async function offerWaitlistSlot(id, atIso, ttlMin = 30) {
  const { data, error } = await supabase.rpc('offer_waitlist_slot', {
    p_id: id,
    p_at: atIso,
    p_ttl_min: ttlMin,
  })
  if (error) throw new Error(error.message)
  return data
}

/** Разослать просьбы подтвердить приход по броням ближайшего окна */
export async function requestConfirmations(locationId) {
  const { data, error } = await supabase.rpc('request_reservation_confirmations', {
    p_location_id: locationId,
  })
  if (error) throw new Error(error.message)
  return data ?? 0
}

// ── Очередь ожидания в кабинете (Kassa 137) ──────────────────

/**
 * Записать подошедшего гостя в очередь.
 *
 * `clientUuid` создаётся ЗДЕСЬ, до первой попытки: повтор после
 * таймаута вернёт ту же запись, а не заведёт второго Ивана в очередь.
 */
export async function addWaitlistEntry(locationId, {
  clientUuid, name, phone = '', partySize = 2, quotedMin = null,
  zoneIds = null, note = null,
}) {
  const { data, error } = await supabase.rpc('add_waitlist_entry_web', {
    p_location_id: locationId,
    p_client_uuid: clientUuid || crypto.randomUUID(),
    p_name: name,
    p_phone: phone,
    p_party_size: partySize,
    p_quoted_min: quotedMin,
    p_zone_ids: zoneIds,
    p_note: note,
  })
  if (error) throw new Error(error.message)
  return data
}

/**
 * Посадить гостя из очереди. Столы подбирает сервер тем же алгоритмом,
 * что и обычную бронь: экран может отставать на минуту, и этой минуты
 * хватает на двойную посадку.
 */
export async function seatWaitlistEntry(locationId, id, tableIds = null) {
  const { data, error } = await supabase.rpc('seat_waitlist_entry_web', {
    p_location_id: locationId,
    p_id: id,
    p_table_ids: tableIds,
  })
  if (error) throw new Error(error.message)
  return data
}

/** Порядок «кого зовём следующим» — решение хостес, а не арифметика */
export async function reorderWaitlist(locationId, ids) {
  const { data, error } = await supabase.rpc('reorder_waitlist_web', {
    p_location_id: locationId,
    p_ids: ids,
  })
  if (error) throw new Error(error.message)
  return data
}

/** Убрать из очереди (гость ушёл) или вернуть обратно */
export async function setWaitlistStatus(locationId, id, status) {
  const { data, error } = await supabase.rpc('set_waitlist_status_web', {
    p_location_id: locationId,
    p_id: id,
    p_status: status,
  })
  if (error) throw new Error(error.message)
  return data
}

/** Записи очереди целиком: и ждущие, и закрытые за сегодня */
export async function fetchWaitlistQueue(locationId, dateStr) {
  const { data, error } = await supabase
    .from('waitlist_entries')
    .select('id, customer_name, customer_phone, party_size, wanted_date, '
      + 'time_from, time_to, zone_ids, note, status, position, quoted_min, '
      + 'offer_at, offer_expires, reservation_id, created_at')
    .eq('location_id', locationId)
    .eq('wanted_date', dateStr)
    .order('created_at')
  if (error) throw new Error(error.message)
  return data ?? []
}
