import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, Download, RefreshCw, LogIn, LogOut, RotateCcw, Search } from 'lucide-react'
import {
  fetchActivity, TYPE_META, eventTitle, eventAmount, eventDetail, timeAgo,
  ACTIVITY_TYPES, activityToCsv, activityFileName,
} from './activity'
import { PageHeader } from './ui/Layout'

/**
 * «Activity» — журнал событий кассы (открытие/закрытие смены, возврат) из
 * get_activity_feed (098, фильтры 133). Компактная лента (ActivityList)
 * переиспользуется на Home; полный раздел — рабочий журнал: диапазон,
 * тип, точка, поиск и выгрузка. Все фильтры считает сервер.
 *
 * Новых типов событий здесь не выдумано: показывается ровно то, что
 * пишут триггеры БД.
 */

const TYPE_ICON = {
  shift_opened: LogIn,
  shift_closed: LogOut,
  refund_issued: RotateCcw,
}

/** Список строк ленты — общий для Home и полного раздела */
export function ActivityList({ events }) {
  if (events.length === 0) return <p className="empty-state">No activity yet.</p>
  return (
    <div className="activity-list">
      {events.map((e) => {
        const meta = TYPE_META[e.type] || { tone: 'open' }
        const Icon = TYPE_ICON[e.type] || Activity
        const amount = eventAmount(e)
        const detail = eventDetail(e)
        return (
          <div className="activity-row" key={e.id}>
            <span className={`activity-mark is-${meta.tone}`}><Icon /></span>
            <div className="activity-body">
              <strong>{eventTitle(e)}</strong>
              <small>
                {[e.location_name || 'No location', e.device_name, detail]
                  .filter(Boolean).join(' · ')}
              </small>
            </div>
            <div className="activity-meta">
              {amount && <span className={`activity-amount is-${meta.tone}`}>{amount}</span>}
              <span className="activity-time">{timeAgo(e.created_at)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Компактная лента для Home: последние N, кнопка «View all» ведёт в раздел */
export function ActivityCard({ onNavigate }) {
  const [events, setEvents] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    fetchActivity({ limit: 6 })
      .then((d) => alive && setEvents(d))
      .catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [])

  return (
    <section className="panel activity-panel">
      <div className="panel-heading">
        <div><h2>Recent activity</h2><p>Shifts and refunds across your registers.</p></div>
        <button className="text-button" onClick={() => onNavigate('activity')}>View all</button>
      </div>
      {error ? <p className="empty-state">{error}</p>
        : events === null ? <p className="empty-state">Loading…</p>
        : <ActivityList events={events} />}
    </section>
  )
}

const PAGE = 50

/** Окно журнала. «Всё» — без границ, keyset-пагинация уводит вглубь. */
const RANGES = [
  { key: 'all', label: 'All time' },
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: 'month', label: 'This month' },
]

function rangeBounds(key) {
  if (key === 'all') return { from: null, to: null }
  const now = new Date()
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  if (key === '7d') start.setDate(start.getDate() - 6)
  if (key === 'month') start.setDate(1)
  return { from: start, to: null }
}

export default function ActivityManager({ context }) {
  const [events, setEvents] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [types, setTypes] = useState([])
  const [range, setRange] = useState('all')
  const [locationId, setLocationId] = useState('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [done, setDone] = useState(false)

  const locations = context?.locations ?? []
  const timeZone = locations[0]?.timezone || 'Asia/Jerusalem'

  // Поиск идёт на сервер — не дёргаем его на каждую букву
  useEffect(() => {
    const id = setTimeout(() => setQuery(search), 300)
    return () => clearTimeout(id)
  }, [search])

  const filters = useMemo(() => {
    const { from, to } = rangeBounds(range)
    return { from, to, types, locationId, search: query }
  }, [range, types, locationId, query])

  const load = useCallback(async (reset = true, tail = null) => {
    if (reset) { setLoading(true); setDone(false) }
    setError('')
    try {
      const batch = await fetchActivity({ ...filters, limit: PAGE, before: tail })
      setEvents((prev) => (reset ? batch : [...(prev || []), ...batch]))
      if (batch.length < PAGE) setDone(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => { load(true) }, [load])

  function exportCsv() {
    const csv = activityToCsv(events ?? [], { timeZone })
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = activityFileName()
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const total = events?.length ?? 0
  const filtered = types.length > 0 || range !== 'all' || locationId !== '' || query.trim() !== ''

  return (
    <>
      <PageHeader
        eyebrow={context.organization?.name}
        title="Activity"
        description="Shifts opened and closed, and refunds issued on your registers."
      />

      <div className="overview-toolbar">
        <label className="guest-search">
          <Search aria-hidden />
          <span className="visually-hidden">Search activity</span>
          <input
            type="search"
            placeholder="Staff, reason or device"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>

        <label className="guest-sort">
          <span className="visually-hidden">Time range</span>
          <select value={range} onChange={(e) => setRange(e.target.value)}>
            {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </label>

        {locations.length > 1 && (
          <label className="guest-sort">
            <span className="visually-hidden">Location</span>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">All locations</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
        )}

        <button
          type="button"
          className="secondary-button"
          disabled={!total}
          onClick={exportCsv}
          title="Download exactly what is on screen"
        >
          <Download aria-hidden /> Export CSV
        </button>
        <button className="icon-button" onClick={() => load(true)} aria-label="Refresh activity" disabled={loading}><RefreshCw /></button>
      </div>

      {/* Тип события — множественный выбор, и отбирает его СЕРВЕР:
          прежний фильтр отвечал на вопрос «что было среди последних
          пятидесяти», а не «что было». */}
      <div className="segment-bar" role="group" aria-label="Event types">
        <button
          type="button"
          className={`segment-chip${types.length === 0 ? ' is-selected' : ''}`}
          aria-pressed={types.length === 0}
          onClick={() => setTypes([])}
        >
          All events
        </button>
        {ACTIVITY_TYPES.map((t) => (
          <button
            type="button"
            key={t.key}
            className={`segment-chip${types.includes(t.key) ? ' is-selected' : ''}`}
            aria-pressed={types.includes(t.key)}
            onClick={() => setTypes((prev) => (
              prev.includes(t.key) ? prev.filter((x) => x !== t.key) : [...prev, t.key]
            ))}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {loading && !events ? (
        <p className="empty-state">Loading…</p>
      ) : (
        <section className="panel">
          {total === 0 ? (
            <p className="empty-state">
              {filtered
                ? 'No events match these filters.'
                : 'No activity yet. Shifts and refunds from your registers appear here.'}
            </p>
          ) : (
            <ActivityList events={events} />
          )}
          {!done && total > 0 && (
            <div className="activity-more">
              <button
                className="secondary-button"
                onClick={() => load(false, events[events.length - 1].created_at)}
                disabled={loading}
              >
                {loading ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </section>
      )}
    </>
  )
}
