import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import puppeteer from 'puppeteer'

/**
 * Отчёт «Продажи» в настоящем браузере.
 *
 * Чистые правила (периоды, шкала, охват, выгрузка) проверены модульно.
 * Здесь проверяется то, что живёт только в DOM и ради чего затевался
 * редизайн: чистая выручка и график стоят на одной поверхности, разрезы
 * идут в нужном порядке, пустые не рисуются, отказ сервера не
 * притворяется нулём, график читается с клавиатуры одним входом, а на
 * телефоне страница не уезжает вбок.
 *
 * Сеть подменена: запросы записываются в `window.__REQS__`, и по ним
 * видно, что охват по точкам и границы периода ушли НА СЕРВЕР теми же,
 * какими их показали на экране.
 */

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

const HOURS = [
  [8, 4200, 2], [9, 16800, 6], [10, 29600, 11], [11, 39200, 14], [12, 51400, 17],
  [13, 68400, 18], [14, 61200, 16], [15, 45600, 12], [16, 29800, 9], [17, 22400, 7],
  [18, 15200, 5], [19, 6200, 2],
]

const REPORT = {
  scope: {
    all_locations: false,
    locations: [{ id: 'loc-1', name: 'Bulochka' }],
    tz: 'Asia/Jerusalem',
    currencies: ['ILS'],
  },
  summary: {
    gross_sales: 441240, discounts: 7200, vat: 64100, orders_count: 86,
    avg_check: 4986, refunds: 12600, refunds_count: 2,
  },
  by_hour: HOURS.map(([hour, amount, count]) => ({ hour, amount, count })),
  by_day: [{ day: '2026-08-04', amount: 441240, count: 86 }],
  by_method: [
    { method: 'card', amount: 315640, count: 62 },
    { method: 'cash', amount: 89000, count: 19 },
    // Способ, по которому за период только вернули: сумма отрицательная,
    // и полоса из неё получиться не должна
    { method: 'bit', amount: -3600, count: 0 },
  ],
  top_items: [
    { name: 'Cappuccino', qty: 48, amount: 76800 },
    { name: 'קרואסון חמאה עם שקדים ופרג מהמאפייה שלנו', qty: 31, amount: 62000 },
    { name: 'Shakshuka', qty: 18, amount: 99000 },
  ],
  by_channel: [{ channel: 'pos', amount: 380000, count: 71 }, { channel: 'table_qr', amount: 61240, count: 15 }],
  by_type: [{ type: 'here', amount: 300000, count: 60 }],
  by_staff: [{ name: 'Дана Леви', amount: 441240, count: 86 }],
  by_category: [{ category: 'Coffee', qty: 96, amount: 180000 }],
  by_location: [{ location_id: 'loc-1', name: 'Bulochka', amount: 441240, count: 86 }],
}

const PREVIOUS = {
  ...REPORT,
  summary: { ...REPORT.summary, gross_sales: 408020, orders_count: 79, avg_check: 5165, refunds: 12600 },
}

const EMPTY = {
  scope: REPORT.scope,
  summary: { gross_sales: 0, discounts: 0, vat: 0, orders_count: 0, avg_check: 0, refunds: 0, refunds_count: 0 },
  by_hour: [], by_day: [], by_method: [], top_items: [], by_channel: [],
  by_type: [], by_staff: [], by_category: [], by_location: [],
}

const SALES_STUB = `
  export * from ${JSON.stringify(SRC + 'sales.js')}
  const DATA = ${JSON.stringify({ REPORT, PREVIOUS, EMPTY })}
  const clone = (x) => JSON.parse(JSON.stringify(x))
  const params = new URLSearchParams(location.search)
  window.__REQS__ = []
  let call = 0

  export async function fetchSalesReport(from, to, { locationIds = [] } = {}) {
    window.__REQS__.push({ from: from.toISOString(), to: to.toISOString(), locationIds: [...locationIds] })
    if (params.get('fail')) throw new Error('sales are unavailable')
    if (params.get('empty')) return clone(DATA.EMPTY)
    // Нечётный вызов — текущий период, чётный — прошлый: грузятся парой
    return clone((call++ % 2) === 0 ? DATA.REPORT : DATA.PREVIOUS)
  }
`

