import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { FUNNEL_STEPS, MIN_SESSIONS_FOR_RATE, funnelView } from './reserve-analytics'

/**
 * Воронка брони. Проверяется главное свойство: у всех шагов ОДНА
 * когорта, поэтому доля физически не может выйти за сто процентов — и
 * не потому, что её обрезали, а потому, что знаменатель общий.
 */

const step = (values) => Object.fromEntries(
  FUNNEL_STEPS.map((s, i) => [s.key, values[i]])
)

const shares = (view) => view.rows.map((row) => row.share)
const counts = (view) => view.rows.map((row) => row.value)

describe('funnelView — cohort', () => {
  it('leaves a well-formed nested funnel exactly as reported', () => {
    const view = funnelView(step([100, 80, 60, 40, 25]))
    assert.deepEqual(counts(view), [100, 80, 60, 40, 25])
    assert.equal(view.repaired, false)
    assert.equal(view.top, 100)
    assert.deepEqual(shares(view), [100, 80, 60, 40, 25])
    assert.equal(view.conversion, 25)
  })

  it('reproduces the production case and refuses to produce 200%', () => {
    // Что видел владелец 2026-08-02 за 30 дней: «Picked a time 2 / 200%»
    const view = funnelView(step([1, 1, 2, 0, 0]))
    assert.deepEqual(counts(view), [2, 2, 2, 0, 0])
    assert.equal(view.top, 2)
    assert.equal(view.repaired, true)
    for (const share of shares(view)) {
      assert.ok(share >= 0 && share <= 100, `share out of range: ${share}`)
    }
  })

  it('keeps counts non-increasing for any reported input', () => {
    const inputs = [
      [0, 5, 1, 9, 2], [3, 0, 0, 0, 7], [1, 1, 1, 1, 1],
      [0, 0, 0, 0, 1], [40, 3, 3, 3, 3], [5, 4, 3, 2, 1],
    ]
    for (const input of inputs) {
      const view = funnelView(step(input))
      const values = counts(view)
      for (let i = 1; i < values.length; i += 1) {
        assert.ok(values[i - 1] >= values[i], `not nested for ${input}: ${values}`)
      }
      // Восстановленное число никогда не меньше сообщённого
      view.rows.forEach((row, i) => assert.ok(row.value >= input[i]))
      for (const share of shares(view)) assert.ok(share <= 100)
    }
  })

  it('never invents a rate out of an empty period', () => {
    const view = funnelView(step([0, 0, 0, 0, 0]))
    assert.equal(view.top, 0)
    assert.deepEqual(shares(view), [0, 0, 0, 0, 0])
    assert.equal(view.conversion, null)
    assert.deepEqual(view.rows.map((r) => r.rate), [null, null, null, null, null])
  })

  it('treats a missing, negative or broken payload as zero, not as a rate', () => {
    for (const payload of [null, undefined, {}, { page_view: 'many' }, { page_view: -4 }]) {
      const view = funnelView(payload)
      assert.equal(view.top, 0)
      assert.equal(view.conversion, null)
      assert.deepEqual(counts(view), [0, 0, 0, 0, 0])
    }
  })
})

describe('funnelView — sample size', () => {
  it('withholds percentages while the sample is too small to mean anything', () => {
    const view = funnelView(step([9, 6, 4, 2, 1]))
    assert.equal(view.enough, false)
    assert.equal(view.conversion, null)
    assert.deepEqual(view.rows.map((r) => r.rate), [null, null, null, null, null])
    // Сами числа при этом точные и показываются
    assert.deepEqual(counts(view), [9, 6, 4, 2, 1])
    // И полосы рисуются: сравнить шаги между собой можно всегда
    assert.deepEqual(shares(view), [100, 67, 44, 22, 11])
  })

  it('starts showing percentages at the documented threshold', () => {
    const view = funnelView(step([MIN_SESSIONS_FOR_RATE, 10, 10, 5, 5]))
    assert.equal(view.enough, true)
    assert.equal(view.conversion, 25)
  })
})

describe('funnelView — forward compatibility', () => {
  it('changes nothing once the server sends cohort counts itself', () => {
    // Готовая когорта монотонна, восстановление её не трогает и метка гаснет
    const server = { ...step([120, 118, 90, 70, 55]), calculation_version: 2 }
    const view = funnelView(server)
    assert.equal(view.exact, true)
    assert.equal(view.repaired, false)
    assert.deepEqual(counts(view), [120, 118, 90, 70, 55])
  })

  it('marks the old RPC payload as a defensive estimate', () => {
    const view = funnelView(step([2, 2, 2, 1, 1]))
    assert.equal(view.exact, false)
  })
})
