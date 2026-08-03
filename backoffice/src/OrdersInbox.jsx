import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MoreHorizontal, RefreshCw, Store, StickyNote, X,
} from 'lucide-react'
import { supabase } from './supabase'
import {
  fetchOrdersDesk, setOnlineOrderStatus, playNewOrderChime,
} from './orders'
import {
  ACTIVE_STATUSES, DONE_STATUSES, NEXT_ACTIONS, ORDER_CHANNEL_LABELS,
  ORDER_TYPE_LABELS, STATUS_LABELS, STATUS_TONE,
  elapsedLabel, formatMoney, itemsLabel, orderItemLines, orderNumber,
  orderTabs, orderTimeLabel, realtimeState, rowContext,
} from './orders-inbox'
import Tabs from './ui/Tabs'
import { IconButton } from './ui/Button'
import { SearchField } from './ui/Layout'

/**
 * «Orders» — рабочий стол онлайн-заказов.
 *
 * Phase 2 редизайна (`docs/claude-orders-approved-redesign-plan.md`):
 * галерея карточек заменена рабочей таблицей, а разрезы, отбор, поиск и
 * право на действие приехали с сервера (`get_online_orders_web`, 141).
 *
 * Почему таблица. Карточка занимала 227×339 px: на десктопе помещалось
 * шесть заказов, на телефоне — два, а страница вытягивалась на пять
 * экранов. Строка отвечает на те же вопросы одним взглядом — номер,
 * время, гость, способ выдачи, канал, состояние, штуки и сумма.
 *
 * Что осталось на потом: боковая панель заказа с историей переходов
 * (Phase 3) и сворачивание давнего долга (Phase 4). Пока подробности
 * раскрываются строкой под выбранным заказом.
 */

/** Колонки, которые прячутся на планшете: строка обязана оставаться читаемой */
const SECONDARY = 'ord-col-secondary'

/**
 * Действия строки. Отдельное меню, а не ряд кнопок в ячейке: у заказа их
 * до трёх, и в девятиколоночной таблице они съедали бы место у сути.
 *
 * Escape и клик мимо закрывают — как у меню аккаунта в шапке. Общий
 * компонент из этого пока не делается: вытаскивать его в `ui/` значит
 * трогать AppShell, а он общий для всех разделов.
 */
