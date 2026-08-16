import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import puppeteer from 'puppeteer'

/**
 * Клиентская база в настоящем браузере.
 *
 * Серверный рендер показывает, ЧТО нарисовано, но не отвечает на
 * вопросы, ради которых редизайн затевался: закрывается ли профиль по
 * Escape, возвращается ли фокус на строку, не уезжает ли список боком на
 * телефоне, доходит ли поиск до сервера один раз, а не на каждую букву.
 * Всё это существует только в DOM.
 *
 * Слой данных подменён: сети нет, вызовы записываются в `window`, и по
 * ним проверяется, что отбор, сегменты и порядок ушли НА СЕРВЕР, а не
 * остались фильтром по загруженной странице.
 */

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

const DAY = 86400000
const iso = (ms) => new Date(Date.now() - ms).toISOString()

const GUESTS = [
  {
    /*
     * Живой дефект: `visits` — счётчик лояльности кассы (4), а
     * состоявшихся визитов шесть. Список показывал 6, карточка 4,
     * читалка объявляла 4. Все поверхности обязаны сойтись на 6.
     */
    id: 'g1', name: 'Dana Cohen', phone: '0501234567', visits: 4, total_spent: 128450,
    combined_visits: 6,
    why_segment: {
      visits: 6, from_bookings: 4, from_register: 2, days_since: 3,
      avg_gap_days: 14, spend: 128450, no_shows: 1, cancelled: 0, upcoming: 1,
    },
    segments: ['returning', 'regular', 'vip', 'upcoming'],
    points: 4800, stamps: 2, tags: ['VIP', 'Oat milk'], notes: 'Oat milk, no sugar',
    last_visit_at: iso(0), created_at: '2026-01-02T08:00:00Z',
  },
  {
    id: 'g2', name: 'Maya Peretz', phone: '0524189032', visits: 14, total_spent: 84200,
    points: 2250, stamps: 7, tags: ['Regular'], notes: null,
    last_visit_at: iso(DAY), created_at: '2026-02-11T08:00:00Z',
  },
  {
    // Без имени: строка обязана называться номером и не повторять его
    id: 'g3', name: null, phone: '0547712064', visits: 1, total_spent: 31400,
    points: 800, stamps: 0, tags: [], notes: null,
    last_visit_at: iso(4 * DAY), created_at: '2026-06-01T08:00:00Z',
  },
  {
    // Длинное всё: имя, метка и заметка не должны рвать раскладку
    id: 'g4', name: 'Ноа Шапира-Бен-Ами из пекарни на углу', phone: '0509017472',
    visits: 31, total_spent: 2106400, points: 6100, stamps: 0,
    tags: ['Allergy: peanuts and sesame', 'VIP'], notes: 'x'.repeat(300),
    last_visit_at: iso(6 * DAY), created_at: '2025-12-01T08:00:00Z',
  },
]

const CARD = {
  loyalty_mode: 'points',
  // Карточка приходит из get_guest_card (156/161/162)
  visits: 4,
  combined_visits: 6,
  why_segment: {
    visits: 6, from_bookings: 4, from_register: 2, days_since: 3,
    avg_gap_days: 14, spend: 128450, no_shows: 1, cancelled: 0, upcoming: 1,
  },
  segments: ['returning', 'regular', 'vip', 'upcoming'],
  // Привычки нет: 162 отдаёт пустые день и час, но среднюю компанию считает
  usual: { dow: null, hour: null, party: 2 },
  reservations: {
    total: 6, visits: 6, upcoming: 1, no_shows: 1, cancelled: 0,
    zone: 'Terrace', avg_party: 2,
  },
  favorites: [{ name: 'Cappuccino', qty: 8 }, { name: 'Croissant', qty: 5 }],
  orders: [
    {
      id: 'o1', daily_number: 1842, created_at: iso(3600000), total: 6400,
      loyalty_discount: 500,
      items: [
        { qty: 1, name: 'Cappuccino', variant_name: 'Large', line_total: 1600 },
        { qty: 2, name: 'Croissant', variant_name: null, line_total: 4800 },
      ],
    },
    {
      id: 'o2', daily_number: 1730, created_at: iso(7 * DAY), total: 4200,
      loyalty_discount: 0, items: [{ qty: 1, name: 'Espresso', line_total: 4200 }],
    },
  ],
  events: [
    { created_at: iso(3600000), points_delta: 640, stamps_delta: 1 },
    { created_at: iso(7 * DAY), points_delta: -1200, stamps_delta: -8 },
  ],
}

const TAGS = [
  { tag: 'VIP', guests: 12 },
  { tag: 'Allergy: peanuts and sesame', guests: 4 },
  { tag: 'Oat milk', guests: 9 },
]

const DUPES = [{
  reason: 'phone',
  key: '501234567',
  guests: [
    {
      id: 'g1', name: 'Dana Cohen', phone: '0501234567', visits: 23,
      total_spent: 128450, last_visit_at: iso(0),
    },
    {
      id: 'g5', name: 'Dana', phone: '972501234567', visits: 2,
      total_spent: 5400, last_visit_at: iso(40 * DAY),
    },
  ],
}]

