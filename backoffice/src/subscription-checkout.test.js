import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBillingApi, billingError } from './subscription-checkout.js'

const org = '81000000-0000-4000-8000-000000000001', location = '82000000-0000-4000-8000-000000000001'
const request = '84000000-0000-4000-8000-000000000001', invoice = '85000000-0000-4000-8000-000000000001'
function fixture() {
  const entries = new Map(), calls = []
  let session = { user: { id: 'owner', app_metadata: { org_id: org } }, access_token: 'pinned-fixture' }
  let response = async () => ({ data: { invoice_id: invoice, status: 'open' } })
  const storage = { getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) }
  const client = { rpc(name, args) {
    const call = { name, args }; calls.push(call)
    return { setHeader(name, value) { call.header = [name, value]; return this }, abortSignal(signal) { call.signal = signal; return this },
      then(resolve, reject) { return response(call).then(resolve, reject) } }
  } }
  const make = (options = {}) => createBillingApi(client, { orgId: org, getSession: () => session, storage, makeId: () => request, ...options })
  return { make, calls, entries, setResponse(value) { response = value }, switchAccount() { session = { user: { id: 'other', app_metadata: { org_id: org } } } } }
}

test('purchase sends only request, product and location; pins authorization', async () => {
  const f = fixture(), api = f.make()
  await api.create({ product: 'menu', locationId: location, amount: 1 })
  assert.deepEqual(f.calls[0].args, { p_request_id: request, p_product: 'menu', p_location_id: location })
  assert.deepEqual(f.calls[0].header, ['Authorization', 'Bearer pinned-fixture'])
  assert.equal(api.getDraft(), null); assert.equal(f.entries.size, 0)
})
test('lost response retains exact request and selection across reload', async () => {
  const f = fixture(), api = f.make()
  f.setResponse(async () => { throw new TypeError('offline') })
  await assert.rejects(api.create({ product: 'menu', locationId: location }))
  const restored = f.make()
  assert.equal(restored.getDraft().requestId, request)
  f.setResponse(async () => ({ data: { invoice_id: invoice, status: 'open' } }))
  await restored.create({ product: 'reservations', locationId: 'changed' })
  assert.deepEqual(f.calls[1].args, f.calls[0].args)
})
test('timeout aborts transport but preserves checkout for safe retry', async () => {
  const f = fixture(), api = f.make({ timeoutMs: 10 })
  f.setResponse(() => new Promise(() => {}))
  await assert.rejects(api.create({ product: 'menu', locationId: location }), /request_timeout/)
  assert.equal(f.calls[0].signal.aborted, true); assert.equal(api.getDraft().requestId, request)
})
test('missing server RPC is explicit and never falls back to a grant', async () => {
  const f = fixture()
  f.setResponse(async () => ({ error: { code: 'PGRST202' } }))
  await assert.rejects(f.make().catalog(), failure => billingError(failure).includes('server update'))
  assert.deepEqual(f.calls.map(call => call.name), ['get_subscription_catalog'])
})
test('changed account cannot send a mutation', async () => {
  const f = fixture(), api = f.make(); f.switchAccount()
  await assert.rejects(api.create({ product: 'menu', locationId: location }), /session_changed/)
  assert.equal(f.calls.length, 0)
})
test('late response from old account is discarded', async () => {
  const f = fixture(), api = f.make()
  f.setResponse(async () => { f.switchAccount(); return { data: { invoice_id: invoice } } })
  await assert.rejects(api.create({ product: 'menu', locationId: location }), /session_changed/)
})
test('invalid stored draft is not trusted', () => {
  const f = fixture(); f.entries.set(`angle.subscription-checkout.owner.${org}`, JSON.stringify({ requestId: request, locationId: location, product: 'pos' }))
  assert.equal(f.make().getDraft(), null)
})
test('invalid selection sends no request', async () => {
  const f = fixture()
  await assert.rejects(f.make().create({ product: 'menu', locationId: 'bad' }), /invalid_checkout/)
  assert.equal(f.calls.length, 0)
})
test('missing invoice receipt retains original draft', async () => {
  const f = fixture(), api = f.make(); f.setResponse(async () => ({ data: { status: 'open' } }))
  await assert.rejects(api.create({ product: 'menu', locationId: location }), /billing_result_missing/)
  assert.equal(api.getDraft().requestId, request)
})
test('status and cancellation never invoke payment intake', async () => {
  const f = fixture(), api = f.make(); await api.read(invoice); await api.cancel(invoice)
  assert.deepEqual(f.calls.map(call => call.name), ['get_subscription_checkout', 'cancel_subscription_checkout'])
})
test('definitive validation rejection unlocks selection instead of trapping the owner', async () => {
  const f = fixture(), api = f.make()
  f.setResponse(async () => ({ error: { message: 'location_not_in_org' } }))
  await assert.rejects(api.create({ product: 'menu', locationId: location }))
  assert.equal(api.getDraft(), null); assert.equal(f.entries.size, 0)
})
