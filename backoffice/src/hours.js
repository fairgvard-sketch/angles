/**
 * Часы сотрудников — чистые правила без сети.
 *
 * Табель одновременно живёт на кассе и здесь, и расходиться им нельзя:
 * распечатка с терминала и таблица в кабинете обязаны показать один и тот
 * же день, тот же интервал и ту же сумму. Поэтому календарный день и день
 * недели считает СЕРВЕР (Kassa 143) в часовом поясе точки и присылает
 * готовыми полями `day`/`dow` — здесь их только показывают. Пересчёт на
 * клиенте вернул бы ночную смену на соседний день у владельца, открывшего
 * кабинет из другого часового пояса.
 *
 * Парная реализация на кассе — `src/features/timesheet/hours.ts`.
 */

/** Дни недели: 0 = воскресенье. Иврит — формат печатного табеля. */
export const HEBREW_DOW = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש']
export const EN_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Смены сотрудника → дни по возрастанию */
export function groupByDay(entries) {
  const days = new Map()
  for (const e of entries || []) {
    const day = days.get(e.day) || { day: e.day, dow: e.dow, entries: [], seconds: 0, hasOpen: false }
    day.entries.push(e)
    day.seconds += e.seconds
    day.hasOpen = day.hasOpen || e.is_open
    days.set(e.day, day)
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day))
}

/** YYYY-MM-DD → DD.MM.YYYY (формат табеля) */
export function formatDay(day) {
  const [y, m, d] = String(day).split('-')
  return `${d}.${m}.${y}`
}

/**
 * Время смены в поясе ТОЧКИ, а не браузера: владелец открывает кабинет из
 * отпуска, а в табеле обязаны стоять часы кассы.
 */
export function formatTime(iso, tz) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso))
  } catch {
    const d = new Date(iso)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
}

/** Секунды → «Ч:ММ» (8:30, а не 8.5 — так читают табель) */
export function formatHm(seconds) {
  const total = Math.max(0, Math.round((seconds || 0) / 60))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** Секунды → десятичные часы для Excel («8,50» — запятая, ru/he-Excel) */
export function decimalHours(seconds) {
  return (Math.max(0, seconds || 0) / 3600).toFixed(2).replace('.', ',')
}

/** «07:00 - 15:00» или «07:00 - 11:00, 12:00 - 15:00»; открытая смена — «…» */
export function formatRanges(day, tz, openMark = '…') {
  return day.entries
    .map((e) => `${formatTime(e.clock_in, tz)} - ${e.clock_out ? formatTime(e.clock_out, tz) : openMark}`)
    .join(', ')
}

/** Краткая строка табеля: «01.08.2026 א 07:00 - 15:00» */
export function formatDayLine(day, tz, dowLetters = HEBREW_DOW) {
  return `${formatDay(day.day)} ${dowLetters[day.dow] || ''} ${formatRanges(day, tz)}`.trim()
}

// ── Период ───────────────────────────────────────────────────

/** Ключ YYYY-MM-DD в локальном поясе (toISOString сдвинул бы дату) */
export function dateKey(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Первый и последний КАЛЕНДАРНЫЙ день месяца */
export function monthRange(year, month) {
  return { from: new Date(year, month, 1), to: new Date(year, month + 1, 0) }
}

/** «August 2026» — заголовок и имя файла выгрузки */
export function monthTitle(year, month) {
  return new Date(year, month, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

/** Сдвиг курсора месяца, не выпадающий за границы года */
export function shiftMonth(cursor, delta) {
  const d = new Date(cursor.year, cursor.month + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() }
}

// ── Кто ещё есть в штате ─────────────────────────────────────

/**
 * Сотрудники, которых НЕТ в отчёте за период — их дописывают в список
 * нулевой строкой.
 *
 * Отчёт отвечает «кто сколько отработал», поэтому человека в отпуске, в
 * выходной или забывшего отметиться в нём не существует. А открыть надо
 * именно его: посмотреть другой месяц или дописать пропущенную смену.
 *
 * Уволенные не добавляются — но если у них есть смены периода, они уже
 * пришли из отчёта и останутся: часы отработаны, из табеля их не
 * вычёркивают. Сотрудник без точки работает на всех, включая выбранную.
 *
 * Парная реализация на кассе — `idleStaff` в `hours.ts`.
 */
export function idleStaff(worked, roster, locationId = null) {
  const seen = new Set((worked || []).map((w) => w.staff_id))
  return (roster || [])
    .filter((s) => s.is_active && !seen.has(s.id))
    .filter((s) => !locationId || !s.location_id || s.location_id === locationId)
    .sort((a, b) => a.name.localeCompare(b.name))
}

// ── Выгрузка ─────────────────────────────────────────────────

/**
 * CSV для Excel: BOM (иврит не рассыпается), разделитель «;», десятичные
 * часы с запятой. Строка = смена, снизу — итоги по людям: файл уходит в
 * зарплату как есть, без ручной доводки.
 */
export function hoursToCsv(staff, tz, dowLetters = EN_DOW) {
  const esc = (v) => (/[";\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const row = (cells) => cells.map(esc).join(';')
  const lines = [row(['Employee', 'Date', 'Day', 'In', 'Out', 'Hours', 'Decimal', 'Location', 'Note'])]

  for (const person of staff || []) {
    for (const day of groupByDay(person.entries)) {
      for (const e of day.entries) {
        lines.push(row([
          person.name,
          formatDay(day.day),
          dowLetters[day.dow] || '',
          formatTime(e.clock_in, tz),
          e.clock_out ? formatTime(e.clock_out, tz) : '',
          formatHm(e.seconds),
          decimalHours(e.seconds),
          e.location_name || '',
          e.note || '',
        ]))
      }
    }
  }

  lines.push('')
  lines.push(row(['Employee', 'Days', 'Shifts', 'Hours', 'Decimal']))
  for (const person of staff || []) {
    lines.push(row([person.name, person.days, person.shifts, formatHm(person.seconds), decimalHours(person.seconds)]))
  }
  const total = (staff || []).reduce((sum, p) => sum + p.seconds, 0)
  lines.push(row(['Total', '', '', formatHm(total), decimalHours(total)]))

  return `\uFEFF${lines.join('\r\n')}`
}

/** Имя файла выгрузки: период виден без открытия файла */
export function hoursFileName(from, to, staffName) {
  const who = staffName ? `${staffName.replace(/[^\p{L}\p{N}]+/gu, '-')}_` : ''
  return `hours_${who}${dateKey(from)}_${dateKey(to)}.csv`
}
