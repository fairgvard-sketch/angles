import test, { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  SEGMENTS, segmentParams, segmentSummary, parseTagsInput, TAG_LIMIT,
  guestsToCsv, csvFileName, duplicateReason, mergePreview, mergeSources,
  customerErrorText, normalizePhoneInput, formatPhone, formatMoney,
  mergeConfirmText, loyaltyLabel, guestRowLabel, loadedCountLabel, tagTone,
  visitsLabel, ROW_LIMIT, TAG_TONES, whySegment, primarySegment, combinedVisits,
  segmentExplanations, explanationIdFor,
} from './customers.js'

// ── Сегменты считает сервер ──────────────────────────────────

test('сегмент превращается в серверные параметры, а не в фильтр страницы', () => {
  const p = segmentParams({ segment: 'regular' })
  // Сегмент — имя, а не порог: формулу знает сервер (155), и она одна
  // для кабинета, отчёта и выгрузки.
  assert.equal(p.p_segment, 'regular')
  assert.equal(p.p_min_visits, null)
  assert.equal(p.p_limit, 200)
})

test('переключение сегмента не тащит за собой прошлый', () => {
  const vip = segmentParams({ segment: 'vip' })
  assert.equal(vip.p_segment, 'vip')

  const lost = segmentParams({ segment: 'lost' })
  assert.equal(lost.p_segment, 'lost', 'остался только текущий срез')
  // Пороги трат ушли на сервер целиком: считать «постоянного» по
  // колонке кассы значило бы не находить его у точки без кассы.
  assert.equal(lost.p_min_spent, null)
  assert.equal(lost.p_min_visits, null)
})

test('пустой поиск и пустые метки уходят как NULL', () => {
  const p = segmentParams({ search: '   ', tags: [] })
  assert.equal(p.p_search, null)
  assert.equal(p.p_tags, null)
})

test('метки и поиск живут вместе с сегментом', () => {
  const p = segmentParams({ search: ' Дана ', segment: 'regular', tags: ['VIP'], sort: 'spend' })
  assert.equal(p.p_search, 'Дана')
  assert.deepEqual(p.p_tags, ['VIP'])
  assert.equal(p.p_segment, 'regular')
  assert.equal(p.p_sort, 'spend')
})

test('неизвестный сегмент не роняет запрос — база показывается целиком', () => {
  const p = segmentParams({ segment: 'nonsense' })
  assert.equal(p.p_segment, null)
  assert.equal(p.p_min_visits, null)
})

test('точки сужают факты, а не заводят гостей заново', () => {
  assert.equal(segmentParams({}).p_location_ids, null)
  assert.deepEqual(segmentParams({ locationIds: ['loc-1'] }).p_location_ids, ['loc-1'])
  assert.equal(segmentParams({ offset: 50 }).p_offset, 50)
})

test('у каждого сегмента есть подпись — чип без объяснения бесполезен', () => {
  for (const s of SEGMENTS) assert.ok(s.label.length > 0)
})

test('заголовок списка называет активный срез', () => {
  assert.match(segmentSummary({ segment: 'lost' }), /lost/)
  // Правило сегмента — текстом, а не подсказкой по наведению
  assert.match(segmentSummary({ segment: 'regular' }), /5 visits or more/)
  assert.match(segmentSummary({ segment: 'regular' }), /counted automatically/)
  assert.doesNotMatch(segmentSummary({ segment: 'all' }), /counted automatically/)
  assert.match(segmentSummary({ segment: 'all', tags: ['VIP'] }), /VIP/)
  assert.match(segmentSummary({ segment: 'all', tags: [], search: '' }), /Most recent/)
})

test('метка объясняет себя числами, а не словом', () => {
  assert.match(
    whySegment('lost', { visits: 8, days_since: 210 }),
    /8 visits, last one 210 days ago/)
  assert.match(
    whySegment('at_risk', { visits: 6, days_since: 60, avg_gap_days: 14 }),
    /every 14 days, silent for 60/)
  assert.match(whySegment('repeat_no_show', { no_shows: 3 }), /3 no-shows/)
})

test('VIP без кассы объясняется визитами, а не нулём трат', () => {
  assert.match(whySegment('vip', { visits: 12, spend: 0 }), /12 visits/)
  assert.doesNotMatch(whySegment('vip', { visits: 12, spend: 0 }), /₪0/)
  assert.match(whySegment('vip', { visits: 5, spend: 60000 }), /600/)
})

