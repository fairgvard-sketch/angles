/**
 * Правила парка касс — чистые функции без сети.
 *
 * Статус, «последний раз на связи» и совет владельцу решают, поймёт ли
 * он, что делать с молчащим терминалом. Это проверяется тестами, а не
 * взглядом на прод.
 */

/**
 * Статус устройства по «молчанию» и здоровью очереди. Пороги подобраны под
 * heartbeat раз в несколько минут: до 10 мин — на связи, до часа — задержка,
 * дальше — offline. Отдельно поднимаем проблему очереди, даже если касса на
 * связи: зависшая отправка важнее, чем «молчание».
 */
export function deviceStatus(device) {
  const s = device.silence_seconds
  if (device.outbox_failed) return 'error'
  if (s === null || s === undefined) return 'never'
  if (s > 3600) return 'offline'
  if (s > 600) return 'stale'
  return 'online'
}

export const STATUS_LABEL = {
  online: 'On line',
  stale: 'Delayed',
  offline: 'Offline',
  error: 'Queue stuck',
  never: 'Never seen',
}

/** Человекочитаемое «последний раз на связи»: 3m ago / 2h ago / 4d ago */
export function lastSeenLabel(device) {
  const s = device.silence_seconds
  if (s === null || s === undefined) return 'Never'
  if (s < 60) return 'Just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

/** Возраст самой старой неотправленной операции: «oldest 3h» */
export function outboxAgeLabel(device) {
  if (!device.outbox_oldest_at) return null
  const ms = Date.now() - new Date(device.outbox_oldest_at).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

// ── Что владельцу делать с проблемой (Phase 6) ───────────────

/**
 * Причина и следующий шаг. Строка «Offline» сама по себе ничего не
 * говорит: владельцу нужно знать, чинить ли сеть, идти ли к терминалу
 * или списать давно уехавшую кассу.
 */
export function deviceAdvice(device) {
  const status = deviceStatus(device)
  const days = device.silence_seconds ? Math.floor(device.silence_seconds / 86400) : 0
  if (status === 'error') {
    return 'Sales are stuck in the queue on the terminal. Open the register, check its internet, and keep the app in the foreground until the queue drains.'
  }
  if (status === 'never') {
    return 'This device registered but never reported in. If the terminal is gone, archive it — the record and its past sales stay.'
  }
  if (status === 'offline') {
    return days >= 7
      ? `Silent for ${days} days. If this terminal is no longer in use, archive it to keep the list about today’s work.`
      : 'The terminal has not reported in for over an hour. Check that it is powered on and online.'
  }
  if (status === 'stale') {
    return 'Reports are arriving late — usually a weak connection at the counter.'
  }
  return null
}

/** Устройство участвует в работе (архивные — нет) */
export function isArchived(device) {
  return Boolean(device.archived_at)
}

/** Поиск по имени, точке и версии — парк из одинаковых «Касс» иначе не разобрать */
export function filterFleet(fleet, { query = '', showArchived = false } = {}) {
  const needle = query.trim().toLowerCase()
  return (fleet ?? []).filter((device) => {
    if (!showArchived && isArchived(device)) return false
    if (!needle) return true
    return [device.name, device.location_name, device.app_version, device.bridge_version]
      .filter(Boolean).join(' ').toLowerCase().includes(needle)
  })
}

/** Человеческий текст ошибок парка */
export function fleetErrorText(message) {
  const m = String(message || '')
  if (m.includes('name_required')) return 'Enter a name for the device.'
  if (m.includes('not_found')) return 'This device is no longer in your organisation — refresh the list.'
  if (m.includes('permission') || m.includes('denied')) return 'Your role cannot change devices.'
  return m
}
