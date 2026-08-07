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

/**
 * Заглушка Supabase для браузерных наборов: данные подставляются в
 * память, сети нет. Нужна дашборду — его виджеты существуют только в
 * загруженном состоянии, а оно не проверяется рендером в node.
 */
const SUPABASE_STUB = `
  const FLEET = [
    { id: 'd1', name: 'Стойка 1', location_id: 'loc-1', location_name: 'Пинскер 29',
      app_version: '1.5.0', silence_seconds: 60, outbox_pending: 0, outbox_failed: 0, archived_at: null },
    { id: 'd2', name: 'Стойка 2', location_id: 'loc-1', location_name: 'Пинскер 29',
      app_version: '1.3.0', silence_seconds: 9000, outbox_pending: 0, outbox_failed: 0, archived_at: null },
  ]
  const ORDERS = [{ id: 'o1', location_id: 'loc-1', status: 'new', created_at: new Date(Date.now() - 900000).toISOString(),
    total: 7400, order_type: 'pickup', source: 'counter_qr', customer_name: 'Мири', items: [] }]
  const RESERVATIONS = [{ id: 'r1', status: 'new', customer_name: 'Мири Леви', party_size: 2,
    reserved_at: new Date(Date.now() + 3600000).toISOString(), table_id: null, is_test: false }]
  const TODAY = new Date().toISOString().slice(0, 10)
  const WAITLIST = [
    { id: 'w1', customer_name: 'Первый', customer_phone: '', party_size: 2, wanted_date: TODAY,
      status: 'waiting', position: null, quoted_min: 20, zone_ids: [],
      created_at: new Date(Date.now() - 30 * 60000).toISOString() },
    { id: 'w2', customer_name: 'Второй', customer_phone: '', party_size: 4, wanted_date: TODAY,
      status: 'waiting', position: null, quoted_min: 25, zone_ids: [],
      created_at: new Date(Date.now() - 10 * 60000).toISOString() },
  ]
  const LOCATION = { id: 'loc-1', name: 'Пинскер 29', timezone: 'Asia/Jerusalem', currency: 'ILS',
    settings: { online_orders: { enabled: true }, reservations: { enabled: false } } }
  // Отчёт за сутки. Дашборд просит два: сегодня и вчера — сравнение по
  // часам обязано считаться от РАЗНЫХ дней, поэтому день различаем по
  // p_from, а не отдаём один и тот же ряд дважды.
  const salesDay = (args) => {
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0)
    const yesterday = args?.p_from && new Date(args.p_from).getTime() < midnight.getTime()
    const hour = new Date().getHours()
    const at = (h) => Math.max(0, Math.min(23, h))
    return yesterday
      ? { summary: { gross_sales: 100000, refunds: 0, orders_count: 10, avg_check: 10000 },
          by_hour: [{ hour: at(hour - 2), amount: 60000, count: 6 }] }
      : { summary: { gross_sales: 128000, refunds: 0, orders_count: 12, avg_check: 10667 },
          by_hour: [{ hour: at(hour - 2), amount: 90000, count: 9 }, { hour, amount: 38000, count: 3 }] }
  }
  const RPC = {
    sales_report: salesDay,
    get_backoffice_fleet: () => FLEET,
    // Длинные подписи нарочно: строка обязана сжиматься, а не растягивать
    // страницу (регресс Phase 0 — горизонтальная прокрутка на 390px).
    get_activity_feed: () => [{
      id: 'a1', type: 'shift_closed', created_at: new Date().toISOString(), amount: 812300,
      staff_name: 'Александра Константинопольская', location_name: 'Пинскер 29, Петах-Тиква',
      device_name: 'Стойка у входа', detail: { difference: -1200 },
    }],
  }
  export const isSupabaseConfigured = true
  export const supabase = {
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    rpc: async (name, args) => {
      // Управляемый отказ одного источника: дашборд обязан пережить его
      if (name === 'sales_report' && window.__BREAK_SALES__) {
        return { data: null, error: { message: 'sales are unavailable' } }
      }
      // Сервер отказывает по занятости — форма обязана предложить выход
      if (name === 'create_reservation_web') {
        return { data: null, error: { message: 'table_busy' } }
      }
      // Перестановку очереди запоминаем: тест проверяет, что клавиша
      // дошла до кнопки, а не открыла карточку
      if (name === 'reorder_waitlist_web') {
        window.__REORDERED__ = (window.__REORDERED__ || []).concat([args?.p_ids])
        return { data: 2, error: null }
      }
      return { data: RPC[name] ? RPC[name](args) : null, error: null }
    },
    from: (table) => {
      const rows = table === 'waitlist_entries' ? WAITLIST
        : table === 'online_orders' ? ORDERS
        : table === 'reservations' ? RESERVATIONS
        : table === 'shifts' ? (window.__SHIFTS__ || [])
        : table === 'locations' ? [LOCATION]
        : table === 'location_slugs' ? [{ slug: 'bulochka' }] : []
      const chain = new Proxy({}, { get(_t, prop) {
        if (prop === 'then') return (resolve) => resolve({ data: rows, error: null })
        if (prop === 'single' || prop === 'maybeSingle') return () => ({ then: (r) => r({ data: rows[0] ?? null, error: null }) })
        return () => chain
      } })
      return chain
    },
    channel: () => { const c = { on: () => c, subscribe: () => c, unsubscribe() {} }; return c },
    removeChannel: () => {},
  }
`

