import test, { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  STATUS_LABEL, deviceAdvice, deviceStatus, filterFleet, fleetErrorText,
  isArchived, lastSeenLabel, outboxAgeLabel,
  fleetSection, deleteOutcome, deleteErrorText,
} from './fleet.js'

/**
 * Парк касс. Проверяется то, ради чего раздел существует: владелец
 * должен отличить молчащий терминал от списанного и понять, что делать.
 * «Offline» без объяснения — это не диагностика, а тревога.
 */

const device = (over = {}) => ({
  id: 'd1', name: 'Касса', location_name: 'Главная',
  silence_seconds: 60, outbox_pending: 0, outbox_failed: false,
  outbox_oldest_at: null, app_version: '1.4', bridge_version: 5,
  archived_at: null, ...over,
})

test('статус считается по молчанию, а зависшая очередь важнее', () => {
  assert.equal(deviceStatus(device({ silence_seconds: 60 })), 'online')
  assert.equal(deviceStatus(device({ silence_seconds: 900 })), 'stale')
  assert.equal(deviceStatus(device({ silence_seconds: 7200 })), 'offline')
  assert.equal(deviceStatus(device({ silence_seconds: null })), 'never')
  // Касса на связи, но очередь не уходит — это хуже, чем молчание
  assert.equal(deviceStatus(device({ silence_seconds: 30, outbox_failed: true })), 'error')
})

test('у каждого статуса есть подпись словом, не только цвет', () => {
  for (const key of ['online', 'stale', 'offline', 'error', 'never']) {
    assert.ok(STATUS_LABEL[key], `нет подписи для ${key}`)
  }
})

test('«последний раз на связи» читается по-человечески', () => {
  assert.equal(lastSeenLabel(device({ silence_seconds: 30 })), 'Just now')
  assert.equal(lastSeenLabel(device({ silence_seconds: 300 })), '5m ago')
  assert.equal(lastSeenLabel(device({ silence_seconds: 7200 })), '2h ago')
  assert.equal(lastSeenLabel(device({ silence_seconds: 172800 })), '2d ago')
  assert.equal(lastSeenLabel(device({ silence_seconds: null })), 'Never')
})

test('совет объясняет, что делать, а не повторяет статус', () => {
  const stuck = deviceAdvice(device({ outbox_failed: true }))
  assert.match(stuck, /queue/i)
  assert.match(stuck, /internet|foreground/i)

  // Молчит меньше недели — это чинят, а не списывают
  const short = deviceAdvice(device({ silence_seconds: 7200 }))
  assert.match(short, /powered on|online/i)
  assert.ok(!/archive/i.test(short), 'кассу, молчащую два часа, списывать рано')

  // Молчит давно — предлагаем убрать из операционного списка
  const long = deviceAdvice(device({ silence_seconds: 30 * 86400 }))
  assert.match(long, /archive/i)
  assert.match(long, /30 days/)

  // Ни разу не выходила на связь
  assert.match(deviceAdvice(device({ silence_seconds: null })), /never reported/i)

  // У здоровой кассы совета нет — не выдумываем проблему
  assert.equal(deviceAdvice(device({ silence_seconds: 60 })), null)
})

test('совет про архив обещает сохранность записей', () => {
  const advice = deviceAdvice(device({ silence_seconds: null }))
  assert.match(advice, /record and its past sales stay/i)
})

test('возраст очереди показывается только когда очередь есть', () => {
  assert.equal(outboxAgeLabel(device()), null)
  const at = new Date(Date.now() - 3 * 3600_000).toISOString()
  assert.equal(outboxAgeLabel(device({ outbox_oldest_at: at })), '3h')
})

test('архивные скрыты по умолчанию, но не потеряны', () => {
  const fleet = [device({ id: 'live' }), device({ id: 'old', archived_at: '2026-01-01T00:00:00Z' })]
  assert.deepEqual(filterFleet(fleet).map((d) => d.id), ['live'])
  assert.deepEqual(filterFleet(fleet, { showArchived: true }).map((d) => d.id), ['live', 'old'])
  assert.equal(isArchived(fleet[1]), true)
  assert.equal(isArchived(fleet[0]), false)
})

test('поиск различает одинаковые «Кассы» по точке и версии', () => {
  const fleet = [
    device({ id: 'a', name: 'Касса', location_name: 'Дизенгоф', app_version: '1.4' }),
    device({ id: 'b', name: 'Касса', location_name: 'Ротшильд', app_version: '1.2' }),
  ]
  assert.deepEqual(filterFleet(fleet, { query: 'ротшильд' }).map((d) => d.id), ['b'])
  assert.deepEqual(filterFleet(fleet, { query: '1.4' }).map((d) => d.id), ['a'])
  assert.equal(filterFleet(fleet, { query: 'касса' }).length, 2)
})

test('ошибки сервера переводятся на язык владельца', () => {
  assert.match(fleetErrorText('name_required'), /name/i)
  assert.match(fleetErrorText('not_found'), /refresh/i)
  assert.match(fleetErrorText('permission denied'), /role/i)
  assert.equal(fleetErrorText('weird'), 'weird')
})

// ── Секции парка и удаление (Phase 7) ────────────────────────

describe('fleetSection', () => {
  const live = { silence_seconds: 60, outbox_failed: 0, archived_at: null }

  it('молчащая и с зависшей очередью — в «требует внимания»', () => {
    assert.equal(fleetSection({ ...live, silence_seconds: 7200 }), 'attention')
    assert.equal(fleetSection({ ...live, outbox_failed: 1 }), 'attention')
    assert.equal(fleetSection({ ...live, silence_seconds: null }), 'attention')
  })

  it('на связи и с задержкой — рабочие', () => {
    assert.equal(fleetSection(live), 'active')
    assert.equal(fleetSection({ ...live, silence_seconds: 900 }), 'active')
  })

  it('архив важнее состояния: списанная касса не «требует внимания»', () => {
    assert.equal(
      fleetSection({ ...live, silence_seconds: 999999, archived_at: '2026-07-01T00:00:00Z' }),
      'archived',
    )
  })
})

describe('итог удаления терминала', () => {
  it('закрытый вход назван прямо', () => {
    assert.match(deleteOutcome({ deleted: true, access_revoked: true }), /revoked/)
  })

  it('общая учётка объясняется, а не замалчивается', () => {
    const text = deleteOutcome({ deleted: true, access_revoked: false, reason: 'account_shared' })
    assert.match(text, /shared with another register/)
  })

  it('аккаунт человека остаётся нетронутым, и об этом сказано', () => {
    const text = deleteOutcome({ deleted: true, access_revoked: false, reason: 'account_is_member' })
    assert.match(text, /person’s account/)
  })
})

describe('отказы удаления', () => {
  it('очередь объясняется деньгами, а не кодом', () => {
    assert.match(deleteErrorText('outbox_pending'), /unsent operations/)
  })

  it('порядок шагов назван: сначала архив', () => {
    assert.match(deleteErrorText('not_archived'), /Archive the register first/)
  })
})
