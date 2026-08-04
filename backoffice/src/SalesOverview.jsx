import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CreditCard, Download, Receipt, RefreshCw, ShoppingBag, Store, TrendingUp, Users, Utensils,
} from 'lucide-react'
import {
  PERIODS, barsFor, chartMode, fetchSalesReport, formatMoney, methodLabel, periodRange,
  previousRange, PREVIOUS_LABEL, delta, scopeLine, channelLabel, orderTypeLabel,
  salesToCsv, salesFileName,
} from './sales'
import { PageHeader } from './ui/Layout'

/**
 * «Sales» — выручка владельца. Данные из sales_report (089, членство вместо
 * PIN; охват и разрезы — 133). Периоды: сегодня / 7 дней / месяц / год /
 * произвольные даты; график — по часам, дням или месяцам.
 *
 * Число здесь всегда подписано: период, точки, зона времени и валюта
 * приходят с сервера в блоке scope и стоят прямо под заголовком. Рядом с
 * итогами — сравнение с сопоставимым прошлым периодом.
 */

function Delta({ current, previous, label }) {
  if (previous === null || previous === undefined) return null
  const d = delta(current, previous)
  return (
    <span className={`stat-delta is-${d.direction}`}>
      {d.text} <small>{label}</small>
    </span>
  )
}

function StatCard({ icon: Icon, label, value, sub }) {
  return (
    <div className="stat-card ov-stat">
      <div className="stat-icon"><Icon /></div>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
        {sub && <div className="stat-detail">{sub}</div>}
      </div>
    </div>
  )
}

/** Разрез: строка «имя — сумма (×количество)». Пустые не рисуем. */
function Breakdown({ icon: Icon, title, rows }) {
  if (!rows?.length) return null
  return (
    <section className="panel">
      <div className="panel-heading"><div><h2><Icon /> {title}</h2></div></div>
      <div className="data-list">
        {rows.map((r) => (
          <div key={r.key} className="data-row">
            <span className="truncate">{r.label}{r.count > 0 && <small> ×{r.count}</small>}</span>
            <strong>{formatMoney(r.amount)}</strong>
          </div>
        ))}
      </div>
    </section>
  )
}

