import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarDays, ChevronRight, Info,
  Minus, MonitorSmartphone, QrCode, ShoppingBag, Wifi,
} from 'lucide-react'
import {
  attentionItems, chartSummary, dayStamp, fetchDaySales, fleetSummary, heroKind,
  hourlyComparison, loadDashboard, ordersSummary, reservationsSummary, timeLabel,
  todayBars, todayLabel,
} from './dashboard'
import { deviceStatus, lastSeenLabel, STATUS_LABEL } from './devices'
import { elapsedLabel } from './orders-inbox'
import { formatMoney } from './sales'
import { hasCapability } from './navigation'
import { PUBLIC_MENU_ORIGIN } from './online'
import { Button } from './ui/Button'
import { EmptyState, PageHeader, Panel, StatusBadge } from './ui/Layout'
import PartyCount from './ui/PartyCount'
import Skeleton, { SkeletonBar, SkeletonPanel } from './ui/Skeleton'

/**
 * Главная кабинета: как идёт день и что требует решения.
 *
 * Редизайн по `docs/claude-dashboard-redesign-plan.md`. Прежний экран был
 * стопкой из восьми панелей и открывался обычно пустым «Needs attention»,
 * за ним шли четыре карточки-счётчика, а под ними — копия сайдбара
 * «Quick access» и карточка продуктов. Первый экран уходил на то, что
 * ничего не случилось.
 *
 * Теперь порядок ответов такой: что требует решения → как идёт день →
 * где стоит живая работа → что только что произошло.
 *
 * Правило, которое важнее вёрстки, не изменилось: показываем ТОЛЬКО то,
 * что есть на сервере, и каждый виджет привязан к capability. Menu-клиент
 * не увидит смену на кассе, Reserve-клиент — выручку.
 */

// ── Требует внимания ────────────────────────────────────────

const ATTENTION_ICON = { alert: AlertTriangle, warn: AlertTriangle, info: Info }

/**
 * Список решений. Панели с заголовком и описанием у него больше нет:
 * пустой список — обычный день, и он не должен занимать пол-экрана,
 * чтобы сообщить, что новостей нет. Место при этом фиксированное —
 * владелец всегда знает, куда смотреть.
 */
function Attention({ items, onNavigate }) {
  if (items.length === 0) {
    return (
      <p className="dash-clear">
        <Info aria-hidden /> Nothing needs a decision right now.
      </p>
    )
  }
  return (
    <section className="dash-attention" aria-label="Needs attention">
      {items.map((item) => {
        const Icon = ATTENTION_ICON[item.tone] || Info
        return (
          <div className={`dash-attention-row is-${item.tone}`} key={item.id}>
            <span className="dash-attention-icon" aria-hidden><Icon /></span>
            <span className="dash-attention-text">
              <strong>{item.title}</strong>
              {item.detail && <small>{item.detail}</small>}
            </span>
            {item.action && (
              <Button
                variant="secondary"
                onClick={() => onNavigate(item.action.view, null, item.action.tab)}
              >
                {item.action.label}
              </Button>
            )}
          </div>
        )
      })}
    </section>
  )
}

// ── Как идёт день ───────────────────────────────────────────

const DELTA_ICON = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus }

/**
 * Кривая дня. Не интерактивна намеренно: разбирать день по часам умеет
 * Sales, здесь нужен только его силуэт. Столбики для читалки — пустое
 * место, поэтому та же информация лежит рядом словами.
 */
