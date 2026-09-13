// Account state is separate from React so races can be tested without a browser.
const RECOVERY_KEY = 'angle.account.recovery'
const RECOVERY_TTL = 15 * 60 * 1000
const AUTH_PARAMS = ['access_token', 'refresh_token', 'token_type', 'expires_in', 'expires_at',
  'provider_token', 'provider_refresh_token', 'error', 'error_code', 'error_description', 'type', 'code']

export function readAuthCallback(href) {
  const url = new URL(href)
  const hash = new URLSearchParams(url.hash.slice(1))
  const value = (key) => hash.get(key) || url.searchParams.get(key)
  return {
    mode: value('type') === 'recovery' || url.searchParams.get('auth') === 'recovery'
      ? 'recovery' : url.searchParams.get('auth') === 'confirm' ? 'confirm' : null,
    // Only presentation metadata is retained. Never keep callback tokens in logs/storage.
    hasTokens: Boolean(value('access_token') || value('code')),
    error: Boolean(value('error') || value('error_code') || value('error_description')),
  }
}

export function authRedirectUrl(href, mode) {
  const url = new URL('/account/', href)
  if (!['recovery', 'confirm'].includes(mode)) throw new Error('Unknown auth callback')
  url.searchParams.set('auth', mode)
  return url.href
}

export function cleanAuthUrl(href, { finish = false } = {}) {
  const url = new URL(href)
  const hash = new URLSearchParams(url.hash.slice(1))
  const hasAuthHash = AUTH_PARAMS.some((key) => hash.has(key))
  for (const key of AUTH_PARAMS) {
    url.searchParams.delete(key)
    hash.delete(key)
  }
  if (finish) url.searchParams.delete('auth')
  if (hasAuthHash) url.hash = hash.toString()
  return `${url.pathname}${url.search}${url.hash}`
}

export function authErrorMessage(error) {
  switch (error?.code) {
    case 'invalid_credentials': return 'The email or password is incorrect.'
    case 'email_not_confirmed': return 'Confirm your email before signing in. You can request another confirmation below.'
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit': return 'Too many attempts. Wait a minute before trying again.'
    case 'weak_password': return 'Choose a stronger password. Use at least 8 characters and follow the account password policy.'
    case 'same_password': return 'Choose a password different from your current password.'
    case 'session_not_found':
    case 'session_expired':
    case 'refresh_token_not_found':
    case 'bad_recovery': return 'This reset session is no longer valid. Request a new reset email.'
    case 'reauthentication_needed': return 'A fresh sign-in is required. Request a new reset email and try again.'
    case 'request_timeout': return 'The request took too long. Check your connection and try again.'
    case 'password_update_timeout': return 'The password save could not be confirmed. Try signing in with the new password, or request a new reset email.'
    default: return 'We could not complete the request. Check your connection and try again.'
  }
}

export function validateNewPassword(password, confirmation) {
  if (password.length < 8) return 'Use at least 8 characters.'
  if (password !== confirmation) return 'The passwords do not match.'
  return ''
}

// Bind the mutation to the verified reset session, not a mutable shared Auth
// client that another tab could switch to a different account during the request.
export async function updatePasswordWithSession(makeClient, session, password) {
  // Do not rotate a shared refresh token inside the isolated operation. The main
  // Auth client refreshes sessions; request a fresh link if no usable token remains.
  if (!Number.isFinite(session.expires_at) || session.expires_at * 1000 <= Date.now() + 30000) {
    return { error: { code: 'bad_recovery' } }
  }
  const isolated = makeClient()
  try {
    const result = await isolated.auth.setSession({
      access_token: session.access_token, refresh_token: session.refresh_token,
    })
    if (result.error) return result
    if (result.data?.user?.id !== session.user.id) return { error: { code: 'bad_recovery' } }
    return await isolated.auth.updateUser({ password })
  } finally { await isolated.auth.dispose() }
}

function deadline(task, timeoutMs, abort) {
  let timer
  return Promise.race([
    Promise.resolve().then(task),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        abort?.()
        reject(Object.assign(new Error('Request timed out'), { code: 'request_timeout' }))
      }, timeoutMs)
    }),
  ]).finally(() => clearTimeout(timer))
}

