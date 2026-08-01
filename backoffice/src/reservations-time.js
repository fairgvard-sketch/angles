/**
 * Чистые правила стола хостес: время визита и текст ошибок сервера.
 *
 * Отделено от `reservations.js` (там Supabase) намеренно: перевод часов
 * точки и разбор ошибок ломаются молча, поэтому проверяются тестами.
 */

// Расширение указано явно — модуль обязан импортироваться голым Node.
import { zonedToUtc } from './timeline.js'

/** Человеческий текст ошибок стола хостес */
export function deskErrorText(message) {
  const m = String(message || '')
  if (m.includes('pos_mode')) return 'This booking is seated into a POS order — it is handled on the register.'
  if (m.includes('table_busy')) return 'That table is taken for this time — pick another table or another time.'
  if (m.includes('full_slot')) return 'No free table fits this party at that time.'
  if (m.includes('name_required')) return 'Enter the guest name.'
  if (m.includes('invalid_party')) return 'Party size looks wrong — enter a number of guests.'
  if (m.includes('invalid_duration')) return 'Visit length must be between 15 minutes and 24 hours.'
  if (m.includes('invalid_zone')) return 'That zone no longer exists.'
  if (m.includes('no_tables')) return 'Add tables in Tables & zones before booking anyone in.'
  if (m.includes('not_active')) return 'This booking is no longer active.'
  if (m.includes('not_confirmed')) return 'Confirm the booking before seating the guest.'
  if (m.includes('not_found')) return 'This booking is no longer there — refresh the desk.'
  if (m.includes('module_disabled')) return 'The Reserve product is not active for this account.'
  if (m.includes('access denied')) return 'Your role cannot change bookings for this location.'
  return m
}

// ── Локальное время точки в поле «дата и время» ──────────────
/**
 * `<input type="datetime-local">` работает в часах БРАУЗЕРА, а бронь
 * живёт в часах точки. Хостес в другом городе (или с телефоном на UTC)
 * иначе поставит гостя не на то время.
 */
export function toLocalInput(ms, tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(ms))
    const get = (t) => parts.find((p) => p.type === t)?.value
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
  } catch {
    return ''
  }
}

/** Обратное преобразование: 'YYYY-MM-DDTHH:MM' в зоне точки → ISO */
export function fromLocalInput(value, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value || '')
  if (!m) return null
  const minutes = Number(m[4]) * 60 + Number(m[5])
  const at = zonedToUtc(`${m[1]}-${m[2]}-${m[3]}`, minutes, tz)
  return Number.isNaN(at.getTime()) ? null : at.toISOString()
}
