import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Users, RefreshCw, X, Search, Pencil, Download, GitMerge, ShieldOff, AlertTriangle,
} from 'lucide-react'
import {
  fetchGuests, fetchGuestCard, fetchGuestTags, fetchDuplicates,
  saveGuestProfile, mergeGuests, anonymizeGuest,
  formatMoney, formatPhone, normalizePhoneInput, lastVisitLabel, formatDateTime,
  SEGMENTS, SORTS, segmentSummary, parseTagsInput, TAG_LIMIT,
  guestsToCsv, csvFileName, duplicateReason, mergeConfirmText, mergePreview, mergeSources,
  customerErrorText,
} from './guests'
import { PageHeader } from './ui/Layout'
import Drawer from './ui/Drawer'
import Tabs from './ui/Tabs'
import ConfirmDialog from './ui/ConfirmDialog'
import { Button } from './ui/Button'

/**
 * «Customers» — база клиентов организации (114/115/121, правки 131).
 *
 * Раздел умел только читать: имя и заметку правили на терминале, телефон
 * не правился нигде, а один человек с двумя написаниями номера жил двумя
 * записями. Здесь владелец правит профиль, объединяет дубли, режет базу
 * на сегменты, выгружает срез и стирает данные по просьбе клиента.
 *
 * Балансы по-прежнему меняет только касса (apply_loyalty/pay_order):
 * начислять баллы из кабинета — это не правка профиля, а операция.
 */

function TagChips({ tags }) {
  if (!tags?.length) return null
  return (
    <span className="guest-row-tags">
      {tags.map((tag) => <span className="guest-tag" key={tag}>{tag}</span>)}
    </span>
  )
}

