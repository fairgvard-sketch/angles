import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft, ChevronRight, MoreHorizontal, RefreshCw, SlidersHorizontal,
  Store, X,
} from 'lucide-react'
import { supabase } from './supabase'
import {
  fetchOrdersDesk, setOnlineOrderStatus, playNewOrderChime,
} from './orders'
import {
  ACTIVE_STATUSES, DEFAULT_RANGE, DONE_STATUSES, HISTORY_RANGES, NEXT_ACTIONS,
  ORDER_CHANNEL_LABELS, ORDER_TYPE_LABELS, PAGE_SIZE, STATUS_LABELS, STATUS_TONE,
  elapsedLabel, formatMoney, groupByDay, historyWindow, itemsLabel, orderNumber,
  orderTabs, orderTimeLabel, pageBounds, realtimeState, rowContext,
} from './orders-inbox'
import OrderSheet from './OrderSheet'
import ConfirmDialog from './ui/ConfirmDialog'
import { Button } from './ui/Button'
import Tabs from './ui/Tabs'
import { IconButton } from './ui/Button'
import { SearchField } from './ui/Layout'

/**
 * «Orders» — рабочий стол онлайн-заказов.
 *
 * Редизайн по `docs/claude-orders-approved-redesign-plan.md`, фазы 1–4:
 * галерея карточек заменена рабочей таблицей, разрезы, отбор, поиск и
 * право на действие приехали с сервера (`get_online_orders_web`, 141),
 * подробности живут в боковой панели (`OrderSheet`), а незакрытое из
 * прошлых дней свёрнуто в один блок.
 *
 * Почему таблица. Карточка занимала 227×339 px: на десктопе помещалось
 * шесть заказов, на телефоне — два, а страница вытягивалась на пять
 * экранов. Строка отвечает на те же вопросы одним взглядом — номер,
 * время, гость, способ выдачи, канал, состояние, штуки и сумма.
 *
 * Что осталось на потом: осознанный список вместо таблицы на телефоне
 * (Phase 7).
 */

/** Колонки, которые прячутся на планшете: строка обязана оставаться читаемой */
const SECONDARY = 'ord-col-secondary'

/** Ширина, ниже которой таблица перестаёт быть таблицей */
const NARROW = '(max-width: 640px)'

/**
 * Узкий экран. Раскладку решает разметка, а не только CSS: девять
 * колонок, ужатых до телефона, — это не список заказов, а таблица,
 * которую невозможно прочесть. На телефоне рисуется другой компонент,
 * поэтому ширину надо знать в JS.
 */
