// Local acceptance only: real GoTrue + SMTP catcher + PostgREST, no live keys.
// A NEW database is mandatory. Existing databases are never reset or dropped.
import { spawnSync } from 'node:child_process'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { createServer, request as httpRequest } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
const kassa = fileURLToPath(new URL('../../kassa/', import.meta.url))
const dbContainer = 'supabase_db_kassa'
const migrations = ['165_workspace_onboarding_idempotency.sql', '166_subscription_checkout.sql',
  '167_explicit_drawer_slug_privileges.sql', '168_digital_account_catalog_boundaries.sql']
export function validateAuthMigrations(names) {
  const unknown = names.filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name)
    && Number(name.split('_')[0]) >= 165 && !migrations.includes(name))
  if (unknown.length) throw new Error('Review changed/new Kassa migrations before extending Auth lab')
}
export function validateAuthDatabase(value) {
  if (!/^angle_auth_lab_[a-z0-9_]{1,40}$/.test(value || '')) throw new Error('Use a NEW angle_auth_lab_<suffix> database')
  return value
}
export function localDatabaseUri(value, database) {
  validateAuthDatabase(database)
  const uri = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(uri.protocol) || uri.hostname !== dbContainer
    || uri.pathname !== '/postgres') throw new Error('Expected the installed local database transport')
  uri.pathname = '/' + database
  return uri.href
}
const quote = value => `'${String(value).replaceAll("'", "''")}'`
function docker(args, { input, env = {} } = {}) {
  const result = spawnSync('docker', args, { input, env: { ...process.env, ...env },
    encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 })
  // stderr and inspect output can contain connection strings or email tokens.
  if (result.status !== 0) throw new Error(`Local Docker ${args[0]} failed (exit ${result.status}); credentials/logs withheld`)
  return result.stdout.trim()
}
const sqlFor = database => statement => docker(['exec', '-i', dbContainer, 'psql', '-X', '-q', '-At',
  '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', database], { input: statement })
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function ready(url, signal) {
  for (let n = 0; n < 50; n++) {
    signal?.throwIfAborted()
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return } catch { /* startup */ }
    await pause(200)
  }
  throw new Error('Local service did not become ready (URL withheld)')
}