const supabaseStub = {
  name: 'supabase-stub',
  setup(build) {
    build.onResolve({ filter: /^\.\/supabase$/ }, () => ({ path: 'supabase-stub', namespace: 'stub' }))
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: SUPABASE_STUB, loader: 'js' }))
  },
}

async function bundle(name, contents, { stubSupabase = false } = {}) {
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
    plugins: stubSupabase ? [supabaseStub] : [],
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

  await bundle('shell', `
    import { useState } from 'react'
    import { createRoot } from 'react-dom/client'
    import AppShell from './ui/AppShell'

    const nav = {
      primary: [{ id: 'overview', label: 'Dashboard' }],
      groups: [
        { id: 'work', label: 'Work', items: [
          { id: 'orders', label: 'Orders' }, { id: 'reservations', label: 'Reservations' },
        ] },
        { id: 'insights', label: 'Insights', items: [
          { id: 'sales', label: 'Sales' }, { id: 'activity', label: 'Activity' },
          { id: 'guests', label: 'Customers' }, { id: 'reports', label: 'Reports' },
        ] },
        { id: 'manage', label: 'Manage', items: [
          { id: 'menu', label: 'Catalogue' }, { id: 'locations', label: 'Locations' },
          { id: 'team', label: 'Team' },
        ] },
        { id: 'channels', label: 'Channels', items: [
          { id: 'online', label: 'QR Menu & Online' }, { id: 'integrations', label: 'Integrations' },
        ] },
        { id: 'system', label: 'System', items: [{ id: 'devices', label: 'Devices' }] },
      ],
    }

    function Page() {
      const [view, setView] = useState('overview')
      // Счётчик монтирований оболочки: она обязана пережить смену раздела
      window.__SHELL_MOUNTS__ = (window.__SHELL_MOUNTS__ || 0)
      return (
        <AppShell
          nav={nav}
          icons={{}}
          view={view}
          onNavigate={setView}
          email="owner@example.com"
          onSignOut={() => {}}
          onHelp={() => {}}
          organization="Bulochka"
          role="owner"
          locations={[{ id: 'a', name: 'Пинскер 29' }, { id: 'b', name: 'Ротшильд 12' }]}
          locationId="a"
          onLocationChange={() => {}}
          scoped
        >
          <p id="view">{view}</p>
          <div className="tall">content</div>
        </AppShell>
      )
    }
    createRoot(document.getElementById('root')).render(<Page />)
  `)

  await bundle('dashboard', `
    import { createRoot } from 'react-dom/client'
    import HomeDashboard from './HomeDashboard'
    import { ActivityCard } from './ActivityManager'

    const POS = ['pos_operate', 'pos_reports', 'orders_desk', 'reservations_desk',
      'online_orders', 'public_reservations', 'public_menu']
    const context = {
      organization: { id: 'org-1', name: 'Bulochka' },
      member: { role: 'owner' },
      capabilities: window.__CAPS__ || POS,
      locations: [{ id: 'loc-1', name: 'Пинскер 29', timezone: 'Asia/Jerusalem', currency: 'ILS' }],
    }
    createRoot(document.getElementById('root')).render(
      <main className="content">
        {/* Как на главной: журнал приходит в children — «что только что
            произошло» стоит последним, под сводкой дня, и только у
            аккаунта с кассой. */}
        <HomeDashboard context={context} locationId="loc-1" onNavigate={(view, loc, tab) => {
          window.__NAV__ = { view, tab }
        }}>
          {context.capabilities.includes('pos_operate') && <ActivityCard onNavigate={() => {}} />}
        </HomeDashboard>
      </main>
    )
  `, { stubSupabase: true })

  await bundle('activity-card', `
    import { createRoot } from 'react-dom/client'
    import { ActivityCard } from './ActivityManager'
    createRoot(document.getElementById('root')).render(
      <main className="content"><ActivityCard onNavigate={() => {}} /></main>
    )
  `, { stubSupabase: true })

  await bundle('drawer', `
    import { useState } from 'react'
    import { createRoot } from 'react-dom/client'
    import Drawer from './ui/Drawer'
    import { Button } from './ui/Button'

    function Page() {
      const [open, setOpen] = useState(false)
      return (
        <main className="content">
          <button id="opener" className="secondary-button" onClick={() => setOpen(true)}>
            Open the visit
          </button>
          <button id="behind" className="secondary-button">behind the drawer</button>
          <div className="tall">page content</div>
          {open && (
            <Drawer
              title="Мири Леви"
              subtitle="Sun 2 Aug 19:00 · 2 guests"
              onClose={() => setOpen(false)}
              footer={<Button onClick={() => setOpen(false)}>Close</Button>}
            >
              <input id="field-a" aria-label="Guest name" />
              <input id="field-b" aria-label="Phone" />
            </Drawer>
          )}
        </main>
      )
    }
    createRoot(document.getElementById('root')).render(<Page />)
  `)

  await bundle('layers', `
    import { useState } from 'react'
    import { createRoot } from 'react-dom/client'
    import Drawer from './ui/Drawer'
    import ConfirmDialog from './ui/ConfirmDialog'
    import { Button } from './ui/Button'

    /** Панель визита с диалогом отмены поверх — два слоя сразу */
    function Page() {
      const [open, setOpen] = useState(true)
      const [asking, setAsking] = useState(false)
      const [cancelled, setCancelled] = useState(false)
      return (
        <main className="content">
          <button id="opener" className="secondary-button" onClick={() => setOpen(true)}>
            Open the visit
          </button>
          {cancelled && <p id="did-cancel">cancelled</p>}
          {open && (
            <Drawer
              title="Мири Леви"
              subtitle="Sun 2 Aug 19:00 · 2 guests"
              onClose={() => setOpen(false)}
              footer={<Button onClick={() => setOpen(false)}>Close</Button>}
            >
              <input id="field-a" aria-label="Guest name" />
              <button id="ask" className="secondary-button" onClick={() => setAsking(true)}>
                Cancel booking
              </button>
              {asking && (
                <ConfirmDialog
                  title="Cancel this booking?"
                  description="The table is freed immediately."
                  confirmLabel="Cancel booking"
                  cancelLabel="Keep the booking"
                  tone="danger"
                  reason={{ label: 'Reason for the guest' }}
                  onCancel={() => setAsking(false)}
                  onConfirm={() => { setAsking(false); setCancelled(true) }}
                />
              )}
            </Drawer>
          )}
        </main>
      )
    }
    createRoot(document.getElementById('root')).render(<Page />)
  `)

  await bundle('waitlist', `
    import { createRoot } from 'react-dom/client'
    import WaitlistPanel from './WaitlistPanel'

    createRoot(document.getElementById('root')).render(
      <main className="content">
        <WaitlistPanel locationId="loc-1" date={new Date().toISOString().slice(0, 10)} />
      </main>
    )
  `, { stubSupabase: true })

  await bundle('booking-conflict', `
    import { createRoot } from 'react-dom/client'
    import BookingForm from './BookingForm'

    const tables = [
      { id: 't1', label: '1', seats: 2, blocked: false, zoneId: 'z1', zoneName: 'Зал' },
      { id: 't2', label: '2', seats: 4, blocked: false, zoneId: 'z1', zoneName: 'Зал' },
    ]
    // Стол 1 занят на 19:00, стол 2 свободен — значит вариант есть
    const bookings = [{
      id: 'b1', status: 'confirmed', table_id: 't1', duration_min: 90,
      reserved_at: new Date(new Date().setHours(19, 0, 0, 0)).toISOString(),
    }]
    createRoot(document.getElementById('root')).render(
      <main className="content">
        <BookingForm
          locationId="loc-1"
          tables={tables}
          bookings={bookings}
          tz="Asia/Jerusalem"
          mode="booking"
          onClose={() => {}}
          onCreated={() => {}}
        />
      </main>
    )
  `, { stubSupabase: true })

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

describe('dashboard', { skip }, () => {
  /**
   * Виджеты дашборда существуют только в ЗАГРУЖЕННОМ состоянии: в
   * серверном рендере эффекты не выполняются, и проверить нечего.
   * Поэтому здесь настоящий браузер и подставной Supabase.
   */
  const open = async (caps = null) => {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    await page.evaluateOnNewDocument((c) => { window.__CAPS__ = c }, caps)
    await page.goto(`${appOrigin}/dashboard`, { waitUntil: 'networkidle0' })
    // Сетка появляется вместе с данными: до неё виджетов не существует
    await page.waitForSelector('.dash-grid')
    return page
  }

  const read = () => ({
    hero: document.querySelector('.dash-today-label')?.textContent ?? null,
    value: document.querySelector('.dash-today-value')?.textContent ?? null,
    strip: document.querySelector('.dash-today-strip')?.textContent ?? null,
    bars: document.querySelectorAll('.dash-curve-bar').length,
    compare: document.querySelector('.dash-curve-line .stat-delta')?.textContent?.trim() ?? null,
    hour: new Date().getHours(),
    attention: [...document.querySelectorAll('.dash-attention-text strong')].map((e) => e.textContent),
    panels: [...document.querySelectorAll('.panel-heading h2')].map((e) => e.textContent),
    partial: document.querySelector('.dash-partial')?.textContent ?? null,
    money: /₪/.test(document.body.textContent),
  })

  it('день открывается выручкой, кривой и тем, что требует решения', async () => {
    const page = await open()
    const state = await page.evaluate(read)

    assert.equal(state.hero, 'Net sales')
    assert.match(state.value, /1,280/, 'чистая выручка = продажи минус возвраты')
    assert.match(state.strip, /12 orders/)
    assert.match(state.strip, /shift closed/, 'открытых смен в фикстуре нет')
    assert.ok(state.bars > 0, 'день показан кривой, а не одним числом')
    // Сравнение считается по ПОЛНЫМ часам, поэтому до первого закрытого
    // часа его нет — и это единственный случай, когда строки нет.
    if (state.hour > 0) {
      assert.equal(state.compare, '+50%', 'сегодня 900 против 600 вчера на тот же час')
    }

    // Порядок «требует внимания» — по стоимости бездействия
    assert.match(state.attention[0], /Стойка 2 is not reporting/)
    assert.match(state.attention[1], /order is waiting/)
    assert.ok(state.attention.some((t) => /booking request is waiting/.test(t)))
    assert.ok(state.attention.some((t) => /Table booking is off/.test(t)))

    // Панели живой работы — без описаний под заголовком, журнал последним
    assert.deepEqual(state.panels, ['Orders', 'Reservations', 'Devices', 'Online channels', 'Recent activity'])

    // Кнопка пункта ведёт в свой раздел, а выключенный канал — в свою вкладку
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.dash-attention-row')]
        .find((r) => /Table booking is off/.test(r.textContent))
      row.querySelector('button').click()
    })
    assert.deepEqual(await page.evaluate(() => window.__NAV__), { view: 'online', tab: 'reservations' })
    await page.close()
  })

  it('reserve-клиенту не показывают ни выручки, ни касс, ни заказов', async () => {
    const page = await open(['reservations_desk', 'public_reservations'])
    const state = await page.evaluate(read)
    assert.equal(state.hero, 'Bookings today')
    assert.equal(state.bars, 0, 'кривая продаж — только там, где есть продажи')
    assert.ok(!state.money, 'ни одной денежной суммы на экране без кассы')
    assert.ok(!state.panels.includes('Orders'))
    assert.ok(!state.panels.includes('Devices'))
    assert.ok(!state.attention.some((t) => /reporting|order is waiting/.test(t)))
    await page.close()
  })

  it('menu-клиенту не показывают блок дня: мерить ему нечем', async () => {
    const page = await open(['public_menu'])
    const state = await page.evaluate(read)
    assert.equal(state.hero, null, 'выдуманный ноль хуже отсутствующего блока')
    assert.ok(state.panels.includes('Online channels'))
    await page.close()
  })

  it('частичный отказ не уносит остальные виджеты', async () => {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    // Ломаем один источник: отчёт по продажам
    await page.evaluateOnNewDocument(() => {
      window.__BREAK_SALES__ = true
    })
    await page.goto(`${appOrigin}/dashboard`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.dash-grid')
    const state = await page.evaluate(read)
    assert.ok(state.panels.includes('Reservations'), 'остальные виджеты обязаны остаться')
    assert.match(state.value, /—/, 'упавший показатель честно пуст, а не нулевой')
    assert.equal(state.bars, 0)
    assert.ok(
      !/No sales yet today/.test(await page.evaluate(() => document.body.textContent)),
      'про упавший отчёт нельзя говорить «продаж не было»'
    )
    assert.match(state.partial, /could not be loaded/, 'отказ назван, а не спрятан')
    assert.ok(state.attention.length > 0, 'список внимания продолжает работать')
    await page.close()
  })
})

