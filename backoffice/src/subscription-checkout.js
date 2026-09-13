const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PRODUCTS = ['menu', 'online_orders', 'reservations']

export function billingError(error) {
  if (['PGRST202', '42883'].includes(error?.code)) return 'Subscriptions need a server update. Please contact ANGLE support.'
  const messages = {
    billing_owner_required: 'Only an active workspace owner can manage subscriptions.',
    checkout_disabled: 'Online subscription purchases are not available yet. No payment has been taken.',
    checkout_price_unavailable: 'This plan is not currently available. Please refresh the plans.',
    location_not_in_org: 'This location is no longer available in your workspace. Reload the workspace and choose a location.',
    invalid_product: 'This product is not available for online subscription purchase.',
    checkout_cycle_unsupported: 'This subscription cycle needs ANGLE support; it cannot be changed here.',
    checkout_payment_processing: 'Payment is being processed. Check its status before canceling.',
    session_changed: 'Your account changed. Reopen subscriptions in the current workspace.',
    checkout_not_found: 'This invoice is not available in your workspace.',
  }
  return messages[error?.message] || 'We could not confirm the result. Check the invoice or retry the same request. No payment is assumed.'
}

export function createBillingApi(client, { orgId, getSession, storage, makeId = () => crypto.randomUUID(), timeoutMs = 15000 }) {
  const userId = getSession()?.user?.id
  const key = `angle.subscription-checkout.${userId}.${orgId}`
  let draft = null
  try {
    const saved = JSON.parse(storage?.getItem(key) || 'null')
    if (UUID.test(saved?.requestId) && UUID.test(saved?.locationId) && PRODUCTS.includes(saved?.product)) draft = saved
  } catch { /* optional storage */ }
  function save(value) {
    draft = value
    try { if (value) storage?.setItem(key, JSON.stringify(value)); else storage?.removeItem(key) } catch { /* mounted retry still works */ }
  }
  async function rpc(name, args = {}) {
    const session = getSession()
    const matches = () => {
      const next = getSession()
      return userId && next?.user?.id === userId && next.user.app_metadata?.org_id === orgId
    }
    if (!matches()) throw new Error('session_changed')
    const abort = new AbortController()
    let timer
    try {
      const result = await Promise.race([
        Promise.resolve(client.rpc(name, args).setHeader('Authorization', `Bearer ${session.access_token}`).abortSignal(abort.signal)),
        new Promise((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error('request_timeout')) }, timeoutMs) }),
      ])
      if (!matches()) throw new Error('session_changed')
      if (result.error) throw result.error
      if (!result.data) throw new Error('billing_result_missing')
      return result.data
    } finally { clearTimeout(timer) }
  }
  return {
    getDraft: () => draft,
    catalog: () => rpc('get_subscription_catalog'),
    read: invoiceId => rpc('get_subscription_checkout', { p_invoice_id: invoiceId }),
    cancel: invoiceId => rpc('cancel_subscription_checkout', { p_invoice_id: invoiceId }),
    async create({ locationId, product }) {
      if (!draft) {
        if (!UUID.test(locationId) || !PRODUCTS.includes(product)) throw new Error('invalid_checkout')
        save({ requestId: makeId(), locationId, product })
      }
      let result
      try {
        result = await rpc('create_subscription_checkout', {
          p_request_id: draft.requestId, p_location_id: draft.locationId, p_product: draft.product,
        })
      } catch (error) {
        // These explicit server rejections roll back the entire transaction.
        // Let the owner correct a selection; transport/unknown outcomes retain it.
        if (['location_not_in_org', 'invalid_product', 'checkout_disabled', 'checkout_price_unavailable',
          'checkout_cycle_unsupported', 'billing_owner_required'].includes(error?.message)) save(null)
        throw error
      }
      // A returned invoice is the durable server receipt. Unknown outcomes keep
      // the original request AND selection across reloads and retries.
      if (!UUID.test(result.invoice_id)) throw new Error('billing_result_missing')
      save(null)
      return result
    },
  }
}
