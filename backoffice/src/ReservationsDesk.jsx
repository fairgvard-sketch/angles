import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarDays, Phone, RefreshCw, StickyNote, Users } from 'lucide-react'
import { supabase } from './supabase'
import {
  RESERVATION_STATUS_LABELS, RESERVATION_ACTIONS,
  fetchReservations, setReservationStatus, visitLabel,
} from './reservations'
import { playNewOrderChime } from './orders'
import TimelineDesk from './TimelineDesk'
import WaitlistPanel from './WaitlistPanel'
import FloorPlanEditor from './FloorPlanEditor'

/**
 * «Reservations» — веб-стол хостес (Kassa 102): подтверждение, отказ,
 * завершение визита и no-show без POS-устройства и PIN. Посаженные на
 * кассе брони (order_id) показываются read-only — их визит живёт в
 * POS-заказе (seat_reservation 057), веб его не трогает.
 *
 * Новые заявки приходят realtime-подпиской (публикация 053) со звуком;
 * страховка — поллинг раз в 60 секунд.
 *
 * Вид «Floor plan» (123) стоит здесь же, а не в настройках: пустой
 * таймлайн чинится столами, и путь от проблемы к её причине должен быть
 * в один тап, без похода в другой раздел.
 */

const VIEWS = [
  { key: 'timeline', label: 'Timeline' },
  { key: 'list', label: 'List' },
  { key: 'waitlist', label: 'Waitlist' },
  { key: 'floor', label: 'Floor plan' },
]

function ReservationCard({ reservation, busyAction, onAction }) {
  const seated = reservation.order_id != null
  const actions = seated ? [] : (RESERVATION_ACTIONS[reservation.status] ?? [])
  return (
    <article className={`order-card is-${reservation.status}`}>
      <header className="order-card-head">
        <div>
          <strong>{reservation.customer_name}</strong>
          <small>
            <CalendarDays /> {visitLabel(reservation.reserved_at)}
            {' · '}<Users /> {reservation.party_size}
            {reservation.customer_phone && <> · <Phone /> {reservation.customer_phone}</>}
          </small>
        </div>
        <span className={`order-status is-${reservation.status === 'confirmed' ? 'ready' : reservation.status}`}>
          {seated ? 'Seated (POS)' : RESERVATION_STATUS_LABELS[reservation.status] ?? reservation.status}
        </span>
      </header>
      {reservation.note && <p className="order-note"><StickyNote /> {reservation.note}</p>}
      {reservation.reject_reason && <p className="order-note">{reservation.reject_reason}</p>}
      {actions.length > 0 && (
        <footer className="order-card-foot">
          <span />
          <div className="order-actions">
            {actions.map((action) => (
              <button
                key={action.to}
                type="button"
                className={action.tone === 'primary' ? 'primary-button compact' : 'secondary-button'}
                disabled={busyAction != null}
                data-danger={action.tone === 'danger' || undefined}
                onClick={() => onAction(reservation, action.to)}
              >
                {busyAction === action.to ? '…' : action.label}
              </button>
            ))}
          </div>
        </footer>
      )}
    </article>
  )
}