/**
 * Подставной слой данных. Чистые правила берутся настоящие: имя строки,
 * подписи баланса и тексты ошибок — часть проверяемого поведения.
 */
const GUESTS_STUB = `
  export * from ${JSON.stringify(SRC + 'customers.js')}
  const DATA = ${JSON.stringify({ GUESTS, CARD, TAGS, DUPES })}
  const clone = (x) => JSON.parse(JSON.stringify(x))
  const params = new URLSearchParams(location.search)
  window.__CALLS__ = []
  window.__LOADS__ = []

  export async function fetchGuests(filters) {
    window.__LOADS__.push(clone(filters))
    if (params.get('empty')) return []
    return clone(DATA.GUESTS)
  }
  export async function fetchGuestTags() { return clone(DATA.TAGS) }
  export async function fetchDuplicates() {
    return params.get('nodupes') ? [] : clone(DATA.DUPES)
  }
  export async function fetchGuestCard(id) {
    const row = DATA.GUESTS.find((g) => g.id === id) ?? DATA.GUESTS[0]
    return {
      ...clone(DATA.CARD),
      loyalty_mode: params.get('mode') === 'stamps' ? 'stamps' : 'points',
      name: row.name, phone: row.phone, notes: row.notes, tags: row.tags,
      visits: row.visits,
      combined_visits: row.combined_visits ?? clone(DATA.CARD).combined_visits,
    }
  }
  export async function saveGuestProfile(id, patch) {
    window.__CALLS__.push(['saveGuestProfile', id, patch])
    if (patch.phone === '0524189032') throw new Error('phone_taken')
  }
  export async function mergeGuests(targetId, sourceId) {
    window.__CALLS__.push(['mergeGuests', targetId, sourceId])
  }
  export async function anonymizeGuest(id, confirmPhone) {
    window.__CALLS__.push(['anonymizeGuest', id, confirmPhone])
    const row = DATA.GUESTS.find((g) => g.id === id)
    if (confirmPhone !== row.phone) throw new Error('confirm_mismatch')
    if (params.get('upcoming')) throw new Error('has_upcoming_reservation')
  }
`

const ENTRY = `
import { createRoot } from 'react-dom/client'
import { createElement as h, useState } from 'react'
import GuestsManager from ${JSON.stringify(SRC + 'GuestsManager.jsx')}
import { canonicalRoute } from ${JSON.stringify(SRC + 'routing.js')}

const context = {
  organization: { id: 'org-1', name: 'Bulochka' },
  member: { role: 'owner' },
  locations: [{ id: 'loc-1', name: 'Pinsker 29', currency: 'ILS', timezone: 'Asia/Jerusalem' }],
  capabilities: ['pos_operate'],
}

/*
 * Стенд повторяет разбор адреса из App.jsx вместе с переводом устаревших
 * ссылок (canonicalRoute): прежний tab=duplicates обязан открывать
 * Directory в режиме дублей, и проверять это надо в браузере, а не только
 * на чистой функции.
 */
function Harness() {
  const start = canonicalRoute({
    tab: new URLSearchParams(location.search).get('tab'),
    mode: new URLSearchParams(location.search).get('mode'),
    view: 'guests',
  })
  const [tab, setTab] = useState(start.tab)
  const [mode, setMode] = useState(start.mode)
  window.__TAB__ = tab
  window.__MODE__ = mode
  return h(GuestsManager, {
    context,
    tab,
    onTabChange: (next) => { setTab(next); setMode(null) },
    mode,
    onModeChange: setMode,
    locationId: 'loc-1',
    onLocationChange: () => {},
  })
}
createRoot(document.getElementById('root')).render(h(Harness))
`

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

let server
let origin

const guestsStub = {
  name: 'guests-stub',
  setup(b) {
    b.onResolve({ filter: /(^|\/)(\.\/)?guests(\.js)?$/ }, (args) => (
      args.importer.includes('/backoffice/src/')
        ? { path: 'guests-stub', namespace: 'stub' }
        : undefined
    ))
    b.onResolve({ filter: /\/supabase$/ }, () => ({ path: 'supabase-stub', namespace: 'stub' }))
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
      contents: args.path === 'guests-stub'
        ? GUESTS_STUB
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
    plugins: [guestsStub],
    logLevel: 'silent',
  })
  const js = bundle.outputFiles[0].text
  const css = [
    readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8'),
    readFileSync(new URL('../src/responsive.css', import.meta.url), 'utf8'),
  ].join('\n')
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head>
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

/** Страница с загруженной базой и чистым журналом вызовов */
async function open(query = '', width = 1280) {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message)))
  await page.setViewport({ width, height: 900 })
  await page.goto(`${origin}/?${query}`, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => document.querySelector(
    '.cus-row, .section-placeholder, .dup-group'
  ))
  page.errors = errors
  return page
}

const rowText = (i) => `.cus-list .cus-row:nth-of-type(${i})`


