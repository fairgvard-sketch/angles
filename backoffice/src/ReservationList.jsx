import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  markReservationArrived, setReservationStatus, setReservationTables,
  updateReservation, updateReservationGuest, deskErrorText,
} from './reservations'
import { isConflict } from './desk-availability'
import { statusClass, statusLabel, visitState } from './reservation-status'
import {
  PAGE_SIZE, VIA_LABEL, createdVia, filterReservations, groupByDay, paginate, sortByTime,
} from './reservation-list'
import { trimToWindow } from './visit'
import { zonedToUtc } from './timeline'
import PartyCount from './ui/PartyCount'
import BookingSheet from './BookingSheet'

/**
 * Список броней — рабочая таблица, а не сетка карточек.
 *
 * Было три панели с крупными карточками: «Requests», «Upcoming & today»
 * и «Recent history» на двадцать записей. Ни фильтра, ни сортировки, ни
 * ответа на вопрос «что у нас в субботу вечером»: карточка занимала
 * четверть экрана, и десяток броней уже не помещался целиком.
 *
 * Таблица отвечает на другой вопрос, чем полотно: не «что с залом
 * сейчас», а «какие брони есть, в каком они состоянии и что с ними
 * делать». Поэтому здесь видны и отменённые, и завершённые визиты.
 */

const DAY_MS = 86_400_000

/** List — будущая работа, а не архив. Прошлые визиты ищутся в отчётах. */
export const RANGES = [
  { key: 'week', label: 'Upcoming 7 days', days: 7 },
  { key: 'day', label: 'Today', days: 1 },
]

const STATUS_FILTERS = [
  { key: null, label: 'All statuses' },
  { key: 'pending', label: 'Pending' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'arrived', label: 'Seated' },
  { key: 'done', label: 'Completed' },
  { key: 'noshow', label: 'No-show' },
  { key: 'cancelled', label: 'Cancelled' },
]

/** Пути заведения визита — фильтр «кто нажал кнопку» */
const VIA_FILTERS = [
  { key: null, label: 'Any origin' },
  { key: 'public', label: VIA_LABEL.public },
  { key: 'pos', label: VIA_LABEL.pos },
  { key: 'backoffice', label: VIA_LABEL.backoffice },
  { key: 'waitlist', label: VIA_LABEL.waitlist },
  { key: 'unknown', label: VIA_LABEL.unknown },
]

/** Время визита в часах точки */
function hhmm(iso, tz) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(iso))
  } catch {
    return ''
  }
}

