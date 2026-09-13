import { authErrorMessage } from './account-session.js'

const PRODUCTS = ['menu', 'online_orders', 'reservations']
export function workspaceInput({ orgName = '', locationName = '', products = [] } = {}) {
  const org = orgName.trim(), location = locationName.trim() || org
  const selected = [...new Set(products)].filter((product) => PRODUCTS.includes(product)).sort()
  if (!org || org.length > 120 || location.length > 120) throw new Error('invalid_name')
  if (!selected.length) throw new Error('invalid_products')
  return { p_org_name: org, p_location_name: location, p_products: selected }
}

function bounded(task, timeoutMs, abort) {
  let timer
  return Promise.race([Promise.resolve().then(task), new Promise((_, reject) => {
    timer = setTimeout(() => { abort?.(); reject({ code: 'request_timeout' }) }, timeoutMs)
  })]).finally(() => clearTimeout(timer))
}

// A timeout can follow a committed transaction. Keep its UUID AND payload until
// the server confirms the result; a retry is not a second workspace submission.
export function createWorkspaceSetup(client, {
  userId, getSession, storage, makeId = () => crypto.randomUUID(), timeoutMs = 15000,
} = {}) {
  const key = `angle.workspace-setup.${userId}`
  let receipt = null
  try {
    const saved = JSON.parse(storage?.getItem(key) || 'null')
    if (saved?.userId === userId && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(saved.requestId)
      && saved.input && JSON.stringify(workspaceInput({ orgName: saved.input.p_org_name,
        locationName: saved.input.p_location_name, products: saved.input.p_products })) === JSON.stringify(saved.input)) receipt = saved
  } catch { /* storage is optional, and untrusted data is never sent as-is */ }
  let state = { busy: false, locked: Boolean(receipt), error: receipt ? 'Setup was interrupted. Check and continue using the same request.' : '', phase: 'editing' }
  const subscribers = new Set()
  let alive = true, generation = 0, pending = false, abort
  const current = (version) => alive && generation === version && getSession()?.user?.id === userId
  function publish(next) { if (!alive) return; state = { ...state, ...next }; for (const fn of subscribers) fn() }
  function save(next) {
    receipt = next
    try { if (next) storage?.setItem(key, JSON.stringify(next)); else storage?.removeItem(key) } catch { /* retry still works in this mounted form */ }
  }
  function requestForSession(session, input) {
    // Explicit header pins the mutation even if another tab switches the shared
    // SDK client while its fetch is waiting for an access token.
    return client.rpc('create_digital_workspace', { p_request_id: receipt.requestId, ...input })
      .setHeader('Authorization', `Bearer ${session.access_token}`).abortSignal(abort.signal)
  }
  async function submit(values) {
    if (pending) return false
    const version = generation
    if (!current(version)) return false
    pending = true
    abort = new AbortController()
    publish({ busy: true, error: '', phase: 'checking' })
    let attempted = Boolean(receipt)
    try {
      const input = receipt?.input || workspaceInput(values)
      const session = getSession()
      const fresh = await bounded(() => client.auth.getUser(session.access_token), timeoutMs)
      if (!current(version)) return false
      if (fresh.error) throw fresh.error
      if (fresh.data?.user?.id !== userId) throw { code: 'session_expired' }
      let orgId = fresh.data.user.app_metadata?.org_id
      if (!orgId) {
        if (!receipt) save({ userId, requestId: makeId(), input })
        attempted = true
        publish({ phase: 'creating', locked: true })
        const result = await bounded(() => requestForSession(session, input), timeoutMs, () => abort.abort())
        if (!current(version)) return false
        if (result.error) {
          // Another tab / the legacy client may have completed bootstrap.
          // Trust a fresh server read, not the message or the stale JWT alone.
          if (result.error.message !== 'org already bootstrapped for this account') throw result.error
          const existing = await bounded(() => client.auth.getUser(session.access_token), timeoutMs)
          if (!current(version)) return false
          if (existing.error) throw existing.error
          if (existing.data?.user?.id === userId) orgId = existing.data.user.app_metadata?.org_id
        } else orgId = result.data?.org_id
        if (!orgId) throw { code: 'workspace_result_unknown' }
      }
      publish({ phase: 'refreshing', locked: true })
      const refreshed = await bounded(() => client.auth.refreshSession(), timeoutMs)
      if (!current(version)) return false
      if (refreshed.error) throw refreshed.error
      if (refreshed.data?.session?.user?.id !== userId
        || refreshed.data.session.user.app_metadata?.org_id !== orgId) throw { code: 'workspace_refresh_pending' }
      save(null)
      publish({ phase: 'complete', busy: false, locked: true, error: '' })
      return true
    } catch (error) {
      if (!current(version)) return false
      const refresh = state.phase === 'refreshing'
      const invalid = ['invalid_name', 'invalid_products'].includes(error?.message)
      const missing = ['PGRST202', '42883'].includes(error?.code)
      if (invalid || missing) { save(null); attempted = false }
      const message = refresh
        ? 'Your workspace exists, but we could not refresh access. Check and continue — another workspace will not be created.'
        : missing ? 'Workspace setup needs a server update. Please contact ANGLE support.'
          : invalid ? 'Enter a business name up to 120 characters and select at least one product.'
            : attempted ? 'We could not confirm workspace setup. Check and continue using the same request; do not start another workspace.'
              : authErrorMessage(error)
      publish({ phase: 'error', locked: attempted || refresh, error: message })
      return false
    } finally {
      pending = false
      if (current(version)) publish({ busy: false })
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn) },
    getDraft: () => receipt?.input,
    start() { alive = true },
    stop() {
      alive = false; generation++; abort?.abort()
      // TOKEN_REFRESHED can unmount the form before refreshSession resolves.
      // Its confirmed new JWT is enough to remove this account's saved draft.
      const session = getSession()
      if (session?.user?.id === userId && session.user.app_metadata?.org_id) save(null)
    },
    submit,
  }
}
