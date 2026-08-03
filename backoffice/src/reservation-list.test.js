import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createdVia, dayLabel, filterReservations, groupByDay, paginate, sortByTime, zoneOf,
} from './reservation-list.js'

/**
 * Правила списка броней.
 *
 * Проверяется то, из-за чего список и переделывался: найти конкретную
 * бронь можно только отбором, а отбор обязан быть предсказуемым —
 * пустой фильтр означает «всё», сортировка не прыгает, дни считаются в
 * зоне точки, а страница не уводит в пустоту.
 */

const tz = 'Asia/Jerusalem'
const at = (iso) => new Date(iso).toISOString()

const rows = [
  { id: 'a', customer_name: 'Emma Lewis', customer_phone: '0501112233', status: 'confirmed',
    reserved_at: at('2026-05-17T16:30:00Z'), table_id: 't1', created_via: 'public',
    source: 'instagram' },
  { id: 'b', customer_name: 'Walk-in', customer_phone: '', status: 'new',
    reserved_at: at('2026-05-17T15:00:00Z'), table_id: 't2', created_via: 'backoffice' },
  { id: 'c', customer_name: 'Noa Levi', customer_phone: '0509998877', status: 'confirmed',
    arrived_at: at('2026-05-17T17:05:00Z'), reserved_at: at('2026-05-17T17:00:00Z'),
    table_id: 't3', created_via: 'pos' },
  { id: 'd', customer_name: 'James Lee', customer_phone: '', status: 'completed',
    reserved_at: at('2026-05-18T10:00:00Z'), table_id: 't1' },
]

const tableById = new Map([
  ['t1', { id: 't1', zoneId: 'z1' }],
  ['t2', { id: 't2', zoneId: 'z2' }],
  ['t3', { id: 't3', zoneId: null }],
])

const ids = (list) => list.map((r) => r.id)

describe('отбор броней', () => {
  it('пустой фильтр показывает всё', () => {
    assert.equal(filterReservations(rows, {}).length, 4)
  })

  it('состояние берётся из полей брони, а не из голого статуса', () => {
    // Гость с отметкой прихода — «Seated», хотя статус остаётся confirmed
    assert.deepEqual(ids(filterReservations(rows, { status: 'arrived' })), ['c'])
    assert.deepEqual(ids(filterReservations(rows, { status: 'pending' })), ['b'])
  })

  it('зал определяется по назначенному столу', () => {
    assert.deepEqual(ids(filterReservations(rows, { zone: 'z2', tableById })), ['b'])
  })

  it('путь заведения различает гостя, кассу и кабинет', () => {
    assert.equal(createdVia(rows[1]), 'backoffice')
    assert.equal(createdVia(rows[0]), 'public')
    assert.equal(createdVia(rows[2]), 'pos')
    assert.deepEqual(ids(filterReservations(rows, { via: 'backoffice' })), ['b'])
    assert.deepEqual(ids(filterReservations(rows, { via: 'pos' })), ['c'])
  })

  it('бронь до миграции 136 честно называется незаписанной, а не гостевой', () => {
    // Догадка задним числом («раз пусто — значит гость») превратила бы
    // пробел в факт, на который потом сошлётся отчёт
    assert.equal(createdVia(rows[3]), 'unknown')
    assert.deepEqual(ids(filterReservations(rows, { via: 'unknown' })), ['d'])
  })

  it('канал привода — не путь заведения: их не путают между собой', () => {
    // Гость пришёл из Instagram и забронировал сам: канал instagram,
    // путь public. Фильтр путей на канал не реагирует.
    assert.equal(rows[0].source, 'instagram')
    assert.equal(createdVia(rows[0]), 'public')
    assert.deepEqual(ids(filterReservations(rows, { via: 'instagram' })), [])
  })

  it('поиск идёт по имени и телефону', () => {
    assert.deepEqual(ids(filterReservations(rows, { query: 'emma' })), ['a'])
    assert.deepEqual(ids(filterReservations(rows, { query: '9998877' })), ['c'])
    assert.deepEqual(ids(filterReservations(rows, { query: '   ' })).length, 4)
  })

  it('фильтры складываются', () => {
    assert.deepEqual(
      ids(filterReservations(rows, { status: 'confirmed', zone: 'z1', tableById })),
      ['a']
    )
  })
})