function RowMenu({ label, items, disabled, onPick }) {
  const ref = useRef(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return undefined
    function onDocClick(event) {
      if (!ref.current?.contains(event.target)) setOpen(false)
    }
    function onKey(event) {
      if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) }
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (items.length === 0) return null
  return (
    <div className="ord-menu" ref={ref}>
      <IconButton
        label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal />
      </IconButton>
      {open && (
        <div className="ord-menu-pop" role="menu">
          {items.map((item) => (
            <button
              key={item.to}
              type="button"
              role="menuitem"
              className={item.tone === 'danger' ? 'is-danger' : undefined}
              onClick={() => { setOpen(false); onPick(item.to) }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Подробности выбранного заказа — до боковой панели (Phase 3) */
function DetailRow({ row, currency, columns }) {
  const lines = orderItemLines(row.items)
  return (
    <tr className="ord-detail">
      <td colSpan={columns}>
        <div className="ord-detail-body">
          <ul className="order-lines">
            {lines.map((line) => (
              <li key={line.key}>
                <span className="order-qty">{line.qty} ×</span>
                <span className="order-line-text">{line.text}</span>
                <span className="order-line-total">{formatMoney(line.total, currency)}</span>
              </li>
            ))}
          </ul>
          {row.note && <p className="order-note"><StickyNote /> {row.note}</p>}
          {row.reject_reason && DONE_STATUSES.includes(row.status) && (
            <p className="order-note">{row.reject_reason}</p>
          )}
          {/* Честный хендофф: настоящий номер заказа на кассе, без ссылки
              в интерфейс терминала — открыть его отсюда нечем. */}
          {row.order_id && (
            <p className="order-handoff">
              <Store aria-hidden />
              {row.pos_daily_number
                ? <>On the register as order <strong>#{row.pos_daily_number}</strong>
                  {row.pos_status ? ` · ${row.pos_status}` : ''}</>
                : 'Accepted on the register — the visit continues there.'}
            </p>
          )}
          {row.customer_phone && (
            <p className="ord-detail-contact">
              <a href={`tel:${row.customer_phone}`}>{row.customer_phone}</a>
            </p>
          )}
        </div>
      </td>
    </tr>
  )
}

function OrdersTable({
  rows, scope, currency, tz, dayStartMs, nowMs, selectedId, onSelect,
  canManage, busy, onAction, empty,
}) {
  // В предзаказах смысл времени другой: важно не когда заявку оставили,
  // а к какому часу её ждут.
  const byPickup = scope === 'scheduled'
  const columns = 9

  if (rows.length === 0) return <p className="empty-state">{empty}</p>

  return (
    <div className="ord-table-scroll">
      <table className="ord-table">
        <thead>
          <tr>
            <th scope="col">Order</th>
            <th scope="col">{byPickup ? 'Pickup' : 'Time'}</th>
            <th scope="col">Customer</th>
            <th scope="col" className={SECONDARY}>Fulfilment</th>
            <th scope="col" className={SECONDARY}>Channel</th>
            <th scope="col">Status</th>
            <th scope="col" className={SECONDARY}>Items</th>
            <th scope="col" className="ord-col-total">Total</th>
            <th scope="col" className="ord-col-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const selected = row.id === selectedId
            const at = byPickup ? row.pickup_at : row.created_at
            const active = ACTIVE_STATUSES.includes(row.status)
            const actions = canManage && !row.order_id
              ? (NEXT_ACTIONS[row.status] ?? [])
              : []
            return [
              <tr
                key={row.id}
                className={`ord-row${selected ? ' is-selected' : ''}`}
              >
                <td className="ord-cell-num">
                  {/* Раскрывает строку отдельная кнопка, а не вся строка:
                      role="button" на <tr> ломается, как только внутрь
                      попадает любой другой интерактивный элемент. */}
                  <button
                    type="button"
                    className="ord-open"
                    aria-pressed={selected}
                    onClick={() => onSelect(selected ? null : row.id)}
                  >
                    {orderNumber(row)}
                  </button>
                </td>
                <td className="ord-cell-time">
                  {orderTimeLabel(at, dayStartMs, tz)}
                  {/* Возраст — только у работы текущего дня. В долге он
                      превращался в «147 h 00 min»: столько часов никто не
                      считает, там говорит дата. */}
                  {active && scope === 'active' && (
                    <small>{elapsedLabel(row.created_at, nowMs)}</small>
                  )}
                </td>
                <td className="ord-cell-context">{rowContext(row)}</td>
                <td className={SECONDARY}>
                  {ORDER_TYPE_LABELS[row.order_type] ?? row.order_type}
                  {row.table_label && <small>Table {row.table_label}</small>}
                </td>
                <td className={SECONDARY}>
                  {ORDER_CHANNEL_LABELS[row.order_channel] ?? row.order_channel}
                </td>
                <td>
                  <span className={`ord-status is-${STATUS_TONE[row.status] ?? 'done'}`}>
                    {STATUS_LABELS[row.status] ?? row.status}
                  </span>
                </td>
                <td className={SECONDARY}>{itemsLabel(row.item_count)}</td>
                <td className="ord-col-total">{formatMoney(row.total, currency)}</td>
                <td className="ord-cell-menu">
                  <RowMenu
                    label={`Actions for order ${orderNumber(row)}`}
                    items={actions}
                    disabled={busy?.id === row.id}
                    onPick={(to) => onAction(row, to)}
                  />
                </td>
              </tr>,
              selected && (
                <DetailRow
                  key={`${row.id}-detail`}
                  row={row}
                  currency={currency}
                  columns={columns}
                />
              ),
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Скелет той же геометрии, что таблица: раздел не прыгает при загрузке */
function TableSkeleton() {
  return (
    <div className="ord-table-scroll ord-skeleton">
      <div role="status" aria-live="polite" className="visually-hidden">Loading orders…</div>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="ord-skeleton-row" aria-hidden>
          <span style={{ width: '7%' }} />
          <span style={{ width: '9%' }} />
          <span style={{ width: '18%' }} />
          <span style={{ width: '11%' }} />
          <span style={{ width: '10%' }} />
          <span style={{ width: '8%' }} />
        </div>
      ))}
    </div>
  )
}

/**
 * Причина отказа/отмены. Была `window.prompt`: без заголовка, без
 * контекста заказа и с блокировкой вкладки — а текст едет гостю.
 */
function ReasonDialog({ row, action, currency, busy, onCancel, onConfirm }) {
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
          {orderNumber(row)} · {rowContext(row)} · {formatMoney(row.total, currency)}
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

/** Понятный текст вместо кода ошибки RPC */
function deskError(message) {
  if (message === 'pos_mode') return 'This location is served by the register — orders are handled on the POS.'
  if (message === 'module_disabled') return 'Online orders are not part of this plan.'
  if (message === 'invalid_transition') return 'This order has already moved on — refresh to see its current state.'
  if (message?.includes('backoffice access denied')) return 'Your role can view orders but not change them.'
  return message
}

/*
 * Контекст аккаунта разделу больше не нужен: режим точки, валюта, часовой
 * пояс и право на действие приходят с ответом сервера (141), а не
 * выводятся из списка продуктов организации.
 */
export default function OrdersInbox({
  locationId, tab, onTabChange, filters = {}, onFiltersChange,
}) {
  const [desk, setDesk] = useState(null)
  const [older, setOlder] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null) // { id, to }
  const [pendingReason, setPendingReason] = useState(null) // { row, action }
  const [socket, setSocket] = useState('connecting')
  const [lastOkMs, setLastOkMs] = useState(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [selectedId, setSelectedId] = useState(null)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const knownIds = useRef(new Set())
  const requestRef = useRef(0)

  // Возраст заказа — живая величина: без тика «5 min ago» застывает
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  // Поиск ходит на сервер, поэтому ждёт паузы в наборе, а не каждой буквы
  useEffect(() => {
    const id = setTimeout(() => setSearch(query.trim()), 300)
    return () => clearTimeout(id)
  }, [query])

  const status = filters.st ?? 'all'
  const channel = filters.ch ?? 'all'
  const type = filters.fl ?? 'all'
  const setFilter = (key, value) => onFiltersChange?.({
    ...filters, [key]: value === 'all' ? null : value,
  })

  const counts = desk?.counts ?? {}
  const tabs = orderTabs(Number(counts.scheduled) || 0, tab)
  const view = tabs.some((t) => t.key === tab) ? tab : 'active'
  const setView = (key) => onTabChange?.(key === 'active' ? null : key)

  const refresh = useCallback(async (withSound = false) => {
    if (!locationId) return
    const ticket = requestRef.current + 1
    requestRef.current = ticket
    const params = {
      scope: view,
      status: status === 'all' ? null : status,
      channel: channel === 'all' ? null : channel,
      type: type === 'all' ? null : type,
      query: search || null,
      limit: 200,
    }
    try {
      /*
       * Долг из прошлых дней грузится отдельным разрезом и живёт под
       * работой дня. Одним списком его показывать нельзя: четырнадцать
       * незакрытых заявок вытесняли сегодняшнюю работу с экрана.
       */
      const [next, debt] = await Promise.all([
        fetchOrdersDesk(locationId, params),
        view === 'active'
          ? fetchOrdersDesk(locationId, { ...params, scope: 'older' })
          : Promise.resolve(null),
      ])
      if (requestRef.current !== ticket) return
      setError('')
      setDesk(next)
      setOlder(debt)
      setLastOkMs(Date.now())
      const fresh = (next.rows ?? []).filter(
        (row) => row.status === 'new' && !knownIds.current.has(row.id)
      )
      if (withSound && fresh.length > 0) playNewOrderChime()
      knownIds.current = new Set((next.rows ?? []).map((row) => row.id))
    } catch (e) {
      if (requestRef.current !== ticket) return
      setError(deskError(e.message))
    }
  }, [locationId, view, status, channel, type, search])

  // Realtime + страховочный поллинг
  useEffect(() => {
    if (!locationId) return undefined
    setSocket('connecting')
    setLastOkMs(null)
    const channelSub = supabase
      .channel(`online-orders-${locationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'online_orders', filter: `location_id=eq.${locationId}` },
        () => refresh(true)
      )
      .subscribe((state) => {
        if (state === 'SUBSCRIBED') setSocket('live')
        else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') setSocket('offline')
      })
    const timer = setInterval(() => refresh(true), 30000)
    return () => {
      supabase.removeChannel(channelSub)
      clearInterval(timer)
    }
  }, [locationId, refresh])

  // Смена разреза, отбора или точки — это другой вопрос к серверу
  useEffect(() => {
    setDesk(null)
    setOlder(null)
    knownIds.current = new Set()
    refresh()
  }, [refresh])

  async function act(row, to) {
    // Отказ и отмена уезжают гостю — причину спрашиваем диалогом
    if (to === 'rejected' || to === 'cancelled') {
      setPendingReason({ row, action: to })
      return
    }
    await commit(row, to, null)
  }

  async function commit(row, to, reason) {
    setBusy({ id: row.id, to })
    try {
      await setOnlineOrderStatus(locationId, row.id, to, reason)
      setPendingReason(null)
      await refresh()
    } catch (e) {
      setError(deskError(e.message))
    } finally {
      setBusy(null)
    }
  }

  const rows = desk?.rows ?? []
  const debtRows = older?.rows ?? []
  const currency = desk?.currency || 'ILS'
  const tz = desk?.timezone || 'Asia/Jerusalem'
  const dayStart = desk?.day_start ? new Date(desk.day_start).getTime() : null
  const canManage = Boolean(desk?.can_manage)
  const filtersOn = query.trim() !== '' || status !== 'all' || channel !== 'all' || type !== 'all'
  const realtime = realtimeState({ socket, lastOkMs, nowMs, failed: Boolean(error) })

  /*
   * Кто владеет жизненным циклом — говорим фактом, а не предположением.
   * POS-точка с закрытой сменой это отдельный случай: заявка пришла, а
   * на терминале её сейчас никто не видит, и владелец должен знать это
   * до того, как гость позвонит.
   */
  const owner = desk?.mode === 'standalone'
    ? (canManage ? 'Handled here' : 'View only — your role cannot change orders')
    : (desk?.pos?.shift_open
      ? 'Handled on the register'
      : 'Handled on the register — no open shift right now')

  const tableProps = {
    currency, tz, dayStartMs: dayStart, nowMs, selectedId,
    onSelect: setSelectedId, canManage, busy, onAction: act,
  }

  return (
    <>
      <div className="ord-header">
        <h1>Orders</h1>
        <SearchField
          label="Search orders"
          value={query}
          onChange={setQuery}
          placeholder="Order #, name, phone or item"
        />
        <div className="ord-header-live">
          <span className={`ord-live is-${realtime}`} role="status">
            <i aria-hidden />{{
              live: 'Live',
              connecting: 'Connecting…',
              reconnecting: 'Reconnecting…',
              stale: 'Data may be stale',
            }[realtime]}
          </span>
          <IconButton label="Refresh orders" onClick={() => refresh()}>
            <RefreshCw />
          </IconButton>
        </div>
      </div>

      <Tabs
        className="ord-tabs"
        label="Orders view"
        items={tabs.map((t) => ({
          ...t,
          label: t.count ? `${t.label} ${t.count}` : t.label,
        }))}
        value={view}
        onChange={setView}
      />

      <div className="ord-toolbar">
        <label className="ord-select">
          <span className="visually-hidden">Source</span>
          <select value={channel} onChange={(e) => setFilter('ch', e.target.value)}>
            <option value="all">All channels</option>
            {Object.entries(ORDER_CHANNEL_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </label>
        <label className="ord-select">
          <span className="visually-hidden">Fulfilment</span>
          <select value={type} onChange={(e) => setFilter('fl', e.target.value)}>
            <option value="all">All fulfilment</option>
            {Object.entries(ORDER_TYPE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </label>
        <label className="ord-select">
          <span className="visually-hidden">Status</span>
          <select value={status} onChange={(e) => setFilter('st', e.target.value)}>
            <option value="all">All statuses</option>
            {[...ACTIVE_STATUSES, ...DONE_STATUSES].map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </label>
        {filtersOn && (
          <button
            type="button"
            className="text-button"
            onClick={() => { setQuery(''); onFiltersChange?.({}) }}
          >
            <X /> Clear
          </button>
        )}
        <span className="ord-owner">
          {desk?.mode === 'pos' && <Store aria-hidden />}
          {owner}
        </span>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
          <button type="button" className="text-button" onClick={() => refresh()}>Try again</button>
        </p>
      )}

      {desk === null ? (
        <TableSkeleton />
      ) : (
        <>
          <section className="panel form-panel ord-panel">
            <OrdersTable
              rows={rows}
              scope={view}
              empty={filtersOn
                ? 'No order matches these filters.'
                : view === 'scheduled' ? 'No orders scheduled for a later day.'
                  : view === 'all' ? 'No orders yet.'
                    : 'No open orders right now.'}
              {...tableProps}
            />
            {view === 'all' && desk.total > rows.length && (
              <p className="timeline-hidden-note">
                Showing the first {rows.length} of {desk.total} orders — narrow the
                search or the filters to see the rest.
              </p>
            )}
          </section>

          {/* Долг из прошлых дней — под работой дня и своим списком, с
              полной датой у каждой строки. Ничего не закрываем
              автоматически: решение всегда за владельцем. */}
          {view === 'active' && debtRows.length > 0 && (
            <section className="panel form-panel ord-panel is-debt">
              <div className="panel-heading">
                <div>
                  <h2>Older unresolved <span className="order-count">{debtRows.length}</span></h2>
                  <p>Still open from previous days — close or cancel them so today’s list is honest.</p>
                </div>
              </div>
              <OrdersTable rows={debtRows} scope="older" empty="" {...tableProps} />
            </section>
          )}
        </>
      )}

      {pendingReason && (
        <ReasonDialog
          row={pendingReason.row}
          action={pendingReason.action}
          currency={currency}
          busy={busy?.id === pendingReason.row.id}
          onCancel={() => setPendingReason(null)}
          onConfirm={(reason) => commit(pendingReason.row, pendingReason.action, reason)}
        />
      )}
    </>
  )
}
