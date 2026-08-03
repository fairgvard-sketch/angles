import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import {
  blockState, buildRows, groupByZone, hourTicks, nowMarkerPct,
  timelineWindow, todayInZone,
} from './timeline'
import { statusClass, statusLabel, visitActions } from './reservation-status'
import ConfirmDialog from './ui/ConfirmDialog'
import {
  blockDetail, blockWidthPx, halfHourMarks, overlappingVisits, showsMeta, showsName,
} from './timeline-view'
import {
  fetchReservationSettings, fetchTimelineReservations, fetchTimelineTables,
  markReservationArrived, setReservationTables, setReservationStatus, deskErrorText,
  updateReservation, updateReservationGuest, toLocalInput, fromLocalInput,
} from './reservations'
import { conflictAlternatives, isConflict } from './desk-availability'
import { supabase } from './supabase'
import Drawer from './ui/Drawer'
import { Button } from './ui/Button'

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
          <button type="button" className="icon-button" aria-label="Refresh timeline" onClick={load}>
            <RefreshCw />
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
                      <small>{row.table.seats} seats</small>
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
                                {block.booking.partySize}
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

/**
 * Карточка визита: контакты, состав и действия. Пикер столов —
 * множественный: объединение столов такое же обычное действие хостес,
 * как назначение одного.
 */
