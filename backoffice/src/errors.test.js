import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { redact, safeErrorReport } from './errors'

/**
 * Лог падения — это отчёт разработчику, а не выгрузка экрана. Всё, что
 * может оказаться данными клиента, из него вырезано.
 */
describe('crash report redaction', () => {
  it('removes email, phone and identifiers from a message', () => {
    const dirty = 'Cannot read guest dana@example.co.il phone +972 54-123-4567 '
      + 'booking 7d3f2b1a-0c9e-4b2a-9f31-5b8c1d2e3f40'
    const clean = redact(dirty)
    assert.doesNotMatch(clean, /example\.co\.il/)
    assert.doesNotMatch(clean, /123-4567/)
    assert.doesNotMatch(clean, /7d3f2b1a/)
    assert.match(clean, /\[email]/)
    assert.match(clean, /\[number]/)
    assert.match(clean, /\[id]/)
    // Техническая часть сообщения обязана остаться читаемой
    assert.match(clean, /Cannot read guest/)
  })

  it('leaves an ordinary programming error alone', () => {
    assert.equal(redact('selecting is not defined'), 'selecting is not defined')
  })

  it('survives empty and non-string input', () => {
    assert.equal(redact(undefined), '')
    assert.equal(redact(null), '')
    assert.equal(redact(42), '42')
  })
})

describe('safeErrorReport', () => {
  it('reports the shape of the failure and the section it happened in', () => {
    const error = new ReferenceError('selecting is not defined')
    const report = safeErrorReport('menu', error, { componentStack: '\n    at ModifiersTab' })
    assert.deepEqual(report, {
      view: 'menu',
      name: 'ReferenceError',
      message: 'selecting is not defined',
      componentStack: 'at ModifiersTab',
    })
  })

  it('redacts and truncates instead of dumping the screen contents', () => {
    const error = new Error(`guest yosi@mail.com ordered ${'x'.repeat(500)}`)
    const report = safeErrorReport('guests', error, {
      componentStack: `at Row (dana@example.com) ${'y'.repeat(2000)}`,
    })
    assert.ok(report.message.length <= 200)
    assert.ok(report.componentStack.length <= 800)
    assert.doesNotMatch(report.message, /yosi@mail\.com/)
    assert.doesNotMatch(report.componentStack, /dana@example\.com/)
  })

  it('copes with a thrown non-error and a missing stack', () => {
    const report = safeErrorReport(undefined, 'boom', null)
    assert.equal(report.view, 'unknown')
    assert.equal(report.name, 'Error')
    assert.equal(report.message, 'boom')
    assert.equal(report.componentStack, '')
  })
})
