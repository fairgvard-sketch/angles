import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  translationCoverage, translationDraft, translationPayload, translationSummary,
} from './translations.js'

/**
 * Переводы QR-меню (Kassa 184): форма кабинета не должна ни терять
 * переводы, ни слать пустые строки.
 */

describe('translationDraft', () => {
  it('даёт строки по каждому языку, описание — только блюду', () => {
    assert.deepEqual(translationDraft({ en: { name: 'Cappuccino', description: 'Milk foam' } }, true), {
      en: { name: 'Cappuccino', description: 'Milk foam' },
      ru: { name: '', description: '' },
    })
    assert.deepEqual(translationDraft(undefined), { en: { name: '' }, ru: { name: '' } })
  })
})

describe('translationPayload', () => {
  it('выбрасывает пустые поля и языки и срезает пробелы', () => {
    assert.deepEqual(translationPayload({
      en: { name: '  Cappuccino ', description: '' },
      ru: { name: '   ', description: '' },
    }), { en: { name: 'Cappuccino' } })
  })

  it('не стирает языки, которых нет в форме', () => {
    assert.deepEqual(translationPayload(
      { en: { name: 'Tropical' }, ru: { name: '' } },
      { he: { name: 'הטרופית' }, ru: { name: 'Тропическое' } },
    ), { he: { name: 'הטרופית' }, en: { name: 'Tropical' } })
  })
})

describe('translationSummary', () => {
  it('называет переведённые языки', () => {
    assert.equal(translationSummary({ en: { name: 'Milk' }, ru: { name: 'Молоко' } }), 'English, Russian')
    assert.equal(translationSummary({ ru: { name: 'Молоко' } }), 'Russian')
    assert.equal(translationSummary({}), 'Not translated')
    assert.equal(translationSummary(null), 'Not translated')
  })
})

describe('translationCoverage', () => {
  const categories = [
    { id: 'hot', location_id: 'loc', is_active: true },
    { id: 'old', location_id: 'loc', is_active: false },
    { id: 'other', location_id: 'loc-2', is_active: true },
  ]
  const items = [
    { id: 'a', category_id: 'hot', is_available: true, translations: { en: { name: 'Latte' }, ru: { name: 'Латте' } } },
    { id: 'b', category_id: 'hot', is_available: true, translations: { en: { name: 'Mocha' } } },
    { id: 'c', category_id: 'hot', is_available: false, translations: {} },
    { id: 'd', category_id: 'old', is_available: true, translations: {} },
    { id: 'e', category_id: 'other', is_available: true, translations: {} },
  ]

  it('считает только то, что видит гость этой точки', () => {
    assert.deepEqual(translationCoverage({ categories, items }, 'loc'), {
      en: { done: 2, total: 2 },
      ru: { done: 1, total: 2 },
    })
  })
})