describe('клиенты: один счётчик визитов и объяснённые сегменты', { skip }, () => {
  it('строка, подпись для читалки и карточка называют ОДНО число', async () => {
    const page = await open()
    const row = await page.evaluate(() => {
      const el = document.querySelector('.cus-row')
      return {
        cell: el.querySelector('[data-label="Visits"]').textContent.trim(),
        label: el.getAttribute('aria-label'),
      }
    })
    assert.equal(row.cell, '6', 'в ячейке — состоявшиеся визиты')
    assert.match(row.label, /6 visits/, 'читалке объявляется то же самое')
    assert.doesNotMatch(row.label, /4 visits/, 'счётчик лояльности читалке не подсовывается')

    await page.click('.cus-row')
    await page.waitForSelector('.cus-stats')
    const stat = await page.evaluate(() => {
      const box = [...document.querySelectorAll('.cus-stats > div')]
        .find((d) => d.querySelector('span')?.textContent === 'Visits')
      return box?.querySelector('strong')?.textContent?.trim() ?? null
    })
    assert.equal(stat, '6', 'карточка показывает то же число, что список')
    await page.close()
  })

  it('каждый сегмент объяснён и связан со своим обоснованием', async () => {
    const page = await open()
    await page.click('.cus-row')
    await page.waitForSelector('.cus-segment')
    const state = await page.evaluate(() => {
      /*
       * Только чипы КАРТОЧКИ: в строке списка за листом стоит ещё один
       * (основной сегмент), и он объясняется подсказкой по наведению —
       * это отдельная поверхность со своим правилом.
       */
      const profile = document.querySelector('.cus-stats')?.closest('.cus-panel')
        ?? document.querySelector('.cus-stats')?.parentElement
      const chips = [...profile.querySelectorAll('.cus-segment')]
      return chips.map((chip) => {
        const id = chip.getAttribute('aria-describedby')
        const target = id ? document.getElementById(id) : null
        return {
          label: chip.textContent.trim(),
          described: !!target,
          reason: target?.textContent?.trim() ?? null,
        }
      })
    })
    assert.equal(state.length, 4, 'все четыре метки на месте')
    for (const chip of state) {
      assert.ok(chip.described, `метка «${chip.label}» осталась без обоснования`)
      assert.ok(chip.reason && chip.reason.length > 0,
        `у метки «${chip.label}» пустое обоснование`)
    }
    // Обоснование — видимый текст, а не всплывашка по наведению
    const visible = await page.evaluate(() =>
      [...document.querySelectorAll('.cus-why dd')]
        .every((el) => el.offsetHeight > 0))
    assert.equal(visible, true, 'обоснование видно без наведения мышью')
    await page.close()
  })

  it('метка в строке ужимается по слову, а не тянется полем ввода', async () => {
    const page = await open('', 390)
    await page.waitForSelector('.cus-row .cus-segment')
    const box = await page.evaluate(() => {
      const chip = document.querySelector('.cus-row .cus-segment')
      const cell = chip.closest('.cus-cell-name')
      return {
        chip: Math.round(chip.getBoundingClientRect().width),
        cell: Math.round(cell.getBoundingClientRect().width),
        text: chip.textContent.trim(),
      }
    })
    // Ячейка имени — grid: растянутый чип с рамкой читается как пустое поле
    assert.ok(box.chip < box.cell * 0.7,
      `метка «${box.text}» заняла ${box.chip}px из ${box.cell}px — это уже не чип`)
    await page.close()
  })

  it('«обычно» не показывается, когда привычки нет', async () => {
    const page = await open()
    await page.click('.cus-row')
    await page.waitForSelector('.cus-stats')
    const text = await page.evaluate(() => document.body.textContent)
    assert.doesNotMatch(text, /usually (Sun|Mon|Tue|Wed|Thu|Fri|Sat)/,
      '162 отдаёт пустые день и час — чип обязан исчезнуть')
    await page.close()
  })

  it('на телефоне обоснования не рвут лист', async () => {
    const page = await open('', 390)
    await page.click('.cus-row')
    await page.waitForSelector('.cus-segment')

    /*
     * Блок статистики не должен схлопываться. Лист карточки — колонка
     * flex, а `overflow: hidden` разрешает элементу сжаться ниже
     * содержимого: после добавления секций он на телефоне сжался со 119
     * до 27 px, подписи остались, а числа обрезались. Значение, которого
     * не видно, — это отсутствующее значение.
     */
    const stats = await page.evaluate(() => {
      const box = document.querySelector('.cus-stats').getBoundingClientRect().height
      const cell = document.querySelector('.cus-stats > div').getBoundingClientRect().height
      const cells = document.querySelectorAll('.cus-stats > div').length
      return { box: Math.round(box), cell: Math.round(cell), cells }
    })
    assert.equal(stats.cells, 4)
    assert.ok(stats.box >= stats.cell * 2,
      `блок статистики схлопнут: ${stats.box}px при ячейке ${stats.cell}px`)
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement.scrollWidth - document.documentElement.clientWidth
      const drawer = document.querySelector('.drawer') || document.querySelector('.cus-profile')
      const inner = drawer ? drawer.scrollWidth - drawer.clientWidth : 0
      return { doc, inner }
    })
    assert.equal(overflow.doc, 0, 'страница не едет вбок')
    assert.equal(overflow.inner, 0, 'и сам лист тоже')
    await page.close()
  })
})