function Chart({ bars, title }) {
  const maxAmount = bars.reduce((m, b) => Math.max(m, b.amount), 0)
  // Пиковый столбик подсвечиваем только если продажи вообще были
  const maxIdx = maxAmount > 0 ? bars.findIndex((b) => b.amount === maxAmount) : -1
  const [picked, setPicked] = useState(null)
  const readout = picked !== null && bars[picked] ? bars[picked] : maxIdx >= 0 ? bars[maxIdx] : null
  const axisRef = useRef(null)
  const [width, setWidth] = useState(0)

  useEffect(() => { setPicked(null) }, [bars])

  // Замер ширины скроллера. Зависимость от bars важна: элемент появляется
  // только после загрузки данных, при пустом [] ref ещё null и observer
  // никогда не подключался — из-за этого прокрутка не включалась.
  useEffect(() => {
    const el = axisRef.current
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

  return (
    <section className="panel chart-panel">
      <div className="panel-heading">
        <div><h2>{title}</h2></div>
        {readout && (
          <span className="chart-readout">
            {readout.full} · <strong>{formatMoney(readout.amount)}</strong>
            {readout.count > 0 && ` · ×${readout.count}`}
          </span>
        )}
      </div>
      <div className="chart-body">
        {bars.length === 0 ? (
          <p className="empty-state">No sales in this period.</p>
        ) : (
          // Скроллер: при 30+ точках столбики не сжимаются в ниточки,
          // график листается пальцем. Ширина задаётся минимумом на столбик.
          <div className="chart-scroll" ref={axisRef}>
            <div className={`chart-inner ${scrolls ? 'is-scrolling' : ''}`}
              style={{ '--bar-count': bars.length, '--min-bar': `${MIN_BAR}px` }}>
              <div className="chart-bars" role="img" aria-label={title}>
                {bars.map((b, i) => {
                  const height = maxAmount > 0 ? Math.max((b.amount / maxAmount) * 100, b.amount > 0 ? 3 : 0) : 0
                  const active = picked === null ? i === maxIdx : picked === i
                  return (
                    <button key={b.key} type="button" onClick={() => setPicked(picked === i ? null : i)}
                      aria-label={`${b.full}: ${formatMoney(b.amount)}`} className="chart-bar">
                      <span className={active ? 'bar is-active' : 'bar'} style={{ height: `${height}%` }} />
                    </button>
                  )
                })}
              </div>
              <div className="chart-axis">
                {bars.map((b, i) => {
                  const active = picked === null ? i === maxIdx : picked === i
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
        )}
      </div>
    </section>
  )
}

export default function SalesOverview({ context }) {
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

  const chartTitle = mode === 'hour' ? 'By hour' : mode === 'month' ? 'By month' : 'By day'
  const vsLabel = PREVIOUS_LABEL[period] || PREVIOUS_LABEL.custom

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
      <PageHeader title="Sales">
        {/* Охват приходит с сервера вместе с числами: период, точки, зона
            и валюта. Без него число невозможно проверить. */}
        <p className="scope-line">{scopeLine(report?.scope, from, to)}</p>
      </PageHeader>

      <div className="overview-toolbar">
        <div className="period-switch" role="tablist" aria-label="Reporting period">
          {PERIODS.map((p) => (
            <button key={p.key} role="tab" aria-selected={period === p.key}
              className={period === p.key ? 'is-active' : ''} onClick={() => setPeriod(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={!report}
          onClick={exportCsv}
          title="Download exactly what is on screen"
        >
          <Download aria-hidden /> Export CSV
        </button>
        <button className="icon-button" onClick={() => load()} aria-label="Refresh sales" disabled={loading}><RefreshCw /></button>
      </div>

      {/* Охват по точкам: у сети «сколько мы заработали» без указания
          точки — вопрос без ответа. */}
      {locations.length > 1 && (
        <div className="segment-bar" role="group" aria-label="Locations in this report">
          <button
            type="button"
            className={`segment-chip${locationIds.length === 0 ? ' is-selected' : ''}`}
            aria-pressed={locationIds.length === 0}
            onClick={() => setLocationIds([])}
          >
            All locations
          </button>
          {locations.map((l) => (
            <button
              type="button"
              key={l.id}
              className={`segment-chip${locationIds.includes(l.id) ? ' is-selected' : ''}`}
              aria-pressed={locationIds.includes(l.id)}
              onClick={() => setLocationIds((prev) => (
                prev.includes(l.id) ? prev.filter((x) => x !== l.id) : [...prev, l.id]
              ))}
            >
              {l.name}
            </button>
          ))}
        </div>
      )}

      {period === 'custom' && (
        <div className="date-range">
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

      {error && <p className="form-error" role="alert">{error}</p>}

      {!ready ? (
        <p className="empty-state">Pick a start and end date.</p>
      ) : (
        <>
          {/* Hero: чистая выручка крупно */}
          <section className="ov-hero">
            <p className="ov-hero-label">Net sales</p>
            <p className="ov-hero-value">{loading && !report ? '…' : formatMoney(net)}</p>
            {prevSummary && (
              <p className="ov-hero-delta">
                <Delta current={net} previous={prevNet} label={vsLabel} />
                <span className="ov-hero-prev">was {formatMoney(prevNet)}</span>
              </p>
            )}
          </section>

          {/* Карточки-метрики */}
          <section className="stats-grid ov-stats">
            <StatCard
              icon={TrendingUp} label="Gross sales"
              value={summary ? formatMoney(summary.gross_sales) : '—'}
              sub={prevSummary && <Delta current={summary?.gross_sales} previous={prevSummary.gross_sales} label={vsLabel} />}
            />
            <StatCard
              icon={ShoppingBag} label="Orders"
              value={summary?.orders_count ?? '—'}
              sub={prevSummary && <Delta current={summary?.orders_count} previous={prevSummary.orders_count} label={vsLabel} />}
            />
            <StatCard
              icon={Receipt} label="Average check"
              value={summary ? formatMoney(summary.avg_check) : '—'}
              sub={prevSummary && <Delta current={summary?.avg_check} previous={prevSummary.avg_check} label={vsLabel} />}
            />
          </section>

          {(summary?.discounts > 0 || summary?.refunds > 0) && (
            <section className="panel ov-adjust">
              {summary.discounts > 0 && (
                <div><span>Discounts</span><strong>−{formatMoney(summary.discounts)}</strong></div>
              )}
              {summary.refunds > 0 && (
                <div><span>Refunds ×{summary.refunds_count}</span><strong className="is-negative">−{formatMoney(summary.refunds)}</strong></div>
              )}
            </section>
          )}

          <Chart bars={bars} title={chartTitle} />

          <div className="overview-columns">
            <Breakdown
              icon={CreditCard} title="Payment methods"
              rows={(report?.by_method ?? []).map((m) => ({
                key: m.method, label: methodLabel(m.method), amount: m.amount, count: m.count,
              }))}
            />
            <Breakdown
              icon={ShoppingBag} title="Top items"
              rows={(report?.top_items ?? []).slice(0, 6).map((i) => ({
                key: i.name, label: i.name, amount: i.amount, count: i.qty,
              }))}
            />
            {/* Разрезы 133: откуда пришёл заказ, как его забрали, где и кто
                пробил. Пустые панели не рисуются — у Menu-only точки
                каналов нет, и выдумывать их незачем. */}
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
              icon={ShoppingBag} title="Categories"
              rows={(report?.by_category ?? []).map((c) => ({
                key: c.category, label: c.category, amount: c.amount, count: c.qty,
              }))}
            />
          </div>

          {updatedAt && (
            <p className="updated-at">Updated {updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>
          )}
        </>
      )}
    </>
  )
}
