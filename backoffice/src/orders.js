import { supabase } from './supabase'

/**
 * Standalone-инбокс онлайн-заказов (Kassa 101).
 *
 * Чтение — прямой select по online_orders: RLS пускает членов организации
 * (JWT org_id, политика 050), запись — только RPC set_online_order_status_web
 * (owner/manager-членство, только standalone-режим точки; заявки, уже
 * конвертированные в POS-заказ, сервер не отдаёт под запись).
 *
 * Снапшот позиций и цен в items/total сделан в момент заявки и не меняется.
 */

export const ACTIVE_STATUSES = ['new', 'accepted', 'preparing', 'ready']
export const DONE_STATUSES = ['completed', 'rejected', 'cancelled']

export const STATUS_LABELS = {
  new: 'New',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready',
  completed: 'Completed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

/** Кнопки перевода статуса — зеркало переходов set_online_order_status_web. */
export const NEXT_ACTIONS = {
  new: [
    { to: 'accepted', label: 'Accept', tone: 'primary' },
    { to: 'rejected', label: 'Reject', tone: 'danger' },
  ],
  accepted: [
    { to: 'preparing', label: 'Start preparing' },
    { to: 'ready', label: 'Ready', tone: 'primary' },
    { to: 'cancelled', label: 'Cancel', tone: 'danger' },
  ],
  preparing: [
    { to: 'ready', label: 'Ready', tone: 'primary' },
    { to: 'cancelled', label: 'Cancel', tone: 'danger' },
  ],
  ready: [
    { to: 'completed', label: 'Complete', tone: 'primary' },
    { to: 'cancelled', label: 'Cancel', tone: 'danger' },
  ],
}

/**
 * Режим обслуживания точки — зеркало online_fulfilment_mode (101):
 * явная настройка сильнее дефолта по модулю pos.
 */
export function fulfilmentMode(products, settings) {
  const explicit = settings?.online_orders?.fulfilment
  if (explicit === 'pos' || explicit === 'standalone') return explicit
  const hasPos = !Array.isArray(products) || products.includes('pos')
  return hasPos ? 'pos' : 'standalone'
}

export async function fetchOnlineOrders(locationId) {
  const [active, done] = await Promise.all([
    supabase
      .from('online_orders')
      .select('id, status, customer_name, customer_phone, order_type, note, items, total, created_at, decided_at, reject_reason, order_id, table_id')
      .eq('location_id', locationId)
      .in('status', ACTIVE_STATUSES)
      .order('created_at', { ascending: true }),
    supabase
      .from('online_orders')
      .select('id, status, customer_name, items, total, created_at, reject_reason')
      .eq('location_id', locationId)
      .in('status', DONE_STATUSES)
      .order('created_at', { ascending: false })
      .limit(20),
  ])
  if (active.error) throw active.error
  if (done.error) throw done.error
  return { active: active.data ?? [], done: done.data ?? [] }
}

export async function setOnlineOrderStatus(locationId, onlineId, status, reason = null) {
  const { data, error } = await supabase.rpc('set_online_order_status_web', {
    p_location_id: locationId,
    p_online_id: onlineId,
    p_status: status,
    p_reason: reason,
  })
  if (error) throw error
  return data
}

/** Деньги — целые агороты (инвариант кассы); наружу — шекели. */
export function formatAgorot(agorot) {
  return `₪${((agorot ?? 0) / 100).toFixed(2).replace(/\.00$/, '')}`
}

/** Строки позиций из снапшота заявки: «2 × Латте · גדול · שיבולת שועל». */
export function orderItemLines(items) {
  if (!Array.isArray(items)) return []
  return items.map((item, index) => {
    const parts = [item.name]
    if (item.variant_name) parts.push(item.variant_name)
    for (const mod of item.mods ?? []) parts.push(mod.name)
    return {
      key: `${item.menu_item_id ?? 'i'}-${index}`,
      qty: item.qty ?? 1,
      text: parts.filter(Boolean).join(' · '),
      total: item.line_total ?? 0,
    }
  })
}

/**
 * Звук нового заказа: короткий двойной тон WebAudio — без аудио-ассета.
 * Браузер разрешает звук после первого взаимодействия со страницей;
 * до него beep тихо не срабатывает — это ожидаемо.
 */
let audioCtx = null
export function playNewOrderChime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
    const now = audioCtx.currentTime
    for (const [offset, freq] of [[0, 880], [0.18, 1174.66]]) {
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, now + offset)
      gain.gain.exponentialRampToValueAtTime(0.2, now + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.25)
      osc.connect(gain).connect(audioCtx.destination)
      osc.start(now + offset)
      osc.stop(now + offset + 0.3)
    }
  } catch {
    // Нет WebAudio — заказ всё равно появится в списке.
  }
}