describe('клиенты: список', { skip }, () => {
  it('колонки подписаны, строка — одна кнопка с полным именем', async () => {
    const page = await open()
    const state = await page.evaluate(() => ({
      columns: [...document.querySelectorAll('.cus-head > span')].map((s) => s.textContent),
      rows: document.querySelectorAll('.cus-row').length,
      tags: [...document.querySelectorAll('.cus-row:first-of-type .cus-tag')].map((t) => t.textContent),
      first: document.querySelector('.cus-row').getAttribute('aria-label'),
      // Шапка не должна ещё раз перечисляться читалке: имя строки уже
      // называет все значения
      headHidden: document.querySelector('.cus-head').getAttribute('aria-hidden'),
      loyalty: document.querySelector('.cus-row .cus-cell-loyalty').textContent,
    }))
    assert.deepEqual(state.columns, ['Customer', 'Loyalty', 'Visits', 'Total spent', 'Last visit'])
    assert.equal(state.rows, 4)
    assert.deepEqual(state.tags, ['VIP', 'Oat milk'])
    assert.equal(state.headHidden, 'true')
    // Режим программы ещё не известен (карточку не открывали): показано
    // ненулевое — у этого гостя штампы
    assert.equal(state.loyalty, '2 stamps')
    // Числа обязаны попасть в доступное имя: aria-label заменяет содержимое
    // 6, а не 4: читалке объявляется КАНОНИЧЕСКИЙ счётчик визитов
    // (161), а не счётчик лояльности кассы — это и был живой дефект.
    assert.match(state.first, /^Open Dana Cohen · 050-123-4567 · 2 stamps · 6 visits · ₪1,284\.50 spent/)
    assert.match(state.first, /tagged VIP, Oat milk/)
    assert.deepEqual(page.errors, [])
    await page.close()
  })

  it('счётчик считает загруженный срез, а не размер базы', async () => {
    const page = await open()
    const count = await page.evaluate(() => document.querySelector('.cus-count').textContent)
    assert.equal(count, '4 customers')
    await page.close()
  })

  it('пустой список отключает выгрузку и объясняет, чего нет', async () => {
    const page = await open('empty=1')
    const state = await page.evaluate(() => ({
      exportDisabled: [...document.querySelectorAll('.page-heading-actions button')]
        .find((b) => b.textContent.includes('Export CSV')).disabled,
      title: document.querySelector('.section-placeholder h2').textContent,
      rows: document.querySelectorAll('.cus-row').length,
    }))
    assert.equal(state.exportDisabled, true)
    assert.equal(state.title, 'No customers yet')
    assert.equal(state.rows, 0)
    await page.close()
  })
})

describe('клиенты: отбор считает сервер', { skip }, () => {
  it('поиск уходит на сервер один раз, а не на каждую букву', async () => {
    const page = await open()
    await page.evaluate(() => { window.__LOADS__.length = 0 })
    await page.type('.cus-search input', 'Dana', { delay: 30 })
    // Внутри окна дребезга сервер не трогаем вовсе
    await new Promise((r) => setTimeout(r, 120))
    const during = await page.evaluate(() => window.__LOADS__.length)
    await page.waitForFunction(() => window.__LOADS__.length > 0)
    await new Promise((r) => setTimeout(r, 250))
    const loads = await page.evaluate(() => window.__LOADS__)
    assert.equal(during, 0, 'запрос ушёл до истечения 300 мс')
    assert.equal(loads.length, 1, 'на четыре буквы должен быть один запрос')
    assert.equal(loads[0].search, 'Dana')
    await page.close()
  })

  it('сегмент и порядок уходят параметрами запроса', async () => {
    const page = await open()
    await page.evaluate(() => { window.__LOADS__.length = 0 })
    await page.evaluate(() => [...document.querySelectorAll('.cus-chip-row [role="radio"]')]
      .find((b) => b.textContent === 'Regulars').click())
    await page.waitForFunction(() => window.__LOADS__.length > 0)
    await page.select('.cus-select select', 'spend')
    await page.waitForFunction(() => window.__LOADS__.length > 1)
    const state = await page.evaluate(() => ({
      loads: window.__LOADS__,
      checked: document.querySelector('[role="radio"][aria-checked="true"]').textContent,
    }))
    assert.equal(state.loads[0].segment, 'regular')
    assert.equal(state.loads[1].sort, 'spend')
    assert.equal(state.checked, 'Regulars')
    await page.close()
  })

  it('метки набираются несколькими и живут вместе с сегментом', async () => {
    const page = await open()
    await page.evaluate(() => { window.__LOADS__.length = 0 })
    await page.click('.cus-chip-row.is-tags .cus-tag-chip:nth-of-type(1)')
    await page.waitForFunction(() => window.__LOADS__.length > 0)
    await page.click('.cus-chip-row.is-tags .cus-tag-chip:nth-of-type(3)')
    await page.waitForFunction(() => window.__LOADS__.length > 1)
    const state = await page.evaluate(() => ({
      last: window.__LOADS__[window.__LOADS__.length - 1],
      pressed: [...document.querySelectorAll('.cus-tag-chip[aria-pressed="true"]')].length,
      summary: document.querySelector('.cus-summary')?.textContent,
    }))
    assert.deepEqual(state.last.tags, ['VIP', 'Oat milk'])
    assert.equal(state.pressed, 2)
    assert.match(state.summary, /tagged VIP \+ Oat milk/)
    await page.close()
  })
})

