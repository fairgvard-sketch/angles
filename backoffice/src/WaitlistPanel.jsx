import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Plus } from 'lucide-react'
import {
  addWaitlistEntry, fetchWaitlistQueue, reorderWaitlist,
  seatWaitlistEntry, setWaitlistStatus, offerWaitlistSlot,
} from './reservations'
import {
  formatWait, groupQueue, isOpen, isOverdue, isQueued, moveInQueue, queueErrorText,
  sortQueue, statusClass, statusLabel, waitedMin,
} from './waitlist'
import { supabase } from './supabase'
import Drawer from './ui/Drawer'
import ConfirmDialog from './ui/ConfirmDialog'
import PartyCount from './ui/PartyCount'
import { Button } from './ui/Button'
import { coarsePointer } from './ui/focus-entry'

/**
 * Очередь ожидания у стойки (Kassa 122/137).
 *
 * Панель показывала два списка карточек: «кто подходит на слот» и
 * «ждущие». Ни того, сколько человек уже ждёт, ни кого звать следующим,
 * ни что ему пообещали — а это и есть работа хостес в час пик. Записать
 * подошедшего гостя было нельзя вовсе: заявки приходили только с
 * публичной страницы.
 *
 * Теперь это очередь: позиция, живое время ожидания, обещанное время и
 * посадка в один тап. Занятость столов по-прежнему решает сервер.
 */

/** Часы тикают тут, а не в каждой строке: одна перерисовка в минуту */
function useMinuteTick() {
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  return nowMs
}