const ENTRY = `
import { createRoot } from 'react-dom/client'
import { createElement as h } from 'react'
import SalesOverview from ${JSON.stringify(SRC + 'SalesOverview.jsx')}

const params = new URLSearchParams(location.search)
const many = [
  { id: 'loc-1', name: 'Bulochka' },
  { id: 'loc-2', name: 'Rothschild' },
  { id: 'loc-3', name: 'Florentin' },
]
const context = {
  organization: { id: 'org-1', name: 'Bulochka' },
  member: { role: 'owner' },
  locations: params.get('many') ? many : [many[0]],
  capabilities: ['pos_reports'],
}
createRoot(document.getElementById('root')).render(h(SalesOverview, { context }))
`

let browser = null
let skip = false
try {
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
} catch (error) {
  skip = `no browser for puppeteer (${error.message.split('\n')[0]}); run: npx puppeteer browsers install chrome`
}

let server
let origin

const salesStub = {
  name: 'sales-stub',
  setup(b) {
    b.onResolve({ filter: /(^|\/)(\.\/)?sales(\.js)?$/ }, (args) => (
      args.importer.includes('/backoffice/src/')
        ? { path: 'sales-stub', namespace: 'stub' }
        : undefined
    ))
    b.onResolve({ filter: /\/supabase$/ }, () => ({ path: 'supabase-stub', namespace: 'stub' }))
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
      contents: args.path === 'sales-stub'
        ? SALES_STUB
        : 'export const isSupabaseConfigured = true; export const supabase = {}',
      loader: 'js',
      resolveDir: SRC,
    }))
  },
}

