import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { blockerSummary, menuBlockers, reserveBlockers } from './channel-readiness.js'

/**
 * Готовность канала.
 *
 * Главное правило проверяется первым: выдуманных препятствий быть не
 * должно. Пустое расписание — не блокер (сервер трактует отсутствие
 * `hours` как «принимаем всегда»), и если такой пункт когда-нибудь
 * появится, этот тест упадёт.
 */

const categories = [
  { id: 'c1', location_id: 'loc-1', name: 'Кофе' },
  { id: 'c2', location_id: 'loc-2', name: 'Чужая точка' },
]
const items = [
  { id: 'i1', category_id: 'c1', is_available: true },
  { id: 'i2', category_id: 'c1', is_available: false },
  { id: 'i3', category_id: 'c2', is_available: true },
]

describe('блокеры гостевого меню', () => {
  it('готовое меню не выдумывает препятствий', () => {
    assert.deepEqual(
      menuBlockers({ categories, items, locationId: 'loc-1', tables: [], settings: {} }),
      [],
    )
  })

  it('пустое расписание блокером НЕ считается', () => {
    // Сервер (112): нет ключа hours — приём в любое время
    const blockers = menuBlockers({
      categories, items, locationId: 'loc-1', tables: [], settings: { hours: null },
    })
    assert.equal(blockers.length, 0)
  })

  it('меню чужой точки не спасает эту', () => {
    const blockers = menuBlockers({
      categories, items, locationId: 'loc-3', tables: [], settings: {},
    })
    assert.equal(blockers[0].id, 'no-categories')
    assert.equal(blockers[0].action.view, 'menu')
  })

  it('все позиции скрыты — гость увидит пустую страницу', () => {
    const hidden = items.map((i) => ({ ...i, is_available: false }))
    const blockers = menuBlockers({
      categories, items: hidden, locationId: 'loc-1', tables: [], settings: {},
    })
    assert.equal(blockers[0].id, 'nothing-on-sale')
    assert.match(blockers[0].title, /hidden/)
  })

  it('столы нужны только тому, кто включил обслуживание за столом', () => {
    const withoutDineIn = menuBlockers({
      categories, items, locationId: 'loc-1', tables: [], settings: { types: ['takeaway'] },
    })
    assert.equal(withoutDineIn.length, 0, 'на вынос столы не нужны')

    const withDineIn = menuBlockers({
      categories, items, locationId: 'loc-1', tables: [], settings: { types: ['here'] },
    })
    assert.equal(withDineIn[0].id, 'no-tables')
  })

  it('без данных каталога молчит, а не пугает', () => {
    assert.deepEqual(menuBlockers({}), [])
    assert.deepEqual(menuBlockers({ categories: null, items: null }), [])
  })
})

describe('блокеры страницы брони', () => {
  const checklist = {
    ready: false,
    steps: [
      { key: 'tables', done: true },
      { key: 'schedule', done: false },
      { key: 'policy', done: false },
      { key: 'branding', done: true },
      { key: 'link', done: true },
      { key: 'test_booking', done: false },
    ],
  }

  it('берёт невыполненное с сервера, а не считает заново', () => {
    const blockers = reserveBlockers(checklist)
    assert.deepEqual(blockers.map((b) => b.id), ['schedule', 'policy'])
    assert.ok(blockers[0].title, 'у шага есть человеческое название')
  })

  it('тестовая бронь гостю не мешает и в блокеры не идёт', () => {
    assert.ok(!reserveBlockers(checklist).some((b) => b.id === 'test_booking'))
  })

  it('каждый блокер ведёт туда, где он чинится', () => {
    for (const blocker of reserveBlockers(checklist)) {
      assert.ok(blocker.action, `${blocker.id} без адреса — это тревога, а не помощь`)
    }
  })

  it('пока чеклист не загружен — пусто', () => {
    assert.deepEqual(reserveBlockers(null), [])
    assert.deepEqual(reserveBlockers({}), [])
  })
})

describe('заголовок полосы', () => {
  it('считает и называет канал', () => {
    assert.equal(blockerSummary([{ id: 'a' }], 'online'), 'One thing to fix before guests can order')
    assert.equal(
      blockerSummary([{ id: 'a' }, { id: 'b' }], 'reserve'),
      '2 things to fix before guests can book',
    )
  })

  it('когда всё готово — полосы нет вовсе', () => {
    assert.equal(blockerSummary([], 'online'), null)
  })
})