export default function ReservationsDesk({ context }) {
  const locations = context.locations || []
  const [locationId, setLocationId] = useState(locations[0]?.id || '')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null) // { id, to }
  // Таймлайн — вид по умолчанию: владелец открывает раздел, чтобы увидеть
  // зал. Списки заявок остаются вторым видом, а не удаляются.
  const [view, setView] = useState('timeline')
  const knownIds = useRef(new Set())

  const refresh = useCallback(async (withSound = false) => {
    if (!locationId) return
    try {
      const next = await fetchReservations(locationId)
      setError('')
      setData(next)
      const ids = new Set(next.active.map((r) => r.id))
      if (withSound) {
        const hasFresh = next.active.some(
          (r) => r.status === 'new' && !knownIds.current.has(r.id)
        )
        if (hasFresh) playNewOrderChime()
      }
      knownIds.current = ids
    } catch (e) {
      setError(e.message)
    }
  }, [locationId])

  useEffect(() => {
    if (!locationId) return undefined
    setData(null)
    knownIds.current = new Set()
    refresh()
    const channel = supabase
      .channel(`reservations-${locationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reservations', filter: `location_id=eq.${locationId}` },
        () => refresh(true)
      )
      .subscribe()
    const timer = setInterval(() => refresh(true), 60000)
    return () => {
      supabase.removeChannel(channel)
      clearInterval(timer)
    }
  }, [locationId, refresh])

  async function act(reservation, to) {
    setBusy({ id: reservation.id, to })
    try {
      // Пустая причина допустима; отмена диалога не отменяет действие.
      const reason = (to === 'rejected' || to === 'cancelled')
        ? (window.prompt('Reason (shown to the guest, optional):') || null)
        : null
      await setReservationStatus(locationId, reservation.id, to, reason)
      await refresh()
    } catch (e) {
      setError(e.message === 'pos_mode'
        ? 'This booking is seated into a POS order — it is handled on the register.'
        : e.message)
    } finally {
      setBusy(null)
    }
  }

  const active = data?.active ?? []
  const pending = active.filter((r) => r.status === 'new')
  const confirmed = active.filter((r) => r.status !== 'new')
  const history = data?.history ?? []

  return (
    <>
      <section className="page-heading compact-heading">
        <p className="eyebrow">{context.organization?.name}</p>
        <h1>Reservations</h1>
        <p>Booking requests and today’s visits — confirm, complete or mark no-shows.</p>
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

      <div className="timeline-zones" style={{ marginBottom: 16 }}>
        {VIEWS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={view === key ? 'primary-button compact' : 'secondary-button compact'}
            onClick={() => setView(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {view === 'timeline' && locationId && <TimelineDesk locationId={locationId} />}
      {view === 'waitlist' && locationId && <WaitlistPanel locationId={locationId} />}
      {view === 'floor' && locationId && <FloorPlanEditor locationId={locationId} />}

      {view === 'list' && (
      <section className="panel form-panel">
        <div className="panel-heading">
          <div>
            <h2>Requests</h2>
            <p>New booking requests appear instantly with a chime.</p>
          </div>
          <button type="button" className="icon-button" aria-label="Refresh" onClick={() => refresh()}>
            <RefreshCw />
          </button>
        </div>
        {data === null ? (
          <p className="empty-state">Loading…</p>
        ) : pending.length === 0 ? (
          <p className="empty-state">No pending requests.</p>
        ) : (
          <div className="order-grid">
            {pending.map((reservation) => (
              <ReservationCard
                key={reservation.id}
                reservation={reservation}
                busyAction={busy?.id === reservation.id ? busy.to : null}
                onAction={act}
              />
            ))}
          </div>
        )}
      </section>
      )}

      {view === 'list' && (
      <section className="panel form-panel">
        <div className="panel-heading">
          <div><h2>Upcoming & today</h2><p>Confirmed visits from today onwards.</p></div>
        </div>
        {data === null ? (
          <p className="empty-state">Loading…</p>
        ) : confirmed.length === 0 ? (
          <p className="empty-state">No confirmed visits yet.</p>
        ) : (
          <div className="order-grid">
            {confirmed.map((reservation) => (
              <ReservationCard
                key={reservation.id}
                reservation={reservation}
                busyAction={busy?.id === reservation.id ? busy.to : null}
                onAction={act}
              />
            ))}
          </div>
        )}
      </section>
      )}

      {view === 'list' && history.length > 0 && (
        <section className="panel form-panel">
          <div className="panel-heading">
            <div><h2>Recent history</h2><p>Completed, no-show, rejected and cancelled bookings.</p></div>
          </div>
          <div className="order-grid is-history">
            {history.map((reservation) => (
              <ReservationCard key={reservation.id} reservation={reservation} busyAction={null} onAction={() => {}} />
            ))}
          </div>
        </section>
      )}
    </>
  )
}
