import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown, ArrowUp, ChevronDown, CreditCard, Download, Minus,
  ShoppingBag, Store, Users, Utensils,
} from 'lucide-react'
import {
  PERIODS, barShare, barsFor, chartMode, chartScale, chartTitle, fetchSalesReport,
  formatMoney, locationsSummary, methodLabel, ordersLabel, periodRange,
  previousRange, previousName, PREVIOUS_LABEL, delta, scopeLine, channelLabel,
  orderTypeLabel, salesToCsv, salesFileName,
} from './sales'
import { ErrorText, PageHeader } from './ui/Layout'
import { Button } from './ui/Button'
import Tabs from './ui/Tabs'
import Skeleton, { SkeletonBar, SkeletonPanel } from './ui/Skeleton'

/**
 * «Sales» — выручка владельца. Данные из sales_report (089, членство вместо
 * PIN; охват и разрезы — 133). Периоды: сегодня / 7 дней / месяц / год /
 * произвольные даты; график — по часам, дням или месяцам.
 *
 * Число здесь всегда подписано: период, точки, зона времени и валюта
 * приходят с сервера в блоке scope и стоят прямо под переключателями.
 * Рядом с итогами — сравнение с сопоставимым прошлым периодом.
 *
 * Редизайн по `docs/claude-sales-approved-redesign-plan.md`. Прежний
 * экран отвечал на вопросы по очереди и вразнобой: тёмная плита с
 * выручкой, под ней три карточки на 108px, ещё ниже — график, и чтобы
 * увидеть «сколько и когда», приходилось прокручивать. Теперь главное
 * стоит на одной поверхности: слева чистая выручка со сравнением, справа
 * график того же периода, под ними тихая полоса «валовая / заказы /
 * средний чек» и, если они есть, скидки с возвратами.
 *
 * Считает по-прежнему СЕРВЕР. Ни одна цифра здесь не пересчитывается:
 * чистая выручка — это gross_sales − refunds, ровно как в выгрузке.
 */

/** Направление сравнения — знаком, словом и стрелкой, но не одним цветом */
const DELTA_ICON = { up: ArrowUp, down: ArrowDown, flat: Minus }

function Delta({ current, previous, label }) {
  if (previous === null || previous === undefined) return null
  const d = delta(current, previous)
  const Icon = DELTA_ICON[d.direction] || Minus
  return (
    <span className={`stat-delta is-${d.direction}`}>
      <Icon aria-hidden />
      {d.text} <small>{label}</small>
    </span>
  )
}

/**
 * Выбор точек: компактный переключатель вместо ленты чипов.
 *
 * Множественность сохранена целиком — это отчёт сети, и «Ротшильд плюс
 * Дизенгоф» обязано остаться возможным выбором. Внутри настоящие
 * чекбоксы: кнопка с aria-pressed выглядит для читалки как переключатель
 * без группы, а здесь важно, что выбранных может быть несколько.
 */
