import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import puppeteer from 'puppeteer'

/**
 * Каталог в настоящем браузере.
 *
 * Серверный рендер показывает, ЧТО нарисовано, но не отвечает на
 * вопросы, ради которых редизайн затевался: закрывается ли панель по
 * Escape, возвращается ли фокус на строку, не открывает ли Enter на
 * стрелке порядка чужую карточку. Всё это существует только в DOM.
 *
 * Слой данных подменён: сети нет, вызовы записываются в `window`, и по
 * ним проверяется, что до сервера доехал ПОЛНЫЙ список id, а не пара
 * переставленных.
 */

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

const CATALOGUE = {
  categories: [{ id: 'c1', name: 'Hot drinks', location_id: 'loc-1', sort_order: 0 }],
  items: [
    {
      id: 'i1', name: 'Cappuccino', category_id: 'c1', station_id: 's1', price: 1100,
      sku: 'COF-104', description: 'Steamed milk', image_url: 'photo-1.jpg', is_available: true,
      sort_order: 0, item_variants: [], menu_item_modifier_groups: [{ group_id: 'g1', sort_order: 0 }],
    },
    {
      id: 'i2', name: 'Espresso', category_id: 'c1', station_id: 's1', price: 1000,
      sku: 'COF-101', description: 'Double shot', image_url: 'photo-2.jpg', is_available: true,
      sort_order: 1, item_variants: [], menu_item_modifier_groups: [],
    },
    {
      id: 'i3', name: 'Iced latte', category_id: 'c1', station_id: null, price: 0,
      sku: null, description: null, image_url: null, is_available: true,
      sort_order: 2, item_variants: [], menu_item_modifier_groups: [],
    },
  ],
  modifierGroups: [{
    id: 'g1', name: 'Milk choice', min_select: 0, max_select: 1, sort_order: 0,
    modifiers: [
      { id: 'm1', name: 'Regular', price_delta: 0, is_default: true, is_available: true, sort_order: 0 },
      { id: 'm2', name: 'Oat', price_delta: 300, is_default: false, is_available: true, sort_order: 1 },
    ],
  }],
  stations: [
    { id: 's1', name: 'Bar', sort_order: 0 },
    { id: 's2', name: 'Bakery', sort_order: 1 },
  ],
}

const MENU_STUB = `
  export { agorotToShekels, shekelsToAgorot, bulkErrorText } from ${JSON.stringify(SRC + 'menu.js')}
  const DATA = ${JSON.stringify(CATALOGUE)}
  const clone = (x) => JSON.parse(JSON.stringify(x))
  window.__CALLS__ = []
  const record = (name) => async (...args) => { window.__CALLS__.push([name, ...args]) }
  export const fetchCategories = async () => clone(DATA.categories)
  export const fetchItems = async () => clone(DATA.items)
  export const fetchModifierGroups = async () => clone(DATA.modifierGroups)
  export const fetchStations = async () => clone(DATA.stations)
  export const createCategory = record('createCategory')
  export const updateCategory = record('updateCategory')
  export const deleteCategory = record('deleteCategory')
  export const reorderCategories = record('reorderCategories')
  export const saveItem = record('saveItem')
  export const deleteItem = record('deleteItem')
  export const uploadItemImage = async () => ''
  export const bulkUpdateItems = record('bulkUpdateItems')
  export const reorderItems = record('reorderItems')
  export const createModifierGroup = async (...a) => { window.__CALLS__.push(['createModifierGroup', ...a]); return 'g-new' }
  export const updateModifierGroup = record('updateModifierGroup')
  export const deleteModifierGroup = record('deleteModifierGroup')
  export const createModifier = async (...a) => { window.__CALLS__.push(['createModifier', ...a]); return 'm-new' }
  export const updateModifier = record('updateModifier')
  export const deleteModifier = record('deleteModifier')
  export const reorderModifiers = record('reorderModifiers')
  export const setDefaultModifier = record('setDefaultModifier')
  export const createStation = record('createStation')
  export const updateStation = record('updateStation')
  export const deleteStation = record('deleteStation')
  export const reorderStations = record('reorderStations')
  export const setItemStation = record('setItemStation')
`

