import { supabase } from './supabase'

/**
 * План зала из кабинета (Kassa 123): зоны и столы точки.
 *
 * До 123 зал заводила только касса — зонные RPC 066/067 читают точку из
 * `auth_location_id()`, которого в токене веб-владельца нет. Организация
 * с одним лишь Reserve не могла создать ни одного стола, а без столов
 * пуст таймлайн хостес и instant-режим не находит, кого посадить.
 *
 * Чтение — прямой select под RLS членства (политики 013/066, JWT org_id),
 * запись — только `*_web`-RPC: право даёт членство owner/manager, точка
 * приходит параметром, сверху гейт «подключён Reserve ИЛИ POS».
 */

/** Зоны и столы точки одним заходом. */
export async function fetchFloorPlan(locationId) {
  const [zones, tables] = await Promise.all([
    supabase.from('table_zones')
      .select('id, name, sort_order')
      .eq('location_id', locationId).eq('is_active', true)
      .order('sort_order'),
    supabase.from('tables')
      // Координаты, размер и форма (017/018) плюс свойства подбора (138):
      // без них план зала остаётся списком, а инспектор — обманкой.
      .select('id, label, seats, combinable, zone_id, sort_order, status, '
        + 'pos_x, pos_y, width, height, shape, min_party, auto_assign')
      .eq('location_id', locationId).eq('is_active', true)
      .order('sort_order'),
  ])
  if (zones.error) throw new Error(zones.error.message)
  if (tables.error) throw new Error(tables.error.message)
  return { zones: zones.data ?? [], tables: tables.data ?? [] }
}

/**
 * Зона вместе с набором столов — одна транзакция на сервере.
 * UUID создаётся ЗДЕСЬ, до первой попытки: повтор после таймаута вернёт
 * ту же зону и не удвоит столы (инвариант идемпотентности).
 */
export async function createZone(locationId, name, sortOrder, {
  tableCount = 0, prefix = '', tableSortOrder = 0, seats = 2,
} = {}) {
  const { data, error } = await supabase.rpc('create_table_zone_web', {
    p_location_id: locationId,
    p_zone_id: crypto.randomUUID(),
    p_name: name.trim(),
    p_sort_order: sortOrder,
    p_table_count: tableCount,
    p_table_prefix: prefix.trim(),
    p_table_sort_order: tableSortOrder,
    p_table_seats: seats,
  })
  if (error) throw new Error(error.message)
  return data
}

export async function renameZone(locationId, zoneId, name) {
  const { error } = await supabase.rpc('rename_table_zone_web', {
    p_location_id: locationId, p_zone_id: zoneId, p_name: name.trim(),
  })
  if (error) throw new Error(error.message)
}

/** Мягкое удаление: столы зоны остаются и переходят в «без зоны». */
export async function deleteZone(locationId, zoneId) {
  const { error } = await supabase.rpc('delete_table_zone_web', {
    p_location_id: locationId, p_zone_id: zoneId,
  })
  if (error) throw new Error(error.message)
}

export async function reorderZones(locationId, zoneIds) {
  const { error } = await supabase.rpc('reorder_table_zones_web', {
    p_location_id: locationId, p_zone_ids: zoneIds,
  })
  if (error) throw new Error(error.message)
}

/**
 * Создание и правка стола — один RPC, идемпотентный по id.
 *
 * `minParty`/`autoAssign` = null означают «не трогать» (138): обычное
 * переименование стола не должно сбрасывать настройки подбора.
 */
export async function saveTable(locationId, {
  id, label, zoneId = null, seats = 2, combinable = false, sortOrder = 0,
  shape = null, minParty = null, autoAssign = null,
}) {
  const { data, error } = await supabase.rpc('save_table_web', {
    p_location_id: locationId,
    p_id: id || crypto.randomUUID(),
    p_label: label.trim(),
    p_zone_id: zoneId,
    p_seats: seats,
    p_combinable: combinable,
    p_sort_order: sortOrder,
    p_shape: shape,
    p_min_party: minParty,
    p_auto_assign: autoAssign,
  })
  if (error) throw new Error(error.message)
  return data
}

/**
 * Сохранить план зала целиком (138).
 *
 * Пакетом и по кнопке: пять отдельных запросов на пять перетаскиваний —
 * это пять шансов сохранить половину зала, а автосохранение каждого
 * перетаскивания лишает возможности передумать.
 */
export async function saveFloorLayout(locationId, layout) {
  const { data, error } = await supabase.rpc('save_floor_layout_web', {
    p_location_id: locationId,
    p_layout: layout,
  })
  if (error) throw new Error(error.message)
  return data
}

/** Снять порог «минимальная компания»: null в saveTable значит «не трогать» */
export async function clearTableMinParty(locationId, id) {
  const { error } = await supabase.rpc('clear_table_min_party_web', {
    p_location_id: locationId, p_id: id,
  })
  if (error) throw new Error(error.message)
}

/** Сервер откажет, если на столе открытый счёт или живая бронь впереди. */
export async function deleteTable(locationId, id) {
  const { error } = await supabase.rpc('delete_table_web', {
    p_location_id: locationId, p_id: id,
  })
  if (error) throw new Error(error.message)
}

/** Снять стол с обслуживания, не убирая с плана (ремонт, событие). */
export async function setTableStatus(locationId, id, status) {
  const { error } = await supabase.rpc('set_table_status_web', {
    p_location_id: locationId, p_id: id, p_status: status,
  })
  if (error) throw new Error(error.message)
}

/** Человеческий текст ошибок плана зала */
export function floorErrorText(message) {
  const m = String(message || '')
  if (m.includes('table_booked')) {
    return 'A guest is booked at this table — move or cancel that visit first.'
  }
  if (m.includes('table_in_use')) return 'This table has an open check on the register.'
  if (m.includes('table_exists')) return 'Another table already uses this name.'
  if (m.includes('zone_exists')) return 'A zone with this name already exists.'
  if (m.includes('table_label_required')) return 'Give the table a name.'
  if (m.includes('table_label_too_long')) return 'Table name is too long (24 characters max).'
  if (m.includes('zone_name_required')) return 'Give the zone a name.'
  if (m.includes('invalid_seats')) return 'Seats must be between 1 and 100.'
  if (m.includes('invalid_min_party')) {
    return 'Minimum party cannot be larger than the table — nobody would fit it.'
  }
  if (m.includes('position out of range')) return 'That spot is outside the floor.'
  if (m.includes('invalid shape')) return 'Unknown table shape — reload the page.'
  if (m.includes('too_many_tables')) return 'Too many tables in one save — split the floor into zones.'
  if (m.includes('invalid_table_count')) return 'Create up to 50 tables at a time.'
  if (m.includes('invalid_zone')) return 'That zone no longer exists — reload the page.'
  if (m.includes('table_not_found') || m.includes('zone_not_found')) {
    return 'That item no longer exists — reload the page.'
  }
  if (m.includes('module_disabled')) return 'Neither Reserve nor POS is active for this account.'
  if (m.includes('backoffice access denied')) return 'Only an owner or a manager can edit the floor plan.'
  return m
}
