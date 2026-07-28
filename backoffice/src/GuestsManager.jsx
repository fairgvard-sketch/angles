import { useEffect, useState } from 'react'
import { Users, RefreshCw, X, Search } from 'lucide-react'
import {
  fetchGuests, fetchGuestCard, formatMoney, formatPhone, lastVisitLabel, formatDateTime,
} from './guests'

/**
 * «Customers» — база клиентов лояльности организации (114). Владельцу нужно
 * видеть, кто ходит, как часто и что покупает: список с балансом и визитами,
 * карточка — состав каждого заказа, любимые позиции, заметка и журнал баллов.
 *
 * Read-only: балансы меняет только касса (apply_loyalty/pay_order), заметку и
 * имя правят на терминале. Здесь — аналитика, а не редактирование.
 */

function GuestRow({ guest, mode, onOpen }) {
  return (
    <button className="data-row guest-row" onClick={() => onOpen(guest)}>
      <div className="guest-main">
        <strong>{guest.name || formatPhone(guest.phone)}</strong>
        <small>{formatPhone(guest.phone)}</small>
      </div>
      <div className="guest-meta">
        <span className="guest-balance">
          {mode === 'stamps'
            ? `${guest.stamps} stamps`
            : mode === 'points'
              ? formatMoney(guest.points)
              // Режим ещё не известен — показываем то, что ненулевое
              : guest.stamps > 0 ? `${guest.stamps} stamps` : formatMoney(guest.points)}
        </span>
        <span className="guest-visits">{guest.visits} visit{guest.visits === 1 ? '' : 's'}</span>
        <span className="guest-spent">{formatMoney(guest.total_spent)}</span>
        <span className="guest-seen">{lastVisitLabel(guest.last_visit_at)}</span>
      </div>
    </button>
  )
}