test('без чисел метка молчит, а не выдумывает объяснение', () => {
  assert.equal(whySegment('lost', null), '')
  assert.equal(whySegment('lost', {}), '')
  assert.equal(whySegment('nonsense', { visits: 3 }), '')
})

test('в узкой колонке показывается один сегмент — самый содержательный', () => {
  assert.equal(primarySegment(['returning', 'upcoming']), 'returning')
  // Сервер отдаёт от общего к частному: у гостя с семью визитами
  // «returning» стоит первым, но говорит о нём меньше, чем «regular»
  assert.equal(primarySegment(['returning', 'regular']), 'regular')
  assert.equal(primarySegment(['returning', 'regular', 'vip']), 'vip')
  // То, что требует действия, важнее того, как гость хорош
  assert.equal(primarySegment(['returning', 'regular', 'vip', 'at_risk']), 'at_risk')
  assert.equal(primarySegment(['returning', 'lost']), 'lost')
  assert.equal(primarySegment([]), null)
  assert.equal(primarySegment(undefined), null)
})

// ── Метки ────────────────────────────────────────────────────

test('метки разбираются по запятым, дубли и пустые отброшены', () => {
  assert.deepEqual(parseTagsInput('VIP, , regular, vip'), ['VIP', 'regular'])
})

test('кабинет не обещает больше меток, чем примет сервер', () => {
  const many = Array.from({ length: 20 }, (_, i) => `tag${i}`).join(',')
  assert.equal(parseTagsInput(many).length, TAG_LIMIT)
})

test('слишком длинная метка обрезается так же, как на сервере', () => {
  assert.equal(parseTagsInput('x'.repeat(40))[0].length, 24)
})

// ── Выгрузка ─────────────────────────────────────────────────

const ROWS = [
  {
    id: 'g1', name: 'Дана, Леви', phone: '0501234567', visits: 4, total_spent: 14000,
    points: 600, stamps: 3, tags: ['VIP', 'regular'], notes: 'Oat "milk"',
    last_visit_at: '2026-07-31T21:30:00Z', created_at: '2026-01-02T08:00:00Z',
  },
  {
    id: 'g2', name: null, phone: '0521112222', visits: 0, total_spent: 0,
    points: 0, stamps: 0, tags: [], notes: null, last_visit_at: null,
    created_at: '2026-05-05T05:00:00Z',
  },
]

test('в выгрузке видно валюту и часовой пояс — файл уезжает из кабинета', () => {
  const csv = guestsToCsv(ROWS, { timeZone: 'Asia/Jerusalem' })
  const header = csv.split('\r\n')[0]
  assert.match(header, /Total spent \(ILS\)/)
  assert.match(header, /Last visit \(Asia\/Jerusalem\)/)
})

test('запятые и кавычки в имени не ломают колонки', () => {
  const line = guestsToCsv(ROWS).split('\r\n')[1]
  assert.ok(line.startsWith('"Дана, Леви",0501234567,4,140.00,6.00,3,'))
  assert.match(line, /"Oat ""milk"""/)
})

test('визит после полуночи по UTC остаётся тем же днём в зоне точки', () => {
  const csv = guestsToCsv(ROWS, { timeZone: 'Asia/Jerusalem' })
  // 31 июля 21:30 UTC = 1 августа 00:30 в Иерусалиме
  assert.match(csv.split('\r\n')[1], /,2026-08-01,/)
})

test('пустые поля выгружаются пустыми, а не «null»', () => {
  const line = guestsToCsv(ROWS).split('\r\n')[2]
  // Имя, «последний визит», метки, заметка, сегмент и его причина у
  // этого гостя пусты — пустыми и выгружаются
  assert.equal(line, ',0521112222,0,0.00,0.00,0,,2026-05-05,,,,')
})

test('имя файла содержит дату выгрузки', () => {
  assert.equal(csvFileName(new Date('2026-08-01T10:00:00Z')), 'customers-2026-08-01.csv')
})

// ── Дубли и слияние ──────────────────────────────────────────

const GROUP = {
  reason: 'phone',
  key: '501234567',
  guests: [
    { id: 'g1', name: 'Дана', phone: '0501234567', visits: 3, total_spent: 10000 },
    { id: 'g2', name: 'Дана Леви', phone: '972501234567', visits: 1, total_spent: 4000 },
  ],
}

