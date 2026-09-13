import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { before, after, describe, it } from 'node:test'
import { build } from 'esbuild'
import { launchBrowser, closeBrowser, closeServer } from './browser-harness.mjs'

// Real channel components and data helpers; only Supabase transport is replaced.
// All identities/content are synthetic and external requests are intercepted.
const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const ENTRY = `
import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
import QrChannels from './QrChannels.jsx';
function Fixture() {
  const [locationId,setLocation] = useState('loc-a'), [channel,setChannel] = useState('online');
  window.qrFixture.setLocation=setLocation; window.qrFixture.setChannel=setChannel;
  const menuOnly=new URLSearchParams(location.search).get('product')==='menu';
  const context={organization:{id:'synthetic-org'}, capabilities:menuOnly?['catalog_manage','public_menu']:['catalog_manage','public_menu','online_orders','public_reservations'],
    locations:[{id:'loc-a',name:'A'},{id:'loc-b',name:'B'}]};
  return <QrChannels context={context} locationId={locationId} channel={channel} onNavigate={()=>{}}/>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);
`
const MOCK = `
const f=window.qrFixture={failReads:new URLSearchParams(location.search).has('fail'),hold:false,pending:[],calls:[],
  rows:{'loc-a':{enabled:true,slug:'alpha'},'loc-b':{enabled:false,slug:'bravo'}},
  async finish(index,error=false) {const p=this.pending[index];p.done(error?{data:null,error:{message:'Synthetic save failed'}}:p.result);},
};
function query(table) {
  let id; const chain={select(){return this},eq(key,value){if(key==='id'||key==='location_id')id=value;return this},
    order(){return this},single(){return this},maybeSingle(){return this},in(){return this},
    then(resolve,reject){
      f.calls.push({table,id});const row=f.rows[id];
      const data=table==='locations'?{id,settings:{online_orders:{enabled:row.enabled},reservations:{enabled:false}},receipt_address:id+' address'}
        :table==='location_slugs'?{slug:row.slug}:[];
      return Promise.resolve(f.failReads&&table==='locations'?{error:{message:'Synthetic load failed'}}:{data,error:null}).then(resolve,reject);
    }};return chain;
}
export const supabase={from:query,
  rpc(name,args){
    f.calls.push({rpc:name,args});
    if(name==='reserve_launch_checklist_web')return Promise.resolve({data:{steps:[]},error:null});
    const result={data:name==='set_location_slug'?{slug:args.p_slug}:null,error:null};
    if(f.hold)return new Promise(done=>f.pending.push({name,args,result,done}));
    if(name==='patch_location_settings_web')Object.assign(f.rows[args.p_location_id],args.p_patch.online_orders||{});
    return Promise.resolve(result);
  },
};
`
const { browser, skip } = await launchBrowser()
let server, origin
before(async () => {
  if (skip) return
  const bundle = await build({ stdin: { contents: ENTRY, resolveDir: SRC, loader: 'jsx' }, bundle: true,
    write: false, format: 'esm', jsx: 'automatic', define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'qr-transport', setup(b) {
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

async function open(t, query = '') {
  const context = await browser.createBrowserContext(), page = await context.newPage()
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  page.setDefaultTimeout(5000)
  t.after(async()=>{await context.close();assert.deepEqual(errors,[])})
  await page.setRequestInterception(true)
  page.on('request', req => {
    if (req.url().startsWith(origin + '/') || req.url().startsWith('data:')) void req.continue()
    else void req.respond({status:200,contentType:'text/html',body:'<!doctype html><title>Synthetic preview</title>'})
  })
  await page.setViewport({width:1280,height:900})
  await page.goto(`${origin}/?${query}`)
  await page.waitForSelector(query.includes('fail=') ? '[role=alert]' : '.channel-bar')
  return page
}
async function settle(page) {
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))))
}
async function switchToB(page) {
  await page.evaluate(()=>window.qrFixture.setLocation('loc-b'))
  await page.waitForFunction(()=>document.querySelector('.channel-bar-link input')?.value.includes('bravo')
    || [...document.querySelectorAll('input')].some(e=>e.value.includes('/bravo')))
}
async function holdToggle(page) {
  await page.evaluate(()=>{window.qrFixture.hold=true})
  await page.click('.channel-switch')
  await page.waitForFunction(()=>window.qrFixture.pending.length===1)
}
describe('QR channel load and mutation isolation (B4/B6)', {skip}, () => {
  it('failed load leaves loading state and can retry without leaving the channel', async t => {
    const page=await open(t,'fail=1')
    assert.equal(await page.$('.sk'),null,'a failed request is no longer loading')
    const retry=await page.$('button::-p-text(Retry loading)')
    assert.ok(retry,'failed load must provide a retry action')
    for (const width of [1280,375,320]) {
      await page.setViewport({width,height:900})
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`failed load at ${width}px`)
    }
    if (process.env.ANGLE_QR_SCREENSHOT) await page.screenshot({path:process.env.ANGLE_QR_SCREENSHOT,fullPage:true})
    await page.evaluate(()=>{window.qrFixture.failReads=false})
    await retry.click()
    await page.waitForSelector('.channel-switch')
    assert.equal(await page.$('[role=alert]'),null)
  })
  it('late failed save for A cannot revert B or display A error there', async t => {
    const page=await open(t)
    await holdToggle(page); await switchToB(page)
    await page.evaluate(()=>window.qrFixture.finish(0,true)); await settle(page)
    assert.equal(await page.$eval('.channel-switch',e=>e.getAttribute('aria-pressed')),'false')
    assert.equal(await page.$('[role=alert]'),null)
  })
  it('late successful save for A cannot show Saved in B', async t => {
    const page=await open(t)
    await holdToggle(page); await switchToB(page)
    await page.evaluate(()=>window.qrFixture.finish(0)); await settle(page)
    assert.equal(await page.$('.qr-feedback .save-ok'),null)
  })
  it('returning A → B → A does not revive the first screen’s pending save', async t => {
    const page=await open(t)
    await holdToggle(page); await switchToB(page)
    await page.evaluate(()=>window.qrFixture.setLocation('loc-a'))
    await page.waitForFunction(()=>[...document.querySelectorAll('input')].some(e=>e.value.includes('/alpha')))
    await page.evaluate(()=>window.qrFixture.finish(0)); await settle(page)
    assert.equal(await page.$('.qr-feedback .save-ok'),null)
    assert.equal(await page.$eval('.channel-switch',e=>e.getAttribute('aria-pressed')),'true')
  })
  it('late slug save for A cannot replace B guest link', async t => {
    const page=await open(t)
    await page.click('button::-p-text(Link & address)')
    await page.$eval('.slug-input input',e=>e.select())
    await page.type('.slug-input input','new-alpha')
    await page.evaluate(()=>{window.qrFixture.hold=true})
    await page.click('button::-p-text(Save address)')
    await page.waitForFunction(()=>window.qrFixture.pending.length===1)
    await switchToB(page)
    await page.evaluate(()=>window.qrFixture.finish(0)); await settle(page)
    assert.equal(await page.evaluate(()=>[...document.querySelectorAll('input')].some(e=>e.value.includes('new-alpha'))),false)
    assert.equal(await page.evaluate(()=>[...document.querySelectorAll('input')].some(e=>e.value.includes('/bravo'))),true)
  })
  it('late Menu error cannot appear in Reservations for the same location', async t => {
    const page=await open(t)
    await holdToggle(page)
    await page.evaluate(()=>window.qrFixture.setChannel('reserve'))
    await page.waitForFunction(()=>document.querySelector('h1')?.textContent==='QR Reservations')
    await page.evaluate(()=>window.qrFixture.finish(0,true)); await settle(page)
    assert.equal(await page.$('[role=alert]'),null)
  })
  it('current save persists to its own location and survives a channel remount', async t => {
    const page=await open(t)
    await page.click('.channel-switch')
    await page.waitForSelector('.qr-feedback .save-ok')
    const calls=await page.evaluate(()=>window.qrFixture.calls.filter(c=>c.rpc==='patch_location_settings_web'))
    assert.equal(calls.length,1)
    assert.equal(calls[0].args.p_location_id,'loc-a')
    assert.deepEqual(calls[0].args.p_patch,{online_orders:{enabled:false}})
    await switchToB(page)
    await page.evaluate(()=>window.qrFixture.setLocation('loc-a'))
    await page.waitForFunction(()=>[...document.querySelectorAll('input')].some(e=>e.value.includes('/alpha')))
    assert.equal(await page.$eval('.channel-switch',e=>e.getAttribute('aria-pressed')),'false')
  })
  it('Menu-only keeps link/QR but has no ordering or table controls and makes no table reads', async t => {
    const page=await open(t,'product=menu')
    assert.equal(await page.$('.channel-switch'),null)
    assert.equal(await page.evaluate(()=>document.body.textContent.includes('Browse-only menu')),true)
    for (const label of ['How guests order','Opening hours','Table QR codes','guests can order']) {
      assert.equal(await page.evaluate(text=>document.body.textContent.includes(text),label),false,label)
    }
    assert.ok(await page.$('button[aria-label="Download QR — QR menu"]'))
    assert.ok(await page.$('a[aria-label="Open page — QR menu"]'))
    assert.equal(await page.evaluate(()=>window.qrFixture.calls.some(c=>c.table==='tables')),false)
    for (const width of [1280,375,320]) {
      await page.setViewport({width,height:1100})
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Menu-only at ${width}px`)
    }
    if (process.env.ANGLE_MENU_SCREENSHOT) await page.screenshot({path:process.env.ANGLE_MENU_SCREENSHOT,fullPage:true})
  })
  it('Menu-only still saves appearance without toggling ordering', async t => {
    const page=await open(t,'product=menu')
    await page.click('button::-p-text(Look of the guest page)')
    await page.type('.qr-grid input','Synthetic menu name')
    await page.keyboard.press('Tab')
    await page.waitForSelector('.qr-feedback .save-ok')
    const calls=await page.evaluate(()=>window.qrFixture.calls.filter(c=>c.rpc==='patch_location_settings_web'))
    assert.equal(calls.length,1)
    assert.equal(calls[0].args.p_location_id,'loc-a')
    assert.deepEqual(calls[0].args.p_patch,{online_orders:{display_name:'Synthetic menu name'}})
    assert.equal(await page.$('.channel-switch'),null)
  })
})
