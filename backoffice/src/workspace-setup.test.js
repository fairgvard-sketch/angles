import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createWorkspaceSetup, workspaceInput } from './workspace-setup.js'

const ID = '71000000-0000-4000-8000-000000000001'
const INPUT = { orgName: ' Cafe ', locationName: '', products: ['menu', 'menu', 'pos'] }
const A = { user: { id: 'a', app_metadata: {} }, access_token: 'a-token' }
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
function fixture(t, options = {}) {
  let session = A, serverOrg = null
  const calls = [], saved = new Map()
  const storage = { getItem: (key) => saved.get(key), setItem: (key, value) => saved.set(key, value), removeItem: (key) => saved.delete(key) }
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { ...A.user, app_metadata: serverOrg ? { org_id: serverOrg } : {} } }, error: null }),
      refreshSession: async () => {
        calls.push('refresh')
        session = { ...A, user: { ...A.user, app_metadata: { org_id: serverOrg } } }
        return { data: { session }, error: null }
      },
    },
    rpc(name, args) {
      calls.push({ name, args })
      return {
        setHeader(name, value) { calls.push({ header: name, value }); return this },
        abortSignal(signal) { calls.push({ signal }); return this },
        then(resolve, reject) { return Promise.resolve().then(async () => {
          const response = options.rpc ? await options.rpc(args) : { data: { org_id: 'org-a' }, error: null }
          if (response.data?.org_id) serverOrg = response.data.org_id
          return response
        }).then(resolve, reject) },
      }
    },
  }
  const config = { userId: 'a', getSession: () => session, makeId: () => ID, storage, ...options }
  const setup = createWorkspaceSetup(client, config)
  t.after(() => setup.stop())
  return { setup, client, config, calls, saved, state: setup.getSnapshot,
    changeSession(value) { session = value }, setOrg(value) { serverOrg = value } }
}
test('workspace payload trims names, defaults location and deduplicates digital products', () => {
  assert.deepEqual(workspaceInput(INPUT), { p_org_name: 'Cafe', p_location_name: 'Cafe', p_products: ['menu'] })
  assert.throws(() => workspaceInput({ ...INPUT, orgName: ' ' }), /invalid_name/)
  assert.throws(() => workspaceInput({ ...INPUT, orgName: 'a'.repeat(121) }), /invalid_name/)
  assert.throws(() => workspaceInput({ ...INPUT, products: ['pos'] }), /invalid_products/)
})
test('successful setup sends one request UUID and pins Authorization to its account', async (t) => {
  const f = fixture(t)
  assert.equal(await f.setup.submit(INPUT), true)
  assert.equal(f.state().phase, 'complete')
  assert.equal(f.calls[0].name, 'create_digital_workspace')
  assert.equal(f.calls[0].args.p_request_id, ID)
  assert.deepEqual(f.calls[1], { header: 'Authorization', value: 'Bearer a-token' })
  assert.equal(f.calls.filter((call) => call === 'refresh').length, 1)
  assert.equal(f.saved.size, 0)
})
test('duplicate submits while checking the server do not start a second operation', async (t) => {
  const wait = deferred(), f = fixture(t)
  f.client.auth.getUser = () => wait.promise
  const first = f.setup.submit(INPUT)
  assert.equal(await f.setup.submit(INPUT), false)
  wait.resolve({ data: { user: A.user }, error: null })
  await first
  assert.equal(f.calls.filter((call) => call.name).length, 1)
})
test('a lost response retries with the same UUID and frozen payload, including after reload', async (t) => {
  let attempts = 0
  const f = fixture(t, { rpc: async () => {
    if (++attempts === 1) throw new TypeError('connection lost')
    return { data: { org_id: 'org-a' }, error: null }
  } })
  await f.setup.submit(INPUT)
  assert.equal(f.state().locked, true)
  assert.equal(f.state().busy, false)
  f.setup.stop()
  const restored = createWorkspaceSetup(f.client, f.config)
  t.after(() => restored.stop())
  assert.equal(restored.getSnapshot().locked, true)
  assert.equal(await restored.submit({ ...INPUT, orgName: 'Different' }), true)
  const requests = f.calls.filter((call) => call.name)
  assert.deepEqual(requests[0], requests[1])
})
test('a committed workspace followed by refresh failure is not created again', async (t) => {
  const f = fixture(t), original = f.client.auth.refreshSession
  f.client.auth.refreshSession = async () => ({ error: { code: 'request_timeout' } })
  await f.setup.submit(INPUT)
  assert.match(f.state().error, /workspace exists/)
  f.client.auth.refreshSession = original
  assert.equal(await f.setup.submit(INPUT), true)
  assert.equal(f.calls.filter((call) => call.name).length, 1)
})
test('server metadata detects an existing workspace before issuing any mutation', async (t) => {
  const f = fixture(t)
  f.setOrg('org-a')
  assert.equal(await f.setup.submit(INPUT), true)
  assert.equal(f.calls.filter((call) => call.name).length, 0)
})
test('a legacy already-bootstrapped error only recovers after server verification', async (t) => {
  const f = fixture(t, { rpc: async () => { f.setOrg('org-a'); return { error: { message: 'org already bootstrapped for this account' } } } })
  assert.equal(await f.setup.submit(INPUT), true)
  assert.equal(f.calls.filter((call) => call.name).length, 1)
})
test('legacy message without confirmed metadata never invents a workspace', async (t) => {
  const f = fixture(t, { rpc: async () => ({ error: { message: 'org already bootstrapped for this account' } }) })
  assert.equal(await f.setup.submit(INPUT), false)
  assert.equal(f.state().phase, 'error')
  assert.equal(f.calls.includes('refresh'), false)
})
test('a missing migration fails closed and never falls back to the legacy mutation', async (t) => {
  const f = fixture(t, { rpc: async () => ({ error: { code: 'PGRST202' } }) })
  await f.setup.submit(INPUT)
  assert.match(f.state().error, /server update/)
  assert.equal(f.saved.size, 0)
  assert.equal(f.state().locked, false)
})
test('validation errors do not retain an uneditable request', async (t) => {
  const f = fixture(t, { rpc: async () => ({ error: { message: 'invalid_name' } }) })
  await f.setup.submit(INPUT)
  assert.equal(f.state().locked, false)
  assert.equal(f.saved.size, 0)
})
test('hung mutation is bounded, aborts the fetch and retains its request UUID', async (t) => {
  const f = fixture(t, { timeoutMs: 10, rpc: () => new Promise(() => {}) })
  await f.setup.submit(INPUT)
  assert.equal(f.state().busy, false)
  assert.equal(f.state().locked, true)
  assert.equal(f.calls.find((call) => call.signal).signal.aborted, true)
})
test('switching accounts before verification finishes prevents mutation', async (t) => {
  const wait = deferred(), f = fixture(t)
  f.client.auth.getUser = () => wait.promise
  const result = f.setup.submit(INPUT)
  f.changeSession({ user: { id: 'b' }, access_token: 'b-token' })
  wait.resolve({ data: { user: A.user }, error: null })
  assert.equal(await result, false)
  assert.equal(f.calls.length, 0)
})
test('late mutation response after account switch cannot refresh the new account', async (t) => {
  const wait = deferred(), f = fixture(t, { rpc: () => wait.promise })
  const result = f.setup.submit(INPUT)
  while (!f.calls.some((call) => call.name)) await new Promise((resolve) => setTimeout(resolve, 1))
  f.changeSession({ user: { id: 'b' }, access_token: 'b-token' })
  wait.resolve({ data: { org_id: 'org-a' }, error: null })
  assert.equal(await result, false)
  assert.equal(f.calls.includes('refresh'), false)
})
test('blocked storage still allows setup and retry in the mounted form', async (t) => {
  const f = fixture(t, { storage: { getItem() { throw new Error() }, setItem() { throw new Error() }, removeItem() { throw new Error() } } })
  assert.equal(await f.setup.submit(INPUT), true)
})