describe('клиенты: профиль', { skip }, () => {
  it('открывается со всей строки и оставляет список на месте', async () => {
    const page = await open()
    await page.click('.cus-row')
    await page.waitForSelector('.drawer')
    const state = await page.evaluate(() => ({
      title: document.querySelector('.drawer-head h3').textContent,
      phone: document.querySelector('.drawer-sub').textContent,
      listStillThere: Boolean(document.querySelector('.cus-list')),
      selected: document.querySelector('.cus-row.is-selected')?.getAttribute('aria-expanded'),
      // Чтение немодально: соседнюю строку можно открыть щелчком
      modal: document.querySelector('.drawer').getAttribute('aria-modal'),
      stats: [...document.querySelectorAll('.cus-stats > div')].map((d) => d.textContent),
      bookings: [...document.querySelectorAll('.cus-chips .cus-chip')].map((c) => c.textContent),
      sections: [...document.querySelectorAll('.cus-section h4')].map((h) => h.textContent),
      tabs: [...document.querySelectorAll('.cus-tabs button')].map((b) => b.textContent),
    }))
    assert.equal(state.title, 'Dana Cohen')
    assert.equal(state.phone, '050-123-4567')
    assert.ok(state.listStillThere, 'список обязан остаться на месте')
    assert.equal(state.selected, 'true')
    assert.equal(state.modal, null, 'панель чтения не модальна')
    // «Visits6», а не «Visits23»: карточка показывает канонический
    // счётчик визитов (161) — тот же, что строка списка и читалка.
    assert.deepEqual(state.stats, ['Points₪48.00', 'Visits6', 'Total spent₪1,284.50', 'Last visitToday'])
    assert.ok(state.bookings.includes('1 no-show'), 'неявка названа словом')
    // «Segments» — автоматические метки с обоснованием каждой (155/161)
    assert.deepEqual(state.sections,
      ['Segments', 'Bookings', 'Tags', 'Internal note', 'Usually orders'])
    assert.deepEqual(state.tabs, ['Orders', 'Loyalty log'])
    assert.deepEqual(page.errors, [])
    await page.close()
  })

  it('Escape закрывает профиль и возвращает фокус на строку', async () => {
    const page = await open()
    await page.click(rowText(2))
    await page.waitForSelector('.drawer')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.drawer'))
    const focused = await page.evaluate(() => ({
      cls: document.activeElement.className,
      label: document.activeElement.getAttribute('aria-label'),
    }))
    assert.match(focused.cls, /cus-row/)
    assert.match(focused.label, /^Open Maya Peretz/)
    await page.close()
  })

  it('щелчок по соседней строке открывает её, а не закрывает панель', async () => {
    const page = await open()
    await page.click('.cus-row')
    await page.waitForSelector('.drawer')
    await page.click(rowText(2))
    await page.waitForFunction(
      () => document.querySelector('.drawer-head h3')?.textContent === 'Maya Peretz'
    )
    const selected = await page.evaluate(
      () => document.querySelectorAll('.cus-row.is-selected').length
    )
    assert.equal(selected, 1, 'подсвечена ровно одна строка')
    assert.deepEqual(page.errors, [])
    await page.close()
  })

  it('заказ раскрывается в состав и объявляет своё состояние', async () => {
    const page = await open()
    await page.click('.cus-row')
    await page.waitForSelector('.cus-order-head')
    const before = await page.evaluate(
      () => document.querySelector('.cus-order-head').getAttribute('aria-expanded')
    )
    await page.click('.cus-order-head')
    await page.waitForSelector('.cus-order-items')
    const state = await page.evaluate(() => ({
      expanded: document.querySelector('.cus-order-head').getAttribute('aria-expanded'),
      items: [...document.querySelectorAll('.cus-order-item')].map((i) => i.textContent),
    }))
    assert.equal(before, 'false')
    assert.equal(state.expanded, 'true')
    // Вариант позиции и строка скидки лояльности остаются на месте
    assert.ok(state.items[0].includes('Cappuccino · Large'), state.items[0])
    assert.ok(state.items.some((t) => t.includes('Loyalty reward') && t.includes('−₪5.00')))
    await page.close()
  })

  it('журнал лояльности показывает знак начисления', async () => {
    const page = await open()
    await page.click('.cus-row')
    await page.waitForSelector('.cus-tabs')
    await page.evaluate(() => [...document.querySelectorAll('.cus-tabs button')]
      .find((b) => b.textContent === 'Loyalty log').click())
    await page.waitForSelector('.cus-event')
    const deltas = await page.evaluate(
      () => [...document.querySelectorAll('.cus-event-delta')].map((d) => d.textContent)
    )
    assert.deepEqual(deltas, ['+₪6.40', '₪12.00'])
    await page.close()
  })

  it('точка с баллами после первой карточки считает баллами', async () => {
    const page = await open()
    await page.click('.cus-row')
    await page.waitForSelector('.cus-stats')
    await page.keyboard.press('Escape')
    await page.waitForFunction(
      () => document.querySelector('.cus-cell-loyalty').textContent.includes('Points')
    )
    const cells = await page.evaluate(
      () => [...document.querySelectorAll('.cus-cell-loyalty')].map((c) => c.textContent)
    )
    // Штампы больше не показываются никому: режим точки известен
    assert.deepEqual(cells, ['Points ₪48.00', 'Points ₪22.50', 'Points ₪8.00', 'Points ₪61.00'])
    await page.close()
  })

  /*
   * Режим программы приходит только с карточкой (115). Список до этого
   * показывает ненулевое, а после — то, чем точка на самом деле считает.
   */
  it('точка со штампами видит штампы, а не ₪0.00', async () => {
    const page = await open('mode=stamps')
    const before = await page.evaluate(
      () => document.querySelector('.cus-cell-loyalty').textContent
    )
    await page.click('.cus-row')
    await page.waitForSelector('.cus-stats')
    const inCard = await page.evaluate(
      () => document.querySelector('.cus-stats > div').textContent
    )
    await page.keyboard.press('Escape')
    await page.waitForFunction(
      () => document.querySelector('.cus-cell-loyalty').textContent.includes('stamp')
    )
    const cells = await page.evaluate(
      () => [...document.querySelectorAll('.cus-cell-loyalty')].map((c) => c.textContent)
    )
    // До ответа сервера у гостя со штампами и без баллов показывались штампы
    assert.equal(before, '2 stamps')
    assert.equal(inCard, 'Stamps2')
    assert.deepEqual(cells, ['2 stamps', '7 stamps', '0 stamps', '0 stamps'])
    await page.close()
  })
})