describe('порядок', () => {
  it('по времени вперёд и назад', () => {
    assert.deepEqual(ids(sortByTime(rows)), ['b', 'a', 'c', 'd'])
    assert.deepEqual(ids(sortByTime(rows, 'desc')), ['d', 'c', 'a', 'b'])
  })

  it('одинаковое время не заставляет строки прыгать', () => {
    const same = [
      { id: 'y', customer_name: 'Яна', reserved_at: at('2026-05-17T16:00:00Z') },
      { id: 'x', customer_name: 'Анна', reserved_at: at('2026-05-17T16:00:00Z') },
    ]
    assert.deepEqual(ids(sortByTime(same)), ids(sortByTime([...same].reverse())))
  })

  it('исходный массив не переворачивается на месте', () => {
    const before = ids(rows)
    sortByTime(rows, 'desc')
    assert.deepEqual(ids(rows), before)
  })
})

describe('дни', () => {
  it('визиты собираются по суткам точки', () => {
    const groups = groupByDay(sortByTime(rows), tz, '2026-05-17')
    assert.deepEqual(groups.map((g) => g.key), ['2026-05-17', '2026-05-18'])
    assert.deepEqual(groups.map((g) => g.label), ['Today', 'Tomorrow'])
    assert.deepEqual(ids(groups[0].rows), ['b', 'a', 'c'])
  })

  it('поздний вечер по Иерусалиму остаётся своим днём', () => {
    // 21:30 UTC = 00:30 следующих суток в Иерусалиме: день считается в
    // зоне точки, иначе вечерние визиты уезжают в завтра
    const late = [{ id: 'l', reserved_at: at('2026-05-17T21:30:00Z'), customer_name: 'Late' }]
    assert.equal(groupByDay(late, tz, '2026-05-17')[0].key, '2026-05-18')
  })

  it('вчера, сегодня и завтра называются словами', () => {
    assert.equal(dayLabel('2026-05-17', '2026-05-17'), 'Today')
    assert.equal(dayLabel('2026-05-18', '2026-05-17'), 'Tomorrow')
    assert.equal(dayLabel('2026-05-16', '2026-05-17'), 'Yesterday')
    assert.equal(dayLabel('2026-06-01', '2026-05-17'), '2026-06-01')
  })
})

describe('страницы', () => {
  const many = Array.from({ length: 57 }, (_, i) => ({ id: `r${i}` }))

  it('считает границы и итог', () => {
    const page = paginate(many, 1, 25)
    assert.equal(page.items.length, 25)
    assert.equal(page.pages, 3)
    assert.equal(page.from, 1)
    assert.equal(page.to, 25)
    assert.equal(page.total, 57)
  })

  it('последняя страница не добирает пустотой', () => {
    assert.equal(paginate(many, 3, 25).items.length, 7)
  })

  it('исчезнувшая страница возвращает на последнюю существующую', () => {
    // Хостес был на третьей странице и ужесточил фильтр
    const page = paginate(many.slice(0, 10), 3, 25)
    assert.equal(page.page, 1)
    assert.equal(page.items.length, 10)
  })

  it('пустой список — честный ноль, а не «1–0 из 0»', () => {
    const page = paginate([], 1, 25)
    assert.equal(page.total, 0)
    assert.equal(page.from, 0)
    assert.equal(page.to, 0)
  })
})

describe('зона визита', () => {
  it('стол без зоны не выдумывает её из поля брони', () => {
    assert.equal(zoneOf({ table_id: 't3', zone_id: 'z9' }, tableById), 'z9')
  })

  it('объединённые столы дают зону первого назначенного', () => {
    const combined = { tables_link: [{ table_id: 't2' }, { table_id: 't1' }] }
    assert.equal(zoneOf(combined, tableById), 'z2')
  })
})
