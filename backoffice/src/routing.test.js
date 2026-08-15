import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_VIEW, canonicalRoute, parseRoute, readRoute, routeToSearch, routeToUrl, sameRoute,
} from './routing.js'

/**
 * Адрес кабинета. Проверяется то, ради чего он появился: ссылка
 * открывает тот же раздел, Назад возвращает предыдущий, а устаревшая
 * ссылка не показывает пустой экран.
 */

const ALLOWED = ['overview', 'orders', 'reservations', 'menu']

test('пустой адрес — Dashboard', () => {
  const route = parseRoute('', ALLOWED)
  assert.equal(route.view, DEFAULT_VIEW)
  assert.equal(route.normalized, false)
})

test('раздел читается из адреса', () => {
  assert.equal(parseRoute('?view=orders', ALLOWED).view, 'orders')
  assert.equal(parseRoute('?view=reservations&loc=abc', ALLOWED).locationId, 'abc')
  assert.equal(parseRoute('?view=reservations&tab=waitlist', ALLOWED).tab, 'waitlist')
})

test('неизвестный раздел — Dashboard, адрес требует нормализации', () => {
  const route = parseRoute('?view=nope', ALLOWED)
  assert.equal(route.view, DEFAULT_VIEW)
  assert.equal(route.normalized, true)
})

test('недоступный аккаунту раздел ведёт себя как неизвестный', () => {
  // Menu-only аккаунт открыл ссылку на Team
  const route = parseRoute('?view=team', ['overview', 'menu', 'online'])
  assert.equal(route.view, DEFAULT_VIEW)
  assert.equal(route.normalized, true)
})

test('без списка разделов адрес читается как есть — до загрузки контекста', () => {
  const route = parseRoute('?view=team')
  assert.equal(route.view, 'team')
  assert.equal(route.normalized, false)
})

test('Dashboard не оставляет хвоста в адресе', () => {
  assert.equal(routeToSearch({ view: 'overview' }), '')
  assert.equal(routeToSearch({}), '')
  assert.equal(routeToUrl({ view: 'overview' }), '/account/')
})

test('адрес собирается обратно и переживает круг', () => {
  const route = { view: 'reservations', locationId: 'loc-1', tab: 'timeline' }
  const search = routeToSearch(route)
  assert.equal(search, '?view=reservations&loc=loc-1&tab=timeline')
  const parsed = parseRoute(search, ALLOWED)
  assert.equal(parsed.view, route.view)
  assert.equal(parsed.locationId, route.locationId)
  assert.equal(parsed.tab, route.tab)
})

test('точка сохраняется и на Dashboard — выбор не сбрасывается при возврате', () => {
  assert.equal(routeToSearch({ view: 'overview', locationId: 'loc-9' }), '?loc=loc-9')
})

test('sameRoute отличает изменение раздела, точки, вкладки и дня', () => {
  const base = { view: 'orders', locationId: 'a', tab: null }
  assert.equal(sameRoute(base, { ...base }), true)
  assert.equal(sameRoute(base, { ...base, view: 'menu' }), false)
  assert.equal(sameRoute(base, { ...base, locationId: 'b' }), false)
  assert.equal(sameRoute(base, { ...base, tab: 'history' }), false)
  assert.equal(sameRoute(base, { ...base, date: '2026-05-17' }), false)
  // Отсутствие дня и явный null — это один и тот же «сегодня»
  assert.equal(sameRoute(base, { ...base, date: null }), true)
})

test('рабочий день раздела живёт в адресе', () => {
  const search = routeToSearch({ view: 'reservations', locationId: 'loc-1', date: '2026-05-17' })
  assert.equal(search, '?view=reservations&loc=loc-1&d=2026-05-17')
  assert.equal(parseRoute(search, ALLOWED).date, '2026-05-17')
})

test('испорченный день — не «Invalid Date», а сегодня', () => {
  // Ссылку правят руками и присылают в поддержку обрезанной
  assert.equal(parseRoute('?view=reservations&d=17-05-2026', ALLOWED).date, null)
  assert.equal(parseRoute('?view=reservations&d=', ALLOWED).date, null)
  assert.equal(routeToSearch({ view: 'reservations', date: 'вчера' }), '?view=reservations')
})

// ── Устаревшие адреса после перестройки разделов ─────────────
/**
 * Ссылки на прежние места лежат в закладках владельца и в переписке с
 * поддержкой. Каждая обязана открыть то же содержимое на новом месте —
 * и открыть его СРАЗУ, без второго перехода: `canonicalRoute` чистая и
 * применяется один раз при чтении адреса.
 */

