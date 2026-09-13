import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { after, before, describe, it } from 'node:test'
import { build } from 'esbuild'
import { closeBrowser, closeServer, launchBrowser } from './browser-harness.mjs'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const ENTRY = `import React from 'react'; import { createRoot } from 'react-dom/client'; import App from './App.jsx'; createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode, null, React.createElement(App)))`
const SDK_USER = { id: 'reset-owner', email: 'owner@example.test', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-01-01T00:00:00Z' }
const sdkToken = () => [
  { alg: 'HS256', typ: 'JWT' },
  { sub: SDK_USER.id, exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) },
].map((value) => Buffer.from(JSON.stringify(value)).toString('base64url'))
  .concat(Buffer.from('fixture-signature').toString('base64url')).join('.')
const sdkRequests = []
// The real App and account controller are exercised. Only Supabase transport is
// replaced: no production URL, token, email, or user creation is involved.
const MOCK = `
import { createAccountSession, readAuthCallback, cleanAuthUrl } from './account-session.js'
const scenario = new URLSearchParams(location.search).get('scenario')
const owner = { user: { id: 'reset-owner', email: 'owner@example.test', app_metadata: {} }, access_token: 'fixture', refresh_token: 'fixture' }
let session = ['recovery', 'expired'].includes(scenario) ? owner : null
let listener
const calls = []
window.accountMock = {
  calls, failNext: false, holdNext: false,
  workspaceOrg: null, failRefreshNext: false, loseWorkspaceResponse: false,
  emit(event, value) { session = value; listener(event, value) },
}
async function operation(type, args) {
  calls.push({ type, ...args })
  if (window.accountMock.failNext) { window.accountMock.failNext = false; throw new TypeError('offline') }
  if (window.accountMock.holdNext) {
    window.accountMock.holdNext = false
    await new Promise(resolve => { window.accountMock.release = resolve })
  }
  return { data: {}, error: null }
}
export const isSupabaseConfigured = true
export const supabase = {
  auth: {
    initialize: async () => ({ error: scenario === 'expired' ? { code: 'otp_expired' } : null }),
    getSession: async () => ({ data: { session }, error: null }),
    getUser: async () => ({ data: { user: { ...owner.user, app_metadata: window.accountMock.workspaceOrg ? { org_id: window.accountMock.workspaceOrg } : {} } }, error: null }),
    refreshSession: async () => {
      await operation('refresh', {})
      if (window.accountMock.failRefreshNext) { window.accountMock.failRefreshNext = false; throw new TypeError('fixture refresh failed') }
      session = { ...owner, user: { ...owner.user, app_metadata: { org_id: window.accountMock.workspaceOrg } } }
      listener('TOKEN_REFRESHED', session)
      return { data: { session }, error: null }
    },
    onAuthStateChange(fn) {
      listener = fn
      if (scenario === 'recovery') setTimeout(() => listener('PASSWORD_RECOVERY', session), 0)
      return { data: { subscription: { unsubscribe() {} } } }
    },
    signInWithPassword: async (args) => {
      const result = await operation('signin', args)
      session = owner; listener('SIGNED_IN', owner)
      return { ...result, data: { session } }
    },
    signUp: args => operation('signup', args),
    resetPasswordForEmail: (email, options) => operation('reset', { email, options }),
    resend: args => operation('confirm', args),
    signOut: async () => { session = null; listener('SIGNED_OUT', null); return { error: null } },
  },
  rpc(name, args) {
    if (name === 'create_digital_workspace') return {
      setHeader(name, value) { window.accountMock.authorization = value; return this },
      abortSignal() { return this },
      then(resolve, reject) { return operation('bootstrap', args).then(() => {
        window.accountMock.workspaceOrg = 'workspace-org'
        if (window.accountMock.loseWorkspaceResponse) { window.accountMock.loseWorkspaceResponse = false; throw new TypeError('fixture response lost') }
        return { data: { org_id: 'workspace-org', location_id: 'workspace-location' }, error: null }
      }).then(resolve, reject) },
    }
    calls.push({ type: 'context' })
    if (name === 'get_backoffice_context' && window.accountMock.workspaceOrg) return Promise.resolve({ data: {
      organization: { id: 'workspace-org', name: 'Fixture cafe' },
      locations: [{ id: 'workspace-location', name: 'Main' }], products: [], capabilities: [],
      product_requests: [{ product: 'menu', status: 'pending' }], role: 'owner',
    }, error: null })
    return Promise.resolve({ error: { code: 'test_unexpected_context' } })
  },
}
export const accountSession = createAccountSession(supabase, {
  callback: readAuthCallback(location.href), storage: sessionStorage,
  cleanUrl: finish => history.replaceState(history.state, '', cleanAuthUrl(location.href, { finish })),
  updatePasswordForSession: (session, password) => operation('password', { userId: session.user.id, password }),
})
accountSession.start()
`

