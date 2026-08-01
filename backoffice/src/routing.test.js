import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_VIEW, parseRoute, routeToSearch, routeToUrl, sameRoute } from './routing.js'

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

test('sameRoute отличает изменение раздела, точки и вкладки', () => {
  const base = { view: 'orders', locationId: 'a', tab: null }
  assert.equal(sameRoute(base, { ...base }), true)
  assert.equal(sameRoute(base, { ...base, view: 'menu' }), false)
  assert.equal(sameRoute(base, { ...base, locationId: 'b' }), false)
  assert.equal(sameRoute(base, { ...base, tab: 'history' }), false)
})