describe('клиенты: правка профиля', { skip }, () => {
  it('телефон без изменений не пересылается на сервер', async () => {
    const page = await open()
    await page.click('.cus-row')
    await page.waitForSelector('.drawer')
    await page.evaluate(() => [...document.querySelectorAll('.drawer-head-actions button')]
      .find((b) => b.textContent.includes('Edit')).click())
    await page.waitForSelector('.cus-form')
    // Правка формально модальна: набранное не должно теряться щелчком мимо
    const modal = await page.evaluate(
      () => document.querySelector('.drawer').getAttribute('aria-modal')
    )
    const note = await page.$('.cus-form textarea')
    await note.click()
    await note.type(' extra hot')
    await page.evaluate(() => [...document.querySelectorAll('.cus-form-actions button')]
      .find((b) => b.textContent.includes('Save')).click())
    await page.waitForFunction(() => window.__CALLS__.length > 0)
    const call = await page.evaluate(() => window.__CALLS__[0])
    assert.equal(modal, 'true')
    assert.equal(call[0], 'saveGuestProfile')
    assert.equal(call[2].phone, null, 'неизменённый телефон уходить не должен')
    assert.match(call[2].notes, /extra hot$/)
    await page.close()
  })

  it('занятый номер предлагает слияние, а не «нарушение уникальности»', async () => {
    const page = await open()
    await page.click('.cus-row')
    await page.waitForSelector('.drawer')
    await page.evaluate(() => [...document.querySelectorAll('.drawer-head-actions button')]
      .find((b) => b.textContent.includes('Edit')).click())
    await page.waitForSelector('.cus-form')
    const phone = (await page.$$('.cus-form input'))[1]
    await phone.click({ count: 3 })
    await phone.type('052-418-9032')
    await page.evaluate(() => [...document.querySelectorAll('.cus-form-actions button')]
      .find((b) => b.textContent.includes('Save')).click())
    await page.waitForSelector('.cus-form .form-error')
    const state = await page.evaluate(() => ({
      error: document.querySelector('.cus-form .form-error').textContent,
      role: document.querySelector('.cus-form .form-error').getAttribute('role'),
      // Номер нормализован до цифр, как на сервере
      sent: window.__CALLS__[0][2].phone,
      stillEditing: Boolean(document.querySelector('.cus-form')),
    }))
    assert.match(state.error, /Merge the two profiles instead/)
    assert.equal(state.role, 'alert')
    assert.equal(state.sent, '0524189032')
    assert.ok(state.stillEditing, 'форма не закрывается по ошибке — набранное осталось')
    await page.close()
  })
})

