import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  countdownLabel, formatPairCode, pairingUrl, phoneErrorText, phoneSeenLabel, secondsLeft,
} from './waiter-phones.js'
import { WaiterPhoneRow } from './WaiterPhones.jsx'

/**
 * Телефоны официантов (касса 180). Владелец должен получить рабочий QR
 * (ссылка на POS с кодом во фрагменте), код, который можно продиктовать,
 * и понятную кнопку отключения конкретного телефона.
 */

describe('код допуска телефона', () => {
  it('QR ведёт на POS, код — во фрагменте, а не в запросе', () => {
    assert.equal(pairingUrl('K7M2P9QR', 'https://pos.angle.co.il/'), 'https://pos.angle.co.il/waiter/pair#K7M2P9QR')
  })

  it('код читается группами по четыре', () => {
    assert.equal(formatPairCode('K7M2P9QR'), 'K7M2-P9QR')
  })

  it('обратный отсчёт не уходит в минус', () => {
    const now = Date.parse('2026-10-09T10:00:00Z')
    assert.equal(secondsLeft('2026-10-09T10:09:05Z', now), 545)
    assert.equal(countdownLabel(545), '9:05')
    assert.equal(secondsLeft('2026-10-09T09:00:00Z', now), 0)
    assert.equal(countdownLabel(0), '0:00')
  })
})

describe('строка телефона', () => {
  const phone = {
    id: 'w-1', label: 'iPhone · Safari', location_name: 'Пинскер 29',
    silence_seconds: 30, revoked_at: null,
  }
  const row = (p) => renderToStaticMarkup(h(WaiterPhoneRow, { phone: p, busy: false, onRevoke: () => {} }))

  it('кнопка отключения называет конкретный телефон и точку', () => {
    assert.match(row(phone), /Disconnect<span class="visually-hidden"> iPhone · Safari at Пинскер 29/)
  })

  it('отключённый телефон без кнопки и с пометкой', () => {
    const html = row({ ...phone, revoked_at: '2026-10-09T10:00:00Z' })
    assert.match(html, /Disconnected/)
    assert.doesNotMatch(html, /<button/)
  })

  it('давность использования словами', () => {
    assert.equal(phoneSeenLabel({ silence_seconds: null }), 'Not used yet')
    assert.equal(phoneSeenLabel({ silence_seconds: 30 }), 'Active now')
    assert.equal(phoneSeenLabel({ silence_seconds: 7200 }), 'Last used 2h ago')
  })
})

describe('ошибки', () => {
  it('серверные коды переведены в действие для владельца', () => {
    assert.match(phoneErrorText('rate_limited'), /Too many unused codes/)
    assert.match(phoneErrorText('staff session required'), /owner or manager/)
    assert.match(phoneErrorText('boom'), /Try again/)
  })
})
