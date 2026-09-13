// Local-only, synthetic billing integration lab. No Supabase keys, emails,
// accounts on a live server, or actual payment provider. Not a deployment asset.
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
const kassa = fileURLToPath(new URL('../../kassa/', import.meta.url))
const container = 'supabase_db_kassa'
export function validateLabDatabase(database) {
  if (!/^angle_billing_lab_[a-z0-9_]{1,40}$/.test(database || '')) throw new Error('Only angle_billing_lab_<disposable_suffix> is allowed')
  return database
}
function command(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: 'pipe' })
    let output = '', error = ''
    const timer = setTimeout(() => child.kill(), 60000)
    child.stdout.on('data', part => { output += part })
    child.stderr.on('data', part => { error += part })
    child.on('error', failure => { clearTimeout(timer); reject(failure) })
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(output.trim()) : reject(new Error(error || `docker exited ${code}`)) })
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}
const quote = value => `'${String(value).replaceAll("'", "''")}'`
const uid = value => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '')) throw new Error('Invalid UUID')
  return quote(value)
}
function databaseClient(database) {
  return sql => command(['exec', '-i', container, 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', database], sql)
}

export async function startBillingLab({ database, initialize = false, port = 0 }) {
  validateLabDatabase(database)
  // Both the environment override and selected context must be local.
  if (process.env.DOCKER_CONTEXT || process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith('unix://')) throw new Error('Docker overrides are not allowed')
  const endpoint = await command(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])
  if (!endpoint.startsWith('unix://')) throw new Error('Only local Unix-socket Docker is allowed')
  const sql = databaseClient(database)
  if (initialize) {
    const exists = await databaseClient('postgres')(`SELECT count(*) FROM pg_database WHERE datname=${quote(database)};`)
    if (exists !== '0') throw new Error('Refusing to overwrite an existing database; omit --init for an existing lab')
    await command(['exec', container, 'createdb', '-U', 'postgres', database])
    // Read local schema and technical dictionaries only. No customer records.
    await sql(await command(['exec', container, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only']))
    await sql(await command(['exec', container, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--data-only',
      '--table=public.product_catalog', '--table=public.product_capabilities', '--table=public.product_prices',
      '--table=public.reserved_slugs', '--table=supabase_migrations.schema_migrations']))
    const version = Number(await sql('SELECT get_schema_version();'))
    if (!Number.isInteger(version) || version < 164 || version > 166) throw new Error('Lab requires a known local baseline 164–166')
    for (const name of (await readdir(kassa + 'supabase/migrations')).filter(name => /^\d+_.+\.sql$/.test(name)).sort()) {
      const next = Number(name.split('_')[0])
      if (next <= version) continue
      if (next > 166) throw new Error('Review new migrations before extending the billing lab')
      const migration = await readFile(kassa + 'supabase/migrations/' + name, 'utf8')
      await sql(`BEGIN; ${migration}\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements)
        VALUES (${quote(String(next))},${quote(name)},ARRAY[]::TEXT[]); COMMIT;`)
    }
    await sql("CREATE TABLE public.angle_billing_lab_marker(marker TEXT PRIMARY KEY CHECK(marker='synthetic-only')); INSERT INTO public.angle_billing_lab_marker VALUES ('synthetic-only'); REVOKE ALL ON public.angle_billing_lab_marker FROM PUBLIC, anon, authenticated;")
  }
  if (await sql('SELECT marker FROM public.angle_billing_lab_marker;') !== 'synthetic-only') throw new Error('Not an initialized billing lab')
  if (await sql('SELECT get_schema_version();') !== '166') throw new Error('Lab schema must be 166')
  const users = [
    { user: 'a1000000-0000-4000-8000-000000000001', org: 'a2000000-0000-4000-8000-000000000001', location: 'a3000000-0000-4000-8000-000000000001', name: 'Test Cafe A' },
    { user: 'a1000000-0000-4000-8000-000000000002', org: 'a2000000-0000-4000-8000-000000000002', location: 'a3000000-0000-4000-8000-000000000002', name: 'Test Cafe B' },
  ]
  const existing = await sql('SELECT count(*) FROM orgs;')
  if (existing === '0') {
    for (const owner of users) await sql(`BEGIN;
      INSERT INTO orgs(id,name) VALUES (${uid(owner.org)},${quote(owner.name)});
      INSERT INTO locations(id,org_id,name) VALUES (${uid(owner.location)},${uid(owner.org)},'Main');
      INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES (${uid(owner.user)},${quote(owner.user + '@example.test')},${quote(JSON.stringify({ org_id: owner.org }))}::JSONB);
      INSERT INTO organization_members(org_id,auth_user_id,role) VALUES (${uid(owner.org)},${uid(owner.user)},'owner'); COMMIT;`)
  }
  // Do not turn some other existing data set into a payment sandbox.
  if (await sql(`SELECT count(*) FROM orgs WHERE id NOT IN (${users.map(owner => uid(owner.org)).join(',')});`) !== '0') throw new Error('Unexpected organizations in lab')
  await sql("INSERT INTO billing_checkout_settings DEFAULT VALUES ON CONFLICT DO NOTHING; UPDATE billing_checkout_settings SET mode='test';")
  function asOwner(owner, statement) {
    const claims = quote(JSON.stringify({ sub: owner.user, role: 'authenticated', app_metadata: { org_id: owner.org } }))
    return sql(`BEGIN; SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='8s'; SET LOCAL ROLE authenticated;
      SET LOCAL request.jwt.claims=${claims}; SELECT ${statement}; COMMIT;`).then(JSON.parse)
  }
  const csrf = randomUUID()
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    import SubscriptionPanel from './SubscriptionPanel.jsx'; import {createBillingApi} from './subscription-checkout.js';
    const owner = ${JSON.stringify(users)}[new URLSearchParams(location.search).get('owner') === 'b' ? 1 : 0];
    const context = {organization:{id:owner.org,name:owner.name},locations:[{id:owner.location,name:'Main'}]};
    async function post(path, body) {
      const response = await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Angle-Lab':${JSON.stringify(csrf)}},body:JSON.stringify({...body,owner:owner.user})});
      const result = await response.json(); if(!response.ok) throw new Error(result.error); return result;
    }
    const client = {rpc(name,args) { let signal; return {setHeader(){return this},abortSignal(value){signal=value;return this},
      then(resolve,reject){return post('/api/rpc',{name,args}).then(data=>({data})).then(resolve,reject)} }}};
    const api = createBillingApi(client,{orgId:owner.org,getSession:()=>({user:{id:owner.user,app_metadata:{org_id:owner.org}},access_token:'synthetic-not-a-jwt'}),storage:sessionStorage});
    createRoot(document.getElementById('root')).render(<React.StrictMode><main style={{maxWidth:860,margin:'32px auto',padding:16}}>
      <h1>{owner.name}: local billing lab</h1><p>Synthetic fixture owner — this lab does not test login, email or a real provider. Never enter card details.</p>
      <p><a href='/?owner=a'>Test Cafe A</a> · <a href='/?owner=b'>Test Cafe B</a></p>
      <SubscriptionPanel context={context} api={api} simulatePayment={(invoiceId,outcome)=>post('/api/payment',{invoiceId,outcome})}
        onReloadContext={async()=>{const result=await post('/api/rpc',{name:'get_backoffice_context',args:{}});document.getElementById('access').textContent=JSON.stringify(result.capabilities)}}/>
      <p>Server-confirmed workspace capabilities: <span id='access'>not loaded</span></p>
    </main></React.StrictMode>);`
  const bundle = await build({ stdin: { contents: entry, loader: 'jsx', resolveDir: root + 'backoffice/src' },
    bundle: true, write: false, format: 'esm', jsx: 'automatic', define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' } })
  const css = await readFile(root + 'backoffice/src/styles.css', 'utf8') + await readFile(root + 'backoffice/src/responsive.css', 'utf8')
  let origin
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff')
    function json(body, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (req.headers.host !== new URL(origin).host) { json({ error: 'invalid_host' }, 403); return }
    if (req.method === 'GET' && req.url === '/entry.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return }
    if (req.method === 'GET' && req.url === '/styles.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); return }
    if (req.method === 'GET' && new URL(req.url, origin).pathname === '/') {
      res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ANGLE local billing lab</title><link rel="stylesheet" href="/styles.css"><div id="root"></div><script type="module" src="/entry.js"></script></html>'); return
    }
    if (req.method !== 'POST' || req.headers.origin !== origin || req.headers['x-angle-lab'] !== csrf || req.headers['content-type'] !== 'application/json') { json({ error: 'local_lab_only' }, 403); return }
    try {
      let raw = ''
      for await (const part of req) { raw += part; if (raw.length > 4096) throw new Error('request_too_large') }
      const body = JSON.parse(raw), owner = users.find(owner => owner.user === body.owner)
      if (!owner) throw new Error('unknown_fixture_owner')
      if (req.url === '/api/rpc') {
        const args = body.args || {}
        const definitions = {
          get_subscription_catalog: [[], () => 'get_subscription_catalog()'],
          get_backoffice_context: [[], () => 'get_backoffice_context()'],
          get_subscription_checkout: [['p_invoice_id'], () => `get_subscription_checkout(${uid(args.p_invoice_id)})`],
          cancel_subscription_checkout: [['p_invoice_id'], () => `cancel_subscription_checkout(${uid(args.p_invoice_id)})`],
          create_subscription_checkout: [['p_request_id','p_location_id','p_product'], () => `create_subscription_checkout(${uid(args.p_request_id)},${uid(args.p_location_id)},${quote(args.p_product)})`],
        }
        const definition = definitions[body.name]
        if (!definition || Object.keys(args).some(key => !definition[0].includes(key))) throw new Error('invalid_rpc')
        json(await asOwner(owner, definition[1]())); return
      }
      if (req.url === '/api/payment') {
        if (Object.keys(body).some(key => !['owner','invoiceId','outcome'].includes(key)) || !['success','decline'].includes(body.outcome)) throw new Error('invalid_payment_request')
        const invoice = await asOwner(owner, `get_subscription_checkout(${uid(body.invoiceId)})`)
        if (invoice.mode !== 'test' || await sql('SELECT mode FROM billing_checkout_settings;') !== 'test') throw new Error('not_test_checkout')
        if (body.outcome === 'decline') { json({ outcome: 'declined' }); return }
        // Simulates a server-confirmed manual provider event. Amount/currency
        // come from the persisted invoice, never from the browser. The stable
        // event ID exercises the same service-only intake as a real provider.
        const result = await sql(`BEGIN; SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='8s';
          SELECT pg_advisory_xact_lock(hashtextextended(${quote('billing-lab:' + invoice.invoice_id)},166));
          SET LOCAL ROLE service_role;
          SELECT record_provider_payment('manual',${quote('billing-lab:' + invoice.invoice_id)},${uid(invoice.invoice_id)},
            ${invoice.total_agorot},${quote(invoice.currency)},'payment_succeeded','LOCAL-TEST-ONLY','{"simulated":true}'); COMMIT;`)
        json(JSON.parse(result)); return
      }
      json({ error: 'not_found' }, 404)
    } catch (failure) {
      const known = /billing_owner_required|checkout_not_found|checkout_request_conflict|checkout_disabled|checkout_payment_processing|location_not_in_org/.exec(failure.message)?.[0]
      json({ error: known || 'lab_request_failed' }, 400)
    }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  origin = `http://127.0.0.1:${server.address().port}`
  return { origin, database, server, csrf, users, sql, asOwner, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }) }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), database = args.find(arg => !arg.startsWith('--'))
  if (args.some(arg => arg.startsWith('--') && arg !== '--init')) throw new Error('Usage: node scripts/billing-lab.mjs angle_billing_lab_<suffix> [--init]')
  const lab = await startBillingLab({ database, initialize: args.includes('--init') })
  console.log(`LOCAL TEST ONLY: ${lab.origin}\nDatabase: ${lab.database}\nCtrl+C stops the server; synthetic data is retained. No production or real payments.`)
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal, async () => { await lab.close(); process.exit(0) })
}
