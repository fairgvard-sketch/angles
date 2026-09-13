import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { before, after, describe, it } from 'node:test'
import { build } from 'esbuild'
import { launchBrowser, closeBrowser, closeServer } from './browser-harness.mjs'

// Real dashboard/data helpers, synthetic transport only. No production traffic.
const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const ENTRY = `
import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
import HomeDashboard from './HomeDashboard.jsx';
function Fixture() {
  const [scope,setScope]=useState({id:'loc-a',org:'org-a',product:new URLSearchParams(location.search).get('product')||'menu'});
  window.setupFixture.setScope=setScope;
  const capabilities=scope.product==='reserve'?['reservations_desk','public_reservations']
    :scope.product==='inactive'?[]:['catalog_manage','public_menu',...(scope.product==='orders'?['online_orders']:[])];
  const context={organization:{id:scope.org},member:{id:'owner',role:'owner'},capabilities,
    locations:[{id:'loc-a',name:'Alpha café',timezone:'UTC'},{id:'loc-b',name:'Beta café',timezone:'UTC'}]};
  return <main className="content"><HomeDashboard context={context} locationId={scope.id}
    onNavigate={(view,locationId,tab)=>window.setupFixture.nav={view,locationId,tab}}/></main>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);
`
const MOCK = `
const params=new URLSearchParams(location.search);
const f=window.setupFixture={calls:[],pending:[],hold:params.has('hold')?'loc-a':null,fail:params.has('fail'),failChannels:params.has('failChannels'),
  rows:{'loc-a':{slug:'alpha',categories:[]},'loc-b':{slug:'bravo',categories:[]}},
  release(id){const pending=this.pending.filter(p=>p.id===id);this.pending=this.pending.filter(p=>p.id!==id);pending.forEach(p=>p.done(p.result));},
};
const nativeInterval=window.setInterval;
window.setInterval=(callback,ms,...args)=>{if(ms===60000)f.refresh=callback;return nativeInterval(callback,ms,...args)};
if(params.has('stock')) f.rows['loc-a'].categories=[
  {id:'active',location_id:'loc-a',is_active:true,menu_items:[{is_available:params.get('stock')!=='hidden'},{is_available:false}]},
  {id:'inactive',location_id:'loc-a',is_active:false,menu_items:[{is_available:true}]},
  {id:'foreign',location_id:'loc-b',is_active:true,menu_items:[{is_available:true}]},
];
function query(table) {
  const filters={};const chain={select(fields){this.fields=fields;return this},eq(key,value){filters[key]=value;return this},
    order(){return this},single(){return this},maybeSingle(){return this},in(){return this},gte(){return this},
    then(resolve,reject){
      const id=filters.id||filters.location_id;f.calls.push({table,filters,fields:this.fields});const row=f.rows[id];
      const data=table==='locations'?{id,settings:{online_orders:{enabled:true},reservations:{enabled:true}}}
        :table==='location_slugs'?{slug:row.slug}:table==='menu_categories'
          ?row.categories.filter(c=>Object.entries(filters).every(([key,value])=>c[key]===value)):[];
      const result=f.fail&&table==='menu_categories'||f.failChannels&&table==='locations'
        ?{data:null,error:{message:'Synthetic read failure'}}:{data,error:null};
      if(f.hold===id)return new Promise(done=>f.pending.push({id,done,result})).then(resolve,reject);
      return Promise.resolve(result).then(resolve,reject);
    }};return chain;
}
export const supabase={from:query,rpc(){throw new Error('Unexpected RPC in menu dashboard fixture')}};
`
const { browser, skip } = await launchBrowser()
let server, origin
before(async () => {
  if (skip) return
  const bundle = await build({ stdin: { contents: ENTRY, resolveDir: SRC, loader: 'jsx' }, bundle: true,
    write: false, format: 'esm', jsx: 'automatic', define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'setup-transport', setup(b) {
      b.onResolve({ filter: /(^|\/)supabase(\.js)?$/ }, () => ({ path: 'supabase', namespace: 'fixture' }))
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: MOCK, loader: 'js', resolveDir: SRC }))
    } }],
  })
  const css = ['styles.css','responsive.css'].map(name => readFileSync(SRC + name,'utf8')).join('\n')
  server = createServer((req,res) => {
    if (req.url === '/entry.js') { res.setHeader('Content-Type','application/javascript'); res.end(bundle.outputFiles[0].text) }
    else if (req.url === '/styles.css') { res.setHeader('Content-Type','text/css; charset=utf-8'); res.end(css) }
    else { res.setHeader('Content-Type','text/html; charset=utf-8'); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script type="module" src="/entry.js"></script></body></html>') }
  })
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
  origin = `http://127.0.0.1:${server.address().port}`
})
after(async () => { await closeBrowser(browser); await closeServer(server) })

