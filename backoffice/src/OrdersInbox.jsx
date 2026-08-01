import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, BellRing, ChefHat, PackageCheck, Phone, RefreshCw, Search,
  StickyNote, Store, X,
} from 'lucide-react'
import { supabase } from './supabase'
import { fetchLocation } from './settings'
import { fetchOnlineOrders, setOnlineOrderStatus, playNewOrderChime } from './orders'
import {
  ACTIVE_STATUSES, DONE_STATUSES, NEXT_ACTIONS, ORDER_CHANNEL_LABELS,
  ORDER_TYPE_LABELS, STATUS_LABELS,
  bucketOrders, dayStartMs, elapsedLabel, filterOrders, formatAgorot,
  fulfilmentMode, orderItemLines, orderRef, orderTimeLabel,
} from './orders-inbox'

/**
 * «Orders» — рабочий инбокс онлайн-заказов (Kassa 101, Phase 3).
 *
 * Раньше это была одна сетка «Active», куда бессрочно копились accepted /
 * preparing / ready, а на карточке стояло время без даты: недельной
 * давности заявка выглядела как сегодняшняя. Теперь работа разложена по
 * стадиям, незакрытое из прошлых дней вынесено отдельно и подписано
 * датой, а найти конкретный заказ можно поиском, а не прокруткой.
 *
 * Для точки в pos-режиме раздел остаётся read-only: жизненный цикл живёт
 * на кассе (pos_mode на сервере), веб показывает состояние и номер
 * заказа на терминале — но не выдумывает ссылку в его интерфейс.
 */

const HISTORY_DAYS = 30
const REALTIME_LABELS = {
  live: 'Live',
  connecting: 'Connecting…',
  offline: 'Reconnecting…',
}

/** «just now» уже самодостаточно, остальному нужен хвост «ago» */
function ageLabel(iso, nowMs) {
  const age = elapsedLabel(iso, nowMs)
  return age === 'just now' ? age : `${age} ago`
}

/** Пилюли-подписи карточки: канал, тип, стол — то, что различает заказы. */
function OrderTags({ order }) {
  const channel = ORDER_CHANNEL_LABELS[order.order_channel ?? 'link']
  return (
    <div className="order-tags">
      <span className="order-tag">{ORDER_TYPE_LABELS[order.order_type] ?? order.order_type}</span>
      {channel && <span className="order-tag">{channel}</span>}
      {order.table_label && <span className="order-tag">Table {order.table_label}</span>}
      {order.delivery_address && <span className="order-tag">{order.delivery_address}</span>}
    </div>
  )
}

