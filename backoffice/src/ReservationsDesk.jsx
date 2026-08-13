import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, DoorOpen, Plus } from 'lucide-react'
import { supabase } from './supabase'
import { fetchDesk, deskErrorText } from './reservations'
import { shiftDate, todayInZone } from './timeline'
import { dayDataWindow, rangeDataWindow, toTable } from './visit'
import { playNewOrderChime } from './orders'
import TimelineDesk from './TimelineDesk'
import ReservationList, { RANGES } from './ReservationList'
import WaitlistPanel from './WaitlistPanel'
import FloorPlanEditor from './FloorPlanEditor'
import ReserveAnalytics from './ReserveAnalytics'
import LaunchChecklist from './LaunchChecklist'
import BookingForm from './BookingForm'
import Tabs from './ui/Tabs'
import { IconButton } from './ui/Button'
import { fetchLocationSlug } from './settings'
import { SearchField } from './ui/Layout'

/**
 * «Reservations» — веб-стол хостес (Kassa 102): подтверждение, отказ,
 * завершение визита и no-show без POS-устройства и PIN. Посаженные на
 * кассе брони (order_id) показываются read-only — их визит живёт в
 * POS-заказе (seat_reservation 057), веб его не трогает.
 *
 * ЗАГРУЗКА ЖИВЁТ ЗДЕСЬ, И ЭТО ГЛАВНОЕ ИЗМЕНЕНИЕ.
 *
 * Раньше данные тянули четверо: раздел (заявки дня), полотно
 * (настройки + столы + зоны + брони), список (то же самое ещё раз) и
 * лист ожидания (столы в третий раз). Один рендер стоил четырнадцати
 * запросов, каждый держал СВОЮ realtime-подписку на `reservations`, и
 * одно событие перезапускало все четыре загрузки.
 *
 * Теперь окно данных считает раздел, сервер отвечает одной моделью
 * (152), а вкладки — представления над ней. Подписка одна.
 *
 * Вид «Floor plan» (123) стоит здесь же, а не в настройках: пустой
 * таймлайн чинится столами, и путь от проблемы к её причине должен быть
 * в один тап.
 */

const VIEWS = [
  { key: 'timeline', label: 'Timeline' },
  { key: 'list', label: 'List' },
  { key: 'waitlist', label: 'Waitlist' },
  { key: 'floor', label: 'Tables & zones' },
  { key: 'analytics', label: 'Analytics' },
]

/** Вкладки, которым нужны визиты; остальным хватает столов и зон */
const NEEDS_VISITS = new Set(['timeline', 'list'])

export default function ReservationsDesk({
  context, locationId, tab, onTabChange, date, onDateChange,
  filters = {}, onFiltersChange,
}) {
  const [desk, setDesk] = useState(null)
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
  const knownIds = useRef(new Set())

  /*
   * Часовой пояс приезжает В ОТВЕТЕ, поэтому до первого ответа берётся
   * дефолт — но окно ЗАПРОСА от пояса не зависит вовсе (`visit.js`).
   * Иначе пришлось бы спрашивать сервер дважды: сначала «какой у тебя
   * пояс», потом «дай визиты» — ровно так полотно и грузилось по два
   * раза при каждом открытии.
   */
  const tz = desk?.timezone || 'Asia/Jerusalem'

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

  const range = RANGES.find((r) => r.key === filters.rg) ?? RANGES[0]

  const window = useMemo(() => {
    if (view === 'timeline') return dayDataWindow(day)
    if (view === 'list') return rangeDataWindow(today, range.days)
    // Вкладкам без визитов нужны столы и зоны — их отдаёт та же модель,
    // поэтому окно берётся минимальным, а не выключается отдельным флагом.
    return dayDataWindow(today, 0)
  }, [view, day, today, range.days])

  useEffect(() => {
    if (!locationId) return undefined
    let alive = true
    fetchLocationSlug(locationId)
      .then((s) => { if (alive) setSlug(s) })
      .catch(() => { if (alive) setSlug(null) })
    return () => { alive = false }
  }, [locationId])

  // Ответ на устаревший запрос не должен переписать стол: при быстрой
  // смене дат сеть возвращает их в произвольном порядке.
  const requestRef = useRef(0)

  const load = useCallback(async (withSound = false) => {
    if (!locationId || !window) return
    const ticket = requestRef.current + 1
    requestRef.current = ticket
    try {
      const next = await fetchDesk(locationId, window.fromMs, window.toMs)
      if (requestRef.current !== ticket) return
      setDesk(next)
      setError('')
      const visits = next.visits ?? []
      if (withSound) {
        const fresh = visits.some((v) => v.status === 'new' && !knownIds.current.has(v.id))
        if (fresh) playNewOrderChime()
      }
      knownIds.current = new Set(visits.map((v) => v.id))
    } catch (e) {
      if (requestRef.current !== ticket) return
      setError(deskErrorText(e.message))
    }
  }, [locationId, window])

  useEffect(() => {
    if (!locationId) return undefined
    /*
     * Скелет показывается только когда МЕНЯЕТСЯ ТО, ЧТО СМОТРЯТ: точка,
     * вкладка или день. Realtime и поллинг подменяют данные на месте —
     * иначе стол мигал бы скелетом каждую минуту и на каждой чужой
     * брони, теряя прокрутку под пальцем.
     */
    setDesk(null)
    knownIds.current = new Set()
    load()
    const channel = supabase
      .channel(`reservations-desk-${locationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reservations', filter: `location_id=eq.${locationId}` },
        () => load(true)
      )
      .subscribe()
    const timer = setInterval(() => load(true), 60000)
    return () => {
      supabase.removeChannel(channel)
      clearInterval(timer)
    }
  }, [locationId, load])

  const tables = useMemo(() => (desk?.tables ?? []).map(toTable), [desk])
  const visits = desk?.visits ?? []

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
          bookings={visits}
          tz={tz}
          mode={creating}
          onClose={() => setCreating(null)}
          onCreated={() => { setCreating(null); load() }}
        />
      )}

      {view === 'timeline' && locationId && (
        <TimelineDesk
          locationId={locationId}
          date={day}
          desk={desk}
          tables={tables}
          tz={tz}
          onReload={load}
        />
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
        <WaitlistPanel locationId={locationId} date={today} query={query} tables={tables} />
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
          desk={desk}
          tables={tables}
          tz={tz}
          onReload={load}
        />
      )}
    </>
  )
}