test('причина дубля названа словами, а не кодом', () => {
  assert.match(duplicateReason(GROUP), /number/i)
  assert.match(duplicateReason({ reason: 'name' }), /name/i)
})

test('предпросмотр слияния называет объём переезда и судьбу старого номера', () => {
  const text = mergePreview(GROUP.guests[0], GROUP.guests[1])
  assert.match(text, /4 visits/)
  assert.match(text, /₪140\.00/)
  assert.match(text, /old number keeps working/i)
  // Метки и заметки объединяются: удалённая метка вернётся из второго
  // профиля, и владелец должен знать это ДО нажатия
  assert.match(text, /Tags and notes of both profiles are combined/i)
})

test('исходники — все, кроме выбранного основным', () => {
  assert.deepEqual(mergeSources(GROUP, 'g1').map((g) => g.id), ['g2'])
  assert.deepEqual(mergeSources(GROUP, 'g2').map((g) => g.id), ['g1'])
})

// ── Ошибки ───────────────────────────────────────────────────

test('занятый номер предлагает слияние, а не «нарушение уникальности»', () => {
  assert.match(customerErrorText('phone_taken'), /Merge/i)
})

test('специфичный код не подменяется общим', () => {
  // 'already_anonymized' содержит 'anonymized' — длинный код должен победить
  assert.match(customerErrorText('already_anonymized'), /already/i)
  assert.notEqual(customerErrorText('already_anonymized'), customerErrorText('guest_anonymized'))
})

test('будущая бронь объясняет, что сделать раньше стирания', () => {
  assert.match(customerErrorText('has_upcoming_reservation'), /Cancel it first/i)
})

test('неизвестная ошибка показывается как есть, а не глотается', () => {
  assert.equal(customerErrorText('boom'), 'boom')
})

// ── Формат ───────────────────────────────────────────────────

test('телефон нормализуется так же, как на сервере', () => {
  assert.equal(normalizePhoneInput('+972 (50) 123-45-67'), '972501234567')
})

test('деньги приходят агоротами и показываются шекелями', () => {
  assert.equal(formatMoney(14000), '₪140.00')
  assert.equal(formatMoney(null), '₪0.00')
})

test('десятизначный номер разбивается на группы, остальные — как есть', () => {
  assert.equal(formatPhone('0501234567'), '050-123-4567')
  assert.equal(formatPhone('972501234567'), '972501234567')
})

test('крупные суммы разделены разрядами — иначе «₪1284.50» читается как ₪128450', () => {
  assert.equal(formatMoney(128450), '₪1,284.50')
})

// ── Лояльность: две программы, один список ───────────────────

describe('loyaltyLabel', () => {
  const stampGuest = { points: 0, stamps: 3 }
  const pointGuest = { points: 4800, stamps: 0 }

  it('штампы считает штуками, баллы — деньгами', () => {
    assert.equal(loyaltyLabel(stampGuest, 'stamps'), '3 stamps')
    assert.equal(loyaltyLabel(pointGuest, 'points'), 'Points ₪48.00')
  })

  it('единица не становится «1 stamps»', () => {
    assert.equal(loyaltyLabel({ stamps: 1 }, 'stamps'), '1 stamp')
  })

  /*
   * Режим приходит только с карточкой гостя (115), а список рисуется
   * раньше. Зашить баллы «как на макете» нельзя: точка со штампами
   * увидела бы ₪0.00 на всей базе.
   */
  it('до ответа сервера показывает то, что ненулевое', () => {
    assert.equal(loyaltyLabel(stampGuest, null), '3 stamps')
    assert.equal(loyaltyLabel(pointGuest, null), 'Points ₪48.00')
    assert.equal(loyaltyLabel({ points: 0, stamps: 0 }, null), 'Points ₪0.00')
  })

  it('пустой гость не роняет строку', () => {
    assert.equal(loyaltyLabel(undefined, 'stamps'), '0 stamps')
  })
})

// ── Доступное имя строки ─────────────────────────────────────

