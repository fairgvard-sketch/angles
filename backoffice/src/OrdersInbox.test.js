import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { OrdersList } from './OrdersInbox'

const accepted = {
  id: 'accepted-1', status: 'accepted', created_at: '2026-08-05T07:12:00Z',
  customer_name: 'Customer', item_count: 5, total: 8300, order_id: 'pos-order-1',
}

describe('мобильная строка заказа', () => {
  it('включает статус в единую кнопку открытия и не оставляет пустое место под меню', () => {
    const html = renderToStaticMarkup(h(OrdersList, {
      rows: [accepted], scope: 'history', currency: 'ILS', tz: 'Asia/Jerusalem',
      dayStartMs: 0, nowMs: Date.now(), selectedId: null, onSelect() {},
      canManage: true, busy: null, onAction() {}, empty: 'No orders',
    }))

    assert.match(html, /<button[^>]+class="ord-card-open"[^>]*>[\s\S]*Accepted[\s\S]*<\/button>/)
    assert.doesNotMatch(html, /ord-card-side/)
  })
})
