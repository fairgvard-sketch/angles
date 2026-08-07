import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, Download, RefreshCw, LogIn, LogOut, RotateCcw } from 'lucide-react'
import {
  fetchActivity, TYPE_META, eventTitle, eventAmount, eventDetail, timeAgo,
  ACTIVITY_TYPES, activityToCsv, activityFileName, activityDays, activityTime,
} from './activity'
import { ErrorText, PageHeader, SearchField } from './ui/Layout'
import { Button, IconButton } from './ui/Button'
import Skeleton, { SkeletonBar, SkeletonPanel, SkeletonRow } from './ui/Skeleton'

/**
 * «Activity» — журнал событий кассы (открытие/закрытие смены, возврат) из
 * get_activity_feed (098, фильтры 133). Компактная лента (ActivityList)
 * переиспользуется на Home; полный раздел — рабочий журнал: диапазон,
 * тип, точка, поиск и выгрузка. Все фильтры считает сервер.
 *
 * Новых типов событий здесь не выдумано: показывается ровно то, что
 * пишут триггеры БД.
 *
 * Редизайн по `docs/claude-activity-approved-redesign-plan.md`: лента
 * стала журналом с заголовками дней и точным временем. День — это
 * рабочий вопрос («что было вчера»), а «4d» на него не отвечает; дни
 * считаются в часах точки, той же зоне, которой подписана выгрузка.
 * Группировка — только оформление: отбор, порядок и keyset-пагинация
 * остались серверными и нетронутыми.
 *
 * Компактная карточка на Home намеренно оставлена прежней — там у ленты
 * другая работа (последние шесть событий), и относительное время в ней
 * уместнее точного.
 */

const TYPE_ICON = {
  shift_opened: LogIn,
  shift_closed: LogOut,
  refund_issued: RotateCcw,
}

/** Компактная лента Home: шесть последних событий и относительное время */
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

/**
 * Компактная лента для Home: последние N, кнопка «View all» ведёт в раздел.
 *
 * Обновляется на той же минуте, что и весь дашборд. Раньше карточка
 * читала журнал один раз при открытии и больше никогда: остальной экран
 * тикал, а «что только что произошло» показывало момент, когда владелец
 * зашёл, — и чем дольше вкладка открыта, тем неправдивее.
 */
