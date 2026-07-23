import { useEffect, useState } from 'react'
import { Activity, RefreshCw, LogIn, LogOut, RotateCcw } from 'lucide-react'
import {
  fetchActivity, TYPE_META, eventTitle, eventAmount, eventDetail, timeAgo,
} from './activity'

/**
 * «Activity» — лента событий кассы (открытие/закрытие смены, возврат) из
 * get_activity_feed (098). Компактная версия (ActivityList) переиспользуется
 * на Home, полный раздел добавляет фильтр по типу и подгрузку старых.
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
                {e.location_name || 'No location'}
                {detail ? ` · ${detail}` : ''}
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

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'shift_opened', label: 'Opened' },
  { key: 'shift_closed', label: 'Closed' },
  { key: 'refund_issued', label: 'Refunds' },
]

const PAGE = 50

export default function ActivityManager({ context }) {
  const [events, setEvents] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')
  const [done, setDone] = useState(false)

  async function load(reset = true) {
    if (reset) { setLoading(true); setDone(false) }
    setError('')
    try {
      const before = reset || !events?.length ? null : events[events.length - 1].created_at
      const batch = await fetchActivity({ limit: PAGE, before })
      setEvents((prev) => (reset ? batch : [...(prev || []), ...batch]))
      if (batch.length < PAGE) setDone(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Фильтр по типу — на клиенте (лента компактная); при желании можно унести в RPC
  const shown = (events || []).filter((e) => filter === 'all' || e.type === filter)

  return (
    <>
      <section className="page-heading compact-heading">
        <p className="eyebrow">{context.organization?.name}</p>
        <h1>Activity</h1>
        <p>Shifts opened and closed, and refunds issued on your registers.</p>
      </section>

      <div className="overview-toolbar">
        <div className="period-switch" role="tablist" aria-label="Activity filter">
          {FILTERS.map((f) => (
            <button key={f.key} role="tab" aria-selected={filter === f.key}
              className={filter === f.key ? 'is-active' : ''} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <button className="icon-button" onClick={() => load(true)} title="Refresh" disabled={loading}><RefreshCw /></button>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {loading && !events ? (
        <p className="empty-state">Loading…</p>
      ) : (
        <section className="panel">
          <ActivityList events={shown} />
          {!done && events && events.length > 0 && (
            <div className="activity-more">
              <button className="secondary-button" onClick={() => load(false)} disabled={loading}>
                {loading ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </section>
      )}
    </>
  )
}
