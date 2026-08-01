import { supabase } from './supabase'
import { ACTIVE_STATUSES, DONE_STATUSES } from './orders-inbox'

/**
 * Сеть инбокса онлайн-заказов (Kassa 101).
 *
 * Чтение — прямой select по online_orders: RLS пускает членов организации
 * (JWT org_id, политика 050), запись — только RPC set_online_order_status_web
 * (owner/manager-членство, только standalone-режим точки; заявки, уже
 * конвертированные в POS-заказ, сервер не отдаёт под запись).
 *
 * Снапшот позиций и цен в items/total сделан в момент заявки и не меняется.
 * Правила показа — в `orders-inbox.js`.
 */

/**
 * Колонки заявки. `pos:orders(daily_number)` — номер настоящего заказа на
 * кассе: для pos-точки это единственный честный «хендофф», который можно
 * показать, не выдумывая ссылку в интерфейс терминала.
 */
const ORDER_COLUMNS =
  'id, status, customer_name, customer_phone, order_type, delivery_address, note, items, '
  + 'total, created_at, decided_at, pickup_at, reject_reason, order_id, table_id, table_label, '
  + 'order_channel, pos:orders ( daily_number, status )'

/**
 * Активные — все: незакрытая заявка не должна исчезать из инбокса по
 * сроку давности, её надо развести по корзинам (см. `bucketOrders`).
 * История — за окно, чтобы поиск по заказу недельной давности работал,
 * а запрос не тянул всю таблицу.
 */
export async function fetchOnlineOrders(locationId, { historyFromIso = null, limit = 200 } = {}) {
  let history = supabase
    .from('online_orders')
    .select(ORDER_COLUMNS)
    .eq('location_id', locationId)
    .in('status', DONE_STATUSES)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (historyFromIso) history = history.gte('created_at', historyFromIso)

  const [active, done] = await Promise.all([
    supabase
      .from('online_orders')
      .select(ORDER_COLUMNS)
      .eq('location_id', locationId)
      .in('status', ACTIVE_STATUSES)
      .order('created_at', { ascending: true }),
    history,
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
