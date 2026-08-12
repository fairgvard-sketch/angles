import { useEffect, useState } from 'react'
import { fetchWaitlistMatches, offerWaitlistSlot } from './reservations'
import { queueErrorText } from './waitlist'
import Drawer from './ui/Drawer'
import PartyCount from './ui/PartyCount'
import { Button } from './ui/Button'

/**
 * Кого позвать на освободившийся стол.
 *
 * Отмена вечерней брони просто освобождала стол, и на этом всё
 * заканчивалось. Гость, который час назад ушёл ни с чем и оставил
 * телефон, об этом не узнавал — заведение теряло и его, и выручку
 * вечера. Подбор для такого случая существовал в базе с 122 и не был
 * подключён ни к одному экрану.
 *
 * Панель появляется САМА после отмены, отказа и неявки — то есть в тот
 * момент, когда решение принимается. Отдельная кнопка «посмотреть лист
 * ожидания» означала бы, что о ней надо помнить в час пик.
 *
 * Предложение стол НЕ держит (правило 122): бронь создаётся только
 * когда гость согласится, и слот перепроверяется в этот момент.
 */

/** «19:00» в часах точки */
function hhmm(ms, tz) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(ms))
  } catch {
    return ''
  }
}

/** «18:00–21:00» из серверных TIME без секунд */
const windowLabel = (from, to) => `${String(from).slice(0, 5)}–${String(to).slice(0, 5)}`

export default function WaitlistRecovery({ locationId, atMs, tz, onClose }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null)
  const [offered, setOffered] = useState(() => new Set())

  useEffect(() => {
    let alive = true
    setRows(null)
    fetchWaitlistMatches(locationId, new Date(atMs).toISOString())
      .then((list) => { if (alive) setRows(list) })
      .catch((e) => { if (alive) { setRows([]); setError(queueErrorText(e.message)) } })
    return () => { alive = false }
  }, [locationId, atMs])

  async function offer(entry) {
    setBusy(entry.id)
    setError('')
    try {
      await offerWaitlistSlot(entry.id, new Date(atMs).toISOString(), 30)
      setOffered((cur) => new Set(cur).add(entry.id))
    } catch (e) {
      setError(queueErrorText(e.message))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Drawer
      labelledBy="waitlist-recovery-title"
      title={`${hhmm(atMs, tz)} is free`}
      subtitle="These guests are waiting and fit this slot."
      onClose={onClose}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      {error && <p className="form-error" role="alert">{error}</p>}

      {rows === null ? (
        <p className="form-hint" role="status">Checking who is waiting…</p>
      ) : rows.length === 0 ? (
        /* Пусто — это ответ, а не ошибка: очередь либо пуста, либо в ней
           только те, кого на этот слот не посадить. Сервер уже проверил
           и то, и другое. */
        <p className="empty-state">
          Nobody in the queue fits this slot right now.
        </p>
      ) : (
        <ul className="recovery-list">
          {rows.map((entry) => (
            <li key={entry.id}>
              <div className="recovery-guest">
                <strong>{entry.customer_name}</strong>
                {entry.customer_phone && (
                  <a href={`tel:${entry.customer_phone}`}>{entry.customer_phone}</a>
                )}
              </div>
              {/* Почему он здесь: компания, окно, зоны и что ему обещали.
                  Без этого список — просто «позвоните этим людям». */}
              <p className="recovery-why">
                <PartyCount n={entry.party_size} />
                {' · waits '}{windowLabel(entry.time_from, entry.time_to)}
                {Array.isArray(entry.zone_names) && entry.zone_names.length > 0
                  && ` · ${entry.zone_names.join(', ')}`}
                {entry.quoted_min != null && ` · quoted ${entry.quoted_min} min`}
              </p>
              {entry.note && <p className="recovery-note">{entry.note}</p>}
              {offered.has(entry.id) ? (
                /* Честное состояние: провайдера доставки в проекте нет
                   (122), поэтому «предложено» означает запись в очереди
                   и повод позвонить — а не отправленное сообщение. */
                <p className="form-hint">
                  Offer is held for 30 minutes — call the guest to confirm.
                </p>
              ) : (
                <Button
                  size="compact"
                  busy={busy === entry.id}
                  busyLabel="Offering…"
                  onClick={() => offer(entry)}
                >
                  Offer this slot
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  )
}
