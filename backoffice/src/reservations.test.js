import test from 'node:test'
import assert from 'node:assert/strict'
import { deskErrorText, fromLocalInput, toLocalInput } from './reservations-time.js'

/**
 * Время визита в поле формы.
 *
 * `<input type="datetime-local">` живёт в часах БРАУЗЕРА, а бронь — в
 * часах точки. Хостес из другого города (или с телефоном на UTC) иначе
 * посадит гостя не на то время, и заметит это только гость.
 */

const TZ = 'Asia/Jerusalem'

test('момент времени показывается в часах точки', () => {
  // 1 августа 2026, 09:00 UTC = 12:00 в Иерусалиме (летнее время)
  assert.equal(toLocalInput(Date.UTC(2026, 7, 1, 9, 0), TZ), '2026-08-01T12:00')
  // 31 декабря 2026, 22:30 UTC = уже 00:30 следующего дня (зимнее время)
  assert.equal(toLocalInput(Date.UTC(2026, 11, 31, 22, 30), TZ), '2027-01-01T00:30')
})

test('введённое время читается как время точки, а не браузера', () => {
  assert.equal(fromLocalInput('2026-08-01T12:00', TZ), new Date(Date.UTC(2026, 7, 1, 9, 0)).toISOString())
  assert.equal(fromLocalInput('2026-12-31T20:00', TZ), new Date(Date.UTC(2026, 11, 31, 18, 0)).toISOString())
})

test('преобразование переживает круг', () => {
  const ms = Date.UTC(2026, 7, 1, 16, 45)
  assert.equal(fromLocalInput(toLocalInput(ms, TZ), TZ), new Date(ms).toISOString())
})

test('в зоне без летнего времени смещение не плавает', () => {
  assert.equal(toLocalInput(Date.UTC(2026, 7, 1, 9, 0), 'UTC'), '2026-08-01T09:00')
  assert.equal(fromLocalInput('2026-08-01T09:00', 'UTC'), new Date(Date.UTC(2026, 7, 1, 9, 0)).toISOString())
})

test('мусор во вводе не превращается в дату', () => {
  assert.equal(fromLocalInput('', TZ), null)
  assert.equal(fromLocalInput('вчера', TZ), null)
  assert.equal(fromLocalInput('2026-08-01', TZ), null)
})

test('ошибки сервера переводятся на язык хостес', () => {
  assert.match(deskErrorText('table_busy'), /taken/i)
  assert.match(deskErrorText('full_slot'), /no free table/i)
  assert.match(deskErrorText('name_required'), /name/i)
  assert.match(deskErrorText('no_tables'), /Tables & zones/i)
  assert.match(deskErrorText('pos_mode'), /register/i)
  assert.match(deskErrorText('backoffice access denied'), /role/i)
  // Неизвестное сообщение не проглатывается: лучше сырой текст, чем «что-то пошло не так»
  assert.equal(deskErrorText('weird failure'), 'weird failure')
})