function BookingSheet({
  reservation, tables, tz, busy, error, conflict = false, bookings = [], clashes = [],
  onClose, onAction, onTables, onEdit, onClearError,
}) {
  const linked = (reservation.tables_link ?? []).map((l) => l.table_id)
  const initial = linked.length > 0
    ? linked
    : [reservation.table_id, ...(reservation.hold_table_ids ?? [])].filter(Boolean)
  const [picked, setPicked] = useState(initial)
  const posSeated = reservation.order_id != null
  const active = reservation.status === 'new' || reservation.status === 'confirmed'

  const actions = visitActions(reservation)
  /*
   * Отмена и отказ спрашивают причину — её увидит гость.
   *
   * Раньше с полотна отменить визит было нельзя вовсе: карточка
   * предлагала «Completed / No-show», а за отменой хостес уходил в
   * список. Диалог здесь тот же, что в списке, — с Escape, фокусом и
   * необязательной причиной, а не `window.confirm`.
   */
  const [asking, setAsking] = useState(null)

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

  /*
   * Отказ по занятости — единственный, к которому есть что добавить: что
   * свободно в это время и когда освободится. Считается из тех же
   * визитов, что уже на экране, и САМ визит из расчёта исключается —
   * иначе перенос на полчаса упирался бы в собственную бронь.
   *
   * Это подсказка, а не разрешение: занятость всё равно перепроверит
   * сервер при сохранении.
   */
  const alternatives = useMemo(() => {
    if (!conflict) return null
    const wantedMs = fromLocalInput(form.at, tz)
    return conflictAlternatives({
      tables,
      bookings,
      wantedMs: wantedMs ? new Date(wantedMs).getTime() : NaN,
      partySize: Number(form.party) || reservation.party_size || 1,
      ignoreId: reservation.id,
    })
  }, [conflict, form.at, form.party, tz, tables, bookings, reservation.id, reservation.party_size])

  const hhmm = (ms) => new Date(ms).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: tz,
  })

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

  const startMs = new Date(reservation.reserved_at).getTime()
  const when = new Date(reservation.reserved_at).toLocaleDateString([], {
    weekday: 'short', day: 'numeric', month: 'short',
  })
  const span = `${timeInZone(startMs, tz)}–${timeInZone(startMs + (reservation.duration_min || 90) * 60_000, tz)}`
  const state = blockState(reservation.status, reservation.arrived_at, reservation.order_id)

  // Стол и зона словами: «стол 4 · Pergola» отвечает на вопрос «куда
  // идти», а список id в пикере — нет.
  const seatedAt = initial
    .map((id) => tables.find((t) => t.id === id))
    .filter(Boolean)
  const zoneName = seatedAt.find((t) => t.zoneName)?.zoneName ?? null

  /*
   * Источник называется только тогда, когда он ДЕЙСТВИТЕЛЬНО известен.
   *
   * Колонку `source` заполняет одна лишь ручная бронь кабинета (127);
   * гостевая страница и касса идут через общий `create_reservation` и
   * оставляют её пустой. Поэтому пусто здесь означает не «неизвестно
   * откуда», а «не из кабинета» — и написать «Source unknown» значило бы
   * выдать нормальную гостевую бронь за подозрительную.
   */
  const SOURCE_LABEL = {
    backoffice: 'Added in the back office',
  }
  const sourceLabel = SOURCE_LABEL[reservation.source] ?? null

  return (
    <Drawer
      labelledBy="booking-sheet-title"
      title={(
        <>
          {reservation.customer_name}
          {/* Тестовая бронь (126): стол она держит настоящий, поэтому
              метка обязана быть видна там, где хостес принимает решение. */}
          {reservation.is_test && <span className="guest-fav is-warn"> Test</span>}
        </>
      )}
      subtitle={`${reservation.party_size} guests · ${when}, ${span}`}
      onClose={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
    >
        {/*
          Порядок сведений — рабочий: кто и сколько человек, когда, за
          каким столом, в каком состоянии, как позвонить, что просили.
          Служебное (откуда бронь и когда заведена) уходит вниз: оно
          нужно, когда с визитом что-то не так, а не каждый раз.
        */}
        <dl className="sheet-facts">
          <div>
            <dt>Table</dt>
            <dd>
              {seatedAt.length > 0
                ? seatedAt.map((t) => t.label).join(' + ')
                : 'Not assigned yet'}
              {zoneName && <span className="sheet-fact-muted"> · {zoneName}</span>}
            </dd>
          </div>
          <div>
            <dt>Status</dt>
            {/* Состояние — тем же цветом и словом, что и на полотне */}
            <dd><span className={`rsv-status ${statusClass(state)}`}>{statusLabel(state)}</span></dd>
          </div>
          {reservation.customer_phone && (
            <div>
              <dt>Phone</dt>
              <dd><a href={`tel:${reservation.customer_phone}`}>{reservation.customer_phone}</a></dd>
            </div>
          )}
        </dl>

        {reservation.note && <p className="order-note">{reservation.note}</p>}

        {/*
          Конфликт назван по имени: красной рамки на полотне мало, чтобы
          понять, кого именно придётся двигать.
        */}
        {clashes.length > 0 && (
          <div className="sheet-clash" role="note">
            <strong>Overlaps another booking</strong>
            <ul>
              {clashes.map(({ booking, table }) => (
                <li key={booking.id}>
                  {timeInZone(booking.startMs, tz)}–{timeInZone(booking.endMs, tz)}
                  {' · '}{booking.guestName}
                  {' · table '}{table.label}
                </li>
              ))}
            </ul>
            <span>Move one of the visits or give it another table.</span>
          </div>
        )}

        {posSeated && (
          <p className="form-hint">
            Seated into a POS order — this visit is handled on the register.
          </p>
        )}

        {/* Отказ сервера — здесь, рядом с кнопкой, которую нажали, а не
            в полотне под открытой панелью. */}
        {error && <p className="form-error" role="alert">{error}</p>}

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
                {/* Сообщение сервера живёт ровно до того, как хостес
                    изменил то, из-за чего оно появилось: «стол занят»
                    рядом с уже другим временем — ложь про текущую форму. */}
                <input type="number" min={1} max={50} value={form.party}
                  onChange={(e) => { setForm((f) => ({ ...f, party: e.target.value })); onClearError?.() }} />
              </label>
              <label className="qr-field">
                <span>Date and time</span>
                <input type="datetime-local" value={form.at}
                  onChange={(e) => { setForm((f) => ({ ...f, at: e.target.value })); onClearError?.() }} />
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

            {/* Отказ по занятости — единственный, к которому есть что
                добавить: что свободно сейчас и когда освободится. */}
            {alternatives && (
              <div className="conflict-hint">
                {alternatives.tables.length > 0 && (
                  <>
                    <p className="form-hint">Free at this time — tap to move the visit:</p>
                    <div className="conflict-options">
                      {alternatives.tables.slice(0, 6).map((table) => (
                        <Button
                          key={table.id}
                          onClick={() => { setPicked([table.id]); onClearError?.() }}
                        >
                          {table.label} · {table.seats} seats
                        </Button>
                      ))}
                    </div>
                    <p className="form-hint">
                      Picking a table only changes the selection below — press
                      Save tables to apply it.
                    </p>
                  </>
                )}
                {alternatives.times.length > 0 && (
                  <>
                    <p className="form-hint">Nearest free times:</p>
                    <div className="conflict-options">
                      {alternatives.times.map((slot) => (
                        <Button
                          key={slot.at}
                          onClick={() => {
                            setForm((f) => ({ ...f, at: toLocalInput(slot.at, tz) }))
                            onClearError?.()
                          }}
                        >
                          {hhmm(slot.at)}
                        </Button>
                      ))}
                    </div>
                  </>
                )}
                {alternatives.tables.length === 0 && alternatives.times.length === 0 && (
                  <p className="form-hint">
                    Nothing is free nearby on this screen — try another day or
                    free a table first.
                  </p>
                )}
                <p className="form-hint">
                  Suggestions come from what this screen already knows; the
                  server checks availability again when you save.
                </p>
              </div>
            )}
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

            {/* Набор действий решает `visitActions`: экран не должен
                предлагать переход, который сервер всё равно отклонит. */}
            <div className="order-actions">
              {actions.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  className={action.tone === 'primary' ? 'primary-button compact' : 'secondary-button'}
                  data-danger={action.tone === 'danger' || undefined}
                  disabled={busy}
                  onClick={() => (action.confirm ? setAsking(action) : onAction(action.key))}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Служебное — внизу и тихо: нужно, когда с визитом что-то не
            так, а не при каждом открытии карточки. */}
        {asking && (
          <ConfirmDialog
            title={asking.key === 'rejected' ? 'Reject this booking?' : 'Cancel this booking?'}
            description={`${reservation.customer_name || 'Guest'} · ${when}, ${span} · ${
              reservation.party_size} guests. The table is freed immediately.`}
            confirmLabel={asking.key === 'rejected' ? 'Reject booking' : 'Cancel booking'}
            cancelLabel="Keep the booking"
            tone="danger"
            reason={{ label: 'Reason for the guest', placeholder: 'Fully booked, closed for a private event…' }}
            busy={busy}
            onCancel={() => setAsking(null)}
            onConfirm={(text) => { setAsking(null); onAction(asking.key, text) }}
          />
        )}

        {(sourceLabel || reservation.created_at) && (
          <p className="sheet-meta">
            {sourceLabel}
            {sourceLabel && reservation.created_at && ' · '}
            {reservation.created_at && `booked ${new Date(reservation.created_at).toLocaleString([], {
              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
            })}`}
          </p>
        )}

    </Drawer>
  )
}