describe('клиенты: дубли', { skip }, () => {
  it('экран дублей адресуем и выбор «что останется» — радиогруппа', async () => {
    const page = await open('tab=duplicates')
    await page.waitForSelector('.dup-group')
    const state = await page.evaluate(() => ({
      pressed: document.querySelector('[aria-pressed="true"]')?.textContent,
      role: document.querySelector('.dup-options').getAttribute('role'),
      checked: document.querySelector('.dup-option[aria-checked="true"] strong').textContent,
      states: [...document.querySelectorAll('.dup-option-state')].map((s) => s.textContent),
      preview: document.querySelector('.dup-preview').textContent,
    }))
    assert.match(state.pressed, /Back to list/)
    assert.equal(state.role, 'radiogroup')
    assert.equal(state.checked, 'Dana Cohen')
    // Выбор не передан одним цветом: у каждого варианта есть слово
    assert.deepEqual(state.states, ['Keeping', 'Disappears from the list'])
    assert.match(state.preview, /old number keeps working/i)
    await page.close()
  })

  it('слияние называет обе стороны и идёт по одной паре', async () => {
    const page = await open('tab=duplicates')
    await page.waitForSelector('.dup-group')
    // Именно кнопка действия, а не вариант выбора внутри радиогруппы
    await page.evaluate(() => document.querySelector('.dup-group > button').click())
    await page.waitForSelector('.confirm-dialog')
    const dialog = await page.evaluate(() => {
      const panel = document.querySelector('.confirm-dialog')
      return {
        // Диалог — ловушка фокуса с именем, а не просто наложение
        role: panel.getAttribute('role'),
        modal: panel.getAttribute('aria-modal'),
        title: panel.querySelector('#confirm-title').textContent,
        keeping: /Keeping: Dana Cohen/.test(panel.textContent),
        gone: /Disappearing from the list: Dana/.test(panel.textContent),
        undone: /cannot be undone/.test(panel.textContent),
      }
    })
    await page.evaluate(() => [...document.querySelectorAll('button')]
      .find((b) => b.textContent.trim() === 'Merge profiles').click())
    await page.waitForFunction(() => window.__CALLS__.length > 0)
    const calls = await page.evaluate(() => window.__CALLS__)
    assert.equal(dialog.role, 'alertdialog')
    assert.equal(dialog.modal, 'true')
    assert.equal(dialog.title, 'Merge into Dana Cohen?')
    assert.ok(dialog.keeping && dialog.gone && dialog.undone, JSON.stringify(dialog))
    assert.deepEqual(calls, [['mergeGuests', 'g1', 'g5']])
    await page.close()
  })

  it('после последнего слияния с экрана есть выход', async () => {
    const page = await open('tab=duplicates&nodupes=1')
    await page.waitForSelector('.section-placeholder')
    const state = await page.evaluate(() => ({
      title: document.querySelector('.section-placeholder h2').textContent,
      action: document.querySelector('.section-placeholder button').textContent,
    }))
    assert.equal(state.title, 'No duplicates left')
    assert.match(state.action, /Back to customers/)
    await page.close()
  })
})

describe('клиенты: стирание данных', { skip }, () => {
  it('чужой номер не стирает клиента', async () => {
    const page = await open()
    await page.click('.cus-row')
    await page.waitForSelector('.cus-privacy button')
    await page.click('.cus-privacy button')
    await page.waitForSelector('.cus-erase-lead')
    const copy = await page.evaluate(() => ({
      lead: document.querySelector('.cus-erase-lead').textContent,
      keep: document.querySelector('.cus-erase-keep').textContent,
      label: document.querySelector('.cus-form label span').textContent,
      modal: document.querySelector('.drawer').getAttribute('aria-modal'),
    }))
    await page.type('.cus-form input', '0509999999')
    await page.evaluate(() => [...document.querySelectorAll('.cus-form-actions button')]
      .find((b) => b.textContent.includes('Erase')).click())
    await page.waitForSelector('.cus-form .form-error')
    const error = await page.evaluate(() => document.querySelector('.form-error').textContent)
    // Что исчезнет, что останется и чей номер набрать — сказано на месте
    assert.match(copy.lead, /Erase the name, phone, note and tags/)
    assert.match(copy.keep, /Orders and receipts stay/)
    assert.match(copy.keep, /can no longer be\s+claimed/)
    assert.match(copy.label, /Type 050-123-4567 to confirm/)
    assert.equal(copy.modal, 'true', 'необратимое действие модально')
    assert.match(error, /phone number does not match/)
    await page.close()
  })

  it('будущая бронь останавливает стирание и объясняет, что сделать', async () => {
    const page = await open('upcoming=1')
    await page.click('.cus-row')
    await page.waitForSelector('.cus-privacy button')
    await page.click('.cus-privacy button')
    await page.waitForSelector('.cus-form input')
    await page.type('.cus-form input', '0501234567')
    await page.evaluate(() => [...document.querySelectorAll('.cus-form-actions button')]
      .find((b) => b.textContent.includes('Erase')).click())
    await page.waitForSelector('.cus-form .form-error')
    const state = await page.evaluate(() => ({
      error: document.querySelector('.form-error').textContent,
      open: Boolean(document.querySelector('.drawer')),
    }))
    assert.match(state.error, /Cancel it first/)
    assert.ok(state.open, 'профиль остаётся открытым: стирание не состоялось')
    await page.close()
  })
})

