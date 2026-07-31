import { useCallback, useEffect, useState } from 'react'
import { Clock, RefreshCw, Users } from 'lucide-react'
import {
  fetchWaitlist, fetchWaitlistMatches, offerWaitlistSlot, deskErrorText,
} from './reservations'

/**
 * Лист ожидания (Kassa 122): гости, которым не нашлось стола.
 *
 * Освободился слот — хостес вводит время и видит, кого можно позвать.
 * Подбор считает СЕРВЕР и проверяет не только пожелание гостя, но и
 * реальную возможность посадить: показать в списке того, кого посадить
 * некуда, значит обмануть и хостес, и гостя.
 *
 * Предложение стол НЕ держит. Бронь появляется, только когда гость
 * согласился, и слот перепроверяется в этот момент — иначе лист сам стал
 * бы источником фантомной занятости.
 */
export default function WaitlistPanel({ locationId }) {
  const [entries, setEntries] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null)

  // Время освободившегося слота: локальное поле datetime-local
  const [slot, setSlot] = useState('')
  const [matches, setMatches] = useState(null)
  const [matching, setMatching] = useState(false)

  const load = useCallback(async () => {
    if (!locationId) return
    try {
      setEntries(await fetchWaitlist(locationId))
      setError('')
    } catch (e) {
      setError(deskErrorText(e.message))
    }
  }, [locationId])

  useEffect(() => { setEntries(null); setMatches(null); load() }, [locationId, load])

  async function findMatches() {
    if (!slot) return
    setMatching(true)
    try {
      setMatches(await fetchWaitlistMatches(locationId, new Date(slot).toISOString()))
      setError('')
    } catch (e) {
      setError(deskErrorText(e.message))
    } finally {
      setMatching(false)
    }
  }

  async function offer(id) {
    setBusy(id)
    try {
      await offerWaitlistSlot(id, new Date(slot).toISOString(), 30)
      await load()
      await findMatches()
    } catch (e) {
      setError(deskErrorText(e.message))
    } finally {
      setBusy(null)
    }
  }

  const waiting = (entries ?? []).filter((e) => e.status === 'waiting')
  const offered = (entries ?? []).filter((e) => e.status === 'offered')

  return (
    <section className="panel form-panel">
      <div className="panel-heading">
        <div>
          <h2>Waitlist</h2>
          <p>Guests who could not get a table. Free one up — see who fits.</p>
        </div>
        <button type="button" className="icon-button" aria-label="Refresh" onClick={load}>
          <RefreshCw />
        </button>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="qr-grid">
        <label className="qr-field">
          <span>A slot just freed up at</span>
          <input type="datetime-local" value={slot} onChange={(e) => setSlot(e.target.value)} />
        </label>
        <label className="qr-field">
          <span>&nbsp;</span>
          <button
            type="button"
            className="secondary-button"
            disabled={!slot || matching}
            onClick={findMatches}
          >
            {matching ? 'Checking…' : 'Who fits?'}
          </button>
        </label>
      </div>

      {matches !== null && (
        matches.length === 0 ? (
          <p className="empty-state">
            Nobody on the list fits that time — either no one asked for it, or
            there is still no table free for their party.
          </p>
        ) : (
          <div className="order-grid">
            {matches.map((m) => (
              <article className="order-card" key={m.id}>
                <header className="order-card-head">
                  <div>
                    <strong>{m.customer_name}</strong>
                    <small>
                      <Users /> {m.party_size}
                      {' · '}<Clock /> {m.time_from?.slice(0, 5)}–{m.time_to?.slice(0, 5)}
                      {m.customer_phone ? ` · ${m.customer_phone}` : ''}
                    </small>
                  </div>
                </header>
                {m.note && <p className="order-note">{m.note}</p>}
                <footer className="order-card-foot">
                  <span />
                  <div className="order-actions">
                    <button
                      type="button"
                      className="primary-button compact"
                      disabled={busy != null}
                      onClick={() => offer(m.id)}
                    >
                      {busy === m.id ? '…' : 'Offer this slot'}
                    </button>
                  </div>
                </footer>
              </article>
            ))}
          </div>
        )
      )}

      <div className="panel-heading" style={{ marginTop: 20 }}>
        <div>
          <h3>Waiting</h3>
          <p>The list itself, oldest first.</p>
        </div>
      </div>

      {entries === null ? (
        <p className="empty-state">Loading…</p>
      ) : waiting.length === 0 && offered.length === 0 ? (
        <p className="empty-state">Nobody is waiting.</p>
      ) : (
        <div className="order-grid is-history">
          {[...offered, ...waiting].map((e) => (
            <article className={`order-card is-${e.status === 'offered' ? 'confirmed' : 'new'}`} key={e.id}>
              <header className="order-card-head">
                <div>
                  <strong>{e.customer_name}</strong>
                  <small>
                    {e.wanted_date} · {e.time_from?.slice(0, 5)}–{e.time_to?.slice(0, 5)}
                    {' · '}<Users /> {e.party_size}
                  </small>
                </div>
                <span className={`order-status is-${e.status === 'offered' ? 'ready' : 'new'}`}>
                  {e.status === 'offered' ? 'Offer sent' : 'Waiting'}
                </span>
              </header>
              {e.status === 'offered' && e.offer_expires && (
                <p className="form-hint">
                  Offer for {new Date(e.offer_at).toLocaleString([], {
                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                  })}, expires {new Date(e.offer_expires).toLocaleTimeString([], {
                    hour: '2-digit', minute: '2-digit',
                  })}. The table is not held until the guest agrees.
                </p>
              )}
              {e.note && <p className="order-note">{e.note}</p>}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
