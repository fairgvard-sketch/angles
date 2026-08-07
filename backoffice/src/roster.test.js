import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  can, accessSummary, accessScope, accessSource, rolesAllowing,
  filterRoster, sortRoster, lastShiftLabel, shiftIndex, statusOf,
  personRowLabel, resolveTab, staffErrorText, hasRecords, locationLabel,
  PERM_KEYS, roleAccessDiff, levelChangeEffect,
} from './roster'

/**
 * Правила доступа проверяются тестом, а не взглядом на прод: кабинет
 * рисует по ним галочки, а отказ выносит сервер. Разойдутся — владелец
 * увидит право, которого у человека нет.
 */

const barista = { id: 's1', name: 'Dana', role: 'barista', is_active: true, location_id: 'loc-1' }
const manager = { id: 's2', name: 'Avi', role: 'manager', is_active: true, location_id: 'loc-1' }
const owner = { id: 's3', name: 'Rina', role: 'owner', is_active: true, location_id: null }

const locations = [{ id: 'loc-1', name: 'Main' }, { id: 'loc-2', name: 'Port' }]

describe('кто что может', () => {
  it('владельца роль не ограничивает', () => {
    const empty = { id: 'r1', name: 'Nothing', base: 'barista', perms: [] }
    for (const key of PERM_KEYS) {
      assert.equal(can(owner, key, { perms: { [key]: 'manager' } }, empty), true, key)
    }
  })

  it('без роли решают настройки точки и базовый уровень', () => {
    assert.equal(can(barista, 'refund', { perms: { refund: 'manager' } }, null), false)
    assert.equal(can(manager, 'refund', { perms: { refund: 'manager' } }, null), true)
    assert.equal(can(barista, 'refund', { perms: { refund: 'all' } }, null), true)
  })

  it('дефолт применяется к действию, которого нет в настройках', () => {
    // Возврат и инвентаризация были менеджерскими и до миграции 036
    assert.equal(can(barista, 'refund', {}, null), false)
    assert.equal(can(barista, 'stock_take', {}, null), false)
    assert.equal(can(barista, 'discount', {}, null), true)
  })

  it('набор кастомной роли исчерпывающий: точка её носителю не помогает', () => {
    const role = { id: 'r1', name: 'Senior', base: 'manager', perms: ['refund'] }
    // Точка разрешает закрытие смены всем — но в роли его нет
    assert.equal(can(barista, 'close_shift', { perms: { close_shift: 'all' } }, role), false)
    // И наоборот: точка держит возврат за менеджером, роль его выдаёт
    assert.equal(can(barista, 'refund', { perms: { refund: 'manager' } }, role), true)
  })

  it('база роли на решение не влияет — её не смотрит ни сервер, ни касса', () => {
    const asManager = { id: 'r1', name: 'Senior', base: 'manager', perms: [] }
    const asBarista = { id: 'r2', name: 'Junior', base: 'barista', perms: [] }
    for (const role of [asManager, asBarista]) {
      assert.equal(can(barista, 'discount', { perms: { discount: 'all' } }, role), false)
    }
  })
})

