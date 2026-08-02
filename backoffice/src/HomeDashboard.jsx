import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, CalendarDays, ChevronRight, Info, MonitorSmartphone, QrCode,
  RefreshCw, ShoppingBag, Wifi,
} from 'lucide-react'
import {
  attentionItems, fleetSummary, loadDashboard, ordersSummary, reservationsSummary,
  timeLabel, todayLabel,
} from './dashboard'
import { deviceStatus, lastSeenLabel, STATUS_LABEL } from './devices'
import { elapsedLabel } from './orders-inbox'
import { formatMoney } from './sales'
import { hasCapability } from './navigation'
import { PUBLIC_MENU_ORIGIN } from './online'
import { Button, IconButton } from './ui/Button'
import { EmptyState, PageHeader, Panel, StatusBadge } from './ui/Layout'

/**
 * Главная кабинета: что происходит сейчас и что требует внимания.
 *
 * Виджеты привязаны к capability — Menu-клиент не увидит смену на кассе,
 * а POS-клиент без брони не увидит визитов. Ни одного придуманного
 * показателя: всё, что здесь есть, читается с сервера.
 */

function Metric({ label, value, detail, tone }) {
  return (
    <div className={`metric${tone ? ` is-${tone}` : ''}`}>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      {detail && <span className="metric-detail">{detail}</span>}
    </div>
  )
}

const ATTENTION_ICON = { alert: AlertTriangle, warn: AlertTriangle, info: Info }