describe('клиенты: клавиатура', { skip }, () => {
  it('в правке Tab не уводит на страницу за панелью', async () => {
    const page = await open()
    await page.click('.cus-row')
    await page.waitForSelector('.drawer')
    await page.evaluate(() => [...document.querySelectorAll('.drawer-head-actions button')]
      .find((b) => b.textContent.includes('Edit')).click())
    await page.waitForSelector('.cus-form')
    // Прогоняем Tab больше, чем в форме полей: фокус обязан остаться внутри
    for (let i = 0; i < 12; i += 1) await page.keyboard.press('Tab')
    const inside = await page.evaluate(
      () => document.querySelector('.drawer').contains(document.activeElement)
    )
    assert.ok(inside, 'фокус ушёл из модальной правки на список за ней')
    await page.close()
  })

  it('вкладки истории ходят стрелками, как обещает роль tablist', async () => {
    const page = await open()
    await page.click('.cus-row')
    await page.waitForSelector('.cus-tabs button')
    await page.focus('.cus-tabs button[aria-selected="true"]')
    await page.keyboard.press('ArrowRight')
    await page.waitForSelector('.cus-event')
    const state = await page.evaluate(() => ({
      selected: document.querySelector('.cus-tabs [aria-selected="true"]').textContent,
      focused: document.activeElement.textContent,
    }))
    assert.equal(state.selected, 'Loyalty log')
    assert.equal(state.focused, 'Loyalty log')
    await page.close()
  })

  it('Escape в подтверждении слияния возвращает фокус на кнопку', async () => {
    const page = await open('tab=duplicates')
    await page.waitForSelector('.dup-group > button')
    await page.click('.dup-group > button')
    await page.waitForSelector('.confirm-dialog')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.confirm-dialog'))
    const state = await page.evaluate(() => ({
      focused: document.activeElement.textContent,
      calls: window.__CALLS__.length,
    }))
    assert.match(state.focused, /Merge into Dana Cohen/)
    assert.equal(state.calls, 0, 'отменённое слияние на сервер не уходит')
    await page.close()
  })
})

describe('клиенты: телефон и планшет', { skip }, () => {
  it('на 390 px список не уезжает боком', async () => {
    const page = await open('', 390)
    const state = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      head: getComputedStyle(document.querySelector('.cus-head')).display,
      // Строка становится сводкой: имя занимает свою строку целиком
      rowHeight: document.querySelector('.cus-row').getBoundingClientRect().height,
      searchWide: document.querySelector('.cus-search').getBoundingClientRect().width,
      pageWidth: document.documentElement.clientWidth,
    }))
    assert.equal(state.overflow, 0, `страница уехала боком на ${state.overflow}px`)
    assert.equal(state.head, 'none', 'шапка колонок на телефоне бессмысленна')
    assert.ok(state.rowHeight > 74, `строка-сводка должна быть выше табличной: ${state.rowHeight}`)
    assert.ok(state.searchWide > state.pageWidth * 0.8, 'поиск занимает строку целиком')
    await page.close()
  })

  it('на 390 px профиль открывается листом и закрывается', async () => {
    const page = await open('', 390)
    await page.click('.cus-row')
    await page.waitForSelector('.drawer')
    const sheet = await page.evaluate(() => {
      const box = document.querySelector('.drawer').getBoundingClientRect()
      return { width: box.width, page: document.documentElement.clientWidth }
    })
    assert.equal(sheet.width, sheet.page, 'на телефоне панель занимает всю ширину')
    await page.evaluate(() => document.querySelector('[aria-label="Close"]').click())
    await page.waitForFunction(() => !document.querySelector('.drawer'))
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    assert.equal(overflow, 0)
    await page.close()
  })

  it('на планшете цели остаются под палец', async () => {
    const page = await open('', 900)
    const heights = await page.evaluate(() => ({
      chip: document.querySelector('.cus-tag-chip').getBoundingClientRect().height,
      segment: document.querySelector('.segment-chip').getBoundingClientRect().height,
      search: document.querySelector('.cus-search').getBoundingClientRect().height,
      export: [...document.querySelectorAll('button')]
        .find((button) => button.textContent.includes('Export CSV'))
        .getBoundingClientRect().height,
    }))
    for (const [what, height] of Object.entries(heights)) {
      assert.ok(height >= 44, `${what}: ${height}px — меньше 44px под палец`)
    }
    await page.close()
  })

  it('клавиатура проходит список и открывает профиль', async () => {
    const page = await open()
    await page.focus('.cus-row')
    await page.keyboard.press('Enter')
    await page.waitForSelector('.drawer')
    const title = await page.evaluate(() => document.querySelector('.drawer-head h3').textContent)
    assert.equal(title, 'Dana Cohen')
    assert.deepEqual(page.errors, [])
    await page.close()
  })
})
