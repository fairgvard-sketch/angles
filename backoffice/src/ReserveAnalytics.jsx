import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays, Clock, RefreshCw, Search, TrendingUp, Users, UserX,
} from 'lucide-react'
import {
  PERIODS, FUNNEL_STEPS, WEEKDAYS,
  analyticsRange, fetchReserveAnalytics, analyticsErrorText,
  pct, hours, leadTime,
} from './reserve-analytics'

/**
 * «Analytics» — отчёт по броням (Kassa 125).
 *
 * Экран отвечает на вопросы владельца в том порядке, в каком он их
 * задаёт: сколько броней и гостей → доходит ли кто-то до конца → полон
 * ли зал → откуда приходят → когда приходят → чего не хватило.
 *
 * Каждый блок подписан осью времени. Это не педантизм: «12 броней» за
 * неделю по моменту оформления и по моменту визита — разные числа, и
 * молча выдавать одно за другое нельзя.
 */

function Stat({ icon: Icon, label, value, sub }) {
  return (
    <div className="stat-card ov-stat">
      <div className="stat-icon"><Icon /></div>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
        {sub && <div className="stat-detail">{sub}</div>}
      </div>
    </div>
  )
}

/** Воронка: ширина строки — доля от вершины, а не от предыдущего шага. */
function Funnel({ funnel }) {
  const top = funnel?.page_view ?? 0
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Booking funnel</h2>
          <p>By the moment the guest acted · sessions, not clicks</p>
        </div>
      </div>
      {top === 0 ? (
        <p className="empty-state">
          No guest sessions in this period yet.
        </p>
      ) : (
        <div className="funnel-list">
          {FUNNEL_STEPS.map((step) => {
            const value = funnel[step.key] ?? 0
            const share = top > 0 ? Math.round((value / top) * 100) : 0
            return (
              <div className="funnel-row" key={step.key}>
                <span className="funnel-label">{step.label}</span>
                <span className="funnel-track">
                  <span className="funnel-fill" style={{ width: `${share}%` }} />
                </span>
                <span className="funnel-value">{value}<small>{share}%</small></span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

/** Простая полосовая колонка: подпись, полоса, число. */
function BarList({ title, hint, rows, empty }) {
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0)
  return (
    <section className="panel">
      <div className="panel-heading"><div><h2>{title}</h2>{hint && <p>{hint}</p>}</div></div>
      {rows.length === 0 ? (
        <p className="empty-state">{empty}</p>
      ) : (
        <div className="funnel-list">
          {rows.map((row) => (
            <div className="funnel-row" key={row.key}>
              <span className="funnel-label">{row.label}</span>
              <span className="funnel-track">
                <span
                  className="funnel-fill"
                  style={{ width: `${max > 0 ? Math.round((row.value / max) * 100) : 0}%` }}
                />
              </span>
              <span className="funnel-value">{row.value}{row.sub && <small>{row.sub}</small>}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default function ReserveAnalytics({ locations }) {
  const [period, setPeriod] = useState('30d')
  const [custom, setCustom] = useState({ from: '', to: '' })
  // Пустой набор = все точки. Сетевой разрез (125): сервер всё равно
  // пересечёт выбор с точками организации, поэтому здесь он про удобство.
  const [picked, setPicked] = useState([])
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Кнопка «обновить» меняет nonce: тот же период с тем же диапазоном
  // иначе не перезапросился бы — эффект не увидел бы разницы.
  const [nonce, setNonce] = useState(0)

  const ready = period !== 'custom' || (custom.from && custom.to)
  const { from, to } = useMemo(() => analyticsRange(period, custom), [period, custom])
  const pickedKey = picked.join(',')

  useEffect(() => {
    if (!ready) return undefined
    let alive = true
    setLoading(true)
    setError('')
    fetchReserveAnalytics(picked, from, to)
      .then((data) => { if (alive) setReport(data) })
      .catch((e) => { if (alive) setError(analyticsErrorText(e.message)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [ready, from, to, pickedKey, nonce]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleLocation(id) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const visits = report?.visits
  const bookings = report?.bookings
  const funnel = report?.funnel
  const occupancy = report?.occupancy
  const waitlist = report?.waitlist

  const sourceRows = (report?.by_source ?? []).map((s) => ({
    key: s.source,
    label: s.source === 'unknown' ? 'Not measured' : s.source,
    value: s.bookings,
    sub: s.sessions > 0 ? `of ${s.sessions} visits` : null,
  }))

  const weekdayRows = useMemo(() => {
    const byDow = new Map((report?.by_weekday ?? []).map((d) => [d.dow, d.bookings]))
    return WEEKDAYS.map((label, dow) => ({ key: label, label, value: byDow.get(dow) ?? 0 }))
  }, [report])

  const hourRows = (report?.by_hour ?? []).map((h) => ({
    key: h.hour,
    label: `${String(h.hour).padStart(2, '0')}:00`,
    value: h.bookings,
  }))

  const unmetRows = (report?.unmet ?? []).map((u) => ({
    key: `${u.date}-${u.party_size}`,
    label: `${new Date(`${u.date}T00:00:00`).toLocaleDateString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short',
    })} · ${u.party_size} guests`,
    value: u.requests,
  }))

  return (
    <>
      <div className="overview-toolbar">
        <div className="period-switch" role="tablist" aria-label="Reporting period">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              role="tab"
              aria-selected={period === p.key}
              className={period === p.key ? 'is-active' : ''}
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          className="icon-button"
          onClick={() => setNonce((n) => n + 1)}
          title="Refresh"
          disabled={loading}
        >
          <RefreshCw />
        </button>
      </div>

      {period === 'custom' && (
        <div className="date-range">
          <label><span>From</span>
            <input type="date" value={custom.from} max={custom.to || undefined}
              onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
          </label>
          <label><span>To</span>
            <input type="date" value={custom.to} min={custom.from || undefined}
              onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          </label>
        </div>
      )}

      {/* Сетевой разрез: появляется только там, где точек больше одной */}
      {locations.length > 1 && (
        <div className="timeline-zones" style={{ marginBottom: 16 }}>
          <button
            type="button"
            className={picked.length === 0 ? 'primary-button compact' : 'secondary-button compact'}
            onClick={() => setPicked([])}
          >
            All locations
          </button>
          {locations.map((l) => (
            <button
              key={l.id}
              type="button"
              className={picked.includes(l.id) ? 'primary-button compact' : 'secondary-button compact'}
              onClick={() => toggleLocation(l.id)}
            >
              {l.name}
            </button>
          ))}
        </div>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      {!ready ? (
        <p className="empty-state">Pick a start and end date.</p>
      ) : loading && !report ? (
        <p className="empty-state">Loading…</p>
      ) : report ? (
        <>
          <section className="ov-hero">
            <p className="ov-hero-label">Guests seated</p>
            <p className="ov-hero-value">{visits?.guests ?? 0}</p>
          </section>

          <section className="stats-grid ov-stats">
            <Stat
              icon={CalendarDays}
              label="Visits"
              value={visits?.total ?? 0}
              sub={`${visits?.completed ?? 0} completed · by visit date`}
            />
            <Stat
              icon={TrendingUp}
              label="Page to booking"
              value={pct(funnel?.conversion)}
              sub={`${funnel?.submitted ?? 0} of ${funnel?.page_view ?? 0} sessions`}
            />
            <Stat
              icon={Users}
              label="Room occupancy"
              value={pct(occupancy?.pct)}
              sub={`${hours(occupancy?.seat_hours_booked)} of ${hours(occupancy?.seat_hours_available)} seat-hours`}
            />
            <Stat
              icon={UserX}
              label="No-shows"
              value={pct(visits?.no_show_rate)}
              sub={`${visits?.no_show ?? 0} missed · ${visits?.cancelled ?? 0} cancelled`}
            />
            <Stat
              icon={Clock}
              label="Booked ahead"
              value={leadTime(bookings?.avg_lead_min)}
              sub={`avg party ${bookings?.avg_party ?? '—'}`}
            />
            <Stat
              icon={Search}
              label="Waitlist converted"
              value={pct(waitlist?.conversion)}
              sub={`${waitlist?.converted ?? 0} of ${waitlist?.entries ?? 0} entries`}
            />
          </section>

          <Funnel funnel={funnel ?? {}} />

          <div className="overview-columns">
            <BarList
              title="Where guests come from"
              hint="Bookings by channel · by booking date"
              rows={sourceRows}
              empty="No bookings in this period."
            />
            <BarList
              title="Busiest days"
              hint="Visits by weekday"
              rows={weekdayRows}
              empty="No visits in this period."
            />
          </div>

          <div className="overview-columns">
            <BarList
              title="Busiest hours"
              hint="Visits by start time"
              rows={hourRows}
              empty="No visits in this period."
            />
            <BarList
              title="Demand you turned away"
              hint="Guests who searched and found nothing free"
              rows={unmetRows}
              empty="Every search found a free table."
            />
          </div>

          {report.by_location?.length > 1 && (
            <BarList
              title="By location"
              hint="Visits across the network"
              rows={report.by_location.map((l) => ({
                key: l.location_id,
                label: l.name,
                value: l.bookings,
                sub: `${l.guests} guests`,
              }))}
              empty="No visits in this period."
            />
          )}

          <p className="updated-at">
            {bookings?.total ?? 0} bookings made in this period ·
            {' '}{bookings?.instant ?? 0} confirmed instantly,
            {' '}{bookings?.manual ?? 0} by hand
          </p>
        </>
      ) : null}
    </>
  )
}
