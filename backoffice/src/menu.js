import { supabase } from './supabase'

/**
 * Управление меню в бэкофисе — паритет с кассовым экраном.
 *
 * Два механизма записи (как в кассе):
 *  - товары и порядок — через RPC save_menu_item/reorder_menu (Kassa 092,
 *    единый гейт, PIN не нужен);
 *  - категории, модификаторы, станции — прямыми запросами к таблицам; RLS
 *    скоупит по org из JWT, поэтому веб-владелец пишет их без RPC.
 *
 * Цены — целые агороты (инвариант кассы), в шекели переводим только на вывод.
 */

export function agorotToShekels(agorot) {
  return (agorot ?? 0) / 100
}

export function shekelsToAgorot(input) {
  const normalized = String(input).replace(',', '.').trim()
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
  return Math.round(parseFloat(normalized) * 100)
}

function orgId(context) {
  return context?.organization?.id
}

// ── Каталог: чтение ──────────────────────────────────────────

export async function fetchCategories() {
  const { data, error } = await supabase
    .from('menu_categories')
    .select('id, location_id, name, sort_order, is_active, icon')
    .order('sort_order')
  if (error) throw new Error(error.message)
  return data
}

export async function fetchItems() {
  const { data, error } = await supabase
    .from('menu_items')
    .select('id, category_id, station_id, name, description, price, image_url, is_available, is_favorite, ask_modifiers, sort_order, item_variants (id, name, price, is_default, sort_order), menu_item_modifier_groups (group_id, sort_order)')
    .order('sort_order')
  if (error) throw new Error(error.message)
  return data
}

export async function fetchModifierGroups() {
  const { data, error } = await supabase
    .from('modifier_groups')
    .select('id, name, min_select, max_select, sort_order, modifiers (id, name, price_delta, is_default, is_available, sort_order)')
    .order('sort_order')
  if (error) throw new Error(error.message)
  data.forEach((g) => g.modifiers?.sort((a, b) => a.sort_order - b.sort_order))
  return data
}

export async function fetchStations() {
  const { data, error } = await supabase
    .from('stations')
    .select('id, name, sort_order')
    .order('sort_order')
  if (error) throw new Error(error.message)
  return data
}

// ── Категории (прямые запросы, org из RLS) ───────────────────

export async function createCategory(context, locationId, name, sortOrder) {
  const { error } = await supabase.from('menu_categories').insert({
    org_id: orgId(context),
    location_id: locationId,
    name,
    sort_order: sortOrder,
  })
  if (error) throw new Error(error.message)
}

export async function updateCategory(id, patch) {
  const { error } = await supabase.from('menu_categories').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteCategory(id) {
  const { error } = await supabase.from('menu_categories').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function reorderCategories(orderedIds) {
  const { error } = await supabase.rpc('reorder_menu', {
    p_kind: 'category', p_ids: orderedIds, p_staff_session: null,
  })
  if (error) throw new Error(error.message)
}

// ── Товары (через RPC save_menu_item — единый гейт 092) ───────

export async function uploadItemImage(context, file) {
  const org = orgId(context)
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const path = `${org}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('menu-images').upload(path, file, {
    cacheControl: '31536000',
    contentType: file.type,
    upsert: false,
  })
  if (error) throw new Error(error.message)
  return supabase.storage.from('menu-images').getPublicUrl(path).data.publicUrl
}

function itemPayload(input) {
  return {
    name: input.name,
    description: input.description || null,
    category_id: input.category_id,
    station_id: input.station_id || null,
    price: input.price,
    image_url: input.image_url || null,
    is_available: input.is_available,
    is_favorite: input.is_favorite ?? false,
    ask_modifiers: input.ask_modifiers ?? false,
  }
}

/** Создать/обновить товар. id=null — создание. Варианты/группы — полный снимок. */
export async function saveItem(input, id = null) {
  const { data, error } = await supabase.rpc('save_menu_item', {
    p_item: itemPayload(input),
    p_variants: (input.variants || []).map((v) => ({
      name: v.name, price: v.price, is_default: v.is_default,
    })),
    p_group_ids: input.modifier_group_ids || [],
    p_item_id: id,
    p_staff_session: null,
  })
  if (error) throw new Error(error.message)
  return data
}

export async function deleteItem(id) {
  const { error } = await supabase.from('menu_items').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function reorderItems(orderedIds) {
  const { error } = await supabase.rpc('reorder_menu', {
    p_kind: 'item', p_ids: orderedIds, p_staff_session: null,
  })
  if (error) throw new Error(error.message)
}

// ── Модификаторы (прямые запросы, org-scoped) ────────────────

export async function createModifierGroup(context, name, minSelect, maxSelect, sortOrder) {
  const { data, error } = await supabase.from('modifier_groups')
    .insert({ org_id: orgId(context), name, min_select: minSelect, max_select: maxSelect, sort_order: sortOrder })
    .select('id').single()
  if (error) throw new Error(error.message)
  return data.id
}

export async function updateModifierGroup(id, patch) {
  const { error } = await supabase.from('modifier_groups').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteModifierGroup(id) {
  const { error } = await supabase.from('modifier_groups').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function createModifier(context, groupId, name, priceDelta, isDefault, sortOrder) {
  const { error } = await supabase.from('modifiers').insert({
    org_id: orgId(context), group_id: groupId, name,
    price_delta: priceDelta, is_default: isDefault, sort_order: sortOrder,
  })
  if (error) throw new Error(error.message)
}

export async function updateModifier(id, patch) {
  const { error } = await supabase.from('modifiers').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteModifier(id) {
  const { error } = await supabase.from('modifiers').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ── Станции (прямые запросы, org-scoped) ─────────────────────

export async function createStation(context, locationId, name, sortOrder) {
  // stations.location_id NOT NULL: привязываем к переданной (или первой) точке.
  // Станции по факту общие для организации, но колонка требует значение.
  const loc = locationId || context?.locations?.[0]?.id
  if (!loc) throw new Error('No location available')
  const { error } = await supabase.from('stations')
    .insert({ org_id: orgId(context), location_id: loc, name, sort_order: sortOrder })
  if (error) throw new Error(error.message)
}

export async function updateStation(id, name) {
  const { error } = await supabase.from('stations').update({ name }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteStation(id) {
  const { error } = await supabase.from('stations').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
