import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { before, after, describe, it } from 'node:test'
import { build } from 'esbuild'
import { launchBrowser, closeBrowser, closeServer } from './browser-harness.mjs'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const { browser, skip } = await launchBrowser()
let server, origin
before(async () => {
  if (skip) return
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client'; import SubscriptionPanel from './SubscriptionPanel.jsx';
    const disabled=new URLSearchParams(location.search).has('disabled');
    const context={organization:{id:'org'},locations:[{id:'loc',name:'Main'}]};
    const invoice={invoice_id:'invoice',number:'ANGLE-TEST-1',status:'open',mode:'test',subtotal_agorot:4900,discount_agorot:0,vat_agorot:882,total_agorot:5782,currency:'ILS',lines:[{description:'ANGLE Menu — Main',product:'menu',months:1}]};
    let draft=null, issued=false;
    window.billingFixture={creates:0,reads:0,failCreate:false,failCatalog:new URLSearchParams(location.search).has('fail'),paid:false};
    const api={getDraft:()=>draft,catalog:async()=>{
      if(window.billingFixture.failCatalog) {window.billingFixture.failCatalog=false;throw Error('offline')}
      return {mode:disabled?'disabled':'test',prices:disabled?[]:[{product:'menu',label:'ANGLE Menu',amount_agorot:4900,currency:'ILS'}],subscriptions:[],invoices:issued?[{...invoice}]:[]}},
      create:async value=>{window.billingFixture.creates++;draft=value;await new Promise(resolve=>setTimeout(resolve,80));
        if(window.billingFixture.failCreate){window.billingFixture.failCreate=false;throw Error('offline')}draft=null;issued=true;return {...invoice}},
      read:async()=>{window.billingFixture.reads++;return {...invoice,status:window.billingFixture.paid?'paid':invoice.status}},
      cancel:async()=>{invoice.status='void';return {...invoice}}};
    createRoot(document.getElementById('root')).render(<React.StrictMode><SubscriptionPanel context={context} api={api}/></React.StrictMode>);`
  const result = await build({ stdin: { contents: entry, resolveDir: SRC, loader: 'jsx' }, bundle: true, write: false,
    format: 'esm', jsx: 'automatic', define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' } })
  const css = ['styles.css','responsive.css'].map(file => readFileSync(SRC + file, 'utf8')).join('\n')
  server = createServer((req, res) => {
    if (req.url === '/entry.js') { res.setHeader('Content-Type','text/javascript'); res.end(result.outputFiles[0].text) }
    else if (req.url === '/styles.css') { res.setHeader('Content-Type','text/css'); res.end(css) }
    else { res.setHeader('Content-Type','text/html'); res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script type="module" src="/entry.js"></script>') }
  })
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
  origin = `http://127.0.0.1:${server.address().port}`
})
after(async () => { await closeBrowser(browser); await closeServer(server) })
async function withPage(query, work) {
  const page = await browser.newPage()
  try { await page.setViewport({ width:390,height:844 }); await page.goto(origin + query); await work(page) }
  finally { await page.close() }
}
async function click(page, label) {
  await page.waitForFunction(text => [...document.querySelectorAll('button')].some(button=>button.textContent.trim()===text&&!button.disabled), {}, label)
  await page.evaluate(text => [...document.querySelectorAll('button')].find(button=>button.textContent.trim()===text).click(), label)
}
describe('subscription checkout UI', { skip }, () => {
  it('disabled configuration cannot sell placeholder plans', async () => withPage('/?disabled', async page => {
    await page.waitForFunction(()=>document.body.textContent.includes('Online subscription purchases are not available'))
    assert.equal(await page.$('form'),null)
  }))
  it('double click makes one invoice and normal cabinet has no fake payment button', async () => withPage('/', async page => {
    await click(page,'Review invoice')
    await page.evaluate(()=>document.querySelector('form button').click())
    await page.waitForSelector('[data-invoice-status="open"]')
    assert.equal(await page.evaluate(()=>window.billingFixture.creates),1)
    assert.equal(await page.evaluate(()=>document.body.textContent.includes('Simulate successful payment')),false)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  }))
  it('refresh is not proof of payment; only paid server response is shown as paid', async () => withPage('/', async page => {
    await click(page,'Review invoice'); await page.waitForSelector('[data-invoice-status="open"]')
    await click(page,'Check payment status'); await page.waitForFunction(()=>window.billingFixture.reads===1)
    assert.equal(await page.$('[data-invoice-status="paid"]'),null)
    await page.evaluate(()=>{window.billingFixture.paid=true})
    await click(page,'Check payment status'); await page.waitForSelector('[data-invoice-status="paid"]')
  }))
  it('unknown checkout outcome freezes selection and offers the same request', async () => withPage('/', async page => {
    await page.evaluate(()=>{window.billingFixture.failCreate=true})
    await click(page,'Review invoice'); await page.waitForSelector('[role="alert"]')
    assert.equal(await page.$eval('select',element=>element.disabled),true)
    await click(page,'Retry the same checkout'); await page.waitForSelector('[data-invoice-status="open"]')
  }))
  it('cancel preserves a void invoice and does not activate access', async () => withPage('/', async page => {
    await click(page,'Review invoice'); await page.waitForSelector('[data-invoice-status="open"]')
    await click(page,'Cancel unpaid invoice'); await page.waitForSelector('[data-invoice-status="void"]')
    assert.equal(await page.$('[data-invoice-status="paid"]'),null)
  }))
  it('catalog failure offers a working retry', async () => withPage('/?fail', async page => {
    // StrictMode may complete its second mount before the first rejected load.
    await page.waitForFunction(()=>document.querySelector('form')||document.querySelector('[role="alert"]'))
    if (!await page.$('form')) await click(page,'Retry loading plans')
    await page.waitForSelector('form')
  }))
})