export default function ReservationList({
  locationId, date, query = '', filters, onFilters, desk, tables, tz, onReload,
}) {
  const [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState(null)
  const [sheetError, setSheetError] = useState('')
  const [sheetConflict, setSheetConflict] = useState(false)
  const [page, setPage] = useState(1)

  const range = RANGES.find((r) => r.key === filters.rg) ?? RANGES[0]
  const sortDir = filters.so === 'desc' ? 'desc' : 'asc'

  // Отрезок считается в сутках ТОЧКИ: «следующие 7 дней» для владельца в
  // другом часовом поясе — те же семь рабочих дней его заведения.
  //
  // Запрос при этом берёт данные с запасом в сутки по краям (`visit.js`),
  // потому что пояс приезжает в том же ответе. Лишнее отсекается здесь,
  // а не вторым запросом: иначе список грузился бы дважды.
  const window = useMemo(() => {
    const startOfDay = zonedToUtc(date, 0, tz).getTime()
    return { fromMs: startOfDay, toMs: startOfDay + range.days * DAY_MS }
  }, [date, tz, range.days])

  const raw = desk?.visits ?? null
  const capped = !!desk?.capped
  const inWindow = useMemo(
    () => (raw === null ? null : trimToWindow(raw, window.fromMs, window.toMs)),
    [raw, window.fromMs, window.toMs]
  )

  const tableById = useMemo(() => new Map((tables ?? []).map((t) => [t.id, t])), [tables])
  const zones = useMemo(() => {
    const seen = new Map()
    for (const table of tables ?? []) {
      if (table.zoneId && !seen.has(table.zoneId)) seen.set(table.zoneId, table.zoneName)
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name: name || 'Zone' }))
  }, [tables])

  const visible = useMemo(() => sortByTime(filterReservations(inWindow ?? [], {
    status: filters.st ?? null,
    zone: filters.zn ?? null,
    via: filters.sr ?? null,
    query,
    tableById,
  }), sortDir), [inWindow, filters.st, filters.zn, filters.sr, query, tableById, sortDir])

  // Сузили отбор — третья страница могла исчезнуть; возвращаемся к первой
  useEffect(() => { setPage(1) }, [filters.st, filters.zn, filters.sr, filters.rg, query, date])

  const pageData = paginate(visible, page, PAGE_SIZE)
  const todayStr = useMemo(() => {
    const now = new Date()
    try {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now)
      return parts
    } catch {
      return now.toISOString().slice(0, 10)
    }
  }, [tz])
  const groups = useMemo(
    () => groupByDay(pageData.items, tz, todayStr),
    [pageData.items, tz, todayStr]
  )

  const setFilter = (key, value) => onFilters({ ...filters, [key]: value || null })

  /*
   * Открытая панель показывает СВЕЖУЮ бронь, а не копию строки, с
   * которой её открыли: пока хостес читает карточку, гость отменяет
   * бронь с телефона — и панель обязана это показать, а не оставить
   * «Подтверждена» под кнопкой «Гость сел».
   */
  const detailVisit = useMemo(
    () => (detail ? (inWindow ?? []).find((v) => v.id === detail) ?? null : null),
    [detail, inWindow]
  )

  useEffect(() => {
    if (detail && inWindow !== null && !detailVisit) setDetail(null)
  }, [detail, inWindow, detailVisit])

  async function act(fn) {
    setBusy(true)
    setSheetError('')
    setSheetConflict(false)
    try {
      await fn()
      setDetail(null)
      await onReload()
    } catch (e) {
      setSheetError(deskErrorText(e.message))
      setSheetConflict(isConflict(e.message))
    } finally {
      setBusy(false)
    }
  }

  const tablesOf = (reservation) => {
    const ids = [
      ...(reservation.table_ids ?? []),
      reservation.table_id,
      ...(reservation.hold_table_ids ?? []),
    ].filter(Boolean)
    const labels = [...new Set(ids)]
      .map((id) => tableById.get(id)?.label)
      .filter(Boolean)
    return labels.length > 0 ? labels.join(' + ') : '—'
  }

  return (
    <section className="panel form-panel rsv-list-panel">
      {/* List начинается сегодня и смотрит только вперёд. Отдельной даты
          в шапке нет: она относится к пространственной сетке Timeline. */}
      <div className="rsv-list-toolbar">
        <label className="rsv-select">
          <span className="visually-hidden">Range</span>
          <select value={range.key} onChange={(e) => setFilter('rg', e.target.value)}>
            {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </label>
        <label className="rsv-select">
          <span className="visually-hidden">Status</span>
          <select value={filters.st ?? ''} onChange={(e) => setFilter('st', e.target.value)}>
            {STATUS_FILTERS.map((s) => (
              <option key={s.key ?? 'all'} value={s.key ?? ''}>{s.label}</option>
            ))}
          </select>
        </label>
        {zones.length > 1 && (
          <label className="rsv-select">
            <span className="visually-hidden">Zone</span>
            <select value={filters.zn ?? ''} onChange={(e) => setFilter('zn', e.target.value)}>
              <option value="">All zones</option>
              {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </label>
        )}
        <label className="rsv-select">
          <span className="visually-hidden">Origin</span>
          <select value={filters.sr ?? ''} onChange={(e) => setFilter('sr', e.target.value)}>
            {VIA_FILTERS.map((s) => (
              <option key={s.key ?? 'all'} value={s.key ?? ''}>{s.label}</option>
            ))}
          </select>
        </label>
      </div>

      {capped && (
        <p className="timeline-hidden-note">
          Showing the first 500 bookings of this period — narrow the range or
          the filters to see the rest.
        </p>
      )}

      {inWindow === null ? (
        <ListSkeleton />
      ) : visible.length === 0 ? (
        <p className="empty-state">
          {(query.trim() || filters.st || filters.zn || filters.sr)
            ? 'No booking matches these filters.'
            : 'No bookings in this period yet.'}
        </p>
      ) : (
        <>
          <div className="rsv-table-scroll">
            <table className="rsv-table">
              <thead>
                <tr>
                  <th scope="col">
                    {/* Порядок меняется по клику на заголовок — так же,
                        как в любой таблице, к которой владелец привык. */}
                    <button
                      type="button"
                      className="rsv-sort"
                      aria-label={`Sort by time, currently ${sortDir === 'asc' ? 'earliest first' : 'latest first'}`}
                      onClick={() => setFilter('so', sortDir === 'asc' ? 'desc' : null)}
                    >
                      Time {sortDir === 'asc' ? '↑' : '↓'}
                    </button>
                  </th>
                  <th scope="col">Guest</th>
                  <th scope="col">Party</th>
                  <th scope="col" className="rsv-col-table">Table</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="rsv-col-source">Origin</th>
                  <th scope="col" className="rsv-col-note">Note</th>
                </tr>
              </thead>
              {groups.map((group) => (
                <tbody key={group.key}>
                  <tr className="rsv-day-row">
                    <th scope="colgroup" colSpan={7}>
                      {group.label}
                      {group.label !== group.key && <span> · {group.key}</span>}
                    </th>
                  </tr>
                  {group.rows.map((r) => {
                    const state = visitState(r)
                    // Бронь открывает отдельная кнопка, а не вся строка:
                    // `role="button"` на строке таблицы ломается, как только
                    // внутрь попадает любой другой интерактивный элемент.
                    return (
                      <tr
                        key={r.id}
                        className={`rsv-row${detail === r.id ? ' is-selected' : ''}`}
                      >
                        <td className="rsv-cell-time">{hhmm(r.reserved_at, tz)}</td>
                        <td className="rsv-cell-guest">
                          <button
                            type="button"
                            className="rsv-open"
                            aria-pressed={detail === r.id}
                            onClick={() => { setDetail(r.id); setSheetError(''); setSheetConflict(false) }}
                          >
                            <strong>{r.customer_name}</strong>
                            {r.is_test && <span className="guest-fav is-warn"> Test</span>}
                            {r.customer_phone && <small>{r.customer_phone}</small>}
                          </button>
                        </td>
                        <td className="rsv-cell-party"><PartyCount n={r.party_size} /></td>
                        <td className="rsv-col-table">{tablesOf(r)}</td>
                        <td>
                          <span className={`rsv-status ${statusClass(state)}`}>{statusLabel(state)}</span>
                        </td>
                        <td className="rsv-col-source">{VIA_LABEL[createdVia(r)]}</td>
                        <td className="rsv-col-note">
                          {/* Заметка обрезается безопасно: целиком она
                              есть в панели визита */}
                          <span className="rsv-note">{r.note || r.reject_reason || '—'}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              ))}
            </table>
          </div>

          <div className="rsv-pager">
            <span>
              {pageData.from}–{pageData.to} of {pageData.total} bookings
            </span>
            {pageData.pages > 1 && (
              <div className="rsv-pager-buttons">
                <button
                  type="button"
                  className="secondary-button compact"
                  disabled={pageData.page <= 1}
                  onClick={() => setPage(pageData.page - 1)}
                >
                  <ChevronLeft /> Previous
                </button>
                <span className="rsv-pager-page">Page {pageData.page} of {pageData.pages}</span>
                <button
                  type="button"
                  className="secondary-button compact"
                  disabled={pageData.page >= pageData.pages}
                  onClick={() => setPage(pageData.page + 1)}
                >
                  Next <ChevronRight />
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Та же панель, что открывается с полотна: одна бронь — один
          набор сведений и действий, где бы её ни открыли. */}
      {detailVisit && (
        <BookingSheet
          locationId={locationId}
          reservation={detailVisit}
          tables={tables}
          tz={tz}
          busy={busy}
          error={sheetError}
          conflict={sheetConflict}
          bookings={inWindow ?? []}
          onClearError={() => { setSheetError(''); setSheetConflict(false) }}
          onClose={() => { setDetail(null); setSheetError(''); setSheetConflict(false) }}
          onEdit={(patch) => act(async () => {
            if (patch.name != null || patch.phone != null) {
              await updateReservationGuest(locationId, detailVisit.id, patch)
            }
            if (patch.at != null || patch.partySize != null || patch.note != null) {
              await updateReservation(locationId, detailVisit.id, patch)
            }
          })}
          onAction={(key, reason = null) => act(() => (
            key === 'arrived'
              ? markReservationArrived(locationId, detailVisit.id)
              : setReservationStatus(locationId, detailVisit.id, key, reason)
          ))}
          onTables={(ids) => act(() => setReservationTables(locationId, detailVisit.id, ids))}
        />
      )}
    </section>
  )
}

/** Скелет таблицы: та же геометрия, что у загруженной */
function ListSkeleton() {
  return (
    <div className="rsv-table-scroll rsv-list-skeleton">
      <div role="status" aria-live="polite" className="visually-hidden">Loading bookings…</div>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="rsv-skeleton-row" aria-hidden>
          <span style={{ width: '9%' }} />
          <span style={{ width: '22%' }} />
          <span style={{ width: '7%' }} />
          <span style={{ width: '12%' }} />
          <span style={{ width: '14%' }} />
        </div>
      ))}
    </div>
  )
}
