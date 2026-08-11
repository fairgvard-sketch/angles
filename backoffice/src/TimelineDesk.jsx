import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  blockState, buildRows, groupByZone, hourTicks, nowMarkerPct,
  timelineWindow, todayInZone,
} from './timeline'
import { statusClass, statusLabel } from './reservation-status'
import {
  blockDetail, blockWidthPx, halfHourMarks, overlappingVisits, showsMeta, showsName,
} from './timeline-view'
import {
  fetchReservationSettings, fetchTimelineReservations, fetchTimelineTables,
  markReservationArrived, setReservationTables, setReservationStatus, deskErrorText,
  updateReservation, updateReservationGuest,
} from './reservations'
import { isConflict } from './desk-availability'
import { supabase } from './supabase'
import PartyCount from './ui/PartyCount'
import BookingSheet from './BookingSheet'

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
    statusLabel(booking.state),
  ]
  if (block.combined) parts.push('combined tables')
  if (block.clipsStart) parts.push('started the day before')
  if (block.clipsEnd) parts.push('continues past this day')
  if (block.conflict) parts.push('overlaps another booking')
  return parts.join(' · ')
}

export default function TimelineDesk({ locationId, date, query = '' }) {
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
  // Отказ действия принадлежит панели визита, а не полотну под ней
  const [sheetError, setSheetError] = useState('')
  // Занятость — единственный отказ, к которому есть что добавить
  const [sheetConflict, setSheetConflict] = useState(false)
  const [zoneFilter, setZoneFilter] = useState(null)

  const tz = meta.timezone
  const todayStr = useMemo(() => todayInZone(nowMs, tz), [nowMs, tz])

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
    const timer = setInterval(load, 60_000)
    return () => {
      supabase.removeChannel(channel)
      clearInterval(timer)
    }
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
      phone: r.customer_phone ?? '',
      posSeated: r.order_id != null,
    }
  }), [raw])

  /*
   * Поиск не убирает визиты с полотна: пропавший визит хостес считает
   * несуществующим и звонит гостю зря. Несовпавшие приглушаются, и
   * место суток остаётся видимым.
   */
  const needle = query.trim().toLowerCase()
  const matchesQuery = useCallback((booking) => {
    if (!needle) return true
    return `${booking.guestName ?? ''} ${booking.phone ?? ''}`.toLowerCase().includes(needle)
  }, [needle])

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
  // Сколько визитов дня отвечает поиску — иначе приглушённое полотно
  // выглядит сломанным, а не отфильтрованным.
  const found = useMemo(() => {
    if (!needle) return null
    const ids = new Set()
    for (const row of operationalRows) {
      for (const block of row.blocks) {
        if (matchesQuery(block.booking)) ids.add(block.booking.id)
      }
    }
    return ids.size
  }, [needle, matchesQuery, operationalRows])
  const ticks = useMemo(() => hourTicks(win, tz), [win, tz])
  // Получас виден, но тише часа: он помогает прицелиться, а не читается
  // как отдельная отметка времени.
  const halfMarks = useMemo(() => halfHourMarks(ticks, win), [ticks, win])
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

  /*
   * Отказ сервера показывается ТАМ, где нажали кнопку.
   *
   * Раньше ошибка действия из карточки визита попадала в общий блок
   * полотна — то есть под открытую панель: хостес видел, что ничего не
   * произошло, и не видел почему. Успех закрывает панель, отказ
   * оставляет её открытой вместе с причиной.
   */
  async function act(fn) {
    setBusy(true)
    setSheetError('')
    setSheetConflict(false)
    try {
      await fn()
      setDetail(null)
      await load()
      setError('')
    } catch (e) {
      setSheetError(deskErrorText(e.message))
      setSheetConflict(isConflict(e.message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel form-panel timeline-panel">
      {/*
        Тулбар полотна: зона и движение по времени. Метрик здесь больше
        нет — три карточки занимали ту же высоту, что четыре стола, и
        отвечали на вопросы, которые само полотно показывает нагляднее.
      */}
      <div className="timeline-controls">
        {zones.length > 1 ? (
          <div className="timeline-zones" aria-label="Zone filter">
            <button
              type="button"
              className={`timeline-filter-button${zoneFilter === null ? ' is-active' : ''}`}
              aria-pressed={zoneFilter === null}
              onClick={() => setZoneFilter(null)}
            >
              All zones
            </button>
            {zones.map((z) => (
              <button
                key={z.id ?? 'none'}
                type="button"
                className={`timeline-filter-button${zoneFilter === z.id ? ' is-active' : ''}`}
                aria-pressed={zoneFilter === z.id}
                onClick={() => setZoneFilter(z.id)}
              >
                {z.name ?? 'No zone'}
              </button>
            ))}
          </div>
        ) : <span />}

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

      <div className="timeline-guide">
        <div className="timeline-legend" aria-label="Booking statuses">
          <span><i className="is-pending" />Pending</span>
          <span><i className="is-confirmed" />Confirmed</span>
          <span><i className="is-arrived" />Seated</span>
          <span><i className="is-done" />Completed</span>
          <span><i className="is-conflict" />Conflict</span>
        </div>
        {found !== null && (
          <p className="timeline-hidden-note" role="status">
            {found === 0
              ? `Nothing on this day matches “${query.trim()}”.`
              : `${found} visit${found === 1 ? '' : 's'} match “${query.trim()}” — the rest are dimmed.`}
          </p>
        )}
      </div>

      {hiddenTableCount > 0 && (
        <p className="timeline-hidden-note">
          {hiddenTableCount} out-of-service table{hiddenTableCount === 1 ? '' : 's'} hidden from this operational view.
        </p>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      {raw === null ? (
        <TimelineSkeleton rows={tables.length || 6} />
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
                      <small><PartyCount n={row.table.seats} /></small>
                    </div>
                    <div
                      className={`timeline-track${row.table.blocked ? ' is-blocked' : ''}`}
                    >
                      {ticks.map((tick) => (
                        <span key={tick.ts} className="timeline-grid" style={{ left: `${tick.leftPct}%` }} />
                      ))}
                      {halfMarks.map((mark) => (
                        <span key={mark.ts} className="timeline-grid is-half" style={{ left: `${mark.leftPct}%` }} />
                      ))}
                      {row.table.blocked && <span className="timeline-blocked">disabled</span>}
                      {markerPct !== null && (
                        <span className="timeline-now" style={{ left: `${markerPct}%` }} />
                      )}
                      {row.blocks.map((block) => {
                        const detailLevel = blockDetail(blockWidthPx(block.widthPct, trackWidth))
                        return (
                          <button
                            key={block.booking.id}
                            type="button"
                            className={`timeline-block ${statusClass(block.booking.state)}${
                              block.conflict ? ' is-conflict' : ''}${
                              block.clipsStart ? ' is-clip-start' : ''}${
                              block.clipsEnd ? ' is-clip-end' : ''}${
                              detail?.id === block.booking.id ? ' is-selected' : ''}${
                              matchesQuery(block.booking) ? '' : ' is-dimmed'}`}
                            style={{ left: `${block.leftPct}%`, width: `${block.widthPct}%` }}
                            // Выбранный визит — состояние кнопки, а не только
                            // рамка: читалка обязана сказать, что открыто.
                            aria-pressed={detail?.id === block.booking.id}
                            onClick={() => setDetail(raw.find((r) => r.id === block.booking.id) ?? null)}
                            // Одинаковых блоков на экране десятки: без имени
                            // с гостем, столом и временем скринридер читает
                            // подряд «кнопка, кнопка, кнопка». Подпись полная
                            // всегда, даже когда в сам блок влезло одно время.
                            aria-label={blockLabel(block, row.table, tz)}
                            title={blockLabel(block, row.table, tz)}
                          >
                            <strong>
                              <span className="timeline-block-time">
                                {timeInZone(block.booking.startMs, tz)}
                                {detailLevel === 'wide' && `–${timeInZone(block.booking.endMs, tz)}`}
                              </span>
                              {showsName(detailLevel) && (
                                <span className="timeline-block-name">{block.booking.guestName}</span>
                              )}
                            </strong>
                            {showsMeta(detailLevel) && (
                              <small>
                                <PartyCount n={block.booking.partySize} />
                                {block.combined ? ' · combined' : ''}
                                {` · ${statusLabel(block.booking.state)}`}
                              </small>
                            )}
                            {/* Конфликт обязан быть виден в самом блоке:
                                обводка на приглушённом или тёмном фоне
                                читается хуже, чем знак рядом со временем. */}
                            {block.conflict && (
                              <span className="timeline-block-flag" aria-hidden>!</span>
                            )}
                          </button>
                        )
                      })}
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
          error={sheetError}
          conflict={sheetConflict}
          // Подсказки считаются из тех же визитов, что уже на экране
          bookings={raw ?? []}
          // С кем именно столкнулась бронь — из тех же строк, что рисуют
          // полотно: панель и сетка не могут расходиться в этом ответе.
          clashes={overlappingVisits(operationalRows, detail.id)}
          onClearError={() => { setSheetError(''); setSheetConflict(false) }}
          onClose={() => { setDetail(null); setSheetError(''); setSheetConflict(false) }}
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
          /*
           * Одна дверь для всех переходов визита. Посадка — отдельная
           * функция сервера (она не меняет статус, а отмечает приход),
           * остальное идёт через set_reservation_status_web, который и
           * решает, разрешён ли переход.
           */
          onAction={(key, reason = null) => act(() => (
            key === 'arrived'
              ? markReservationArrived(locationId, detail.id)
              : setReservationStatus(locationId, detail.id, key, reason)
          ))}
          onTables={(ids) => act(() => setReservationTables(locationId, detail.id, ids))}
        />
      )}
    </section>
  )
}

/**
 * Полотно на время загрузки: те же строки и та же высота, что у готового.
 *
 * Строка «Loading…» схлопывала раздел в один абзац, а через секунду
 * возвращала его на полный экран — вкладки и кнопки уезжали из-под
 * курсора ровно в тот момент, когда по ним целились.
 */
function TimelineSkeleton({ rows }) {
  const shape = [
    [4, 26], [38, 18], [12, 30], [56, 22], [24, 34], [66, 16],
  ]
  return (
    <div className="timeline-scroll">
      <div className="timeline-canvas timeline-skeleton" style={{ '--timeline-track-width': '100%' }}>
        <div className="timeline-ruler" aria-hidden>
          <div className="timeline-label" />
          <div className="timeline-track" />
        </div>
        <div role="status" aria-live="polite" className="visually-hidden">Loading the timeline…</div>
        {Array.from({ length: Math.min(rows, 10) }, (_, i) => {
          const [left, width] = shape[i % shape.length]
          return (
            <div key={i} className="timeline-row" aria-hidden>
              <div className="timeline-label"><span /></div>
              <div className="timeline-track">
                <span className="timeline-bar" style={{ left: `${left}%`, width: `${width}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
