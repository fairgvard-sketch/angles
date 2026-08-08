import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import puppeteer from 'puppeteer'

/**
 * Команда в настоящем браузере.
 *
 * Серверный рендер показывает, ЧТО нарисовано, но не отвечает на
 * вопросы, ради которых редизайн затевался: сходится ли колонка доступа
 * с правилом, которое к человеку на самом деле применяется; открывается
 * ли роль прямо из строки права; превращается ли отказ «у человека есть
 * история» в предложение деактивировать; не уезжает ли таблица боком на
 * телефоне.
 *
 * Слой данных подменён, чистые правила взяты настоящие: `can`,
 * `accessSummary` и разбор кодов сервера — часть проверяемого поведения,
 * а не декорация вокруг него.
 */

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

const STAFF = [
  { id: 's1', name: 'Dana', role: 'barista', is_active: true, location_id: 'loc-1', role_id: null, created_at: '2026-01-02' },
  { id: 's2', name: 'Avi', role: 'manager', is_active: true, location_id: 'loc-1', role_id: null, created_at: '2026-01-03' },
  { id: 's3', name: 'Rina', role: 'owner', is_active: true, location_id: null, role_id: null, created_at: '2026-01-01' },
  { id: 's4', name: 'Noa', role: 'barista', is_active: true, location_id: 'loc-2', role_id: 'r1', created_at: '2026-02-01' },
  // Работает на обеих точках, а правила у точек разные
  { id: 's5', name: 'Yossi', role: 'barista', is_active: true, location_id: null, role_id: null, created_at: '2026-03-01' },
  { id: 's6', name: 'Ada', role: 'barista', is_active: false, location_id: 'loc-1', role_id: null, created_at: '2025-11-01' },
]

const ROLES = [
  { id: 'r1', name: 'Senior barista', base: 'manager', perms: ['refund', 'discount'], created_at: '2026-02-01' },
]

const SETTINGS = {
  'loc-1': { perms: { refund: 'manager' } },
  'loc-2': { perms: { refund: 'all' } },
}

/** Смены за окно отчёта: у одного открытая, у другого позавчерашняя */
const day = (back) => {
  const d = new Date()
  d.setDate(d.getDate() - back)
  return d.toISOString().slice(0, 10)
}

const HOURS = {
  staff: [
    { staff_id: 's1', name: 'Dana', seconds: 3600, days: 1, shifts: 1, has_open: true, entries: [{ id: 'e1', day: day(0), dow: 3, clock_in: new Date().toISOString(), clock_out: null, seconds: 3600, is_open: true }] },
    { staff_id: 's2', name: 'Avi', seconds: 7200, days: 1, shifts: 1, has_open: false, entries: [{ id: 'e2', day: day(2), dow: 1, clock_in: '2026-08-03T05:00:00Z', clock_out: '2026-08-03T13:00:00Z', seconds: 28800, is_open: false }] },
  ],
  totals: { seconds: 32400, shifts: 2, days: 2, staff: 2 },
}

const TEAM_STUB = `
  export * from ${JSON.stringify(SRC + 'roster.js')}
  const DATA = ${JSON.stringify({ STAFF, ROLES })}
  const clone = (x) => JSON.parse(JSON.stringify(x))
  const params = new URLSearchParams(location.search)
  window.__CALLS__ = []

  export async function fetchStaff() { return clone(DATA.STAFF) }
  export async function fetchRoles() { return clone(DATA.ROLES) }
  export async function createStaff(input) {
    window.__CALLS__.push(['createStaff', input])
    return 'new-id'
  }
  export async function updateStaff(id, patch) {
    window.__CALLS__.push(['updateStaff', id, patch])
  }
  export async function setStaffPin(id, pin) {
    window.__CALLS__.push(['setStaffPin', id, pin])
  }
  export async function deleteStaff(id) {
    window.__CALLS__.push(['deleteStaff', id])
    // Сервер отказывает человеку с историей — именно этим кодом
    if (!params.get('deletable')) throw new Error('staff has records')
  }
  export async function saveRole(input) {
    window.__CALLS__.push(['saveRole', input])
    return 'r2'
  }
  export async function deleteRole(id) { window.__CALLS__.push(['deleteRole', id]) }
`