function DayCurve({ bars, comparison }) {
  const top = bars.reduce((max, bar) => Math.max(max, bar.amount), 0)
  const Icon = comparison ? (DELTA_ICON[comparison.direction] || Minus) : null
  return (
    <div className="dash-curve">
      <p className="visually-hidden">{chartSummary(bars, formatMoney)}</p>
      <div className="dash-curve-bars" aria-hidden>
        {bars.map((bar, index) => (
          <span
            className={`dash-curve-bar${index === bars.length - 1 ? ' is-now' : ''}`}
            key={bar.key}
            title={`${bar.full} · ${formatMoney(bar.amount)}`}
            style={{ '--h': `${top > 0 ? Math.max(2, Math.round((bar.amount / top) * 100)) : 2}%` }}
          />
        ))}
      </div>
      <p className="dash-curve-line">
        <span className="dash-curve-title">Sales by hour</span>
        {comparison && (
          <>
            {/* Процент подписан почасовыми продажами, а не чистой выручкой
                над ним: в by_hour нет возвратов, и приписать его чистой
                выручке значило бы сказать неправду о другом числе.
                Класс общий с Sales: направление там читается знаком,
                словом и стрелкой — здесь ровно то же. */}
            <span className={`stat-delta is-${comparison.direction}`}>
              <Icon aria-hidden /> {comparison.text}
            </span>
            <span className="dash-curve-vs">vs yesterday by {comparison.at}</span>
          </>
        )}
      </p>
    </div>
  )
}

/**
 * Блок «сегодня». У кассы день меряется деньгами, у standalone-заказов —
 * очередью, у Reserve — визитами; Menu-клиенту мерить нечем, и блока у
 * него нет вовсе (`heroKind` вернёт null, а выдуманный ноль хуже пустоты).
 */
function Today({ label, value, curve, bars, comparison, strip, loading, failed }) {
  // Упавший отчёт — не пустой день: «продаж пока нет» было бы сообщением
  // о нуле, которого никто не проверял. Про отказ сказано в строке дня.
  const showCurve = curve && !failed
  return (
    <section className="dash-today" aria-label="Today">
      {/* Число слева, день справа — та же раскладка, что у отчёта Sales:
          два экрана про одну выручку не должны читаться по-разному. Без
          кривой колонка одна, иначе пустая половина с разделителем. */}
      <div className={`dash-today-top${showCurve ? '' : ' is-solo'}`}>
        <div className="dash-today-head">
          <p className="dash-today-label">{label}</p>
          <p className="dash-today-value">{value}</p>
        </div>
        {showCurve && (
          bars.length > 0
            ? <DayCurve bars={bars} comparison={comparison} />
            : <p className="empty-state dash-today-empty">
                {loading ? 'Loading…' : 'No sales yet today.'}
              </p>
        )}
      </div>
      {strip.length > 0 && (
        <p className="dash-today-strip">
          {strip.map((part, index) => (
            <span key={part}>{index > 0 && <i aria-hidden>·</i>}{part}</span>
          ))}
        </p>
      )}
    </section>
  )
}

// ── Экран ───────────────────────────────────────────────────

