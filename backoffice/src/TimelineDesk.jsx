import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import {
  blockState, buildRows, groupByZone, hourTicks, nowMarkerPct, occupancySummary,
  shiftDate, timelineWindow, todayInZone,
} from './timeline'
import {
  fetchReservationSettings, fetchTimelineReservations, fetchTimelineTables,
  markReservationArrived, setReservationTables, setReservationStatus, deskErrorText,
  updateReservation, updateReservationGuest, toLocalInput, fromLocalInput,
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

const HOUR_PX = 96

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
  // Отключённые столы не являются частью текущей работы хостес. Раньше
  // они занимали целые пустые строки и создавали впечатление, что зал
  // больше и свободнее, чем он есть. Строку сохраняем только если на
  // таком столе осталась бронь выбранного дня — её нельзя потерять.
  const operationalRows = useMemo(
    () => rows.filter((row) => !row.table.blocked || row.blocks.length > 0),
    [rows]
  )
  const hiddenTableCount = rows.length - operationalRows.length
  const zones = useMemo(() => groupByZone(operationalRows), [operationalRows])
  const visibleZones = zoneFilter === null ? zones : zones.filter((z) => z.id === zoneFilter)
  const summary = useMemo(() => occupancySummary(operationalRows, nowMs), [operationalRows, nowMs])
  const ticks = useMemo(() => hourTicks(win, tz), [win, tz])
  const markerPct = date === todayStr ? nowMarkerPct(nowMs, win) : null
  const trackWidth = Math.max(720, ((win.endMs - win.startMs) / 3_600_000) * HOUR_PX)

  const scrollRef = useRef(null)
  const scrolledFor = useRef(null)
  const scrollToCurrent = useCallback((smooth = true) => {
    const el = scrollRef.current
    if (!el || markerPct === null) return
    el.scrollTo({
      left: Math.max(0, (markerPct / 100) * trackWidth - el.clientWidth / 3),
      behavior: smooth ? 'smooth' : 'auto',
    })
  }, [markerPct, trackWidth])

  useEffect(() => {
    if (scrolledFor.current === date || markerPct === null) return
    scrolledFor.current = date
    scrollToCurrent(false)
  }, [date, markerPct, scrollToCurrent])

  useEffect(() => {
    if (zoneFilter !== null && !zones.some((zone) => zone.id === zoneFilter)) {
      setZoneFilter(null)
    }
  }, [zoneFilter, zones])

  function panTimeline(direction) {
    scrollRef.current?.scrollBy({
      left: direction * Math.max(240, scrollRef.current.clientWidth * 0.72),
      behavior: 'smooth',
    })
  }

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
    <section className="panel form-panel timeline-panel">
      <div className="panel-heading">
        <div>
          <h2>Table availability</h2>
          <p>Each row is a table. Move through the day horizontally and select a booking for details.</p>
        </div>
        <button type="button" className="icon-button" aria-label="Refresh" onClick={load}>
          <RefreshCw />
        </button>
      </div>

      <div className="timeline-controls">
        <div className="timeline-filter-group">
          <span className="timeline-control-label">Date</span>
          <div className="timeline-daynav">
            <button type="button" className="secondary-button compact timeline-arrow" aria-label="Previous day"
              onClick={() => setDate((d) => shiftDate(d, -1))}><ChevronLeft /></button>
            <input aria-label="Timeline date" type="date" value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)} />
            <button type="button" className="secondary-button compact timeline-arrow" aria-label="Next day"
              onClick={() => setDate((d) => shiftDate(d, 1))}><ChevronRight /></button>
            <button
              type="button"
              className={`timeline-filter-button${date === todayStr ? ' is-active' : ''}`}
              onClick={() => setDate(todayStr)}
            >
              Today
            </button>
          </div>
        </div>

        {zones.length > 1 && (
          <div className="timeline-filter-group timeline-zone-filter">
            <span className="timeline-control-label">Zone</span>
            <div className="timeline-zones">
              <button
                type="button"
                className={`timeline-filter-button${zoneFilter === null ? ' is-active' : ''}`}
                onClick={() => setZoneFilter(null)}
              >
                All
              </button>
              {zones.map((z) => (
                <button
                  key={z.id ?? 'none'}
                  type="button"
                  className={`timeline-filter-button${zoneFilter === z.id ? ' is-active' : ''}`}
                  onClick={() => setZoneFilter(z.id)}
                >
                  {z.name ?? 'No zone'}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="timeline-summary">
          <span><small>Busy now</small><strong>{summary.busyTables}/{summary.totalTables}</strong></span>
          <span><small>Seats free</small><strong>{summary.freeSeats}</strong></span>
          <span><small>Next hour</small><strong>{summary.soon}</strong></span>
          {summary.pending > 0 && (
            <span className="is-accent"><small>Pending</small><strong>{summary.pending}</strong></span>
          )}
        </div>
      </div>

      <div className="timeline-guide">
        <div className="timeline-legend" aria-label="Booking statuses">
          <span><i className="is-pending" />Pending</span>
          <span><i className="is-confirmed" />Confirmed</span>
          <span><i className="is-arrived" />Seated</span>
          <span><i className="is-done" />Completed</span>
        </div>
        <div className="timeline-pan" aria-label="Move through timeline">
          <button type="button" className="text-button" onClick={() => panTimeline(-1)}>
            <ChevronLeft /> Earlier
          </button>
          {markerPct !== null && (
            <button type="button" className="text-button" onClick={() => scrollToCurrent()}>
              Now
            </button>
          )}
          <button type="button" className="text-button" onClick={() => panTimeline(1)}>
            Later <ChevronRight />
          </button>
        </div>
      </div>

      {hiddenTableCount > 0 && (
        <p className="timeline-hidden-note">
          {hiddenTableCount} out-of-service table{hiddenTableCount === 1 ? '' : 's'} hidden from this operational view.
        </p>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      {raw === null ? (
        <p className="empty-state">Loading…</p>
      ) : tables.length === 0 ? (
        <p className="empty-state">
          No tables yet. Reserve needs a floor plan before the timeline can show anything.
        </p>
      ) : (
        <div className="timeline-scroll" ref={scrollRef}>
          <div
            className="timeline-canvas"
            style={{ '--timeline-track-width': `${trackWidth}px` }}
          >
            <div className="timeline-ruler">
              <div className="timeline-label" />
              <div className="timeline-track">
                {ticks.map((tick) => (
                  <span key={tick.ts} className="timeline-tick" style={{ left: `${tick.leftPct}%` }}>
                    {tick.label}
                  </span>
                ))}
                {markerPct !== null && (
                  <span className="timeline-now-label" style={{ left: `${markerPct}%` }}>Now</span>
                )}
              </div>
            </div>

            {visibleZones.map((zone) => (
              <div key={zone.id ?? 'none'}>
                {zones.length > 1 && (
                  <div className="timeline-zonerow">
                    <div className="timeline-label">
                      {zone.name ?? 'No zone'}
                    </div>
                    <div className="timeline-track-spacer" />
                  </div>
                )}
                {zone.rows.map((row) => (
                  <div key={row.table.id} className="timeline-row">
                    <div className="timeline-label">
                      <strong>{row.table.label}</strong>
                      <small>{row.table.seats} seats</small>
                    </div>
                    <div
                      className={`timeline-track${row.table.blocked ? ' is-blocked' : ''}`}
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
          tz={tz}
          busy={busy}
          onClose={() => setDetail(null)}
          onEdit={(patch) => act(async () => {
            // Контакты и «когда/сколько» — разные функции сервера: у
            // второй пересчёт занятости, у первой его не нужно.
            if (patch.name != null || patch.phone != null) {
              await updateReservationGuest(locationId, detail.id, patch)
            }
            if (patch.at != null || patch.partySize != null || patch.note != null) {
              await updateReservation(locationId, detail.id, patch)
            }
          })}
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
  reservation, tables, tz, busy, onClose, onConfirm, onArrived, onCompleted,
  onNoShow, onTables, onEdit,
}) {
  const linked = (reservation.tables_link ?? []).map((l) => l.table_id)
  const initial = linked.length > 0
    ? linked
    : [reservation.table_id, ...(reservation.hold_table_ids ?? [])].filter(Boolean)
  const [picked, setPicked] = useState(initial)
  const seated = reservation.arrived_at != null || reservation.order_id != null
  const posSeated = reservation.order_id != null
  const active = reservation.status === 'new' || reservation.status === 'confirmed'

  // Правка визита открывается по кнопке: обычно карточку открывают,
  // чтобы посадить гостя, а не переписать его данные.
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(() => ({
    name: reservation.customer_name ?? '',
    phone: reservation.customer_phone ?? '',
    party: reservation.party_size ?? 2,
    at: toLocalInput(new Date(reservation.reserved_at).getTime(), tz),
    note: reservation.note ?? '',
  }))

  const changed = picked.length !== initial.length
    || picked.some((id, i) => id !== initial[i])

  function saveEdit() {
    const at = fromLocalInput(form.at, tz)
    onEdit({
      name: form.name.trim() !== reservation.customer_name ? form.name.trim() : null,
      phone: form.phone.trim() !== (reservation.customer_phone ?? '') ? form.phone.trim() : null,
      partySize: Number(form.party) !== reservation.party_size ? Number(form.party) : null,
      at: at && at !== new Date(reservation.reserved_at).toISOString() ? at : null,
      note: form.note.trim() !== (reservation.note ?? '') ? form.note.trim() : null,
    })
  }

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

        {active && !posSeated && !editing && (
          <button type="button" className="secondary-button" onClick={() => setEditing(true)}>
            Edit booking
          </button>
        )}

        {active && !posSeated && editing && (
          <div className="sheet-section">
            <span className="sheet-section-title">Edit booking</span>
            <div className="qr-grid">
              <label className="qr-field">
                <span>Guest name</span>
                <input value={form.name} maxLength={120}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </label>
              <label className="qr-field">
                <span>Phone</span>
                <input type="tel" value={form.phone} maxLength={20}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </label>
              <label className="qr-field">
                <span>Guests</span>
                <input type="number" min={1} max={50} value={form.party}
                  onChange={(e) => setForm((f) => ({ ...f, party: e.target.value }))} />
              </label>
              <label className="qr-field">
                <span>Date and time</span>
                <input type="datetime-local" value={form.at}
                  onChange={(e) => setForm((f) => ({ ...f, at: e.target.value }))} />
              </label>
            </div>
            <label className="qr-field">
              <span>Note</span>
              <input value={form.note} maxLength={200}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
            </label>
            {/* Время и компанию перепроверяет сервер: занятость решает он,
                иначе перенос тихо создал бы двойную посадку. */}
            <p className="form-hint">
              Moving the visit or growing the party is re-checked against the
              floor — a clash comes back as an error, not a double booking.
            </p>
            <div className="order-actions">
              <button type="button" className="secondary-button" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button type="button" className="primary-button compact" disabled={busy} onClick={saveEdit}>
                {busy ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
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