const SETTINGS_STUB = `
  const DATA = ${JSON.stringify(SETTINGS)}
  const params = new URLSearchParams(location.search)
  export async function fetchLocation(id) {
    return { id, settings: JSON.parse(JSON.stringify(DATA[id] ?? {})) }
  }
  export async function patchLocationSettings(id, patch) {
    window.__CALLS__.push(['patchLocationSettings', id, patch])
    // Отказ сервера: переключатель обязан вернуться на прежний уровень
    if (params.get('permfail')) throw new Error('permission denied')
    return {}
  }
`

const TIMESHEET_STUB = `
  export * from ${JSON.stringify(SRC + 'hours.js')}
  export const TZ = 'Asia/Jerusalem'
  const DATA = ${JSON.stringify(HOURS)}
  export async function fetchHours() { return JSON.parse(JSON.stringify(DATA)) }
  export async function saveEntry(input) { window.__CALLS__.push(['saveEntry', input]) }
  export async function deleteEntry(id) { window.__CALLS__.push(['deleteEntry', id]) }
`

const ENTRY = `
import { createRoot } from 'react-dom/client'
import { createElement as h, useState } from 'react'
import TeamManager from ${JSON.stringify(SRC + 'TeamManager.jsx')}

const context = {
  organization: { id: 'org-1', name: 'Bulochka' },
  member: { role: 'owner' },
  locations: [
    { id: 'loc-1', name: 'Pinsker 29', currency: 'ILS', timezone: 'Asia/Jerusalem' },
    { id: 'loc-2', name: 'Port', currency: 'ILS', timezone: 'Asia/Jerusalem' },
  ],
  capabilities: ['pos_operate'],
}

function Harness() {
  const [tab, setTab] = useState(new URLSearchParams(location.search).get('tab'))
  window.__TAB__ = tab
  return h(TeamManager, { context, tab, onTabChange: setTab })
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

const stubs = {
  name: 'team-stubs',
  setup(b) {
    const local = (args) => args.importer.includes('/backoffice/src/')
    b.onResolve({ filter: /(^|\/)(\.\/)?team(\.js)?$/ }, (args) => (
      local(args) ? { path: 'team-stub', namespace: 'stub' } : undefined
    ))
    b.onResolve({ filter: /(^|\/)(\.\/)?settings(\.js)?$/ }, (args) => (
      local(args) ? { path: 'settings-stub', namespace: 'stub' } : undefined
    ))
    b.onResolve({ filter: /(^|\/)(\.\/)?timesheet(\.js)?$/ }, (args) => (
      local(args) ? { path: 'timesheet-stub', namespace: 'stub' } : undefined
    ))
    b.onResolve({ filter: /\/supabase$/ }, () => ({ path: 'supabase-stub', namespace: 'stub' }))
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
      contents: {
        'team-stub': TEAM_STUB,
        'settings-stub': SETTINGS_STUB,
        'timesheet-stub': TIMESHEET_STUB,
      }[args.path] ?? 'export const isSupabaseConfigured = true; export const supabase = {}',
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
    plugins: [stubs],
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

/** Страница с загруженным разделом и чистым журналом вызовов */
async function open(query = '', width = 1280) {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message)))
  await page.setViewport({ width, height: 950 })
  await page.goto(`${origin}/?${query}`, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => document.querySelector('.tm-row, .tm-matrix-row, .hrs-row, .section-placeholder'))
  // Настройки точек и смены приезжают отдельно от списка — колонка
  // доступа обязана дождаться их, иначе тест меряет пустое место
  await page.waitForFunction(() => !document.querySelector('.tm-row')
    || document.querySelector('.tm-cell-access')?.textContent.includes('of')
    || document.querySelector('.tm-cell-access')?.textContent.includes('All'))
  page.errors = errors
  return page
}

describe('команда: список людей', { skip }, () => {
  it('колонки подписаны, строка — одна кнопка с полным именем', async () => {
    const page = await open()
    const state = await page.evaluate(() => ({
      columns: [...document.querySelectorAll('.tm-head > span')].map((s) => s.textContent),
      headHidden: document.querySelector('.tm-head').getAttribute('aria-hidden'),
      rows: document.querySelectorAll('.tm-row').length,
      names: [...document.querySelectorAll('.tm-cell-name strong')].map((n) => n.textContent),
      first: document.querySelector('.tm-row').getAttribute('aria-label'),
    }))
    assert.deepEqual(state.columns, ['Person', 'Role', 'Location', 'Access', 'Last shift', 'Status'])
    assert.equal(state.headHidden, 'true')
    assert.equal(state.rows, 6)
    // Работающие впереди по алфавиту, уволенный — в конце, а не в
    // отдельной панели, которая удлиняла страницу вдвое
    assert.deepEqual(state.names, ['Avi', 'Dana', 'Noa', 'Rina', 'Yossi', 'Ada'])
    assert.match(state.first, /^Open Avi · Manager · Pinsker 29 · All 9 actions allowed · Active/)
    assert.deepEqual(page.errors, [])
    await page.close()
  })

  it('доступ посчитан по правилам, которые к человеку применяются', async () => {
    const page = await open()
    const state = await page.evaluate(() => ({
      access: [...document.querySelectorAll('.tm-cell-access')].map((n) => n.textContent),
      roles: [...document.querySelectorAll('.tm-cell-role')].map((n) => n.textContent),
    }))
    // Avi — менеджер (всё), Dana — баристa на точке с менеджерским
    // возвратом и инвентаризацией, Noa — носитель роли из двух действий,
    // Rina — владелец, Yossi работает на двух точках с разными правилами
    assert.deepEqual(state.access, ['All 9', '7 of 9', '2 of 9', 'All 9', 'Varies', '7 of 9'])
    assert.deepEqual(state.roles, ['Manager', 'Barista', 'Senior barista', 'Owner', 'Barista', 'Barista'])
    await page.close()
  })

  it('открытая смена видна в списке, а не только в табеле', async () => {
    const page = await open()
    const state = await page.evaluate(() => ({
      statuses: [...document.querySelectorAll('.tm-status')].map((n) => n.textContent),
      shifts: [...document.querySelectorAll('[data-label="Last shift"]')].map((n) => n.textContent),
    }))
    assert.equal(state.statuses[1], 'On shift', 'Dana отмечена на смене')
    assert.equal(state.shifts[1], 'Now')
    assert.equal(state.shifts[0], '2d ago')
    assert.equal(state.statuses[5], 'Inactive')
    await page.close()
  })

  it('прежняя ссылка на вкладку открывает то, что в ней написано', async () => {
    // Раздел пережил две перестройки. Все четыре прежних адреса ведут
    // на одну страницу — и каждый к своему месту на ней.
    for (const [legacy, focused] of [
      ['roles', 'tm-roles-title'],
      ['perms', 'tm-perms-title'],
      ['access', 'tm-perms-title'],
      ['staff', null],
    ]) {
      const page = await open(`tab=${legacy}`)
      await page.waitForSelector('.tm-matrix-row')
      if (focused) {
        await page.waitForFunction(
          (id) => document.activeElement?.getAttribute('aria-labelledby') === id,
          {}, focused,
        )
      }
      const state = await page.evaluate(() => ({
        selected: document.querySelector('.menu-tabs [aria-selected="true"]').textContent,
        tabs: [...document.querySelectorAll('.menu-tabs [role="tab"]')].map((t) => t.textContent),
        // Секция, к которой подвела ссылка, названа читалке заголовком
        labelledBy: document.activeElement.getAttribute('aria-labelledby'),
      }))
      assert.equal(state.selected, 'People & access', `tab=${legacy}`)
      assert.deepEqual(state.tabs, ['People & access', 'Hours'], 'вкладок ровно две')
      if (focused) assert.equal(state.labelledBy, focused, `tab=${legacy} подвёл не туда`)
      await page.close()
    }
  })

  it('люди, роли и права стоят на одной странице', async () => {
    const page = await open()
    const state = await page.evaluate(() => ({
      people: Boolean(document.querySelector('#tm-people-title')),
      roles: Boolean(document.querySelector('#tm-roles-title')),
      perms: Boolean(document.querySelector('#tm-perms-title')),
      counts: document.querySelector('.tm-section-count')?.textContent,
    }))
    assert.ok(state.people && state.roles && state.perms, JSON.stringify(state))
    // Счёт по всему штату, а не по видимым строкам
    assert.equal(state.counts, '5 active · 1 inactive')
    assert.deepEqual(page.errors, [])
    await page.close()
  })

  it('поиск отбирает по имени и по роли, счёт остаётся честным', async () => {
    const page = await open()
    await page.type('.tm-section-head input', 'senior')
    await page.waitForFunction(() => document.querySelectorAll('.tm-row').length === 1)
    const state = await page.evaluate(() => ({
      names: [...document.querySelectorAll('.tm-cell-name strong')].map((n) => n.textContent),
      found: document.querySelector('.tm-count').textContent,
      counts: document.querySelector('.tm-section-count').textContent,
    }))
    assert.deepEqual(state.names, ['Noa'], 'нашёлся носитель роли, а не совпадение по имени')
    assert.equal(state.found, '1 of 6')
    assert.equal(state.counts, '5 active · 1 inactive', 'счёт штата отбор не трогает')
    await page.close()
  })
})

describe('команда: карточка человека', { skip }, () => {
  it('открывается со всей строки и оставляет список на месте', async () => {
    const page = await open()
    await page.click('.tm-row:nth-of-type(2)')
    await page.waitForSelector('.drawer')
    const state = await page.evaluate(() => ({
      title: document.querySelector('.drawer-head h3').textContent,
      subtitle: document.querySelector('.drawer-sub').textContent,
      listStillThere: Boolean(document.querySelector('.tm-list')),
      modal: document.querySelector('.drawer').getAttribute('aria-modal'),
      source: document.querySelector('.tm-source').textContent,
      allowed: [...document.querySelectorAll('.tm-access li.is-on .tm-access-name')]
        .map((n) => n.childNodes[0].textContent),
    }))
    assert.equal(state.title, 'Dana')
    assert.match(state.subtitle, /Barista · Pinsker 29 · On shift/)
    assert.ok(state.listStillThere, 'список обязан остаться на месте')
    assert.equal(state.modal, null, 'панель чтения не модальна')
    assert.match(state.source, /Location rules at Pinsker 29/)
    assert.ok(!state.allowed.includes('Refunds'), 'возврат на этой точке менеджерский')
    assert.ok(state.allowed.includes('Discounts'))
    await page.close()
  })

  it('носителю роли сказано, что правила точки к нему не применяются', async () => {
    const page = await open()
    await page.click('.tm-row:nth-of-type(3)')
    await page.waitForSelector('.drawer')
    const state = await page.evaluate(() => ({
      source: document.querySelector('.tm-source').textContent,
      allowed: [...document.querySelectorAll('.tm-access li.is-on')].length,
      denied: [...document.querySelectorAll('.tm-access li.is-off .tm-access-name')]
        .map((n) => n.childNodes[0].textContent),
    }))
    assert.match(state.source, /Role “Senior barista” decides everything below/)
    assert.match(state.source, /Location rules do not apply/)
    assert.equal(state.allowed, 2)
    // Точка разрешает закрытие смены всем — но в роли его нет
    assert.ok(state.denied.includes('Close shift'), JSON.stringify(state.denied))
    await page.close()
  })

  it('у человека без точки права показаны по каждой из них', async () => {
    const page = await open()
    await page.click('.tm-row:nth-of-type(5)')
    await page.waitForSelector('.drawer')
    const scopes = await page.evaluate(
      () => [...document.querySelectorAll('.tm-scope h5')].map((n) => n.textContent)
    )
    assert.deepEqual(scopes, ['Pinsker 29', 'Port'])
    await page.close()
  })

  it('смена PIN — действие на месте, а не вторая форма', async () => {
    const page = await open()
    await page.click('.tm-row:nth-of-type(2)')
    await page.waitForSelector('.tm-pin input')
    await page.type('.tm-pin input', '4821')
    await page.evaluate(() => [...document.querySelectorAll('.tm-pin button')]
      .find((b) => b.textContent.includes('Replace PIN')).click())
    // Ждём отрисованное подтверждение, а не сам вызов: запрос уходит
    // раньше, чем React успевает показать его исход
    await page.waitForSelector('.tm-saved')
    const state = await page.evaluate(() => ({
      call: window.__CALLS__[0],
      saved: document.querySelector('.tm-saved')?.textContent,
      value: document.querySelector('.tm-pin input').value,
    }))
    assert.deepEqual(state.call, ['setStaffPin', 's1', '4821'])
    assert.match(state.saved, /PIN replaced/)
    assert.equal(state.value, '', 'поле очищено: PIN не остаётся на экране')
    await page.close()
  })

  it('человек с историей не удаляется, и диалог предлагает деактивацию', async () => {
    const page = await open()
    await page.click('.tm-row:nth-of-type(2)')
    await page.waitForSelector('.tm-remove')
    await page.click('.tm-remove')
    await page.waitForSelector('.confirm-dialog')
    await page.evaluate(() => [...document.querySelectorAll('.confirm-dialog button')]
      .find((b) => b.textContent.trim() === 'Remove').click())
    await page.waitForFunction(
      () => document.querySelector('.confirm-dialog .form-error')
    )
    const state = await page.evaluate(() => ({
      title: document.querySelector('#confirm-title').textContent,
      error: document.querySelector('.confirm-dialog .form-error').textContent,
      confirm: [...document.querySelectorAll('.confirm-dialog button')]
        .map((b) => b.textContent.trim()),
    }))
    // Второе нажатие — уже деактивация, и она уходит патчем, а не delete
    await page.evaluate(() => [...document.querySelectorAll('.confirm-dialog button')]
      .find((b) => b.textContent.trim() === 'Deactivate').click())
    await page.waitForFunction(() => window.__CALLS__.length > 1)
    const calls = await page.evaluate(() => window.__CALLS__)
    assert.equal(state.title, 'This person cannot be deleted')
    assert.match(state.error, /Deactivate them instead/)
    assert.ok(state.confirm.includes('Deactivate'), JSON.stringify(state.confirm))
    assert.deepEqual(calls[0], ['deleteStaff', 's1'])
    assert.deepEqual(calls[1], ['updateStaff', 's1', { is_active: false }])
    await page.close()
  })

  it('щелчок по соседней строке открывает её, а не закрывает панель', async () => {
    const page = await open()
    await page.click('.tm-row:nth-of-type(2)')
    await page.waitForSelector('.drawer')
    await page.click('.tm-row:nth-of-type(4)')
    await page.waitForFunction(
      () => document.querySelector('.drawer-head h3')?.textContent === 'Rina'
    )
    const selected = await page.evaluate(() => document.querySelectorAll('.tm-row.is-selected').length)
    assert.equal(selected, 1, 'подсвечена ровно одна строка')
    assert.deepEqual(page.errors, [])
    await page.close()
  })
})

describe('команда: доступ одной поверхностью', { skip }, () => {
  it('строка права — действие, подсказка и выбор из двух уровней', async () => {
    const page = await open('tab=access')
    await page.waitForSelector('.tm-matrix-row')
    const state = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.tm-matrix-row')]
      const refund = rows.find((r) => r.textContent.startsWith('Refunds'))
      return {
        level: refund.querySelector('[aria-checked="true"]').textContent,
        hint: refund.querySelector('.tm-matrix-name small').textContent,
        // Выбор один из двух, а не две независимые кнопки
        group: refund.querySelector('[role="radiogroup"]') !== null,
        options: refund.querySelectorAll('[role="radio"]').length,
        rows: rows.length,
      }
    })
    assert.equal(state.level, 'Manager')
    assert.match(state.hint, /money back/)
    assert.ok(state.group, 'уровень обязан быть radiogroup')
    assert.equal(state.options, 2)
    assert.equal(state.rows, 9)
    await page.close()
  })

  it('роль открывается из списка ролей рядом', async () => {
    const page = await open('tab=access')
    await page.waitForSelector('.tm-role-row')
    await page.click('.tm-role-row')
    await page.waitForSelector('.drawer')
    const state = await page.evaluate(() => ({
      title: document.querySelector('.drawer-head h3').textContent,
      subtitle: document.querySelector('.drawer-sub').textContent,
      checked: [...document.querySelectorAll('.tm-checks input:checked')]
        .map((i) => i.closest('label').textContent.split(/(?=[A-Z][a-z]+ )/)[0]),
      hint: document.querySelector('.tm-hint').textContent,
    }))
    assert.equal(state.title, 'Senior barista')
    assert.match(state.subtitle, /2 of 9 actions · 1 person/)
    assert.equal(state.checked.length, 2)
    // Про базовый уровень сказана правда: он ничего не выдаёт
    assert.match(state.hint, /grants nothing/)
    assert.match(state.hint, /exactly what is ticked below/)
    await page.close()
  })

  it('переключение права уходит на сервер патчем по точке', async () => {
    const page = await open('tab=access')
    await page.waitForSelector('.tm-matrix-row')
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.tm-matrix-row')]
        .find((r) => r.textContent.startsWith('Refunds'))
      row.querySelector('[aria-checked="false"]').click()
    })
    await page.waitForFunction(() => window.__CALLS__.length > 0)
    const state = await page.evaluate(() => ({
      call: window.__CALLS__[0],
      level: [...document.querySelectorAll('.tm-matrix-row')]
        .find((r) => r.textContent.startsWith('Refunds'))
        .querySelector('[aria-checked="true"]').textContent,
    }))
    assert.deepEqual(state.call, ['patchLocationSettings', 'loc-1', { perms: { refund: 'all' } }])
    assert.equal(state.level, 'Everyone', 'переключатель отзывается сразу')
    await page.close()
  })

  it('смена точки показывает её правила, а не первой в списке', async () => {
    const page = await open('tab=access')
    await page.waitForSelector('.tm-matrix-row')
    // Точка прав — своя, отдельно от фильтра точки в списке людей
    await page.select('.tm-matrix-panel .tm-select select', 'loc-2')
    await page.waitForFunction(() => [...document.querySelectorAll('.tm-matrix-row')]
      .find((r) => r.textContent.startsWith('Refunds'))
      .querySelector('[aria-checked="true"]').textContent === 'Everyone')
    const roles = await page.evaluate(() => document.querySelectorAll('.tm-role-row').length)
    // Роли общие для организации и от точки не зависят
    assert.equal(roles, 1)
    await page.close()
  })

  it('строка роли называет уровень, набор и число носителей', async () => {
    const page = await open()
    await page.waitForSelector('.tm-role-row')
    const state = await page.evaluate(() => ({
      name: document.querySelector('.tm-role-name').textContent,
      meta: document.querySelector('.tm-role-meta').textContent,
      holders: document.querySelector('.tm-role-holders').textContent.trim(),
      label: document.querySelector('.tm-role-row').getAttribute('aria-label'),
    }))
    assert.equal(state.name, 'Senior barista')
    assert.equal(state.meta, 'Manager base · 2 of 9 actions')
    assert.equal(state.holders, '1 person')
    assert.match(state.label, /Open role Senior barista/)
    await page.close()
  })

  it('отказ сервера возвращает переключатель на прежний уровень', async () => {
    const page = await open('tab=access&permfail=1')
    await page.waitForSelector('.tm-matrix-row')
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.tm-matrix-row')]
        .find((r) => r.textContent.startsWith('Refunds'))
      row.querySelector('[aria-checked="false"]').click()
    })
    await page.waitForSelector('.tm-matrix-panel .form-error')
    const state = await page.evaluate(() => ({
      level: [...document.querySelectorAll('.tm-matrix-row')]
        .find((r) => r.textContent.startsWith('Refunds'))
        .querySelector('[aria-checked="true"]').textContent,
      error: document.querySelector('.tm-matrix-panel .form-error').textContent,
      alive: document.querySelector('.tm-matrix-panel .form-error').getAttribute('role'),
      // Обещание, которого сервер не выполнил, не должно остаться на экране
      effect: Boolean(document.querySelector('.tm-effect-live')),
    }))
    assert.equal(state.level, 'Manager', 'уровень откатился к тому, что на сервере')
    assert.match(state.error, /cannot change the team/)
    assert.equal(state.alive, 'alert')
    assert.equal(state.effect, false)
    await page.close()
  })

  it('успешная запись отзывается «Saved»', async () => {
    const page = await open('tab=access')
    await page.waitForSelector('.tm-matrix-row')
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.tm-matrix-row')]
        .find((r) => r.textContent.startsWith('Void order'))
      row.querySelector('[aria-checked="false"]').click()
    })
    await page.waitForFunction(
      () => document.querySelector('.tm-panel-state')?.textContent.includes('Saved')
    )
    const role = await page.evaluate(() => document.querySelector('.tm-panel-state').getAttribute('role'))
    assert.equal(role, 'status')
    await page.close()
  })
})

describe('команда: телефон и клавиатура', { skip }, () => {
  it('на 390 px таблица не уезжает боком', async () => {
    const page = await open('', 390)
    const state = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      head: getComputedStyle(document.querySelector('.tm-head')).display,
      rowHeight: document.querySelector('.tm-row').getBoundingClientRect().height,
    }))
    assert.equal(state.overflow, 0, `страница уехала боком на ${state.overflow}px`)
    assert.equal(state.head, 'none', 'шапка колонок на телефоне бессмысленна')
    assert.ok(state.rowHeight > 74, `строка-сводка должна быть выше табличной: ${state.rowHeight}`)
    await page.close()
  })

  it('на 390 px переключатель права остаётся пальцевым', async () => {
    const page = await open('tab=access', 390)
    await page.waitForSelector('.perm-switch')
    const state = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      button: document.querySelector('.perm-switch button').getBoundingClientRect().height,
    }))
    assert.equal(state.overflow, 0)
    assert.ok(state.button >= 44, `${state.button}px — меньше 44px под палец`)
    await page.close()
  })

  it('Escape закрывает карточку и возвращает фокус на строку', async () => {
    const page = await open()
    await page.click('.tm-row:nth-of-type(2)')
    await page.waitForSelector('.drawer')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.drawer'))
    const focused = await page.evaluate(() => ({
      cls: document.activeElement.className,
      label: document.activeElement.getAttribute('aria-label'),
    }))
    assert.match(focused.cls, /tm-row/)
    assert.match(focused.label, /^Open Dana/)
    await page.close()
  })

  it('вкладки раздела ходят стрелками, как обещает роль tablist', async () => {
    const page = await open()
    await page.focus('.menu-tabs [aria-selected="true"]')
    await page.keyboard.press('ArrowRight')
    await page.waitForFunction(
      () => document.querySelector('.menu-tabs [aria-selected="true"]')?.textContent === 'Hours'
    )
    const state = await page.evaluate(() => ({
      selected: document.querySelector('.menu-tabs [aria-selected="true"]').textContent,
      focused: document.activeElement.textContent,
      // Табель — не карточка под правами, а полноценный экран
      timesheet: Boolean(document.querySelector('.hrs-toolbar')),
      access: Boolean(document.querySelector('.tm-matrix-row')),
    }))
    assert.equal(state.selected, 'Hours')
    assert.equal(state.focused, 'Hours')
    assert.ok(state.timesheet, 'вкладка Hours показывает табель')
    assert.equal(state.access, false, 'права остались на первой вкладке')
    await page.close()
  })

  it('на телефоне список растёт кнопкой, а не вложенной прокруткой', async () => {
    const page = await open('', 390)
    const state = await page.evaluate(() => {
      const scroll = document.querySelector('.tm-scroll')
      const style = getComputedStyle(scroll)
      return {
        overflow: style.overflowY,
        maxHeight: style.maxHeight,
        region: scroll.getAttribute('role'),
        rows: document.querySelectorAll('.tm-row').length,
      }
    })
    // Вложенная прокрутка ловит палец и не отпускает страницу
    assert.equal(state.maxHeight, 'none')
    assert.notEqual(state.overflow, 'auto')
    assert.equal(state.region, null, 'без прокрутки область незачем объявлять')
    assert.equal(state.rows, 6, 'шесть человек влезают в первую порцию')
    await page.close()
  })

  it('на 390 px страница не уезжает боком ни на одной вкладке', async () => {
    for (const query of ['', 'tab=hours']) {
      const page = await open(query, 390)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
      assert.equal(overflow, 0, `${query || 'people'}: уехало на ${overflow}px`)
      await page.close()
    }
  })

  it('вкладки раздела остаются одной стабильной строкой на телефоне', async () => {
    const page = await open('', 390)
    const state = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('.menu-tabs [role="tab"]')]
      const tops = new Set(tabs.map((t) => Math.round(t.getBoundingClientRect().top)))
      return { count: tabs.length, rows: tops.size, height: tabs[0].getBoundingClientRect().height }
    })
    assert.equal(state.count, 2)
    assert.equal(state.rows, 1, 'две вкладки обязаны уместиться в одну строку')
    assert.ok(state.height >= 40, `${state.height}px — мелко для пальца`)
    await page.close()
  })

  it('секции страницы названы заголовками, а не «группой»', async () => {
    const page = await open()
    await page.waitForSelector('.tm-matrix-row')
    const state = await page.evaluate(() => {
      const sections = [...document.querySelectorAll('.tm-section')]
      return sections.map((s) => {
        const id = s.getAttribute('aria-labelledby')
        return { id, heading: document.getElementById(id)?.textContent ?? null }
      })
    })
    assert.deepEqual(state.map((s) => s.heading), ['People', 'Custom roles', 'Default register permissions'])
    await page.close()
  })

  it('на десктопе длинный список прокручивается внутри панели', async () => {
    const page = await open()
    const state = await page.evaluate(() => {
      const scroll = document.querySelector('.tm-scroll')
      const head = document.querySelector('.tm-head')
      return {
        overflow: getComputedStyle(scroll).overflowY,
        bounded: getComputedStyle(scroll).maxHeight !== 'none',
        sticky: getComputedStyle(head).position,
        label: scroll.getAttribute('aria-label'),
      }
    })
    assert.equal(state.overflow, 'auto')
    assert.ok(state.bounded, 'высота списка ограничена, иначе роли уезжают вниз')
    assert.equal(state.sticky, 'sticky', 'шапка колонок держится при прокрутке')
    assert.equal(state.label, 'People')
    await page.close()
  })
})

describe('команда: часы отдельной вкладкой', { skip }, () => {
  it('табель открывается на всю ширину и считает месяц', async () => {
    const page = await open('tab=hours')
    await page.waitForSelector('.hrs-row')
    const state = await page.evaluate(() => ({
      columns: [...document.querySelectorAll('.hrs-head > span')].map((s) => s.textContent),
      names: [...document.querySelectorAll('.hrs-cell-name')].map((n) => n.textContent),
      total: document.querySelector('.hrs-total').textContent,
      // Права и люди остались на своей вкладке, а не уехали под табель
      access: Boolean(document.querySelector('.tm-matrix-row')),
      people: Boolean(document.querySelector('.tm-row')),
    }))
    assert.deepEqual(state.columns, ['Employee', 'Days', 'Shifts', 'Hours'])
    // Отработавшие впереди, остальной штат — следом нулевыми строками
    assert.deepEqual(state.names.slice(0, 2), ['Dana · on shift', 'Avi'])
    assert.match(state.total, /in total/)
    assert.equal(state.access, false)
    assert.equal(state.people, false)
    assert.deepEqual(page.errors, [])
    await page.close()
  })

  it('«Open hours» из карточки открывает табель на этом человеке', async () => {
    const page = await open()
    await page.click('.tm-row:nth-of-type(2)')
    await page.waitForSelector('.drawer')
    await page.evaluate(() => [...document.querySelectorAll('.drawer button')]
      .find((b) => b.textContent.includes('Open hours')).click())
    await page.waitForSelector('#hours-card-title')
    const state = await page.evaluate(() => ({
      tab: document.querySelector('.menu-tabs [aria-selected="true"]').textContent,
      person: document.querySelector('#hours-card-title').textContent,
      // Табель под карточкой обязан остаться: соседа открывают щелчком
      list: document.querySelectorAll('.hrs-row').length > 0,
    }))
    assert.equal(state.tab, 'Hours')
    assert.equal(state.person, 'Dana')
    assert.ok(state.list, 'таблица табеля обязана остаться на месте')
    await page.close()
  })

  it('уйдя из табеля и вернувшись, владелец не получает чужую карточку', async () => {
    const page = await open()
    await page.click('.tm-row:nth-of-type(2)')
    await page.waitForSelector('.drawer')
    await page.evaluate(() => [...document.querySelectorAll('.drawer button')]
      .find((b) => b.textContent.includes('Open hours')).click())
    await page.waitForSelector('#hours-card-title')

    // Назад к людям и снова в часы — уже без выбранного человека
    await page.evaluate(() => [...document.querySelectorAll('.menu-tabs [role="tab"]')]
      .find((t) => t.textContent === 'People & access').click())
    await page.waitForSelector('.tm-row')
    await page.evaluate(() => [...document.querySelectorAll('.menu-tabs [role="tab"]')]
      .find((t) => t.textContent === 'Hours').click())
    await page.waitForSelector('.hrs-row')
    const card = await page.evaluate(() => Boolean(document.querySelector('#hours-card-title')))
    assert.equal(card, false, 'карточка недельной давности не должна открываться сама')
    await page.close()
  })
})

describe('эффект переключения права', { skip }, () => {
  /**
   * Право меняется одним нажатием, но действует на людей. Проверяем, что
   * кабинет говорит, на кого именно, и умеет вернуть как было — без
   * этого владелец узнаёт о потере доступа от людей за прилавком.
   */
  it('называет затронутых поимённо и возвращает как было', async () => {
    const page = await open('tab=access')
    await page.waitForSelector('.tm-matrix-row')
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.tm-matrix-row')]
        .find((r) => r.textContent.startsWith('Refunds'))
      row.querySelector('[aria-checked="false"]').click()
    })
    await page.waitForSelector('.tm-effect-live')
    const shown = await page.evaluate(() => document.querySelector('.tm-effect-live')?.textContent ?? '')
    assert.match(shown, /Refunds/)
    assert.match(shown, /affected/)

    // Отмена возвращает прежний уровень тем же путём — патчем по точке
    await page.evaluate(() => {
      [...document.querySelectorAll('.tm-effect-live button')]
        .find((b) => /Undo/.test(b.textContent)).click()
    })
    await page.waitForFunction(() => window.__CALLS__.length > 1)
    const calls = await page.evaluate(() => window.__CALLS__)
    assert.deepEqual(calls[1], ['patchLocationSettings', 'loc-1', { perms: { refund: 'manager' } }])
    await page.close()
  })
})