const legacy = (search) => readRoute(search)

test('Sales стал вкладкой отчётов', () => {
  const route = legacy('?view=sales')
  assert.equal(route.view, 'reports')
  assert.equal(route.tab, 'sales')
})

test('фискальная выгрузка уехала из настроек точки в отчёты — вместе с точкой', () => {
  const route = legacy('?view=locations&loc=loc-7&tab=export')
  assert.equal(route.view, 'reports')
  assert.equal(route.tab, 'fiscal')
  // Ссылка вела на выгрузку КОНКРЕТНОЙ точки — она обязана остаться выбранной
  assert.equal(route.locationId, 'loc-7')
})

test('лояльность уехала из настроек точки к клиентам', () => {
  const route = legacy('?view=locations&loc=loc-2&tab=loyalty')
  assert.equal(route.view, 'guests')
  assert.equal(route.tab, 'loyalty')
  assert.equal(route.locationId, 'loc-2')
})

test('прежние вкладки точки переименованы, а не потеряны', () => {
  assert.equal(legacy('?view=locations&tab=general').tab, 'details')
  assert.equal(legacy('?view=locations&tab=receipt').tab, 'receipts')
  assert.equal(legacy('?view=locations&tab=register').tab, 'pos')
  // Раздел при этом остаётся тем же
  assert.equal(legacy('?view=locations&tab=receipt').view, 'locations')
})

test('экран дублей был вкладкой, стал режимом Directory', () => {
  const route = legacy('?view=guests&tab=duplicates')
  assert.equal(route.view, 'guests')
  assert.equal(route.tab, 'directory')
  assert.equal(route.mode, 'duplicates')
})

test('раздел аккаунта отвечает и на прежнее имя', () => {
  assert.equal(legacy('?view=account').view, 'settings')
  assert.equal(legacy('?view=account&tab=products').tab, 'products')
})

test('бронь была вкладкой канала, стала своим разделом', () => {
  const route = legacy('?view=online&tab=reserve&loc=loc-1')
  assert.equal(route.view, 'reserve')
  assert.equal(route.tab, null)
  // Точка обязана уцелеть: ссылка вела в настройки КОНКРЕТНОЙ точки
  assert.equal(route.locationId, 'loc-1')

  // Так адресовала бронь строка «Table booking is off» на главной. Вкладки
  // с этим ключом не существовало, и ссылка молча открывала меню.
  assert.equal(legacy('?view=online&tab=reservations').view, 'reserve')

  // Меню осталось на прежнем адресе — он в закладках
  assert.equal(legacy('?view=online').view, 'online')
  assert.equal(legacy('?view=online&tab=online').tab, null)
})

test('перевод устаревшего адреса устойчив: второй раз ничего не меняет', () => {
  for (const search of [
    '?view=sales', '?view=locations&tab=export', '?view=locations&tab=loyalty',
    '?view=locations&tab=general', '?view=guests&tab=duplicates', '?view=account',
    '?view=online&tab=reserve', '?view=online&tab=reservations',
  ]) {
    const once = readRoute(search)
    assert.deepEqual(canonicalRoute(once), once, `цикл перевода на ${search}`)
  }
})

test('сегодняшние адреса перевод не трогает', () => {
  for (const search of [
    '?view=reports&tab=fiscal', '?view=guests&tab=loyalty', '?view=locations&tab=details',
    '?view=settings&tab=business', '?view=orders', '',
  ]) {
    assert.deepEqual(canonicalRoute(parseRoute(search)), parseRoute(search), search)
  }
})

test('режим живёт в адресе и переживает круг', () => {
  const search = routeToSearch({ view: 'guests', tab: 'directory', mode: 'duplicates' })
  assert.equal(search, '?view=guests&tab=directory&mode=duplicates')
  const parsed = parseRoute(search)
  assert.equal(parsed.mode, 'duplicates')
  // Без режима хвоста в адресе нет
  assert.equal(routeToSearch({ view: 'guests', tab: 'directory' }), '?view=guests&tab=directory')
})

test('sameRoute отличает режим — иначе выход из дублей не менял бы адрес', () => {
  const base = { view: 'guests', locationId: null, tab: 'directory' }
  assert.equal(sameRoute(base, { ...base, mode: 'duplicates' }), false)
  assert.equal(sameRoute(base, { ...base, mode: null }), true)
})
