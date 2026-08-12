/**
 * Визит — то, что видит хостес. Один набор правил на полотно, список и
 * панель.
 *
 * До этого каждый экран сам разбирал строку брони: полотно собирало
 * `tableIds` из `tables_link` с запасным путём через `table_id` и
 * `hold_table_ids`, список собирал то же самое ещё раз и чуть иначе, а
 * панель — в третий раз. Три разбора одной строки расходятся не сразу,
 * а на первом же новом поле.
 *
 * Здесь разбор один и он чистый: сервер (152) отдаёт `table_ids` уже
 * связью, а модуль превращает ответ в то, чем оперируют раскладка и
 * подписи.
 */

/** Длительность визита по умолчанию — та же, что у сервера (063) */
const DEFAULT_DURATION_MIN = 90

/**
 * Окно ДАННЫХ для запроса суток.
 *
 * Считается в UTC и с запасом по суткам в обе стороны — сознательно.
 * Часовой пояс точки приезжает В ОТВЕТЕ, и вычислять по нему границы
 * запроса значит спросить сервер дважды: сначала «какой у тебя пояс»,
 * потом «дай визиты». Именно на этом полотно грузилось дважды при
 * каждом открытии: пояс и расписание приходили после первой загрузки,
 * меняли окно и запускали вторую.
 *
 * Запас в сутки покрывает любой пояс (±14 ч) и ночную смену, начатую
 * накануне. Лишнее отсечёт раскладка по окну дня.
 */
export function dayDataWindow(dateStr, padDays = 1) {
  const base = Date.parse(`${dateStr}T00:00:00Z`)
  if (!Number.isFinite(base)) return null
  const day = 86_400_000
  return { fromMs: base - padDays * day, toMs: base + (1 + padDays) * day }
}

/** Окно данных для отрезка в днях (список) — тот же запас по краям */
export function rangeDataWindow(dateStr, days, padDays = 1) {
  const base = Date.parse(`${dateStr}T00:00:00Z`)
  if (!Number.isFinite(base)) return null
  const day = 86_400_000
  return { fromMs: base - padDays * day, toMs: base + (days + padDays) * day }
}

/**
 * Строка визита → объект раскладки.
 *
 * `table_ids` приходит связью `reservation_tables` (119), где основной
 * стол уже первый. Запасной путь через `table_id`/`hold_table_ids`
 * оставлен для брони, у которой связь ещё не построена триггером.
 */
export function toBooking(visit, blockState) {
  const startMs = new Date(visit.reserved_at).getTime()
  const ids = Array.isArray(visit.table_ids) && visit.table_ids.length > 0
    ? visit.table_ids
    : [visit.table_id, ...(visit.hold_table_ids ?? [])].filter(Boolean)
  return {
    id: visit.id,
    tableIds: ids,
    startMs,
    endMs: startMs + (visit.duration_min || DEFAULT_DURATION_MIN) * 60_000,
    state: blockState(visit.status, visit.arrived_at, visit.order_id),
    guestName: visit.customer_name,
    partySize: visit.party_size,
    phone: visit.customer_phone ?? '',
    posSeated: visit.order_id != null,
  }
}

/** Столы точки из ответа сервера → строки полотна */
export function toTable(row) {
  return {
    id: row.id,
    label: row.label,
    seats: row.seats ?? 2,
    zoneId: row.zone_id ?? null,
    zoneName: row.zone_name ?? null,
    sortOrder: row.sort_order ?? 0,
    blocked: !!row.blocked,
  }
}

/**
 * Оставить только визиты суток точки.
 *
 * Запрос берёт с запасом (см. `dayDataWindow`), и без обрезки список
 * показал бы лишний день отдельной группой, а счётчик страниц соврал бы
 * на десяток строк.
 */
export function trimToWindow(visits, fromMs, toMs) {
  return (visits ?? []).filter((v) => {
    const at = new Date(v.reserved_at).getTime()
    return at >= fromMs && at < toMs
  })
}

/**
 * Одно главное действие для текущего состояния визита.
 *
 * Кнопки лежали плоским рядом под раскрытым пикером всех столов: чтобы
 * посадить гостя, хостес прокручивал панель мимо двадцати кнопок столов.
 * Действие, которое нужно СЕЙЧАС, обязано стоять первым и выглядеть как
 * ответ на вопрос «что дальше», а не как один из шести вариантов.
 *
 * Набор и порядок остаются зеркалом `set_reservation_status_web`:
 * экран не предлагает перехода, который сервер отклонит.
 */
export function primaryAction(actions) {
  if (!Array.isArray(actions) || actions.length === 0) return null
  return actions.find((a) => a.tone === 'primary') ?? null
}

/** Остальные действия — тише и ниже, разрушительные последними */
export function secondaryActions(actions) {
  const primary = primaryAction(actions)
  return (actions ?? []).filter((a) => a !== primary)
}