export default function WaitlistPanel({ locationId, date, query = '', tables = [] }) {
  const nowMs = useMinuteTick()
  const [entries, setEntries] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null)
  const [detail, setDetail] = useState(null)
  const [sheetError, setSheetError] = useState('')
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState(null)

  const requestRef = useRef(0)

  const load = useCallback(async () => {
    if (!locationId || !date) return
    const ticket = requestRef.current + 1
    requestRef.current = ticket
    try {
      // Столы приходят из общей модели раздела (152) — третий запрос за
      // тем же списком очередь больше не делает.
      const queue = await fetchWaitlistQueue(locationId, date)
      if (requestRef.current !== ticket) return
      setEntries(queue)
      setError('')
    } catch (e) {
      if (requestRef.current !== ticket) return
      setError(queueErrorText(e.message))
    }
  }, [locationId, date])

  useEffect(() => {
    setEntries(null)
    load()
    const channel = supabase
      .channel(`waitlist-${locationId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'waitlist_entries', filter: `location_id=eq.${locationId}` },
        () => load())
      .subscribe()
    const timer = setInterval(load, 30_000)
    return () => {
      supabase.removeChannel(channel)
      clearInterval(timer)
    }
  }, [locationId, load])

  const needle = query.trim().toLowerCase()
  const visible = useMemo(() => (entries ?? []).filter((e) => (
    !needle || `${e.customer_name ?? ''} ${e.customer_phone ?? ''}`.toLowerCase().includes(needle)
  )), [entries, needle])

  const groups = useMemo(() => groupQueue(visible), [visible])
  const openRows = useMemo(() => sortQueue(visible).filter(isQueued), [visible])
  // Номер — место среди тех, кого ещё зовут. Уведомлённого уже позвали,
  // и держать ему номер значит показывать очередь, в которой первый
  // никого не ждёт.
  const positionOf = useMemo(() => {
    const map = new Map()
    openRows.forEach((entry, index) => map.set(entry.id, index + 1))
    return map
  }, [openRows])

  async function act(id, fn) {
    setBusy(id)
    setSheetError('')
    try {
      await fn()
      await load()
      setError('')
      return true
    } catch (e) {
      const text = queueErrorText(e.message)
      if (detail?.id === id) setSheetError(text)
      else setError(text)
      return false
    } finally {
      setBusy(null)
    }
  }

  async function move(entry, direction) {
    const order = moveInQueue(visible, entry.id, direction)
    if (!order) return
    await act(entry.id, () => reorderWaitlist(locationId, order))
  }

  const seat = (entry) => act(entry.id, async () => {
    await seatWaitlistEntry(locationId, entry.id)
    setDetail(null)
  })

  return (
    <section className="panel form-panel rsv-list-panel">
      <div className="rsv-list-toolbar">
        <button
          type="button"
          className="primary-button compact"
          disabled={!locationId}
          onClick={() => setAdding(true)}
        >
          <Plus /> Add to waitlist
        </button>
        <span className="rsv-queue-count">
          {openRows.length === 0
            ? 'Nobody is waiting'
            : `${openRows.length} waiting`}
        </span>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {entries === null ? (
        /* Скелет держит геометрию таблицы: строка «Loading…» схлопывала
           панель и через секунду возвращала её обратно, утаскивая
           кнопки из-под пальца. */
        <div className="rsv-table-scroll rsv-list-skeleton">
          <div role="status" aria-live="polite" className="visually-hidden">Loading the queue…</div>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="rsv-skeleton-row" aria-hidden>
              <span style={{ width: '5%' }} />
              <span style={{ width: '26%' }} />
              <span style={{ width: '8%' }} />
              <span style={{ width: '12%' }} />
              <span style={{ width: '14%' }} />
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <p className="empty-state">
          {needle
            ? `Nobody in today’s queue matches “${query.trim()}”.`
            : 'Nobody is waiting. Guests you add here appear as a queue with live wait times.'}
        </p>
      ) : (
        <div className="rsv-table-scroll">
          <table className="rsv-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Guest</th>
                <th scope="col">Party</th>
                <th scope="col">Waiting</th>
                <th scope="col" className="rsv-col-source">Quoted</th>
                <th scope="col">Status</th>
                <th scope="col" className="rsv-col-note">Order</th>
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody key={group.key}>
                <tr className="rsv-day-row">
                  <th scope="colgroup" colSpan={7}>{group.label}</th>
                </tr>
                {group.rows.map((entry) => {
                  const waited = waitedMin(entry, nowMs)
                  const overdue = isOverdue(entry, nowMs)
                  const place = positionOf.get(entry.id)
                  /*
                   * Строка НЕ интерактивна.
                   *
                   * Раньше она была `role="button"` с tabIndex, а внутри
                   * стояли кнопки перестановки — вложенные интерактивные
                   * элементы. Enter на стрелке всплывал до строки, и вместо
                   * перестановки открывалась карточка гостя: двигать
                   * очередь с клавиатуры было нельзя вообще.
                   * Карточку открывает отдельная кнопка на имени.
                   */
                  return (
                    <tr
                      key={entry.id}
                      className={`rsv-row${detail?.id === entry.id ? ' is-selected' : ''}`}
                    >
                      <td className="rsv-cell-time">{place ?? '—'}</td>
                      <td className="rsv-cell-guest">
                        <button
                          type="button"
                          className="rsv-open"
                          aria-pressed={detail?.id === entry.id}
                          onClick={() => { setDetail(entry); setSheetError('') }}
                        >
                          <strong>{entry.customer_name}</strong>
                          {entry.customer_phone && <small>{entry.customer_phone}</small>}
                        </button>
                      </td>
                      <td className="rsv-cell-party"><PartyCount n={entry.party_size} /></td>
                      <td className={`rsv-cell-wait${overdue ? ' is-overdue' : ''}`}>
                        {formatWait(waited)}
                        {/* Перебор обещанного — то место, где очередь
                            превращается в скандал. Хостес должен увидеть
                            это раньше гостя. */}
                        {overdue && <span className="rsv-overdue-mark"> over</span>}
                      </td>
                      <td className="rsv-col-source">
                        {entry.quoted_min == null ? '—' : formatWait(entry.quoted_min)}
                      </td>
                      <td>
                        <span className={`rsv-status ${statusClass(entry.status)}`}>
                          {statusLabel(entry.status)}
                        </span>
                      </td>
                      <td className="rsv-col-note">
                        {/* Перетаскивание мышью — не единственный способ:
                            с клавиатуры и с телефона его нет вовсе. */}
                        {isQueued(entry) && (
                          <span className="rsv-queue-move">
                            <button
                              type="button"
                              className="icon-button"
                              aria-label={`Move ${entry.customer_name} up`}
                              disabled={busy != null || place === 1}
                              onClick={() => move(entry, 'up')}
                            >
                              <ChevronUp />
                            </button>
                            <button
                              type="button"
                              className="icon-button"
                              aria-label={`Move ${entry.customer_name} down`}
                              disabled={busy != null || place === openRows.length}
                              onClick={() => move(entry, 'down')}
                            >
                              <ChevronDown />
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            ))}
          </table>
        </div>
      )}

      {adding && (
        <AddToWaitlist
          locationId={locationId}
          busy={busy === 'new'}
          onClose={() => setAdding(false)}
          onSubmit={async (form) => {
            const ok = await act('new', () => addWaitlistEntry(locationId, form))
            if (ok) setAdding(false)
          }}
        />
      )}

      {detail && (
        <QueueSheet
          entry={detail}
          nowMs={nowMs}
          tables={tables}
          busy={busy === detail.id}
          error={sheetError}
          onClose={() => { setDetail(null); setSheetError('') }}
          onSeat={() => seat(detail)}
          onNotify={() => act(detail.id, () => offerWaitlistSlot(
            detail.id,
            new Date(Date.now() + (detail.quoted_min ?? 15) * 60_000).toISOString(),
            30,
          ))}
          onRemove={() => setRemoving(detail)}
          onReturn={() => act(detail.id, async () => {
            await setWaitlistStatus(locationId, detail.id, 'waiting')
            setDetail(null)
          })}
        />
      )}

      {removing && (
        <ConfirmDialog
          title="Remove from the waitlist?"
          description={`${removing.customer_name} · ${removing.party_size} guests · waited ${
            formatWait(waitedMin(removing, nowMs))}. The entry stays in today’s history.`}
          confirmLabel="Remove from queue"
          cancelLabel="Keep waiting"
          tone="danger"
          busy={busy === removing.id}
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            const target = removing
            setRemoving(null)
            await act(target.id, async () => {
              await setWaitlistStatus(locationId, target.id, 'cancelled')
              setDetail(null)
            })
          }}
        />
      )}
    </section>
  )
}

/** Запись подошедшего гостя: имя, компания и что ему пообещали */
function AddToWaitlist({ locationId, busy, onClose, onSubmit }) {
  const firstRef = useRef(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [party, setParty] = useState(2)
  const [quoted, setQuoted] = useState(20)
  const [note, setNote] = useState('')
  const [nameError, setNameError] = useState('')
  /*
   * UUID создаётся ДО первой попытки и переиспользуется при повторе:
   * таймаут сети не должен превратить одного гостя в двух человек в
   * очереди (инвариант идемпотентности).
   */
  const clientUuid = useRef(crypto.randomUUID())

  // Пальцем клавиатура не выезжает вместе с формой — фокус держит панель
  useEffect(() => { if (!coarsePointer()) firstRef.current?.focus() }, [])

  return (
    <Drawer
      labelledBy="waitlist-add-title"
      title="Add to waitlist"
      subtitle="A guest is at the door and there is no free table yet."
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            size="compact"
            type="submit"
            form="waitlist-form"
            busy={busy}
            busyLabel="Adding…"
          >
            Add to queue
          </Button>
        </>
      )}
    >
      <form
        id="waitlist-form"
        className="drawer-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!name.trim()) {
            setNameError('Enter the guest name.')
            firstRef.current?.focus()
            return
          }
          onSubmit({
            clientUuid: clientUuid.current,
            name: name.trim(),
            phone: phone.trim(),
            partySize: Number(party) || 2,
            quotedMin: quoted === '' ? null : Number(quoted),
            note: note.trim() || null,
          })
        }}
      >
        <div className="qr-grid">
          <label className="qr-field">
            <span>Guest name</span>
            <input
              ref={firstRef}
              value={name}
              maxLength={60}
              aria-invalid={nameError ? 'true' : undefined}
              onChange={(e) => { setName(e.target.value); setNameError('') }}
              required
            />
            {nameError && <span className="field-error">{nameError}</span>}
          </label>
          <label className="qr-field">
            <span>Phone</span>
            <input type="tel" value={phone} maxLength={20} placeholder="Optional"
              onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label className="qr-field">
            <span>Guests</span>
            <input type="number" min={1} max={50} value={party}
              onChange={(e) => setParty(e.target.value)} />
          </label>
          <label className="qr-field">
            <span>Quoted wait, minutes</span>
            <input type="number" min={0} max={600} step={5} value={quoted}
              onChange={(e) => setQuoted(e.target.value)} />
          </label>
        </div>
        <label className="qr-field">
          <span>Note</span>
          <input value={note} maxLength={200} placeholder="By the window, high chair…"
            onChange={(e) => setNote(e.target.value)} />
        </label>
        {/* Обещание записывается, а не остаётся в памяти двоих: через
            полчаса «мы говорили двадцать минут» превращается в спор. */}
        <p className="form-hint">
          The quoted wait is stored with the entry, so the queue can show who
          has been waiting longer than promised.
        </p>
      </form>
    </Drawer>
  )
}

/** Карточка записи: сколько ждёт, что обещали и что с ней делать */
function QueueSheet({
  entry, nowMs, tables, busy, error, onClose, onSeat, onNotify, onRemove, onReturn,
}) {
  const waited = waitedMin(entry, nowMs)
  const overdue = isOverdue(entry, nowMs)
  const zoneNames = (entry.zone_ids ?? [])
    .map((id) => tables.find((t) => t.zoneId === id)?.zoneName)
    .filter(Boolean)

  return (
    <Drawer
      labelledBy="waitlist-sheet-title"
      title={entry.customer_name}
      subtitle={(
        <>
          <PartyCount n={entry.party_size} /> · waiting {formatWait(waited)}
          {entry.quoted_min != null ? ` of ${formatWait(entry.quoted_min)} quoted` : ''}
        </>
      )}
      onClose={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <dl className="sheet-facts">
        <div>
          <dt>Status</dt>
          <dd>
            <span className={`rsv-status ${statusClass(entry.status)}`}>
              {statusLabel(entry.status)}
            </span>
          </dd>
        </div>
        <div>
          <dt>Waiting</dt>
          <dd className={overdue ? 'is-overdue' : undefined}>
            {formatWait(waited)}
            {overdue && ' — longer than quoted'}
          </dd>
        </div>
        {entry.customer_phone && (
          <div>
            <dt>Phone</dt>
            <dd><a href={`tel:${entry.customer_phone}`}>{entry.customer_phone}</a></dd>
          </div>
        )}
        {zoneNames.length > 0 && (
          <div>
            <dt>Prefers</dt>
            <dd>{zoneNames.join(', ')}</dd>
          </div>
        )}
      </dl>

      {entry.note && <p className="order-note">{entry.note}</p>}

      {entry.status === 'offered' && entry.offer_expires && (
        <p className="form-hint">
          Offer sent for {new Date(entry.offer_at).toLocaleTimeString([], {
            hour: '2-digit', minute: '2-digit',
          })}, expires {new Date(entry.offer_expires).toLocaleTimeString([], {
            hour: '2-digit', minute: '2-digit',
          })}. The table is not held until the guest agrees.
        </p>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      {isOpen(entry) ? (
        <div className="order-actions">
          {/* Посадка — главное действие: сервер сам подберёт стол тем же
              алгоритмом, что и для обычной брони. */}
          <button type="button" className="primary-button compact" disabled={busy} onClick={onSeat}>
            {busy ? 'Seating…' : 'Seat guest'}
          </button>
          {entry.status === 'waiting' && (
            <button type="button" className="secondary-button" disabled={busy} onClick={onNotify}>
              Mark notified
            </button>
          )}
          <button type="button" className="secondary-button" data-danger disabled={busy} onClick={onRemove}>
            Guest left
          </button>
        </div>
      ) : entry.status === 'cancelled' ? (
        <div className="order-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={onReturn}>
            Return to queue
          </button>
        </div>
      ) : (
        <p className="form-hint">
          This entry is closed. Seated guests live on as a visit on the timeline.
        </p>
      )}
    </Drawer>
  )
}
