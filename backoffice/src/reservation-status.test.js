import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { VISIT_STATUS, statusClass, statusLabel, visitState } from './reservation-status.js'

/**
 * Состояние визита названо в одном месте — здесь это и проверяется.
 *
 * Смысл проверок не в подписях как таковых, а в том, что полотно,
 * список и панель визита получают ОДНО состояние из одних и тех же
 * полей брони: пока это считалось в трёх файлах, один визит успевал
 * называться «Seated» на полотне и «Confirmed» в списке.
 */

describe('состояние визита', () => {
  it('посаженный гость — Seated, а не подтверждённый', () => {
    const state = visitState({ status: 'confirmed', arrived_at: '2026-05-17T16:30:00Z' })
    assert.equal(state, 'arrived')
    assert.equal(statusLabel(state), 'Seated')
  })

  it('открытый счёт на кассе тоже означает посадку', () => {
    assert.equal(visitState({ status: 'confirmed', order_id: 'ord-1' }), 'arrived')
  })

  it('заявка гостя ждёт решения', () => {
    assert.equal(visitState({ status: 'new' }), 'pending')
    assert.equal(statusLabel('pending'), 'Pending')
  })

  it('отказ и отмена не притворяются подтверждёнными', () => {
    // На полотне их нет, а в списке они есть — и «Cancelled», показанный
    // как «Confirmed», означал бы для хостес занятый стол.
    assert.equal(visitState({ status: 'cancelled' }), 'cancelled')
    assert.equal(visitState({ status: 'rejected' }), 'rejected')
    assert.equal(statusLabel('rejected'), 'Rejected')
  })

  it('завершённый и не пришедший различаются', () => {
    assert.equal(visitState({ status: 'completed' }), 'done')
    assert.equal(visitState({ status: 'no_show' }), 'noshow')
    assert.equal(statusLabel('noshow'), 'No-show')
  })

  it('у каждого состояния есть и слово, и класс', () => {
    for (const [state, token] of Object.entries(VISIT_STATUS)) {
      assert.ok(token.label, `${state}: подпись обязательна`)
      assert.ok(token.className.startsWith('is-'), `${state}: класс обязателен`)
      assert.equal(statusClass(state), token.className)
    }
  })

  it('незнакомое состояние не роняет экран и не выдумывает цвет', () => {
    assert.equal(statusLabel('nonsense'), 'nonsense')
    assert.equal(statusClass('nonsense'), '')
    assert.equal(statusLabel(undefined), '')
  })
})