const { browser, skip } = await launchBrowser()
let server, origin, sdkBundle
before(async () => {
  if (skip) return
  const result = await build({
    stdin: { contents: ENTRY, resolveDir: SRC, loader: 'jsx' },
    bundle: true, write: false, format: 'esm', jsx: 'automatic',
    define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'account-auth-transport', setup(b) {
      b.onResolve({ filter: /(^|\/)supabase(\.js)?$/ }, () => ({ path: 'supabase', namespace: 'fixture' }))
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: MOCK, loader: 'js', resolveDir: SRC }))
    } }],
  })
  const css = ['styles.css', 'responsive.css'].map((name) => readFileSync(SRC + name, 'utf8')).join('\n')
  server = createServer(async (req, res) => {
    if (req.url === '/entry.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(result.outputFiles[0].text) }
    else if (req.url === '/sdk-entry.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(sdkBundle) }
    else if (req.url === '/styles.css') { res.setHeader('Content-Type', 'text/css'); res.end(css) }
    else if (req.url.startsWith('/auth/v1/')) {
      let body = ''
      for await (const chunk of req) body += chunk
      sdkRequests.push({ method: req.method, path: req.url, body: body ? JSON.parse(body) : null })
      res.setHeader('Content-Type', 'application/json')
      if (req.url === '/auth/v1/user' && ['GET', 'PUT'].includes(req.method)) res.end(JSON.stringify(SDK_USER))
      else { res.writeHead(400); res.end(JSON.stringify({ code: 'test_unexpected_auth_request', msg: 'Unexpected local fixture request' })) }
    }
    else if (req.url.startsWith('/account/')) {
      res.setHeader('Content-Type', 'text/html')
      const script = new URL(req.url, 'http://fixture').searchParams.has('sdk') ? '/sdk-entry.js' : '/entry.js'
      res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script type="module" src="${script}"></script></body></html>`)
    } else { res.writeHead(404); res.end() }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
  // A second bundle uses the installed Supabase SDK and the production bootstrap.
  // Its Auth URL is this test server; it cannot send mail or reach production.
  const sdkResult = await build({
    stdin: { contents: ENTRY, resolveDir: SRC, loader: 'jsx' },
    bundle: true, write: false, format: 'esm', jsx: 'automatic',
    define: {
      'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: origin, VITE_SUPABASE_ANON_KEY: 'fixture-anon-key' }),
      'process.env.NODE_ENV': '"production"',
    },
  })
  sdkBundle = sdkResult.outputFiles[0].text
})
after(async () => { await closeBrowser(browser); await closeServer(server) })

async function open(t, query = '') {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  page.setDefaultNavigationTimeout(15000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  t.after(async () => { await context.close(); assert.deepEqual(errors, []) })
  await page.setViewport({ width: 390, height: 844 })
  await page.goto(`${origin}/account/${query}`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('h1')
  return page
}
async function button(page, text) {
  const buttons = await page.$$('button')
  for (const element of buttons) if ((await element.evaluate((el) => el.textContent.trim())) === text) { await element.click(); return }
  throw new Error(`Button not found: ${text}`)
}
const title = (page, text) => page.waitForFunction((value) => document.querySelector('h1')?.textContent === value, {}, text)

describe('account auth and recovery', { skip }, () => {
  it('reset request uses fixed redirect, stays neutral, and ignores duplicate submits', async (t) => {
    const page = await open(t)
    await button(page, 'Forgot password?')
    await page.type('input[type=email]', 'owner@example.test')
    await page.evaluate(() => { window.accountMock.holdNext = true; document.querySelector('form').requestSubmit(); document.querySelector('form').requestSubmit() })
    await page.waitForFunction(() => window.accountMock.calls.length === 1)
    assert.equal(await page.$('input[type=password]'), null)
    assert.equal(await page.$eval('button[type=submit]', (el) => el.disabled), true)
    await page.evaluate(() => window.accountMock.release())
    await page.waitForSelector('[role=status]')
    assert.match(await page.$eval('[role=status]', (el) => el.textContent), /If this email belongs to an account/)
    assert.deepEqual(await page.evaluate(() => window.accountMock.calls), [{ type: 'reset', email: 'owner@example.test', options: { redirectTo: `${origin}/account/?auth=recovery` } }])
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  })

  it('network failure releases the form and supports an explicit retry', async (t) => {
    const page = await open(t)
    await button(page, 'Forgot password?')
    await page.type('input[type=email]', 'owner@example.test')
    await page.evaluate(() => { window.accountMock.failNext = true })
    await button(page, 'Send reset link')
    await page.waitForSelector('[role=alert]')
    assert.equal(await page.$eval('button[type=submit]', (el) => el.disabled), false)
    await button(page, 'Send reset link')
    await page.waitForSelector('[role=status]')
    assert.equal(await page.evaluate(() => window.accountMock.calls.length), 2)
  })

  it('signup without a session offers confirmation and can resend it', async (t) => {
    const page = await open(t)
    await button(page, 'Create an account')
    await page.type('input[type=email]', 'owner@example.test')
    await page.type('input[type=password]', 'new-password')
    await button(page, 'Continue')
    await title(page, 'Confirm your email')
    await button(page, 'Resend confirmation')
    await page.waitForFunction(() => window.accountMock.calls.length === 2)
    const calls = await page.evaluate(() => window.accountMock.calls)
    assert.equal(calls[0].options.emailRedirectTo, `${origin}/account/?auth=confirm`)
    assert.equal(calls[1].type, 'signup') // Supabase's resend payload uses type: signup.
    assert.equal(calls[1].options.emailRedirectTo, `${origin}/account/?auth=confirm`)
  })

  it('an existing six-character password still reaches onboarding', async (t) => {
    const page = await open(t)
    await page.type('input[type=email]', 'owner@example.test')
    await page.type('input[type=password]', 'old123')
    await button(page, 'Continue')
    await title(page, 'What do you want to do?')
  })

  it('recovery opens before onboarding, checks confirmation, and saves once', async (t) => {
    const page = await open(t, '?auth=recovery&scenario=recovery')
    await title(page, 'Set a new password')
    assert.equal(await page.evaluate(() => window.accountMock.calls.length), 0)
    const inputs = await page.$$('input[type=password]')
    await inputs[0].type('new-password')
    await inputs[1].type('not-matching')
    await button(page, 'Save new password')
    await page.waitForSelector('[role=alert]')
    assert.match(await page.$eval('[role=alert]', (el) => el.textContent), /do not match/)
    await inputs[1].click()
    await inputs[1].evaluate((el) => el.select())
    await page.keyboard.press('Backspace')
    await inputs[1].type('new-password')
    assert.deepEqual(await page.$$eval('input[type=password]', (elements) => elements.map((el) => el.value)), ['new-password', 'new-password'])
    await page.evaluate(() => { document.querySelector('form').requestSubmit(); document.querySelector('form').requestSubmit() })
    await title(page, 'Password updated')
    assert.deepEqual(await page.evaluate(() => window.accountMock.calls), [{ type: 'password', userId: 'reset-owner', password: 'new-password' }])
    assert.equal(new URL(page.url()).searchParams.has('auth'), false)
    await button(page, 'Continue to workspace')
    await title(page, 'What do you want to do?')
  })

  it('expired link with an existing session does not open that workspace', async (t) => {
    const page = await open(t, '?auth=recovery&scenario=expired#error_code=otp_expired')
    await title(page, 'Reset your password')
    assert.match(await page.$eval('[role=alert]', (el) => el.textContent), /invalid, expired/)
    assert.equal(await page.evaluate(() => window.accountMock.calls.length), 0)
    assert.equal(new URL(page.url()).hash, '')
    await button(page, 'Back to sign in')
    await title(page, 'Sign in')
  })

  it('real SDK consumes recovery callback before App mounts and saves through the isolated client', async (t) => {
    sdkRequests.length = 0
    const hash = new URLSearchParams({ access_token: sdkToken(), refresh_token: 'fixture-refresh', expires_in: '3600', token_type: 'bearer', type: 'recovery' })
    const page = await open(t, `?sdk&auth=recovery#${hash}`)
    await title(page, 'Set a new password')
    assert.equal(new URL(page.url()).hash, '')
    const metadata = await page.evaluate(() => JSON.parse(sessionStorage.getItem('angle.account.recovery')))
    assert.deepEqual(Object.keys(metadata).sort(), ['startedAt', 'userId'])
    await page.reload({ waitUntil: 'networkidle0' })
    await title(page, 'Set a new password')
    const inputs = await page.$$('input[type=password]')
    for (const input of inputs) await input.type('sdk-new-password')
    await button(page, 'Save new password')
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Password updated' || document.querySelector('[role=alert]'))
    assert.equal(await page.$eval('h1', (el) => el.textContent), 'Password updated', await page.$eval('main', (el) => el.innerText) + JSON.stringify(sdkRequests))
    assert.deepEqual(sdkRequests.filter((request) => request.method === 'PUT'), [{ method: 'PUT', path: '/auth/v1/user', body: { password: 'sdk-new-password', code_challenge: null, code_challenge_method: null } }])
    assert.equal(sdkRequests.some((request) => request.path.includes('/token')), false)
    assert.equal(await page.evaluate(() => sessionStorage.getItem('angle.account.recovery')), null)
  })

  it('real SDK confirmation callback opens onboarding, not password recovery', async (t) => {
    const hash = new URLSearchParams({ access_token: sdkToken(), refresh_token: 'fixture-refresh', expires_in: '3600', token_type: 'bearer', type: 'signup' })
    const page = await open(t, `?sdk&auth=confirm#${hash}`)
    await title(page, 'What do you want to do?')
    assert.equal(new URL(page.url()).hash, '')
    assert.equal(await page.evaluate(() => sessionStorage.getItem('angle.account.recovery')), null)
  })

  it('real SDK rejects an expired callback and keeps the resend route accessible', async (t) => {
    const page = await open(t, '?sdk&auth=confirm#error=access_denied&error_code=otp_expired&error_description=Fixture+expired')
    await title(page, 'Confirm your email')
    assert.match(await page.$eval('[role=alert]', (el) => el.textContent), /invalid, expired/)
    assert.equal(new URL(page.url()).hash, '')
  })

  async function onboarding(t) {
    const page = await open(t)
    await page.type('input[type=email]', 'owner@example.test')
    await page.type('input[type=password]', 'old123')
    await button(page, 'Continue')
    await title(page, 'What do you want to do?')
    await page.type('.auth-form input', 'Fixture cafe')
    return page
  }

  it('workspace double submit creates once and does not activate a product', async (t) => {
    const page = await onboarding(t)
    await page.evaluate(() => { window.accountMock.holdNext = true; document.querySelector('form').requestSubmit(); document.querySelector('form').requestSubmit() })
    await page.waitForFunction(() => window.accountMock.calls.some((call) => call.type === 'bootstrap'))
    assert.equal(await page.$eval('.goal-card', (el) => el.disabled), true)
    await page.evaluate(() => window.accountMock.release())
    await title(page, 'Fixture cafe')
    const calls = await page.evaluate(() => window.accountMock.calls.filter((call) => call.type === 'bootstrap'))
    assert.equal(calls.length, 1)
    assert.match(calls[0].p_request_id, /^[0-9a-f-]{36}$/)
    assert.equal(await page.evaluate(() => window.accountMock.authorization), 'Bearer fixture')
    assert.match(await page.$eval('main', (el) => el.textContent), /subscription activated after confirmed payment/)
    assert.equal(await page.evaluate(() => sessionStorage.getItem('angle.workspace-setup.reset-owner')), null)
  })

  it('workspace refresh failure offers continuation without another create call', async (t) => {
    const page = await onboarding(t)
    await page.evaluate(() => { window.accountMock.failRefreshNext = true })
    await button(page, 'Create workspace')
    await page.waitForSelector('[role=alert]')
    assert.match(await page.$eval('[role=alert]', (el) => el.textContent), /workspace exists/)
    assert.equal(await page.$eval('.auth-form input', (el) => el.disabled), true)
    await button(page, 'Check and continue')
    await title(page, 'Fixture cafe')
    assert.equal(await page.evaluate(() => window.accountMock.calls.filter((call) => call.type === 'bootstrap').length), 1)
  })

  it('a lost committed response recovers by checking the server before retrying', async (t) => {
    const page = await onboarding(t)
    await page.evaluate(() => { window.accountMock.loseWorkspaceResponse = true })
    await button(page, 'Create workspace')
    await page.waitForSelector('[role=alert]')
    await button(page, 'Check and continue')
    await title(page, 'Fixture cafe')
    assert.equal(await page.evaluate(() => window.accountMock.calls.filter((call) => call.type === 'bootstrap').length), 1)
  })

  it('an uncertain workspace request survives reload with the same id and input', async (t) => {
    const page = await onboarding(t)
    await page.evaluate(() => { window.accountMock.failNext = true })
    await button(page, 'Create workspace')
    await page.waitForSelector('[role=alert]')
    const first = await page.evaluate(() => window.accountMock.calls.find((call) => call.type === 'bootstrap'))
    await page.reload({ waitUntil: 'networkidle0' })
    await page.type('input[type=email]', 'owner@example.test')
    await page.type('input[type=password]', 'old123')
    await button(page, 'Continue')
    await title(page, 'What do you want to do?')
    assert.equal(await page.$eval('.auth-form input', (el) => el.value), 'Fixture cafe')
    assert.equal(await page.$eval('.auth-form input', (el) => el.disabled), true)
    await button(page, 'Check and continue')
    await title(page, 'Fixture cafe')
    assert.deepEqual(await page.evaluate(() => window.accountMock.calls.find((call) => call.type === 'bootstrap')), first)
  })
})
