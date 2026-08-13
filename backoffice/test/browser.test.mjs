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

const STYLES = [
  readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/responsive.css', import.meta.url), 'utf8'),
].join('\n')

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
  /*
   * `--force-prefers-reduced-motion` — не про доступность, а про
   * надёжность набора: слои теперь приезжают и уезжают, и клик по кнопке
   * внутри ещё не доехавшей панели уходит мимо (puppeteer честно
   * отвечает «node is not clickable»). Здесь проверяется поведение, а
   * само движение — отдельным набором, где анимация включена обратно.
   */
  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--force-prefers-reduced-motion'],
  })
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
    // Узнавание гостя (157): отвечает ТОЛЬКО на полный номер — тем же
    // правилом, что и сервер.
    lookup_guest_by_phone_web: (args) => {
      const digits = String((args && args.p_phone) || '').replace(/\D/g, '')
      if (digits !== '0521111111') return null
      return {
        guest_id: 'g1', name: 'Мири Леви', phone: digits,
        visits: 8, no_shows: 2, cancelled: 0, upcoming: 0,
        usual_party: 4, usual_zone: 'Терраса',
        note: 'Аллергия на орехи', segments: ['regular'],
      }
    },
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

  /*
   * Пропавший после деплоя чанк в НАСТОЯЩЕЙ границе ошибки. Счётчик
   * перезагрузок и хранилище подставлены, чтобы проверить главное
   * свойство — одна перезагрузка на сборку и никакой петли.
   */
  await bundle('stale-chunk', `
    import { useState } from 'react'
    import { createRoot } from 'react-dom/client'
    import ViewErrorBoundary from './ErrorBoundary'

    window.__RELOADS__ = 0
    const storage = {
      getItem: (k) => window.sessionStorage.getItem(k),
      setItem: (k, v) => window.sessionStorage.setItem(k, v),
    }
    /*
     * Документ стенда несёт ВСТРОЕННЫЙ модуль без src, а у выложенной
     * сборки входной скрипт хеширован. Подставляем такой же, иначе
     * стенд проверял бы случай «сборку опознать нечем», а не рабочий.
     */
    const doc = {
      querySelector: (sel) => (sel.includes('script')
        ? { getAttribute: () => (window.__BUILD__ || '/account/assets/index-test123.js') }
        : null),
    }

    function Section() {
      throw new Error(window.__ERR__ || 'Failed to fetch dynamically imported module: /account/assets/X-abc.js')
    }
    function App() {
      const [n, setN] = useState(0)
      return (
        <div>
          <nav id="chrome">navigation still here</nav>
          <button id="remount" onClick={() => setN((v) => v + 1)}>remount</button>
          <ViewErrorBoundary
            key={n}
            view="reservations"
            doc={doc}
            storage={storage}
            reload={() => { window.__RELOADS__ += 1 }}
            onHome={() => {}}
          >
            <Section />
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
    import { useEffect, useState } from 'react'
    import { createRoot } from 'react-dom/client'
    import Drawer from './ui/Drawer'
    import { Button } from './ui/Button'

    /**
     * Содержимое, приезжающее по сети уже после открытия: карточка
     * клиента ведёт себя именно так, и на ней было видно, как лист
     * дёргается, если высота считается по содержимому.
     */
    function Late() {
      const [ready, setReady] = useState(false)
      useEffect(() => {
        const timer = setTimeout(() => setReady(true), 120)
        return () => clearTimeout(timer)
      }, [])
      return ready ? <div className="tall">loaded</div> : <p>Loading…</p>
    }

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
              {location.hash.includes('tall') && <div className="tall">long form</div>}
              {location.hash.includes('late') && <Late />}
            </Drawer>
          )}
        </main>
      )
    }
    createRoot(document.getElementById('root')).render(<Page />)
  `)

  await bundle('form-dialog', `
    import { useState } from 'react'
    import { createRoot } from 'react-dom/client'
    import FormDialog from './ui/FormDialog'

    function Page() {
      const [open, setOpen] = useState(true)
      return (
        <main className="content">
          <button id="opener" className="secondary-button" onClick={() => setOpen(true)}>New category</button>
          {open && (
            <FormDialog
              title="New category"
              onSubmit={() => setOpen(false)}
              onCancel={() => setOpen(false)}
            >
              <label className="qr-field">
                <span>Name</span>
                <input id="cat-name" />
              </label>
            </FormDialog>
          )}
        </main>
      )
    }
    createRoot(document.getElementById('root')).render(<Page />)
  `)

  await bundle('responsive-workflows', `
    import { useState } from 'react'
    import { createRoot } from 'react-dom/client'

    function Page() {
      const [opened, setOpened] = useState(0)
      return (
        <main className="content">
          <div className="rsv-header">
            <div className="rsv-header-actions">
              <button className="secondary-button">Walk-in</button>
              <button className="primary-button compact">New reservation</button>
            </div>
            <div className="rsv-daynav">
              <button className="icon-button" aria-label="Previous day">‹</button>
              <input type="date" aria-label="Reservations day" defaultValue="2026-08-09" />
              <button className="icon-button" aria-label="Next day">›</button>
              <button className="rsv-today">Today</button>
            </div>
          </div>

          <div className="rsv-list-toolbar">
            {['Upcoming 7 days', 'All statuses', 'All zones', 'Any origin'].map((label) => (
              <label className="rsv-select" key={label}><select defaultValue={label}><option>{label}</option></select></label>
            ))}
          </div>

          <div className="location-tabs settings-topic-tabs report-tabs" role="tablist">
            <button className="is-active" role="tab">Sales</button>
            <button role="tab">Fiscal</button>
          </div>

          <section className="panel ord-panel orders-click-workflow">
            <div className="ord-cards">
              <ul>
                <li>
                  <button className="ord-card-open" onClick={() => setOpened((value) => value + 1)}>
                    <span className="ord-card-main">
                      <span className="ord-card-head"><strong>#1020</strong><span className="ord-card-time">5 Aug · 10:12</span></span>
                      <span className="ord-card-body"><span className="ord-card-context">Customer</span><span className="ord-card-sum">5 items · ₪83.00</span></span>
                    </span>
                    <span id="accepted-status" className="ord-status is-info">Accepted</span>
                  </button>
                </li>
              </ul>
            </div>
            <output id="order-open-count">{opened}</output>
          </section>

          <button className="menu-delete-row item-delete-button delete-item-workflow">
            Delete item
          </button>

          <section className="devices-workflow">
            <section className="page-heading">
              <h1>Devices</h1>
              <p className="devices-subtitle">Monitor and manage the terminals connected to your locations.</p>
            </section>
            <div className="devices-toolbar">
              <label className="order-search devices-search">
                <span className="visually-hidden">Search devices</span>
                <input placeholder="Name, location or version" />
              </label>
              <button className="secondary-button devices-archive-toggle">Show archived (2)</button>
              <div className="device-summary"><span>4 devices</span><span className="is-negative">1 needs attention</span></div>
            </div>
            <section className="fleet-section">
              <div className="fleet-section-head"><h2>Needs attention</h2><p>Not reporting, or the queue is stuck.</p></div>
              <section className="panel fleet-location-panel">
                <div className="panel-heading"><div><h2>Snif Pinsker 29</h2><p>1 device</p></div></div>
                <div className="data-list">
                  <div className="data-row device-row">
                    <div className="device-name"><strong>Front counter</strong></div>
                    <div className="device-health"><span className="device-status is-offline"><i />Offline</span><div className="device-meta"><span className="device-seen">Last seen 3d ago</span></div></div>
                    <span className="device-version">v2.8.1 · bridge 1.4.0 · Chrome 126</span>
                    <div className="device-actions"><div className="device-actions-desktop"><button className="icon-button">✎</button><button className="icon-button">□</button></div><div className="device-actions-mobile"><div className="row-menu"><button className="icon-button device-overflow-action">•••</button></div></div></div>
                    <p className="device-advice"><span>This terminal has not reported for 3 days. Archive it if it is no longer in use.</span></p>
                  </div>
                </div>
              </section>
            </section>
            <section className="fleet-section">
              <div className="fleet-section-head"><h2>Working</h2><p>Reporting in and sending their queue.</p></div>
              <section className="panel fleet-location-panel">
                <div className="panel-heading"><div><h2>Snif Pinsker 29</h2><p>2 devices</p></div></div>
                <div className="data-list">
                  {['Main register', 'Terrace POS'].map((name) => (
                    <div className="data-row device-row" key={name}>
                      <div className="device-name"><strong>{name}</strong></div>
                      <div className="device-health"><span className="device-status is-online"><i />Online</span><div className="device-meta"><span className="device-seen">Last seen Just now</span></div></div>
                      <span className="device-version">v2.8.1 · bridge 1.4.0 · Chrome 126</span>
                      <div className="device-actions"><div className="device-actions-desktop"><button className="icon-button">✎</button><button className="icon-button">□</button></div><div className="device-actions-mobile"><div className="row-menu"><button className="icon-button device-overflow-action">•••</button></div></div></div>
                    </div>
                  ))}
                </div>
              </section>
            </section>
            <p className="updated-at devices-updated">Updated automatically · 10:42</p>
          </section>

          <section className="locations-workflow">
            <label className="qr-field location-settings-picker">
              <span>Location</span>
              <select defaultValue="pinsker">
                <option value="pinsker">Snif Pinsker 29</option>
              </select>
            </label>
            <div className="location-tabs settings-topic-tabs location-settings-tabs" role="tablist">
              <button className="is-active" role="tab">Details</button>
              <button role="tab">Receipts &amp; tax</button>
              <button role="tab">POS defaults</button>
            </div>
            <p className="settings-scope">Applies to <strong>Snif Pinsker 29</strong> only.</p>
            <section className="panel form-panel location-settings-panel">
              <div className="location-settings-panel-heading">
                <h2>Location details</h2>
                <p>Identity and operating defaults for this location.</p>
              </div>
              <form className="settings-form location-details-form">
                <div className="location-details-grid">
                  <label className="qr-field"><span>Location name</span><input defaultValue="Snif Pinsker 29" /></label>
                  <label className="qr-field"><span>Display name</span><input defaultValue="Bulochka" /></label>
                  <label className="qr-field"><span>Service mode</span><select defaultValue="tables"><option value="tables">Counter + tables</option></select></label>
                  <label className="qr-field"><span>VAT rate (%)</span><input defaultValue="18" /></label>
                </div>
                <dl className="settings-facts location-details-facts">
                  <div><dt>Currency</dt><dd>ILS</dd></div>
                  <div><dt>Time zone</dt><dd>Asia/Jerusalem</dd></div>
                </dl>
                <p className="form-hint location-settings-lock">Currency and time zone are set when the location is created.</p>
                <div className="form-actions">
                  <button className="primary-button narrow location-save-button">Save changes</button>
                </div>
              </form>
            </section>
          </section>

          <section className="panel form-panel timeline-panel">
            <div className="timeline-controls">
              <div className="timeline-zones" aria-label="Zone filter">
                <button className="timeline-filter-button is-active">All zones</button>
                <button className="timeline-filter-button">Terrace</button>
                <button className="timeline-filter-button">Street</button>
                <button className="timeline-filter-button">Veranda</button>
              </div>
              <div className="timeline-pan" aria-label="Move through timeline">
                <button className="text-button">Earlier</button>
                <button className="text-button">Later</button>
              </div>
            </div>
            <div className="timeline-guide">
              <div className="timeline-legend">
                <span><i className="is-pending" />Pending</span>
                <span><i className="is-confirmed" />Confirmed</span>
                <span><i className="is-arrived" />Seated</span>
                <span><i className="is-done" />Completed</span>
                <span><i className="is-conflict" />Conflict</span>
              </div>
            </div>
            <div className="timeline-mobile-ruler" aria-hidden="true">
              <div className="timeline-canvas" style={{ '--timeline-track-width': '720px' }}>
                <div className="timeline-ruler">
                  <div className="timeline-label" />
                  <div className="timeline-track">
                    {['08:00', '09:00', '10:00', '11:00'].map((time, index) => (
                      <span className="timeline-tick" key={time} style={{ left: (index * 13.33) + '%' }}>{time}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="timeline-scroll timeline-grid-scroll">
              <div className="timeline-canvas" style={{ '--timeline-track-width': '720px' }}>
                <div className="timeline-ruler">
                  <div className="timeline-label" />
                  <div className="timeline-track" />
                </div>
                <div className="timeline-zonerow"><div className="timeline-label">Terrace</div><div className="timeline-track-spacer" /></div>
                {Array.from({ length: 12 }, (_, index) => (
                  <div className="timeline-row" key={index}>
                    <div className="timeline-label"><strong>{index + 1}</strong><small>2</small></div>
                    <div className={'timeline-track' + (index === 11 ? ' is-blocked' : '')}>
                      <span className="timeline-grid" style={{ left: '13.33%' }} />
                      {index === 11 && <span className="timeline-blocked">Out of service</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
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

  /*
   * Панель визита — настоящая, а не разметка-двойник.
   *
   * Проверяется то, ради чего её и переделывали: главное действие стоит
   * первым, контекст постоянного гостя виден смене, денежная часть есть
   * только там, где есть касса, а пикер всех столов больше не стоит
   * между хостес и посадкой.
   */
  await bundle('visit-sheet', `
    import { useState } from 'react'
    import { createRoot } from 'react-dom/client'
    import BookingSheet from './BookingSheet'

    const TABLES = [
      { id: 't1', label: 'Терраса 3', seats: 4, zoneId: 'z1', zoneName: 'Терраса', sortOrder: 0, blocked: false },
      { id: 't2', label: 'Bar 12', seats: 2, zoneId: 'z1', zoneName: 'Терраса', sortOrder: 1, blocked: false },
    ]
    const BASE = {
      id: 'r1', status: 'confirmed', customer_name: 'Мири Леви',
      customer_phone: '0501112233', party_size: 3,
      reserved_at: new Date(Date.now() + 3600000).toISOString(),
      duration_min: 90, note: null, table_ids: ['t1'], zone_id: 'z1',
      created_at: new Date(Date.now() - 86400000).toISOString(),
      created_via: 'public', source: 'qr', arrived_at: null,
      guest: { id: 'g1', visits: 5, upcoming: 1, cancelled: 0, no_shows: 2 },
      order: null, order_id: null,
    }
    const WITH_POS = {
      ...BASE, id: 'r2', order_id: 'o1',
      order: { id: 'o1', number: 42, status: 'open', total: 12500, paid: false },
    }

    function Page() {
      const [which, setWhich] = useState(window.__VARIANT__ || 'standalone')
      const reservation = which === 'pos' ? WITH_POS : BASE
      return (
        <main className="content">
          <BookingSheet
            locationId="loc-1"
            reservation={reservation}
            tables={TABLES}
            tz="Asia/Jerusalem"
            busy={false}
            error=""
            bookings={[]}
            clashes={[]}
            onClose={() => {}}
            onAction={(key) => { window.__ACTED__ = key }}
            onTables={() => {}}
            onEdit={() => {}}
            onClearError={() => {}}
          />
        </main>
      )
    }
    createRoot(document.getElementById('root')).render(<Page />)
  `, { stubSupabase: true })

  /*
   * Узнавание гостя в форме брони (157). Проверяется настоящая форма:
   * подсказка обязана появиться на полном номере и НЕ появиться на
   * префиксе, иначе форма превращается в перебор клиентской базы.
   */
  await bundle('booking-form', `
    import { createRoot } from 'react-dom/client'
    import BookingForm from './BookingForm'
    createRoot(document.getElementById('root')).render(
      <main className="content">
        <BookingForm
          locationId="loc-1"
          tables={[{ id: 't1', label: '1', seats: 4, zoneId: null, zoneName: null, sortOrder: 0, blocked: false }]}
          bookings={[]}
          tz="Asia/Jerusalem"
          mode="booking"
          onClose={() => {}}
          onCreated={() => {}}
        />
      </main>
    )
  `, { stubSupabase: true })
})

after(async () => {
  await browser?.close()
  appServer?.close()
  guestServer?.close()
})



describe('узнавание гостя в форме брони', { skip }, () => {
  const open = async (viewport = { width: 1440, height: 1000 }) => {
    const page = await browser.newPage()
    await page.setViewport(viewport)
    await page.goto(`${appOrigin}/booking-form`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('input[type="tel"]', { timeout: 5000 })
    return page
  }
  const typePhone = async (page, value) => {
    await page.focus('input[type="tel"]')
    await page.evaluate(() => { document.querySelector('input[type="tel"]').value = '' })
    await page.type('input[type="tel"]', value)
    // Ввод гасится задержкой перед запросом
    await new Promise((r) => setTimeout(r, 700))
  }

  it('полный номер узнаёт гостя и называет, чем он известен', async () => {
    const page = await open()
    await typePhone(page, '0521111111')
    const state = await page.evaluate(() => ({
      hint: document.querySelector('.booking-match')?.textContent ?? null,
      warn: !!document.querySelector('.booking-match.is-warn'),
      name: document.querySelector('input[maxlength="120"]')?.value ?? '',
    }))
    assert.match(state.hint, /Мири Леви/)
    assert.match(state.hint, /8 visits/)
    assert.match(state.hint, /2 no-shows/)
    assert.equal(state.warn, true, 'повторные неявки предупреждают смену')
    assert.equal(state.name, 'Мири Леви', 'имя подставлено, чтобы его не набирали заново')
    await page.close()
  })

  it('префикс номера не отдаёт ничего — иначе это перебор базы', async () => {
    const page = await open()
    await typePhone(page, '05211')
    assert.equal(
      await page.evaluate(() => document.querySelector('.booking-match')),
      null)
    await page.close()
  })

  it('набранное хостес имя подсказка не перетирает', async () => {
    const page = await open()
    await page.type('input[maxlength="120"]', 'Гость у стойки')
    await typePhone(page, '0521111111')
    assert.equal(
      await page.evaluate(() => document.querySelector('input[maxlength="120"]').value),
      'Гость у стойки',
      'спорить с человеком, который смотрит на гостя, нельзя')
    await page.close()
  })

  it('на телефоне подсказка не расширяет страницу вбок', async () => {
    const page = await open({ width: 390, height: 844, hasTouch: true, isMobile: true })
    await typePhone(page, '0521111111')
    assert.equal(await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth), 0)
    await page.close()
  })
})

describe('панель визита', { skip }, () => {
  const open = async (variant, viewport = { width: 1440, height: 1000 }) => {
    const page = await browser.newPage()
    await page.setViewport(viewport)
    await page.evaluateOnNewDocument((v) => { window.__VARIANT__ = v }, variant)
    await page.goto(`${appOrigin}/visit-sheet`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.drawer', { timeout: 5000 })
    return page
  }

  const read = () => ({
    next: document.querySelector('.sheet-next button')?.textContent?.trim() ?? null,
    // Главное действие обязано стоять ВЫШЕ прочих: ради него панель и открыли
    nextBeforeRest: (() => {
      const next = document.querySelector('.sheet-next button')
      const rest = document.querySelector('.order-actions button')
      if (!next || !rest) return null
      return next.compareDocumentPosition(rest) & Node.DOCUMENT_POSITION_FOLLOWING ? true : false
    })(),
    restActions: [...document.querySelectorAll('.order-actions button')].map((b) => b.textContent.trim()),
    guest: document.querySelector('.sheet-guest')?.textContent ?? null,
    guestWarn: document.querySelector('.sheet-guest-warn')?.textContent?.trim() ?? null,
    order: document.querySelector('.sheet-order')?.textContent ?? null,
    orderTotal: document.querySelector('.sheet-order-total')?.textContent?.trim() ?? null,
    pickerOpen: !!document.querySelector('.timeline-tablepick'),
    disclosure: document.querySelector('.sheet-disclosure')?.textContent ?? null,
    tapTargets: [...document.querySelectorAll('.sheet-next button, .sheet-disclosure')]
      .map((b) => Math.round(b.getBoundingClientRect().height)),
  })

  it('главное действие стоит первым, остальное — ниже', async () => {
    const page = await open('standalone')
    const state = await page.evaluate(read)
    assert.equal(state.next, 'Guest seated', 'подтверждённый визит ждёт посадки')
    assert.equal(state.nextBeforeRest, true, 'главное действие выше прочих')
    assert.ok(!state.restActions.includes('Guest seated'), 'главное действие не дублируется внизу')
    assert.ok(state.restActions.includes('Cancel booking'))
    await page.close()
  })

  it('пикер столов не стоит между хостес и посадкой, но стол назван', async () => {
    const page = await open('standalone')
    const state = await page.evaluate(read)
    assert.equal(state.pickerOpen, false, 'двадцать кнопок столов не открыты по умолчанию')
    assert.match(state.disclosure, /Терраса 3/, 'текущий стол виден без раскрытия')
    await page.close()
  })

  it('постоянный гость и повторные неявки видны смене', async () => {
    const page = await open('standalone')
    const state = await page.evaluate(read)
    assert.match(state.guest, /Returning guest/)
    assert.match(state.guest, /5 visits/)
    assert.match(state.guestWarn, /Missed 2 bookings/, 'две неявки предупреждают, одна — нет')
    await page.close()
  })

  it('у визита без кассы денежной части нет, а не ноль', async () => {
    const page = await open('standalone')
    const state = await page.evaluate(read)
    assert.equal(state.order, null, 'пустой «средний чек 0 ₪» описывал бы гостя, а не отсутствие кассы')
    await page.close()
  })

  it('у визита на кассе видно номер заказа и то, оплачен ли он', async () => {
    const page = await open('pos')
    const state = await page.evaluate(read)
    assert.match(state.order, /Order #42/)
    assert.match(state.order, /Not paid yet/, '«открыт» и «оплачен» — разные вопросы')
    assert.match(state.orderTotal, /125/)
    // Посаженную на кассе бронь кабинет не трогает (pos_mode, 102)
    assert.equal(state.next, null, 'действий по чужому визиту панель не предлагает')
    await page.close()
  })

  it('на телефоне действие и раскрытия остаются мишенью под палец', async () => {
    const page = await open('standalone', { width: 390, height: 844, hasTouch: true, isMobile: true })
    const state = await page.evaluate(read)
    assert.ok(state.tapTargets.length > 0)
    for (const height of state.tapTargets) {
      assert.ok(height >= 44, `мишень ${height}px меньше 44px`)
    }
    assert.equal(await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth), 0,
    'панель не расширяет страницу вбок')
    await page.close()
  })
})


describe('пропавший после деплоя чанк', { skip }, () => {
  const open = async (message) => {
    const page = await browser.newPage()
    if (message) await page.evaluateOnNewDocument((m) => { window.__ERR__ = m }, message)
    await page.goto(`${appOrigin}/stale-chunk`, { waitUntil: 'networkidle0' })
    return page
  }

  it('перезагружается сам ровно один раз и не зацикливается', async () => {
    const page = await open()
    await page.waitForFunction(() => window.__RELOADS__ === 1)

    // Повторные монтирования той же сборки перезагрузку НЕ повторяют:
    // это была бы петля на глазах у владельца.
    await page.click('#remount')
    await page.click('#remount')
    await new Promise((r) => setTimeout(r, 300))
    assert.equal(await page.evaluate(() => window.__RELOADS__), 1)

    // И объясняет, что произошло, вместо «Failed to fetch…»
    await page.waitForSelector('.view-crash')
    const text = await page.$eval('.view-crash', (el) => el.textContent)
    assert.match(text, /new version was released/i)
    assert.match(text, /Reload updated version/i)
    // «Try again» здесь не предлагается: он заведомо не сработает
    assert.doesNotMatch(text, /Try again/i)
    await page.close()
  })

  it('кнопка перезагружает документ, а не перемонтирует раздел', async () => {
    const page = await open()
    await page.waitForFunction(() => window.__RELOADS__ === 1)
    await page.click('.view-crash .primary-button')
    assert.equal(await page.evaluate(() => window.__RELOADS__), 2)
    await page.close()
  })

  it('Safari-формулировка распознаётся так же', async () => {
    const page = await open('Importing a module script failed.')
    await page.waitForFunction(() => window.__RELOADS__ === 1)
    assert.match(await page.$eval('.view-crash', (el) => el.textContent),
      /new version was released/i)
    await page.close()
  })

  it('обычная ошибка рендера страницу НЕ перезагружает', async () => {
    const page = await open('selecting is not defined')
    await page.waitForSelector('.view-crash')
    await new Promise((r) => setTimeout(r, 300))
    assert.equal(await page.evaluate(() => window.__RELOADS__), 0)
    const text = await page.$eval('.view-crash', (el) => el.textContent)
    assert.match(text, /could not be displayed/i)
    assert.match(text, /Try again/i)
    // Навигация цела — раздел упал, кабинет работает
    assert.ok(await page.$('#chrome'))
    await page.close()
  })
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

  it('скрытый сайдбар не отнимает ширину у страницы', async () => {
    const page = await browser.newPage()
    await page.setViewport({ width: 390, height: 844 })
    await page.goto(`${appOrigin}/shell`, { waitUntil: 'networkidle0' })

    const state = await page.evaluate(() => {
      const shell = document.querySelector('.app-shell').getBoundingClientRect()
      const main = document.querySelector('.app-main').getBoundingClientRect()
      const content = document.querySelector('.content').getBoundingClientRect()
      return {
        viewport: window.innerWidth,
        shell: Math.round(shell.width),
        main: Math.round(main.width),
        contentRight: Math.round(content.right),
        columns: getComputedStyle(document.querySelector('.app-shell')).gridTemplateColumns,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })

    assert.equal(state.shell, state.viewport, 'оболочка должна занимать весь экран')
    assert.equal(state.main, state.viewport, 'рабочая область не резервирует скрытую колонку')
    assert.ok(state.contentRight <= state.viewport, 'контент не выходит за правый край')
    assert.equal(state.columns, `${state.viewport}px`, 'на телефоне у оболочки одна колонка')
    assert.equal(state.overflow, 0, 'страница не должна прокручиваться вбок')
    await page.close()
  })

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

  it('шторка остаётся до нижнего края при изменении высоты мобильного viewport', async () => {
    const page = await openDrawer()

    // Safari меняет доступную высоту, когда адресная панель раскрывается
    // и сворачивается. Раньше 100svh оставлял снизу кусок таймлайна.
    await page.setViewport({ width: 390, height: 700 })
    await page.setViewport({ width: 390, height: 932 })

    const state = await page.evaluate(() => {
      const sidebar = document.querySelector('.sidebar').getBoundingClientRect()
      return {
        top: Math.round(sidebar.top),
        bottom: Math.round(sidebar.bottom),
        viewportBottom: window.innerHeight,
        rootLocked: document.documentElement.style.overflow === 'hidden',
        bodyLocked: document.body.style.overflow === 'hidden',
      }
    })

    assert.equal(state.top, 0)
    assert.equal(state.bottom, state.viewportBottom, 'контент под меню не должен проступать снизу')
    assert.equal(state.rootLocked, true, 'корень страницы заблокирован вместе с body')
    assert.equal(state.bodyLocked, true)
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
      rootLocked: document.documentElement.style.overflow === 'hidden',
    }))
    assert.equal(after.open, false)
    assert.equal(after.active, 'Open navigation', 'фокус возвращается туда, откуда пришёл')
    assert.equal(after.expanded, 'false')
    assert.equal(after.bodyLocked, false, 'страница снова прокручивается')
    assert.equal(after.rootLocked, false, 'корень страницы снова прокручивается')
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

  it('на планшете меню остаётся боковой панелью с подложкой', async () => {
    const page = await browser.newPage()
    await page.setViewport({ width: 768, height: 1024 })
    await page.goto(`${appOrigin}/shell`, { waitUntil: 'networkidle0' })
    await page.click('.mobile-menu')
    await page.waitForFunction(() => document.querySelector('.sidebar')?.classList.contains('is-open'))

    const state = await page.evaluate(() => {
      const sidebar = document.querySelector('.sidebar').getBoundingClientRect()
      const scrim = document.querySelector('.drawer-scrim')
      return {
        sidebarWidth: Math.round(sidebar.width),
        viewportWidth: window.innerWidth,
        scrimVisible: getComputedStyle(scrim).display !== 'none',
        scrimStartsBehindPanel: Math.round(scrim.getBoundingClientRect().width) === window.innerWidth,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })

    assert.ok(state.sidebarWidth < state.viewportWidth, 'планшет не должен получать пустую полноэкранную шторку')
    assert.ok(state.sidebarWidth >= 320, 'панель должна оставаться удобной для чтения')
    assert.ok(state.scrimVisible, 'контекст страницы за панелью отделён подложкой')
    assert.ok(state.scrimStartsBehindPanel)
    assert.equal(state.overflow, 0)
    await page.close()
  })
})

describe('responsive control foundation', { skip }, () => {
  async function measure(viewport) {
    const page = await browser.newPage()
    await page.setViewport(viewport)
    await page.goto(`${appOrigin}/form-dialog`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.form-dialog')
    const result = await page.evaluate(() => {
      const rect = (selector) => {
        const element = document.querySelector(selector)
        const box = element.getBoundingClientRect()
        return { height: Math.round(box.height), width: Math.round(box.width) }
      }
      const field = document.querySelector('.qr-field input')
      return {
        primary: rect('.form-dialog .primary-button'),
        secondary: rect('.form-dialog .secondary-button'),
        field: rect('.qr-field input'),
        fieldFont: parseFloat(getComputedStyle(field).fontSize),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    await page.close()
    return result
  }

  it('на десктопе действия рабочие, а не размером с промо-CTA', async () => {
    const state = await measure({ width: 1440, height: 900 })
    assert.ok(state.primary.height <= 40, `primary раздута до ${state.primary.height}px`)
    assert.ok(state.secondary.height <= 40, `secondary раздута до ${state.secondary.height}px`)
    assert.equal(state.field.height, 40)
    assert.equal(state.overflow, 0)
  })

  it('на телефоне кнопки и поле остаются целями 44px без iOS zoom', async () => {
    const state = await measure({ width: 390, height: 740, hasTouch: true, isMobile: true })
    assert.ok(state.primary.height >= 44)
    assert.ok(state.secondary.height >= 44)
    assert.ok(state.field.height >= 44)
    assert.ok(state.fieldFont >= 16)
    assert.equal(state.overflow, 0)
  })

  it('бронь на телефоне держит одинаковые кнопки и не выталкивает экран', async () => {
    const page = await browser.newPage()
    await page.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true })
    await page.goto(`${appOrigin}/responsive-workflows`, { waitUntil: 'networkidle0' })
    const state = await page.evaluate(() => {
      const boxes = (selector) => [...document.querySelectorAll(selector)].map((element) => {
        const box = element.getBoundingClientRect()
        return {
          width: Math.round(box.width),
          height: Math.round(box.height),
          x: Math.round(box.x),
          right: Math.round(box.right),
          y: Math.round(box.y),
        }
      })
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        day: boxes('.rsv-daynav > *'),
        actions: boxes('.rsv-header-actions > button'),
        controls: boxes('.timeline-controls'),
        zones: boxes('.timeline-zones'),
        pan: boxes('.timeline-pan > button'),
        reportTabs: boxes('.report-tabs > button'),
        listFilters: boxes('.rsv-list-toolbar select'),
        listFilterFont: parseFloat(getComputedStyle(document.querySelector('.rsv-list-toolbar select')).fontSize),
      }
    })

    assert.equal(state.overflow, 0)
    assert.ok(state.day.every((box) => box.height === 44), 'вся строка даты — ровно 44px')
    for (let index = 0; index < state.day.length - 1; index += 1) {
      assert.ok(
        state.day[index].right < state.day[index + 1].x,
        `элементы даты ${index} и ${index + 1} не должны пересекаться`,
      )
    }
    assert.deepEqual(state.actions.map((box) => box.height), [44, 44])
    assert.ok(Math.abs(state.actions[0].width - state.actions[1].width) <= 1)
    assert.ok(state.actions[0].y < state.day[0].y, 'действия стоят раньше даты')
    assert.ok(state.listFilters.every((box) => box.width >= 170), 'поля не сжимаются в узкие чипы')
    assert.deepEqual(state.listFilters.map((box) => box.height), [60, 60, 60, 60])
    assert.ok(state.listFilterFont >= 16, 'фильтры читаются без масштабирования iOS')
    assert.equal(state.zones[0].width, state.controls[0].width, 'зоны занимают полную строку')
    assert.deepEqual(state.pan.map((box) => box.height), [44, 44])
    assert.ok(Math.abs(state.pan[0].width - state.pan[1].width) <= 1)
    assert.deepEqual(state.reportTabs.map((box) => box.height), [44, 44])
    assert.ok(state.reportTabs.every((box) => box.width >= 116), 'капсулы отчётов достаточно длинные')
    assert.ok(Math.abs(state.reportTabs[0].width - state.reportTabs[1].width) <= 1)

    await page.setViewport({ width: 320, height: 720, hasTouch: true, isMobile: true })
    const narrow = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      actions: [...document.querySelectorAll('.rsv-header-actions > button')].map((element) => (
        Math.round(element.getBoundingClientRect().width)
      )),
    }))
    assert.equal(narrow.overflow, 0, 'даже 320px не получает боковую прокрутку')
    assert.ok(narrow.actions.every((width) => width > 0), 'обе кнопки остаются видимыми')
    await page.close()
  })

  it('мобильная сетка броней прокручивает только время и не заводит второй вертикальный скролл', async () => {
    const page = await browser.newPage()
    await page.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true })
    await page.goto(`${appOrigin}/responsive-workflows`, { waitUntil: 'networkidle0' })

    const state = await page.evaluate(() => {
      const panel = document.querySelector('.timeline-panel').getBoundingClientRect()
      const ruler = document.querySelector('.timeline-mobile-ruler')
      const grid = document.querySelector('.timeline-grid-scroll')
      const label = grid.querySelector('.timeline-row .timeline-label').getBoundingClientRect()
      const track = grid.querySelector('.timeline-row .timeline-track').getBoundingClientRect()
      const rulerBox = ruler.getBoundingClientRect()
      const gridBox = grid.getBoundingClientRect()
      const gridStyle = getComputedStyle(grid)
      const legend = document.querySelector('.timeline-legend')
      const outOfService = document.querySelector('.timeline-track.is-blocked .timeline-blocked')

      return {
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        panelWidth: Math.round(panel.width),
        rulerWidth: Math.round(rulerBox.width),
        gridWidth: Math.round(gridBox.width),
        labelWidth: Math.round(label.width),
        visibleTrackWidth: Math.round(grid.clientWidth - label.width),
        trackWidth: Math.round(track.width),
        scrollWidth: Math.round(grid.scrollWidth),
        clientWidth: Math.round(grid.clientWidth),
        overflowX: gridStyle.overflowX,
        overflowY: gridStyle.overflowY,
        maxHeight: gridStyle.maxHeight,
        rulerDisplay: getComputedStyle(ruler).display,
        embeddedRulerDisplay: getComputedStyle(grid.querySelector('.timeline-ruler')).display,
        legendDisplay: getComputedStyle(legend).display,
        outOfServiceText: outOfService?.textContent,
      }
    })

    assert.equal(state.pageOverflow, 0, 'прокрутка времени не расширяет всю страницу')
    assert.equal(state.rulerWidth, state.gridWidth, 'шкала и строки используют одну видимую ширину')
    assert.ok(state.gridWidth >= state.panelWidth, 'сетка использует всю ширину мобильного полотна')
    /*
     * 72 px хватало ровно на «Table 12». Настоящие залы называют столы
     * «Терраса 3» и «Bar 12» — такое имя обрывалось на середине, и
     * хостес читал «Терра…», не зная, тот ли это стол.
     */
    assert.equal(state.labelWidth, 104, 'имя стола и число мест читаются целиком')
    assert.ok(state.visibleTrackWidth >= 240, 'на iPhone видно не меньше 2.5 часов')
    // Час на телефоне сужен, поэтому расширенная колонка НЕ съела окно
    assert.ok(state.visibleTrackWidth / 76 >= 3, 'видно не меньше трёх часов')
    assert.ok(state.trackWidth >= 720, 'время не сжимается — оно листается внутри сетки')
    assert.ok(state.scrollWidth > state.clientWidth, 'у времени есть собственная горизонтальная прокрутка')
    assert.equal(state.overflowX, 'auto')
    assert.equal(state.overflowY, 'hidden', 'внутреннего вертикального scrollbar больше нет')
    assert.equal(state.maxHeight, 'none')
    assert.equal(state.rulerDisplay, 'block')
    assert.equal(state.embeddedRulerDisplay, 'none', 'на телефоне рисуется только одна шкала часов')
    assert.equal(state.legendDisplay, 'none', 'легенда не отнимает ширину первого экрана')
    assert.equal(state.outOfServiceText, 'Out of service', 'отключённые столы остаются на плане')
    await page.close()
  })

  it('на планшете зоны и навигация таймлайна стоят отдельными рядами', async () => {
    const page = await browser.newPage()
    await page.setViewport({ width: 768, height: 1024, hasTouch: true })
    await page.goto(`${appOrigin}/responsive-workflows`, { waitUntil: 'networkidle0' })
    const state = await page.evaluate(() => {
      const zones = document.querySelector('.timeline-zones').getBoundingClientRect()
      const pan = document.querySelector('.timeline-pan').getBoundingClientRect()
      return {
        zonesBottom: Math.round(zones.bottom),
        panTop: Math.round(pan.top),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    assert.ok(state.panTop >= state.zonesBottom, 'панель времени не сжимает фильтр зон')
    assert.equal(state.overflow, 0)
    await page.close()
  })

  it('Locations держит капсулы и адаптивную форму без боковой прокрутки', async () => {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 1100 })
    await page.goto(`${appOrigin}/responsive-workflows`, { waitUntil: 'networkidle0' })

    const desktop = await page.evaluate(() => ({
      columns: getComputedStyle(document.querySelector('.location-details-grid')).gridTemplateColumns.split(' ').length,
      tabRadii: [...document.querySelectorAll('.location-settings-tabs > button')]
        .map((button) => parseFloat(getComputedStyle(button).borderTopLeftRadius)),
      saveRadius: parseFloat(getComputedStyle(document.querySelector('.location-save-button')).borderTopLeftRadius),
      saveHeight: Math.round(document.querySelector('.location-save-button').getBoundingClientRect().height),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }))
    assert.equal(desktop.columns, 2)
    assert.ok(desktop.tabRadii.every((radius) => radius >= 20), 'вкладки должны быть капсулами')
    assert.ok(desktop.saveRadius >= 20, 'Save changes должна быть капсулой')
    assert.ok(desktop.saveHeight <= 44, 'рабочая кнопка не превращается в промо-CTA')
    assert.equal(desktop.overflow, 0)

    await page.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true })
    const mobile = await page.evaluate(() => {
      const picker = document.querySelector('.location-settings-picker').getBoundingClientRect()
      const panel = document.querySelector('.location-settings-panel').getBoundingClientRect()
      const save = document.querySelector('.location-save-button').getBoundingClientRect()
      return {
        columns: getComputedStyle(document.querySelector('.location-details-grid')).gridTemplateColumns.split(' ').length,
        pickerWidth: Math.round(picker.width),
        panelWidth: Math.round(panel.width),
        saveWidth: Math.round(save.width),
        saveHeight: Math.round(save.height),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    assert.equal(mobile.columns, 1)
    assert.ok(mobile.pickerWidth > 340, 'выбор точки занимает мобильную строку')
    assert.ok(mobile.saveWidth >= mobile.panelWidth - 34, 'сохранение доступно полной шириной')
    assert.equal(mobile.saveHeight, 44)
    assert.equal(mobile.overflow, 0)
    await page.close()
  })

  it('статус входит в кликабельную строку заказа, а удаление товара явно опасное', async () => {
    const page = await browser.newPage()
    await page.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true })
    await page.goto(`${appOrigin}/responsive-workflows`, { waitUntil: 'networkidle0' })

    const geometry = await page.evaluate(() => {
      const open = document.querySelector('.orders-click-workflow .ord-card-open').getBoundingClientRect()
      const status = document.getElementById('accepted-status').getBoundingClientRect()
      const danger = getComputedStyle(document.querySelector('.delete-item-workflow'))
      return {
        statusRightGap: Math.round(open.right - status.right),
        dangerBackground: danger.backgroundColor,
        dangerColor: danger.color,
        dangerRadius: parseFloat(danger.borderTopLeftRadius),
      }
    })
    assert.ok(geometry.statusRightGap <= 1, 'статус должен стоять у правого края строки')
    assert.match(geometry.dangerBackground, /rgb\(180, 69, 60\)/)
    assert.equal(geometry.dangerColor, 'rgb(255, 255, 255)')
    assert.ok(geometry.dangerRadius >= 20, 'красная кнопка остаётся капсулой')

    await page.click('#accepted-status')
    assert.equal(await page.$eval('#order-open-count', (node) => node.textContent), '1')
    await page.close()
  })

  it('Devices держит рабочие колонки на десктопе и складывается без переполнения', async () => {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 1100 })
    await page.goto(`${appOrigin}/responsive-workflows`, { waitUntil: 'networkidle0' })

    const desktop = await page.evaluate(() => {
      const row = document.querySelector('.devices-workflow .device-row')
      const style = getComputedStyle(row)
      return {
        columns: style.gridTemplateColumns.split(' ').length,
        searchRadius: parseFloat(getComputedStyle(document.querySelector('.devices-search')).borderTopLeftRadius),
        archiveRadius: parseFloat(getComputedStyle(document.querySelector('.devices-archive-toggle')).borderTopLeftRadius),
        adviceWidth: Math.round(document.querySelector('.device-advice').getBoundingClientRect().width),
        rowWidth: Math.round(row.getBoundingClientRect().width),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    assert.equal(desktop.columns, 5)
    assert.ok(desktop.searchRadius >= 20)
    assert.ok(desktop.archiveRadius >= 20)
    assert.ok(desktop.adviceWidth >= desktop.rowWidth - 40)
    assert.equal(desktop.overflow, 0)

    await page.setViewport({ width: 820, height: 1180, hasTouch: true })
    const tablet = await page.evaluate(() => ({
      columns: getComputedStyle(document.querySelector('.devices-workflow .device-row')).gridTemplateColumns.split(' ').length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }))
    assert.equal(tablet.columns, 4)
    assert.equal(tablet.overflow, 0)

    await page.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true })
    const mobile = await page.evaluate(() => {
      const row = document.querySelector('.devices-workflow .device-row')
      const workingRow = document.querySelectorAll('.devices-workflow .device-row')[1]
      const status = row.querySelector('.device-status').getBoundingClientRect()
      const actionsBox = row.querySelector('.device-actions').getBoundingClientRect()
      const name = row.querySelector('.device-name').getBoundingClientRect()
      const version = row.querySelector('.device-version').getBoundingClientRect()
      const actions = [...row.querySelectorAll('.device-actions-mobile > .row-menu > .icon-button')].map((button) => {
        const rect = button.getBoundingClientRect()
        return [Math.round(rect.width), Math.round(rect.height)]
      })
      return {
        statusTop: Math.round(status.top), actionsTop: Math.round(actionsBox.top),
        nameTop: Math.round(name.top), versionTop: Math.round(version.top),
        actionsCenter: Math.round(actionsBox.top + actionsBox.height / 2),
        nameCenter: Math.round(name.top + name.height / 2),
        workingRowHeight: Math.round(workingRow.getBoundingClientRect().height),
        actionBackground: getComputedStyle(row.querySelector('.device-actions-mobile .icon-button')).backgroundColor,
        actionBorderWidth: getComputedStyle(row.querySelector('.device-actions-mobile .icon-button')).borderTopWidth,
        actions, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    assert.ok(
      Math.abs(mobile.actionsCenter - mobile.nameCenter) <= 3,
      'меню действий стоит в строке названия, а не висит отдельно от карточки',
    )
    assert.ok(mobile.statusTop > mobile.nameTop, 'статус и время связи собраны под названием')
    assert.ok(mobile.versionTop > mobile.statusTop)
    assert.ok(mobile.workingRowHeight <= 130, 'рабочая касса остаётся компактной на телефоне')
    assert.equal(mobile.actions.length, 1, 'на телефоне остаётся одно меню действий')
    assert.ok(mobile.actions.every(([width, height]) => width === 44 && height === 44))
    assert.equal(mobile.actionBorderWidth, '0px', 'у меню нет отдельной плавающей окружности')
    assert.notEqual(mobile.actionBackground, 'rgb(255, 255, 255)')
    assert.equal(mobile.overflow, 0)
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

  /*
   * Ждём состояние, а не секундомер. Слой теперь не исчезает, а уезжает:
   * между нажатием и снятием узла есть анимация, и фиксированная пауза в
   * тесте закрепила бы её длительность как контракт.
   */
  const gone = (page, selector) => page.waitForFunction(
    (css) => !document.querySelector(css), {}, selector
  )

  it('Escape закрывает диалог, а панель визита остаётся открытой', async () => {
    const page = await open()
    await page.keyboard.press('Escape')
    await gone(page, '.confirm-dialog')
    const state = await page.evaluate(() => ({
      drawers: document.querySelectorAll('.drawer').length,
      cancelled: !!document.getElementById('did-cancel'),
    }))
    assert.equal(state.drawers, 1, 'панель осталась')
    // Отказ от диалога не должен ничего выполнять
    assert.equal(state.cancelled, false)
    await page.close()
  })

  it('второй Escape закрывает уже панель', async () => {
    const page = await open()
    await page.keyboard.press('Escape')
    await gone(page, '.confirm-dialog')
    await page.keyboard.press('Escape')
    await gone(page, '.drawer')
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

/**
 * Куда встаёт фокус, когда слой открылся.
 *
 * Форма, которая сама фокусирует поле, на телефоне открывается вместе с
 * клавиатурой: половина листа закрыта, и посмотреть, что там вообще
 * спрашивают, нельзя, не убрав её. Автофокус в поле остаётся там, где
 * ничего не заслоняет — с мышью; пальцем фокус входит в сам слой.
 */
describe('фокус при открытии слоя', { skip }, () => {
  const open = async (viewport) => {
    const page = await browser.newPage()
    await page.setViewport(viewport)
    await page.goto(`${appOrigin}/form-dialog`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.form-dialog')
    return page
  }

  const activeId = (page) => page.evaluate(() => ({
    id: document.activeElement?.id || '',
    inDialog: !!document.querySelector('.form-dialog')?.contains(document.activeElement),
    isDialog: document.activeElement === document.querySelector('.form-dialog'),
  }))

  it('с мышью диалог сразу принимает ввод', async () => {
    const page = await open({ width: 1440, height: 900 })
    assert.deepEqual(await activeId(page), { id: 'cat-name', inDialog: true, isDialog: false })
    await page.close()
  })

  it('пальцем фокус входит в диалог, а не в поле — клавиатура ждёт тапа', async () => {
    const page = await open({ width: 390, height: 740, hasTouch: true, isMobile: true })
    const state = await activeId(page)
    assert.equal(state.isDialog, true, `фокус обязан быть на самом диалоге, а он на «${state.id}»`)
    // Ловушка Tab и объявление читалкой держатся на том, что фокус ВНУТРИ
    assert.equal(state.inDialog, true)
    await page.close()
  })
})

/**
 * Движение слоёв — единственный набор, где анимация ВКЛЮЧЕНА.
 *
 * Проверяется не красота, а два свойства, которых не было: слой уходит
 * туда же, откуда пришёл (иначе «куда делась карточка» — вопрос при
 * каждом закрытии), и уходящий слой сразу отдаёт клавиатуру тому, что
 * под ним. Длительности здесь не закрепляются: тест ждёт состояния
 * анимации, а не миллисекунды.
 */
describe('движение слоёв', { skip }, () => {
  const withMotion = async (page) => {
    await page.emulateMediaFeatures([
      { name: 'prefers-reduced-motion', value: 'no-preference' },
    ])
    return page
  }

  /** Пока слой едет, клик внутрь уходит мимо — ждём остановки */
  const settled = (page, css) => page.waitForFunction(
    (selector) => {
      const el = document.querySelector(selector)
      return !!el && el.getAnimations().every((a) => a.playState === 'finished')
    },
    {},
    css
  )

  const openDrawer = async ({ width = 1440, height = 900, hash = '' } = {}) => {
    const page = await withMotion(await browser.newPage())
    await page.setViewport({ width, height })
    await page.goto(`${appOrigin}/drawer${hash}`, { waitUntil: 'networkidle0' })
    await page.click('#opener')
    await page.waitForSelector('.drawer')
    return page
  }

  const runningName = (page, css) => page.evaluate((selector) => {
    const el = document.querySelector(selector)
    return el?.getAnimations().map((a) => a.animationName).join(',') ?? ''
  }, css)

  it('на широком экране панель приезжает сбоку и встаёт на место', async () => {
    const page = await openDrawer()
    assert.match(await runningName(page, '.drawer'), /panel-slide-in/)
    await settled(page, '.drawer')
    const rect = await page.evaluate(() => {
      const el = document.querySelector('.drawer')
      const box = el.getBoundingClientRect()
      return { right: Math.round(box.right), width: window.innerWidth }
    })
    assert.equal(rect.right, rect.width, 'панель обязана доехать до края')
    await page.close()
  })

  it('Escape уводит панель обратно, а не гасит её на месте', async () => {
    const page = await openDrawer()
    await settled(page, '.drawer')
    await page.keyboard.press('Escape')
    await page.waitForSelector('.drawer-backdrop.is-closing')
    assert.match(await runningName(page, '.drawer'), /panel-slide-out/)
    // Уходящий слой не ловит тапы: решение уже принято
    assert.equal(
      await page.evaluate(() => getComputedStyle(document.querySelector('.drawer')).pointerEvents),
      'none'
    )
    await page.waitForFunction(() => !document.querySelector('.drawer'))
    await page.close()
  })

  it('на телефоне лист едет снизу', async () => {
    const page = await openDrawer({ width: 390, height: 740 })
    assert.match(await runningName(page, '.drawer'), /sheet-rise/)
    await settled(page, '.drawer')
    await page.keyboard.press('Escape')
    await page.waitForSelector('.drawer-backdrop.is-closing')
    assert.match(await runningName(page, '.drawer'), /sheet-sink/)
    await page.close()
  })

  /**
   * Высота панели на телефоне не зависит от содержимого — и это главное
   * свойство, а не экономия места: панель наполняется по сети, и высота
   * по содержимому пересчитывалась прямо во время движения. Лист дёргался
   * на полпути, потому что `translateY(100%)` считается от неё.
   *
   * Компактный диалог высоту по-прежнему берёт по содержимому: там
   * приезжать по сети нечему.
   */
  it('на телефоне панель держит высоту экрана независимо от содержимого', async () => {
    const heights = []
    for (const hash of ['', '#tall']) {
      const page = await openDrawer({ width: 390, height: 740, hash })
      await settled(page, '.drawer')
      heights.push(await page.evaluate(
        () => Math.round(document.querySelector('.drawer').getBoundingClientRect().height)
      ))
      await page.close()
    }
    assert.deepEqual(heights, [740, 740], 'короткая и длинная панель обязаны быть одной высоты')
  })

  /**
   * Регресс живой приёмки 07.08: профиль клиента выезжал рвано и как
   * будто подвисал на середине. Причина не в длительности, а в
   * геометрии — ответ сервера приходил, пока лист ещё ехал, и высота
   * пересчитывалась под новым содержимым.
   */
  it('лист не меняет высоту, пока едет, даже если содержимое приехало по сети', async () => {
    const page = await openDrawer({ width: 390, height: 740, hash: '#late' })
    const seen = await page.evaluate(() => new Promise((resolve) => {
      const panel = document.querySelector('.drawer')
      const heights = []
      const tick = () => {
        heights.push(Math.round(panel.getBoundingClientRect().height))
        if (panel.getAnimations().every((a) => a.playState === 'finished')) resolve(heights)
        else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }))
    assert.ok(seen.length >= 3, `движение обязано занять несколько кадров, снято ${seen.length}`)
    assert.equal(
      new Set(seen).size, 1,
      `высота менялась на ходу: ${[...new Set(seen)].join(', ')}`
    )
    await page.close()
  })

  it('компактный диалог на телефоне остаётся по содержимому', async () => {
    const page = await withMotion(await browser.newPage())
    await page.setViewport({ width: 390, height: 740 })
    await page.goto(`${appOrigin}/layers`, { waitUntil: 'networkidle0' })
    await settled(page, '.drawer')
    await page.click('#ask')
    await page.waitForSelector('.confirm-dialog')
    await settled(page, '.sheet')
    const height = await page.evaluate(
      () => Math.round(document.querySelector('.sheet').getBoundingClientRect().height)
    )
    assert.ok(height < 740, `диалог не должен раздуваться во весь экран: ${height}`)
    await page.close()
  })

  /**
   * Уходящий диалог отдаёт клавиатуру сразу, не дожидаясь конца
   * анимации: иначе два Escape подряд срабатывали бы как один — панель
   * под уезжающим диалогом второго нажатия просто не получала.
   */
  it('два Escape подряд закрывают оба слоя', async () => {
    const page = await withMotion(await browser.newPage())
    await page.setViewport({ width: 1440, height: 900 })
    await page.goto(`${appOrigin}/layers`, { waitUntil: 'networkidle0' })
    await settled(page, '.drawer')
    await page.click('#ask')
    await page.waitForSelector('.confirm-dialog')
    await settled(page, '.sheet')

    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.confirm-dialog'))
    await page.waitForFunction(() => !document.querySelector('.drawer'))
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