function Attention({ items, onNavigate }) {
  if (items.length === 0) {
    return (
      <Panel title="Needs attention" description="Everything that usually needs a decision is clear.">
        <EmptyState>Nothing is waiting for you right now.</EmptyState>
      </Panel>
    )
  }
  return (
    <Panel title="Needs attention" description="Sorted by what costs most if it waits.">
      <div className="data-list attention-list">
        {items.map((item) => {
          const Icon = ATTENTION_ICON[item.tone] || Info
          return (
            <div className={`data-row attention-row is-${item.tone}`} key={item.id}>
              <span className="attention-icon" aria-hidden><Icon /></span>
              <span className="attention-text">
                <strong>{item.title}</strong>
                {item.detail && <small>{item.detail}</small>}
              </span>
              {item.action && (
                <Button
                  variant="secondary"
                  onClick={() => onNavigate(item.action.view, null, item.action.tab)}
                >
                  {item.action.label}
                </Button>
              )}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

export default function HomeDashboard({ context, locationId, onNavigate, children }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.now())

  const locations = useMemo(() => context.locations || [], [context])
  const location = locations.find((l) => l.id === locationId) || locations[0] || null
  const tz = location?.timezone || undefined

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    try {
      setData(await loadDashboard(context, locationId, { tz }))
      setNow(Date.now())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [context, locationId, tz])

  useEffect(() => {
    load()
    // Пока экран открыт — тихо освежаем: заказ и бронь приходят без нас
    const timer = setInterval(() => load(true), 60_000)
    return () => clearInterval(timer)
  }, [load])

  const can = (capability) => hasCapability(context, capability)
  const orders = ordersSummary(data?.orders, now, tz)
  const bookings = reservationsSummary(data?.reservations, now)
  const fleet = fleetSummary(data?.fleet)
  const summary = data?.sales?.summary
  const openShift = (data?.shifts || []).find((s) => s.location_id === location?.id) || null

  const attention = useMemo(() => (data ? attentionItems({
    context,
    fleet: data.fleet,
    orders: data.orders,
    reservations: data.reservations,
    shifts: data.shifts,
    channels: data.channels,
    locations,
    nowMs: now,
    tz,
  }) : []), [data, context, locations, now, tz])

  return (
    <>
      <PageHeader
        eyebrow={context.organization?.name}
        title="Dashboard"
        description={`${todayLabel(now, tz)}${location ? ` · ${location.name}` : ''}`}
      />

      <div className="order-toolbar dashboard-toolbar">
        {/* Частичный отказ — состояние продукта, а не ошибка: остальные
            виджеты обязаны остаться на экране. */}
        {data?.failed?.length > 0 && (
          <span className="dashboard-partial">
            <AlertTriangle aria-hidden /> Some data could not be loaded
          </span>
        )}
        {error && <span className="dashboard-partial">{error}</span>}
        <IconButton onClick={() => load()} label="Refresh dashboard" disabled={loading}>
          <RefreshCw />
        </IconButton>
      </div>

      {loading && !data ? (
        <EmptyState>Loading…</EmptyState>
      ) : (
        <>
          <Attention items={attention} onNavigate={onNavigate} />

          <section className="dashboard-metrics" aria-label="Today">
            {can('pos_reports') && (
              <Metric
                label="Net sales today"
                value={summary ? formatMoney(summary.gross_sales - summary.refunds) : '—'}
                detail={summary ? `${summary.orders_count ?? 0} orders · avg ${formatMoney(summary.avg_check)}` : 'No sales yet'}
              />
            )}
            {can('orders_desk') && orders && (
              <Metric
                label="Online orders"
                value={orders.today}
                detail={orders.waiting > 0
                  ? `${orders.waiting} waiting for an answer`
                  : 'Nothing waiting'}
                tone={orders.waiting > 0 ? 'alert' : null}
              />
            )}
            {can('reservations_desk') && bookings && (
              <Metric
                label="Bookings today"
                value={bookings.today}
                detail={bookings.today > 0 ? `${bookings.guests} guests expected` : 'No bookings yet'}
              />
            )}
            {can('pos_operate') && (
              <Metric
                label="Shift"
                value={openShift ? 'Open' : 'Closed'}
                detail={openShift
                  ? `Since ${timeLabel(openShift.opened_at, tz)}`
                  : 'Opened on the register'}
              />
            )}
          </section>

          <div className="overview-grid">
            {can('orders_desk') && orders && (
              <Panel
                title="Orders"
                description="What guests ordered and where it stands."
                actions={<Button variant="text" onClick={() => onNavigate('orders')}>Open <ChevronRight /></Button>}
              >
                <div className="data-list">
                  <div className="data-row">
                    <span>Waiting for an answer</span><strong>{orders.waiting}</strong>
                  </div>
                  <div className="data-row"><span>In progress</span><strong>{orders.inProgress}</strong></div>
                  <div className="data-row"><span>Ready for pickup</span><strong>{orders.ready}</strong></div>
                  {orders.oldestAt && (
                    <div className="data-row">
                      <span>Longest wait</span><strong>{elapsedLabel(orders.oldestAt, now)}</strong>
                    </div>
                  )}
                </div>
              </Panel>
            )}

            {can('reservations_desk') && bookings && (
              <Panel
                title="Reservations"
                description="Today’s visits and who arrives next."
                actions={<Button variant="text" onClick={() => onNavigate('reservations')}>Open <ChevronRight /></Button>}
              >
                {bookings.upcoming.length === 0 ? (
                  <EmptyState>
                    {bookings.today > 0 ? 'Every booking for today has already started.' : 'No bookings for today.'}
                  </EmptyState>
                ) : (
                  <div className="data-list">
                    {bookings.upcoming.map((visit) => (
                      <div className="data-row" key={visit.id}>
                        <span>
                          <strong>{timeLabel(visit.reserved_at, tz)}</strong> · {visit.customer_name || 'Guest'}
                        </span>
                        <span>
                          {visit.party_size} guests
                          {visit.status === 'new' && <small> · to confirm</small>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            )}

            {can('pos_operate') && fleet && (
              <Panel
                title="Devices"
                description="Registers connected to this organisation."
                actions={<Button variant="text" onClick={() => onNavigate('devices')}>Open <ChevronRight /></Button>}
              >
                <div className="data-list">
                  <div className="data-row">
                    <span><Wifi aria-hidden /> On line</span><strong>{fleet.online} of {fleet.total}</strong>
                  </div>
                  {fleet.worst && (
                    <div className="data-row">
                      <span>{fleet.worst.name || 'Register'}</span>
                      <StatusBadge
                        className="device-status"
                        tone={deviceStatus(fleet.worst)}
                        label={`${STATUS_LABEL[deviceStatus(fleet.worst)]} · ${lastSeenLabel(fleet.worst)}`}
                      />
                    </div>
                  )}
                  {fleet.problems === 0 && (
                    <div className="data-row"><span>Nothing needs a visit</span><strong>✓</strong></div>
                  )}
                </div>
              </Panel>
            )}

            {data?.channels && (
              <Panel
                title="Online channels"
                description="What your guests can do right now."
                actions={<Button variant="text" onClick={() => onNavigate('online')}>Open <ChevronRight /></Button>}
              >
                <div className="data-list">
                  {can('online_orders') && (
                    <div className="data-row">
                      <span><ShoppingBag aria-hidden /> Online ordering</span>
                      <StatusBadge
                        tone={data.channels.orders ? 'on' : 'off'}
                        label={data.channels.orders ? 'On' : 'Off'}
                      />
                    </div>
                  )}
                  {can('public_reservations') && (
                    <div className="data-row">
                      <span><CalendarDays aria-hidden /> Table booking</span>
                      <StatusBadge
                        tone={data.channels.reservations ? 'on' : 'off'}
                        label={data.channels.reservations ? 'On' : 'Off'}
                      />
                    </div>
                  )}
                  <div className="data-row">
                    <span><QrCode aria-hidden /> Guest page</span>
                    <a
                      className="text-button"
                      href={`${PUBLIC_MENU_ORIGIN}/order/${data.channels.slug || data.channels.locationId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open as guest
                    </a>
                  </div>
                </div>
              </Panel>
            )}

            {!can('pos_operate') && !can('orders_desk') && !can('reservations_desk') && (
              <Panel title="Devices" description="Registers connected to this organisation.">
                <EmptyState>
                  <MonitorSmartphone aria-hidden /> This workspace has no register — everything runs from here.
                </EmptyState>
              </Panel>
            )}
          </div>
        </>
      )}

      {/* Быстрые действия и карточка продуктов остаются под сводкой:
          они про настройку, а не про «что происходит сейчас». */}
      {children}
    </>
  )
}