before(async () => {
  if (skip) return
  const bundle = await build({
    stdin: { contents: ENTRY, resolveDir: SRC, loader: 'jsx', sourcefile: 'harness.jsx' },
    bundle: true, write: false, format: 'esm', jsx: 'automatic',
    define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' },
    plugins: [salesStub],
    logLevel: 'silent',
  })
  const js = bundle.outputFiles[0].text
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style>
<style>body { padding: 24px; }</style></head>
<body><div id="root"></div><script type="module">${js}</script></body></html>`
  server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(html)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  origin = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await browser?.close()
  server?.close()
})

async function open(query = '', width = 1280) {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message)))
  await page.setViewport({ width, height: 1000 })
  await page.goto(`${origin}/?${query}`, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => document.querySelector('.sales-report, .form-error'))
  page.errors = errors
  return page
}

describe('продажи: одна поверхность отчёта', { skip }, () => {
  it('чистая выручка — валовая минус возвраты, рядом сравнение и прошлый период', async () => {
    const page = await open()
    const state = await page.evaluate(() => ({
      label: document.querySelector('.sales-net-label').textContent,
      value: document.querySelector('.sales-net-value').textContent,
      delta: document.querySelector('.sales-net-compare .stat-delta').textContent.trim(),
      direction: document.querySelector('.sales-net-compare .stat-delta').className,
      prev: document.querySelector('.sales-net-prev').textContent,
      strip: [...document.querySelectorAll('.sales-strip > div')].map((d) => ([
        d.querySelector('.sales-strip-label').textContent,
        d.querySelector('strong').textContent,
      ])),
    }))
    assert.equal(state.label, 'Net sales')
    // 441240 − 12600 = 428640 агорот
    assert.equal(state.value, '4,286.40 ₪')
    assert.match(state.delta, /8%/)
    assert.match(state.delta, /vs yesterday/)
    assert.match(state.direction, /is-up/)
    // Прошлый период назван словом, а не «−»
    assert.match(state.prev, /^Yesterday 3,954\.20 ₪/)
    assert.deepEqual(state.strip.map((s) => s[0]), ['Gross sales', 'Orders', 'Average check'])
    assert.equal(state.strip[0][1], '4,412.40 ₪')
    assert.equal(state.strip[1][1], '86')
    assert.equal(state.strip[2][1], '49.86 ₪')
    assert.deepEqual(page.errors, [])
    await page.close()
  })

  it('скидки и возвраты стоят со знаком минус и красным, а не как выручка', async () => {
    const page = await open()
    const state = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.sales-adjust > span')]
      return items.map((s) => ({
        label: s.querySelector('.sales-adjust-label').textContent,
        value: s.querySelector('strong').textContent,
        color: getComputedStyle(s.querySelector('strong')).color,
      }))
    })
    assert.equal(state.length, 2)
    assert.equal(state[0].label, 'Discounts')
    assert.match(state[0].value, /^−/)
    assert.equal(state[1].label, 'Refunds ×2')
    assert.equal(state[1].value, '−126 ₪')
    // Красный — уменьшение выручки; зелёного тут быть не может
    assert.match(state[1].color, /rgb\(180, 69, 60\)/)
    await page.close()
  })

  it('период без продаж говорит об этом словом, а не одним нулём', async () => {
    const page = await open('empty=1')
    const state = await page.evaluate(() => ({
      value: document.querySelector('.sales-net-value').textContent,
      note: document.querySelector('.sales-net-empty')?.textContent,
      chart: document.querySelector('.sales-chart .empty-state')?.textContent,
      adjust: Boolean(document.querySelector('.sales-adjust')),
      panels: document.querySelectorAll('.sales-panel').length,
    }))
    assert.equal(state.value, '0 ₪')
    assert.match(state.note, /No sales/)
    assert.match(state.chart, /No sales in this period/)
    assert.equal(state.adjust, false, 'пустой строки поправок быть не должно')
    assert.equal(state.panels, 0, 'пустые разрезы не рисуют пустых панелей')
    await page.close()
  })

  it('отказ сервера остаётся отказом и не превращается в ноль продаж', async () => {
    const page = await open('fail=1')
    const state = await page.evaluate(() => ({
      alert: document.querySelector('[role="alert"]')?.textContent,
      surface: Boolean(document.querySelector('.sales-report')),
      exportDisabled: [...document.querySelectorAll('.page-heading-actions button')]
        .find((b) => b.textContent.includes('Export CSV')).disabled,
    }))
    assert.match(state.alert, /unavailable/)
    assert.equal(state.surface, false, '₪0 вместо ошибки — враньё')
    assert.equal(state.exportDisabled, true)
    await page.close()
  })
})

describe('продажи: разрезы', { skip }, () => {
  it('первыми идут способы оплаты и позиции, остальные — ниже и в своём порядке', async () => {
    const page = await open()
    const state = await page.evaluate(() => ({
      titles: [...document.querySelectorAll('.sales-panel h2')].map((h) => h.textContent.trim()),
      methods: [...document.querySelectorAll('.sales-panel:first-child .sales-row')].map((r) => ([
        r.querySelector('.sales-row-name').textContent,
        r.querySelector('.sales-row-count').textContent,
        r.querySelector('strong').textContent,
        // Полоса — доля от крупнейшей строки, и она не может быть отрицательной
        getComputedStyle(r.querySelector('.sales-meter i')).width,
      ])),
      items: [...document.querySelectorAll('.sales-panel:nth-child(2) .sales-row')].map((r) => ([
        r.querySelector('.sales-rank').textContent,
        r.querySelector('.sales-row-count').textContent,
      ])),
    }))
    assert.deepEqual(state.titles, [
      'Payment methods', 'Top items', 'Channels', 'Order types', 'Staff', 'Categories',
    ])
    assert.deepEqual(state.methods[0].slice(0, 3), ['Card', '62 payments', '3,156.40 ₪'])
    assert.equal(state.methods[1][1], '19 payments')
    // Отрицательная сумма даёт нулевую полосу, а не ширину со знаком
    assert.equal(parseFloat(state.methods[2][3]), 0)
    assert.equal(state.items[0][0], '1.')
    assert.equal(state.items[0][1], '×48')
    await page.close()
  })

  it('длинное имя позиции не выталкивает сумму за край панели', async () => {
    const page = await open()
    const fits = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.sales-panel:nth-child(2) .sales-row')][1]
      const panel = row.closest('.sales-panel')
      const amount = row.querySelector('strong').getBoundingClientRect()
      return amount.right <= panel.getBoundingClientRect().right + 1
    })
    assert.equal(fits, true)
    await page.close()
  })
})

describe('продажи: период и охват', { skip }, () => {
  it('год спрашивается календарным и сравнивается с прошлым годом', async () => {
    const page = await open()
    await page.evaluate(() => { window.__REQS__.length = 0 })
    await page.evaluate(() => [...document.querySelectorAll('.sales-periods button')]
      .find((b) => b.textContent === 'Year').click())
    await page.waitForFunction(() => window.__REQS__.length >= 2)
    const state = await page.evaluate(() => ({
      reqs: window.__REQS__,
      title: document.querySelector('.sales-chart-head h2').textContent,
      selected: [...document.querySelectorAll('.sales-periods button')]
        .filter((b) => b.getAttribute('aria-selected') === 'true').map((b) => b.textContent),
    }))
    const year = new Date().getFullYear()
    assert.equal(new Date(state.reqs[0].from).getFullYear(), year)
    assert.equal(new Date(state.reqs[1].from).getFullYear(), year - 1, 'прошлый год, а не 365 дней назад')
    assert.equal(state.title, 'By month')
    assert.deepEqual(state.selected, ['Year'], 'выбран ровно один период')
    await page.close()
  })

  it('одна точка не получает переключателя, но названа в строке охвата', async () => {
    const page = await open()
    const state = await page.evaluate(() => ({
      picker: Boolean(document.querySelector('.sales-picker')),
      scope: document.querySelector('.scope-line').textContent,
    }))
    assert.equal(state.picker, false, 'переключать нечего — кнопки нет')
    assert.match(state.scope, /Bulochka/)
    assert.match(state.scope, /Asia\/Jerusalem/)
    assert.match(state.scope, /ILS/)
    await page.close()
  })

  it('у сети выбирается несколько точек, и обе уходят на сервер', async () => {
    const page = await open('many=1')
    await page.click('.sales-picker')
    await page.waitForSelector('.sales-loc-pop')
    await page.evaluate(() => { window.__REQS__.length = 0 })
    await page.evaluate(() => {
      const boxes = [...document.querySelectorAll('.sales-loc-option input')]
      boxes[1].click() // Bulochka
      boxes[3].click() // Florentin
    })
    await page.waitForFunction(() => window.__REQS__.some((r) => r.locationIds.length === 2))
    const state = await page.evaluate(() => ({
      last: window.__REQS__[window.__REQS__.length - 1].locationIds,
      summary: document.querySelector('.sales-picker .truncate').textContent,
      expanded: document.querySelector('.sales-picker').getAttribute('aria-expanded'),
    }))
    assert.deepEqual(state.last, ['loc-1', 'loc-3'], 'множественный выбор сохранён')
    assert.equal(state.summary, '2 of 3 locations')
    assert.equal(state.expanded, 'true', 'список остаётся открытым — выбор продолжают')
    await page.close()
  })

  it('произвольные даты не дают перевернуть диапазон', async () => {
    const page = await open()
    await page.evaluate(() => [...document.querySelectorAll('.sales-periods button')]
      .find((b) => b.textContent === 'Dates').click())
    await page.waitForSelector('.sales-dates')
    await page.evaluate(() => { window.__REQS__.length = 0 })
    await page.evaluate(() => {
      const inputs = document.querySelectorAll('.sales-dates input')
      const set = (el, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setter.call(el, value)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      set(inputs[0], '2026-08-01')
      set(inputs[1], '2026-08-03')
    })
    await page.waitForFunction(() => window.__REQS__.length >= 2)
    const state = await page.evaluate(() => ({
      min: document.querySelectorAll('.sales-dates input')[1].getAttribute('min'),
      max: document.querySelectorAll('.sales-dates input')[0].getAttribute('max'),
      reqs: window.__REQS__.slice(0, 2),
    }))
    assert.equal(state.min, '2026-08-01', 'конец не может быть раньше начала')
    assert.equal(state.max, '2026-08-03')
    // Последний выбранный день входит в отчёт целиком: граница — 4 августа
    assert.equal(new Date(state.reqs[0].to).getDate(), 4)
    await page.close()
  })
})

describe('продажи: график', { skip }, () => {
  it('ридаут называет интервал, сумму и заказы, пик выбран сам', async () => {
    const page = await open()
    const state = await page.evaluate(() => ({
      readout: document.querySelector('.chart-readout').textContent,
      bars: document.querySelectorAll('.chart-bar').length,
      active: [...document.querySelectorAll('.chart-bar')]
        .findIndex((b) => b.getAttribute('aria-pressed') === 'true'),
      ticks: [...document.querySelectorAll('.chart-ticks span')].map((s) => s.textContent),
      label: document.querySelector('.chart-bar').getAttribute('aria-label'),
    }))
    assert.match(state.readout, /13:00–14:00/)
    assert.match(state.readout, /684 ₪/)
    assert.match(state.readout, /18 orders/)
    assert.equal(state.bars, 12)
    assert.equal(state.active, 5, 'пиковый час выбран без щелчка')
    // Шкала подписана сверху вниз и начинается с нуля
    assert.equal(state.ticks[state.ticks.length - 1], '0 ₪')
    assert.match(state.label, /08:00–09:00: 42 ₪, 2 orders/)
    await page.close()
  })

  it('вход в график один, дальше стрелки — а не триста шестьдесят пять остановок Tab', async () => {
    const page = await open()
    const stops = await page.evaluate(() => [...document.querySelectorAll('.chart-bar')]
      .filter((b) => b.tabIndex === 0).length)
    assert.equal(stops, 1)
    await page.evaluate(() => [...document.querySelectorAll('.chart-bar')]
      .find((b) => b.tabIndex === 0).focus())
    await page.keyboard.press('ArrowRight')
    const after = await page.evaluate(() => ({
      readout: document.querySelector('.chart-readout').textContent,
      active: [...document.querySelectorAll('.chart-bar')]
        .findIndex((b) => b.getAttribute('aria-pressed') === 'true'),
      focused: document.activeElement.getAttribute('aria-label'),
    }))
    assert.equal(after.active, 6)
    assert.match(after.readout, /14:00–15:00/)
    assert.match(after.focused, /14:00–15:00/)
    await page.close()
  })

  it('смена периода не оставляет выбранным интервал прошлого', async () => {
    const page = await open()
    await page.evaluate(() => document.querySelectorAll('.chart-bar')[1].click())
    await page.evaluate(() => [...document.querySelectorAll('.sales-periods button')]
      .find((b) => b.textContent === 'Year').click())
    await page.waitForFunction(() => document.querySelector('.sales-chart-head h2').textContent === 'By month')
    const active = await page.evaluate(() => [...document.querySelectorAll('.chart-bar')]
      .findIndex((b) => b.getAttribute('aria-pressed') === 'true'))
    assert.notEqual(active, 1, 'выбор прошлого периода не переносится на новый')
    await page.close()
  })
})

describe('продажи: телефон', { skip }, () => {
  it('страница не уезжает вбок на 390px, а график листается внутри себя', async () => {
    const page = await open('', 390)
    const state = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      chartScrolls: (() => {
        const el = document.querySelector('.chart-scroll')
        return el.scrollWidth > el.clientWidth
      })(),
      stripColumns: getComputedStyle(document.querySelector('.sales-strip')).gridTemplateColumns.split(' ').length,
      periods: document.querySelector('.sales-periods').getBoundingClientRect().width <= 390,
    }))
    assert.ok(state.overflow <= 0, `горизонтальная прокрутка страницы: ${state.overflow}px`)
    assert.equal(state.chartScrolls, true, 'график листается сам, не двигая страницу')
    assert.equal(state.stripColumns, 1, 'полоса показателей ложится строками')
    assert.equal(state.periods, true)
    await page.close()
  })

  it('действия и переключатели остаются пальцевыми, а не во всю ширину', async () => {
    const page = await open('many=1', 390)
    const state = await page.evaluate(() => {
      const rect = (s) => document.querySelector(s).getBoundingClientRect()
      return {
        picker: rect('.sales-picker').height,
        period: rect('.sales-periods button').height,
        exportWidth: [...document.querySelectorAll('.page-heading-actions button')]
          .find((b) => b.textContent.includes('Export CSV')).getBoundingClientRect().width,
      }
    })
    assert.ok(state.picker >= 44, `выбор точек ${state.picker}px`)
    assert.ok(state.period >= 44, `период ${state.period}px`)
    assert.ok(state.exportWidth < 390, 'выгрузка не превращается в кнопку во всю ширину')
    await page.close()
  })
})
