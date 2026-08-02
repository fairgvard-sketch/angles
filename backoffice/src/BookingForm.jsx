import { useEffect, useMemo, useRef, useState } from 'react'
import { createReservation, deskErrorText, fromLocalInput, toLocalInput } from './reservations'
import { conflictAlternatives, isConflict } from './desk-availability'
import Drawer from './ui/Drawer'
import { Button } from './ui/Button'

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
export default function BookingForm({
  locationId, tables, bookings, tz, mode, onClose, onCreated,
}) {
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
  // Ошибка поля живёт рядом с полем: «Enter the guest name» под кнопкой
  // отправки заставляет искать, что именно не так.
  const [nameError, setNameError] = useState('')
  // Отказ по занятости — единственный случай, когда есть что предложить
  const [conflict, setConflict] = useState(null)

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

  useEffect(() => { firstRef.current?.focus() }, [])

  async function submit(event) {
    event.preventDefault()
    if (!name.trim()) {
      setNameError('Enter the guest name.')
      firstRef.current?.focus()
      return
    }
    setBusy(true)
    setError('')
    setNameError('')
    setConflict(null)
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
      /*
       * Введённое НЕ стирается: форма остаётся как была, а к отказу по
       * занятости добавляются варианты из тех же данных, что на экране.
       * Это подсказка — занятость всё равно перепроверит сервер.
       */
      if (isConflict(e.message)) {
        const wantedMs = walkIn ? Date.now() : fromLocalInput(at, tz)
        setConflict(conflictAlternatives({
          tables,
          bookings,
          wantedMs: new Date(wantedMs).getTime(),
          partySize: Number(party) || 2,
        }))
      }
    } finally {
      setBusy(false)
    }
  }

  /** «19:45» в часах точки — форма и подсказки говорят одним временем */
  const hhmm = (ms) => new Date(ms).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: tz,
  })

  return (
    <Drawer
      labelledBy="booking-form-title"
      title={walkIn ? 'Seat a walk-in' : 'New reservation'}
      subtitle={walkIn
        ? 'The guest is already here — the table is taken from now.'
        : 'A booking you took by phone or in person.'}
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            size="compact"
            type="submit"
            form="booking-form"
            busy={busy}
            busyLabel="Saving…"
          >
            {walkIn ? 'Seat the guest' : 'Create booking'}
          </Button>
        </>
      )}
    >
      <form id="booking-form" onSubmit={submit} className="drawer-form">
        <div className="qr-grid">
          <label className="qr-field">
            <span>Guest name</span>
            <input
              ref={firstRef}
              value={name}
              maxLength={120}
              aria-invalid={nameError ? 'true' : undefined}
              aria-describedby={nameError ? 'booking-name-error' : undefined}
              onChange={(e) => { setName(e.target.value); setNameError('') }}
              required
            />
            {nameError && <span className="field-error" id="booking-name-error">{nameError}</span>}
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

        {/* Отказ по занятости — единственный, к которому есть что
            добавить: что свободно сейчас и когда освободится. */}
        {conflict && (
          <div className="conflict-hint">
            {conflict.tables.length > 0 && (
              <>
                <p className="form-hint">Free at this time — tap to pick:</p>
                <div className="conflict-options">
                  {conflict.tables.slice(0, 6).map((table) => (
                    <Button
                      key={table.id}
                      onClick={() => { setPicked([table.id]); setConflict(null) }}
                    >
                      {table.label} · {table.seats} seats
                    </Button>
                  ))}
                </div>
              </>
            )}
            {!walkIn && conflict.times.length > 0 && (
              <>
                <p className="form-hint">Nearest free times:</p>
                <div className="conflict-options">
                  {conflict.times.map((slot) => (
                    <Button
                      key={slot.at}
                      onClick={() => {
                        setAt(toLocalInput(slot.at, tz))
                        setPicked([])
                        setConflict(null)
                      }}
                    >
                      {hhmm(slot.at)}
                    </Button>
                  ))}
                </div>
              </>
            )}
            {conflict.tables.length === 0 && conflict.times.length === 0 && (
              <p className="form-hint">
                Nothing is free nearby on this screen — try another day or free a table first.
              </p>
            )}
            <p className="form-hint">
              Suggestions come from what this screen already knows; the server
              checks availability again when you save.
            </p>
          </div>
        )}
      </form>
    </Drawer>
  )
}
