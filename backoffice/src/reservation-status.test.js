import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  VISIT_STATUS, statusClass, statusLabel, visitActions, visitState,
} from './reservation-status.js'

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

const keys = (reservation) => visitActions(reservation).map((a) => a.key)

describe('что можно сделать с визитом', () => {
  it('заявку подтверждают или отклоняют', () => {
    assert.deepEqual(keys({ status: 'new' }), ['confirmed', 'rejected'])
  })

  it('подтверждённый визит можно отменить прямо с полотна', () => {
    // Ради этого действие и добавлено: раньше отмена жила только в
    // карточках списка, и с полотна за ней приходилось уходить
    assert.ok(keys({ status: 'confirmed' }).includes('cancelled'))
  })

  it('посаженного гостя больше не сажают', () => {
    const seated = keys({ status: 'confirmed', arrived_at: '2026-05-17T17:00:00Z' })
    assert.equal(seated.includes('arrived'), false)
    assert.ok(seated.includes('completed'))
  })

  it('бронь с открытым счётом на кассе кабинет не трогает', () => {
    // Визит живёт в POS-заказе (seat_reservation 057) — сервер всё равно
    // ответит pos_mode, и предлагать кнопку значит врать
    assert.deepEqual(visitActions({ status: 'confirmed', order_id: 'ord-1' }), [])
  })

  it('история не возвращается в работу', () => {
    for (const status of ['completed', 'no_show', 'cancelled', 'rejected']) {
      assert.deepEqual(visitActions({ status }), [], status)
    }
  })

  it('необратимое спрашивает подтверждение', () => {
    const dangerous = visitActions({ status: 'confirmed' }).filter((a) => a.confirm)
    assert.deepEqual(dangerous.map((a) => a.key), ['cancelled'])
    assert.equal(visitActions({ status: 'new' }).find((a) => a.key === 'rejected').confirm, true)
  })
})
