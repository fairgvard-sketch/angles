import { useEffect, useMemo, useRef, useState } from 'react'
import { accountSession, supabase } from './supabase'
import { billingError, createBillingApi } from './subscription-checkout'

const money = (amount, currency = 'ILS') => new Intl.NumberFormat('en-IL', { style: 'currency', currency }).format(amount / 100)
const date = value => value ? new Date(value).toLocaleDateString('en-GB') : '—'

// simulatePayment is deliberately NOT wired in the cabinet. Only the local
// billing lab injects it, and its server independently checks test isolation.
export default function SubscriptionPanel({ context, onReloadContext, api: providedApi, simulatePayment }) {
  const api = useMemo(() => {
    if (providedApi) return providedApi
    let storage
    try { storage = window.sessionStorage } catch { /* optional */ }
    return createBillingApi(supabase, { orgId: context.organization.id,
      getSession: () => accountSession?.getSnapshot().session, storage })
  }, [providedApi, context.organization.id])
  const [catalog, setCatalog] = useState(null)
  const [invoice, setInvoice] = useState(null)
  const [product, setProduct] = useState(api.getDraft()?.product || 'menu')
  const [locationId, setLocationId] = useState(api.getDraft()?.locationId || context.locations?.[0]?.id || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const running = useRef(false), generation = useRef(0)

  async function run(work) {
    if (running.current) return
    running.current = true
    const current = generation.current
    setBusy(true); setError(''); setNotice('')
    try { await work(() => current === generation.current) }
    catch (failure) { if (current === generation.current) setError(billingError(failure)) }
    finally {
      if (current === generation.current) { running.current = false; setBusy(false) }
    }
  }
  async function load(valid) {
    const next = await api.catalog()
    if (!valid()) return
    setCatalog(next)
    if (!next.prices.some(price => price.product === product) && next.prices[0] && !api.getDraft()) setProduct(next.prices[0].product)
  }
  useEffect(() => {
    run(load)
    return () => { generation.current++; running.current = false }
  }, [api]) // The API is bound to one account/workspace.

  function accept(next, valid) {
    if (!valid()) return false
    setInvoice(next)
    if (next.status === 'paid') setNotice('Payment confirmed by the server. Check your subscription dates below.')
    return true
  }
  async function refreshInvoice(valid, id = invoice?.invoice_id) {
    if (!id) { await load(valid); return }
    const next = await api.read(id)
    if (!accept(next, valid)) return
    await load(valid)
  }
  const selected = catalog?.prices?.find(price => price.product === product)
  const unpaid = invoice && ['open', 'processing'].includes(invoice.status)
  const frozen = busy || unpaid || Boolean(api.getDraft())
  return <section className="panel form-panel subscription-panel" aria-label="Subscriptions">
    <div className="panel-heading"><div><h2>Subscriptions</h2><p>One product, one location, one month. Access starts only after confirmed payment.</p></div></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!catalog && <button className="secondary-button" disabled={busy} onClick={() => run(load)}>{busy ? 'Loading plans…' : 'Retry loading plans'}</button>}
    {catalog?.mode === 'disabled' && <p>Online subscription purchases are not available yet. No payment has been taken.</p>}
    {catalog?.mode === 'test' && <p className="form-hint"><strong>TEST MODE — no real charges.</strong> Prices are placeholders. This is not a tax invoice.</p>}
    {catalog && catalog.mode !== 'disabled' && <form className="settings-form subscription-form" onSubmit={event => {
      event.preventDefault()
      run(async valid => { const next = await api.create({ locationId, product }); if (accept(next, valid)) await load(valid) })
    }}>
      <label className="field"><span>Location</span><select aria-label="Subscription location" disabled={frozen} value={locationId} onChange={event => setLocationId(event.target.value)}>
        {(context.locations || []).map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
      </select></label>
      <label className="field"><span>Monthly plan</span><select aria-label="Monthly plan" disabled={frozen} value={product} onChange={event => setProduct(event.target.value)}>
        {catalog.prices.map(price => <option key={price.product} value={price.product}>{price.label} — {money(price.amount_agorot, price.currency)} / month</option>)}
      </select></label>
      <p className="form-hint">Plan prices are before tax. Final tax and any eligible discount are calculated on the server and shown before payment. Renewal requires another payment; automatic card charges are not enabled.</p>
      <button className="primary-button" disabled={busy || unpaid || !selected || !locationId}>{busy ? 'Checking…' : api.getDraft() ? 'Retry the same checkout' : 'Review invoice'}</button>
    </form>}
    {invoice && <div className="sheet-section" aria-label="Invoice">
      <h3>{invoice.number}</h3>
      <p>Status: <strong data-invoice-status={invoice.status}>{invoice.status}</strong></p>
      {invoice.mode === 'test' && <p>TEST INVOICE — no real payment.</p>}
      {invoice.lines.map((line, index) => <p key={index}>{line.description} · {line.months} month</p>)}
      <p>Subtotal {money(invoice.subtotal_agorot)} · Discount {money(invoice.discount_agorot)} · Tax {money(invoice.vat_agorot)}</p>
      <p><strong>Total {money(invoice.total_agorot, invoice.currency)}</strong></p>
      {unpaid && !simulatePayment && <p>Payment provider is not connected yet. No money has been taken and this invoice does not activate access.</p>}
      {unpaid && simulatePayment && invoice.mode === 'test' && <div className="form-actions">
        <button className="primary-button" disabled={busy} onClick={() => run(async valid => {
          await simulatePayment(invoice.invoice_id, 'success'); await refreshInvoice(valid)
        })}>Simulate successful payment</button>
        <button className="secondary-button" disabled={busy} onClick={() => run(async valid => {
          await simulatePayment(invoice.invoice_id, 'decline'); await refreshInvoice(valid)
          if (valid()) setNotice('Test payment declined. The invoice is unpaid; access has not been activated by this attempt.')
        })}>Simulate declined payment</button>
      </div>}
      <div className="form-actions">
        <button className="secondary-button" disabled={busy} onClick={() => run(valid => refreshInvoice(valid))}>Check payment status</button>
        {invoice.status === 'open' && <button className="text-button" disabled={busy} onClick={() => run(async valid => {
          const next = await api.cancel(invoice.invoice_id); if (accept(next, valid)) await load(valid)
        })}>Cancel unpaid invoice</button>}
        {invoice.status === 'paid' && <button className="primary-button" disabled={busy} onClick={() => run(async valid => {
          await onReloadContext?.(); if (valid()) setNotice('Workspace access refreshed.')
        })}>Refresh workspace access</button>}
      </div>
    </div>}
    {catalog?.subscriptions?.length > 0 && <div className="sheet-section"><h3>Your subscriptions</h3>
      {catalog.subscriptions.map(sub => <p key={`${sub.product}:${sub.location_id}`}>{sub.product} · {context.locations?.find(location => location.id === sub.location_id)?.name || 'Location'} · {sub.status} · Paid until {date(sub.paid_until)} · Access until {date(sub.access_until)}</p>)}
      <p className="form-hint">Past due means the paid period ended but the displayed grace period still allows access. Suspended access does not delete your data.</p>
    </div>}
    {catalog?.invoices?.length > 0 && <div className="sheet-section"><h3>Recent invoices</h3>
      {catalog.invoices.map(item => <p key={item.invoice_id}><button className="text-button" disabled={busy} onClick={() => run(valid => refreshInvoice(valid, item.invoice_id))}>{item.number} · {item.status} · {money(item.total_agorot, item.currency)}</button></p>)}
    </div>}
  </section>
}
