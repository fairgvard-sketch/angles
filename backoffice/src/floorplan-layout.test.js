import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  GRID_STEP, clampPos, hasUnsavedLayout, layoutChanges, layoutPayload, nudge,
  placeAt, pushHistory, redo, snap, undo, withDefaultPositions,
} from './floorplan-layout.js'

/**
 * Правила раскладки зала.
 *
 * Проверяется то, что легко сломать незаметно: стол не уезжает за холст,
 * несохранённые правки видно, а отмена возвращает ровно предыдущее
 * состояние — иначе владелец потеряет вечер расстановки одним промахом.
 */

const table = (over = {}) => ({
  id: 't1', label: '1', seats: 4, x: 50, y: 50, w: 10, h: 10,
  shape: 'square', placed: true, ...over,
})

describe('границы холста', () => {
  it('стол не уезжает за край — учитывается его половина', () => {
    assert.equal(clampPos(0, 10), 5)
    assert.equal(clampPos(120, 10), 95)
    assert.equal(clampPos(50, 10), 50)
  })

  it('мусор вместо координаты не создаёт NaN на плане', () => {
    assert.equal(clampPos(undefined, 10), 5)
    assert.equal(snap('nonsense'), 0)
  })

  it('позиция округляется к сетке, а не встаёт «почти ровно»', () => {
    assert.equal(snap(11.3), 12.5)
    assert.equal(snap(11.3, 5), 10)
  })
})

describe('столы без координат', () => {
  it('раскладываются сеткой, а не сваливаются в угол', () => {
    const rows = withDefaultPositions([
      { id: 'a', pos_x: null, pos_y: null },
      { id: 'b', pos_x: null, pos_y: null },
    ])
    assert.notDeepEqual([rows[0].x, rows[0].y], [rows[1].x, rows[1].y])
    assert.equal(rows[0].placed, false)
  })

  it('сохранённые координаты не переписываются сеткой', () => {
    const [row] = withDefaultPositions([
      { id: 'a', pos_x: 33, pos_y: 44, width: 12, height: 8, shape: 'circle' },
    ])
    assert.deepEqual([row.x, row.y, row.w, row.h, row.shape], [33, 44, 12, 8, 'circle'])
    assert.equal(row.placed, true)
  })
})

describe('перемещение', () => {
  it('клавиатура двигает на шаг сетки', () => {
    const moved = nudge(table({ x: 50, y: 50 }), 1, 0)
    assert.equal(moved.x, 50 + GRID_STEP)
    assert.equal(moved.y, 50)
  })

  it('у края стол упирается, а не уходит за холст', () => {
    const moved = nudge(table({ x: 95, y: 50, w: 10 }), 1, 0)
    assert.equal(moved.x, 95)
  })

  it('перетаскивание тоже прижимается к сетке и к краям', () => {
    assert.equal(placeAt(table(), 11.3, 200).x, 12.5)
    assert.equal(placeAt(table(), 11.3, 200).y, 95)
  })
})

describe('несохранённые правки', () => {
  const original = [table({ id: 'a' }), table({ id: 'b', x: 20 })]

  it('нетронутый план изменённым не считается', () => {
    assert.deepEqual(layoutChanges(original, original), [])
    assert.equal(hasUnsavedLayout(original, original), false)
  })

  it('дрожание в сотых долях — не изменение', () => {
    // Холст даёт дробные координаты, и строгое равенство объявляло бы
    // несохранённым стол, которого никто не трогал
    const current = [table({ id: 'a', x: 50.004 }), original[1]]
    assert.deepEqual(layoutChanges(original, current), [])
  })

  it('сдвиг, смена формы и размера видны', () => {
    assert.equal(layoutChanges(original, [table({ id: 'a', x: 60 }), original[1]]).length, 1)
    assert.equal(layoutChanges(original, [table({ id: 'a', shape: 'circle' }), original[1]]).length, 1)
    assert.equal(layoutChanges(original, [table({ id: 'a', w: 14 }), original[1]]).length, 1)
  })

  it('никогда не размещённый стол требует сохранения', () => {
    // Иначе сетка-дефолт пересчитывается при каждом открытии плана
    const fresh = [table({ id: 'c', placed: false })]
    assert.equal(hasUnsavedLayout(fresh, fresh), true)
  })

  it('на сервер уходит только то, что он умеет применять', () => {
    const [payload] = layoutPayload([table({ x: 12.3456 })])
    assert.deepEqual(Object.keys(payload), ['id', 'x', 'y', 'w', 'h', 'shape'])
    assert.equal(payload.x, 12.35)
  })
})

describe('отмена и повтор', () => {
  const empty = { past: [], future: [] }

  it('отмена возвращает ровно предыдущее состояние', () => {
    const first = [table({ x: 10 })]
    const second = [table({ x: 20 })]
    const history = pushHistory(empty, first)
    const back = undo(history, second)
    assert.deepEqual(back.state, first)
    assert.deepEqual(back.history.future, [second])
  })

  it('повтор возвращает отменённое', () => {
    const first = [table({ x: 10 })]
    const second = [table({ x: 20 })]
    const back = undo(pushHistory(empty, first), second)
    const forward = redo(back.history, back.state)
    assert.deepEqual(forward.state, second)
  })

  it('новая правка стирает ветку повтора', () => {
    // Иначе «вперёд» вернуло бы состояние из другой истории
    const history = pushHistory({ past: [], future: [[table({ x: 99 })]] }, [table({ x: 10 })])
    assert.deepEqual(history.future, [])
  })

  it('на пустой истории отмена и повтор ничего не ломают', () => {
    assert.equal(undo(empty, []), null)
    assert.equal(redo(empty, []), null)
  })

  it('история не растёт бесконечно', () => {
    let history = empty
    for (let i = 0; i < 80; i += 1) history = pushHistory(history, [table({ x: i })])
    assert.equal(history.past.length, 50)
    // Ограничение съедает самые старые, а не свежие
    assert.equal(history.past[history.past.length - 1][0].x, 79)
  })
})
