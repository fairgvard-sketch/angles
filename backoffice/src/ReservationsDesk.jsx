import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarDays, ChevronLeft, ChevronRight, DoorOpen, Phone, Plus, RefreshCw,
  StickyNote, Users,
} from 'lucide-react'
import { supabase } from './supabase'
import {
  RESERVATION_ACTIONS,
  fetchReservations, setReservationStatus, visitLabel,
} from './reservations'
import { statusClass, statusLabel, visitState } from './reservation-status'
import { shiftDate, todayInZone } from './timeline'
import { playNewOrderChime } from './orders'
import TimelineDesk from './TimelineDesk'
import WaitlistPanel from './WaitlistPanel'
import FloorPlanEditor from './FloorPlanEditor'
import ReserveAnalytics from './ReserveAnalytics'
import LaunchChecklist from './LaunchChecklist'
import BookingForm from './BookingForm'
import Tabs from './ui/Tabs'
import ConfirmDialog from './ui/ConfirmDialog'
import { IconButton } from './ui/Button'
import { fetchLocationSlug, fetchLocation } from './settings'
import { fetchTimelineTables } from './reservations'
import { SearchField } from './ui/Layout'

/**
 * «Reservations» — веб-стол хостес (Kassa 102): подтверждение, отказ,
 * завершение визита и no-show без POS-устройства и PIN. Посаженные на
 * кассе брони (order_id) показываются read-only — их визит живёт в
 * POS-заказе (seat_reservation 057), веб его не трогает.
 *
 * Новые заявки приходят realtime-подпиской (публикация 053) со звуком;
 * страховка — поллинг раз в 60 секунд.
 *
 * Вид «Floor plan» (123) стоит здесь же, а не в настройках: пустой
 * таймлайн чинится столами, и путь от проблемы к её причине должен быть
 * в один тап, без похода в другой раздел.
 */

const VIEWS = [
  { key: 'timeline', label: 'Timeline' },
  { key: 'list', label: 'List' },
  { key: 'waitlist', label: 'Waitlist' },
  { key: 'floor', label: 'Tables & zones' },
  { key: 'analytics', label: 'Analytics' },
]

function ReservationCard({ reservation, busyAction, onAction }) {
  const seated = reservation.order_id != null
  const actions = seated ? [] : (RESERVATION_ACTIONS[reservation.status] ?? [])
  const state = visitState(reservation)
  return (
    <article className={`order-card is-${reservation.status}`}>
      <header className="order-card-head">
        <div>
          <strong>{reservation.customer_name}</strong>
          <small>
            <CalendarDays /> {visitLabel(reservation.reserved_at)}
            {' · '}<Users /> {reservation.party_size}
            {reservation.customer_phone && <> · <Phone /> {reservation.customer_phone}</>}
          </small>
        </div>
        {/* Состояние тем же словом и цветом, что на полотне: один визит
            не может называться в списке иначе, чем в таймлайне.
            Тестовая бронь (126) занимает настоящий стол — её нельзя
            спутать с гостевой, иначе хостес будет ждать никого. */}
        <span className={`rsv-status ${statusClass(state)}`}>
          {reservation.is_test
            ? 'Test'
            : seated ? 'Seated (POS)' : statusLabel(state)}
        </span>
      </header>
      {reservation.note && <p className="order-note"><StickyNote /> {reservation.note}</p>}
      {reservation.reject_reason && <p className="order-note">{reservation.reject_reason}</p>}
      {actions.length > 0 && (
        <footer className="order-card-foot">
          <span />
          <div className="order-actions">
            {actions.map((action) => (
              <button
                key={action.to}
                type="button"
                className={action.tone === 'primary' ? 'primary-button compact' : 'secondary-button'}
                disabled={busyAction != null}
                data-danger={action.tone === 'danger' || undefined}
                onClick={() => onAction(reservation, action.to)}
              >
                {busyAction === action.to ? '…' : action.label}
              </button>
            ))}
          </div>
        </footer>
      )}
    </article>
  )
}

