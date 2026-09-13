// Isolated A6 HTTP acceptance: real PostgREST/JWT verification, synthetic users.
// No GoTrue/email/provider acceptance is claimed. Never reads project .env.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHmac, randomBytes } from 'node:crypto'
import { startBillingLab, validateLabDatabase } from './billing-lab.mjs'
import { LAB_SCHEMA_VERSION } from './lab-migrations.mjs'

const database = validateLabDatabase(process.argv[2])
if (!database.startsWith('angle_billing_lab_a6_')) throw new Error('Use a NEW angle_billing_lab_a6_<suffix> database')
const name = `angle-a6-http-${process.pid}`
function docker(args, env = process.env) {
  const r = spawnSync('docker', args, { encoding: 'utf8', env, timeout: 60000, maxBuffer: 8 * 1024 * 1024 })
  // Do not expose container environment/connection strings in failures.
  if (r.status !== 0) throw new Error(`Local Docker operation ${args[0]} failed (exit ${r.status})`)
  return r.stdout.trim()
}
const lab = await startBillingLab({ database, initialize: true })
let created = false
try {
  assert.equal(await lab.sql('SELECT get_schema_version();'), String(LAB_SCHEMA_VERSION))
  await lab.close()
  await lab.sql("UPDATE billing_checkout_settings SET mode='disabled';")
  // Reuse ONLY the installed local PostgREST image/network/database transport.
  // A fresh JWT key and a fresh database separate it from the existing services.
  const [existing] = JSON.parse(docker(['inspect','supabase_rest_kassa']))
  const connection = existing.Config.Env.find(value=>value.startsWith('PGRST_DB_URI='))?.slice('PGRST_DB_URI='.length)
  const uri = new URL(connection)
  assert.equal(uri.hostname,'supabase_db_kassa','Database must be the local Kassa container')
  assert.equal(uri.pathname,'/postgres','Unexpected source database connection')
  uri.pathname='/'+database
  const network = Object.keys(existing.NetworkSettings.Networks).find(value=>value.startsWith('supabase_'))
  assert.ok(network,'Expected an existing local Supabase network')
  assert.match(existing.Config.Image,/supabase\/postgrest:/)
  const secret = randomBytes(48).toString('hex')
  docker(['run','--rm','-d','--name',name,'--network',network,'-p','127.0.0.1::3000',
    '-e','PGRST_DB_URI','-e','PGRST_JWT_SECRET','-e','PGRST_DB_SCHEMAS=public',
    '-e','PGRST_DB_ANON_ROLE=anon','-e','PGRST_DB_EXTRA_SEARCH_PATH=public,extensions',existing.Config.Image],
  {...process.env,PGRST_DB_URI:uri.href,PGRST_JWT_SECRET:secret})
  created=true
  const [port] = JSON.parse(docker(['inspect','--format','{{json .NetworkSettings.Ports}}',name]))['3000/tcp']
  assert.equal(port.HostIp,'127.0.0.1')
  const origin=`http://127.0.0.1:${port.HostPort}`
  function token(owner, key=secret) {
    const body=[{alg:'HS256',typ:'JWT'},{role:'authenticated',sub:owner.user,app_metadata:{org_id:owner.org,
      ...(owner.deviceLocation ? {location_id:owner.deviceLocation} : {})},exp:Math.floor(Date.now()/1000)+600}]
      .map(value=>Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')
    return body+'.'+createHmac('sha256',key).update(body).digest('base64url')
  }
  for (let attempt=0;attempt<50;attempt++) {
    try {const r=await fetch(origin,{signal:AbortSignal.timeout(1000)});if(r.ok) break} catch { /* container starting */ }
    if(attempt===49) throw new Error('Isolated PostgREST did not become ready')
    await new Promise(resolve=>setTimeout(resolve,200))
  }
  const [a,b]=lab.users, jwt=token(a)
  const ids={ca:'a6900000-0000-4000-8000-000000000001',cb:'a6900000-0000-4000-8000-000000000002',
    ia:'a6910000-0000-4000-8000-000000000001',ib:'a6910000-0000-4000-8000-000000000002'}
  await lab.sql(`INSERT INTO menu_categories(id,org_id,location_id,name) VALUES
    ('${ids.ca}','${a.org}','${a.location}','A category'),('${ids.cb}','${b.org}','${b.location}','B category');
    INSERT INTO menu_items(id,org_id,category_id,name,price) VALUES
    ('${ids.ia}','${a.org}','${ids.ca}','A item',100),('${ids.ib}','${b.org}','${ids.cb}','B item',200);`)
  async function request(path, {method='GET',body,authorization=jwt}={}) {
    const response=await fetch(origin+'/'+path,{method,headers:{'Content-Type':'application/json',
      ...(authorization?{Authorization:'Bearer '+authorization}:{}),Prefer:'return=representation'},
    body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)})
    const text=await response.text()
    return {status:response.status,data:text?JSON.parse(text):null}
  }
  let checks=0
  function equal(actual,expected,label){assert.deepEqual(actual,expected,label);checks++;console.log('PASS '+label)}
  equal((await request('rpc/auth_org_id',{method:'POST',body:{}})).data,a.org,'authenticated HTTP role resolves active digital member')
  equal((await request('menu_items?select=id')).data,[],'unpaid catalogue read is empty over HTTP')
  equal((await request('rpc/save_menu_item',{method:'POST',body:{p_item:{name:'unpaid',price:100,category_id:ids.ca}}})).data.message,'module_disabled','unpaid save RPC denied over HTTP')
  equal((await request('menu_items?select=id',{authorization:token(a,randomBytes(48).toString('hex'))})).status,401,'incorrectly signed JWT is rejected')
  equal((await request('menu_items?select=id',{authorization:null})).status,401,'anonymous table read denied')
  await lab.sql(`INSERT INTO organization_products(org_id,product,source) VALUES ('${a.org}','menu','manual');`)
  equal((await request('menu_items?select=id')).data,[{id:ids.ia}],'paid catalogue excludes foreign tenant over HTTP')
  equal((await request('menu_items?id=eq.'+ids.ib,{method:'PATCH',body:{name:'attack'}})).data,[],'foreign row update changes no rows')
  equal((await request('menu_items',{method:'POST',body:{org_id:a.org,category_id:ids.cb,name:'foreign parent',price:100}})).data.code,'23514','foreign parent rejected through PostgREST')
  await lab.sql(`UPDATE organization_members SET role='accountant' WHERE auth_user_id='${a.user}';`)
  equal((await request('modifier_groups',{method:'POST',body:{org_id:a.org,name:'forbidden'}})).status,403,'read-only member cannot write directly')
  equal((await request('menu_items?select=id')).data,[{id:ids.ia}],'read-only member retains authorized reads')
  await lab.sql(`UPDATE organization_members SET is_active=false WHERE auth_user_id='${a.user}';`)
  equal((await request('rpc/auth_org_id',{method:'POST',body:{}})).data,null,'same signed JWT loses tenant after membership revocation')
  equal((await request('menu_items?select=id')).data,[],'revocation applies to direct HTTP reads without JWT refresh')
  equal((await request('locations?select=id')).data,[],'revocation applies outside catalogue too')
  equal((await request('rpc/org_billing_state',{method:'POST',body:{}})).data.message,'not authenticated','revocation applies to SECURITY DEFINER RPC')
  await lab.sql(`DELETE FROM organization_members WHERE auth_user_id='${a.user}';`)
  equal((await request('orgs?select=id')).data,[],'membership deletion cannot resurrect stale token access')
  equal((await request('locations?select=id',{authorization:token(b)})).data,[{id:b.location}],'other tenant is still authorized')
  equal(await lab.sql(`SELECT name FROM menu_items WHERE id='${ids.ib}';`),'B item','foreign data unchanged after HTTP mutations')
  // A6.2: use the same signed tokens before/after account removal; a token
  // refresh or GoTrue login would hide the stale-token defect being exercised.
  await lab.sql(`INSERT INTO organization_members(org_id,auth_user_id,role) VALUES ('${a.org}','${a.user}','owner');`)
  const d1={org:a.org,user:'a6920000-0000-4000-8000-000000000001',deviceLocation:a.location}
  const d2={org:a.org,user:'a6920000-0000-4000-8000-000000000002',deviceLocation:'a6930000-0000-4000-8000-000000000001'}
  const deviceId='a6940000-0000-4000-8000-000000000001', deviceUuid='a6950000-0000-4000-8000-000000000001'
  await lab.sql(`INSERT INTO locations(id,org_id,name) VALUES ('${d2.deviceLocation}','${a.org}','A second point');
    INSERT INTO auth.users(id,raw_app_meta_data) VALUES
    ('${d1.user}','${JSON.stringify({org_id:a.org,location_id:d1.deviceLocation})}'),
    ('${d2.user}','${JSON.stringify({org_id:a.org,location_id:d2.deviceLocation})}');
    INSERT INTO devices(id,org_id,location_id,auth_user_id,device_uuid,name,outbox_pending) VALUES
    ('${deviceId}','${a.org}','${d1.deviceLocation}','${d1.user}','${deviceUuid}','A device',0);`)
  const deviceJwt=token(d1), otherDeviceJwt=token(d2)
  const deviceRpc=(name,body={},authorization=deviceJwt)=>request('rpc/'+name,{method:'POST',body,authorization})
  equal((await deviceRpc('auth_org_id')).data,a.org,'live device resolves tenant over HTTP')
  equal((await deviceRpc('register_device',{p_device_uuid:deviceUuid})).status,200,'same device registration remains idempotent')
  equal((await deviceRpc('register_device',{p_device_uuid:deviceUuid},otherDeviceJwt)).data.message,'device_identity_conflict','another account cannot claim a known device UUID')
  equal(await lab.sql(`SELECT auth_user_id FROM devices WHERE id='${deviceId}';`),d1.user,'rejected registration leaves ownership intact')
  equal((await request('devices?id=eq.'+deviceId,{method:'PATCH',body:{location_id:b.location},authorization:deviceJwt})).data.code,'23514','device location cannot cross tenant through direct PATCH')
  equal((await deviceRpc('get_backoffice_fleet')).data.message,'staff session required','device claim alone does not grant web management')
  equal((await deviceRpc('set_device_archived_web',{p_device_id:deviceId,p_archived:true},jwt)).status,200,'owner may archive device over HTTP')
  equal((await deviceRpc('auth_org_id')).data,a.org,'archive remains cosmetic over HTTP')
  equal((await deviceRpc('delete_device_web',{p_device_id:deviceId},jwt)).data.access_revoked,true,'dedicated account deletion reports revocation')
  equal((await deviceRpc('auth_org_id')).data,null,'deleted account same JWT loses organization immediately')
  equal((await deviceRpc('auth_location_id')).data,null,'deleted account same JWT loses location immediately')
  equal((await request('locations?select=id',{authorization:deviceJwt})).data,[],'deleted account cannot read via direct HTTP RLS')
  equal((await deviceRpc('org_billing_state')).data.message,'not authenticated','deleted account cannot use SECURITY DEFINER billing RPC')
  equal((await deviceRpc('register_device',{p_device_uuid:deviceUuid})).data.message,'not authenticated','deleted account cannot resurrect its device')
  equal((await deviceRpc('auth_location_id',{},otherDeviceJwt)).data,d2.deviceLocation,'other device identity survives deletion')
  await lab.sql(`UPDATE auth.users SET banned_until=NOW()+INTERVAL '1 day' WHERE id='${d2.user}';`)
  equal((await deviceRpc('auth_org_id',{},otherDeviceJwt)).data,null,'banned account same JWT is denied')
  await lab.sql(`UPDATE auth.users SET banned_until=NULL WHERE id='${d2.user}';`)
  equal((await deviceRpc('auth_org_id',{},otherDeviceJwt)).data,a.org,'unbanned live device works again')
  equal((await deviceRpc('register_device',{p_device_uuid:'a6950000-0000-4000-8000-000000000002'},otherDeviceJwt)).status,200,'fresh device registration succeeds over HTTP')
  console.log(`PASS ${checks} real HTTP/JWT checks; synthetic database retained: ${database}`)
} finally {
  await lab.close()
  if(created) docker(['rm','-f',name])
}