function OrderCard({ order, standalone, nowMs, startOfDayMs, tz, busyAction, onAction }) {
  const lines = orderItemLines(order.items)
  const posSeated = order.order_id != null
  const actions = standalone && !posSeated ? (NEXT_ACTIONS[order.status] ?? []) : []
  const isActive = ACTIVE_STATUSES.includes(order.status)
  const isToday = new Date(order.created_at).getTime() >= startOfDayMs

  return (
    <article className={`order-card is-${order.status}${isActive && !isToday ? ' is-stale' : ''}`}>
      <header className="order-card-head">
        <div>
          <strong>{order.customer_name}</strong>
          <small>
            <span className="order-ref">{orderRef(order.id)}</span>
            {/* Внутри текущего дня полезнее возраст, снаружи — дата:
                «14:30» без даты и есть та ошибка, из-за которой старый
                заказ читался как сегодняшний. */}
            {' · '}
            {isActive && isToday ? ageLabel(order.created_at, nowMs)
              : orderTimeLabel(order.created_at, startOfDayMs, tz)}
            {order.customer_phone && (
              <> · <a href={`tel:${order.customer_phone}`}><Phone /> {order.customer_phone}</a></>
            )}
          </small>
        </div>
        <span className={`order-status is-${order.status}`}>
          {STATUS_LABELS[order.status] ?? order.status}
        </span>
      </header>

      <OrderTags order={order} />

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

      {/* Честный хендофф: настоящий номер заказа на кассе, без ссылки в
          интерфейс терминала — открыть его отсюда нечем. */}
      {posSeated && (
        <p className="order-handoff">
          <Store aria-hidden />
          {order.pos?.daily_number
            ? <>On the register as order <strong>#{order.pos.daily_number}</strong>
              {order.pos.status ? ` · ${order.pos.status}` : ''}</>
            : 'Accepted on the register — the visit continues there.'}
        </p>
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
              aria-label={`${action.label} — ${order.customer_name}, ${orderRef(order.id)}`}
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

/**
 * Причина отказа/отмены. Была `window.prompt`: без заголовка, без
 * контекста заказа и с блокировкой вкладки — а текст едет гостю.
 */
function ReasonDialog({ order, action, busy, onCancel, onConfirm }) {
  const [reason, setReason] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
    function onKey(event) { if (event.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  const title = action === 'rejected' ? 'Reject this order' : 'Cancel this order'
  return (
    <div className="sheet-backdrop" onClick={onCancel} role="presentation">
      <form
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reason-title"
        onSubmit={(e) => { e.preventDefault(); onConfirm(reason.trim() || null) }}
      >
        <h3 id="reason-title">{title}</h3>
        <p className="sheet-sub">
          {order.customer_name} · {orderRef(order.id)} · {formatAgorot(order.total)}
        </p>
        <label className="qr-field">
          <span>Reason (optional)</span>
          <textarea
            ref={inputRef}
            rows={3}
            value={reason}
            maxLength={200}
            placeholder="Shown to the guest — for example: out of stock."
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <div className="order-actions">
          <button type="button" className="secondary-button" onClick={onCancel}>Keep the order</button>
          <button type="submit" className="primary-button compact" data-danger disabled={busy}>
            {busy ? '…' : (action === 'rejected' ? 'Reject' : 'Cancel order')}
          </button>
        </div>
      </form>
    </div>
  )
}

function Bucket({ icon: Icon, title, hint, tone, orders, busyFor, ...card }) {
  if (orders.length === 0) return null
  return (
    <section className={`panel form-panel order-bucket${tone ? ` is-${tone}` : ''}`}>
      <div className="panel-heading">
        <div>
          <h2><Icon /> {title} <span className="order-count">{orders.length}</span></h2>
          <p>{hint}</p>
        </div>
      </div>
      <div className="order-grid">
        {orders.map((order) => (
          <OrderCard key={order.id} order={order} busyAction={busyFor(order)} {...card} />
        ))}
      </div>
    </section>
  )
}

export default function OrdersInbox({ context, locationId }) {
  const [location, setLocation] = useState(null)
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null) // { id, to }
  const [pendingReason, setPendingReason] = useState(null) // { order, action }
  const [realtime, setRealtime] = useState('connecting')
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [type, setType] = useState('all')
  const [channel, setChannel] = useState('all')
  const knownIds = useRef(new Set())
  const requestRef = useRef(0)

  // Возраст заказа — живая величина: без тика «5 min ago» застывает
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const tz = location?.timezone || 'Asia/Jerusalem'
  const standalone = useMemo(
    () => fulfilmentMode(context.products, location?.settings) === 'standalone',
    [context.products, location]
  )
  const startOfDayMs = useMemo(() => dayStartMs(nowMs, tz), [nowMs, tz])

  const refresh = useCallback(async (withSound = false) => {
    if (!locationId) return
    const ticket = requestRef.current + 1
    requestRef.current = ticket
    try {
      const from = new Date(Date.now() - HISTORY_DAYS * 86400_000).toISOString()
      const next = await fetchOnlineOrders(locationId, { historyFromIso: from })
      if (requestRef.current !== ticket) return
      setError('')
      setOrders(next)
      if (withSound && next.active.some((o) => o.status === 'new' && !knownIds.current.has(o.id))) {
        playNewOrderChime()
      }
      knownIds.current = new Set(next.active.map((o) => o.id))
    } catch (e) {
      if (requestRef.current !== ticket) return
      setError(e.message)
    }
  }, [locationId])

  // Настройки точки: режим обслуживания и часовой пояс
  useEffect(() => {
    if (!locationId) return undefined
    let alive = true
    setLocation(null)
    setOrders(null)
    knownIds.current = new Set()
    fetchLocation(locationId)
      .then((loc) => { if (alive) setLocation(loc) })
      .catch((e) => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [locationId])

  // Realtime + страховочный поллинг
  useEffect(() => {
    if (!locationId) return undefined
    setRealtime('connecting')
    refresh()
    const channelSub = supabase
      .channel(`online-orders-${locationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'online_orders', filter: `location_id=eq.${locationId}` },
        () => refresh(true)
      )
      .subscribe((state) => {
        if (state === 'SUBSCRIBED') setRealtime('live')
        else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') setRealtime('offline')
      })
    const timer = setInterval(() => refresh(true), 30000)
    return () => {
      supabase.removeChannel(channelSub)
      clearInterval(timer)
    }
  }, [locationId, refresh])

  async function act(order, to) {
    // Отказ и отмена уезжают гостю — причину спрашиваем диалогом
    if (to === 'rejected' || to === 'cancelled') {
      setPendingReason({ order, action: to })
      return
    }
    await commit(order, to, null)
  }

  async function commit(order, to, reason) {
    setBusy({ id: order.id, to })
    try {
      await setOnlineOrderStatus(locationId, order.id, to, reason)
      setPendingReason(null)
      await refresh()
    } catch (e) {
      setError(e.message === 'pos_mode'
        ? 'This location is served by the register — orders are handled on the POS.'
        : e.message)
    } finally {
      setBusy(null)
    }
  }

  const filters = { query, status, type, channel }
  const filtersOn = query.trim() !== '' || status !== 'all' || type !== 'all' || channel !== 'all'
  const active = useMemo(() => filterOrders(orders?.active, filters), [orders, query, status, type, channel])
  const done = useMemo(() => filterOrders(orders?.done, filters), [orders, query, status, type, channel])
  const buckets = useMemo(() => bucketOrders(active, startOfDayMs), [active, startOfDayMs])
  const busyFor = (order) => (busy?.id === order.id ? busy.to : null)
  const cardProps = { standalone, nowMs, startOfDayMs, tz, busyFor, onAction: act }
  const nothingFound = active.length === 0 && done.length === 0

  return (
    <>
      <section className="page-heading compact-heading">
        <p className="eyebrow">{context.organization?.name}</p>
        <h1>Orders</h1>
        <p>
          {standalone
            ? 'Incoming online orders — accept, prepare and complete them right here.'
            : 'Online orders for this location are accepted on the register; here they are read-only.'}
        </p>
      </section>

      <div className="order-toolbar">
        <label className="order-search">
          <Search aria-hidden />
          <span className="visually-hidden">Search orders</span>
          <input
            type="search"
            value={query}
            placeholder="Name, phone, #ref or item"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="order-filter">
          <span className="visually-hidden">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Any status</option>
            {[...ACTIVE_STATUSES, ...DONE_STATUSES].map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </label>
        <label className="order-filter">
          <span className="visually-hidden">Fulfilment</span>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="all">Any type</option>
            {Object.entries(ORDER_TYPE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </label>
        <label className="order-filter">
          <span className="visually-hidden">Source</span>
          <select value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="all">Any source</option>
            {Object.entries(ORDER_CHANNEL_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </label>
        {filtersOn && (
          <button
            type="button"
            className="text-button"
            onClick={() => { setQuery(''); setStatus('all'); setType('all'); setChannel('all') }}
          >
            <X /> Clear
          </button>
        )}
        <span className={`order-live is-${realtime}`} role="status">
          <i aria-hidden />{REALTIME_LABELS[realtime]}
        </span>
        <button type="button" className="icon-button" aria-label="Refresh orders" onClick={() => refresh()}>
          <RefreshCw />
        </button>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
          <button type="button" className="text-button" onClick={() => refresh()}>Try again</button>
        </p>
      )}

      {orders === null ? (
        <section className="panel form-panel"><p className="empty-state">Loading orders…</p></section>
      ) : (
        <>
          {/* Сначала то, что ещё никто не видел, потом кухня, потом выдача */}
          <Bucket
            icon={BellRing}
            title="New"
            tone="fresh"
            hint={standalone
              ? 'Waiting for your decision — the guest sees “received”.'
              : 'Waiting to be accepted on the register.'}
            orders={buckets.fresh}
            {...cardProps}
          />
          <Bucket
            icon={ChefHat}
            title="In progress"
            hint="Accepted and being prepared."
            orders={buckets.progress}
            {...cardProps}
          />
          <Bucket
            icon={PackageCheck}
            title="Ready"
            hint="Waiting for the guest to collect."
            orders={buckets.ready}
            {...cardProps}
          />
          {/* Главное обещание раздела: незакрытое из прошлых дней видно
              отдельно и подписано датой. Ничего не трогаем автоматически —
              решение всегда за владельцем. */}
          <Bucket
            icon={AlertTriangle}
            title="Older unresolved"
            tone="stale"
            hint="Still open from previous days — close or cancel them so today’s list is honest."
            orders={buckets.stale}
            {...cardProps}
          />

          {buckets.fresh.length + buckets.progress.length + buckets.ready.length
            + buckets.stale.length === 0 && (
            <section className="panel form-panel">
              <p className="empty-state">
                {filtersOn && !nothingFound
                  ? 'No open orders match these filters.'
                  : filtersOn ? 'Nothing matches these filters.' : 'No open orders right now.'}
              </p>
            </section>
          )}

          {done.length > 0 && (
            <section className="panel form-panel">
              <div className="panel-heading">
                <div>
                  <h2>Earlier <span className="order-count">{done.length}</span></h2>
                  <p>Completed, rejected and cancelled — last {HISTORY_DAYS} days.</p>
                </div>
              </div>
              <div className="order-grid is-history">
                {done.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    standalone={false}
                    nowMs={nowMs}
                    startOfDayMs={startOfDayMs}
                    tz={tz}
                    busyAction={null}
                    onAction={() => {}}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {pendingReason && (
        <ReasonDialog
          order={pendingReason.order}
          action={pendingReason.action}
          busy={busy?.id === pendingReason.order.id}
          onCancel={() => setPendingReason(null)}
          onConfirm={(reason) => commit(pendingReason.order, pendingReason.action, reason)}
        />
      )}
    </>
  )
}