export function ActivityCard({ onNavigate }) {
  const [events, setEvents] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    const load = () => fetchActivity({ limit: 6 })
      .then((d) => { if (alive) { setEvents(d); setError('') } })
      .catch((e) => { if (alive) setError(e.message) })
    load()
    const timer = setInterval(load, 60_000)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  return (
    <section className="panel activity-panel">
      {/* Без описания под названием: карточка стоит на дашборде рядом с
          панелями, у которых его тоже нет — строки журнала говорят за себя */}
      <div className="panel-heading">
        <div><h2>Recent activity</h2></div>
        <button className="text-button" onClick={() => onNavigate('activity')}>View all</button>
      </div>
      {/* Сорванное обновление не стирает уже показанный журнал: отказ
          занимает место списка, только когда показывать нечего */}
      {events !== null ? <ActivityList events={events} />
        : error ? <p className="empty-state">{error}</p>
        : <p className="empty-state">Loading…</p>}
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

/**
 * Строка журнала: тон, заголовок, подстрочник и — справа — сумма и точное
 * время. Заголовки и суммы считают те же помощники, что и раньше
 * (`eventTitle`/`eventAmount`/`eventDetail`), здесь только раскладка.
 */
export function JournalRow({ event, timeZone }) {
  const meta = TYPE_META[event.type] || { tone: 'open' }
  const Icon = TYPE_ICON[event.type] || Activity
  const amount = eventAmount(event)
  const detail = eventDetail(event)
  const line = [event.location_name || 'No location', event.device_name, detail]
    .filter(Boolean).join(' · ')
  return (
    <li className="act-row">
      {/* Иконка — усиление, а не носитель смысла: тип события написан
          словом в заголовке строки, поэтому значок скрыт от озвучки. */}
      <span className={`act-mark is-${meta.tone}`} aria-hidden><Icon /></span>
      <div className="act-body">
        <strong>{eventTitle(event)}</strong>
        <small>{line}</small>
      </div>
      <div className="act-meta">
        {amount && <span className={`act-amount is-${meta.tone}`}>{amount}</span>}
        <time className="act-time" dateTime={event.created_at || undefined}>
          {activityTime(event.created_at, timeZone)}
        </time>
      </div>
    </li>
  )
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
  const first = loading && !events

  // Дни считаются от загруженного окна: сервер отдаёт события по убыванию
  // времени, и группировка этот порядок только размечает.
  const days = useMemo(() => activityDays(events, { timeZone }), [events, timeZone])

  /*
   * Счётчик говорит про ЗАГРУЖЕННОЕ, а не про весь журнал: сколько всего
   * событий подходит под фильтры, RPC не сообщает, и «8 events» рядом с
   * кнопкой «Load more» читалось бы как «больше ничего нет».
   *
   * Он же — единственная живая область раздела: строки ленты объявлять
   * поштучно не нужно, а «загружаю» и «загружено столько-то» — нужно.
   */
  const status = first ? 'Loading…'
    : total === 0 ? ''
    : `${total} ${total === 1 ? 'event' : 'events'} loaded`

  return (
    <>
      <PageHeader
        title="Activity"
        actions={(
          <>
            <Button
              disabled={!total}
              onClick={exportCsv}
              title="Download exactly what is on screen"
            >
              <Download aria-hidden /> Export CSV
            </Button>
            <IconButton
              className="act-refresh"
              label="Refresh activity"
              onClick={() => load(true)}
              disabled={loading}
              aria-busy={loading || undefined}
            >
              <RefreshCw />
            </IconButton>
          </>
        )}
      />

      <div className="act-toolbar">
        <SearchField
          label="Search activity"
          value={search}
          onChange={setSearch}
          placeholder="Staff, reason or device"
          className="order-search act-search"
        />

        <label className="act-select">
          <span className="visually-hidden">Time range</span>
          <select value={range} onChange={(e) => setRange(e.target.value)}>
            {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </label>

        {locations.length > 1 && (
          <label className="act-select">
            <span className="visually-hidden">Location</span>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">All locations</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
        )}

        <p className="act-count" role="status">{status}</p>
      </div>

      {/* Тип события — множественный выбор, и отбирает его СЕРВЕР:
          прежний фильтр отвечал на вопрос «что было среди последних
          пятидесяти», а не «что было». */}
      <div className="act-types" role="group" aria-label="Event types">
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

      {error && <ErrorText>{error}</ErrorText>}

      {first ? (
        /* Журнал по дням: заголовок дня и события под ним. */
        <Skeleton label="Loading the activity journal…">
          <SkeletonPanel>
            <SkeletonBar width="18%" height={14} />
            {Array.from({ length: 4 }, (_, i) => (
              <SkeletonRow key={i} height={52} lead={28} columns={['30%', '18%']} />
            ))}
          </SkeletonPanel>
        </Skeleton>
      ) : total === 0 ? (
        <section className="panel">
          <p className="empty-state">
            {filtered ? 'No events match these filters.'
              : 'No activity yet. Shifts and refunds from your registers appear here.'}
          </p>
        </section>
      ) : (
        <>
          <section className="panel act-journal">
            {days.map((day) => (
              <section className="act-day" key={day.key}>
                <h2 className="act-day-head">{day.label}</h2>
                <ul className="act-list">
                  {day.events.map((event) => (
                    <JournalRow key={event.id} event={event} timeZone={timeZone} />
                  ))}
                </ul>
              </section>
            ))}
          </section>

          {/* Дальше вглубь ведёт время последнего показанного события
              (keyset): смещение на такой ленте пропускало бы события,
              пришедшие во время чтения. */}
          {!done && (
            <div className="act-more">
              <Button
                onClick={() => load(false, events[events.length - 1].created_at)}
                disabled={loading}
              >
                {loading ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </>
      )}
    </>
  )
}
