import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { before, after, describe, it } from 'node:test'
import { build } from 'esbuild'
import { launchBrowser, closeBrowser, closeServer } from './browser-harness.mjs'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const ENTRY = `import React from 'react'; import {createRoot} from 'react-dom/client'; import App from './App.jsx'; createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>)`
// Real App, routing, modules and account controller. Only transport is a fixture;
// SQL/API authorization is tested separately, not inferred from hidden navigation.
const MOCK = `
import {createAccountSession} from './account-session.js'
const params = new URLSearchParams(location.search)
const caps = {menu:['catalog_manage','public_menu'],online_orders:['catalog_manage','public_menu','online_orders','orders_desk'],reservations:['public_reservations','reservations_desk'],none:[]}
const sessionFor = (org,user=org) => ({user:{id:user,email:user+'@example.test',app_metadata:{org_id:org}},access_token:org+'-token'})
let session=sessionFor('tenant-a'), listener
const fixture=window.accessFixture={calls:[],product:params.get('product')||'menu',revoked:false,
  holdItems:params.has('hold'), emit(org,user) {session=org?sessionFor(org,user):null;listener(org?'SIGNED_IN':'SIGNED_OUT',session)}}
const context = org => ({organization:{id:org,name:org+' workspace'},member:{role:'owner'},account_type:'customer',
  products:fixture.product==='none'?[]:[fixture.product],capabilities:caps[fixture.product],
  locations:[{id:org+'-location',name:org+' location',timezone:'Asia/Jerusalem',currency:'ILS'}],product_requests:[]})
function query(table) {
  const org=session?.user.app_metadata.org_id;let single=false
  const chain={select(){return this},eq(){return this},in(){return this},gte(){return this},lte(){return this},lt(){return this},gt(){return this},is(){return this},order(){return this},limit(){return this},range(){return this},abortSignal(){return this},single(){single=true;return this},maybeSingle(){single=true;return this},
    async then(resolve,reject) {
      fixture.calls.push({table,org})
      if(table==='menu_items'&&fixture.holdItems) {fixture.holdItems=false;await new Promise(done=>{fixture.releaseItems=done})}
      const data={
        locations:{id:org+'-location',name:org+' location',settings:{}},
        menu_categories:[{id:org+'-category',location_id:org+'-location',name:'Drinks',sort_order:0,is_active:true}],
        menu_items:[{id:org+'-item',category_id:org+'-category',name:org+' private item',price:1000,is_available:true,item_variants:[],menu_item_modifier_groups:[]}],
      }[table] ?? (single?null:[])
      return Promise.resolve({data,error:null}).then(resolve,reject)
    }};return chain
}
export const isSupabaseConfigured=true
export const supabase={
  auth:{initialize:async()=>({error:null}),getSession:async()=>({data:{session},error:null}),
    onAuthStateChange(fn){listener=fn;return {data:{subscription:{unsubscribe(){}}}}},
    async signOut(){fixture.emit(null);return {error:null}}},
  from:query, channel(){return {on(){return this},subscribe(){return this}}},removeChannel(){},
  rpc(name,args){const org=session?.user.app_metadata.org_id;const result=name==='get_backoffice_context'
    ? fixture.revoked?{error:{message:'not authenticated'}}:{data:context(org),error:null}
    : {data:[],error:null};fixture.calls.push({rpc:name,args,org});
    return {setHeader(){return this},abortSignal(){return this},then(resolve,reject){return Promise.resolve(result).then(resolve,reject)}}},
}
export const accountSession=createAccountSession(supabase)
fixture.reload=()=>accountSession.reloadContext()
accountSession.start()
`