export function createAccountSession(client, {
  callback = {}, storage, cleanUrl = () => {}, now = Date.now,
  timeoutMs = 15000, passwordTimeoutMs = 30000, updatePasswordForSession,
} = {}) {
  let state = { status: 'loading', session: null, context: null, error: '' }
  const subscribers = new Set()
  let stopped = true
  let subscription
  let lifetime = 0
  let contextVersion = 0
  let sessionVersion = 0
  let contextAbort
  let initialized = false
  let readVersion = 0
  let readingSession = false
  let activeCallback = callback
  let recovery = null
  let recoveryTimer
  let scheduled
  let passwordPending = false

  try { recovery = JSON.parse(storage?.getItem(RECOVERY_KEY) || 'null') } catch { /* storage can be blocked */ }
  const publish = (next) => {
    if (stopped) return
    state = { ...state, ...next }
    for (const fn of subscribers) fn()
  }
  const saveRecovery = (value) => {
    recovery = value
    try {
      if (value) storage?.setItem(RECOVERY_KEY, JSON.stringify(value))
      else storage?.removeItem(RECOVERY_KEY)
    } catch { /* reload will ask for another link if storage is unavailable */ }
  }
  const isRecovery = (session) => Boolean(session?.user?.id && recovery?.userId === session.user.id
    && Number.isFinite(recovery.startedAt) && now() >= recovery.startedAt && now() - recovery.startedAt < RECOVERY_TTL)
  function invalidateContext() {
    contextVersion++
    contextAbort?.abort()
    clearTimeout(scheduled)
  }

  async function loadContext() {
    invalidateContext()
    const version = contextVersion
    const session = state.session
    if (!session || state.status.startsWith('recovery') || state.status === 'password-updated') return
    if (!session.user?.app_metadata?.org_id) {
      publish({ status: 'onboarding', context: null, error: '' })
      return
    }
    publish({ status: 'loading', context: null, error: '' })
    const abort = new AbortController()
    contextAbort = abort
    try {
      const result = await deadline(() => {
        const request = client.rpc('get_backoffice_context')
        return request.abortSignal ? request.abortSignal(abort.signal) : request
      }, timeoutMs, () => abort.abort())
      if (stopped || version !== contextVersion) return
      if (result.error || !result.data) throw result.error || new Error('Empty workspace context')
      publish({ status: 'ready', context: result.data, error: '' })
    } catch (error) {
      if (!stopped && version === contextVersion) {
        publish({ status: 'context-error', context: null, error: 'We could not load your workspace. Check your connection or access, then try again.' })
      }
    }
  }

  function applySession(session) {
    invalidateContext()
    clearTimeout(recoveryTimer)
    publish({ status: 'loading', session, context: null, error: '', callbackMode: activeCallback.mode })
    if (!initialized) { publish({ status: 'loading' }); return }
    if (activeCallback.error) { publish({ status: 'recovery-error' }); return }
    if (isRecovery(session)) {
      publish({ status: 'recovery' })
      recoveryTimer = setTimeout(() => applySession(state.session), RECOVERY_TTL - (now() - recovery.startedAt))
      return
    }
    if (activeCallback.mode === 'recovery' || recovery) {
      // A query marker or ordinary stored session is not a verified recovery event.
      // The SDK may emit PASSWORD_RECOVERY shortly after INITIAL_SESSION.
      if (activeCallback.hasTokens && !recovery && session) {
        publish({ status: 'recovery-loading' })
        recoveryTimer = setTimeout(() => publish({ status: 'recovery-error' }), timeoutMs)
      } else publish({ status: 'recovery-error' })
      return
    }
    if (!session) { publish({ status: 'anonymous' }); return }
    publish({ status: 'loading' })
    // Never call Auth/RPC inside an onAuthStateChange callback (SDK lock).
    scheduled = setTimeout(loadContext, 0)
  }

  function onAuthEvent(event, session) {
    // getSession owns the initial read, including errors. The SDK's INITIAL_SESSION
    // fallback can contain null after an error and must not mask that error.
    if (stopped || event === 'INITIAL_SESSION') return
    if (event === 'SIGNED_IN' && state.status === 'ready'
      && session?.access_token === state.session?.access_token) return
    sessionVersion++
    if (event === 'PASSWORD_RECOVERY' && session?.user?.id) {
      activeCallback = { mode: 'recovery' }
      saveRecovery({ userId: session.user.id, startedAt: now() })
    } else if (event === 'SIGNED_OUT') {
      saveRecovery(null)
    } else if (recovery && session?.user?.id !== recovery.userId) {
      saveRecovery(null)
      activeCallback = {}
      cleanUrl(true)
    }
    applySession(session)
    if (!initialized && !readingSession) scheduled = setTimeout(() => void readSession(), 0)
  }

  async function readSession() {
    const currentLife = lifetime
    const currentRead = ++readVersion
    readingSession = true
    const version = sessionVersion
    publish({ status: 'loading', context: null, error: '' })
    invalidateContext()
    try {
      const init = await deadline(() => client.auth.initialize(), timeoutMs)
      if (stopped || currentLife !== lifetime || currentRead !== readVersion) return
      // The SDK deliberately retains a previous session when a callback is invalid.
      // Such a session must never turn an expired link into an ordinary dashboard.
      if (init.error && (activeCallback.mode || activeCallback.hasTokens || activeCallback.error)) {
        activeCallback = { ...activeCallback, error: true }
      } else if (init.error) throw init.error
      const result = await deadline(() => client.auth.getSession(), timeoutMs)
      if (stopped || currentLife !== lifetime || currentRead !== readVersion) return
      initialized = true
      cleanUrl(false)
      if (sessionVersion !== version) { applySession(state.session); return }
      if (result.error) throw result.error
      applySession(result.data?.session || null)
    } catch (error) {
      if (!stopped && currentLife === lifetime && currentRead === readVersion) {
        if (sessionVersion !== version) {
          initialized = true
          applySession(state.session)
        } else publish({ status: 'session-error', context: null, error: authErrorMessage(error) })
      }
    } finally { if (currentRead === readVersion) readingSession = false }
  }

  async function signOut() {
    const userId = state.session?.user?.id
    invalidateContext()
    publish({ status: 'loading', context: null })
    try {
      const { error } = await deadline(() => client.auth.signOut({ scope: 'local' }), timeoutMs)
      if (state.session && state.session.user.id !== userId) return
      if (error) throw error
      saveRecovery(null)
      activeCallback = {}
      cleanUrl(true)
      applySession(null)
    } catch (error) {
      if (!state.session || state.session.user.id === userId) {
        publish({ status: 'signout-error', context: null, error: 'Sign-out could not be completed. Check your connection and try again.' })
      }
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn) },
    start() {
      if (!stopped) return
      stopped = false
      lifetime++
      subscription = client.auth.onAuthStateChange(onAuthEvent).data.subscription
      void readSession()
    },
    stop() {
      stopped = true
      lifetime++
      subscription?.unsubscribe()
      invalidateContext()
      clearTimeout(recoveryTimer)
    },
    retry() { return state.status === 'signout-error' ? signOut() : state.status === 'context-error' ? loadContext() : readSession() },
    reloadContext: loadContext,
    signOut,
    async updatePassword(password) {
      const session = state.session
      if (passwordPending) return false
      if (state.status !== 'recovery' || !isRecovery(session)) throw { code: 'bad_recovery' }
      passwordPending = true
      try {
        const { error } = await deadline(() => updatePasswordForSession(session, password), passwordTimeoutMs)
        if (error) throw error
        if (!stopped && state.session?.user?.id === session.user.id && isRecovery(state.session)) {
          saveRecovery(null)
          activeCallback = {}
          cleanUrl(true)
          clearTimeout(recoveryTimer)
          invalidateContext()
          publish({ status: 'password-updated', context: null, error: '' })
        }
        return true
      } catch (error) {
        // A timeout is not proof that the server rejected the mutation. Do not
        // offer another save through this form while its outcome is unknown.
        if (error.code === 'request_timeout') {
          const uncertain = { code: 'password_update_timeout' }
          if (!stopped && state.session?.user?.id === session.user.id && isRecovery(state.session)) {
            saveRecovery(null)
            activeCallback = { mode: 'recovery', error: true }
            clearTimeout(recoveryTimer)
            invalidateContext()
            publish({ status: 'recovery-error', callbackMode: 'recovery', context: null, error: authErrorMessage(uncertain) })
          }
          throw uncertain
        }
        throw error
      } finally { passwordPending = false }
    },
    continueAfterRecovery() {
      if (state.status !== 'password-updated') return
      applySession(state.session)
    },
  }
}
