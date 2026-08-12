import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, DoorOpen, Plus } from 'lucide-react'
import { supabase } from './supabase'
import { fetchReservations } from './reservations'
import { shiftDate, todayInZone } from './timeline'
import { playNewOrderChime } from './orders'
import TimelineDesk from './TimelineDesk'
import ReservationList from './ReservationList'
import WaitlistPanel from './WaitlistPanel'
import FloorPlanEditor from './FloorPlanEditor'
import ReserveAnalytics from './ReserveAnalytics'
import LaunchChecklist from './LaunchChecklist'
import BookingForm from './BookingForm'
import Tabs from './ui/Tabs'
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

export default function ReservationsDesk({
  context, locationId, tab, onTabChange, date, onDateChange,
  filters = {}, onFiltersChange,
}) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
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
  const [tables, setTables] = useState([])
  const [tz, setTz] = useState('Asia/Jerusalem')
  const knownIds = useRef(new Set())

  /*
   * Календарный день принадлежит только полотну: там столы действительно
   * смотрят на конкретную смену. List — ближайшие брони от сегодняшнего
   * дня, Waitlist — живая очередь прямо сейчас. Общий календарь над
   * всеми тремя вкладками превращал очередь в бессмысленный архив.
   */
  const today = todayInZone(Date.now(), tz)
  const day = date || today
  const setDay = (next) => onDateChange?.(next === today ? null : next)
  const [query, setQuery] = useState('')
  const showsOperationalTools = view === 'timeline' || view === 'list' || view === 'waitlist'

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

  /*
   * Список визитов дня остаётся загруженным ради двух вещей: звонка о
   * новой заявке и подсказок формы ручной брони — она предлагает
   * альтернативы из тех же визитов, что уже на экране.
   */
  const active = data?.active ?? []

  return (
    <>
      {/*
        Одна рабочая строка вместо титульного заголовка на 40px, описания
        в две строки и отдельной полосы кнопок: раздел хостес открывают,
        чтобы увидеть день, а не прочитать, что это раздел броней.

        Гость по телефону и гость с улицы — обычная работа хостес, а не
        повод идти к кассе, поэтому оба действия стоят здесь.
      */}
      <div className="rsv-title-row">
        <h1>Reservations</h1>
      </div>

      {/* Сначала выбирают режим работы, затем видят только его инструменты. */}
      <Tabs
        className="desk-tabs"
        label="Reservations view"
        items={VIEWS}
        value={view}
        onChange={setView}
      />

      {showsOperationalTools && (
        <div className="rsv-header">
          {(view === 'timeline' || view === 'list') && (
            <div className="rsv-header-actions">
              {view === 'timeline' && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!locationId}
                  onClick={() => setCreating('walk-in')}
                >
                  <DoorOpen /> Walk-in
                </button>
              )}
              <button
                type="button"
                className="primary-button compact"
                disabled={!locationId}
                onClick={() => setCreating('booking')}
              >
                <Plus /> New reservation
              </button>
            </div>
          )}

          {view === 'timeline' && (
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
          )}

          {(view === 'list' || view === 'waitlist') && (
            <SearchField
              label="Search reservations"
              value={query}
              onChange={setQuery}
              placeholder="Guest name or phone"
            />
          )}

        </div>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

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

      {view === 'timeline' && locationId && (
        <TimelineDesk locationId={locationId} date={day} />
      )}

      {/* Настройка публичной страницы не должна стоять между хостес и
          залом. Чеклист остаётся доступным, но идёт после рабочего
          полотна — на телефоне первой видна именно таблица броней. */}
      {locationId && view === 'timeline' && (
        <LaunchChecklist
          locationId={locationId}
          locationSlug={slug}
          onGo={setView}
        />
      )}
      {view === 'waitlist' && locationId && (
        <WaitlistPanel locationId={locationId} date={today} query={query} />
      )}
      {view === 'floor' && locationId && <FloorPlanEditor locationId={locationId} />}
      {/* Аналитика намеренно смотрит на всю организацию: сравнение точек
          и есть её смысл, поэтому выбранная точка тут не сужает данные. */}
      {view === 'analytics' && <ReserveAnalytics locations={context.locations || []} />}

      {view === 'list' && locationId && (
        <ReservationList
          locationId={locationId}
          date={today}
          query={query}
          filters={filters}
          onFilters={onFiltersChange}
        />
      )}
    </>
  )
}