function LocationPicker({ locations, value, onChange, disabled }) {
  const ref = useRef(null)
  const [open, setOpen] = useState(false)
  const summary = locationsSummary(locations, value)

  useEffect(() => {
    if (!open) return undefined
    function onDocClick(event) {
      if (!ref.current?.contains(event.target)) setOpen(false)
    }
    function onKey(event) {
      if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) }
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  function toggle(id) {
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  }

  return (
    <div className="sales-locations" ref={ref}>
      <button
        type="button"
        className="sales-picker"
        aria-haspopup="true"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <Store aria-hidden />
        <span className="visually-hidden">Locations in this report:</span>
        <span className="truncate">{summary}</span>
        <ChevronDown aria-hidden className="sales-picker-caret" />
      </button>
      {open && (
        <div className="sales-loc-pop" role="group" aria-label="Locations in this report">
          {/* «Все точки» — не пункт наравне с остальными, а сброс выбора:
              сервер понимает пустой список именно так. */}
          <label className="sales-loc-option">
            <input
              type="checkbox"
              checked={value.length === 0}
              onChange={() => onChange([])}
            />
            <span>All locations</span>
          </label>
          {locations.map((l) => (
            <label className="sales-loc-option" key={l.id}>
              <input
                type="checkbox"
                checked={value.includes(l.id)}
                onChange={() => toggle(l.id)}
              />
              <span className="truncate">{l.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * График периода.
 *
 * Ось непрерывна (пустые часы и дни занимают свои места — иначе три
 * торговых дня растянутся на весь месяц), шкала «круглая» и подписана,
 * а выбранный интервал называется точно: время, сумма и сколько заказов.
 *
 * С клавиатуры вход в график ОДИН, дальше стрелки: у произвольного
 * диапазона столбиков бывает триста шестьдесят пять, и триста шестьдесят
 * пять остановок Tab — это не доступность, а ловушка. Ось всегда LTR
 * (см. `.chart-bars` в стилях), поэтому «вправо» и в иврите означает
 * следующий интервал.
 */
function SalesChart({ bars, title, loading = false }) {
  const maxAmount = bars.reduce((m, b) => Math.max(m, b.amount), 0)
  // Пиковый столбик подсвечиваем только если продажи вообще были
  const maxIdx = maxAmount > 0 ? bars.findIndex((b) => b.amount === maxAmount) : -1
  const [picked, setPicked] = useState(null)
  const activeIdx = picked !== null && bars[picked] ? picked : maxIdx
  const readout = activeIdx >= 0 ? bars[activeIdx] : null
  const scale = chartScale(maxAmount)
  const scrollRef = useRef(null)
  const barsRef = useRef(null)
  const [width, setWidth] = useState(0)

  useEffect(() => { setPicked(null) }, [bars])

  // Замер ширины скроллера. Зависимость от bars важна: элемент появляется
  // только после загрузки данных, при пустом [] ref ещё null и observer
  // никогда не подключался — из-за этого прокрутка не включалась.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return undefined
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    setWidth(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [bars.length])

  // Столбику нужно минимум 30px. Не влезает — включаем прокрутку и
  // показываем все подписи; влезает — прежнее поведение.
  const MIN_BAR = 30
  const scrolls = width > 0 && bars.length * MIN_BAR > width
  const fit = width > 0 ? Math.max(1, Math.floor(width / 26)) : bars.length
  const step = !scrolls && bars.length > fit ? Math.ceil(bars.length / fit) : 1

  function focusBar(index) {
    const button = barsRef.current?.querySelectorAll('.chart-bar')?.[index]
    if (!button) return
    button.focus()
    button.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  function onKeyDown(event, index) {
    const last = bars.length - 1
    let next = null
    if (event.key === 'ArrowRight') next = index + 1
    else if (event.key === 'ArrowLeft') next = index - 1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = last
    else if (event.key === 'Escape') { setPicked(null); return }
    if (next === null) return
    event.preventDefault()
    next = Math.min(last, Math.max(0, next))
    setPicked(next)
    focusBar(next)
  }

  return (
    <div className="sales-chart">
      <div className="sales-chart-head">
        <h2>{title}</h2>
        {readout && (
          <p className="chart-readout">
            {readout.full} · <strong>{formatMoney(readout.amount)}</strong>
            {' · '}{ordersLabel(readout.count)}
          </p>
        )}
      </div>
      {bars.length === 0 ? (
        // Пока отчёт не пришёл, «продаж нет» — не ответ, а догадка
        <p className="empty-state">{loading ? 'Loading…' : 'No sales in this period.'}</p>
      ) : (
        <div className="chart-frame">
          {/* Подписи шкалы стоят вне скроллера: столбики листаются, а
              «сколько это» остаётся на месте. */}
          <div className="chart-ticks" aria-hidden>
            {[...scale.ticks].reverse().map((t) => <span key={t}>{formatMoney(t)}</span>)}
          </div>
          {/* Скроллер: при 30+ точках столбики не сжимаются в ниточки,
              график листается пальцем. Ширина задаётся минимумом на столбик. */}
          <div className="chart-scroll" ref={scrollRef}>
            <div className={`chart-inner ${scrolls ? 'is-scrolling' : ''}`}
              style={{ '--bar-count': bars.length, '--min-bar': `${MIN_BAR}px` }}>
              <div className="chart-plot">
                <div className="chart-grid" aria-hidden>
                  {scale.ticks.map((t) => <i key={t} />)}
                </div>
                <div className="chart-bars" role="group" ref={barsRef}
                  aria-label={`${title}. Use arrow keys to read each interval`}>
                  {bars.map((b, i) => {
                    const height = barShare(b.amount, scale.top)
                    const active = i === activeIdx
                    return (
                      <button key={b.key} type="button" className="chart-bar"
                        // Один вход в группу, дальше стрелки
                        tabIndex={active ? 0 : -1}
                        aria-pressed={active}
                        aria-label={`${b.full}: ${formatMoney(b.amount)}, ${ordersLabel(b.count)}`}
                        onKeyDown={(event) => onKeyDown(event, i)}
                        onClick={() => setPicked(picked === i ? null : i)}>
                        <span className={active ? 'bar is-active' : 'bar'}
                          // Пустой интервал остаётся на оси, но столбика
                          // не рисует: ноль высотой в 3px — это не ноль
                          style={{ height: `${b.amount > 0 ? Math.max(height, 1.5) : 0}%` }} />
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="chart-axis">
                {bars.map((b, i) => {
                  const active = i === activeIdx
                  // При прокрутке подписи влезают все — прореживаем только
                  // если график целиком помещается в видимую ширину
                  const show = active || !scrolls || i % step === 0
                  return (
                    <span key={b.key} className={active ? 'is-active' : ''}>
                      {show ? b.label : ''}
                    </span>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Разрез: строка «имя — количество — сумма». Пустые не рисуем: у
 * Menu-only точки каналов нет, и выдумывать пустую панель незачем.
 *
 * `meter` — доля от крупнейшей строки. Полоса помогает увидеть
 * соотношение, но не заменяет число: сумма и счётчик стоят рядом и
 * остаются главными.
 */
function Breakdown({ icon: Icon, title, rows, meter = false, ranked = false, unit = 'order' }) {
  if (!rows?.length) return null
  const top = rows.reduce((m, r) => Math.max(m, r.amount ?? 0), 0)
  return (
    <section className="panel sales-panel">
      <div className="panel-heading"><div><h2><Icon aria-hidden /> {title}</h2></div></div>
      <div className="data-list">
        {rows.map((r, i) => (
          <div key={r.key} className={`data-row sales-row${meter ? ' has-meter' : ''}`}>
            {ranked && <span className="sales-rank" aria-hidden>{i + 1}.</span>}
            <span className="truncate sales-row-name">{r.label}</span>
            {meter && (
              <span className="sales-meter" aria-hidden
                style={{ '--share': `${barShare(r.amount, top)}%` }}><i /></span>
            )}
            <span className="sales-row-count">
              {unit === 'qty' ? `×${r.count ?? 0}` : ordersLabel(r.count, unit)}
            </span>
            <strong>{formatMoney(r.amount)}</strong>
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * `heading` и `tabs` — интеграция в оболочку Reports, а не новый экран.
 * Отчёт стал вкладкой раздела, поэтому строка заголовка называет раздел,
 * а полоса вкладок стоит сразу под ней. Действия отчёта (выгрузка CSV,
 * обновление) остаются в той же строке — они принадлежат этому экрану.
 *
 * Имя `heading`, а не `title`: `title` внутри уже занят подписью графика.
 */
export default function SalesOverview({ context, heading = 'Sales', tabs = null }) {
  const [period, setPeriod] = useState('today')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [locationIds, setLocationIds] = useState([])
  const [report, setReport] = useState(null)
  const [previous, setPrevious] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)

  const locations = context?.locations ?? []
  const ready = period !== 'custom' || (custom.from && custom.to)
  const { from, to } = useMemo(() => periodRange(period, custom), [period, custom])
  const mode = chartMode(period, custom)
  const key = locationIds.join(',')

  async function load(silent = false) {
    if (!ready) return
    if (!silent) setLoading(true)
    setError('')
    try {
      const prev = previousRange(period, from, to)
      // Прошлый период считает тот же сервер и тот же код — сравнение
      // с числом, посчитанным иначе, сравнением не является.
      const [now, before] = await Promise.all([
        fetchSalesReport(from, to, { locationIds }),
        fetchSalesReport(prev.from, prev.to, { locationIds }),
      ])
      setReport(now)
      setPrevious(before)
      setUpdatedAt(new Date())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const timer = period === 'today' ? setInterval(() => load(true), 60_000) : null
    return () => { if (timer) clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, custom.from, custom.to, key])

  const summary = report?.summary
  const prevSummary = previous?.summary
  const net = summary ? summary.gross_sales - summary.refunds : 0
  const prevNet = prevSummary ? prevSummary.gross_sales - prevSummary.refunds : null
  const bars = useMemo(() => barsFor(mode, report, from, to), [mode, report, from, to])

  const title = chartTitle(mode)
  const vsLabel = PREVIOUS_LABEL[period] || PREVIOUS_LABEL.custom
  const hasAdjustments = summary?.discounts > 0 || summary?.refunds > 0
  const noSales = Boolean(report) && !summary?.orders_count

  function exportCsv() {
    const csv = salesToCsv(report, { from, to })
    // BOM: без него Excel открывает ивритские названия как мусор
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = salesFileName(from, to)
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <PageHeader
        title={heading}
        actions={(
          <Button
            className="page-export-button"
            size="compact"
            aria-label="Export sales as CSV"
            disabled={!report}
            onClick={exportCsv}
            title="Download exactly what is on screen"
          >
            <Download aria-hidden /> <span className="page-export-label">Export CSV</span>
          </Button>
        )}
      />

      {tabs}

      <div className="sales-controls">
        <Tabs
          className="sales-periods"
          label="Reporting period"
          items={PERIODS}
          value={period}
          onChange={setPeriod}
        />
        {/* Охват по точкам: у сети «сколько мы заработали» без указания
            точки — вопрос без ответа. У одной точки переключать нечего,
            и кнопка-обманка здесь не нужна: точку назовёт строка охвата. */}
        {locations.length > 1 && (
          <LocationPicker locations={locations} value={locationIds} onChange={setLocationIds} />
        )}
        {period === 'custom' && (
          <div className="sales-dates">
            <label><span>From</span>
              <input type="date" value={custom.from} max={custom.to || undefined}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            </label>
            <label><span>To</span>
              <input type="date" value={custom.to} min={custom.from || undefined}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
            </label>
          </div>
        )}
      </div>

      {/* Охват приходит с сервера вместе с числами: период, точки, зона
          и валюта. Без него число невозможно проверить. */}
      <p className="scope-line">{scopeLine(report?.scope, from, to)}</p>

      {error && <ErrorText>{error}</ErrorText>}

      {!ready ? (
        <p className="empty-state">Pick a start and end date.</p>
      ) : loading && !report ? (
        /* Первый показ отчёта: числа, график и три разреза. Раньше здесь
           стоял прочерк «…» в пустой поверхности, и экран подрастал на
           884px, когда отчёт приходил. */
        <Skeleton label="Loading the sales report…">
          <SkeletonPanel height={300}>
            <SkeletonBar width="14%" />
            <SkeletonBar width="30%" height={34} />
            <SkeletonBar width="100%" height={150} />
            <SkeletonBar width="62%" />
          </SkeletonPanel>
          <div className="sk-split">
            <SkeletonPanel height={190}>
              <SkeletonBar width="38%" height={16} />
              {[74, 56, 44].map((w) => <SkeletonBar key={w} width={`${w}%`} />)}
            </SkeletonPanel>
            <SkeletonPanel height={190}>
              <SkeletonBar width="30%" height={16} />
              {[68, 52, 40].map((w) => <SkeletonBar key={w} width={`${w}%`} />)}
            </SkeletonPanel>
          </div>
        </Skeleton>
      ) : error && !report ? (
        // Отказ сервера — не ноль продаж: пустой отчёт здесь был бы
        // враньём, поэтому поверхность не рисуется вовсе.
        null
      ) : (
        <>
          <section className="sales-report">
            <div className="sales-report-top">
              <div className="sales-net">
                <p className="sales-net-label">Net sales</p>
                <p className="sales-net-value">{loading && !report ? '…' : formatMoney(net)}</p>
                {prevSummary && (
                  <p className="sales-net-compare">
                    <Delta current={net} previous={prevNet} label={vsLabel} />
                  </p>
                )}
                {prevSummary && (
                  <p className="sales-net-prev">
                    {previousName(period)} {formatMoney(prevNet)}
                  </p>
                )}
                {noSales && (
                  <p className="sales-net-empty">No sales for this period and scope.</p>
                )}
              </div>
              <SalesChart bars={bars} title={title} loading={loading && !report} />
            </div>

            <div className="sales-strip">
              <div>
                <span className="sales-strip-label">Gross sales</span>
                <strong>{summary ? formatMoney(summary.gross_sales) : '—'}</strong>
                {prevSummary && (
                  <Delta current={summary?.gross_sales} previous={prevSummary.gross_sales} label={vsLabel} />
                )}
              </div>
              <div>
                <span className="sales-strip-label">Orders</span>
                <strong>{summary?.orders_count ?? '—'}</strong>
                {prevSummary && (
                  <Delta current={summary?.orders_count} previous={prevSummary.orders_count} label={vsLabel} />
                )}
              </div>
              <div>
                <span className="sales-strip-label">Average check</span>
                <strong>{summary ? formatMoney(summary.avg_check) : '—'}</strong>
                {prevSummary && (
                  <Delta current={summary?.avg_check} previous={prevSummary.avg_check} label={vsLabel} />
                )}
              </div>
            </div>

            {/* Скидки и возвраты — не выручка: строка появляется, только
                когда им есть что показать, и всегда со знаком минус. */}
            {hasAdjustments && (
              <div className="sales-adjust">
                {summary.discounts > 0 && (
                  <span><span className="sales-adjust-label">Discounts</span>
                    <strong>−{formatMoney(summary.discounts)}</strong></span>
                )}
                {summary.refunds > 0 && (
                  <span><span className="sales-adjust-label">Refunds ×{summary.refunds_count}</span>
                    <strong>−{formatMoney(summary.refunds)}</strong></span>
                )}
              </div>
            )}
          </section>

          <div className="sales-breakdowns">
            {/* Чем платили и что брали — первые два вопроса после «сколько» */}
            <Breakdown
              icon={CreditCard} title="Payment methods" meter unit="payment"
              rows={(report?.by_method ?? []).map((m) => ({
                key: m.method, label: methodLabel(m.method), amount: m.amount, count: m.count,
              }))}
            />
            <Breakdown
              icon={ShoppingBag} title="Top items" ranked unit="qty"
              rows={(report?.top_items ?? []).slice(0, 6).map((i) => ({
                key: i.name, label: i.name, amount: i.amount, count: i.qty,
              }))}
            />
            {/* Разрезы 133: откуда пришёл заказ, как его забрали, где и кто
                пробил. Пустые панели не рисуются. */}
            <Breakdown
              icon={Store} title="Channels"
              rows={(report?.by_channel ?? []).map((c) => ({
                key: c.channel, label: channelLabel(c.channel), amount: c.amount, count: c.count,
              }))}
            />
            <Breakdown
              icon={Utensils} title="Order types"
              rows={(report?.by_type ?? []).map((t) => ({
                key: t.type, label: orderTypeLabel(t.type), amount: t.amount, count: t.count,
              }))}
            />
            {locations.length > 1 && (
              <Breakdown
                icon={Store} title="Locations"
                rows={(report?.by_location ?? []).map((l) => ({
                  key: l.location_id ?? l.name, label: l.name, amount: l.amount, count: l.count,
                }))}
              />
            )}
            <Breakdown
              icon={Users} title="Staff"
              rows={(report?.by_staff ?? []).map((s) => ({
                key: s.name, label: s.name, amount: s.amount, count: s.count,
              }))}
            />
            <Breakdown
              icon={ShoppingBag} title="Categories" unit="qty"
              rows={(report?.by_category ?? []).map((c) => ({
                key: c.category, label: c.category, amount: c.amount, count: c.qty,
              }))}
            />
          </div>

          {updatedAt && (
            <p className="updated-at" role="status">
              Updated {updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </>
      )}
    </>
  )
}
