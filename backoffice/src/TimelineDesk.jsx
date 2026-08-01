import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import {
  blockState, buildRows, groupByZone, hourTicks, nowMarkerPct, occupancySummary,
  shiftDate, timelineWindow, todayInZone,
} from './timeline'
import {
  fetchReservationSettings, fetchTimelineReservations, fetchTimelineTables,
  markReservationArrived, setReservationTables, setReservationStatus, deskErrorText,
} from './reservations'
import { supabase } from './supabase'

/**
 * Таймлайн хостес в кабинете (Kassa 119/120): столы по вертикали, время
 * по горизонтали, визит — блок.
 *
 * Ради него и делалась связь `reservation_tables`: без кассы у владельца
 * не было ни одного экрана, отвечающего на вопрос «что с залом сейчас» —
 * standalone Reserve оставался списком заявок. Действия идут через
 * `_web`-RPC (120): право даёт членство, а не PIN.
 */

const HOUR_PX = 120
const LABEL_W = 128

const STATE_CLASS = {
  pending: 'is-pending',
  confirmed: 'is-confirmed',
  arrived: 'is-arrived',
  done: 'is-done',
  noshow: 'is-noshow',
}

const STATE_LABEL = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  arrived: 'Seated',
  done: 'Completed',
  noshow: 'No-show',
}

/** Время визита в зоне точки — и в подписи блока, и в карточке */
function timeInZone(ms, tz) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(ms))
  } catch {
    return ''
  }
}

/** Читаемое имя блока: гость, стол, время, состояние */
function blockLabel(block, table, tz) {
  const { booking } = block
  const parts = [
    booking.guestName,
    `${booking.partySize} guests`,
    `table ${table.label}`,
    `${timeInZone(booking.startMs, tz)}–${timeInZone(booking.endMs, tz)}`,
    STATE_LABEL[booking.state],
  ]
  if (block.combined) parts.push('combined tables')
  if (block.clipsStart) parts.push('started the day before')
  if (block.clipsEnd) parts.push('continues past this day')
  if (block.conflict) parts.push('overlaps another booking')
  return parts.join(' · ')
}