function useNarrow() {
  const [narrow, setNarrow] = useState(
    () => (typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia(NARROW).matches
      : false)
  )
  useEffect(() => {
    if (!window.matchMedia) return undefined
    const mq = window.matchMedia(NARROW)
    const onChange = () => setNarrow(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return narrow
}

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

function OrdersTable({
  rows, groups, scope, currency, tz, dayStartMs, nowMs, selectedId, onSelect,
  canManage, busy, onAction, empty,
}) {
  // В предзаказах смысл времени другой: важно не когда заявку оставили,
  // а к какому часу её ждут.
  const byPickup = scope === 'scheduled'
  // Без группировки таблица — одна безымянная группа: разметка одна,
  // а не две почти одинаковые.
  const blocks = groups ?? [{ key: 'all', label: null, rows }]
  const total = blocks.reduce((n, block) => n + block.rows.length, 0)

  if (total === 0) return <p className="empty-state">{empty}</p>

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
        {blocks.map((block) => (
        <tbody key={block.key}>
          {block.label && (
            <tr className="ord-day-row">
              <th scope="colgroup" colSpan={9}>
                {block.label}
                <span> · {block.rows.length}</span>
              </th>
            </tr>
          )}
          {block.rows.map((row) => {
            const selected = row.id === selectedId
            const at = byPickup ? row.pickup_at : row.created_at
            const active = ACTIVE_STATUSES.includes(row.status)
            const actions = canManage && !row.order_id
              ? (NEXT_ACTIONS[row.status] ?? [])
              : []
            return (
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
                    aria-expanded={selected}
                    onClick={() => onSelect(row.id)}
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
              </tr>
            )
          })}
        </tbody>
        ))}
      </table>
    </div>
  )
}

/**
 * Список заказов для телефона.
 *
 * Каждая строка отвечает на то, ради чего в раздел заходят с телефона:
 * какой это заказ, когда пришёл, чей он, на сколько и в каком он
 * состоянии. Остальное — в панели: она на телефоне открывается листом
 * снизу и показывает заказ целиком.
 */
function OrdersList({
  rows, groups, scope, currency, tz, dayStartMs, nowMs, selectedId, onSelect,
  canManage, busy, onAction, empty,
}) {
  const byPickup = scope === 'scheduled'
  const blocks = groups ?? [{ key: 'all', label: null, rows }]
  const total = blocks.reduce((n, block) => n + block.rows.length, 0)

  if (total === 0) return <p className="empty-state">{empty}</p>

  return (
    <div className="ord-cards">
      {blocks.map((block) => (
        <section key={block.key}>
          {block.label && (
            <h3 className="ord-cards-day">
              {block.label} <span>· {block.rows.length}</span>
            </h3>
          )}
          <ul>
            {block.rows.map((row) => {
              const at = byPickup ? row.pickup_at : row.created_at
              const active = ACTIVE_STATUSES.includes(row.status)
              const actions = canManage && !row.order_id
                ? (NEXT_ACTIONS[row.status] ?? [])
                : []
              return (
                <li key={row.id} className={row.id === selectedId ? 'is-selected' : undefined}>
                  <button
                    type="button"
                    className="ord-card-open"
                    aria-expanded={row.id === selectedId}
                    onClick={() => onSelect(row.id)}
                  >
                    <span className="ord-card-head">
                      <strong>{orderNumber(row)}</strong>
                      <span className="ord-card-time">
                        {orderTimeLabel(at, dayStartMs, tz)}
                        {active && scope === 'active' && (
                          <small> · {elapsedLabel(row.created_at, nowMs)}</small>
                        )}
                      </span>
                    </span>
                    <span className="ord-card-body">
                      <span className="ord-card-context">{rowContext(row)}</span>
                      <span className="ord-card-sum">
                        {itemsLabel(row.item_count)} · {formatMoney(row.total, currency)}
                      </span>
                    </span>
                  </button>
                  <span className="ord-card-side">
                    <span className={`ord-status is-${STATUS_TONE[row.status] ?? 'done'}`}>
                      {STATUS_LABELS[row.status] ?? row.status}
                    </span>
                    <RowMenu
                      label={`Actions for order ${orderNumber(row)}`}
                      items={actions}
                      disabled={busy?.id === row.id}
                      onPick={(to) => onAction(row, to)}
                    />
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

/** Скелет той же геометрии, что готовый экран: раздел не прыгает при загрузке */
function DeskSkeleton({ narrow }) {
  const widths = narrow
    ? [['22%', '34%'], ['46%', '28%']]
    : [['7%', '9%', '18%', '11%', '10%', '8%']]
  return (
    <div className={`ord-skeleton${narrow ? ' is-cards' : ' ord-table-scroll'}`}>
      <div role="status" aria-live="polite" className="visually-hidden">Loading orders…</div>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="ord-skeleton-row" aria-hidden>
          {widths.flat().map((w, j) => <span key={j} style={{ width: w }} />)}
        </div>
      ))}
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
  const [askError, setAskError] = useState('')
  // Успешный перевод не должен быть беззвучным: строка уезжает из
  // разреза, и без объявления непонятно, случилось ли что-нибудь.
  const [announce, setAnnounce] = useState('')
  const [socket, setSocket] = useState('connecting')
  const [lastOkMs, setLastOkMs] = useState(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [selectedId, setSelectedId] = useState(null)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  // Долг прошлых дней свёрнут по умолчанию: это чужая вчерашняя работа,
  // а не то, ради чего раздел открыли.
  const [debtOpen, setDebtOpen] = useState(false)
  // Идёт ли запрос. Отдельно от данных: смена фильтра не должна стирать
  // то, что уже на экране.
  const [loading, setLoading] = useState(true)
  // Страница истории — состояние экрана, а не ссылки: присылают отбор и
  // период, а не «третью страницу».
  const [page, setPage] = useState(1)
  const knownIds = useRef(new Set())
  const requestRef = useRef(0)
  const narrow = useNarrow()
  // Отбор на телефоне занимал две строки над списком — там, где нужен
  // сам список. Прячем за одну кнопку, на десктопе он всегда открыт.
  const [showFilters, setShowFilters] = useState(false)

  // Возраст заказа — живая величина: без тика «5 min ago» застывает
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  // Объявление живёт несколько секунд: это подтверждение действия, а не
  // состояние экрана.
  useEffect(() => {
    if (!announce) return undefined
    const id = setTimeout(() => setAnnounce(''), 4000)
    return () => clearTimeout(id)
  }, [announce])

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

  const filtersOn = search !== '' || status !== 'all' || channel !== 'all' || type !== 'all'
  /*
   * Свёрнутый долг не должен прятать результат поиска: если владелец
   * ищет заказ, он ищет его среди ВСЕХ, а не среди сегодняшних. При
   * активном отборе долг подгружается и раскрывается сам.
   */
  const debtWanted = debtOpen || filtersOn

  const counts = desk?.counts ?? {}
  const tabs = orderTabs(Number(counts.scheduled) || 0, tab)
  const view = tabs.some((t) => t.key === tab) ? tab : 'active'
  const setView = (key) => onTabChange?.(key === 'active' ? null : key)

  /*
   * Глубина истории живёт в адресе: «покажи прошлую неделю» — это ответ,
   * который присылают в поддержку. Работе дня период задаёт смена,
   * поэтому селектор есть только на вкладке истории.
   */
  const rangeKey = filters.rg ?? DEFAULT_RANGE
  const period = useMemo(
    () => historyWindow(rangeKey, desk?.day_end),
    [rangeKey, desk?.day_end]
  )

  const refresh = useCallback(async (withSound = false) => {
    if (!locationId) return
    const ticket = requestRef.current + 1
    requestRef.current = ticket
    setLoading(true)
    const params = {
      scope: view,
      status: status === 'all' ? null : status,
      channel: channel === 'all' ? null : channel,
      type: type === 'all' ? null : type,
      query: search || null,
      // История листается страницами: полсотни строк — это ответ, а не
      // «первые двести из тысячи». Работа дня и долг ограничены сами.
      ...(view === 'all'
        ? { from: period.from, to: period.to, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }
        : { limit: 200 }),
    }
    try {
      /*
       * Долг из прошлых дней грузится отдельным разрезом и живёт под
       * работой дня. Одним списком его показывать нельзя: четырнадцать
       * незакрытых заявок вытесняли сегодняшнюю работу с экрана.
       */
      const [next, debt] = await Promise.all([
        fetchOrdersDesk(locationId, params),
        view === 'active' && debtWanted
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
    } finally {
      if (requestRef.current === ticket) setLoading(false)
    }
  }, [locationId, view, status, channel, type, search, debtWanted,
    period.from, period.to, page])

  // Сузили отбор — третьей страницы может уже не быть; возвращаемся к первой
  useEffect(() => { setPage(1) }, [view, status, channel, type, search, rangeKey])

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

  /*
   * Пустой экран показывается только когда показывать НЕЧЕГО: при смене
   * точки. Смена вкладки, фильтра или страницы оставляет прежние строки
   * на месте до прихода новых — иначе раздел мигает скелетом на каждую
   * букву в поиске, а список прыгает под курсором.
   */
  useEffect(() => {
    setDesk(null)
    setOlder(null)
    setSelectedId(null)
    knownIds.current = new Set()
  }, [locationId])

  useEffect(() => { refresh() }, [refresh])

  async function act(row, to) {
    /*
     * Спрашиваем только там, где последствие уходит наружу: отказ и
     * отмена едут гостю вместе с причиной. «Принять», «Готовится»,
     * «Готов» и «Выдан» — один тап без диалога: подтверждение на каждый
     * шаг превращает смену в череду «вы уверены?».
     */
    if (to === 'rejected' || to === 'cancelled') {
      setAskError('')
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
      setAskError('')
      setAnnounce(`${orderNumber(row)} is now ${STATUS_LABELS[to] ?? to}`)
      await refresh()
    } catch (e) {
      const text = deskError(e.message)
      // Пока открыт диалог, ошибка принадлежит ему: там же осталась
      // набранная причина, и заново её печатать не придётся.
      if (pendingReason) setAskError(text)
      else setError(text)
    } finally {
      setBusy(null)
    }
  }

  const rows = desk?.rows ?? []
  const debtRows = older?.rows ?? []
  // Пока долг не загружен, счётчик берётся из ответа сервера: свёрнутый
  // блок обязан честно называть, сколько там лежит.
  const debtCount = filtersOn ? debtRows.length : (Number(counts.older) || 0)
  const bounds = pageBounds(desk?.total, page)
  const debtGroups = useMemo(
    () => groupByDay(debtRows, desk?.timezone || 'Asia/Jerusalem', nowMs),
    [debtRows, desk?.timezone, nowMs]
  )
  const selected = selectedId
    ? [...rows, ...debtRows].find((row) => row.id === selectedId) ?? null
    : null

  /*
   * Заказ мог уйти из разреза, пока панель открыта: «Готово» уводит его
   * из работы дня, а отбор — из выборки. Панель, потерявшая свой заказ,
   * закрывается, а не показывает пустоту.
   */
  useEffect(() => {
    if (selectedId && desk && !selected) setSelectedId(null)
  }, [selectedId, desk, selected])

  const closeSheet = useCallback(() => setSelectedId(null), [])
  const currency = desk?.currency || 'ILS'
  const tz = desk?.timezone || 'Asia/Jerusalem'
  const dayStart = desk?.day_start ? new Date(desk.day_start).getTime() : null
  const canManage = Boolean(desk?.can_manage)
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

  // Девять колонок, ужатых до телефона, — это не список заказов; на
  // узком экране раздел рисует другой компонент, а не ту же таблицу
  // мельче.
  const Rows = narrow ? OrdersList : OrdersTable

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

      <button
        type="button"
        className="ord-filters-toggle"
        aria-expanded={showFilters}
        aria-controls="ord-filters"
        onClick={() => setShowFilters((v) => !v)}
      >
        <SlidersHorizontal aria-hidden />
        Filters
        {filtersOn && <span className="order-count">on</span>}
      </button>

      <div id="ord-filters" className={`ord-toolbar${showFilters ? ' is-open' : ''}`}>
        {/* Период спрашиваем только там, где он что-то меняет: у работы
            дня границы задаёт смена, а не выбор в шапке. */}
        {view === 'all' && (
          <label className="ord-select">
            <span className="visually-hidden">Period</span>
            <select value={rangeKey} onChange={(e) => setFilter('rg', e.target.value)}>
              {HISTORY_RANGES.map((r) => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </select>
          </label>
        )}
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
        {(filtersOn || query.trim() !== '') && (
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
        <DeskSkeleton narrow={narrow} />
      ) : (
        <>
          <section className="panel form-panel ord-panel" aria-busy={loading || undefined}>
            <Rows
              rows={rows}
              scope={view}
              empty={filtersOn
                ? 'No order matches these filters.'
                : view === 'scheduled' ? 'No orders scheduled for a later day.'
                  : view === 'all' ? 'No orders yet.'
                    : 'No open orders right now.'}
              {...tableProps}
            />
            {view === 'all' && rows.length > 0 && (
              <div className="ord-pager">
                <span>
                  {bounds.from}–{bounds.to} of {bounds.total} orders
                </span>
                {bounds.pages > 1 && (
                  <div className="ord-pager-buttons">
                    <Button
                      size="compact"
                      disabled={bounds.page <= 1}
                      onClick={() => setPage(bounds.page - 1)}
                    >
                      <ChevronLeft /> Previous
                    </Button>
                    <span className="ord-pager-page">
                      Page {bounds.page} of {bounds.pages}
                    </span>
                    <Button
                      size="compact"
                      disabled={bounds.page >= bounds.pages}
                      onClick={() => setPage(bounds.page + 1)}
                    >
                      Next <ChevronRight />
                    </Button>
                  </div>
                )}
              </div>
            )}
          </section>

          {/*
            Долг из прошлых дней. Свёрнут по умолчанию: это чужая
            вчерашняя работа, и четырнадцать строк не должны вытеснять
            сегодняшнюю. Разворачивается одним щелчком, при поиске
            раскрывается сам, а внутри разложен по дням — «вчера» и «29
            июля» требуют разных решений.

            Ничего не закрываем автоматически: решение всегда за
            владельцем.
          */}
          {view === 'active' && debtCount > 0 && (
            <section className="panel form-panel ord-panel is-debt">
              <button
                type="button"
                className="ord-debt-toggle"
                aria-expanded={debtWanted}
                aria-controls="ord-debt"
                onClick={() => setDebtOpen((v) => !v)}
              >
                <ChevronRight aria-hidden className={debtWanted ? 'is-open' : undefined} />
                <span>
                  <strong>Older unresolved</strong>
                  <small>
                    {/*
                      Подсказка обязана быть выполнимой. POS-точке нельзя
                      советовать «закройте их»: запись из кабинета там
                      запрещена, решение принимают на кассе.
                    */}
                    {filtersOn
                      ? 'Matches from previous days'
                      : desk?.mode === 'standalone'
                        ? 'Still open from previous days — close or cancel them so today’s list is honest.'
                        : 'Waiting for a decision at the register since a previous day.'}
                  </small>
                </span>
                <span className="order-count">{debtCount}</span>
              </button>
              {debtWanted && (
                <div id="ord-debt">
                  {older === null ? (
                    <p className="empty-state">Loading…</p>
                  ) : (
                    <Rows
                      groups={debtGroups}
                      scope="older"
                      empty="No order from previous days matches these filters."
                      {...tableProps}
                    />
                  )}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {selected && (
        <OrderSheet
          row={selected}
          currency={currency}
          tz={tz}
          mode={desk?.mode}
          canManage={canManage}
          posShiftOpen={Boolean(desk?.pos?.shift_open)}
          busy={busy?.id === selected.id ? busy.to : null}
          onClose={closeSheet}
          onAction={(to) => act(selected, to)}
        />
      )}

      {pendingReason && (
        <ConfirmDialog
          title={pendingReason.action === 'rejected' ? 'Reject this order?' : 'Cancel this order?'}
          description={`${orderNumber(pendingReason.row)} · ${rowContext(pendingReason.row)} · ${formatMoney(pendingReason.row.total, currency)}`}
          confirmLabel={pendingReason.action === 'rejected' ? 'Reject' : 'Cancel order'}
          cancelLabel="Keep the order"
          tone="danger"
          reason={{ label: 'Reason', placeholder: 'Shown to the guest — for example: out of stock.' }}
          error={askError}
          busy={busy?.id === pendingReason.row.id}
          onCancel={() => { setPendingReason(null); setAskError('') }}
          onConfirm={(reason) => commit(pendingReason.row, pendingReason.action, reason)}
        />
      )}

      {/* Результат перевода — словами, для читалки и для глаза */}
      <p className="ord-announce" role="status" aria-live="polite">{announce}</p>
    </>
  )
}
