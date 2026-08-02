import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { after, before, describe, it } from 'node:test'
import { build } from 'esbuild'
import puppeteer from 'puppeteer'

/**
 * Проверки, которых не бывает без настоящего браузера.
 *
 *   1. Граница ошибки. React вызывает её только в DOM: в серверном
 *      рендере ошибка просто летит наверх, поэтому «упавший раздел
 *      восстанавливается» проверяется здесь.
 *   2. Встроенное превью гостя. Оно уводило страницу вниз и забирало
 *      фокус, а это поведение чужого кадра — воспроизводится только в
 *      браузере и только с кадра на ДРУГОМ origin (два порта ниже).
 *
 * Гостевая страница подменена: настоящую сюда тащить нельзя, а
 * проверяем мы не её, а реакцию кабинета на кадр, который ставит фокус
 * себе и просит браузер себя показать.
 */

const HTML = (script) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/styles.css">
<style>.tall{height:1800px}</style></head>
<body><div id="root"></div><script type="module">${script}</script></body></html>`

const STYLES = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

/**
 * Подставная гостевая страница: делает ровно то, из-за чего кабинет
 * уезжал вниз — ставит фокус своей кнопке и просит показать её.
 * Кнопка нарочно глубоко внизу, иначе показывать нечего.
 */
const GUEST_PAGE = `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;font:16px system-ui}#start{margin-top:1400px}</style></head>
<body><button id="start">Start</button>
<script>
  const start = document.getElementById('start')
  start.focus()
  start.scrollIntoView()
  // Некоторые реальные страницы повторяют autofocus после запуска hero.
  // Защита кабинета должна работать не только в момент iframe load.
  setTimeout(() => {
    start.focus()
    start.scrollIntoView()
  }, 1200)
  parent.postMessage({ source: 'angle-public', type: 'ready', path: '/order/x' }, '*')
</script></body></html>`

/**
 * Без установленного Chrome набор пропускается с внятной причиной, а не
 * красит прогон в красный на машине, где браузера просто нет.
 */
let browser = null
let skip = false
try {
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
} catch (error) {
  skip = `no browser for puppeteer (${error.message.split('\n')[0]}); run: npx puppeteer browsers install chrome`
}

let appServer
let guestServer
let appOrigin
let guestOrigin
const bundles = new Map()

function serve(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler)
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

const originOf = (server) => `http://127.0.0.1:${server.address().port}`

/** Прокрутить так, чтобы панель превью показалась, и вернуть позицию. */
const scrollToPreview = (page) => page.evaluate(() => {
  const frame = document.querySelector('.guest-phone-frame')
  window.scrollTo(0, frame.getBoundingClientRect().top + window.scrollY - 80)
  return window.scrollY
})

async function bundle(name, contents) {
  const result = await build({
    stdin: {
      contents,
      resolveDir: new URL('../src/', import.meta.url).pathname,
      loader: 'jsx',
      sourcefile: `${name}.jsx`,
    },
    bundle: true,
    write: false,
    format: 'esm',
    jsx: 'automatic',
    resolveExtensions: ['.jsx', '.js'],
    define: {
      'import.meta.env': JSON.stringify({ VITE_PUBLIC_MENU_ORIGIN: guestOrigin }),
      'process.env.NODE_ENV': '"production"',
    },
  })
  bundles.set(name, result.outputFiles[0].text)
}