describe('конфликт брони', { skip }, () => {
  /**
   * Приёмка Phase 4 нашла ровно это: после выбора свободного стола или
   * времени сообщение «That table is taken…» оставалось на экране и
   * противоречило тому, что в форме уже выбрано другое.
   */
  const openForm = async () => {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    await page.goto(`${appOrigin}/booking-conflict`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.drawer')
    await page.type('input[required]', 'Мири')
    await page.evaluate(() => {
      document.querySelector('button[type="submit"]').click()
    })
    await page.waitForSelector('.conflict-hint')
    return page
  }

  it('отказ сервера объясняется вариантами', async () => {
    const page = await openForm()
    const state = await page.evaluate(() => ({
      error: document.querySelector('.form-error')?.textContent ?? null,
      options: [...document.querySelectorAll('.conflict-options button')].map((b) => b.textContent),
      // Введённое не должно потеряться
      name: document.querySelector('input[required]').value,
    }))
    assert.match(state.error, /taken|free table/i)
    assert.ok(state.options.length > 0, 'должен быть хотя бы один вариант')
    assert.equal(state.name, 'Мири')
    await page.close()
  })

  it('выбор варианта убирает устаревшее сообщение', async () => {
    const page = await openForm()
    await page.evaluate(() => {
      document.querySelector('.conflict-options button').click()
    })
    await new Promise((resolve) => setTimeout(resolve, 200))
    const after = await page.evaluate(() => ({
      error: document.querySelector('.form-error')?.textContent ?? null,
      hint: document.querySelector('.conflict-hint'),
      name: document.querySelector('input[required]').value,
    }))
    assert.equal(after.error, null, 'сообщение про занятый стол обязано исчезнуть')
    assert.equal(after.hint, null)
    assert.equal(after.name, 'Мири', 'введённое остаётся')
    await page.close()
  })

  it('правка времени тоже снимает старый отказ', async () => {
    const page = await openForm()
    await page.evaluate(() => {
      const input = document.querySelector('input[type="datetime-local"]')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, '2026-08-03T20:30')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await new Promise((resolve) => setTimeout(resolve, 200))
    assert.equal(
      await page.evaluate(() => document.querySelector('.form-error')?.textContent ?? null),
      null,
    )
    await page.close()
  })
})

describe('боковая панель', { skip }, () => {
  /**
   * Панель деталей должна вести себя как диалог: Escape закрывает, Tab
   * не уводит на фон, фокус возвращается туда, откуда открыли. Ни один
   * из самодельных листов кабинета этого не делал.
   */
  const openDrawer = async () => {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    await page.goto(`${appOrigin}/drawer`, { waitUntil: 'networkidle0' })
    await page.click('#opener')
    await page.waitForSelector('.drawer')
    return page
  }

  it('объявляется диалогом и забирает фокус себе', async () => {
    const page = await openDrawer()
    const state = await page.evaluate(() => {
      const drawer = document.querySelector('.drawer')
      return {
        role: drawer.getAttribute('role'),
        modal: drawer.getAttribute('aria-modal'),
        named: document.getElementById(drawer.getAttribute('aria-labelledby'))?.textContent,
        active: document.activeElement === drawer,
      }
    })
    assert.equal(state.role, 'dialog')
    assert.equal(state.modal, 'true')
    assert.match(state.named, /Мири Леви/)
    assert.ok(state.active, 'фокус должен войти в панель')
    await page.close()
  })

  it('Tab не выходит за панель', async () => {
    const page = await openDrawer()
    const seen = []
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab')
      seen.push(await page.evaluate(() => {
        const el = document.activeElement
        return { id: el.id || el.getAttribute('aria-label') || el.tagName, inside: Boolean(el.closest('.drawer')) }
      }))
    }
    assert.ok(seen.every((s) => s.inside), `фокус ушёл наружу: ${JSON.stringify(seen)}`)
    await page.close()
  })

  it('Escape закрывает и возвращает фокус на кнопку', async () => {
    const page = await openDrawer()
    await page.keyboard.press('Escape')
    await new Promise((resolve) => setTimeout(resolve, 200))
    const after = await page.evaluate(() => ({
      open: Boolean(document.querySelector('.drawer')),
      active: document.activeElement?.id,
      scrollLocked: document.body.style.overflow === 'hidden',
    }))
    assert.equal(after.open, false)
    assert.equal(after.active, 'opener')
    assert.equal(after.scrollLocked, false)
    await page.close()
  })
})

describe('списки не растягивают страницу', { skip }, () => {
  /**
   * Строка журнала на 390px вылезала за панель на 9px и давала
   * горизонтальную прокрутку всей странице: элемент grid по умолчанию не
   * уже своего max-content. Проверяем на нарочно длинных подписях.
   */
  it('строка журнала сжимается, а не выталкивает страницу', async () => {
    const page = await browser.newPage()
    await page.setViewport({ width: 390, height: 844 })
    await page.goto(`${appOrigin}/activity-card`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.activity-row')
    const state = await page.evaluate(() => {
      const row = document.querySelector('.activity-row')
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        wider: Math.round(row.getBoundingClientRect().width
          - row.parentElement.getBoundingClientRect().width),
      }
    })
    assert.equal(state.overflow, 0, 'страница не должна прокручиваться вбок')
    assert.ok(state.wider <= 0, `строка шире контейнера на ${state.wider}px`)
    await page.close()
  })
})

describe('mobile navigation drawer', { skip }, () => {
  /**
   * Шторка на 390×844 — единственный вход в разделы на телефоне. Phase 0
   * зафиксировал, что «Integrations» и «Devices» остаются ниже сгиба и
   * подсказки о продолжении списка нет. Здесь проверяется, что все
   * пункты достижимы, край подсказывает прокрутку, а фокус ведёт себя
   * как у любого оверлея.
   */
  const openDrawer = async () => {
    const page = await browser.newPage()
    await page.setViewport({ width: 390, height: 844 })
    await page.goto(`${appOrigin}/shell`, { waitUntil: 'networkidle0' })
    await page.click('.mobile-menu')
    // Ждём открытое состояние, а не отмеренную паузу: под нагрузкой
    // фиксированные 400 мс истекали раньше, чем шторка успевала открыться
    // и забрать фокус, и проверка падала на ровном месте
    await page.waitForFunction(() => (
      document.querySelector('.sidebar')?.classList.contains('is-open')
      && document.activeElement?.getAttribute('aria-label') === 'Close navigation'
    ))
    return page
  }

  it('все разделы достижимы, а край подсказывает прокрутку', async () => {
    const page = await openDrawer()
    const before = await page.evaluate(() => {
      const nav = document.querySelector('.side-nav')
      const items = [...nav.querySelectorAll('button')]
      return {
        scrollable: nav.scrollHeight > nav.clientHeight,
        hasEdgeHint: getComputedStyle(nav).backgroundImage.includes('radial-gradient'),
        hidden: items.filter((b) => b.getBoundingClientRect().bottom > window.innerHeight).length,
        total: items.length,
      }
    })
    assert.ok(before.scrollable, 'список длиннее экрана — иначе проверять нечего')
    assert.ok(before.hasEdgeHint, 'у прокручиваемого списка должна быть подсказка края')
    assert.ok(before.hidden > 0, 'часть пунктов ниже сгиба — исходное состояние')

    // Прокрутка внутри списка доводит до последнего раздела
    const reached = await page.evaluate(() => {
      const nav = document.querySelector('.side-nav')
      nav.scrollTop = nav.scrollHeight
      const last = [...nav.querySelectorAll('button')].pop()
      return {
        label: last.textContent.trim(),
        visible: last.getBoundingClientRect().bottom <= window.innerHeight,
      }
    })
    assert.equal(reached.label, 'Devices')
    assert.ok(reached.visible, 'последний раздел должен доезжать до видимой области')

    // Футер аккаунта не перекрывает список
    const overlap = await page.evaluate(() => {
      const nav = document.querySelector('.side-nav').getBoundingClientRect()
      const foot = document.querySelector('.sidebar-bottom').getBoundingClientRect()
      return nav.bottom - foot.top
    })
    assert.ok(overlap <= 1, `футер не должен наезжать на список (перекрытие ${overlap}px)`)
    await page.close()
  })

  it('Escape закрывает шторку и возвращает фокус на бургер', async () => {
    const page = await openDrawer()
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
      'Close navigation',
      'открытие уводит фокус в шторку'
    )
    await page.keyboard.press('Escape')
    await new Promise((resolve) => setTimeout(resolve, 300))
    const after = await page.evaluate(() => ({
      open: document.querySelector('.sidebar').classList.contains('is-open'),
      active: document.activeElement?.getAttribute('aria-label'),
      expanded: document.querySelector('.mobile-menu').getAttribute('aria-expanded'),
      bodyLocked: document.body.style.overflow === 'hidden',
    }))
    assert.equal(after.open, false)
    assert.equal(after.active, 'Open navigation', 'фокус возвращается туда, откуда пришёл')
    assert.equal(after.expanded, 'false')
    assert.equal(after.bodyLocked, false, 'страница снова прокручивается')
    await page.close()
  })

  it('переход по пункту закрывает шторку, а оболочка не перемонтируется', async () => {
    const page = await openDrawer()
    await page.evaluate(() => {
      // Метка на живом узле: если оболочка перемонтируется, она пропадёт
      document.querySelector('.sidebar').dataset.marker = 'kept'
    })
    await page.evaluate(() => {
      [...document.querySelectorAll('.side-nav button')]
        .find((b) => b.textContent.trim() === 'Catalogue').click()
    })
    await new Promise((resolve) => setTimeout(resolve, 300))
    const after = await page.evaluate(() => ({
      view: document.getElementById('view').textContent,
      open: document.querySelector('.sidebar').classList.contains('is-open'),
      marker: document.querySelector('.sidebar').dataset.marker,
      current: document.querySelector('[aria-current="page"]')?.textContent.trim(),
    }))
    assert.equal(after.view, 'menu')
    assert.equal(after.open, false)
    assert.equal(after.marker, 'kept', 'сайдбар не должен пересоздаваться при смене раздела')
    assert.equal(after.current, 'Catalogue', 'текущий раздел объявлен как aria-current')
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

describe('слои: панель и диалог поверх неё', { skip }, () => {
  /**
   * Escape закрывает ВЕРХНИЙ слой.
   *
   * Регресс, ради которого набор и написан: панель визита и диалог
   * отмены оба слушают клавиатуру на документе в фазе перехвата.
   * Обработчики вызываются в порядке регистрации, поэтому панель —
   * открытая первой — закрывалась раньше диалога, и хостес, передумав
   * отменять бронь, терял всю карточку вместе с несохранёнными правками.
   */
  const open = async () => {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    await page.goto(`${appOrigin}/layers`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.drawer')
    await page.click('#ask')
    await page.waitForSelector('.confirm-dialog')
    return page
  }

  it('Escape закрывает диалог, а панель визита остаётся открытой', async () => {
    const page = await open()
    await page.keyboard.press('Escape')
    await new Promise((resolve) => setTimeout(resolve, 150))
    const state = await page.evaluate(() => ({
      dialogs: document.querySelectorAll('.confirm-dialog').length,
      drawers: document.querySelectorAll('.drawer').length,
      cancelled: !!document.getElementById('did-cancel'),
    }))
    assert.equal(state.dialogs, 0, 'диалог закрылся')
    assert.equal(state.drawers, 1, 'панель осталась')
    // Отказ от диалога не должен ничего выполнять
    assert.equal(state.cancelled, false)
    await page.close()
  })

  it('второй Escape закрывает уже панель', async () => {
    const page = await open()
    await page.keyboard.press('Escape')
    await new Promise((resolve) => setTimeout(resolve, 150))
    await page.keyboard.press('Escape')
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.equal(await page.evaluate(() => document.querySelectorAll('.drawer').length), 0)
    await page.close()
  })

  it('пока диалог открыт, Tab не уводит в панель под ним', async () => {
    const page = await open()
    for (let i = 0; i < 6; i += 1) await page.keyboard.press('Tab')
    const inside = await page.evaluate(
      () => !!document.querySelector('.confirm-dialog')?.contains(document.activeElement)
    )
    assert.equal(inside, true)
    await page.close()
  })
})


describe('очередь ожидания: клавиатура', { skip }, () => {
  /**
   * Регресс живой приёмки: строка очереди была `role="button"` с
   * tabIndex, а внутри стояли кнопки перестановки. Enter на стрелке
   * всплывал до строки — вместо перемещения открывалась карточка гостя,
   * и двигать очередь с клавиатуры было нельзя вообще.
   *
   * Проверяется поведение, а не разметка: нажатие Enter на стрелке
   * переставляет очередь и НЕ открывает карточку.
   */
  const open = async () => {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    await page.goto(`${appOrigin}/waitlist`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.rsv-row')
    return page
  }

  it('Enter на стрелке двигает очередь, а не открывает карточку', async () => {
    const page = await open()
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')]
        .find((b) => (b.getAttribute('aria-label') || '').startsWith('Move Второй up'))
      button.focus()
    })
    await page.keyboard.press('Enter')
    await new Promise((resolve) => setTimeout(resolve, 300))

    const state = await page.evaluate(() => ({
      reordered: window.__REORDERED__ || [],
      drawers: document.querySelectorAll('.drawer').length,
    }))
    assert.equal(state.drawers, 0, 'карточка гостя не открывается')
    assert.equal(state.reordered.length, 1, 'перестановка отправлена на сервер')
    assert.deepEqual(state.reordered[0], ['w2', 'w1'], 'гость поднялся на позицию выше')
    await page.close()
  })

  it('карточку открывает кнопка на имени — и с клавиатуры тоже', async () => {
    const page = await open()
    await page.evaluate(() => document.querySelector('.rsv-open').focus())
    await page.keyboard.press('Enter')
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(await page.evaluate(() => document.querySelectorAll('.drawer').length), 1)
    await page.close()
  })

  it('строка таблицы не притворяется кнопкой', async () => {
    // Вложенные интерактивные элементы — то, с чего дефект и начался
    const page = await open()
    const rows = await page.evaluate(() => [...document.querySelectorAll('.rsv-row')].map((r) => ({
      role: r.getAttribute('role'),
      tabIndex: r.getAttribute('tabindex'),
    })))
    assert.deepEqual(rows.map((r) => r.role).filter(Boolean), [])
    assert.deepEqual(rows.map((r) => r.tabIndex).filter(Boolean), [])
    await page.close()
  })
})

describe('клавиатура: путь до рабочей области', { skip }, () => {
  /**
   * Замер Phase 11: чтобы с клавиатуры дойти до содержимого, приходилось
   * нажать Tab 16–17 раз — логотип, тринадцать разделов, меню аккаунта, —
   * и так на КАЖДОМ экране, включая возврат из формы. Здесь проверяется,
   * что путь стал в два нажатия и что он ведёт именно в `main`.
   */
  const open = async () => {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    await page.goto(`${appOrigin}/shell`, { waitUntil: 'networkidle0' })
    await page.evaluate(() => document.body.focus())
    return page
  }

  it('первая же остановка — переход к содержимому, и он уводит фокус в main', async () => {
    const page = await open()
    await page.keyboard.press('Tab')
    const first = await page.evaluate(() => {
      const el = document.activeElement
      return { cls: el.className, text: el.textContent.trim(), href: el.getAttribute('href') }
    })
    assert.equal(first.cls, 'skip-link')
    assert.equal(first.text, 'Skip to content')
    assert.equal(first.href, '#app-content')

    await page.keyboard.press('Enter')
    const landed = await page.evaluate(() => {
      const el = document.activeElement
      return { id: el.id, tag: el.tagName }
    })
    assert.equal(landed.id, 'app-content', 'фокус обязан уйти в рабочую область, а не только прокрутка')
    assert.equal(landed.tag, 'MAIN')
    await page.close()
  })

  it('спрятана, пока не понадобится, и показывается по фокусу', async () => {
    // Видимая всегда — лишний элемент на каждом экране; невидимая
    // всегда — ловушка: нажал и не понял куда попал.
    const page = await open()
    const hidden = await page.evaluate(() => {
      const el = document.querySelector('.skip-link')
      return el.getBoundingClientRect().right < 0
    })
    assert.ok(hidden, 'до фокуса ссылка за краем экрана')

    await page.keyboard.press('Tab')
    const shown = await page.evaluate(() => {
      const r = document.querySelector('.skip-link').getBoundingClientRect()
      return { left: Math.round(r.left), height: Math.round(r.height) }
    })
    assert.equal(shown.left, 0, 'по фокусу ссылка приезжает в угол')
    assert.ok(shown.height >= 44, 'и остаётся целью под палец')
    await page.close()
  })

  it('смена раздела объявляется читалке — и только со второго раза', async () => {
    /*
     * Содержимое подменяется молча: с читалкой владелец не узнаёт, что
     * раздел сменился. Первый показ не объявляем — страницу читалка и
     * так только что прочитала, и второе «Dashboard» подряд это шум.
     */
    const page = await open()
    const atStart = await page.evaluate(() => (
      document.querySelector('[role="status"][aria-live="polite"]').textContent
    ))
    assert.equal(atStart, '', 'первый показ ничего не объявляет')

    await page.evaluate(() => {
      const items = [...document.querySelectorAll('.side-nav button')]
      items.find((b) => b.textContent.trim() === 'Catalogue').click()
    })
    await page.waitForFunction(() => (
      document.querySelector('[role="status"][aria-live="polite"]').textContent === 'Catalogue'
    ))
    await page.close()
  })
})
