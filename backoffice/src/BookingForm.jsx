import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { createReservation, deskErrorText, fromLocalInput, toLocalInput } from './reservations'

/**
 * Ручная бронь и walk-in (Kassa 127).
 *
 * До неё веб-стол умел только реагировать на заявки гостей: позвонивший
 * по телефону и вошедший с улицы заводились ТОЛЬКО на кассе, а
 * standalone-точке (Reserve без POS) их записать было негде.
 *
 * Стол по умолчанию подбирает сервер — тем же алгоритмом, что и гостю.
 * Хостес может назвать стол сам, но занятость всё равно проверяет
 * сервер: клиентская проверка разошлась бы с чужим экраном.
 */
export default function BookingForm({ locationId, tables, tz, mode, onClose, onCreated }) {
  const walkIn = mode === 'walk-in'
  const firstRef = useRef(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [party, setParty] = useState(2)
  const [at, setAt] = useState(() => toLocalInput(Date.now() + 60 * 60_000, tz))
  const [note, setNote] = useState('')
  const [picked, setPicked] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const tableGroups = useMemo(() => {
    const groups = new Map()
    for (const table of tables.filter((item) => !item.blocked)) {
      const key = table.zoneId ?? '__none__'
      if (!groups.has(key)) {
        groups.set(key, {
          id: key,
          name: table.zoneName || 'No zone',
          tables: [],
        })
      }
      groups.get(key).tables.push(table)
    }
    return [...groups.values()]
  }, [tables])

  useEffect(() => {
    firstRef.current?.focus()
    function onKey(event) { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function submit(event) {
    event.preventDefault()
    if (!name.trim()) {
      setError('Enter the guest name.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await createReservation(locationId, {
        name: name.trim(),
        phone: phone.trim(),
        partySize: Number(party) || 2,
        at: walkIn ? null : fromLocalInput(at, tz),
        note: note.trim() || null,
        tableIds: picked.length > 0 ? picked : null,
        walkIn,
      })
      onCreated(result)
    } catch (e) {
      setError(deskErrorText(e.message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <form
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-form-title"
        onSubmit={submit}
      >
        <div className="help-head">
          <h3 id="booking-form-title">{walkIn ? 'Seat a walk-in' : 'New reservation'}</h3>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X /></button>
        </div>
        <p className="sheet-sub">
          {walkIn
            ? 'The guest is already here — the table is taken from now.'
            : 'A booking you took by phone or in person.'}
        </p>

        <div className="qr-grid">
          <label className="qr-field">
            <span>Guest name</span>
            <input ref={firstRef} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="qr-field">
            <span>Phone</span>
            <input
              type="tel"
              value={phone}
              maxLength={20}
              placeholder={walkIn ? 'Optional' : '05X XXX XXXX'}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <label className="qr-field">
            <span>Guests</span>
            <input
              type="number"
              min={1}
              max={50}
              value={party}
              onChange={(e) => setParty(e.target.value)}
            />
          </label>
          {!walkIn && (
            <label className="qr-field">
              <span>Date and time</span>
              <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} required />
            </label>
          )}
        </div>

        <label className="qr-field">
          <span>Note</span>
          <input value={note} maxLength={200} placeholder="Birthday, high chair, allergy…" onChange={(e) => setNote(e.target.value)} />
        </label>

        <div className="sheet-section">
          <span className="sheet-section-title">Table assignment</span>
          <p className="form-hint">
            Automatic is safest. Choose one or more tables only when you need
            to override the server’s free-table selection.
          </p>
          <button
            type="button"
            className={`table-choice table-choice-auto${picked.length === 0 ? ' is-active' : ''}`}
            aria-pressed={picked.length === 0}
            onClick={() => setPicked([])}
          >
            <strong>Automatic</strong>
            <small>Best available table</small>
          </button>
          <div className="booking-table-groups">
            {tableGroups.map((group) => (
              <section className="booking-table-group" key={group.id}>
                <span className="booking-zone-name">{group.name}</span>
                <div className="booking-table-pick">
                  {group.tables.map((table) => (
                    <button
                      key={table.id}
                      type="button"
                      className={`table-choice${picked.includes(table.id) ? ' is-active' : ''}`}
                      aria-pressed={picked.includes(table.id)}
                      onClick={() => setPicked((cur) => (
                        cur.includes(table.id)
                          ? cur.filter((id) => id !== table.id)
                          : [...cur, table.id]
                      ))}
                    >
                      <strong>{table.label}</strong>
                      <small>{table.seats} seats</small>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="order-actions booking-form-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary-button compact" disabled={busy}>
            {busy ? 'Saving…' : (walkIn ? 'Seat the guest' : 'Create booking')}
          </button>
        </div>
      </form>
    </div>
  )
}
