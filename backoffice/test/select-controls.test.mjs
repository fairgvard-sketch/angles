import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { closeBrowser, launchBrowser } from './browser-harness.mjs'

// Real shared CSS and native controls: no replacement menu, network or Auth.
const css = ['styles.css', 'responsive.css'].map((file) => (
  readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
)).join('\n')
const filterClasses = ['cat-select-filter', 'act-select', 'cus-select', 'ord-select', 'rsv-select', 'hrs-select', 'tm-select']
const formClasses = ['qr-field', 'cat-form', 'modal-body', 'inline-add', 'floor-add-options', 'location-picker', 'subscription-form', 'order-filter', 'rsv-rule', 'topbar-location', 'cat-location']
const label = (kind, text, extra = '') => `<label class="${kind}"><span class="visually-hidden">${kind}</span><select ${extra}><option value="all">${text}</option><option value="next">Next option</option></select></label>`
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style>
<body><main style="padding:16px">
<section class="cat-toolbar" id="catalogue">
${label('cat-select-filter', 'All categories')}${label('cat-select-filter', 'All statuses')}
<button class="cat-chip">Needs attention <span>12</span></button>${label('cat-select-filter', 'Manual order')}
</section><section class="act-toolbar">${label('act-select', 'All time')}</section>
<section class="cus-toolbar">${label('cus-select', 'Last visit')}</section>
<section id="families" style="display:grid;grid-template-columns:minmax(0,1fr);gap:12px;max-width:360px">
${[...filterClasses, ...formClasses].map((kind) => label(kind, 'All locations')).join('')}
</section><section style="width:180px;max-width:100%;margin-top:16px">
${label('qr-field', 'A very long location name that must not cover the arrow', 'id="long"')}
${label('qr-field', 'Disabled', 'id="disabled" disabled')}
${label('qr-field', 'Invalid', 'id="invalid" aria-invalid="true"')}
${label('qr-field', 'Explicit size', 'id="single" size="1"')}
${label('qr-field', 'Default size', 'id="zero" size="0"')}
${label('qr-field', 'Multiple', 'id="multiple" multiple')}
${label('qr-field', 'Listbox', 'id="listbox" size="3"')}
</section></main></body></html>`

const { browser, skip } = await launchBrowser()
after(async () => closeBrowser(browser))

async function open(t, width = 1280, dir = 'ltr') {
  const page = await browser.newPage()
  t.after(() => page.close())
  await page.setViewport({ width, height: 1000 })
  await page.setContent(html)
  await page.evaluate((direction) => { document.documentElement.dir = direction }, dir)
  if (process.env.ANGLE_UI_ARTIFACT_DIR) {
    const stem = join(process.env.ANGLE_UI_ARTIFACT_DIR, `select-${width}-${dir}`)
    await page.screenshot({ path: `${stem}.png`, fullPage: true })
    writeFileSync(`${stem}.html`, html.replace('<html lang="en">', `<html lang="en" dir="${dir}">`))
  }
  return page
}

describe('shared native select finish', { skip }, () => {
  for (const width of [320, 375, 768, 1280]) {
    it(`inset arrows, reserved text space and contained filters at ${width}px`, async (t) => {
      const page = await open(t, width)
      const state = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - innerWidth,
        catalogueHeights: [...document.querySelectorAll('#catalogue select, #catalogue button')].map((el) => el.getBoundingClientRect().height),
        controls: [...document.querySelectorAll('#catalogue select, .act-toolbar select, .cus-toolbar select, #families select')].map((el) => {
          const s = getComputedStyle(el), r = el.getBoundingClientRect()
          return { family: el.parentElement.className, appearance: s.appearance, end: parseFloat(s.paddingInlineEnd), image: s.backgroundImage, position: s.backgroundPosition, left: r.left, right: r.right, height: r.height }
        }),
      }))
      assert.equal(state.overflow, 0, 'no horizontal page scroll')
      assert.equal(new Set(state.catalogueHeights).size, 1, 'filters and adjacent action align')
      for (const control of state.controls) {
        assert.equal(control.appearance, 'none', control.family)
        assert.ok(control.end >= 36, `${control.family}: text must stop before arrow`)
        assert.match(control.image, /linear-gradient/, control.family)
        assert.match(control.position, /12px/, `${control.family}: inset from border`)
        assert.ok(control.left >= 0 && control.right <= width, JSON.stringify(control))
      }
      if (width <= 375) assert.ok(state.controls.slice(0, 5).every((control) => control.height >= 44), 'touch-sized filters')
      const clipped = await page.evaluate(() => {
        const ctx = document.createElement('canvas').getContext('2d')
        return [...document.querySelectorAll('#catalogue select')].filter((el) => {
          const s = getComputedStyle(el)
          ctx.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`
          return ctx.measureText(el.selectedOptions[0].text).width > el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight)
        }).map((el) => el.selectedOptions[0].text)
      })
      assert.deepEqual(clipped, [], 'short default filter labels should fit')
    })
  }

  it('long text clips before the arrow, including inherited RTL', async (t) => {
    const page = await open(t, 320, 'rtl')
    const state = await page.$eval('#long', (el) => {
      const s = getComputedStyle(el)
      return { width: el.clientWidth, parent: el.parentElement.clientWidth, direction: s.direction, end: s.paddingInlineEnd, position: s.backgroundPosition, overflow: s.textOverflow }
    })
    assert.equal(state.direction, 'rtl')
    assert.ok(state.width <= state.parent)
    assert.equal(state.end, '36px')
    assert.match(state.position, /^12px 50%, 18px 50%$/)
    assert.equal(state.overflow, 'ellipsis')
  })

  it('disabled and invalid controls keep their affordance and state', async (t) => {
    const page = await open(t)
    const state = await page.evaluate(() => ['disabled', 'invalid'].map((id) => {
      const el = document.getElementById(id), s = getComputedStyle(el)
      return { id, image: s.backgroundImage, cursor: s.cursor, border: s.borderColor, shadow: s.boxShadow }
    }))
    for (const s of state) assert.match(s.image, /linear-gradient/, s.id)
    assert.equal(state[0].cursor, 'not-allowed')
    assert.notEqual(state[1].shadow, 'none')
  })

  it('native keyboard selection, focus and labels are preserved', async (t) => {
    const page = await open(t)
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('#catalogue select')), true)
    const focus = await page.$eval('#catalogue select', (el) => ({ visible: el.matches(':focus-visible'), outline: getComputedStyle(el).outlineStyle, labels: el.labels.length }))
    assert.equal(focus.visible, true)
    assert.notEqual(focus.outline, 'none')
    assert.equal(focus.labels, 1)
    // Type-ahead works on the actual native select; no JS menu intercepts it.
    await page.keyboard.press('n')
    assert.equal(await page.$eval('#catalogue select', (el) => el.value), 'next')
  })

  it('single-row explicit sizes get an arrow, listboxes do not', async (t) => {
    const page = await open(t)
    const state = await page.evaluate(() => ['single', 'zero', 'multiple', 'listbox'].map((id) => ({ id, image: getComputedStyle(document.getElementById(id)).backgroundImage })))
    for (const s of state.slice(0, 2)) assert.match(s.image, /linear-gradient/, s.id)
    for (const s of state.slice(2)) assert.equal(s.image, 'none', s.id)
  })

  it('forced colours restore the native arrow instead of losing the affordance', async (t) => {
    const page = await open(t)
    const client = await page.createCDPSession()
    await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] })
    const state = await page.$eval('#catalogue select', (el) => ({ active: matchMedia('(forced-colors: active)').matches, appearance: getComputedStyle(el).appearance, image: getComputedStyle(el).backgroundImage }))
    assert.equal(state.active, true)
    assert.equal(state.appearance, 'auto')
    assert.equal(state.image, 'none')
  })
})
