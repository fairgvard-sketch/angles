import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BellRing, Clock, Phone, RefreshCw, StickyNote } from 'lucide-react'
import { supabase } from './supabase'
import { fetchLocation } from './settings'
import {
  STATUS_LABELS, NEXT_ACTIONS, DONE_STATUSES,
  fulfilmentMode, fetchOnlineOrders, setOnlineOrderStatus,
  formatAgorot, orderItemLines, playNewOrderChime,
} from './orders'

/**
 * «Orders» — standalone-инбокс онлайн-заказов (Kassa 101): ресторан без POS
 * принимает и ведёт заказ до выдачи прямо в кабинете. Для точки в
 * pos-режиме раздел показывает заявки read-only: их жизненный цикл живёт
 * на кассе, веб не трогает финансовый контур (инвариант «режимы не
 * смешиваются» — pos_mode на сервере).
 *
 * Свежие заявки приходят realtime-подпиской (публикация 050) со звуковым
 * сигналом; страховка — поллинг раз в 30 секунд.
 */

const ORDER_TYPE_LABELS = { here: 'Dine in', takeaway: 'Takeaway', delivery: 'Delivery' }

function timeShort(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function OrderCard({ order, standalone, busyAction, onAction }) {
  const lines = orderItemLines(order.items)
  const actions = standalone && !order.order_id ? (NEXT_ACTIONS[order.status] ?? []) : []
  return (
    <article className={`order-card is-${order.status}`}>
      <header className="order-card-head">
        <div>
          <strong>{order.customer_name}</strong>
          <small>
            <Clock /> {timeShort(order.created_at)}
            {order.order_type && ` · ${ORDER_TYPE_LABELS[order.order_type] ?? order.order_type}`}
            {order.customer_phone && <> · <Phone /> {order.customer_phone}</>}
          </small>
        </div>
        <span className={`order-status is-${order.status}`}>{STATUS_LABELS[order.status] ?? order.status}</span>
      </header>
      <ul className="order-lines">
        {lines.map((line) => (
          <li key={line.key}>
            <span className="order-qty">{line.qty} ×</span>
            <span className="order-line-text">{line.text}</span>
            <span className="order-line-total">{formatAgorot(line.total)}</span>
          </li>
        ))}
      </ul>
      {order.note && <p className="order-note"><StickyNote /> {order.note}</p>}
      {order.reject_reason && DONE_STATUSES.includes(order.status) && (
        <p className="order-note">{order.reject_reason}</p>
      )}
      <footer className="order-card-foot">
        <span className="order-total">{formatAgorot(order.total)}</span>
        <div className="order-actions">
          {actions.map((action) => (
            <button
              key={action.to}
              type="button"
              className={action.tone === 'primary' ? 'primary-button compact' : 'secondary-button'}
              disabled={busyAction != null}
              data-danger={action.tone === 'danger' || undefined}
              onClick={() => onAction(order, action.to)}
            >
              {busyAction === action.to ? '…' : action.label}
            </button>
          ))}
        </div>
      </footer>
    </article>
  )
}

export default function OrdersInbox({ context }) {
  const locations = context.locations || []
  const [locationId, setLocationId] = useState(locations[0]?.id || '')
  const [settings, setSettings] = useState(null)
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null) // { id, to }
  const knownIds = useRef(new Set())

  const standalone = useMemo(
    () => fulfilmentMode(context.products, settings) === 'standalone',
    [context.products, settings]
  )

  const refresh = useCallback(async (withSound = false) => {
    if (!locationId) return
    try {
      const next = await fetchOnlineOrders(locationId)
      setError('')
      setOrders(next)
      const ids = new Set(next.active.map((o) => o.id))
      if (withSound) {
        const hasFresh = next.active.some(
          (o) => o.status === 'new' && !knownIds.current.has(o.id)
        )
        if (hasFresh) playNewOrderChime()
      }
      knownIds.current = ids
    } catch (e) {
      setError(e.message)
    }
  }, [locationId])

  // Настройки точки — для режима обслуживания (fulfilment)
  useEffect(() => {
    if (!locationId) return undefined
    let alive = true
    setSettings(null)
    setOrders(null)
    knownIds.current = new Set()
    fetchLocation(locationId)
      .then((loc) => alive && setSettings(loc.settings || {}))
      .catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [locationId])

  // Realtime + страховочный поллинг
  useEffect(() => {
    if (!locationId) return undefined
    refresh()
    const channel = supabase
      .channel(`online-orders-${locationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'online_orders', filter: `location_id=eq.${locationId}` },
        () => refresh(true)
      )
      .subscribe()
    const timer = setInterval(() => refresh(true), 30000)
    return () => {
      supabase.removeChannel(channel)
      clearInterval(timer)
    }
  }, [locationId, refresh])

  async function act(order, to) {
    setBusy({ id: order.id, to })
    try {
      // Пустая причина допустима; отмена диалога не отменяет действие —
      // владелец уже нажал кнопку.
      const reason = (to === 'rejected' || to === 'cancelled')
        ? (window.prompt('Reason (shown to the guest, optional):') || null)
        : null
      await setOnlineOrderStatus(locationId, order.id, to, reason)
      await refresh()
    } catch (e) {
      setError(e.message === 'pos_mode'
        ? 'This location is served by the register — orders are handled on the POS.'
        : e.message)
    } finally {
      setBusy(null)
    }
  }

  const active = orders?.active ?? []
  const done = orders?.done ?? []

  return (
    <>
      <section className="page-heading compact-heading">
        <p className="eyebrow">{context.organization?.name}</p>
        <h1>Orders</h1>
        <p>
          {standalone
            ? 'Incoming online orders — accept, prepare and complete them right here.'
            : 'Online orders for this location are handled on the register; this list is read-only.'}
        </p>
      </section>

      {locations.length > 1 && (
        <div className="qr-field location-picker">
          <select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>{location.name}</option>
            ))}
          </select>
        </div>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      <section className="panel form-panel">
        <div className="panel-heading">
          <div>
            <h2><BellRing /> Active</h2>
            <p>New orders appear instantly with a chime.</p>
          </div>
          <button type="button" className="icon-button" aria-label="Refresh" onClick={() => refresh()}>
            <RefreshCw />
          </button>
        </div>
        {orders === null ? (
          <p className="empty-state">Loading…</p>
        ) : active.length === 0 ? (
          <p className="empty-state">No active orders right now.</p>
        ) : (
          <div className="order-grid">
            {active.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                standalone={standalone}
                busyAction={busy?.id === order.id ? busy.to : null}
                onAction={act}
              />
            ))}
          </div>
        )}
      </section>

      {done.length > 0 && (
        <section className="panel form-panel">
          <div className="panel-heading">
            <div><h2>Recent history</h2><p>Last completed, rejected and cancelled orders.</p></div>
          </div>
          <div className="order-grid is-history">
            {done.map((order) => (
              <OrderCard key={order.id} order={order} standalone={false} busyAction={null} onAction={() => {}} />
            ))}
          </div>
        </section>
      )}
    </>
  )
}
