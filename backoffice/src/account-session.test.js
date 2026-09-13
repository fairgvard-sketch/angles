import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  authErrorMessage, authRedirectUrl, cleanAuthUrl, createAccountSession,
  readAuthCallback, updatePasswordWithSession, validateNewPassword,
} from './account-session.js'

const A = { user: { id: 'a', email: 'a@example.test', app_metadata: { org_id: 'org-a' } }, access_token: 'a-token', refresh_token: 'a-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600 }
const B = { user: { id: 'b', email: 'b@example.test', app_metadata: { org_id: 'org-b' } }, access_token: 'b-token', refresh_token: 'b-refresh' }
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  assert.ok(check(), 'state did not settle')
}
function setup(t, options = {}) {
  let listener
  let session = options.session ?? A
  const calls = []
  const stored = new Map()
  const storage = { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: (key) => stored.delete(key) }
  const client = {
    auth: {
      initialize: async () => ({ error: null }),
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: (fn) => { listener = fn; return { data: { subscription: { unsubscribe() {} } } } },
      signOut: async () => { session = null; listener('SIGNED_OUT', null); return { error: null } },
    },
    rpc: async (name) => { calls.push(name); return { data: { organization: { id: session.user.app_metadata.org_id } }, error: null } },
  }
  if (options.auth) Object.assign(client.auth, options.auth)
  if (options.rpc) client.rpc = options.rpc
  const controller = createAccountSession(client, { storage, updatePasswordForSession: async () => ({ error: null }), ...options })
  t.after(() => controller.stop())
  controller.start()
  return { client, controller, state: controller.getSnapshot, calls, stored, storage,
    emit(event, value) { session = value; listener(event, value) } }
}

test('redirects use only current origin and fixed account path', () => {
  assert.equal(authRedirectUrl('https://angle.co.il/account/?next=https://evil.test/#secret', 'recovery'), 'https://angle.co.il/account/?auth=recovery')
  assert.equal(authRedirectUrl('http://127.0.0.1:5173/account/', 'confirm'), 'http://127.0.0.1:5173/account/?auth=confirm')
  assert.throws(() => authRedirectUrl('https://angle.co.il', 'arbitrary'))
})
test('callback snapshot retains flags, not tokens or untrusted error text', () => {
  assert.deepEqual(readAuthCallback('https://angle.co.il/account/#type=recovery&access_token=secret&refresh_token=private'), { mode: 'recovery', hasTokens: true, error: false })
  assert.deepEqual(readAuthCallback('https://angle.co.il/account/?auth=recovery#error_code=otp_expired&error_description=anything'), { mode: 'recovery', hasTokens: false, error: true })
})
test('URL cleanup removes sensitive auth material but preserves the workspace route', () => {
  assert.equal(cleanAuthUrl('https://angle.co.il/account/?view=menu&auth=recovery#access_token=secret&refresh_token=private&type=recovery'), '/account/?view=menu&auth=recovery')
  assert.equal(cleanAuthUrl('https://angle.co.il/account/?auth=recovery&error_code=expired', { finish: true }), '/account/')
  assert.equal(cleanAuthUrl('https://angle.co.il/account/?view=menu#section'), '/account/?view=menu#section')
})
test('new passwords require length and matching confirmation without trimming', () => {
  assert.match(validateNewPassword('short', 'short'), /8/)
  assert.match(validateNewPassword('abcdefgh', 'abcdefgi'), /match/)
  assert.equal(validateNewPassword(' 123456 ', ' 123456 '), '')
  assert.doesNotMatch(authErrorMessage({ message: 'https://secret.test/token=secret' }), /secret/)
})

test('password timeout reports an unknown outcome and invalidates this save form', async (t) => {
  const result = deferred()
  const f = setup(t, { passwordTimeoutMs: 10, updatePasswordForSession: () => result.promise })
  f.emit('PASSWORD_RECOVERY', A)
  await until(() => f.state().status === 'recovery')
  await assert.rejects(f.controller.updatePassword('new-password'), { code: 'password_update_timeout' })
  assert.equal(f.state().status, 'recovery-error')
  assert.match(f.state().error, /could not be confirmed/)
  await assert.rejects(f.controller.updatePassword('second-password'), { code: 'bad_recovery' })
  result.resolve({ error: null })
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(f.state().status, 'recovery-error')
})