function GuestCard({ guest, onModeKnown, onClose }) {
  const [card, setCard] = useState(null)
  const [error, setError] = useState('')
  const [openOrder, setOpenOrder] = useState(null)
  const [tab, setTab] = useState('orders')

  useEffect(() => {
    let alive = true
    fetchGuestCard(guest.id)
      .then((d) => { if (alive) { setCard(d); onModeKnown(d?.loyalty_mode) } })
      .catch((e) => { if (alive) setError(e.message) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guest.id])

  // Режим приходит с сервера (115): штампы — счёт, баллы — деньги
  const mode = card?.loyalty_mode === 'stamps' ? 'stamps' : 'points'
  const orders = card?.orders ?? []
  const favorites = card?.favorites ?? []
  const events = card?.events ?? []

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="modal-head">
          <h2>{guest.name || formatPhone(guest.phone)}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X /></button>
        </header>

        <div className="modal-body">
          <div className="guest-stats">
            <div><span>{mode === 'stamps' ? 'Stamps' : 'Points'}</span>
              <strong>{mode === 'stamps' ? guest.stamps : formatMoney(guest.points)}</strong></div>
            <div><span>Visits</span><strong>{guest.visits}</strong></div>
            <div><span>Total spent</span><strong>{formatMoney(guest.total_spent)}</strong></div>
            <div><span>Last visit</span><strong>{lastVisitLabel(guest.last_visit_at)}</strong></div>
          </div>

          {card?.notes && (
            <p className="guest-note">{card.notes}</p>
          )}

          {favorites.length > 0 && (
            <div className="guest-favs">
              <span className="guest-section-label">Usually orders</span>
              <div className="guest-fav-list">
                {favorites.map((f) => (
                  <span className="guest-fav" key={f.name}>{f.name} · {f.qty}</span>
                ))}
              </div>
            </div>
          )}

          <div className="guest-tabs">
            <button
              className={tab === 'orders' ? 'is-active' : ''}
              onClick={() => setTab('orders')}
            >Orders</button>
            <button
              className={tab === 'events' ? 'is-active' : ''}
              onClick={() => setTab('events')}
            >Loyalty log</button>
          </div>

          {error && <p className="form-error" role="alert">{error}</p>}

          {!card && !error ? (
            <p className="empty-state">Loading…</p>
          ) : tab === 'orders' ? (
            orders.length === 0 ? (
              <p className="empty-state">No orders yet</p>
            ) : (
              <div className="guest-orders">
                {orders.map((o) => (
                  <div className="guest-order" key={o.id}>
                    <button
                      className="guest-order-head"
                      onClick={() => setOpenOrder(openOrder === o.id ? null : o.id)}
                    >
                      <strong>#{o.daily_number}</strong>
                      <span className="guest-order-date">{formatDateTime(o.created_at)}</span>
                      <span className="guest-order-total">{formatMoney(o.total)}</span>
                      <span className="guest-order-chevron">{openOrder === o.id ? '▴' : '▾'}</span>
                    </button>
                    {openOrder === o.id && (
                      <div className="guest-order-items">
                        {o.items.length === 0 ? (
                          <p className="empty-state">No items</p>
                        ) : o.items.map((it, i) => (
                          <div className="guest-order-item" key={i}>
                            <span className="qty">{it.qty}×</span>
                            <span className="name">
                              {it.name}{it.variant_name ? ` · ${it.variant_name}` : ''}
                            </span>
                            <span className="sum">{formatMoney(it.line_total)}</span>
                          </div>
                        ))}
                        {o.loyalty_discount > 0 && (
                          <div className="guest-order-item is-discount">
                            <span className="name">Loyalty reward</span>
                            <span className="sum">−{formatMoney(o.loyalty_discount)}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          ) : events.length === 0 ? (
            <p className="empty-state">Nothing earned yet</p>
          ) : (
            <div className="guest-events">
              {events.map((e, i) => {
                const delta = mode === 'stamps' ? e.stamps_delta : e.points_delta
                return (
                  <div className="guest-event" key={i}>
                    <span className="guest-event-date">{formatDateTime(e.created_at)}</span>
                    <span className={`guest-event-delta ${delta > 0 ? 'is-positive' : ''}`}>
                      {delta > 0 ? '+' : ''}
                      {mode === 'stamps' ? delta : formatMoney(Math.abs(delta))}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function GuestsManager({ context }) {
  const [guests, setGuests] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)

  // Поиск идёт на сервер — не дёргаем его на каждую букву
  useEffect(() => {
    const id = setTimeout(() => setQuery(search), 300)
    return () => clearTimeout(id)
  }, [search])

  async function load(q, silent = false) {
    if (!silent) setLoading(true)
    setError('')
    try {
      setGuests(await fetchGuests(q))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(query)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  // Режим программы (штампы/баллы) знает только сервер — контекст
  // бэкофиса его не отдаёт. Берём из первой открытой карточки (115) и
  // запоминаем; до этого список показывает и штампы, и баллы.
  const [mode, setMode] = useState(null)

  const total = guests?.length ?? 0

  return (
    <>
      <section className="page-heading compact-heading">
        <p className="eyebrow">{context.organization?.name}</p>
        <h1>Customers</h1>
        <p>Loyalty members, their visits and what they buy.</p>
      </section>

      <div className="overview-toolbar">
        <div className="guest-search">
          <Search />
          <input
            type="text"
            placeholder="Name or phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          className="icon-button"
          onClick={() => load(query)}
          title="Refresh"
          disabled={loading}
        ><RefreshCw /></button>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {loading && !guests ? (
        <p className="empty-state">Loading…</p>
      ) : total === 0 ? (
        <section className="section-placeholder panel">
          <span className="section-icon"><Users /></span>
          <div>
            <h2>{query ? 'Nothing found' : 'No customers yet'}</h2>
            <p>
              {query
                ? 'Try a different name or phone number.'
                : 'Members appear here once the loyalty programme is switched on and guests start paying at the till.'}
            </p>
          </div>
        </section>
      ) : (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>{total} customer{total === 1 ? '' : 's'}</h2>
              <p>Most recent visitors first.</p>
            </div>
          </div>
          <div className="data-list">
            {guests.map((g) => (
              <GuestRow key={g.id} guest={g} mode={mode} onOpen={setSelected} />
            ))}
          </div>
        </section>
      )}

      {selected && (
        <GuestCard
          guest={selected}
          onModeKnown={(m) => { if (m && m !== 'off') setMode(m) }}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  )
}