export default function TimelineDesk({ locationId }) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const [meta, setMeta] = useState({ timezone: 'Asia/Jerusalem', schedule: null })
  const [tables, setTables] = useState([])
  const [raw, setRaw] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState(null)
  const [zoneFilter, setZoneFilter] = useState(null)

  const tz = meta.timezone
  const todayStr = useMemo(() => todayInZone(nowMs, tz), [nowMs, tz])
  const [date, setDate] = useState(() => todayInZone(Date.now(), 'Asia/Jerusalem'))

  const baseWindow = useMemo(
    () => timelineWindow(date, tz, meta.schedule),
    [date, tz, meta.schedule]
  )

  // Ответ на устаревший запрос не должен переписать полотно: при быстрой
  // смене дат сеть возвращает их в произвольном порядке, и хостес увидел
  // бы вчерашние брони на сегодняшней дате.
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    if (!locationId) return
    const ticket = requestRef.current + 1
    requestRef.current = ticket
    try {
      const [settings, tbls, list] = await Promise.all([
        fetchReservationSettings(locationId),
        fetchTimelineTables(locationId),
        fetchTimelineReservations(locationId, baseWindow.startMs, baseWindow.endMs),
      ])
      if (requestRef.current !== ticket) return
      setMeta(settings)
      setTables(tbls)
      setRaw(list)
      setError('')
    } catch (e) {
      if (requestRef.current !== ticket) return
      setError(deskErrorText(e.message))
    }
  }, [locationId, baseWindow.startMs, baseWindow.endMs])

  useEffect(() => {
    setRaw(null)
    load()
    // Realtime: полотно обновляется на месте, прокрутку не трогаем —
    // контейнер не перемонтируется, поэтому хостес не теряет позицию.
    const channel = supabase
      .channel(`timeline-${locationId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'reservations', filter: `location_id=eq.${locationId}` },
        () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [locationId, load])

  const bookings = useMemo(() => (raw ?? []).map((r) => {
    const start = new Date(r.reserved_at).getTime()
    const linked = (r.tables_link ?? []).map((l) => l.table_id)
    return {
      id: r.id,
      tableIds: linked.length > 0
        ? linked
        : [r.table_id, ...(r.hold_table_ids ?? [])].filter(Boolean),
      startMs: start,
      endMs: start + (r.duration_min || 90) * 60_000,
      state: blockState(r.status, r.arrived_at, r.order_id),
      guestName: r.customer_name,
      partySize: r.party_size,
      posSeated: r.order_id != null,
    }
  }), [raw])

  const win = useMemo(
    () => timelineWindow(date, tz, meta.schedule, bookings),
    [date, tz, meta.schedule, bookings]
  )
  const rows = useMemo(() => buildRows(tables, bookings, win), [tables, bookings, win])
  const zones = useMemo(() => groupByZone(rows), [rows])
  const visibleZones = zoneFilter === null ? zones : zones.filter((z) => z.id === zoneFilter)
  const summary = useMemo(() => occupancySummary(rows, nowMs), [rows, nowMs])
  const ticks = useMemo(() => hourTicks(win, tz), [win, tz])
  const markerPct = date === todayStr ? nowMarkerPct(nowMs, win) : null
  const trackWidth = Math.max(720, ((win.endMs - win.startMs) / 3_600_000) * HOUR_PX)

  const scrollRef = useRef(null)
  const scrolledFor = useRef(null)
  useEffect(() => {
    if (scrolledFor.current === date || markerPct === null) return
    const el = scrollRef.current
    if (!el) return
    scrolledFor.current = date
    el.scrollLeft = Math.max(0, (markerPct / 100) * trackWidth - el.clientWidth / 3)
  }, [date, markerPct, trackWidth])

  async function act(fn) {
    setBusy(true)
    try {
      await fn()
      setDetail(null)
      await load()
      setError('')
    } catch (e) {
      setError(deskErrorText(e.message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel form-panel">
      <div className="panel-heading">
        <div>
          <h2>Floor timeline</h2>
          <p>Tables down the side, time across — one look tells you the next few hours.</p>
        </div>
        <button type="button" className="icon-button" aria-label="Refresh" onClick={load}>
          <RefreshCw />
        </button>
      </div>

      <div className="timeline-controls">
        <div className="timeline-daynav">
          <button type="button" className="secondary-button compact" aria-label="Previous day"
            onClick={() => setDate((d) => shiftDate(d, -1))}><ChevronLeft /></button>
          <button
            type="button"
            className={date === todayStr ? 'primary-button compact' : 'secondary-button compact'}
            onClick={() => setDate(todayStr)}
          >
            Today
          </button>
          <button type="button" className="secondary-button compact" aria-label="Next day"
            onClick={() => setDate((d) => shiftDate(d, 1))}><ChevronRight /></button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </div>

        {zones.length > 1 && (
          <div className="timeline-zones">
            <button
              type="button"
              className={zoneFilter === null ? 'primary-button compact' : 'secondary-button compact'}
              onClick={() => setZoneFilter(null)}
            >
              All zones
            </button>
            {zones.map((z) => (
              <button
                key={z.id ?? 'none'}
                type="button"
                className={zoneFilter === z.id ? 'primary-button compact' : 'secondary-button compact'}
                onClick={() => setZoneFilter(z.id)}
              >
                {z.name ?? 'No zone'}
              </button>
            ))}
          </div>
        )}

        <div className="timeline-summary">
          <span><small>Tables busy</small><strong>{summary.busyTables}/{summary.totalTables}</strong></span>
          <span><small>Seats free</small><strong>{summary.freeSeats}</strong></span>
          <span><small>Arriving within the hour</small><strong>{summary.soon}</strong></span>
          {summary.pending > 0 && (
            <span className="is-accent"><small>Pending</small><strong>{summary.pending}</strong></span>
          )}
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {raw === null ? (
        <p className="empty-state">Loading…</p>
      ) : tables.length === 0 ? (
        <p className="empty-state">
          No tables yet. Reserve needs a floor plan before the timeline can show anything.
        </p>
      ) : (
        <div className="timeline-scroll" ref={scrollRef}>
          <div style={{ width: LABEL_W + trackWidth }}>
            <div className="timeline-ruler">
              <div className="timeline-label" style={{ width: LABEL_W }} />
              <div className="timeline-track" style={{ width: trackWidth }}>
                {ticks.map((tick) => (
                  <span key={tick.ts} className="timeline-tick" style={{ left: `${tick.leftPct}%` }}>
                    {tick.label}
                  </span>
                ))}
              </div>
            </div>

            {visibleZones.map((zone) => (
              <div key={zone.id ?? 'none'}>
                {zones.length > 1 && (
                  <div className="timeline-zonerow">
                    <div className="timeline-label" style={{ width: LABEL_W }}>
                      {zone.name ?? 'No zone'}
                    </div>
                    <div style={{ width: trackWidth }} />
                  </div>
                )}
                {zone.rows.map((row) => (
                  <div key={row.table.id} className="timeline-row">
                    <div className="timeline-label" style={{ width: LABEL_W }}>
                      <strong>{row.table.label}</strong>
                      <small>{row.table.seats} seats</small>
                    </div>
                    <div
                      className={`timeline-track${row.table.blocked ? ' is-blocked' : ''}`}
                      style={{ width: trackWidth }}
                    >
                      {ticks.map((tick) => (
                        <span key={tick.ts} className="timeline-grid" style={{ left: `${tick.leftPct}%` }} />
                      ))}
                      {row.table.blocked && <span className="timeline-blocked">disabled</span>}
                      {markerPct !== null && (
                        <span className="timeline-now" style={{ left: `${markerPct}%` }} />
                      )}
                      {row.blocks.map((block) => (
                        <button
                          key={block.booking.id}
                          type="button"
                          className={`timeline-block ${STATE_CLASS[block.booking.state]}${
                            block.conflict ? ' is-conflict' : ''}${
                            block.clipsStart ? ' is-clip-start' : ''}${
                            block.clipsEnd ? ' is-clip-end' : ''}`}
                          style={{ left: `${block.leftPct}%`, width: `${block.widthPct}%` }}
                          onClick={() => setDetail(raw.find((r) => r.id === block.booking.id) ?? null)}
                          // Одинаковых блоков на экране десятки: без имени
                          // с гостем, столом и временем скринридер читает
                          // подряд «кнопка, кнопка, кнопка».
                          aria-label={blockLabel(block, row.table, tz)}
                          title={blockLabel(block, row.table, tz)}
                        >
                          <strong>{block.booking.guestName}</strong>
                          <small>
                            {block.booking.partySize}
                            {block.combined ? ' · combined' : ''}
                            {block.booking.state !== 'confirmed'
                              ? ` · ${STATE_LABEL[block.booking.state]}`
                              : ''}
                          </small>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {detail && (
        <BookingSheet
          reservation={detail}
          tables={tables}
          busy={busy}
          onClose={() => setDetail(null)}
          onConfirm={() => act(() => setReservationStatus(locationId, detail.id, 'confirmed'))}
          onArrived={() => act(() => markReservationArrived(locationId, detail.id))}
          onCompleted={() => act(() => setReservationStatus(locationId, detail.id, 'completed'))}
          onNoShow={() => act(() => setReservationStatus(locationId, detail.id, 'no_show'))}
          onTables={(ids) => act(() => setReservationTables(locationId, detail.id, ids))}
        />
      )}
    </section>
  )
}

/**
 * Карточка визита: контакты, состав и действия. Пикер столов —
 * множественный: объединение столов такое же обычное действие хостес,
 * как назначение одного.
 */
function BookingSheet({
  reservation, tables, busy, onClose, onConfirm, onArrived, onCompleted, onNoShow, onTables,
}) {
  const linked = (reservation.tables_link ?? []).map((l) => l.table_id)
  const initial = linked.length > 0
    ? linked
    : [reservation.table_id, ...(reservation.hold_table_ids ?? [])].filter(Boolean)
  const [picked, setPicked] = useState(initial)
  const seated = reservation.arrived_at != null || reservation.order_id != null
  const posSeated = reservation.order_id != null
  const active = reservation.status === 'new' || reservation.status === 'confirmed'

  const changed = picked.length !== initial.length
    || picked.some((id, i) => id !== initial[i])

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3>
          {reservation.customer_name}
          {/* Тестовая бронь (126): стол она держит настоящий, поэтому
              метка обязана быть видна там, где хостес принимает решение. */}
          {reservation.is_test && <span className="guest-fav is-warn"> Test</span>}
        </h3>
        <p className="sheet-sub">
          {new Date(reservation.reserved_at).toLocaleString([], {
            weekday: 'short', day: 'numeric', month: 'short',
            hour: '2-digit', minute: '2-digit',
          })}
          {' · '}{reservation.party_size} guests
          {' · '}{STATE_LABEL[blockState(reservation.status, reservation.arrived_at, reservation.order_id)]}
        </p>
        {reservation.customer_phone && (
          <p className="sheet-sub"><a href={`tel:${reservation.customer_phone}`}>{reservation.customer_phone}</a></p>
        )}
        {reservation.note && <p className="order-note">{reservation.note}</p>}

        {posSeated && (
          <p className="form-hint">
            Seated into a POS order — this visit is handled on the register.
          </p>
        )}

        {active && !posSeated && (
          <>
            <div className="sheet-section">
              <span className="sheet-section-title">Tables</span>
              <div className="timeline-tablepick">
                {tables.filter((t) => !t.blocked).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={picked.includes(t.id) ? 'primary-button compact' : 'secondary-button compact'}
                    onClick={() => setPicked((cur) => (
                      cur.includes(t.id) ? cur.filter((x) => x !== t.id) : [...cur, t.id]
                    ))}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {picked.length > 1 && (
                <p className="form-hint">
                  {picked.length} tables combined — the first one is where the register seats the guest.
                </p>
              )}
              <button
                type="button"
                className="secondary-button"
                disabled={busy || !changed}
                onClick={() => onTables(picked)}
              >
                Save tables
              </button>
            </div>

            <div className="order-actions">
              {reservation.status === 'new' && (
                <button type="button" className="primary-button compact" disabled={busy} onClick={onConfirm}>
                  Confirm
                </button>
              )}
              {reservation.status === 'confirmed' && !seated && (
                <button type="button" className="primary-button compact" disabled={busy} onClick={onArrived}>
                  Guest seated
                </button>
              )}
              {reservation.status === 'confirmed' && (
                <>
                  <button type="button" className="secondary-button" disabled={busy} onClick={onCompleted}>
                    Completed
                  </button>
                  <button type="button" className="secondary-button" disabled={busy} onClick={onNoShow}>
                    No-show
                  </button>
                </>
              )}
            </div>
          </>
        )}

        <button type="button" className="secondary-button" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
