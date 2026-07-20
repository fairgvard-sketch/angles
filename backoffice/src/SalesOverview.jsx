import { useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import {
  dayBars,
  fetchSalesReport,
  formatMoney,
  hourBars,
  methodLabel,
  periodRange,
} from './sales'

/**
 * «Обзор» — выручка владельца. Перенесён из кассы (features/dashboard):
 * тот же RPC и та же арифметика, но данные подтверждает членство в
 * бэкофисе (089), а не PIN-сессия. В кассе экран остаётся: там его
 * смотрит менеджер на смене, здесь — владелец из дома.
 */

const PERIOD_LABELS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: 'Last 7 days' },
]

function Chart({ bars, title }) {
  const maxAmount = bars.reduce((m, b) => Math.max(m, b.amount), 0)
  const maxIdx = bars.findIndex((b) => b.amount === maxAmount)
  const [picked, setPicked] = useState(null)
  const readout = picked !== null && bars[picked] ? bars[picked] : maxIdx >= 0 ? bars[maxIdx] : null

  useEffect(() => { setPicked(null) }, [bars])

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
                  <button
                    key={b.key}
                    type="button"
                    onClick={() => setPicked(picked === i ? null : i)}
                    aria-label={`${b.full}: ${formatMoney(b.amount)}`}
                    className="chart-bar"
                  >
                    <span className={active ? 'bar is-active' : 'bar'} style={{ height: `${height}%` }} />
                  </button>
                )
              })}
            </div>
            <div className="chart-axis">
              {bars.map((b, i) => (
                <span
                  key={b.key}
                  className={(picked === null ? i === maxIdx : picked === i) ? 'is-active' : ''}
                >
                  {bars.length > 14 ? (i % 3 === 0 ? b.label : '') : b.label}
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
  const [report, setReport] = useState(null)
  const [reference, setReference] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)

  const { from, to } = useMemo(() => periodRange(period), [period])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      try {
        const data = await fetchSalesReport(from, to)
        if (cancelled) return
        setReport(data)
        setUpdatedAt(new Date())
      } catch (loadError) {
        if (!cancelled) setError(loadError.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    // «Сегодня» — живой экран: тихое обновление раз в минуту
    const timer = period === 'today' ? setInterval(load, 60_000) : null
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [period, from, to])

  // Ориентир «вчера» под главным числом — только на вкладке «Сегодня»
  useEffect(() => {
    let cancelled = false
    if (period !== 'today') {
      setReference(null)
      return undefined
    }
    const range = periodRange('yesterday')
    fetchSalesReport(range.from, range.to)
      .then((data) => { if (!cancelled) setReference(data) })
      .catch(() => { if (!cancelled) setReference(null) })
    return () => { cancelled = true }
  }, [period])

  const summary = report?.summary
  const net = summary ? summary.gross_sales - summary.refunds : 0
  const referenceNet = reference
    ? reference.summary.gross_sales - reference.summary.refunds
    : null

  const bars = useMemo(() => {
    if (!report) return []
    return period === '7d' ? dayBars(report) : hourBars(report)
  }, [report, period])

  async function refresh() {
    setLoading(true)
    setError('')
    try {
      const data = await fetchSalesReport(from, to)
      setReport(data)
      setUpdatedAt(new Date())
    } catch (refreshError) {
      setError(refreshError.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <section className="page-heading compact-heading">
        <p className="eyebrow">{organizationName}</p>
        <h1>Overview</h1>
        <p>Revenue and trading metrics across your business.</p>
      </section>

      <div className="overview-toolbar">
        <div className="period-switch" role="tablist" aria-label="Reporting period">
          {PERIOD_LABELS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={period === p.key}
              className={period === p.key ? 'is-active' : ''}
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button className="icon-button" onClick={refresh} title="Refresh" disabled={loading}>
          <RefreshCw />
        </button>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      <section className="panel hero-panel">
        <p className="hero-label">Net sales</p>
        <p className="hero-value">{loading && !report ? '…' : formatMoney(net)}</p>
        {period === 'today' && referenceNet !== null && (
          <p className="hero-reference">Yesterday: {formatMoney(referenceNet)}</p>
        )}
        <div className="hero-split">
          <div>
            <span className="hero-split-label">Orders</span>
            <span className="hero-split-value">{summary?.orders_count ?? '—'}</span>
          </div>
          <div>
            <span className="hero-split-label">Average check</span>
            <span className="hero-split-value">{summary ? formatMoney(summary.avg_check) : '—'}</span>
          </div>
        </div>
        {summary && (summary.refunds > 0 || summary.discounts > 0) && (
          <div className="hero-adjustments">
            {summary.discounts > 0 && (
              <div><span>Discounts</span><span>−{formatMoney(summary.discounts)}</span></div>
            )}
            {summary.refunds > 0 && (
              <div>
                <span>Refunds ×{summary.refunds_count}</span>
                <span className="is-negative">−{formatMoney(summary.refunds)}</span>
              </div>
            )}
          </div>
        )}
      </section>

      <Chart bars={bars} title={period === '7d' ? 'By day' : 'By hour'} />

      <div className="overview-columns">
        {report && report.by_method.length > 0 && (
          <section className="panel">
            <div className="panel-heading"><div><h2>Payment methods</h2></div></div>
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
            <div className="panel-heading"><div><h2>Top items</h2></div></div>
            <div className="data-list">
              {report.top_items.slice(0, 5).map((i) => (
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
        <p className="updated-at">
          Updated {updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}
    </>
  )
}