describe('guestRowLabel', () => {
  const guest = {
    name: 'Дана Леви', phone: '0501234567', visits: 23, total_spent: 128450,
    points: 4800, stamps: 0, last_visit_at: new Date().toISOString(), tags: ['VIP'],
  }

  /*
   * Строка списка — одна кнопка, и `aria-label` заменяет читалке ВСЁ её
   * содержимое. Если имя не назовёт числа, для читалки список будет
   * состоять из двухсот одинаковых «Open».
   */
  it('называет то же, что видит глаз', () => {
    const label = guestRowLabel(guest, 'points')
    assert.match(label, /^Open Дана Леви/)
    assert.match(label, /050-123-4567/)
    assert.match(label, /Points ₪48\.00/)
    assert.match(label, /23 visits/)
    assert.match(label, /₪1,284\.50 spent/)
    assert.match(label, /last visit today/)
    assert.match(label, /tagged VIP/)
  })

  it('называет автоматическую метку и её причину — на телефоне подсказки нет', () => {
    const label = guestRowLabel({
      ...guest,
      segments: ['returning', 'regular'],
      why_segment: { visits: 23, days_since: 0 },
    }, 'points')
    assert.match(label, /Regular/)
    assert.doesNotMatch(label, /Returning/, 'в строке одна метка — самая содержательная')
    assert.match(label, /23 visits/)
  })

  it('профиль без имени называется номером и не повторяет его дважды', () => {
    const label = guestRowLabel({ phone: '0539876543', visits: 1 }, 'points')
    assert.match(label, /^Open 053-987-6543/)
    assert.equal(label.match(/053-987-6543/g).length, 1)
    assert.match(label, /1 visit ·/, 'единственный визит не «1 visits»')
  })

  it('в режиме штампов имя строки говорит о штампах', () => {
    assert.match(guestRowLabel({ ...guest, stamps: 4 }, 'stamps'), /4 stamps/)
  })
})

test('визиты называются словом там, где нет шапки колонки', () => {
  assert.equal(visitsLabel(0), '0 visits')
  assert.equal(visitsLabel(1), '1 visit')
})

// ── Счётчик среза ────────────────────────────────────────────

describe('loadedCountLabel', () => {
  it('считает загруженные строки', () => {
    assert.equal(loadedCountLabel(0), 'No customers')
    assert.equal(loadedCountLabel(1), '1 customer')
    assert.equal(loadedCountLabel(128), '128 customers')
  })

  /*
   * На пределе выборки счётчик не вправе выглядеть размером базы:
   * RPC отдаёт 200 строк, листать нечем, и «200 customers» у точки с
   * тысячей клиентов было бы ложью.
   */
  it('на пределе выборки говорит «первые»', () => {
    assert.equal(loadedCountLabel(ROW_LIMIT), `First ${ROW_LIMIT} customers`)
    assert.equal(loadedCountLabel(ROW_LIMIT - 1), `${ROW_LIMIT - 1} customers`)
  })

  it('предел счётчика тот же, что уходит на сервер', () => {
    assert.equal(segmentParams().p_limit, ROW_LIMIT)
  })
})

// ── Оттенок метки ────────────────────────────────────────────

describe('tagTone', () => {
  it('одна и та же метка всегда одного оттенка', () => {
    assert.equal(tagTone('VIP'), tagTone('VIP'))
    assert.equal(tagTone('חלב שקדים'), tagTone('חלב שקדים'))
  })

  it('оттенок всегда из палитры, даже у пустой метки', () => {
    for (const tag of ['VIP', 'Allergy', 'Oat milk', 'regular', '', undefined]) {
      const tone = tagTone(tag)
      assert.ok(Number.isInteger(tone) && tone >= 0 && tone < TAG_TONES, `tone=${tone}`)
    }
  })
})

describe('mergeConfirmText', () => {
  const target = { id: 'a', name: 'Мири Леви', phone: '0521234567', visits: 24, total_spent: 412300 }
  const source = { id: 'b', name: 'Мири', phone: '0521234568', visits: 3, total_spent: 8800 }

  it('называет обе стороны: что останется и что исчезнет', () => {
    const text = mergeConfirmText(target, [source])
    assert.match(text, /Keeping: Мири Леви/)
    assert.match(text, /Disappearing from the list: Мири/)
  })

  it('говорит прямо, что откатить это из кабинета нельзя', () => {
    assert.match(mergeConfirmText(target, [source]), /cannot be undone/)
  })

  it('профиль без имени называется номером, а не пустотой', () => {
    const noName = { id: 'c', phone: '0539876543', visits: 1, total_spent: 0 }
    const text = mergeConfirmText(target, [noName])
    assert.match(text, /Disappearing from the list: 053-987-6543/)
  })

  it('без источников текста нет — подтверждать нечего', () => {
    assert.equal(mergeConfirmText(target, []), '')
  })
})

