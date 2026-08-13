import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Clock, Search, TrendingUp, Users, UserX } from 'lucide-react'
import {
  PERIODS, WEEKDAYS, MIN_SESSIONS_FOR_RATE,
  analyticsRange, defaultAnalyticsDates, fetchReserveAnalytics, analyticsErrorText,
  funnelView, pct, hours, leadTime,
  fetchRetention, returnRate, immature, newShare,
} from './reserve-analytics'
import Tabs from './ui/Tabs'

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


/**
 * Удержание (Kassa 159): возвращаются ли эти люди.
 *
 * Отчёт по броням отвечает «сколько пришло». Возврат — то, что
 * отличает заведение с базой от заведения с потоком, и до 159 его не
 * знал никто.
 *
 * Доля считается от СОЗРЕВШЕЙ базы, и число ещё не созревших названо
 * рядом: без него владелец увидит падение возврата там, где просто не
 * прошло время.
 */
function Retention({ data }) {
  if (!data) return null
  const rr = data.return_rate ?? {}
  const cohort = Number(rr.cohort_size) || 0
  const windows = [
    { key: 'd30', label: '30 days' },
    { key: 'd60', label: '60 days' },
    { key: 'd90', label: '90 days' },
  ]
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Retention</h2>
          <p>Do they come back · by visit date</p>
        </div>
      </div>
      <section className="stat-row">
        <Stat
          icon={Users}
          label="New guests"
          value={data.guests?.new ?? 0}
          sub={newShare(data.guests) === null
            ? 'no visits in this period'
            : `${pct(newShare(data.guests))} of everyone who came`}
        />
        <Stat
          icon={TrendingUp}
          label="Returning guests"
          value={data.guests?.returning ?? 0}
          sub="had been here before this period"
        />
        <Stat
          icon={UserX}
          label="No-shows"
          value={data.outcomes?.no_show ?? 0}
          sub={`of ${data.outcomes?.total ?? 0} bookings`}
        />
      </section>

      <div className="retention-windows">
        {windows.map(({ key, label }) => {
          const w = rr[key] ?? {}
          const rate = returnRate(w)
          const waiting = immature(cohort, w)
          return (
            <div key={key} className="retention-window">
              <span className="retention-label">Came back within {label}</span>
              {/* «Нет данных» и «никто не вернулся» — разные ответы */}
              <strong>{rate === null ? '—' : pct(rate)}</strong>
              <span className="cus-note-hint">
                {rate === null
                  ? 'nobody has lived through this window yet'
                  : `${w.returned} of ${w.mature} first-timers`}
                {waiting > 0 && ` · ${waiting} still have time`}
              </span>
            </div>
          )
        })}
      </div>

      {/* Деньги — только там, где есть касса. У standalone Reserve блока
          нет вовсе: ноль описывал бы гостей, а не отсутствие кассы. */}
      {data.money && (
        <p className="form-hint">
          Average check {Math.round((data.money.avg_check ?? 0) / 100)} ₪ ·{' '}
          {data.money.orders} paid orders in this period.
        </p>
      )}
    </section>
  )
}

/**
 * Воронка: ширина строки — доля от вершины, а не от предыдущего шага.
 * Числа и знаменатель считает `funnelView` — там же описан контракт.
 */
export function Funnel({ view }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Booking funnel</h2>
          <p>By the moment the guest acted · sessions that got at least this far</p>
        </div>
      </div>
      {view.top === 0 ? (
        <p className="empty-state">
          No guest sessions in this period yet.
        </p>
      ) : (
        <>
          <div className="funnel-list">
            {view.rows.map((row) => (
              <div className="funnel-row" key={row.key}>
                <span className="funnel-label">{row.label}</span>
                <span className="funnel-track">
                  <span className="funnel-fill" style={{ width: `${row.share}%` }} />
                </span>
                <span className="funnel-value">
                  {row.value}
                  <small>{row.rate === null ? '—' : `${row.rate}%`}</small>
                </span>
              </div>
            ))}
          </div>
          {!view.enough && (
            <p className="funnel-note">
              {view.top} session{view.top === 1 ? '' : 's'} in this period — too few
              to read as conversion. Shares appear from {MIN_SESSIONS_FOR_RATE} sessions
              on; until then the steps are shown as counts only.
            </p>
          )}
          {view.repaired && !view.exact && (
            <p className="funnel-note">
              Some sessions were first seen mid-way — for example a tab opened before
              this period, or a second booking started from a finished one. They are
              counted from the step they were seen at, so every step shares one
              cohort.
            </p>
          )}
        </>
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
  // Dates must be a usable period on the first tap, not two empty columns.
  // Lazy initialization also means the two fields share the same "today".
  const [custom, setCustom] = useState(() => defaultAnalyticsDates())
  // Пустой набор = все точки. Сетевой разрез (125): сервер всё равно
  // пересечёт выбор с точками организации, поэтому здесь он про удобство.
  const [picked, setPicked] = useState([])
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
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
  }, [ready, from, to, pickedKey]) // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * Удержание грузится ОТДЕЛЬНЫМ запросом и не блокирует отчёт: оно
   * считает когорты по всей истории организации и стоит дороже. Отчёт
   * по броням появляется сразу, удержание — следом.
   */
  const [retention, setRetention] = useState(null)
  useEffect(() => {
    if (!ready) return undefined
    let alive = true
    setRetention(null)
    fetchRetention(picked, from, to)
      .then((data) => { if (alive) setRetention(data) })
      .catch(() => { if (alive) setRetention(null) })
    return () => { alive = false }
  }, [ready, from, to, pickedKey]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleLocation(id) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const visits = report?.visits
  const bookings = report?.bookings
  const funnel = report?.funnel
  const occupancy = report?.occupancy
  const waitlist = report?.waitlist
  // Воронка и конверсия считаются из одной когорты: см. funnelView.
  const funnelRows = useMemo(() => funnelView(funnel), [funnel])

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
      <div className="rsv-view-intro">
        <div>
          <h2>Reservation performance</h2>
          <p>Demand, conversion and completed visits for the selected period.</p>
        </div>
      </div>
      <div className="overview-toolbar">
        {/* Последняя самодельная полоса вкладок в кабинете — на общий
            примитив: стрелки, Home/End и одна точка входа в группу. */}
        <Tabs
          className="period-switch"
          label="Reporting period"
          items={PERIODS.map((p) => ({ key: p.key, label: p.label }))}
          value={period}
          onChange={setPeriod}
        />
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
              value={pct(funnelRows.conversion)}
              sub={`${funnelRows.booked} of ${funnelRows.top} sessions`}
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

          <Funnel view={funnelRows} />

          <Retention data={retention} />

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
