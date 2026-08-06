import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  RULES_MAX, addRule, moveRule, removeRule, ruleList, rulesSummary, toSettings,
  updateRule,
} from './reservation-rules.js'

/**
 * Правила брони (Kassa 145).
 *
 * Проверяется то, из-за чего список вообще заведён: пункт переживает
 * правку текста своим id (иначе согласие гостя перестало бы совпадать с
 * настройками), порядок задаёт владелец, а пустой пункт до гостя не
 * доезжает.
 */

const rule = (id, over = {}) => ({
  id, text: `текст ${id}`, level: 'normal', ack: false, url: null, ...over,
})

describe('чтение настроек', () => {
  it('пункт без id получает устойчивую позиционную замену', () => {
    const list = ruleList({ rules: [{ text: 'без id' }] })
    assert.equal(list[0].id, 'r1')
  })

  it('незнакомая важность считается обычной, а не теряет пункт', () => {
    const list = ruleList({ rules: [{ id: 'a', text: 'x', level: 'critical' }] })
    assert.equal(list.length, 1)
    assert.equal(list[0].level, 'normal')
  })

  it('нет ключа rules — пустой список, а не падение', () => {
    assert.deepEqual(ruleList({}), [])
    assert.deepEqual(ruleList(undefined), [])
    assert.deepEqual(ruleList({ rules: 'нет' }), [])
  })

  it('ack только явное true: строка «да» обязательным пункт не делает', () => {
    const list = ruleList({ rules: [{ id: 'a', text: 'x', ack: 'yes' }] })
    assert.equal(list[0].ack, false)
  })
})

describe('правка списка', () => {
  it('новый пункт получает свой id и не трогает соседей', () => {
    const list = addRule([rule('a')])
    assert.equal(list.length, 2)
    assert.notEqual(list[1].id, 'a')
    assert.equal(list[0].text, 'текст a')
  })

  it('дальше потолка список не растёт', () => {
    const full = Array.from({ length: RULES_MAX }, (_, i) => rule(`r${i}`))
    assert.equal(addRule(full).length, RULES_MAX)
  })

  it('правка текста сохраняет id — согласие гостя остаётся привязанным', () => {
    const list = updateRule([rule('a')], 'a', { text: 'новый текст' })
    assert.equal(list[0].id, 'a')
    assert.equal(list[0].text, 'новый текст')
  })

  it('перестановка за границы списка ничего не меняет', () => {
    const list = [rule('a'), rule('b')]
    assert.deepEqual(moveRule(list, 'a', -1).map((r) => r.id), ['a', 'b'])
    assert.deepEqual(moveRule(list, 'b', 1).map((r) => r.id), ['a', 'b'])
    assert.deepEqual(moveRule(list, 'a', 1).map((r) => r.id), ['b', 'a'])
  })

  it('удаление убирает ровно один пункт', () => {
    assert.deepEqual(
      removeRule([rule('a'), rule('b')], 'a').map((r) => r.id),
      ['b'],
    )
  })
})

describe('сохранение', () => {
  it('пустой пункт до гостя не доезжает', () => {
    const saved = toSettings([rule('a'), rule('b', { text: '   ' })])
    assert.equal(saved.length, 1)
    assert.equal(saved[0].id, 'a')
  })

  it('список без единого текста сохраняется как отсутствие правил', () => {
    assert.equal(toSettings([rule('a', { text: '' })]), null)
  })

  it('пустая ссылка не попадает в настройки отдельным ключом', () => {
    const [saved] = toSettings([rule('a', { url: null })])
    assert.equal('url' in saved, false)
  })

  it('длинный текст режется до предела БД', () => {
    const [saved] = toSettings([rule('a', { text: 'я'.repeat(400) })])
    assert.equal(saved.text.length, 300)
  })
})

describe('сводка', () => {
  it('считает пункты и отдельно те, что требуют отметки', () => {
    assert.equal(rulesSummary([rule('a'), rule('b', { ack: true })]), '2 rules · 1 to confirm')
    assert.equal(rulesSummary([rule('a')]), '1 rule')
    assert.equal(rulesSummary([]), 'No rules')
  })

  it('пустой пункт в сводке не считается', () => {
    assert.equal(rulesSummary([rule('a'), rule('b', { text: '' })]), '1 rule')
  })
})