const { browser, skip } = await launchBrowser()
let server, origin
before(async () => {
  if (skip) return
  const bundle = await build({ stdin: { contents: ENTRY, resolveDir: SRC, loader: 'jsx' }, bundle: true,
    write: false, format: 'esm', jsx: 'automatic', define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'access-transport', setup(b) {
      b.onResolve({ filter: /(^|\/)supabase(\.js)?$/ }, () => ({ path: 'supabase', namespace: 'fixture' }))
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: MOCK, loader: 'js', resolveDir: SRC }))
    } }],
  })
  const css = ['styles.css','responsive.css'].map(name => readFileSync(SRC + name,'utf8')).join('\n')
  server = createServer((req,res) => {
    if (req.url === '/entry.js') { res.setHeader('Content-Type','application/javascript'); res.end(bundle.outputFiles[0].text) }
    else if (req.url === '/styles.css') { res.setHeader('Content-Type','text/css'); res.end(css) }
    else { res.setHeader('Content-Type','text/html'); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script type="module" src="/entry.js"></script></body></html>') }
  })
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
  origin = `http://127.0.0.1:${server.address().port}`
})
after(async () => { await closeBrowser(browser); await closeServer(server) })

async function open(t, query) {
  const context = await browser.createBrowserContext(), page = await context.newPage()
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  page.setDefaultTimeout(10000)
  t.after(async()=>{await context.close();assert.deepEqual(errors,[])})
  await page.setViewport({width:1280,height:900})
  await page.goto(`${origin}/account/?${query}`)
  await page.waitForSelector('h1')
  return page
}
describe('account product and tenant UI boundaries', {skip}, () => {
  for (const [product,view,forbidden] of [
    ['menu','orders',['online_orders','online_order_events','get_online_orders_web']],
    ['online_orders','reservations',['reservations','get_reservation_desk_web']],
    ['reservations','menu',['menu_items','menu_categories']],
    ['none','menu',['menu_items','menu_categories']],
  ]) it(`${product}: forbidden deep link does not mount or fetch ${view}`, async t => {
    const page=await open(t,`product=${product}&view=${view}`)
    await page.waitForFunction(blocked=>new URLSearchParams(location.search).get('view')!==blocked,{},view)
    assert.equal(await page.evaluate(blocked=>window.accessFixture.calls.some(call=>blocked.includes(call.table||call.rpc)),forbidden),false)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  })
  it('sign-out removes loaded tenant data before another owner signs in', async t => {
    const page=await open(t,'product=menu&view=menu')
    await page.waitForFunction(()=>document.body.textContent.includes('tenant-a private item'))
    await page.evaluate(()=>window.accessFixture.emit(null))
    await page.waitForSelector('input[type=password]')
    assert.equal(await page.evaluate(()=>document.body.textContent.includes('tenant-a')),false)
    await page.evaluate(()=>window.accessFixture.emit('tenant-b'))
    await page.waitForFunction(()=>document.body.textContent.includes('tenant-b private item'))
    assert.equal(await page.evaluate(()=>document.body.textContent.includes('tenant-a')),false)
  })
  it('late catalogue response cannot reappear after an account switch', async t => {
    const page=await open(t,'product=menu&view=menu&hold=1')
    await page.waitForFunction(()=>Boolean(window.accessFixture.releaseItems))
    await page.evaluate(()=>window.accessFixture.emit('tenant-b'))
    await page.waitForFunction(()=>document.body.textContent.includes('tenant-b private item'))
    await page.evaluate(()=>window.accessFixture.releaseItems())
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    assert.equal(await page.evaluate(()=>document.body.textContent.includes('tenant-a')),false)
  })
  it('same user changing organization and then losing membership clears old views', async t => {
    const page=await open(t,'product=menu&view=menu')
    await page.waitForFunction(()=>document.body.textContent.includes('tenant-a private item'))
    await page.evaluate(()=>window.accessFixture.emit('tenant-b','tenant-a'))
    await page.waitForFunction(()=>document.body.textContent.includes('tenant-b private item'))
    assert.equal(await page.evaluate(()=>document.body.textContent.includes('tenant-a private item')),false)
    await page.evaluate(()=>{window.accessFixture.revoked=true;return window.accessFixture.reload()})
    await page.waitForFunction(()=>document.body.textContent.includes('We could not load your workspace'))
    assert.equal(await page.evaluate(()=>document.body.textContent.includes('private item')),false)
  })
})
