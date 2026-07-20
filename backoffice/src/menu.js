import { supabase } from './supabase'

/**
 * Меню в бэкофисе. Читаем каталог напрямую (RLS скоупит по org из JWT),
 * пишем через save_menu_item (Kassa 092 — единый гейт, PIN не нужен).
 * Меню org-scoped, поэтому точка здесь ни при чём.
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

export async function fetchMenu() {
  const [cats, items] = await Promise.all([
    supabase.from('menu_categories').select('id, name, sort_order').order('sort_order'),
    supabase
      .from('menu_items')
      .select('id, category_id, name, price, is_available, sort_order')
      .order('sort_order'),
  ])
  if (cats.error) throw new Error(cats.error.message)
  if (items.error) throw new Error(items.error.message)

  const byCategory = new Map(cats.data.map((c) => [c.id, { ...c, items: [] }]))
  const orphans = []
  for (const item of items.data) {
    const bucket = byCategory.get(item.category_id)
    if (bucket) bucket.items.push(item)
    else orphans.push(item)
  }
  return { categories: [...byCategory.values()], orphans }
}

/**
 * Сохранить правку товара (имя/цена/доступность).
 *
 * ВАЖНО: save_menu_item пересинхронизирует варианты и группы модификаторов
 * ПОЛНОСТЬЮ — пустые p_variants/p_group_ids сотрут их. Поэтому сначала читаем
 * текущие варианты и группы товара и передаём их обратно без изменений.
 * p_supplies не шлём — сервер сохраняет упаковку по имени варианта (075).
 */
export async function saveMenuItem(item) {
  const [variants, groups] = await Promise.all([
    supabase
      .from('item_variants')
      .select('name, price, is_default, sort_order')
      .eq('item_id', item.id)
      .order('sort_order'),
    supabase
      .from('menu_item_modifier_groups')
      .select('group_id, sort_order')
      .eq('item_id', item.id)
      .order('sort_order'),
  ])
  if (variants.error) throw new Error(variants.error.message)
  if (groups.error) throw new Error(groups.error.message)

  const { error } = await supabase.rpc('save_menu_item', {
    p_item: {
      category_id: item.category_id,
      name: item.name,
      price: item.price,
      is_available: item.is_available,
    },
    p_variants: variants.data.map((v) => ({
      name: v.name,
      price: v.price,
      is_default: v.is_default,
    })),
    p_group_ids: groups.data.map((g) => g.group_id),
    p_item_id: item.id,
    p_staff_session: null, // владельца сервер узнаёт по членству (092)
  })
  if (error) throw new Error(error.message)
}