const ENTRY = `
import { createRoot } from 'react-dom/client'
import { createElement as h, useState } from 'react'
import MenuManager from ${JSON.stringify(SRC + 'MenuManager.jsx')}

const context = {
  organization: { id: 'org-1', name: 'Bulochka' },
  locations: [{ id: 'loc-1', name: 'Pinsker 29' }, { id: 'loc-2', name: 'Herzl 4' }],
  capabilities: ['pos_operate', 'catalog_manage'],
}

function Harness() {
  const [filters, setFilters] = useState({})
  const [tab, setTab] = useState(new URLSearchParams(location.search).get('tab') || 'items')
  window.__FILTERS__ = filters
  return h(MenuManager, {
    context, locationId: 'loc-1', onLocationChange: () => {},
    tab, onTabChange: setTab,
    filters, onFiltersChange: setFilters,
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

const menuStub = {
  name: 'menu-stub',
  setup(b) {
    b.onResolve({ filter: /(^|\/)(\.\/)?menu(\.js)?$/ }, (args) => (
      args.importer.includes('/backoffice/src/')
        ? { path: 'menu-stub', namespace: 'stub' }
        : undefined
    ))
    b.onResolve({ filter: /\/supabase$/ }, () => ({ path: 'supabase-stub', namespace: 'stub' }))
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
      contents: args.path === 'menu-stub'
        ? MENU_STUB
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
    plugins: [menuStub],
    logLevel: 'silent',
  })
  const js = bundle.outputFiles[0].text
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
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

/** Страница с загруженным каталогом и чистым журналом вызовов */
async function open(tab = 'items', width = 1280) {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message)))
  await page.setViewport({ width, height: 900 })
  await page.goto(`${origin}/?tab=${tab}`, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => !document.querySelector('.cat-skeleton'))
  page.errors = errors
  return page
}

const byLabel = (label) => `[aria-label="${label}"]`

/**
 * Заменить содержимое поля.
 *
 * Тройной щелчок здесь не годится: выделение слетало, и «3» дописывалась
 * к нулю — поле получало «03», правило оказывалось верным, а тест
 * проверял не то, что собирался.
 */
async function setNumber(handle, value) {
  await handle.focus()
  await handle.evaluate((el) => el.select())
  await handle.type(value)
}

describe('каталог: панель позиции', { skip }, () => {
  it('открывается кнопкой на имени и держит таблицу на месте', async () => {
    const page = await open()
    await page.click('.cat-open')
    await page.waitForSelector('.drawer')
    const state = await page.evaluate(() => ({
      title: document.querySelector('.drawer-head h3').textContent,
      tableStillThere: Boolean(document.querySelector('.cat-table')),
      rowSelected: Boolean(document.querySelector('.cat-row.is-selected')),
      // Панель чтения немодальная: соседнюю строку можно открыть щелчком
      modal: document.querySelector('.drawer').getAttribute('aria-modal'),
    }))
    assert.equal(state.title, 'Cappuccino')
    assert.ok(state.tableStillThere, 'таблица обязана остаться на месте')
    assert.ok(state.rowSelected, 'строка-источник подсвечена')
    assert.equal(state.modal, null, 'панель чтения не модальна')
    assert.deepEqual(page.errors, [])
    await page.close()
  })

  it('Escape закрывает панель и возвращает фокус на строку', async () => {
    const page = await open()
    await page.click('.cat-open')
    await page.waitForSelector('.drawer')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.drawer'))
    const focused = await page.evaluate(() => ({
      cls: document.activeElement.className,
      text: document.activeElement.textContent,
    }))
    assert.match(focused.cls, /cat-open/)
    assert.equal(focused.text, 'Cappuccino')
    await page.close()
  })

  it('щелчок по соседней строке открывает её, а не закрывает панель', async () => {
    const page = await open()
    await page.click('.cat-open')
    await page.waitForSelector('.drawer')
    await page.evaluate(() => document.querySelectorAll('.cat-open')[1].click())
    await page.waitForFunction(
      () => document.querySelector('.drawer-head h3')?.textContent === 'Espresso'
    )
    assert.deepEqual(page.errors, [])
    await page.close()
  })

  it('правка открывается отдельным решением и сохраняет все поля', async () => {
    const page = await open()
    await page.click('.cat-open')
    await page.waitForSelector('.drawer')
    await page.evaluate(() => [...document.querySelectorAll('.drawer-foot button')]
      .find((b) => b.textContent.includes('Edit item')).click())
    await page.waitForSelector('.cat-form')
    const fields = await page.evaluate(() => ({
      labels: [...document.querySelectorAll('.cat-form label > span')].map((s) => s.textContent),
      modal: document.querySelector('.drawer').getAttribute('aria-modal'),
    }))
    // Ни одно поле прежнего редактора не потеряно
    for (const label of ['Name', 'Base price ₪', 'Category', 'SKU', 'Preparation station', 'Description']) {
      assert.ok(fields.labels.includes(label), `поле «${label}» пропало из редактора`)
    }
    assert.equal(fields.modal, 'true', 'правка модальна: щелчок мимо не должен терять набранное')
    await page.close()
  })
})

describe('каталог: порядок с клавиатуры', { skip }, () => {
  it('Enter на стрелке двигает позицию и НЕ открывает карточку', async () => {
    const page = await open()
    // Стрелки появляются, когда выбрана одна категория и порядок ручной
    await page.select('.cat-toolbar select', 'c1')
    await page.waitForSelector(byLabel('Move Espresso up'))
    await page.focus(byLabel('Move Espresso up'))
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => window.__CALLS__.length > 0)
    const [call, drawer] = await page.evaluate(() => [
      window.__CALLS__[0], Boolean(document.querySelector('.drawer')),
    ])
    assert.equal(call[0], 'reorderItems')
    // Сервер ждёт ПОЛНЫЙ список категории, а не пару переставленных
    assert.deepEqual(call[1], ['i2', 'i1', 'i3'])
    assert.equal(drawer, false, 'стрелка не должна открывать карточку')
    await page.close()
  })

  it('Space на стрелке делает то же самое', async () => {
    const page = await open()
    await page.select('.cat-toolbar select', 'c1')
    await page.waitForSelector(byLabel('Move Cappuccino down'))
    await page.focus(byLabel('Move Cappuccino down'))
    await page.keyboard.press('Space')
    await page.waitForFunction(() => window.__CALLS__.length > 0)
    const [call, drawer] = await page.evaluate(() => [
      window.__CALLS__[0], Boolean(document.querySelector('.drawer')),
    ])
    assert.equal(call[0], 'reorderItems')
    assert.deepEqual(call[1], ['i2', 'i1', 'i3'])
    assert.equal(drawer, false)
    await page.close()
  })

  it('края списка недоступны', async () => {
    const page = await open()
    await page.select('.cat-toolbar select', 'c1')
    await page.waitForSelector(byLabel('Move Cappuccino up'))
    const edges = await page.evaluate(() => ({
      firstUp: document.querySelector('[aria-label="Move Cappuccino up"]').disabled,
      lastDown: document.querySelector('[aria-label="Move Iced latte down"]').disabled,
      middleUp: document.querySelector('[aria-label="Move Espresso up"]').disabled,
    }))
    assert.equal(edges.firstUp, true)
    assert.equal(edges.lastDown, true)
    assert.equal(edges.middleUp, false)
    await page.close()
  })
})

describe('каталог: отбор живёт в адресе', { skip }, () => {
  it('«Needs attention» переезжает в адрес и переживает вкладки', async () => {
    const page = await open()
    await page.click('.cat-chip')
    await page.waitForFunction(() => window.__FILTERS__.fl === 'incomplete')
    const shown = await page.evaluate(
      () => [...document.querySelectorAll('.cat-open')].map((b) => b.textContent)
    )
    // Неполна только позиция без цены, фото и описания
    assert.deepEqual(shown, ['Iced latte'])

    // Уходим на «Станции» и возвращаемся — отбор на месте
    await page.evaluate(() => [...document.querySelectorAll('.cat-tabs button')]
      .find((b) => b.textContent === 'Stations').click())
    await page.waitForSelector('.cat-note')
    await page.evaluate(() => [...document.querySelectorAll('.cat-tabs button')]
      .find((b) => b.textContent === 'Items').click())
    await page.waitForSelector('.cat-table')
    const after = await page.evaluate(
      () => [...document.querySelectorAll('.cat-open')].map((b) => b.textContent)
    )
    assert.deepEqual(after, ['Iced latte'], 'возврат на «Товары» не должен ронять отбор')
    await page.close()
  })
})

describe('каталог: массовая правка показывает, что изменится', { skip }, () => {
  it('предпросмотр называет точное число и «из → во что»', async () => {
    const page = await open()
    await page.evaluate(() => [...document.querySelectorAll('.cat-toolbar button')]
      .find((b) => b.textContent.includes('Select')).click())
    await page.waitForSelector('.cat-bulk')
    await page.evaluate(() => [...document.querySelectorAll('.cat-bulk button')]
      .find((b) => b.textContent.includes('Select all shown')).click())
    await page.evaluate(() => [...document.querySelectorAll('.cat-bulk button')]
      .find((b) => b.textContent.trim() === 'Hide').click())
    await page.waitForSelector('.sheet')
    const preview = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('.bulk-row')].map((r) => r.textContent),
      apply: [...document.querySelectorAll('.sheet button')]
        .find((b) => b.textContent.includes('Apply')).textContent,
    }))
    assert.equal(preview.rows.length, 3)
    assert.ok(preview.rows[0].includes('On sale'))
    assert.ok(preview.rows[0].includes('Hidden'))
    assert.match(preview.apply, /Apply to 3 items/)
    await page.close()
  })
})

describe('каталог: модификаторы и станции', { skip }, () => {
  it('панель группы показывает правило словами и доплату, а не цену', async () => {
    const page = await open('modifiers')
    await page.click('.cat-open')
    await page.waitForSelector('.drawer')
    const drawer = await page.evaluate(() => document.querySelector('.drawer').textContent)
    assert.match(drawer, /Optional · up to 1/)
    assert.match(drawer, /No extra charge/)
    assert.match(drawer, /\+₪3/)
    assert.match(drawer, /Default/)
    assert.deepEqual(page.errors, [])
    await page.close()
  })

  it('порядок модификаторов уходит полным списком id', async () => {
    const page = await open('modifiers')
    await page.click('.cat-open')
    await page.waitForSelector(byLabel('Move Oat up'))
    await page.focus(byLabel('Move Oat up'))
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => window.__CALLS__.length > 0)
    const call = await page.evaluate(() => window.__CALLS__[0])
    assert.equal(call[0], 'reorderModifiers')
    assert.deepEqual(call[1], ['m2', 'm1'])
    await page.close()
  })

  it('порядок станций уходит полным списком id и не открывает панель', async () => {
    const page = await open('stations')
    await page.waitForSelector(byLabel('Move Bakery up'))
    await page.focus(byLabel('Move Bakery up'))
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => window.__CALLS__.length > 0)
    const [call, drawer] = await page.evaluate(() => [
      window.__CALLS__[0], Boolean(document.querySelector('.drawer')),
    ])
    assert.equal(call[0], 'reorderStations')
    assert.deepEqual(call[1], ['s2', 's1'])
    assert.equal(drawer, false)
    await page.close()
  })

  it('удаление станции называет реальное последствие из схемы', async () => {
    const page = await open('stations')
    await page.click(byLabel('Actions for Bar'))
    await page.waitForSelector('.row-menu-pop')
    await page.evaluate(() => [...document.querySelectorAll('.row-menu-pop button')]
      .find((b) => b.textContent.includes('Delete station')).click())
    await page.waitForSelector('[role="alertdialog"]')
    const text = await page.evaluate(() => document.querySelector('[role="alertdialog"]').textContent)
    // ON DELETE SET NULL: позиции остаются и теряют маршрут
    assert.match(text, /stay on sale and lose their preparation station/)
    await page.close()
  })

  it('непривязанные позиции считаются по-настоящему и разбираются на месте', async () => {
    const page = await open('stations')
    const strip = await page.evaluate(() => document.querySelector('.cat-attention').textContent)
    assert.match(strip, /1 catalogue item has no preparation station/)
    await page.evaluate(() => [...document.querySelectorAll('.cat-attention button')]
      .find((b) => b.textContent.includes('Review items')).click())
    await page.waitForSelector('.drawer')
    const drawer = await page.evaluate(() => document.querySelector('.drawer').textContent)
    assert.match(drawer, /Iced latte/)
    assert.match(drawer, /stay on sale/)
    await page.close()
  })
})

describe('каталог: переключение вкладок не роняет раздел', { skip }, () => {
  it('Items → Modifiers → Stations → Items переживает круг', async () => {
    const page = await open()
    for (const label of ['Modifiers', 'Stations', 'Items', 'Modifiers', 'Items']) {
      await page.evaluate((name) => [...document.querySelectorAll('.cat-tabs button')]
        .find((b) => b.textContent === name).click(), label)
      await page.waitForFunction(() => document.querySelector('.cat-panel'))
    }
    const alive = await page.evaluate(() => Boolean(document.querySelector('.cat-table')))
    assert.ok(alive, 'каталог обязан пережить круг по вкладкам')
    assert.deepEqual(page.errors, [])
    await page.close()
  })
})

describe('каталог: режим «By category»', { skip }, () => {
  /** Переключиться в разбивку по категориям */
  const byCategory = (page) => page.evaluate(() => {
    [...document.querySelectorAll('.cat-mode [role="tab"]')]
      .find((b) => b.textContent === 'By category').click()
  })

  it('показывает категорию, её счётчик и ручной порядок без фильтра', async () => {
    const page = await open()
    await byCategory(page)
    await page.waitForSelector('.cat-category')
    const head = await page.evaluate(() => document.querySelector('.cat-category-head').textContent)
    assert.match(head, /Hot drinks/)
    assert.match(head, /3 items/)
    // Внутри категории «выше» и «ниже» осмысленны всегда
    assert.ok(await page.$(byLabel('Move Espresso up')))
    await page.close()
  })

  it('порядок уходит полным списком id ЭТОЙ категории', async () => {
    const page = await open()
    await byCategory(page)
    await page.waitForSelector(byLabel('Move Espresso up'))
    await page.click(byLabel('Move Espresso up'))
    await page.waitForFunction(() => window.__CALLS__.length > 0)
    const call = await page.evaluate(() => window.__CALLS__[0])
    assert.equal(call[0], 'reorderItems')
    assert.deepEqual(call[1], ['i2', 'i1', 'i3'])
    await page.close()
  })

  it('удаление категории спрашивает диалогом кабинета и объясняет последствие', async () => {
    /*
     * Раньше здесь был нативный `confirm`. Он не только выглядит чужим:
     * браузер рисует его без ловушки фокуса и без наших кнопок, а
     * внутри кадра его может не быть вовсе — тогда удаление уходило
     * молча. Проверяем, что спрашивает наш диалог и что нативного
     * окна не появляется.
     */
    const page = await open()
    let native = null
    page.on('dialog', async (d) => { native = d.message(); await d.dismiss() })

    await byCategory(page)
    await page.waitForSelector('.cat-category-head .row-menu button')
    await page.click('.cat-category-head .row-menu button')
    await page.waitForSelector('.row-menu-pop')
    await page.evaluate(() => [...document.querySelectorAll('.row-menu-pop button')]
      .find((b) => b.textContent.includes('Delete category')).click())

    await page.waitForSelector('[role="alertdialog"]')
    const dialog = await page.evaluate(() => {
      const el = document.querySelector('[role="alertdialog"]')
      return { text: el.textContent, modal: el.getAttribute('aria-modal'), focus: document.activeElement.textContent.trim() }
    })
    assert.match(dialog.text, /Delete category “Hot drinks”\?/)
    assert.match(dialog.text, /Items keep existing but lose their category/)
    assert.equal(dialog.modal, 'true')
    assert.equal(dialog.focus, 'Cancel', 'фокус входит в диалог, и не на опасное действие')
    assert.equal(native, null, 'нативного окна браузера быть не должно')

    // Отмена ничего не удаляет
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('[role="alertdialog"]'))
    const calls = await page.evaluate(() => window.__CALLS__.map((c) => c[0]))
    assert.ok(!calls.includes('deleteCategory'), 'отмена не должна удалять')
    await page.close()
  })
})

describe('каталог: диалог категории', { skip }, () => {
  const openDialog = async (page) => {
    await page.evaluate(() => [...document.querySelectorAll('.cat-header-actions button')]
      .find((b) => b.textContent.includes('Add category')).click())
    await page.waitForSelector('.form-dialog')
  }

  it('открывается с текущей точкой и фокусом в первом поле', async () => {
    const page = await open()
    await openDialog(page)
    const state = await page.evaluate(() => ({
      location: document.querySelector('.form-dialog select')?.value,
      focused: document.activeElement.tagName,
      labels: [...document.querySelectorAll('.form-dialog label > span')].map((s) => s.textContent),
    }))
    assert.equal(state.location, 'loc-1', 'текущая точка обязана быть выбрана заранее')
    assert.equal(state.focused, 'INPUT')
    assert.deepEqual(state.labels, ['Category name', 'Location'])
    await page.close()
  })

  it('пустое имя не уходит на сервер', async () => {
    const page = await open()
    await openDialog(page)
    await page.evaluate(() => [...document.querySelectorAll('.form-dialog button')]
      .find((b) => b.textContent.includes('Add category')).click())
    await new Promise((r) => setTimeout(r, 150))
    const state = await page.evaluate(() => ({
      error: document.querySelector('.form-dialog .form-error')?.textContent,
      calls: window.__CALLS__.length,
      open: Boolean(document.querySelector('.form-dialog')),
    }))
    assert.match(state.error, /Give the category a name/)
    assert.equal(state.calls, 0)
    assert.ok(state.open, 'диалог не закрывается, пока форма не принята')
    await page.close()
  })

  it('Escape закрывает диалог и возвращает фокус на кнопку', async () => {
    const page = await open()
    await openDialog(page)
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.form-dialog'))
    const text = await page.evaluate(() => document.activeElement.textContent)
    assert.match(text, /Add category/)
    await page.close()
  })
})

describe('каталог: правило группы проверяется до сохранения', { skip }, () => {
  it('минимум больше максимума не уходит на сервер', async () => {
    const page = await open('modifiers')
    await page.evaluate(() => [...document.querySelectorAll('.cat-header-actions button')]
      .find((b) => b.textContent.includes('Add modifier group')).click())
    await page.waitForSelector('.form-dialog')
    await page.type('.form-dialog input', 'Doneness')
    const [min, max] = await page.$$('.form-dialog .field-row input')
    await setNumber(min, '3')
    await setNumber(max, '1')
    await new Promise((r) => setTimeout(r, 100))
    const preview = await page.evaluate(
      () => document.querySelector('.form-dialog .form-error')?.textContent
    )
    assert.match(preview, /Minimum cannot be greater than maximum/)
    await page.evaluate(() => [...document.querySelectorAll('.form-dialog button')]
      .find((b) => b.textContent.includes('Add group')).click())
    await new Promise((r) => setTimeout(r, 150))
    assert.equal(await page.evaluate(() => window.__CALLS__.length), 0)
    await page.close()
  })

  it('правило читается словами ещё до сохранения', async () => {
    const page = await open('modifiers')
    await page.evaluate(() => [...document.querySelectorAll('.cat-header-actions button')]
      .find((b) => b.textContent.includes('Add modifier group')).click())
    await page.waitForSelector('.form-dialog')
    const [min, max] = await page.$$('.form-dialog .field-row input')
    await setNumber(min, '0')
    await setNumber(max, '0')
    await new Promise((r) => setTimeout(r, 100))
    const hint = await page.evaluate(
      () => [...document.querySelectorAll('.form-dialog .hint')].map((p) => p.textContent).join(' | ')
    )
    // max_select = 0 — это «без ограничения», и так оно и написано
    assert.match(hint, /Optional · unlimited/)
    assert.match(hint, /Maximum 0 means there is no limit/)
    await page.close()
  })
})

describe('каталог: порядок не ломается отбором', { skip }, () => {
  /**
   * Регресс, найденный при самопроверке: стрелки брали список ИЗ
   * ВИДИМЫХ строк. `reorder_menu` расставляет присланным id номера
   * 0..n−1, поэтому отправка отфильтрованной части присваивала эти же
   * номера позициям, которых на экране нет, — порядок категории
   * рассыпался после одного нажатия.
   */
  it('отправляет полный список категории, даже когда поиск прячет часть', async () => {
    const page = await open()
    await page.select('.cat-toolbar select', 'c1')
    await page.waitForSelector(byLabel('Move Espresso up'))
    // Прячем Cappuccino: на экране остаются Espresso и Iced latte
    await page.type('.cat-search input', 'latte')
    await page.waitForFunction(
      () => document.querySelectorAll('.cat-open').length === 1
    )
    await page.click(byLabel('Move Iced latte up'))
    await page.waitForFunction(() => window.__CALLS__.length > 0)
    const call = await page.evaluate(() => window.__CALLS__[0])
    assert.equal(call[0], 'reorderItems')
    // Полная категория, а не одна видимая строка
    assert.deepEqual(call[1], ['i1', 'i3', 'i2'])
    await page.close()
  })

  it('края считаются по всей категории, а не по видимому куску', async () => {
    const page = await open()
    await page.select('.cat-toolbar select', 'c1')
    await page.type('.cat-search input', 'latte')
    await page.waitForFunction(() => document.querySelectorAll('.cat-open').length === 1)
    const edges = await page.evaluate(() => ({
      // Iced latte — последняя в категории: «вниз» недоступно,
      // «вверх» доступно, хотя на экране строка одна
      up: document.querySelector('[aria-label="Move Iced latte up"]').disabled,
      down: document.querySelector('[aria-label="Move Iced latte down"]').disabled,
    }))
    assert.equal(edges.up, false)
    assert.equal(edges.down, true)
    await page.close()
  })
})