test('signed-out and new-account sessions do not fetch workspace context', async (t) => {
  const signedOut = setup(t, { auth: { getSession: async () => ({ data: { session: null }, error: null }) } })
  await until(() => signedOut.state().status === 'anonymous')
  const fresh = setup(t, { session: { user: { id: 'new', app_metadata: {} } } })
  await until(() => fresh.state().status === 'onboarding')
  assert.equal(signedOut.calls.length + fresh.calls.length, 0)
})
test('ordinary owner loads context and repeated focus sign-in does not unmount it', async (t) => {
  const f = setup(t)
  await until(() => f.state().status === 'ready')
  const before = f.state()
  f.emit('SIGNED_IN', A)
  assert.equal(f.state(), before)
  assert.equal(f.calls.length, 1)
})
test('a mismatched workspace response is never published for the current account', async (t) => {
  const f = setup(t, { rpc: async () => ({ data: { organization: { id: 'org-b' } }, error: null }) })
  await until(() => f.state().status !== 'loading')
  assert.equal(f.state().status, 'context-error')
  assert.equal(f.state().context, null)
})
test('context RPC is bound to the access token captured for this account', async (t) => {
  const headers = []
  const f = setup(t, { rpc: () => ({
    setHeader(name, value) { headers.push([name, value]); return this },
    abortSignal() { return this },
    then(resolve) { return Promise.resolve({ data: { organization: { id: 'org-a' } }, error: null }).then(resolve) },
  }) })
  await until(() => f.state().status === 'ready')
  assert.deepEqual(headers, [['Authorization', 'Bearer a-token']])
})
test('failed session read is visible even if INITIAL_SESSION is null', async (t) => {
  const f = setup(t, { auth: { getSession: async () => ({ data: { session: null }, error: { code: 'request_timeout' } }) } })
  f.emit('INITIAL_SESSION', null)
  await until(() => f.state().status === 'session-error')
  f.client.auth.getSession = async () => ({ data: { session: A }, error: null })
  f.client.rpc = async () => ({ data: { organization: { id: 'org-a' } }, error: null })
  await f.controller.retry()
  await until(() => f.state().status === 'ready')
})
test('thrown session errors do not leave a spinner indefinitely', async (t) => {
  const f = setup(t, { auth: { getSession: async () => { throw new TypeError('network') } } })
  await until(() => f.state().status === 'session-error')
  assert.equal(f.state().context, null)
})
test('context errors can be retried', async (t) => {
  const f = setup(t, { rpc: async () => { throw new TypeError('network') } })
  await until(() => f.state().status === 'context-error')
  f.client.rpc = async () => ({ data: { organization: { id: 'org-a' } }, error: null })
  await f.controller.retry()
  assert.equal(f.state().status, 'ready')
})
test('hung context request times out instead of showing an empty workspace', async (t) => {
  const f = setup(t, { rpc: () => new Promise(() => {}), timeoutMs: 10 })
  await until(() => f.state().status === 'context-error')
  assert.equal(f.state().context, null)
})
test('late context response after sign-out cannot restore old customer data', async (t) => {
  const result = deferred()
  let requested = false
  const f = setup(t, { rpc: () => { requested = true; return result.promise } })
  await until(() => requested)
  f.emit('SIGNED_OUT', null)
  result.resolve({ data: { organization: { id: 'org-a' } }, error: null })
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(f.state().status, 'anonymous')
  assert.equal(f.state().context, null)
})
test('switching accounts clears old context immediately and rejects late responses', async (t) => {
  const old = deferred(), fresh = deferred()
  let calls = 0
  const f = setup(t, { rpc: () => ++calls === 1 ? old.promise : fresh.promise })
  await until(() => calls === 1)
  f.emit('SIGNED_IN', B)
  assert.equal(f.state().context, null)
  await until(() => calls === 2)
  fresh.resolve({ data: { organization: { id: 'org-b' } }, error: null })
  await until(() => f.state().status === 'ready')
  old.resolve({ data: { organization: { id: 'org-a' } }, error: null })
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(f.state().session.user.id, 'b')
  assert.equal(f.state().context.organization.id, 'org-b')
})
test('auth event wins over a stale initial getSession result', async (t) => {
  const read = deferred()
  const f = setup(t, { auth: { getSession: () => read.promise } })
  f.emit('SIGNED_IN', B)
  read.resolve({ data: { session: A }, error: null })
  await until(() => f.state().status === 'ready')
  assert.equal(f.state().session.user.id, 'b')
})
test('recovery marker alone cannot turn an existing ordinary session into a reset session', async (t) => {
  const f = setup(t, { callback: { mode: 'recovery' } })
  await until(() => f.state().status === 'recovery-error')
  assert.equal(f.calls.length, 0)
  await assert.rejects(() => f.controller.updatePassword('abcdefgh'), { code: 'bad_recovery' })
})
test('invalid callback cannot fall back to the previous logged-in account', async (t) => {
  const f = setup(t, { callback: { mode: 'recovery', hasTokens: true }, auth: { initialize: async () => ({ error: { code: 'otp_expired' } }) } })
  await until(() => f.state().status === 'recovery-error')
  assert.equal(f.calls.length, 0)
})
test('recovery event opens password form before onboarding or context load', async (t) => {
  const f = setup(t, { callback: { mode: 'recovery', hasTokens: true } })
  await until(() => f.state().status === 'recovery-loading')
  f.emit('PASSWORD_RECOVERY', A)
  assert.equal(f.state().status, 'recovery')
  f.emit('TOKEN_REFRESHED', { ...A, access_token: 'refreshed' })
  assert.equal(f.state().status, 'recovery')
  assert.equal(f.calls.length, 0)
  assert.doesNotMatch([...f.stored.values()].join(''), /token|refresh/)
})
test('early PASSWORD_RECOVERY is not lost during initialization', async (t) => {
  const f = setup(t)
  f.emit('PASSWORD_RECOVERY', A)
  await until(() => f.state().status === 'recovery')
  assert.equal(f.calls.length, 0)
})
test('valid per-tab recovery survives reload, expires, and is bound to a user', async (t) => {
  const stored = new Map([['angle.account.recovery', JSON.stringify({ userId: 'a', startedAt: 1000 })]])
  const storage = { getItem: (key) => stored.get(key), setItem() {}, removeItem() {} }
  const valid = setup(t, { storage, now: () => 2000 })
  await until(() => valid.state().status === 'recovery')
  const expired = setup(t, { storage, now: () => 1000 + 15 * 60 * 1000 })
  await until(() => expired.state().status === 'recovery-error')
  const wrong = setup(t, { storage, session: B, now: () => 2000 })
  await until(() => wrong.state().status === 'recovery-error')
})
test('blocked browser storage does not prevent a fresh recovery', async (t) => {
  const blocked = () => { throw new Error('blocked') }
  const f = setup(t, { storage: { getItem: blocked, setItem: blocked, removeItem: blocked } })
  f.emit('PASSWORD_RECOVERY', A)
  await until(() => f.state().status === 'recovery')
})
test('password save is single-flight and context stays hidden until continuing', async (t) => {
  const saved = deferred()
  let calls = 0
  const f = setup(t, { updatePasswordForSession: (session, password) => {
    calls++; assert.equal(session.user.id, 'a'); assert.equal(password, 'new-password'); return saved.promise
  } })
  f.emit('PASSWORD_RECOVERY', A)
  await until(() => f.state().status === 'recovery')
  const first = f.controller.updatePassword('new-password')
  assert.equal(await f.controller.updatePassword('new-password'), false)
  saved.resolve({ error: null })
  await first
  assert.equal(calls, 1)
  assert.equal(f.state().status, 'password-updated')
  assert.equal(f.calls.length, 0)
  f.controller.continueAfterRecovery()
  await until(() => f.state().status === 'ready')
})
test('switching user while a password save is pending cannot replace their screen', async (t) => {
  const saved = deferred()
  const f = setup(t, { updatePasswordForSession: () => saved.promise })
  f.emit('PASSWORD_RECOVERY', A)
  await until(() => f.state().status === 'recovery')
  const operation = f.controller.updatePassword('new-password')
  f.emit('SIGNED_IN', B)
  await until(() => f.state().status === 'ready')
  saved.resolve({ error: null })
  await operation
  assert.equal(f.state().status, 'ready')
  assert.equal(f.state().session.user.id, 'b')
})
test('sign-out failure hides workspace data and presents recovery actions', async (t) => {
  const f = setup(t, { auth: { signOut: async () => ({ error: new Error('offline') }) } })
  await until(() => f.state().status === 'ready')
  await f.controller.signOut()
  assert.equal(f.state().status, 'signout-error')
  assert.equal(f.state().context, null)
  let retried = false
  f.client.auth.signOut = async () => { retried = true; f.emit('SIGNED_OUT', null); return { error: null } }
  await f.controller.retry()
  assert.equal(retried, true)
  assert.equal(f.state().status, 'anonymous')
})
test('disposed controller ignores late session reads', async (t) => {
  const read = deferred()
  const f = setup(t, { auth: { getSession: () => read.promise } })
  f.controller.stop()
  const before = f.state()
  read.resolve({ data: { session: A }, error: null })
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(f.state(), before)
})
test('isolated password update pins tokens, verifies identity and disposes the client', async () => {
  const calls = []
  const client = { auth: {
    setSession: async (tokens) => { calls.push(tokens); return { data: { user: A.user }, error: null } },
    updateUser: async (attributes) => { calls.push(attributes); return { error: null } },
    dispose: async () => { calls.push('disposed') },
  } }
  await updatePasswordWithSession(() => client, A, 'new-password')
  assert.deepEqual(calls, [{ access_token: A.access_token, refresh_token: A.refresh_token }, { password: 'new-password' }, 'disposed'])
  calls.length = 0
  client.auth.setSession = async () => ({ data: { user: B.user }, error: null })
  assert.equal((await updatePasswordWithSession(() => client, A, 'new-password')).error.code, 'bad_recovery')
  assert.deepEqual(calls, ['disposed'])
})

test('isolated operation does not refresh expired shared credentials', async () => {
  let created = false
  const result = await updatePasswordWithSession(() => { created = true }, { ...A, expires_at: 1 }, 'new-password')
  assert.equal(result.error.code, 'bad_recovery')
  assert.equal(created, false)
})

test('session event arriving after an initialization timeout can recover the UI', async (t) => {
  const init = deferred()
  const f = setup(t, { timeoutMs: 10, auth: { initialize: () => init.promise } })
  await until(() => f.state().status === 'session-error')
  init.resolve({ error: null })
  f.emit('SIGNED_IN', A)
  await until(() => f.state().status === 'ready')
})

test('sign-out wins over a failing old getSession request', async (t) => {
  const read = deferred()
  const f = setup(t, { auth: { getSession: () => read.promise } })
  f.emit('SIGNED_OUT', null)
  read.reject(new Error('old failure'))
  await until(() => f.state().status === 'anonymous')
})