/**
 * Контекст постоянного гостя одной строкой.
 *
 * Показывается только то, что действительно что-то значит для смены.
 * «0 визитов, 0 отмен, 0 неявок» — это не контекст, а шум: у нового
 * гостя истории нет, и говорить об этом тремя нулями значит занимать
 * место, на котором должно стоять имя.
 */
export function guestSummary(guest) {
  if (!guest) return null
  const visits = Number(guest.visits) || 0
  const noShows = Number(guest.no_shows) || 0
  const cancelled = Number(guest.cancelled) || 0
  if (visits === 0 && noShows === 0 && cancelled === 0) return null

  const parts = []
  if (visits === 1) parts.push('1 visit')
  else if (visits > 1) parts.push(`${visits} visits`)
  if (noShows > 0) parts.push(noShows === 1 ? '1 no-show' : `${noShows} no-shows`)
  if (cancelled > 0) parts.push(cancelled === 1 ? '1 cancellation' : `${cancelled} cancellations`)

  return {
    text: parts.join(' · '),
    visits,
    noShows,
    cancelled,
    // Повторные неявки — предупреждение смене, а не ярлык гостю. Порог
    // именно два: один раз не пришёл кто угодно.
    warn: noShows >= 2,
    returning: visits >= 2,
  }
}

/**
 * Сводка POS-заказа словами.
 *
 * Денежная часть существует только там, где есть касса. У standalone
 * Reserve её нет — и это НЕ ноль: «средний чек 0 ₪» описывает гостя,
 * который ничего не потратил, а не заведение без кассы.
 */
export function orderSummary(order, formatMoney) {
  if (!order || order.id == null) return null
  const total = typeof formatMoney === 'function' ? formatMoney(order.total) : String(order.total)
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    total,
    paid: !!order.paid,
    // «Открыт» и «оплачен» — разные вопросы, и хостес задаёт второй.
    label: order.paid ? 'Paid' : 'Not paid yet',
  }
}

/**
 * История визита — только записанные факты.
 *
 * Из статуса события не выдумываются. У переходов, которых продукт не
 * записывал (подтверждение, отказ, завершение), есть один общий
 * `decided_at`, и назвать его «подтверждена в 14:20» нельзя: та же
 * колонка могла быть переписана отказом. Такой факт называется
 * нейтрально — «решение принято».
 *
 * `events` (153) — записанные переходы; когда они есть, они точнее
 * колонок и идут вместе с ними.
 */
export function visitHistory(visit, events = []) {
  const out = []
  const push = (at, text, kind) => {
    const ms = at ? new Date(at).getTime() : NaN
    if (Number.isFinite(ms)) out.push({ at: ms, text, kind })
  }

  const VIA = {
    public: 'Booked by the guest online',
    pos: 'Added on the register',
    backoffice: 'Added in the back office',
    waitlist: 'Accepted a waitlist offer',
  }
  push(visit?.created_at, VIA[visit?.created_via] ?? 'Booking created', 'created')

  const ack = visit?.rules_ack
  if (ack?.accepted_at) push(ack.accepted_at, 'Guest accepted the visit rules', 'rules')

  if (visit?.previous_reserved_at && visit?.rescheduled_at) {
    const was = new Date(visit.previous_reserved_at)
    push(visit.rescheduled_at,
      `Moved from ${was.toISOString().slice(11, 16)}`, 'moved')
  }
  push(visit?.confirm_requested_at, 'Confirmation requested', 'asked')
  push(visit?.guest_confirmed_at, 'Guest confirmed they are coming', 'confirmed')
  push(visit?.arrived_at, 'Guest seated', 'seated')
  push(visit?.cancelled_at, 'Cancelled by the guest', 'cancelled')

  for (const event of events ?? []) {
    push(event.at ?? event.created_at, eventText(event), event.type)
  }

  // Записанное событие точнее колонки: если переход записан обоими
  // способами, колонка уступает.
  const seen = new Set()
  const merged = []
  for (const item of out.sort((a, b) => a.at - b.at)) {
    const key = `${item.kind}:${item.at}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(item)
  }
  return merged
}

/** Подпись записанного перехода (153) */
export function eventText(event) {
  const by = event?.actor_name ? ` by ${event.actor_name}` : ''
  switch (event?.type) {
    case 'confirmed': return `Confirmed${by}`
    case 'rejected': return `Rejected${by}`
    case 'cancelled': return `Cancelled${by}`
    case 'completed': return `Visit completed${by}`
    case 'no_show': return `Marked as no-show${by}`
    case 'seated': return `Guest seated${by}`
    case 'moved': return `Moved to another time${by}`
    case 'tables': return `Tables changed${by}`
    default: return event?.type ? String(event.type) : 'Updated'
  }
}