describe('сводка доступа в строке', () => {
  it('владелец и полный набор названы одинаково — «все девять»', () => {
    const all = { id: 'r1', name: 'All', base: 'manager', perms: [...PERM_KEYS] }
    assert.equal(accessSummary(owner, null, {}, locations).label, `All ${PERM_KEYS.length}`)
    assert.equal(accessSummary(barista, all, {}, locations).label, `All ${PERM_KEYS.length}`)
  })

  it('считает по точке сотрудника, а не по первой в организации', () => {
    const settings = {
      'loc-1': { perms: Object.fromEntries(PERM_KEYS.map((k) => [k, 'manager'])) },
      'loc-2': { perms: Object.fromEntries(PERM_KEYS.map((k) => [k, 'all'])) },
    }
    assert.equal(accessSummary(barista, null, settings, locations).allowed, 0)
    const atPort = { ...barista, location_id: 'loc-2' }
    assert.equal(accessSummary(atPort, null, settings, locations).allowed, PERM_KEYS.length)
  })

  it('у сотрудника без точки разные права на разных точках — «Varies»', () => {
    const settings = {
      'loc-1': { perms: { refund: 'all' } },
      'loc-2': { perms: { refund: 'manager' } },
    }
    const roaming = { ...barista, location_id: null }
    assert.equal(accessSummary(roaming, null, settings, locations).label, 'Varies')
    // Совпали — число, а не отговорка
    const same = { 'loc-1': { perms: { refund: 'all' } }, 'loc-2': { perms: { refund: 'all' } } }
    assert.notEqual(accessSummary(roaming, null, same, locations).label, 'Varies')
  })

  it('носителя роли считаем один раз: точка на его права не влияет', () => {
    const role = { id: 'r1', name: 'Senior', base: 'barista', perms: ['refund'] }
    assert.deepEqual(accessScope(barista, role, locations), [])
    assert.equal(accessSummary(barista, role, {}, locations).allowed, 1)
  })
})

describe('откуда взялось право', () => {
  it('носителю роли сказано, что настройки точки к нему не применяются', () => {
    const role = { id: 'r1', name: 'Senior', base: 'barista', perms: [] }
    assert.match(accessSource(barista, role, 'Main'), /do not apply/i)
  })

  it('без роли названа точка и уровень', () => {
    assert.match(accessSource(barista, null, 'Main'), /Main/)
    assert.match(accessSource(barista, null, 'Main'), /Barista/)
  })

  it('роли-исключения находятся по действию', () => {
    const roles = [
      { id: 'r1', name: 'Senior', perms: ['refund'] },
      { id: 'r2', name: 'Runner', perms: ['void_order'] },
    ]
    assert.deepEqual(rolesAllowing(roles, 'refund').map((r) => r.name), ['Senior'])
    assert.deepEqual(rolesAllowing(roles, 'close_shift'), [])
  })
})

describe('список команды', () => {
  it('работающие впереди, внутри — по алфавиту', () => {
    const fired = { id: 's4', name: 'Ada', role: 'barista', is_active: false }
    assert.deepEqual(
      sortRoster([fired, manager, barista]).map((s) => s.name),
      ['Avi', 'Dana', 'Ada'],
    )
  })

  it('сотрудник без точки остаётся в отборе по любой точке', () => {
    const roaming = { ...owner }
    const rows = filterRoster([barista, roaming], { locationId: 'loc-2' })
    assert.deepEqual(rows.map((s) => s.name), ['Rina'])
  })

  it('поиск идёт по имени и не различает регистр', () => {
    assert.deepEqual(filterRoster([barista, manager], { search: 'da' }).map((s) => s.name), ['Dana'])
  })

  it('точка сотрудника названа словом, а не идентификатором', () => {
    assert.equal(locationLabel(barista, locations), 'Main')
    assert.equal(locationLabel(owner, locations), 'All locations')
  })
})

describe('смены', () => {
  it('последняя смена берётся из отчёта, открытая — отдельным признаком', () => {
    const index = shiftIndex({
      staff: [{
        staff_id: 's1',
        has_open: true,
        entries: [{ day: '2026-08-01' }, { day: '2026-08-04' }, { day: '2026-07-30' }],
      }],
    })
    assert.deepEqual(index.get('s1'), { lastDay: '2026-08-04', open: true })
  })

  it('давность считается днями, а не часами', () => {
    assert.equal(lastShiftLabel('2026-08-05', '2026-08-05'), 'Today')
    assert.equal(lastShiftLabel('2026-08-04', '2026-08-05'), 'Yesterday')
    assert.equal(lastShiftLabel('2026-07-29', '2026-08-05'), '7d ago')
    // Нет отметок в окне отчёта — это не «никогда»
    assert.equal(lastShiftLabel(null, '2026-08-05'), '—')
  })

  it('на смене — состояние, а не украшение', () => {
    assert.equal(statusOf(barista, { open: true }).label, 'On shift')
    assert.equal(statusOf(barista, { open: false }).label, 'Active')
    assert.equal(statusOf({ ...barista, is_active: false }, null).label, 'Inactive')
  })

  it('имя строки называет читалке то же, что видит глаз', () => {
    const label = personRowLabel(barista, {
      role: null,
      locations,
      access: { label: '7 of 9' },
      shift: { lastDay: '2026-08-01', open: false },
    })
    assert.match(label, /Dana/)
    assert.match(label, /Barista/)
    assert.match(label, /Main/)
    assert.match(label, /7 of 9/)
  })
})