test('выгрузка несёт сегмент и его причину — иначе по списку не позвонить', () => {
  const csv = guestsToCsv([{
    name: 'Мири', phone: '0521111111', visits: 8,
    segments: ['lost', 'returning'],
    why_segment: { visits: 8, days_since: 210 },
  }])
  const [header, row] = csv.split('\r\n')
  assert.match(header, /Segments,Why/)
  assert.match(row, /Lost \| Returning/)
  assert.match(row, /8 visits, last one 210 days ago/)
})

test('гость без сегмента не ломает выгрузку', () => {
  const csv = guestsToCsv([{ name: 'Новый', phone: '0500000000' }])
  assert.equal(csv.split('\r\n').length, 2)
})

test('менеджеру объясняют, что стирать может только владелец', () => {
  assert.match(customerErrorText('owner_only'), /owner can erase/)
})

// ── Один счётчик визитов на все поверхности ──────────────────

describe('канонический счётчик визитов', () => {
  it('берётся из явного поля сервера', () => {
    assert.equal(combinedVisits({ combined_visits: 6, visits: 4 }), 6)
  })

  it('ноль визитов — это ноль, а не «поля нет»', () => {
    assert.equal(combinedVisits({ combined_visits: 0, visits: 9 }), 0)
  })

  it('старый ответ без поля падает на факты сегмента', () => {
    assert.equal(combinedVisits({ visits: 4, why_segment: { visits: 6 } }), 6)
  })

  it('совсем старый ответ показывает счётчик лояльности, а не ноль', () => {
    assert.equal(combinedVisits({ visits: 4 }), 4)
    assert.equal(combinedVisits({}), 0)
    assert.equal(combinedVisits(null), 0)
  })

  it('подпись для читалки называет ТО ЖЕ число, что видит зрячий', () => {
    const guest = {
      name: 'Мири', phone: '0521111111', combined_visits: 6, visits: 4,
      total_spent: 12000, last_visit_at: null,
    }
    // Живой дефект: в ячейке было 6, а читалка объявляла 4
    assert.match(guestRowLabel(guest, 'points'), /6 visits/)
    assert.doesNotMatch(guestRowLabel(guest, 'points'), /4 visits/)
  })

  it('выгрузка согласуется с экраном', () => {
    const csv = guestsToCsv([{
      name: 'Мири', phone: '0521111111', combined_visits: 6, visits: 4,
      total_spent: 0, points: 0, stamps: 0,
    }])
    const row = csv.split('\r\n')[1]
    assert.equal(row.split(',')[2], '6')
  })
})

// ── Объяснение КАЖДОГО сегмента ──────────────────────────────

describe('обоснование сегментов карточки', () => {
  const why = { visits: 8, days_since: 210, avg_gap_days: 14, spend: 60000, no_shows: 0, upcoming: 1 }

  it('каждый показанный сегмент получает своё обоснование', () => {
    const list = segmentExplanations(['lost', 'upcoming'], why)
    assert.equal(list.length, 2)
    assert.match(list[0].text, /8 visits, last one 210 days ago/)
    assert.match(list[1].text, /1 booking ahead/)
  })

  it('одинаковая проза печатается один раз, но объясняет оба чипа', () => {
    // «returning» и «regular» обоснованы одним и тем же числом визитов
    const list = segmentExplanations(['returning', 'regular'], why)
    assert.equal(list.length, 1, 'одно и то же не печатается дважды')
    assert.deepEqual(list[0].keys, ['returning', 'regular'])
    assert.equal(explanationIdFor(list, 'returning'), list[0].id)
    assert.equal(explanationIdFor(list, 'regular'), list[0].id,
      'у второго чипа тоже есть, на что сослаться для читалки')
  })

  it('сегмент без чисел не порождает пустой строки', () => {
    const list = segmentExplanations(['lost'], null)
    assert.deepEqual(list, [])
    assert.equal(explanationIdFor(list, 'lost'), null)
  })

  it('пустой набор не ломает разбор', () => {
    assert.deepEqual(segmentExplanations(undefined, why), [])
    assert.deepEqual(segmentExplanations([], why), [])
  })

  it('идентификаторы уникальны — иначе aria-describedby укажет не туда', () => {
    const list = segmentExplanations(['lost', 'upcoming', 'vip'], why)
    assert.equal(new Set(list.map((e) => e.id)).size, list.length)
  })
})