export async function startAuthLab({ database, signal }) {
  signal?.throwIfAborted()
  validateAuthDatabase(database)
  if (process.env.DOCKER_CONTEXT || process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith('unix://')) {
    throw new Error('Docker overrides are not allowed')
  }
  if (!docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']).startsWith('unix://')) {
    throw new Error('Only local Unix-socket Docker is allowed')
  }
  const sql = sqlFor(database), source = sqlFor('postgres')
  if (source(`SELECT count(*) FROM pg_database WHERE datname=${quote(database)};`) !== '0') {
    throw new Error('Refusing to overwrite an existing database')
  }
  const version = Number(source('SELECT get_schema_version();'))
  if (!Number.isInteger(version) || version < 164 || version > 168) throw new Error('Reviewed local baseline: 164–168 only')
  validateAuthMigrations(await readdir(kassa + 'supabase/migrations'))
  // Explicit reviewed names exclude unrelated files and user-created " 2" copies.
  const pending = await Promise.all(migrations.filter(name => Number(name.slice(0, 3)) > version)
    .map(async name => ({ name, text: await readFile(kassa + 'supabase/migrations/' + name, 'utf8') })))
  signal?.throwIfAborted()
  const [auth] = JSON.parse(docker(['inspect', 'supabase_auth_kassa']))
  const [rest] = JSON.parse(docker(['inspect', 'supabase_rest_kassa']))
  const setting = (container, key) => container.Config.Env.find(value => value.startsWith(key + '='))?.slice(key.length + 1)
  const authUri = localDatabaseUri(setting(auth, 'GOTRUE_DB_DATABASE_URL'), database)
  const restUri = localDatabaseUri(setting(rest, 'PGRST_DB_URI'), database)
  if (!auth.Config.Image.endsWith('/supabase/gotrue:v2.192.0') || !rest.Config.Image.endsWith('/supabase/postgrest:v14.5')) {
    throw new Error('Review changed local Auth/PostgREST versions before running this lab')
  }
  const network = 'supabase_network_kassa'
  if (!auth.NetworkSettings.Networks[network] || !rest.NetworkSettings.Networks[network]) throw new Error('Unexpected local network')
  docker(['image', 'inspect', 'axllent/mailpit:v1.31.1']) // explicit pre-install; no silent image downloads
  docker(['exec', dbContainer, 'createdb', '-U', 'postgres', database])
  sql(docker(['exec', dbContainer, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only']))
  // Only technical dictionaries/migration history. Never copy users or business data.
  sql(docker(['exec', dbContainer, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--data-only',
    '--table=public.product_catalog', '--table=public.product_capabilities', '--table=public.product_prices',
    '--table=public.reserved_slugs', '--table=supabase_migrations.schema_migrations', '--table=auth.schema_migrations']))
  for (const migration of pending) sql(`BEGIN; ${migration.text}\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements)
    VALUES (${quote(migration.name.slice(0, 3))},${quote(migration.name)},ARRAY[]::TEXT[]); COMMIT;`)
  if (sql('SELECT get_schema_version();') !== '168' || sql('SELECT count(*) FROM auth.users;') !== '0'
    || sql('SELECT count(*) FROM orgs;') !== '0') throw new Error('Expected schema 168 and empty synthetic data set')
  sql("CREATE TABLE public.angle_auth_lab_marker(marker TEXT CHECK(marker='synthetic-only')); INSERT INTO public.angle_auth_lab_marker VALUES ('synthetic-only'); REVOKE ALL ON public.angle_auth_lab_marker FROM PUBLIC, anon, authenticated;")
  const secret = randomBytes(48).toString('hex')
  const encoded = [{ alg: 'HS256', typ: 'JWT' }, { role: 'anon', exp: Math.floor(Date.now() / 1000) + 7200 }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')
  const anonKey = encoded + '.' + createHmac('sha256', secret).update(encoded).digest('base64url')
  const prefix = 'angle-auth-' + randomUUID(), containers = []
  let origin, authOrigin, restOrigin, bundle, closing, loseWorkspaceResponse = false, lostResponses = 0
  const responses = []
  const css = (await Promise.all(['styles.css', 'responsive.css'].map(name => readFile(root + 'backoffice/src/' + name, 'utf8')))).join('\n')
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    const deny = status => { res.writeHead(status); res.end() }
    if (req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin) return deny(403)
    const url = new URL(req.url, origin)
    if (url.pathname.startsWith('/auth/v1/') || url.pathname.startsWith('/rest/v1/')) {
      const isAuth = url.pathname.startsWith('/auth/v1/')
      if (isAuth && url.pathname.startsWith('/auth/v1/admin')) return deny(403)
      const target = isAuth ? authOrigin : restOrigin
      if (!target) return deny(503)
      const headers = { ...req.headers, host: new URL(target).host }
      delete headers['x-forwarded-host']; delete headers['x-forwarded-proto']; delete headers['x-forwarded-for']
      const upstream = httpRequest(target + url.pathname.slice(8) + url.search,
        { method: req.method, headers }, response => {
          responses.push({ method: req.method, path: url.pathname, status: response.statusCode })
          if (loseWorkspaceResponse && url.pathname === '/rest/v1/rpc/create_digital_workspace' && response.statusCode === 200) {
            loseWorkspaceResponse = false; lostResponses++
            // A gateway lost the successful upstream response after commit.
            // Bare socket destruction lets Chrome transparently replay the POST,
            // so use an explicit gateway failure to test the user's retry path.
            response.resume(); response.on('end', () => {
              res.writeHead(502, { 'Content-Type': 'application/json' })
              res.end('{"code":"lab_upstream_response_lost","message":"Synthetic gateway response loss"}')
            }); return
          }
          res.writeHead(response.statusCode, response.headers); response.pipe(res)
        })
      upstream.setTimeout(15000, () => upstream.destroy())
      upstream.on('error', () => { if (!res.headersSent) deny(502); else res.destroy() })
      req.on('aborted', () => upstream.destroy())
      req.pipe(upstream)
      return
    }
    if (req.method !== 'GET') return deny(405)
    if (url.pathname === '/entry.js' && bundle) { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle); return }
    if (url.pathname === '/styles.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); return }
    if (url.pathname === '/account/') {
      res.setHeader('Content-Type', 'text/html')
      res.end('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ANGLE LOCAL AUTH LAB</title><link rel="stylesheet" href="/styles.css"><div id="root"></div><script type="module" src="/entry.js"></script></html>')
      return
    }
    deny(404)
  })
  function close() {
    if (closing) return closing
    closing = (async () => {
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
      const failed = []
      for (const name of [...containers].reverse()) {
        try { docker(['rm', '-f', name]) } catch { failed.push(name) }
      }
      if (failed.length) throw new Error('Could not stop owned lab containers: ' + failed.join(', '))
    })()
    return closing
  }
  function run(name, image, port, values) {
    signal?.throwIfAborted()
    const args = ['run', '--rm', '-d', '--name', name, '--network', network, '-p', `127.0.0.1::${port}`]
    for (const key of Object.keys(values)) args.push('-e', key)
    docker([...args, image], { env: values })
    containers.push(name)
    const [binding] = JSON.parse(docker(['inspect', '--format', '{{json .NetworkSettings.Ports}}', name]))[port + '/tcp']
    if (binding.HostIp !== '127.0.0.1') throw new Error('Lab must bind only to localhost')
    return 'http://127.0.0.1:' + binding.HostPort
  }
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    origin = 'http://127.0.0.1:' + server.address().port
    const mailOrigin = run(prefix + '-mail', 'axllent/mailpit:v1.31.1', 8025,
      { MP_MAX_MESSAGES: '100', MP_DISABLE_VERSION_CHECK: 'true', MP_ALLOWED_HOSTS: '127.0.0.1,localhost' })
    await ready(mailOrigin + '/api/v1/messages', signal)
    authOrigin = run(prefix + '-auth', auth.Config.Image, 9999, {
      GOTRUE_API_HOST: '0.0.0.0', GOTRUE_API_PORT: '9999', API_EXTERNAL_URL: origin,
      GOTRUE_SITE_URL: origin + '/account/', GOTRUE_URI_ALLOW_LIST: origin + '/account/**',
      GOTRUE_DB_DRIVER: 'postgres', GOTRUE_DB_DATABASE_URL: authUri,
      GOTRUE_JWT_SECRET: secret, GOTRUE_JWT_AUD: 'authenticated', GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
      GOTRUE_JWT_ADMIN_ROLES: 'service_role', GOTRUE_JWT_EXP: '3600', GOTRUE_JWT_ISSUER: origin + '/auth/v1',
      GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true', GOTRUE_EXTERNAL_PHONE_ENABLED: 'false', GOTRUE_DISABLE_SIGNUP: 'false',
      GOTRUE_MAILER_AUTOCONFIRM: 'false', GOTRUE_MAILER_OTP_EXP: '3600', GOTRUE_PASSWORD_MIN_LENGTH: '8',
      GOTRUE_MAILER_URLPATHS_CONFIRMATION: '/auth/v1/verify', GOTRUE_MAILER_URLPATHS_RECOVERY: '/auth/v1/verify',
      GOTRUE_SMTP_HOST: prefix + '-mail', GOTRUE_SMTP_PORT: '1025', GOTRUE_SMTP_ADMIN_EMAIL: 'auth@example.test',
      GOTRUE_SMTP_SENDER_NAME: 'ANGLE LOCAL TEST', GOTRUE_SMTP_MAX_FREQUENCY: '1s', GOTRUE_RATE_LIMIT_EMAIL_SENT: '100',
      GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED: 'true', GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL: '10',
      LOG_LEVEL: 'error',
    })
    await ready(authOrigin + '/health', signal)
    restOrigin = run(prefix + '-rest', rest.Config.Image, 3000, {
      PGRST_DB_URI: restUri, PGRST_JWT_SECRET: secret, PGRST_DB_SCHEMAS: 'public',
      PGRST_DB_ANON_ROLE: 'anon', PGRST_DB_EXTRA_SEARCH_PATH: 'public,extensions', PGRST_LOG_LEVEL: 'crit',
    })
    await ready(restOrigin + '/', signal)
    const result = await build({ stdin: { resolveDir: root + 'backoffice/src', loader: 'jsx', contents:
      "import React from 'react'; import {createRoot} from 'react-dom/client'; import App from './App.jsx'; export {supabase,accountSession} from './supabase.js'; createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);" },
    bundle: true, write: false, format: 'esm', jsx: 'automatic', define: {
      'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: origin, VITE_SUPABASE_ANON_KEY: anonKey,
        VITE_PUBLIC_MENU_ORIGIN: origin, VITE_SITE_ORIGIN: origin }),
      'process.env.NODE_ENV': '"production"',
    } })
    bundle = result.outputFiles[0].text
    signal?.throwIfAborted()
    const seen = new Set()
    async function emailLink(email, type) {
      if (!/^[a-z0-9_-]+@example\.test$/.test(email) || !['signup', 'recovery'].includes(type)) throw new Error('Synthetic mailboxes only')
      for (let n = 0; n < 50; n++) {
        const list = await (await fetch(mailOrigin + '/api/v1/messages', { signal: AbortSignal.timeout(3000) })).json()
        for (const item of list.messages || []) {
          if (seen.has(item.ID) || !item.To?.some(to => to.Address === email)) continue
          const detail = await (await fetch(mailOrigin + '/api/v1/message/' + item.ID, { signal: AbortSignal.timeout(3000) })).json()
          const links = [...(detail.HTML || '').matchAll(/href="([^"]+)"/g)].map(match => match[1].replaceAll('&amp;', '&'))
          const link = links.find(value => { try { const u = new URL(value); return u.origin === origin && u.pathname === '/auth/v1/verify' && u.searchParams.get('type') === type } catch { return false } })
          if (link) { seen.add(item.ID); return link }
        }
        await pause(200)
      }
      throw new Error('Expected local Auth email was not delivered (no mail body/token logged)')
    }
    return { origin, mailOrigin, anonKey, database, sql, emailLink, close,
      dropNextWorkspaceResponse: () => { loseWorkspaceResponse = true }, lostResponses: () => lostResponses,
      diagnostics: () => ({ lostResponses, responses: responses.slice(-15) }) }
  } catch (error) { await close(); throw error }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let lab
  const abort = new AbortController()
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
    abort.abort(new Error('Auth lab interrupted'))
    if (lab) { await lab.close(); process.exit(0) }
    // During startup, its catch/finally closes any containers already created.
  })
  lab = await startAuthLab({ database: process.argv[2], signal: abort.signal })
  console.log(`LOCAL AUTH ONLY: ${lab.origin}/account/\nLocal mail catcher: ${lab.mailOrigin}\nSynthetic database retained: ${lab.database}\nNo live email or payment provider. Ctrl+C stops owned containers.`)
}