export default function HomeDashboard({ context, locationId, onNavigate, children }) {
  const [data, setData] = useState(null)
  const [yesterday, setYesterday] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.now())

  const locations = useMemo(() => context.locations || [], [context])
  const location = locations.find((l) => l.id === locationId) || locations[0] || null
  const tz = location?.timezone || undefined

  /**
   * Вчерашний день уже не изменится, поэтому его отчёт тянется один раз
   * на день и точку: тихое обновление раз в минуту его не трогает. Ключ
   * меняется — сравнение сбрасывается, иначе на новой точке несколько
   * секунд висел бы процент от старой.
   */
  const yesterdayRef = useRef({ key: null, report: null })

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    try {
      setData(await loadDashboard(context, locationId, { tz }))
      const stamp = Date.now()
      setNow(stamp)

      if (!hasCapability(context, 'pos_reports')) {
        yesterdayRef.current = { key: null, report: null }
        setYesterday(null)
        return
      }
      const key = `${dayStamp(stamp, tz)}|${locationId || ''}`
      if (yesterdayRef.current.key !== key) {
        yesterdayRef.current = { key, report: null }
        setYesterday(null)
      }
      if (!yesterdayRef.current.report) {
        try {
          const report = await fetchDaySales(locationId, { tz, offsetDays: -1 })
          yesterdayRef.current = { key, report }
          setYesterday(report)
        } catch {
          // Сравнение необязательно: без него блок «сегодня» живёт целиком,
          // а неверный процент был бы хуже отсутствующего.
          setYesterday(null)
        }
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [context, locationId, tz])

  useEffect(() => {
    load()
    // Пока экран открыт — тихо освежаем: заказ и бронь приходят без нас
    const timer = setInterval(() => load(true), 60_000)
    return () => clearInterval(timer)
  }, [load])

  const can = (capability) => hasCapability(context, capability)
  const orders = ordersSummary(data?.orders, now, tz)
  const bookings = reservationsSummary(data?.reservations, now)
  const fleet = fleetSummary(data?.fleet)
  const summary = data?.sales?.summary
  const openShift = (data?.shifts || []).find((s) => s.location_id === location?.id) || null
  // Точку в строке кассы называем только там, где точек несколько:
  // одинокому владельцу «Стойка 2 · Пинскер 29» ничего не уточняет.
  const manyLocations = locations.length > 1

  const attention = useMemo(() => (data ? attentionItems({
    context,
    fleet: data.fleet,
    orders: data.orders,
    reservations: data.reservations,
    shifts: data.shifts,
    channels: data.channels,
    locations,
    nowMs: now,
    tz,
  }) : []), [data, context, locations, now, tz])

  const kind = heroKind(context)
  const bars = useMemo(
    () => (kind === 'sales' ? todayBars(data?.sales, now, tz) : []),
    [kind, data, now, tz]
  )
  const comparison = useMemo(
    () => (kind === 'sales' ? hourlyComparison(data?.sales, yesterday, now, tz) : null),
    [kind, data, yesterday, now, tz]
  )

  // Тихая полоса под главным числом: то, что раньше стояло отдельными
  // карточками и спорило с ним за внимание.
  const strip = (() => {
    const parts = []
    if (kind === 'sales') {
      if (summary) {
        parts.push(`${summary.orders_count ?? 0} orders`)
        parts.push(`avg ${formatMoney(summary.avg_check)}`)
      }
      if (can('pos_operate')) {
        parts.push(openShift
          ? `shift open since ${timeLabel(openShift.opened_at, tz)}`
          : 'shift closed')
      }
    } else if (kind === 'orders' && orders) {
      parts.push(`${orders.waiting} waiting`)
      parts.push(`${orders.inProgress} in progress`)
      parts.push(`${orders.ready} ready`)
      if (orders.oldestAt) parts.push(`longest wait ${elapsedLabel(orders.oldestAt, now)}`)
    } else if (kind === 'bookings' && bookings) {
      parts.push(`${bookings.guests} guests expected`)
      if (bookings.next) parts.push(`next at ${timeLabel(bookings.next.reserved_at, tz)}`)
    }
    return parts
  })()

  // Главное число дня. У продаж оно может не приехать (упавший отчёт) —
  // тогда честный прочерк, но никогда не ноль.
  const HERO_LABEL = { sales: 'Net sales', orders: 'Online orders today', bookings: 'Bookings today' }
  const heroValue = (() => {
    if (kind === 'sales') {
      if (!summary) return loading ? '…' : '—'
      return formatMoney(summary.gross_sales - summary.refunds)
    }
    if (kind === 'orders') return orders?.today ?? '—'
    if (kind === 'bookings') return bookings?.today ?? '—'
    return '—'
  })()

  return (
    <>
      <PageHeader title="Dashboard">
        {/* День и время последнего успешного обновления — данные, за
            которые отвечают числа ниже. Точка отсюда ушла в шапку
            кабинета, где её можно переключить. */}
        <p className="dash-day">
          {todayLabel(now, tz)}
          <span className="dash-updated">updated {timeLabel(new Date(now).toISOString(), tz)}</span>
          {/* Частичный отказ — состояние продукта, а не ошибка: остальные
              виджеты обязаны остаться на экране. */}
          {data?.failed?.length > 0 && (
            <span className="dash-partial">
              <AlertTriangle aria-hidden /> Some data could not be loaded
            </span>
          )}
          {error && <span className="dash-partial">{error}</span>}
        </p>
      </PageHeader>

      {loading && !data ? (
        /* Форма дня: блок «сегодня» с кривой и две колонки карточек —
           ровно то, что придёт. Со строкой «Loading…» рабочая область
           вырастала с 427 до 1479px в момент прихода данных. */
        <Skeleton label="Loading today’s numbers…">
          <SkeletonPanel height={168}>
            <SkeletonBar width="20%" />
            <SkeletonBar width="34%" height={30} />
            <SkeletonBar width="100%" height={54} />
          </SkeletonPanel>
          <div className="sk-split">
            <SkeletonPanel height={232}>
              <SkeletonBar width="26%" height={16} />
              {[68, 54, 60, 46].map((w) => (
                <div className="sk-row" key={w} style={{ height: 40, padding: 0, border: 0 }}>
                  <SkeletonBar width={`${w}%`} />
                </div>
              ))}
            </SkeletonPanel>
            <SkeletonPanel height={232}>
              <SkeletonBar width="40%" height={16} />
              {[72, 58, 64].map((w) => (
                <div className="sk-row" key={w} style={{ height: 40, padding: 0, border: 0 }}>
                  <SkeletonBar width={`${w}%`} />
                </div>
              ))}
            </SkeletonPanel>
          </div>
        </Skeleton>
      ) : (
        <>
          <Attention items={attention} onNavigate={onNavigate} />

          {kind && (
            <Today
              label={HERO_LABEL[kind]}
              value={heroValue}
              curve={kind === 'sales'}
              bars={bars}
              comparison={comparison}
              strip={strip}
              loading={loading}
              failed={data?.failed?.includes('sales')}
            />
          )}

          <div className="dash-grid">
            {can('orders_desk') && orders && (
              <Panel
                title="Orders"
                actions={<Button variant="text" onClick={() => onNavigate('orders')}>View orders <ChevronRight /></Button>}
              >
                <div className="data-list">
                  <div className="data-row">
                    <span>Waiting for an answer</span><strong>{orders.waiting}</strong>
                  </div>
                  <div className="data-row"><span>In progress</span><strong>{orders.inProgress}</strong></div>
                  <div className="data-row"><span>Ready for pickup</span><strong>{orders.ready}</strong></div>
                  {orders.oldestAt && (
                    <div className="data-row">
                      <span>Longest wait</span><strong>{elapsedLabel(orders.oldestAt, now)}</strong>
                    </div>
                  )}
                </div>
              </Panel>
            )}

            {can('reservations_desk') && bookings && (
              <Panel
                title="Reservations"
                actions={<Button variant="text" onClick={() => onNavigate('reservations')}>View timeline <ChevronRight /></Button>}
              >
                {bookings.upcoming.length === 0 ? (
                  <EmptyState>
                    {bookings.today > 0 ? 'Every booking for today has already started.' : 'No bookings for today.'}
                  </EmptyState>
                ) : (
                  <div className="data-list">
                    {bookings.upcoming.map((visit) => (
                      <div className="data-row" key={visit.id}>
                        <span>
                          <strong>{timeLabel(visit.reserved_at, tz)}</strong> · {visit.customer_name || 'Guest'}
                        </span>
                        <span>
                          <PartyCount n={visit.party_size} />
                          {visit.status === 'new' && <small> · to confirm</small>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {/* Итог дня стоит и тогда, когда ближайших визитов уже нет:
                    «сколько сегодня всего» — это число из убранной карточки,
                    и терять его вместе со списком нельзя. */}
                {bookings.today > 0 && (
                  <div className="data-list">
                    <div className="data-row dash-row-total">
                      <span>Today</span>
                      <strong>{bookings.today} bookings · {bookings.guests} guests</strong>
                    </div>
                  </div>
                )}
              </Panel>
            )}

            {can('pos_operate') && fleet && (
              <Panel
                title="Devices"
                actions={<Button variant="text" onClick={() => onNavigate('devices')}>Manage devices <ChevronRight /></Button>}
              >
                <div className="data-list">
                  <div className="data-row">
                    <span><Wifi aria-hidden /> On line</span><strong>{fleet.online} of {fleet.total}</strong>
                  </div>
                  {fleet.worst && (
                    <div className="data-row">
                      {/* Парк — общий по организации, и молчащая касса в
                          другой точке остаётся проблемой владельца. Чтобы
                          строка не выглядела принадлежащей выбранной точке,
                          у сети она называет свою. */}
                      <span>
                        {fleet.worst.name || 'Register'}
                        {manyLocations && fleet.worst.location_name && (
                          <small> · {fleet.worst.location_name}</small>
                        )}
                      </span>
                      <StatusBadge
                        className="device-status"
                        tone={deviceStatus(fleet.worst)}
                        label={`${STATUS_LABEL[deviceStatus(fleet.worst)]} · ${lastSeenLabel(fleet.worst)}`}
                      />
                    </div>
                  )}
                  {fleet.problems === 0 && (
                    <div className="data-row"><span>Nothing needs a visit</span><strong>✓</strong></div>
                  )}
                </div>
              </Panel>
            )}

            {data?.channels && (
              <Panel
                title="Online channels"
                /* Каналы разъехались по своим разделам, и одна кнопка
                   «Manage channels» вела бы из карточки про оба только в
                   меню. Кнопка на канал — и ровно те, что у аккаунта есть. */
                actions={(
                  <>
                    {can('public_menu') && (
                      <Button variant="text" onClick={() => onNavigate('online')}>
                        QR menu <ChevronRight />
                      </Button>
                    )}
                    {can('public_reservations') && (
                      <Button variant="text" onClick={() => onNavigate('reserve')}>
                        QR bookings <ChevronRight />
                      </Button>
                    )}
                  </>
                )}
              >
                <div className="data-list">
                  {can('online_orders') && (
                    <div className="data-row">
                      <span><ShoppingBag aria-hidden /> Online ordering</span>
                      <StatusBadge
                        tone={data.channels.orders ? 'on' : 'off'}
                        label={data.channels.orders ? 'On' : 'Off'}
                      />
                    </div>
                  )}
                  {can('public_reservations') && (
                    <div className="data-row">
                      <span><CalendarDays aria-hidden /> Table booking</span>
                      <StatusBadge
                        tone={data.channels.reservations ? 'on' : 'off'}
                        label={data.channels.reservations ? 'On' : 'Off'}
                      />
                    </div>
                  )}
                  <div className="data-row">
                    <span><QrCode aria-hidden /> Guest page</span>
                    {/* Открываем ту страницу, которая у аккаунта есть:
                        точке с одной бронью ссылка на /order вела в меню,
                        которого она не покупала. */}
                    <a
                      className="text-button"
                      href={`${PUBLIC_MENU_ORIGIN}/${can('public_menu') ? 'order' : 'reserve'}/${data.channels.slug || data.channels.locationId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open as guest
                    </a>
                  </div>
                </div>
              </Panel>
            )}

            {!can('pos_operate') && !can('orders_desk') && !can('reservations_desk') && (
              <Panel title="Devices">
                <EmptyState>
                  <MonitorSmartphone aria-hidden /> This workspace has no register — everything runs from here.
                </EmptyState>
              </Panel>
            )}
          </div>
        </>
      )}

      {/* Журнал «что только что произошло» — последним: он про прошлое,
          а экран отвечает на вопрос о настоящем. */}
      {children}
    </>
  )
}