async function open(t, query = '') {
  const context = await browser.createBrowserContext(), page = await context.newPage()
  const errors=[], external=[]
  page.on('pageerror',error=>errors.push(error.message))
  page.setDefaultTimeout(5000)
  t.after(async()=>{await context.close();assert.deepEqual(errors,[]);assert.deepEqual(external,[])})
  await page.setRequestInterception(true)
  page.on('request', req => {
    if (req.url().startsWith(origin + '/') || req.url().startsWith('data:')) void req.continue()
    else { external.push(req.url()); void req.abort() }
  })
  await page.setViewport({width:1280,height:1000})
  await page.goto(`${origin}/?${query}`)
  await page.waitForSelector(query.includes('hold') ? '.sk' : '.dash-grid')
  return page
}
async function settle(page) {
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))))
}
async function scope(page, id, org='org-a', product='menu') {
  await page.evaluate(s=>window.setupFixture.setScope(s),{id,org,product})
  await settle(page)
}
const guestLink = page => page.$eval('.dash-grid a',e=>e.getAttribute('href'))

describe('first menu setup and dashboard scope', {skip}, () => {
  it('empty catalogue gives an existing-editor route, not a false all-clear', async t => {
    const page=await open(t)
    assert.ok(await page.$('.menu-setup'),'first-run route must be visible')
    assert.equal(await page.$('.dash-clear'),null)
    assert.equal(await page.$eval('.menu-setup details',e=>e.open),true)
    const text=await page.$eval('.menu-setup',e=>e.textContent)
    assert.match(text,/No available items/)
    assert.match(text,/Alpha café/)
    assert.doesNotMatch(text,/Opening hours|Take a test order|Register|Pay|ready for guests/i)
    for(const [label,view,tab] of [['Location details','locations','details'],['Manage catalogue','menu',null],['Link, QR & appearance','online',null]]) {
      await page.click(`.menu-setup button::-p-text(${label})`)
      assert.deepEqual(await page.evaluate(()=>window.setupFixture.nav),{view,locationId:'loc-a',tab})
    }
    assert.equal(await page.$eval('.menu-setup a',e=>e.getAttribute('href')),await guestLink(page))
    for (const width of [1280,375,320]) {
      await page.setViewport({width,height:1100})
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`setup at ${width}px`)
      if(width===1280&&process.env.ANGLE_SETUP_DESKTOP_SCREENSHOT)await page.screenshot({path:process.env.ANGLE_SETUP_DESKTOP_SCREENSHOT,fullPage:true})
    }
    if(process.env.ANGLE_SETUP_SCREENSHOT)await page.screenshot({path:process.env.ANGLE_SETUP_SCREENSHOT,fullPage:true})
  })
  it('late initial response for A cannot replace B guest link', async t => {
    const page=await open(t,'hold=1')
    await page.waitForFunction(()=>window.setupFixture.pending.length>0)
    await scope(page,'loc-b')
    await page.waitForSelector('.dash-grid a')
    assert.match(await guestLink(page),/\/bravo$/)
    await page.evaluate(()=>{window.setupFixture.hold=null;window.setupFixture.release('loc-a')})
    await settle(page)
    assert.match(await guestLink(page),/\/bravo$/)
  })
  it('a failed catalogue read is unknown, not empty or complete, and can be retried', async t => {
    const page=await open(t,'fail=1')
    assert.equal(await page.$('.dash-clear'),null)
    assert.match(await page.$eval('.menu-setup',e=>e.textContent),/Could not check/)
    assert.doesNotMatch(await page.$eval('.menu-setup',e=>e.textContent),/No available items/)
    assert.match(await guestLink(page),/\/alpha$/,'unrelated widgets remain usable')
    await page.evaluate(()=>{window.setupFixture.fail=false})
    await page.click('button::-p-text(Retry loading)')
    await page.waitForFunction(()=>document.querySelector('.menu-setup')?.textContent.includes('No available items'))
    assert.equal(await page.$('.dash-partial'),null)
  })
  it('counts only available items of active categories in the selected location', async t => {
    const page=await open(t,'stock=available')
    assert.match(await page.$eval('.menu-setup',e=>e.textContent),/1 available item in 1 active category/)
    assert.equal(await page.$eval('.menu-setup details',e=>e.open),false,'an established menu does not get an expanded tutorial')
    await page.focus('.menu-setup summary')
    await page.keyboard.press('Enter')
    assert.equal(await page.$eval('.menu-setup details',e=>e.open),true)
    assert.match(await page.$eval('.menu-setup',e=>e.textContent),/check the guest page before sharing/)
    const reads=await page.evaluate(()=>window.setupFixture.calls.filter(c=>c.table==='menu_categories'))
    assert.ok(reads.length>0)
    assert.ok(reads.every(c=>c.filters.location_id==='loc-a'&&c.filters.is_active===true))
  })
  it('hidden and inactive/other-location items cannot complete an empty menu', async t => {
    const page=await open(t,'stock=hidden')
    assert.match(await page.$eval('.menu-setup',e=>e.textContent),/No available items/)
    assert.equal(await page.$eval('.menu-setup details',e=>e.open),true)
  })
  it('orders capability adds the hours/fulfilment step without inventing a hours blocker', async t => {
    const page=await open(t,'product=orders')
    assert.match(await page.$eval('.menu-setup',e=>e.textContent),/Opening hours & fulfilment/)
    await page.click('button::-p-text(Opening hours & fulfilment)')
    assert.deepEqual(await page.evaluate(()=>window.setupFixture.nav),{view:'online',locationId:'loc-a',tab:null})
    assert.match(await page.$eval('.menu-setup',e=>e.textContent),/Without a schedule/)
  })
  for(const product of ['reserve','inactive']) it(`${product} does not read catalogue or advertise a menu workflow`, async t => {
    const page=await open(t,`product=${product}`)
    assert.equal(await page.$('.menu-setup'),null)
    assert.equal(await page.evaluate(()=>window.setupFixture.calls.some(c=>c.table==='menu_categories')),false)
  })
  it('switching to a still-loading location hides the previous location immediately', async t => {
    const page=await open(t)
    assert.match(await guestLink(page),/\/alpha$/)
    await page.evaluate(()=>{window.setupFixture.hold='loc-b'})
    await scope(page,'loc-b')
    assert.equal(await page.$('.dash-grid a'),null)
    assert.equal(await page.$('.menu-setup'),null)
    await page.evaluate(()=>{window.setupFixture.hold=null;window.setupFixture.release('loc-b')})
    await page.waitForSelector('.menu-setup')
    assert.match(await guestLink(page),/\/bravo$/)
  })
  it('A → B → A cannot revive the first A request', async t => {
    const page=await open(t,'hold=1')
    await scope(page,'loc-b');await page.waitForSelector('.dash-grid a')
    await page.evaluate(()=>{window.setupFixture.rows['loc-a'].slug='new-alpha';window.setupFixture.hold=null})
    await scope(page,'loc-a');await page.waitForSelector('.dash-grid a')
    assert.match(await guestLink(page),/\/new-alpha$/)
    await page.evaluate(()=>window.setupFixture.release('loc-a'));await settle(page)
    assert.match(await guestLink(page),/\/new-alpha$/)
  })
  it('changed organisation with a reused location key does not reuse old dashboard state', async t => {
    const page=await open(t)
    await page.evaluate(()=>{window.setupFixture.hold='loc-a';window.setupFixture.rows['loc-a'].slug='new-owner'})
    await scope(page,'loc-a','org-b')
    assert.equal(await page.$('.dash-grid a'),null)
    await page.evaluate(()=>{window.setupFixture.hold=null;window.setupFixture.release('loc-a')})
    await page.waitForSelector('.dash-grid a')
    assert.match(await guestLink(page),/\/new-owner$/)
  })
  it('a failed channel read does not invent a guest link or hide the setup route', async t => {
    const page=await open(t,'failChannels=1')
    assert.match(await page.$eval('.menu-setup',e=>e.textContent),/Guest link could not be loaded/)
    assert.equal(await page.$('.menu-setup a'),null)
    assert.equal(await page.$('.dash-grid a'),null)
    await page.evaluate(()=>{window.setupFixture.failChannels=false})
    await page.click('button::-p-text(Retry loading)')
    await page.waitForSelector('.menu-setup a')
    assert.match(await guestLink(page),/\/alpha$/)
  })
  it('late periodic refresh cannot overwrite a newer response in the same scope', async t => {
    const page=await open(t)
    await page.evaluate(()=>{window.setupFixture.hold='loc-a';window.setupFixture.refresh()})
    await page.waitForFunction(()=>window.setupFixture.pending.length>0)
    await page.evaluate(()=>{window.setupFixture.hold=null;window.setupFixture.rows['loc-a'].slug='new-alpha';window.setupFixture.refresh()})
    await page.waitForFunction(()=>document.querySelector('.dash-grid a')?.href.endsWith('/new-alpha'))
    await page.evaluate(()=>window.setupFixture.release('loc-a'));await settle(page)
    assert.match(await guestLink(page),/\/new-alpha$/)
  })
  it('capability revocation cannot be reversed by a late menu response', async t => {
    const page=await open(t,'hold=1')
    await scope(page,'loc-a','org-a','inactive')
    await page.waitForSelector('.dash-grid')
    await page.evaluate(()=>{window.setupFixture.hold=null;window.setupFixture.release('loc-a')});await settle(page)
    assert.equal(await page.$('.menu-setup'),null)
    assert.equal(await page.$('.dash-grid a'),null)
  })
})
