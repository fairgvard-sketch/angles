// Real Chrome -> local HTTP lab -> authenticated SQL RPC -> service-only
// payment intake -> subscription/capability. Requires a NEW disposable DB.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startBillingLab, validateLabDatabase } from './billing-lab.mjs'
import { launchBrowser, closeBrowser } from '../backoffice/test/browser-harness.mjs'

assert.throws(() => validateLabDatabase('postgres'))
assert.throws(() => validateLabDatabase('angle_billing_lab_foo; DROP DATABASE postgres'))
const database = validateLabDatabase(process.argv[2])
const { browser } = await launchBrowser()
assert.ok(browser, 'Browser is required for billing integration acceptance')
let lab
try {
  lab = await startBillingLab({ database, initialize: true })
  const [owner, other] = lab.users
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 })
  await page.goto(lab.origin)
  const click = async label => {
    await page.waitForFunction(text => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === text && !button.disabled), { timeout: 10000 }, label)
    await page.evaluate(text => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text).click(), label)
  }
  await click('Review invoice')
  await page.waitForSelector('[data-invoice-status="open"]')
  const first = (await lab.asOwner(owner, 'get_subscription_catalog()')).invoices[0]
  assert.equal(first.status, 'open')
  assert.equal(await lab.sql(`SELECT count(*) FROM organization_products WHERE org_id='${owner.org}';`), '0')
  console.log('PASS: first invoice exists without granting a product')
  await click('Simulate declined payment')
  await page.waitForFunction(() => document.body.textContent.includes('Test payment declined.'))
  assert.equal((await lab.asOwner(owner, `get_subscription_checkout('${first.invoice_id}')`)).status, 'open')
  assert.equal(await lab.sql(`SELECT count(*) FROM organization_products WHERE org_id='${owner.org}';`), '0')
  console.log('PASS: declined simulation remains unpaid and grants nothing')
  await page.reload()
  await click(`${first.number} · open · ${new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS' }).format(first.total_agorot / 100)}`)
  await page.waitForSelector('[data-invoice-status="open"]')
  assert.equal((await lab.asOwner(owner, 'get_subscription_catalog()')).invoices.length, 1)
  console.log('PASS: reload restores the existing invoice from the server')
  await click('Simulate successful payment')
  await page.waitForSelector('[data-invoice-status="paid"]')
  await click('Refresh workspace access')
  await page.waitForFunction(() => document.querySelector('#access').textContent.includes('public_menu'))
  const paid = await lab.asOwner(owner, `get_subscription_checkout('${first.invoice_id}')`)
  assert.ok(paid.lines[0].paid_until)
  assert.equal(await lab.sql(`SELECT org_has_capability_at('${owner.org}','${owner.location}','public_menu');`), 't')
  assert.equal(await lab.sql(`SELECT org_has_capability_at('${other.org}','${other.location}','public_menu');`), 'f')
  console.log('PASS: server-confirmed payment activates only the paid workspace')
  const payment = async body => {
    const response = await fetch(lab.origin + '/api/payment', { method: 'POST', headers: { Origin: lab.origin, 'Content-Type': 'application/json', 'X-Angle-Lab': lab.csrf }, body: JSON.stringify(body) })
    return { status: response.status, body: await response.json() }
  }
  const duplicates = await Promise.all([1, 2, 3].map(() => payment({ owner: owner.user, invoiceId: first.invoice_id, outcome: 'success' })))
  assert.ok(duplicates.every(result => result.status === 200 && result.body.outcome === 'duplicate'))
  assert.equal((await lab.asOwner(owner, `get_subscription_checkout('${first.invoice_id}')`)).lines[0].paid_until, paid.lines[0].paid_until)
  assert.equal((await payment({ owner: owner.user, invoiceId: first.invoice_id, outcome: 'success', amount: 1 })).status, 400)
  assert.equal((await payment({ owner: other.user, invoiceId: first.invoice_id, outcome: 'success' })).status, 400)
  assert.equal((await fetch(lab.origin + '/api/payment', { method: 'POST', headers: { Origin: 'https://example.test', 'Content-Type': 'application/json' }, body: '{}' })).status, 403)
  console.log('PASS: concurrent replay, amount injection, foreign owner and cross-origin request protections')
  const concurrent = await Promise.all(Array.from({ length: 6 }, () => lab.asOwner(owner,
    `create_subscription_checkout('${randomUUID()}','${owner.location}','reservations')`)))
  assert.equal(new Set(concurrent.map(invoice => invoice.invoice_id)).size, 1)
  const canceled = await lab.asOwner(owner, `cancel_subscription_checkout('${concurrent[0].invoice_id}')`)
  assert.equal(canceled.status, 'void')
  assert.equal((await payment({ owner: owner.user, invoiceId: canceled.invoice_id, outcome: 'success' })).body.outcome, 'rejected')
  console.log('PASS: six concurrent checkouts share one invoice; canceled invoice cannot activate')
  await lab.sql(`UPDATE subscriptions SET current_period_end=NOW()-INTERVAL '1 day', grace_days=7 WHERE org_id='${owner.org}' AND product='menu'; SELECT sync_entitlement_from_subscription(id) FROM subscriptions WHERE org_id='${owner.org}' AND product='menu';`)
  assert.equal((await lab.asOwner(owner, 'get_subscription_catalog()')).subscriptions.find(sub => sub.product === 'menu').status, 'past_due')
  assert.equal(await lab.sql(`SELECT org_has_capability_at('${owner.org}','${owner.location}','public_menu');`), 't')
  await lab.sql(`UPDATE subscriptions SET current_period_end=NOW()-INTERVAL '8 days' WHERE org_id='${owner.org}' AND product='menu'; SELECT sync_entitlement_from_subscription(id) FROM subscriptions WHERE org_id='${owner.org}' AND product='menu';`)
  assert.equal((await lab.asOwner(owner, 'get_subscription_catalog()')).subscriptions.find(sub => sub.product === 'menu').status, 'suspended')
  assert.equal(await lab.sql(`SELECT org_has_capability_at('${owner.org}','${owner.location}','public_menu');`), 'f')
  assert.equal(await lab.sql(`SELECT org_has_capability('${owner.org}','public_menu');`), 'f')
  console.log('PASS: grace keeps location access; expiry closes it without deleting data')
  const renewal = await lab.asOwner(owner, `create_subscription_checkout('${randomUUID()}','${owner.location}','menu')`)
  assert.notEqual(renewal.invoice_id, first.invoice_id)
  assert.equal(await lab.sql(`SELECT org_has_capability('${owner.org}','public_menu');`), 'f')
  assert.equal((await payment({ owner:owner.user,invoiceId:renewal.invoice_id,outcome:'success' })).body.outcome,'applied')
  assert.equal(await lab.sql(`SELECT org_has_capability('${owner.org}','public_menu');`), 't')
  console.log('PASS: expired subscription stays closed until its renewal payment is confirmed')
  await click('Check payment status')
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Check payment status').disabled)
  const screenshotDir = await mkdtemp(join(tmpdir(), 'angle-billing-ui-'))
  await page.screenshot({ path: join(screenshotDir, 'mobile.png'), fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'mobile horizontal overflow')
  await page.setViewport({ width: 1280, height: 900 })
  await page.screenshot({ path: join(screenshotDir, 'desktop.png'), fullPage: true })
  assert.deepEqual(errors, [])
  console.log(`PASS: mobile/desktop rendered without page errors. Screenshots: ${screenshotDir}`)
  console.log(`Integration PASS. Synthetic test data retained in ${database}; no real Auth or provider tested.`)
} finally {
  await lab?.close()
  await closeBrowser(browser)
}