function GuestRow({ guest, mode, onOpen }) {
  return (
    <button
      className="data-row guest-row"
      onClick={() => onOpen(guest)}
      aria-label={`Open ${guest.name || formatPhone(guest.phone)}`}
    >
      <div className="guest-main">
        <strong>{guest.name || formatPhone(guest.phone)}</strong>
        <small>{formatPhone(guest.phone)}</small>
        <TagChips tags={guest.tags} />
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

/**
 * Правка профиля. Телефон — ключ узнавания: по нему находят человека
 * заказы с сайта и брони, поэтому занятый номер сервер отдаёт отдельным
 * кодом, а кабинет предлагает слияние вместо «нарушения уникальности».
 */
function ProfileEditor({ guest, card, onSaved, onCancel }) {
  const [name, setName] = useState(card?.name ?? guest.name ?? '')
  const [phone, setPhone] = useState(card?.phone ?? guest.phone ?? '')
  const [notes, setNotes] = useState(card?.notes ?? '')
  const [tagText, setTagText] = useState((card?.tags ?? []).join(', '))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const tags = parseTagsInput(tagText)

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const digits = normalizePhoneInput(phone)
      await saveGuestProfile(guest.id, {
        name: name.trim() || null,
        // Телефон отправляем только изменённым: иначе любая правка
        // заметки спотыкалась бы о проверку номера.
        phone: digits && digits !== (card?.phone ?? guest.phone) ? digits : null,
        notes,
        tags,
      })
      onSaved()
    } catch (err) {
      setError(customerErrorText(err.message))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="guest-editor" onSubmit={submit}>
      <div className="field-row">
        <label>
          <span>Name</span>
          <input
            type="text"
            value={name}
            maxLength={60}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          <span>Phone</span>
          <input
            type="text"
            inputMode="tel"
            value={phone}
            maxLength={20}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
      </div>
      <label>
        <span>Tags</span>
        <input
          type="text"
          value={tagText}
          placeholder="VIP, allergy, regular"
          onChange={(e) => setTagText(e.target.value)}
        />
      </label>
      <p className="form-hint guest-editor-hint">
        Separate tags with commas — up to {TAG_LIMIT}. Tags and notes stay
        internal: guests never see them.
      </p>
      <label>
        <span>Note</span>
        <textarea
          value={notes}
          maxLength={500}
          rows={3}
          placeholder="Oat milk, no sugar"
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="guest-editor-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary-button compact" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

/**
 * Стирание личных данных. Необратимо, поэтому сервер сверяет введённый
 * номер с профилем: промах строкой в списке не должен стереть чужого
 * человека. Что остаётся — сказано прямо здесь, а не в справке.
 */
function ErasePanel({ guest, onDone, onCancel }) {
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await anonymizeGuest(guest.id, confirm)
      onDone()
    } catch (err) {
      setError(customerErrorText(err.message))
      setBusy(false)
    }
  }

  return (
    <form className="guest-erase" onSubmit={submit}>
      <p className="guest-erase-lead">
        <AlertTriangle aria-hidden />
        Erase the name, phone, note and tags of this customer, and the contact
        details on their past bookings.
      </p>
      <p className="guest-erase-keep">
        Orders and receipts stay: they are accounting records and must be kept.
        Loyalty balance stays with the empty profile and can no longer be
        claimed — the phone will not match anyone.
      </p>
      <label>
        <span>Type {formatPhone(guest.phone)} to confirm</span>
        <input
          type="text"
          inputMode="tel"
          value={confirm}
          autoFocus
          onChange={(e) => setConfirm(e.target.value)}
        />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="guest-editor-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="danger-button" disabled={busy}>
          {busy ? 'Erasing…' : 'Erase personal data'}
        </button>
      </div>
    </form>
  )
}

function GuestCard({ guest, onModeKnown, onChanged, onClose }) {
  const [card, setCard] = useState(null)
  const [error, setError] = useState('')
  const [openOrder, setOpenOrder] = useState(null)
  const [tab, setTab] = useState('orders')
  const [pane, setPane] = useState('view')

  const load = useCallback(() => {
    let alive = true
    fetchGuestCard(guest.id)
      .then((d) => { if (alive) { setCard(d); onModeKnown(d?.loyalty_mode) } })
      .catch((e) => { if (alive) setError(customerErrorText(e.message)) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guest.id])

  useEffect(() => load(), [load])

  // Режим приходит с сервера (115): штампы — счёт, баллы — деньги
  const mode = card?.loyalty_mode === 'stamps' ? 'stamps' : 'points'
  const orders = card?.orders ?? []
  const favorites = card?.favorites ?? []
  const events = card?.events ?? []
  // Kassa 121: ресторанное поведение и внутренние метки. У точки без кассы
  // заказы пусты, а этот блок полон — профиль осмыслен и без POS.
  const rsv = card?.reservations
  const tags = card?.tags ?? []
  const title = card?.name || guest.name || formatPhone(card?.phone || guest.phone)

  return (
    <Drawer
      labelledBy="guest-card-title"
      title={title}
      subtitle={card?.phone ? formatPhone(card.phone) : null}
      onClose={onClose}
      actions={pane === 'view' && card && (
        <Button onClick={() => setPane('edit')}>
          <Pencil aria-hidden /> Edit
        </Button>
      )}
    >
      <>
          {pane === 'edit' ? (
            <ProfileEditor
              guest={guest}
              card={card}
              onCancel={() => setPane('view')}
              onSaved={() => { setPane('view'); load(); onChanged() }}
            />
          ) : pane === 'erase' ? (
            <ErasePanel
              guest={{ ...guest, phone: card?.phone ?? guest.phone }}
              onCancel={() => setPane('view')}
              onDone={() => { onChanged(); onClose() }}
            />
          ) : (
            <>
              <div className="guest-stats">
                <div><span>{mode === 'stamps' ? 'Stamps' : 'Points'}</span>
                  <strong>{mode === 'stamps' ? guest.stamps : formatMoney(guest.points)}</strong></div>
                <div><span>Visits</span><strong>{guest.visits}</strong></div>
                <div><span>Total spent</span><strong>{formatMoney(guest.total_spent)}</strong></div>
                <div><span>Last visit</span><strong>{lastVisitLabel(guest.last_visit_at)}</strong></div>
              </div>

              {rsv && rsv.total > 0 && (
                <div className="guest-favs">
                  <span className="guest-section-label">Bookings</span>
                  <div className="guest-fav-list">
                    <span className="guest-fav">{rsv.visits} visits</span>
                    {rsv.upcoming > 0 && <span className="guest-fav">{rsv.upcoming} upcoming</span>}
                    {rsv.no_shows > 0 && (
                      <span className="guest-fav is-warn">{rsv.no_shows} no-show</span>
                    )}
                    {rsv.cancelled > 0 && <span className="guest-fav">{rsv.cancelled} cancelled</span>}
                    {rsv.zone && <span className="guest-fav">{rsv.zone}</span>}
                    {rsv.avg_party && <span className="guest-fav">~{rsv.avg_party} guests</span>}
                  </div>
                </div>
              )}

              {tags.length > 0 && (
                <div className="guest-favs">
                  <span className="guest-section-label">Tags</span>
                  <div className="guest-fav-list">
                    {tags.map((tag) => <span className="guest-fav" key={tag}>{tag}</span>)}
                  </div>
                </div>
              )}

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

              <Tabs
                className="guest-tabs"
                label="Guest history"
                items={[
                  { key: 'orders', label: 'Orders' },
                  { key: 'events', label: 'Loyalty log' },
                ]}
                value={tab}
                onChange={setTab}
              />

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

              {/* Приватность внизу карточки: это последнее, что делают с
                  клиентом, и оно не должно стоять рядом с «Edit». */}
              <div className="guest-privacy">
                <span className="guest-section-label">Privacy</span>
                <button
                  type="button"
                  className="text-button is-danger"
                  onClick={() => setPane('erase')}
                >
                  <ShieldOff aria-hidden /> Erase personal data
                </button>
              </div>
            </>
          )}
      </>
    </Drawer>
  )
}

/**
 * Дубли. Кабинет только подсказывает: «Дана Леви» бывает и двумя разными
 * людьми, поэтому владелец сам выбирает, какой профиль останется.
 */
function DuplicateGroup({ group, busy, onMerge }) {
  const [targetId, setTargetId] = useState(group.guests?.[0]?.id ?? null)
  // Слияние необратимо: спрашиваем ещё раз и называем обе стороны
  const [asking, setAsking] = useState(false)
  const target = (group.guests ?? []).find((g) => g.id === targetId)
  const sources = mergeSources(group, targetId)
  const targetName = target ? (target.name || formatPhone(target.phone)) : ''

  return (
    <div className="dup-group">
      <p className="dup-reason">{duplicateReason(group)}</p>
      <div className="dup-options" role="radiogroup" aria-label="Profile to keep">
        {(group.guests ?? []).map((g) => {
          const label = g.name || formatPhone(g.phone)
          return (
            <button
              type="button"
              role="radio"
              aria-checked={g.id === targetId}
              className={`dup-option${g.id === targetId ? ' is-selected' : ''}`}
              key={g.id}
              onClick={() => setTargetId(g.id)}
            >
              <strong>{label}</strong>
              <small>{formatPhone(g.phone)}</small>
              <span>
                {g.visits} visit{g.visits === 1 ? '' : 's'} · {formatMoney(g.total_spent)}
                {' · '}{lastVisitLabel(g.last_visit_at)}
              </span>
            </button>
          )
        })}
      </div>
      <p className="dup-preview">
        {sources.length === 1
          ? mergePreview(target, sources[0])
          : `Everything from ${sources.length} profiles moves to ${targetName}. The old numbers keep working — they will lead to this profile.`}
      </p>
      <Button
        variant="primary"
        size="compact"
        disabled={busy || !target || sources.length === 0}
        onClick={() => setAsking(true)}
      >
        {busy ? 'Merging…' : `Merge into ${targetName}`}
      </Button>

      {/*
        Последний шаг именует обе стороны: что останется и что исчезнет.
        Слияние не удаляет исходный профиль (он становится указателем), но
        из списков он уходит навсегда, и вернуть его кнопкой нельзя.
      */}
      {asking && (
        <ConfirmDialog
          title={`Merge into ${targetName}?`}
          description={mergeConfirmText(target, sources)}
          confirmLabel="Merge profiles"
          cancelLabel="Keep them separate"
          tone="danger"
          busy={busy}
          onCancel={() => setAsking(false)}
          onConfirm={() => { setAsking(false); onMerge(targetId, sources.map((g) => g.id)) }}
        />
      )}
    </div>
  )
}

export default function GuestsManager({ context, tab: tabFromUrl, onTabChange }) {
  const [guests, setGuests] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [segment, setSegment] = useState('all')
  const [tags, setTags] = useState([])
  const [sort, setSort] = useState('recent')
  const [tagCounts, setTagCounts] = useState([])
  const [duplicates, setDuplicates] = useState([])
  // Экран дублей — тоже адресуемое состояние: ссылку на него шлют в
  // поддержку, и перезагрузка не должна возвращать в общий список.
  const view = tabFromUrl === 'duplicates' ? 'duplicates' : 'list'
  const setView = (next) => onTabChange?.(next === 'list' ? null : next)
  const [merging, setMerging] = useState(null)
  const [selected, setSelected] = useState(null)

  // Поиск идёт на сервер — не дёргаем его на каждую букву
  useEffect(() => {
    const id = setTimeout(() => setQuery(search), 300)
    return () => clearTimeout(id)
  }, [search])

  const filters = useMemo(
    () => ({ search: query, segment, tags, sort }),
    [query, segment, tags, sort],
  )

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    try {
      setGuests(await fetchGuests(filters))
    } catch (e) {
      setError(customerErrorText(e.message))
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => { load() }, [load])

  // Метки и дубли считаются по всей базе, а не по срезу: они и нужны,
  // чтобы срез выбрать.
  const loadAside = useCallback(async () => {
    try {
      const [t, d] = await Promise.all([fetchGuestTags(), fetchDuplicates()])
      setTagCounts(t)
      setDuplicates(d)
    } catch {
      // Подсказки не должны ронять список: он полезен и без них
    }
  }, [])

  useEffect(() => { loadAside() }, [loadAside])

  // Режим программы (штампы/баллы) знает только сервер — контекст
  // бэкофиса его не отдаёт. Берём из первой открытой карточки (115) и
  // запоминаем; до этого список показывает и штампы, и баллы.
  const [mode, setMode] = useState(null)

  const total = guests?.length ?? 0
  const timeZone = context.locations?.[0]?.timezone || 'Asia/Jerusalem'

  function exportCsv() {
    const csv = guestsToCsv(guests ?? [], { timeZone })
    // BOM: без него Excel открывает ивритские имена как мусор
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = csvFileName()
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function runMerge(targetId, sourceIds) {
    setMerging(targetId)
    setError('')
    try {
      // По одному: слияние атомарно на паре, и частичный успех честнее
      // молчаливого «что-то не переехало».
      for (const sourceId of sourceIds) await mergeGuests(targetId, sourceId)
      await Promise.all([load(true), loadAside()])
    } catch (e) {
      setError(customerErrorText(e.message))
      await loadAside()
    } finally {
      setMerging(null)
    }
  }

  const filtered = segment !== 'all' || tags.length > 0 || query.trim() !== ''

  return (
    <>
      <PageHeader
        eyebrow={context.organization?.name}
        title="Customers"
        description="Loyalty members, their visits and what they buy."
      />

      <div className="overview-toolbar">
        <label className="guest-search">
          <Search aria-hidden />
          <span className="visually-hidden">Search customers</span>
          <input
            type="search"
            placeholder="Name or phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>

        <label className="guest-sort">
          <span className="visually-hidden">Sort customers</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>

        {/* Пока экран дублей открыт, кнопка остаётся: после слияния
            последней пары список подсказок пустеет, и без неё владелец
            оставался на экране без выхода. */}
        {(duplicates.length > 0 || view === 'duplicates') && (
          <button
            type="button"
            className={view === 'duplicates' ? 'primary-button compact' : 'secondary-button'}
            aria-pressed={view === 'duplicates'}
            onClick={() => setView(view === 'duplicates' ? 'list' : 'duplicates')}
          >
            <GitMerge aria-hidden />
            {view === 'duplicates' ? 'Back to list' : `Possible duplicates (${duplicates.length})`}
          </button>
        )}

        <button
          type="button"
          className="secondary-button"
          disabled={!total}
          onClick={exportCsv}
          title="Download the customers you are looking at right now"
        >
          <Download aria-hidden /> Export CSV
        </button>

        <button
          className="icon-button"
          onClick={() => { load(); loadAside() }}
          aria-label="Refresh customers"
          disabled={loading}
        ><RefreshCw /></button>
      </div>

      {view === 'list' && (
        <div className="segment-bar" role="radiogroup" aria-label="Customer segment">
          {SEGMENTS.map((s) => (
            <button
              type="button"
              role="radio"
              aria-checked={segment === s.key}
              className={`segment-chip${segment === s.key ? ' is-selected' : ''}`}
              key={s.key}
              title={s.hint || undefined}
              onClick={() => setSegment(s.key)}
            >
              {s.label}
            </button>
          ))}
          {tagCounts.map((t) => (
            <button
              type="button"
              className={`segment-chip is-tag${tags.includes(t.tag) ? ' is-selected' : ''}`}
              aria-pressed={tags.includes(t.tag)}
              key={t.tag}
              onClick={() => setTags((prev) => (
                prev.includes(t.tag) ? prev.filter((x) => x !== t.tag) : [...prev, t.tag]
              ))}
            >
              {t.tag} <small>{t.guests}</small>
            </button>
          ))}
        </div>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      {view === 'duplicates' ? (
        duplicates.length === 0 ? (
          <section className="section-placeholder panel">
            <span className="section-icon"><GitMerge /></span>
            <div>
              <h2>No duplicates left</h2>
              <p>Every profile here looks like a different person.</p>
              <button
                type="button"
                className="primary-button compact"
                onClick={() => setView('list')}
              >
                Back to customers
              </button>
            </div>
          </section>
        ) : (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>{duplicates.length} possible duplicate{duplicates.length === 1 ? '' : 's'}</h2>
                <p>
                  The same person can have two profiles — one number written two
                  ways, or a second phone. Choose which profile to keep.
                </p>
              </div>
            </div>
            <div className="dup-list">
              {duplicates.map((group) => (
                <DuplicateGroup
                  key={`${group.reason}:${group.key}`}
                  group={group}
                  busy={merging !== null}
                  onMerge={runMerge}
                />
              ))}
            </div>
          </section>
        )
      ) : loading && !guests ? (
        <p className="empty-state">Loading…</p>
      ) : total === 0 ? (
        <section className="section-placeholder panel">
          <span className="section-icon"><Users /></span>
          <div>
            <h2>{filtered ? 'Nothing found' : 'No customers yet'}</h2>
            <p>
              {filtered
                ? 'No customer matches this segment. Try another one or clear the search.'
                : 'Members appear here once the loyalty programme is switched on and guests start paying at the till.'}
            </p>
          </div>
        </section>
      ) : (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>{total} customer{total === 1 ? '' : 's'}</h2>
              <p>{segmentSummary({ segment, tags, search: query })}</p>
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
          onChanged={() => { load(true); loadAside() }}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  )
}
