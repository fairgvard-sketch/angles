// Explicit, opt-in integration acceptance. Real App/SDK/GoTrue/SMTP/PostgREST.
// Synthetic users only. Test-issued JWTs cannot stand in for authenticated users.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { startAuthLab, validateAuthDatabase } from './auth-lab.mjs'
import { LAB_SCHEMA_VERSION } from './lab-migrations.mjs'
import { launchBrowser, closeBrowser } from '../backoffice/test/browser-harness.mjs'

const database = validateAuthDatabase(process.argv[2])
let lab, browser, checks = 0
const abort = new AbortController()
const pass = description => { checks++; console.log('PASS: ' + description) }
const clients = []
const password = 'Local-' + randomUUID(), newPassword = 'Changed-' + randomUUID()
const email = 'owner-a@example.test', otherEmail = 'owner-b@example.test'
const controller = async page => page.evaluate(async () => {
  const { accountSession } = await import('/entry.js')
  const s = accountSession.getSnapshot()
  return { status: s.status, id: s.session?.user?.id, org: s.session?.user?.app_metadata?.org_id, context: s.context }
})
async function status(page, expected) {
  try {
    await page.waitForFunction(async expected => (await import('/entry.js')).accountSession.getSnapshot().status === expected,
      // A deliberately background tab has no rAF. Observe Auth state with a
      // timer; do not turn an already-correct cross-tab update into a timeout.
      { timeout: 20000, polling: 100 }, expected)
  } catch (error) {
    console.log('Account diagnostic:', JSON.stringify({ expected, state: await controller(page),
      ui: await page.evaluate(() => ({ heading: document.querySelector('h1')?.textContent,
        alert: document.querySelector('[role=alert]')?.textContent, visibility: document.visibilityState })) }))
    throw error
  }
}
async function click(page, label) {
  await page.waitForFunction(text => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === text && !b.disabled), { timeout: 15000 }, label)
  await page.evaluate(text => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text).click(), label)
}
const title = (page, text) => page.waitForFunction(text => document.querySelector('h1')?.textContent === text, { timeout: 15000 }, text)
async function signIn(page, address, secret) {
  await title(page, 'Sign in')
  await page.type('input[type=email]', address)
  await page.type('input[type=password]', secret)
  await click(page, 'Continue')
}
function client() {
  const value = createClient(lab.origin, lab.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  clients.push(value)
  return value
}
const noError = result => assert.equal(result.error?.code || result.error?.message || null, null)
const uid = value => { assert.match(value, /^[a-f\d-]{36}$/); return "'" + value + "'" }
let cleaning
function cleanup() {
  return cleaning ||= (async () => {
    await closeBrowser(browser)
    for (const c of clients) await c.auth.dispose()
    await lab?.close()
  })()
}
async function interrupt() {
  abort.abort(new Error('Auth acceptance interrupted or exceeded its four-minute deadline'))
  if (lab) { await cleanup(); process.exit(1) }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, interrupt)
const deadline = setTimeout(interrupt, 240000)
try {
  lab = await startAuthLab({ database, signal: abort.signal })
  await assert.rejects(() => startAuthLab({ database }), /Refusing to overwrite/)
  pass('existing database cannot be overwritten or reset')
  ;({ browser } = await launchBrowser())
  assert.ok(browser, 'Real Chrome is required')
  const context = await browser.createBrowserContext()
  const errors = [], external = []
  async function pageIn(ctx = context) {
    const p = await ctx.newPage()
    p.setDefaultTimeout(15000)
    p.setDefaultNavigationTimeout(20000)
    p.on('pageerror', () => errors.push('pageerror')) // no session/token in diagnostic output
    await p.setRequestInterception(true)
    p.on('request', request => {
      const url = new URL(request.url())
      if (url.origin === lab.origin || ['data:', 'blob:'].includes(url.protocol)) void request.continue()
      else { external.push(url.origin); void request.abort() }
    })
    await p.setViewport({ width: 390, height: 844 })
    await p.goto(lab.origin + '/account/')
    return p
  }
  const page = await pageIn()
  await title(page, 'Sign in')
  const anon = client()
  assert.ok((await anon.rpc('create_digital_workspace', { p_request_id: randomUUID(), p_org_name: 'Forbidden', p_location_name: 'Main', p_products: ['menu'] })).error)
  assert.equal(lab.sql('SELECT count(*) FROM orgs;'), '0')
  pass('anonymous HTTP cannot create a workspace')

  await click(page, 'Create an account')
  await page.type('input[type=email]', email)
  await page.type('input[type=password]', password)
  await click(page, 'Continue')
  await title(page, 'Confirm your email')
  await lab.emailLink(email, 'signup') // first message really traversed SMTP
  assert.equal(lab.sql('SELECT count(*) FROM auth.users WHERE email_confirmed_at IS NULL;'), '1')
  assert.equal((await controller(page)).status, 'anonymous')
  pass('UI signup sends a real local confirmation email, without granting a session')

  await click(page, 'Back to sign in')
  // Mode switches keep email intentionally; fill only the password.
  await page.type('input[type=password]', password)
  await click(page, 'Continue')
  await page.waitForFunction(() => document.querySelector('[role=alert]')?.textContent.includes('Confirm your email'))
  assert.equal((await controller(page)).status, 'anonymous')
  pass('unconfirmed account cannot sign in')
  await click(page, 'Resend confirmation email')
  // Local Auth keeps the real per-user SMTP throttle, shortened to one second.
  await new Promise(resolve => setTimeout(resolve, 1100))
  await click(page, 'Resend confirmation')
  await page.waitForFunction(() => !document.querySelector('form[aria-busy=true]'))
  assert.equal(await page.$eval('form', el => el.querySelector('[role=alert]')?.textContent || ''), '')
  const confirmation = await lab.emailLink(email, 'signup')
  await page.goto(confirmation)
  await status(page, 'onboarding')
  assert.equal(new URL(page.url()).hash, '')
  assert.equal(lab.sql('SELECT count(*) FROM auth.users WHERE email_confirmed_at IS NOT NULL;'), '1')
  pass('resent email confirms the account and opens onboarding; callback tokens removed')

  // Drop the HTTP response only AFTER PostgREST commits workspace creation.
  lab.dropNextWorkspaceResponse()
  await page.type('input:not([type])', 'Auth Lab Cafe A')
  await click(page, 'Create workspace')
  try {
    await page.waitForFunction(() => document.querySelector('[role=alert]')?.textContent.includes('same request'), { timeout: 20000 })
  } catch (error) {
    console.log('Workspace diagnostic:', JSON.stringify({ ...lab.diagnostics(), state: await controller(page),
      ui: await page.evaluate(() => ({ heading: document.querySelector('h1')?.textContent,
        alert: document.querySelector('[role=alert]')?.textContent, busy: document.querySelector('form')?.getAttribute('aria-busy') })) }))
    throw error
  }
  assert.equal(lab.lostResponses(), 1)
  assert.equal(lab.sql('SELECT count(*) FROM orgs;'), '1')
  await page.reload()
  await click(page, 'Check and continue')
  await status(page, 'ready')
  const owner = await controller(page)
  assert.equal(owner.context.organization.name, 'Auth Lab Cafe A')
  assert.equal(owner.context.organization.id, owner.org)
  assert.equal(lab.sql('SELECT count(*) FROM orgs;'), '1')
  assert.equal(lab.sql('SELECT count(*) FROM locations;'), '1')
  assert.equal(lab.sql('SELECT count(*) FROM organization_products;'), '0')
  pass('lost committed onboarding response + reload/retry creates exactly one workspace and refreshes real JWT')
  assert.ok(!owner.context.capabilities.includes('public_menu'))
  const a = client()
  noError(await a.auth.signInWithPassword({ email, password }))
  const locationId = owner.context.locations[0].id
  const checkout = () => a.rpc('create_subscription_checkout', { p_request_id: randomUUID(), p_location_id: locationId, p_product: 'menu' })
  assert.equal((await checkout()).error?.message, 'checkout_disabled')
  pass('new confirmed owner has no paid capability; disabled checkout rejects the real Auth JWT')

  lab.sql("UPDATE billing_checkout_settings SET mode='test';")
  await click(page, 'Manage subscriptions')
  await click(page, 'Review invoice')
  await page.waitForSelector('[data-invoice-status="open"]')
  const catalog = await a.rpc('get_subscription_catalog'); noError(catalog)
  assert.equal(catalog.data.invoices.length, 1)
  const invoiceResult = await a.rpc('get_subscription_checkout', { p_invoice_id: catalog.data.invoices[0].invoice_id }); noError(invoiceResult)
  const invoice = invoiceResult.data
  assert.equal(invoice.status, 'open')
  assert.equal(lab.sql('SELECT count(*) FROM organization_products;'), '0')
  // An authenticated owner cannot forge a provider payment via HTTP.
  assert.equal((await a.rpc('record_provider_payment', { p_provider: 'manual', p_event_id: 'forged',
    p_invoice_id: invoice.invoice_id, p_amount_agorot: invoice.total_agorot, p_currency: invoice.currency,
    p_event_type: 'payment_succeeded', p_provider_ref: 'forged', p_payload: {} })).error?.code, '42501')
  assert.equal(lab.sql('SELECT count(*) FROM organization_products;'), '0')
  pass('real-JWT checkout creates an unpaid invoice; client cannot fake provider confirmation')
  const payment = lab.sql(`BEGIN; SET LOCAL ROLE service_role;
    SELECT record_provider_payment('manual','auth-lab:' || id,id,total_agorot,currency,
      'payment_succeeded','LOCAL-TEST-ONLY','{"simulated":true}') FROM invoices WHERE id=${uid(invoice.invoice_id)}; COMMIT;`)
  assert.equal(JSON.parse(payment).outcome, 'applied')
  const paid = await a.rpc('get_subscription_checkout', { p_invoice_id: invoice.invoice_id }); noError(paid)
  assert.equal(paid.data.status, 'paid')
  await click(page, 'Check payment status')
  await page.waitForSelector('[data-invoice-status="paid"]')
  await click(page, 'Refresh workspace access')
  await status(page, 'ready')
  assert.ok((await controller(page)).context.capabilities.includes('public_menu'))
  pass('only isolated server-side payment confirmation activates paid access in the actual App')

  await page.goto(confirmation)
  await status(page, 'recovery-error')
  assert.equal((await controller(page)).context, null)
  pass('used confirmation link cannot silently open an already signed-in workspace')
  await click(page, 'Back to sign in')
  await status(page, 'anonymous')
  await click(page, 'Forgot password?')
  await page.type('input[type=email]', email)
  await click(page, 'Send reset link')
  const recovery = await lab.emailLink(email, 'recovery')
  await page.goto(recovery)
  await status(page, 'recovery')
  assert.equal((await controller(page)).id, owner.id)
  assert.equal(new URL(page.url()).hash, '')
  await page.reload()
  await status(page, 'recovery')
  const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('angle.account.recovery')))
  assert.deepEqual(Object.keys(stored).sort(), ['startedAt', 'userId'])
  await page.type('input[type=password]', newPassword)
  await page.type('label:nth-of-type(2) input', newPassword)
  await click(page, 'Save new password')
  await title(page, 'Password updated')
  pass('SMTP recovery survives reload and changes the password through the isolated SDK operation')
  const verify = client()
  assert.equal((await verify.auth.signInWithPassword({ email, password })).error?.code, 'invalid_credentials')
  noError(await verify.auth.signInWithPassword({ email, password: newPassword }))
  pass('old password rejected and new password accepted by GoTrue')
  await click(page, 'Continue to workspace')
  await status(page, 'ready')
  await page.goto(recovery)
  await status(page, 'recovery-error')
  assert.equal((await controller(page)).context, null)
  pass('used reset link is rejected even with a valid stored session')
  await click(page, 'Back to sign in')
  await signIn(page, email, newPassword)
  await status(page, 'ready')
  assert.equal((await controller(page)).org, owner.org)
  pass('normal UI sign-in with the new password returns to the same paid workspace')

  const b = client()
  noError(await b.auth.signUp({ email: otherEmail, password, options: { emailRedirectTo: lab.origin + '/account/?auth=confirm' } }))
  const bContext = await browser.createBrowserContext(), bPage = await pageIn(bContext)
  await bPage.goto(await lab.emailLink(otherEmail, 'signup'))
  await status(bPage, 'onboarding')
  await bPage.type('input:not([type])', 'Auth Lab Cafe B')
  await click(bPage, 'Create workspace')
  await status(bPage, 'ready')
  const other = await controller(bPage)
  assert.notEqual(other.org, owner.org)
  noError(await b.auth.signInWithPassword({ email: otherEmail, password }))
  assert.equal((await b.rpc('get_subscription_checkout', { p_invoice_id: invoice.invoice_id })).error?.message, 'checkout_not_found')
  assert.ok(!(await controller(bPage)).context.capabilities.includes('public_menu'))
  pass('second real account cannot see the first invoice or inherit its paid access')

  noError(await anon.auth.resetPasswordForEmail(email, { redirectTo: lab.origin + '/account/?auth=recovery' }))
  const aReset = await lab.emailLink(email, 'recovery')
  await bPage.goto(aReset)
  await status(bPage, 'recovery')
  assert.equal((await controller(bPage)).id, owner.id)
  assert.equal((await controller(bPage)).context, null)
  assert.ok((await bPage.$eval('.auth-intro', e => e.textContent)).includes(email))
  pass('valid A recovery link replaces logged-in B and clearly identifies whose password will change')
  const tab = await pageIn(bContext)
  await status(tab, 'ready')
  // Cross-tab session change while A's recovery form is open.
  const switched = await tab.evaluate(async ({ email, password }) => {
    const { supabase } = await import('/entry.js')
    return (await supabase.auth.signInWithPassword({ email, password })).error?.code || null
  }, { email: otherEmail, password })
  assert.equal(switched, null)
  await status(bPage, 'ready')
  assert.equal((await controller(bPage)).id, other.id)
  assert.equal(await bPage.$('input[autocomplete=new-password]'), null)
  pass('cross-tab account switch removes the other account recovery form')
  const refreshed = await tab.evaluate(async () => (await (await import('/entry.js')).supabase.auth.refreshSession()).error?.code || null)
  assert.equal(refreshed, null)
  await status(tab, 'ready')
  assert.equal((await controller(tab)).org, other.org)
  pass('real refresh-token rotation preserves the correct workspace')
  await tab.evaluate(async () => (await import('/entry.js')).accountSession.signOut())
  await status(tab, 'anonymous'); await status(bPage, 'anonymous')
  pass('sign-out propagates to another tab without stale workspace data')

  // Expire ONLY this synthetic fixture's request timestamp, keeping the real
  // GoTrue token/verification/redirect path. No clock mocking or signed fake JWT.
  noError(await anon.auth.resetPasswordForEmail(otherEmail, { redirectTo: lab.origin + '/account/?auth=recovery' }))
  const expired = await lab.emailLink(otherEmail, 'recovery')
  lab.sql(`UPDATE auth.users SET recovery_sent_at=NOW()-INTERVAL '2 hours' WHERE id=${uid(other.id)};`)
  await bPage.goto(expired)
  await status(bPage, 'recovery-error')
  assert.equal((await controller(bPage)).context, null)
  pass('actually expired GoTrue recovery token produces a safe error screen')
  const broken = new URL(expired); broken.searchParams.set('token', 'damaged-synthetic-token')
  await bPage.goto(broken.href)
  await status(bPage, 'recovery-error')
  pass('damaged email token is rejected by the real verifier')
  await page.goto(lab.origin + '/account/?auth=recovery')
  await status(page, 'recovery-error')
  pass('recovery query marker alone never authorizes a password change')
  assert.equal(lab.sql('SELECT count(*) FROM orgs;'), '2')
  assert.equal(lab.sql('SELECT count(*) FROM auth.users;'), '2')
  assert.deepEqual(errors, [])
  assert.deepEqual(external, [])
  pass('exactly two synthetic owners/workspaces; no page errors or external browser requests')
  const schema = Number(lab.sql('SELECT get_schema_version();'))
  assert.equal(schema, LAB_SCHEMA_VERSION)
  console.log(`Integration PASS: ${checks} scenarios, schema ${schema}; retained ${database}. Production SMTP/provider/T2 NOT TESTED.`)
} finally { clearTimeout(deadline); await cleanup() }