export default function ReservationsDesk({
  context, locationId, tab, onTabChange, date, onDateChange,
}) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null) // { id, to }
  // Таймлайн — вид по умолчанию: владелец открывает раздел, чтобы увидеть
  // зал. Вкладка живёт в адресе (Phase 2): ссылку на лист ожидания можно
  // прислать, а Назад возвращает на предыдущую.
  const view = VIEWS.some((v) => v.key === tab) ? tab : 'timeline'
  const setView = (key) => onTabChange?.(key === 'timeline' ? null : key)
  // Слаг нужен только ссылке предпросмотра (126); отсутствие не мешает —
  // длинная ссылка с id точки работает так же.
  const [slug, setSlug] = useState(null)
  // Ручная бронь / walk-in (127): 'booking' | 'walk-in' | null
  const [creating, setCreating] = useState(null)
  // Спрашиваем причину отказа/отмены: { reservation, to }
  const [asking, setAsking] = useState(null)
  const [tables, setTables] = useState([])
  const [tz, setTz] = useState('Asia/Jerusalem')
  const knownIds = useRef(new Set())

  /*
   * День и поиск принадлежат разделу, а не одной вкладке: полотно,
   * список и лист ожидания отвечают на вопросы про ОДИН день, и
   * переключение вкладки не должно возвращать хостес в «сегодня».
   *
   * День живёт в адресе (`?d=`), поиск — нет: ссылку присылают на день,
   * а не на набранную в поле строку.
   */
  const today = todayInZone(Date.now(), tz)
  const day = date || today
  const setDay = (next) => onDateChange?.(next === today ? null : next)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!locationId) return
    let alive = true
    fetchLocationSlug(locationId)
      .then((s) => { if (alive) setSlug(s) })
      .catch(() => { if (alive) setSlug(null) })
    // Столы и зона точки нужны форме ручной брони: стол хостес может
    // назвать сам, а время вводится в часах ТОЧКИ, не браузера.
    fetchTimelineTables(locationId)
      .then((list) => { if (alive) setTables(list) })
      .catch(() => { if (alive) setTables([]) })
    fetchLocation(locationId)
      .then((loc) => { if (alive) setTz(loc.timezone || 'Asia/Jerusalem') })
      .catch(() => {})
    return () => { alive = false }
  }, [locationId])

  const refresh = useCallback(async (withSound = false) => {
    if (!locationId) return
    try {
      const next = await fetchReservations(locationId)
      setError('')
      setData(next)
      const ids = new Set(next.active.map((r) => r.id))
      if (withSound) {
        const hasFresh = next.active.some(
          (r) => r.status === 'new' && !knownIds.current.has(r.id)
        )
        if (hasFresh) playNewOrderChime()
      }
      knownIds.current = ids
    } catch (e) {
      setError(e.message)
    }
  }, [locationId])

  useEffect(() => {
    if (!locationId) return undefined
    setData(null)
    knownIds.current = new Set()
    refresh()
    const channel = supabase
      .channel(`reservations-${locationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reservations', filter: `location_id=eq.${locationId}` },
        () => refresh(true)
      )
      .subscribe()
    const timer = setInterval(() => refresh(true), 60000)
    return () => {
      supabase.removeChannel(channel)
      clearInterval(timer)
    }
  }, [locationId, refresh])

  /**
   * Отказ и отмена спрашивают причину — её видит гость.
   *
   * Раньше это был `window.prompt`: он не поддерживается в части
   * браузеров («prompt() is not supported»), и тогда причина молча
   * терялась. Теперь это диалог кабинета с полем, Escape и фокусом.
   */
  async function act(reservation, to, reason = null) {
    if ((to === 'rejected' || to === 'cancelled') && !asking) {
      setAsking({ reservation, to })
      return
    }
    setBusy({ id: reservation.id, to })
    try {
      await setReservationStatus(locationId, reservation.id, to, reason)
      setAsking(null)
      await refresh()
    } catch (e) {
      setError(e.message === 'pos_mode'
        ? 'This booking is seated into a POS order — it is handled on the register.'
        : e.message)
    } finally {
      setBusy(null)
    }
  }

  // Поиск раздела работает и здесь: поле в шапке обязано что-то менять
  // на КАЖДОЙ вкладке, иначе это украшение.
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return () => true
    return (r) => `${r.customer_name ?? ''} ${r.customer_phone ?? ''}`
      .toLowerCase().includes(needle)
  }, [query])

  const active = (data?.active ?? []).filter(matches)
  const pending = active.filter((r) => r.status === 'new')
  const confirmed = active.filter((r) => r.status !== 'new')
  const history = (data?.history ?? []).filter(matches)

  return (
    <>
      {/*
        Одна рабочая строка вместо титульного заголовка на 40px, описания
        в две строки и отдельной полосы кнопок: раздел хостес открывают,
        чтобы увидеть день, а не прочитать, что это раздел броней.

        Гость по телефону и гость с улицы — обычная работа хостес, а не
        повод идти к кассе, поэтому оба действия стоят здесь.
      */}
      <div className="rsv-header">
        <h1>Reservations</h1>

        <div className="rsv-daynav">
          <IconButton label="Previous day" onClick={() => setDay(shiftDate(day, -1))}>
            <ChevronLeft />
          </IconButton>
          <input
            type="date"
            aria-label="Reservations day"
            value={day}
            onChange={(e) => e.target.value && setDay(e.target.value)}
          />
          <IconButton label="Next day" onClick={() => setDay(shiftDate(day, 1))}>
            <ChevronRight />
          </IconButton>
          {/* «Today» — способ вернуться, а не подпись к дате. Когда в
              селекторе и так сегодняшний день, кнопка ничего не сообщает
              и только занимает место в рабочей строке. */}
          {day !== today && (
            <button type="button" className="rsv-today" onClick={() => setDay(today)}>
              Today
            </button>
          )}
        </div>

        <SearchField
          label="Search reservations"
          value={query}
          onChange={setQuery}
          placeholder="Guest name or phone"
        />

        <div className="rsv-header-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={!locationId}
            onClick={() => setCreating('walk-in')}
          >
            <DoorOpen /> Walk-in
          </button>
          <button
            type="button"
            className="primary-button compact"
            disabled={!locationId}
            onClick={() => setCreating('booking')}
          >
            <Plus /> New reservation
          </button>
        </div>
      </div>

      {/* Пять вкладок на 390px переносились в две строки, и активная
          терялась. Полоса прокручивается, активная всегда видна. */}
      <Tabs
        className="desk-tabs"
        label="Reservations view"
        items={VIEWS}
        value={view}
        onChange={setView}
      />

      {error && <p className="form-error" role="alert">{error}</p>}

      {/* Готовность к запуску — над всем остальным и только пока не
          готово: ненастроенная точка не должна выглядеть работающей.
          На аналитике не показываем: там нечего настраивать. */}
      {locationId && view !== 'analytics' && (
        <LaunchChecklist
          locationId={locationId}
          locationSlug={slug}
          onGo={setView}
        />
      )}

      {creating && locationId && (
        <BookingForm
          locationId={locationId}
          tables={tables}
          /* Подсказки при конфликте считаются из того же списка визитов,
             который уже показан на экране */
          bookings={data?.active ?? []}
          tz={tz}
          mode={creating}
          onClose={() => setCreating(null)}
          onCreated={() => { setCreating(null); refresh() }}
        />
      )}

      {asking && (
        <ConfirmDialog
          title={asking.to === 'rejected' ? 'Reject this booking?' : 'Cancel this booking?'}
          description={`${asking.reservation.customer_name || 'Guest'} · ${
            new Date(asking.reservation.reserved_at).toLocaleString([], {
              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
            })} · ${asking.reservation.party_size} guests. The table is freed immediately.`}
          confirmLabel={asking.to === 'rejected' ? 'Reject booking' : 'Cancel booking'}
          cancelLabel="Keep the booking"
          tone="danger"
          reason={{ label: 'Reason for the guest', placeholder: 'Fully booked, closed for a private event…' }}
          busy={Boolean(busy)}
          onCancel={() => setAsking(null)}
          onConfirm={(text) => act(asking.reservation, asking.to, text)}
        />
      )}

      {view === 'timeline' && locationId && (
        <TimelineDesk locationId={locationId} date={day} query={query} />
      )}
      {view === 'waitlist' && locationId && <WaitlistPanel locationId={locationId} />}
      {view === 'floor' && locationId && <FloorPlanEditor locationId={locationId} />}
      {/* Аналитика намеренно смотрит на всю организацию: сравнение точек
          и есть её смысл, поэтому выбранная точка тут не сужает данные. */}
      {view === 'analytics' && <ReserveAnalytics locations={context.locations || []} />}

      {view === 'list' && (
      <section className="panel form-panel reservation-list-panel">
        <div className="panel-heading">
          <div>
            <h2>Requests</h2>
            <p>New booking requests appear instantly with a chime.</p>
          </div>
          <button type="button" className="icon-button" aria-label="Refresh" onClick={() => refresh()}>
            <RefreshCw />
          </button>
        </div>
        {data === null ? (
          <p className="empty-state">Loading…</p>
        ) : pending.length === 0 ? (
          <p className="empty-state">
            {query.trim() ? `No pending request matches “${query.trim()}”.` : 'No pending requests.'}
          </p>
        ) : (
          <div className="order-grid">
            {pending.map((reservation) => (
              <ReservationCard
                key={reservation.id}
                reservation={reservation}
                busyAction={busy?.id === reservation.id ? busy.to : null}
                onAction={act}
              />
            ))}
          </div>
        )}
      </section>
      )}

      {view === 'list' && (
      <section className="panel form-panel reservation-list-panel">
        <div className="panel-heading">
          <div><h2>Upcoming & today</h2><p>Confirmed visits from today onwards.</p></div>
        </div>
        {data === null ? (
          <p className="empty-state">Loading…</p>
        ) : confirmed.length === 0 ? (
          <p className="empty-state">
            {query.trim() ? `No visit matches “${query.trim()}”.` : 'No confirmed visits yet.'}
          </p>
        ) : (
          <div className="order-grid">
            {confirmed.map((reservation) => (
              <ReservationCard
                key={reservation.id}
                reservation={reservation}
                busyAction={busy?.id === reservation.id ? busy.to : null}
                onAction={act}
              />
            ))}
          </div>
        )}
      </section>
      )}

      {view === 'list' && history.length > 0 && (
        <section className="panel form-panel reservation-list-panel">
          <div className="panel-heading">
            <div><h2>Recent history</h2><p>Completed, no-show, rejected and cancelled bookings.</p></div>
          </div>
          <div className="order-grid is-history">
            {history.map((reservation) => (
              <ReservationCard key={reservation.id} reservation={reservation} busyAction={null} onAction={() => {}} />
            ))}
          </div>
        </section>
      )}
    </>
  )
}