describe('адреса и ошибки', () => {
  it('прежние вкладки не ломают присланную ссылку', () => {
    assert.equal(resolveTab('staff'), 'people')
    assert.equal(resolveTab('roles'), 'access')
    assert.equal(resolveTab('perms'), 'access')
    assert.equal(resolveTab('hours'), 'hours')
    assert.equal(resolveTab('nope'), 'people')
    assert.equal(resolveTab(null), 'people')
  })

  it('история сотрудника — не ошибка ввода, а повод деактивировать', () => {
    assert.equal(hasRecords('staff has records'), true)
    assert.match(staffErrorText('staff has records'), /Deactivate/)
    assert.equal(hasRecords('role name required'), false)
  })

  it('незнакомый текст сервера показывается как есть', () => {
    assert.equal(staffErrorText('network unreachable'), 'network unreachable')
  })
})

// ── Предпросмотр эффекта до сохранения (Phase 9) ─────────────

describe('roleAccessDiff', () => {
  const role = { id: 'r1', name: 'Старший бариста', perms: ['discount', 'refund'] }

  it('снятая галочка названа потерей, а не «изменением»', () => {
    const diff = roleAccessDiff(role, ['discount'], [{ id: 's1' }, { id: 's2' }])
    assert.deepEqual(diff.lost.map((p) => p.key), ['refund'])
    assert.deepEqual(diff.gained, [])
    assert.equal(diff.people, 2)
    assert.equal(diff.changed, true)
  })

  it('добавленное действие тоже показывается', () => {
    const diff = roleAccessDiff(role, ['discount', 'refund', 'void_order'], [])
    assert.deepEqual(diff.gained.map((p) => p.key), ['void_order'])
    assert.equal(diff.people, 0, 'у новой роли носителей нет — и это честный ответ')
  })

  it('без изменений предпросмотр молчит', () => {
    assert.equal(roleAccessDiff(role, ['refund', 'discount'], []).changed, false)
  })
})

describe('levelChangeEffect', () => {
  const settings = { perms: { refund: 'manager' } }
  const roles = [{ id: 'r1', name: 'Старший бариста', perms: ['refund'] }]
  const staff = [
    { id: 's1', name: 'Дана', role: 'barista', role_id: null },
    { id: 's2', name: 'Йоси', role: 'manager', role_id: null },
    { id: 's3', name: 'Ави', role: 'barista', role_id: 'r1' },
    { id: 's4', name: 'Владелец', role: 'owner', role_id: null },
  ]

  it('называет поимённо тех, кого переключатель правда затронет', () => {
    const effect = levelChangeEffect('refund', 'all', staff, roles, settings)
    assert.deepEqual(effect.people, ['Дана'], 'менеджер и так мог, у Ави своя роль')
  })

  it('человека с собственной ролью уровень точки не касается', () => {
    const effect = levelChangeEffect('refund', 'all', staff, roles, settings)
    assert.equal(effect.withOwnRole, 1)
    assert.ok(!effect.people.includes('Ави'))
  })

  it('владелец не считается никогда', () => {
    const effect = levelChangeEffect('discount', 'manager', staff, roles, settings)
    assert.ok(!effect.people.includes('Владелец'))
  })
})