before(async () => {
  if (skip) return
  guestServer = await serve((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(GUEST_PAGE)
  })
  guestOrigin = originOf(guestServer)

  appServer = await serve((req, res) => {
    if (req.url === '/styles.css') {
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' })
      res.end(STYLES)
      return
    }
    const name = req.url.replace(/^\/|\.js$/g, '') || 'index'
    if (req.url.endsWith('.js')) {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      res.end(bundles.get(name) ?? '')
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(HTML(`import '/${name}.js'`))
  })
  appOrigin = originOf(appServer)

  await bundle('boundary', `
    import { useState } from 'react'
    import { createRoot } from 'react-dom/client'
    import ViewErrorBoundary from './ErrorBoundary'

    let shouldThrow = true
    function Section() {
      if (shouldThrow) throw new ReferenceError('selecting is not defined')
      return <p id="section-ok">Catalogue is back</p>
    }
    function App() {
      const [view, setView] = useState('menu')
      return (
        <div>
          <button id="repair" onClick={() => { shouldThrow = false }}>repair</button>
          <button id="other" onClick={() => setView('sales')}>other section</button>
          <nav id="chrome">navigation still here</nav>
          <ViewErrorBoundary key={view} view={view} onHome={() => setView('overview')}>
            {view === 'menu' && <Section />}
            {view !== 'menu' && <p id="other-section">{view}</p>}
          </ViewErrorBoundary>
        </div>
      )
    }
    createRoot(document.getElementById('root')).render(<App />)
  `)

  await bundle('tabs', `
    import { useState } from 'react'
    import { createRoot } from 'react-dom/client'
    import Tabs from './ui/Tabs'

    const items = [
      { key: 'items', label: 'Items' },
      { key: 'modifiers', label: 'Modifiers' },
      { key: 'stations', label: 'Stations' },
    ]
    function Page({ dir }) {
      const [tab, setTab] = useState('items')
      return (
        <main className="content" dir={dir}>
          <button id="before" className="secondary-button">before the tabs</button>
          <Tabs
            className="period-switch menu-tabs"
            label="Menu section"
            items={items}
            value={tab}
            onChange={setTab}
          />
          <p id="current">{tab}</p>
        </main>
      )
    }
    createRoot(document.getElementById('root')).render(<Page dir={window.__DIR__ || 'ltr'} />)
  `)

  await bundle('preview', `
    import { createRoot } from 'react-dom/client'
    import { GuestPreview } from './QrChannels'

    function Page() {
      return (
        <main className="content">
          <h1 id="top">QR menu &amp; online</h1>
          <button id="settings" className="secondary-button">a settings control</button>
          <div className="tall">page content above the preview</div>
          <GuestPreview url={window.__GUEST__} />
        </main>
      )
    }
    createRoot(document.getElementById('root')).render(<Page />)
  `)
})

after(async () => {
  await browser?.close()
  appServer?.close()
  guestServer?.close()
})

describe('view error boundary', { skip }, () => {
  it('keeps the workspace alive, explains the failure and recovers', async () => {
    const page = await browser.newPage()
    const logged = []
    page.on('console', (msg) => { if (msg.type() === 'error') logged.push(msg.text()) })
    await page.goto(`${appOrigin}/boundary`, { waitUntil: 'networkidle0' })

    // Рабочая область объясняет отказ, остальной кабинет цел
    await page.waitForSelector('.view-crash')
    assert.ok(await page.$('#chrome'), 'navigation must survive a failing section')
    assert.match(
      await page.$eval('.view-crash', (el) => el.textContent),
      /could not be displayed/
    )
    assert.match(
      await page.$eval('.view-crash-detail', (el) => el.textContent),
      /selecting is not defined/
    )

    // Лог — про форму ошибки, без содержимого экрана
    assert.ok(
      logged.some((line) => line.includes('section failed to render')),
      `expected a redacted crash log, got: ${logged.join(' | ')}`
    )

    // «Try again» действительно восстанавливает раздел
    await page.click('#repair')
    await page.click('.view-crash .primary-button')
    await page.waitForSelector('#section-ok')
    assert.equal(await page.$('.view-crash'), null)
    await page.close()
  })

  it('resets itself when the owner opens another section', async () => {
    const page = await browser.newPage()
    page.on('console', () => {})
    await page.goto(`${appOrigin}/boundary`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.view-crash')
    await page.click('#other')
    await page.waitForSelector('#other-section')
    assert.equal(await page.$('.view-crash'), null)
    await page.close()
  })
})

describe('tabs keyboard behaviour', { skip }, () => {
  /**
   * Раньше `role="tablist"` был обещанием без исполнения: стрелки не
   * двигали ничего, а Tab прогонял по всем вкладкам подряд. Проверяем в
   * настоящем браузере — это поведение фокуса, его не видно в разметке.
   */
  const open = async (dir = 'ltr') => {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    await page.evaluateOnNewDocument((d) => { window.__DIR__ = d }, dir)
    await page.goto(`${appOrigin}/tabs`, { waitUntil: 'networkidle0' })
    return page
  }
  const state = (page) => page.evaluate(() => ({
    current: document.getElementById('current').textContent,
    active: document.activeElement?.textContent ?? '',
    entries: [...document.querySelectorAll('[role="tab"]')]
      .filter((t) => t.tabIndex === 0).map((t) => t.textContent),
  }))

  it('в группу ведёт один Tab, дальше двигают стрелки', async () => {
    const page = await open()
    await page.focus('#before')
    await page.keyboard.press('Tab')
    assert.equal((await state(page)).active, 'Items', 'Tab заводит на активную вкладку')

    await page.keyboard.press('ArrowRight')
    let now = await state(page)
    assert.equal(now.current, 'modifiers')
    assert.equal(now.active, 'Modifiers')
    assert.deepEqual(now.entries, ['Modifiers'], 'точка входа переезжает на выбранную')

    await page.keyboard.press('End')
    assert.equal((await state(page)).current, 'stations')
    await page.keyboard.press('ArrowRight')
    assert.equal((await state(page)).current, 'items', 'с последней вправо — на первую')
    await page.keyboard.press('Home')
    assert.equal((await state(page)).current, 'items')

    // Следующий Tab уводит из группы, а не по остальным вкладкам
    await page.keyboard.press('Tab')
    assert.notEqual((await state(page)).active, 'Modifiers')
    await page.close()
  })

  it('в RTL стрелка вправо ведёт к предыдущей вкладке', async () => {
    const page = await open('rtl')
    await page.focus('#before')
    await page.keyboard.press('Tab')
    await page.keyboard.press('ArrowRight')
    assert.equal((await state(page)).current, 'stations', 'вправо в RTL — это назад')
    await page.keyboard.press('ArrowLeft')
    assert.equal((await state(page)).current, 'items')
    await page.close()
  })

  it('фокус с клавиатуры видно, а от мыши подсветки нет', async () => {
    const page = await open()
    const ring = (sel) => page.evaluate((s) => {
      const el = document.querySelector(s)
      const cs = getComputedStyle(el)
      return { width: cs.outlineWidth, style: cs.outlineStyle }
    }, sel)

    await page.focus('#before')
    await page.keyboard.press('Tab')
    const keyboard = await ring('[role="tab"][tabindex="0"]')
    assert.notEqual(keyboard.style, 'none', 'клавиатурный фокус обязан быть виден')
    assert.notEqual(keyboard.width, '0px')

    await page.mouse.click(10, 10) // сбросить фокус
    await page.click('#before')
    const mouse = await ring('#before')
    assert.equal(mouse.style, 'none', 'клик мышью не рисует рамку')
    await page.close()
  })
})

describe('guest preview iframe', { skip }, () => {
  const sizes = [
    { name: 'desktop', viewport: { width: 1440, height: 900 } },
    { name: '390x844', viewport: { width: 390, height: 844 } },
  ]

  for (const { name, viewport } of sizes) {
    it(`does not scroll or focus the parent page at ${name}`, async () => {
      const page = await browser.newPage()
      await page.setViewport(viewport)
      await page.evaluateOnNewDocument((origin) => { window.__GUEST__ = origin }, `${guestOrigin}/`)
      await page.goto(`${appOrigin}/preview`, { waitUntil: 'networkidle0' })

      await page.focus('#settings')
      const before = await page.evaluate(() => window.scrollY)
      assert.equal(before, 0, 'the section must open at the top')

      // Кадр вообще не должен подниматься, пока панель не показалась
      assert.equal(await page.$('iframe'), null, 'preview must not load above the fold')

      const anchor = await scrollToPreview(page)
      await page.waitForSelector('iframe')
      // Ждём и загрузку, и попытки чужой страницы утащить фокус
      await new Promise((resolve) => setTimeout(resolve, 2200))

      const state = await page.evaluate(() => ({
        activeTag: document.activeElement?.tagName ?? null,
        activeId: document.activeElement?.id ?? '',
        scrollY: window.scrollY,
        tabIndex: document.querySelector('iframe')?.getAttribute('tabindex'),
        noSideScroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      }))

      assert.notEqual(state.activeTag, 'IFRAME', 'the preview must not steal focus')
      assert.equal(state.activeId, 'settings', 'focus returns where the owner left it')
      assert.equal(state.scrollY, anchor, 'the preview must not move the page under it')
      assert.equal(state.tabIndex, '-1', 'the preview stays out of the tab order')
      assert.ok(state.noSideScroll, 'the page must not overflow horizontally')
      await page.close()
    })
  }

  it('refreshing the preview keeps the page still and the focus on the button', async () => {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    await page.evaluateOnNewDocument((origin) => { window.__GUEST__ = origin }, `${guestOrigin}/`)
    await page.goto(`${appOrigin}/preview`, { waitUntil: 'networkidle0' })
    await scrollToPreview(page)
    await page.waitForSelector('iframe')
    await new Promise((resolve) => setTimeout(resolve, 1200))

    const at = await page.evaluate(() => window.scrollY)
    await page.evaluate(() => {
      const refresh = [...document.querySelectorAll('.guest-preview-actions button')]
        .find((b) => b.textContent.includes('Refresh'))
      refresh.click()
    })
    await new Promise((resolve) => setTimeout(resolve, 2200))

    const after = await page.evaluate(() => ({
      scrollY: window.scrollY,
      activeText: document.activeElement?.textContent ?? '',
      activeTag: document.activeElement?.tagName ?? '',
    }))
    assert.equal(after.scrollY, at, 'refresh must not move the parent page')
    assert.match(after.activeText, /Refresh/, 'focus returns to the control that was used')
    await page.close()
  })

  it('lets a keyboard user enter the preview on purpose', async () => {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    await page.evaluateOnNewDocument((origin) => { window.__GUEST__ = origin }, `${guestOrigin}/`)
    await page.goto(`${appOrigin}/preview`, { waitUntil: 'networkidle0' })
    await scrollToPreview(page)
    await page.waitForSelector('iframe')
    await new Promise((resolve) => setTimeout(resolve, 1200))

    await page.evaluate(() => {
      const enter = [...document.querySelectorAll('.guest-preview-actions button')]
        .find((b) => b.textContent.includes('Enter preview'))
      enter.click()
    })
    await new Promise((resolve) => setTimeout(resolve, 200))
    const entered = await page.evaluate(() => ({
      activeTag: document.activeElement?.tagName ?? '',
      tabIndex: document.querySelector('iframe')?.getAttribute('tabindex'),
    }))
    assert.equal(entered.activeTag, 'IFRAME')
    assert.equal(entered.tabIndex, '0')
    await page.close()
  })
})
