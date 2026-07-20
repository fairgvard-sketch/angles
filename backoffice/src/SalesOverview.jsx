import { useEffect, useMemo, useState } from 'react'
import { CreditCard, Receipt, RefreshCw, ShoppingBag, TrendingUp } from 'lucide-react'
import {
  PERIODS, barsFor, chartMode, fetchSalesReport, formatMoney, methodLabel, periodRange,
} from './sales'

/**
 * «Обзор» — выручка владельца. Данные из sales_report (089, членство вместо
 * PIN). Периоды: сегодня / 7 / 30 дней / год / произвольные даты. График —
 * по часам, дням или месяцам в зависимости от периода.
 */

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

function Chart({ bars, title }) {
  const maxAmount = bars.reduce((m, b) => Math.max(m, b.amount), 0)
  const maxIdx = bars.findIndex((b) => b.amount === maxAmount)
  const [picked, setPicked] = useState(null)
  const readout = picked !== null && bars[picked] ? bars[picked] : maxIdx >= 0 ? bars[maxIdx] : null

  useEffect(() => { setPicked(null) }, [bars])

  // При многих столбиках прореживаем подписи, чтобы ось не слипалась
  const step = bars.length > 24 ? Math.ceil(bars.length / 12) : bars.length > 14 ? 3 : 1

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
          <>
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
              {bars.map((b, i) => (
                <span key={b.key} className={(picked === null ? i === maxIdx : picked === i) ? 'is-active' : ''}>
                  {i % step === 0 ? b.label : ''}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  )
}

export default function SalesOverview({ organizationName }) {
  const [period, setPeriod] = useState('today')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)

  const ready = period !== 'custom' || (custom.from && custom.to)
  const { from, to } = useMemo(() => periodRange(period, custom), [period, custom])
  const mode = chartMode(period, custom)

  async function load(silent = false) {
    if (!ready) return
    if (!silent) setLoading(true)
    setError('')
    try {
      const data = await fetchSalesReport(from, to)
      setReport(data)
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
  }, [period, custom.from, custom.to])

  const summary = report?.summary
  const net = summary ? summary.gross_sales - summary.refunds : 0
  const bars = useMemo(() => barsFor(mode, report), [mode, report])

  const chartTitle = mode === 'hour' ? 'By hour' : mode === 'month' ? 'By month' : 'By day'

  return (
    <>
      <section className="page-heading compact-heading">
        <p className="eyebrow">{organizationName}</p>
        <h1>Overview</h1>
      </section>

      <div className="overview-toolbar">
        <div className="period-switch" role="tablist" aria-label="Reporting period">
          {PERIODS.map((p) => (
            <button key={p.key} role="tab" aria-selected={period === p.key}
              className={period === p.key ? 'is-active' : ''} onClick={() => setPeriod(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
        <button className="icon-button" onClick={() => load()} title="Refresh" disabled={loading}><RefreshCw /></button>
      </div>

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
          </section>

          {/* Карточки-метрики */}
          <section className="stats-grid ov-stats">
            <StatCard icon={TrendingUp} label="Gross sales" value={summary ? formatMoney(summary.gross_sales) : '—'} />
            <StatCard icon={ShoppingBag} label="Orders" value={summary?.orders_count ?? '—'} />
            <StatCard icon={Receipt} label="Average check" value={summary ? formatMoney(summary.avg_check) : '—'} />
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
            {report && report.by_method.length > 0 && (
              <section className="panel">
                <div className="panel-heading"><div><h2><CreditCard /> Payment methods</h2></div></div>
                <div className="data-list">
                  {report.by_method.map((m) => (
                    <div key={m.method} className="data-row">
                      <span>{methodLabel(m.method)}{m.count > 0 && <small> ×{m.count}</small>}</span>
                      <strong>{formatMoney(m.amount)}</strong>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {report && report.top_items.length > 0 && (
              <section className="panel">
                <div className="panel-heading"><div><h2><ShoppingBag /> Top items</h2></div></div>
                <div className="data-list">
                  {report.top_items.slice(0, 6).map((i) => (
                    <div key={i.name} className="data-row">
                      <span className="truncate">{i.name}<small> ×{i.qty}</small></span>
                      <strong>{formatMoney(i.amount)}</strong>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          {updatedAt && (
            <p className="updated-at">Updated {updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>
          )}
        </>
      )}
    </>
  )
}
