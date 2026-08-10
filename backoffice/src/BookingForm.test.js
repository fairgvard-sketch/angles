import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import BookingForm from './BookingForm.jsx'

const noop = () => {}

function render() {
  return renderToStaticMarkup(h(BookingForm, {
    locationId: 'loc-1',
    tables: [
      { id: 't-1', label: 'Terrace 1', seats: 2, blocked: false, zoneId: 'terrace', zoneName: 'Terrace' },
      { id: 't-2', label: 'Terrace 2', seats: 4, blocked: false, zoneId: 'terrace', zoneName: 'Terrace' },
    ],
    bookings: [],
    tz: 'Asia/Jerusalem',
    mode: 'booking',
    onClose: noop,
    onCreated: noop,
  }))
}

describe('форма ручной брони', () => {
  it('сначала предлагает автоназначение, а полный список столов держит закрытым', () => {
    const html = render()
    assert.match(html, /Best available table/)
    assert.match(html, /Choose tables manually/)
    assert.match(html, /aria-expanded="false"/)
    assert.doesNotMatch(html, /Terrace 1/)
    assert.doesNotMatch(html, /Terrace 2/)
  })
})
