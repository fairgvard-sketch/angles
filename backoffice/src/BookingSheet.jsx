import { useMemo, useState } from 'react'
import { blockState } from './timeline'
import { statusClass, statusLabel, visitActions } from './reservation-status'
import { conflictAlternatives } from './desk-availability'
import { toLocalInput, fromLocalInput } from './reservations'
import Drawer from './ui/Drawer'
import ConfirmDialog from './ui/ConfirmDialog'
import { Button } from './ui/Button'

/**
 * Панель визита — одна на весь раздел.
 *
 * Жила внутри таймлайна, и это годилось ровно до появления списка:
 * второй экран, открывающий ту же бронь, обязан показывать те же
 * сведения, те же действия и вести себя так же (Escape, фокус,
 * сохранённая позиция под панелью). Две панели с одинаковым смыслом
 * разъезжаются через месяц, а не через год.
 */

/** Время визита в зоне точки */
function timeInZone(ms, tz) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(ms))
  } catch {
    return ''
  }
}

export default function BookingSheet({
  reservation, tables, tz, busy, error, conflict = false, bookings = [], clashes = [],
  onClose, onAction, onTables, onEdit, onClearError,
}) {
  const linked = (reservation.tables_link ?? []).map((l) => l.table_id)
  const initial = linked.length > 0
    ? linked
    : [reservation.table_id, ...(reservation.hold_table_ids ?? [])].filter(Boolean)
  const [picked, setPicked] = useState(initial)
  const posSeated = reservation.order_id != null
  const active = reservation.status === 'new' || reservation.status === 'confirmed'

  const actions = visitActions(reservation)
  /*
   * Отмена и отказ спрашивают причину — её увидит гость.
   *
   * Раньше с полотна отменить визит было нельзя вовсе: карточка
   * предлагала «Completed / No-show», а за отменой хостес уходил в
   * список. Диалог здесь тот же, что в списке, — с Escape, фокусом и
   * необязательной причиной, а не `window.confirm`.
   */
  const [asking, setAsking] = useState(null)

  // Правка визита открывается по кнопке: обычно карточку открывают,
  // чтобы посадить гостя, а не переписать его данные.
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(() => ({
    name: reservation.customer_name ?? '',
    phone: reservation.customer_phone ?? '',
    party: reservation.party_size ?? 2,
    at: toLocalInput(new Date(reservation.reserved_at).getTime(), tz),
    note: reservation.note ?? '',
  }))

  const changed = picked.length !== initial.length
    || picked.some((id, i) => id !== initial[i])

  /*
   * Отказ по занятости — единственный, к которому есть что добавить: что
   * свободно в это время и когда освободится. Считается из тех же
   * визитов, что уже на экране, и САМ визит из расчёта исключается —
   * иначе перенос на полчаса упирался бы в собственную бронь.
   *
   * Это подсказка, а не разрешение: занятость всё равно перепроверит
   * сервер при сохранении.
   */
  const alternatives = useMemo(() => {
    if (!conflict) return null
    const wantedMs = fromLocalInput(form.at, tz)
    return conflictAlternatives({
      tables,
      bookings,
      wantedMs: wantedMs ? new Date(wantedMs).getTime() : NaN,
      partySize: Number(form.party) || reservation.party_size || 1,
      ignoreId: reservation.id,
    })
  }, [conflict, form.at, form.party, tz, tables, bookings, reservation.id, reservation.party_size])

  const hhmm = (ms) => new Date(ms).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: tz,
  })

  function saveEdit() {
    const at = fromLocalInput(form.at, tz)
    onEdit({
      name: form.name.trim() !== reservation.customer_name ? form.name.trim() : null,
      phone: form.phone.trim() !== (reservation.customer_phone ?? '') ? form.phone.trim() : null,
      partySize: Number(form.party) !== reservation.party_size ? Number(form.party) : null,
      at: at && at !== new Date(reservation.reserved_at).toISOString() ? at : null,
      note: form.note.trim() !== (reservation.note ?? '') ? form.note.trim() : null,
    })
  }

  const startMs = new Date(reservation.reserved_at).getTime()
  const when = new Date(reservation.reserved_at).toLocaleDateString([], {
    weekday: 'short', day: 'numeric', month: 'short',
  })
  const span = `${timeInZone(startMs, tz)}–${timeInZone(startMs + (reservation.duration_min || 90) * 60_000, tz)}`
  const state = blockState(reservation.status, reservation.arrived_at, reservation.order_id)

  // Стол и зона словами: «стол 4 · Pergola» отвечает на вопрос «куда
  // идти», а список id в пикере — нет.
  const seatedAt = initial
    .map((id) => tables.find((t) => t.id === id))
    .filter(Boolean)
  const zoneName = seatedAt.find((t) => t.zoneName)?.zoneName ?? null

  /*
   * Две разные вещи, которые легко перепутать:
   *   `created_via` — кто завёл визит (гость, касса, кабинет, лист);
   *   `source`      — по какому каналу гость пришёл (instagram, qr…).
   *
   * Показываем то, что действительно записано. У броней до миграции 136
   * пути нет, и выдумывать его нельзя: «Added in the back office» на
   * чужой броне отправит хостес искать несуществующий звонок.
   */
  const VIA_LABEL = {
    public: 'Booked by the guest online',
    pos: 'Added on the register',
    backoffice: 'Added in the back office',
    waitlist: 'Accepted a waitlist offer',
  }
  const sourceLabel = VIA_LABEL[reservation.created_via] ?? null
  const channel = reservation.source || null

  return (
    <Drawer
      labelledBy="booking-sheet-title"
      title={(
        <>
          {reservation.customer_name}
          {/* Тестовая бронь (126): стол она держит настоящий, поэтому
              метка обязана быть видна там, где хостес принимает решение. */}
          {reservation.is_test && <span className="guest-fav is-warn"> Test</span>}
        </>
      )}
      subtitle={`${reservation.party_size} guests · ${when}, ${span}`}
      onClose={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
    >
        {/*
          Порядок сведений — рабочий: кто и сколько человек, когда, за
          каким столом, в каком состоянии, как позвонить, что просили.
          Служебное (откуда бронь и когда заведена) уходит вниз: оно
          нужно, когда с визитом что-то не так, а не каждый раз.
        */}
        <dl className="sheet-facts">
          <div>
            <dt>Table</dt>
            <dd>
              {seatedAt.length > 0
                ? seatedAt.map((t) => t.label).join(' + ')
                : 'Not assigned yet'}
              {zoneName && <span className="sheet-fact-muted"> · {zoneName}</span>}
            </dd>
          </div>
          <div>
            <dt>Status</dt>
            {/* Состояние — тем же цветом и словом, что и на полотне */}
            <dd><span className={`rsv-status ${statusClass(state)}`}>{statusLabel(state)}</span></dd>
          </div>
          {reservation.customer_phone && (
            <div>
              <dt>Phone</dt>
              <dd><a href={`tel:${reservation.customer_phone}`}>{reservation.customer_phone}</a></dd>
            </div>
          )}
        </dl>

        {reservation.note && <p className="order-note">{reservation.note}</p>}

        {/*
          Конфликт назван по имени: красной рамки на полотне мало, чтобы
          понять, кого именно придётся двигать.
        */}
        {clashes.length > 0 && (
          <div className="sheet-clash" role="note">
            <strong>Overlaps another booking</strong>
            <ul>
              {clashes.map(({ booking, table }) => (
                <li key={booking.id}>
                  {timeInZone(booking.startMs, tz)}–{timeInZone(booking.endMs, tz)}
                  {' · '}{booking.guestName}
                  {' · table '}{table.label}
                </li>
              ))}
            </ul>
            <span>Move one of the visits or give it another table.</span>
          </div>
        )}

        {posSeated && (
          <p className="form-hint">
            Seated into a POS order — this visit is handled on the register.
          </p>
        )}

        {/* Отказ сервера — здесь, рядом с кнопкой, которую нажали, а не
            в полотне под открытой панелью. */}
        {error && <p className="form-error" role="alert">{error}</p>}

        {active && !posSeated && !editing && (
          <button type="button" className="secondary-button" onClick={() => setEditing(true)}>
            Edit booking
          </button>
        )}

        {active && !posSeated && editing && (
          <div className="sheet-section">
            <span className="sheet-section-title">Edit booking</span>
            <div className="qr-grid">
              <label className="qr-field">
                <span>Guest name</span>
                <input value={form.name} maxLength={120}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </label>
              <label className="qr-field">
                <span>Phone</span>
                <input type="tel" value={form.phone} maxLength={20}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </label>
              <label className="qr-field">
                <span>Guests</span>
                {/* Сообщение сервера живёт ровно до того, как хостес
                    изменил то, из-за чего оно появилось: «стол занят»
                    рядом с уже другим временем — ложь про текущую форму. */}
                <input type="number" min={1} max={50} value={form.party}
                  onChange={(e) => { setForm((f) => ({ ...f, party: e.target.value })); onClearError?.() }} />
              </label>
              <label className="qr-field">
                <span>Date and time</span>
                <input type="datetime-local" value={form.at}
                  onChange={(e) => { setForm((f) => ({ ...f, at: e.target.value })); onClearError?.() }} />
              </label>
            </div>
            <label className="qr-field">
              <span>Note</span>
              <input value={form.note} maxLength={200}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
            </label>
            {/* Время и компанию перепроверяет сервер: занятость решает он,
                иначе перенос тихо создал бы двойную посадку. */}
            <p className="form-hint">
              Moving the visit or growing the party is re-checked against the
              floor — a clash comes back as an error, not a double booking.
            </p>

            {/* Отказ по занятости — единственный, к которому есть что
                добавить: что свободно сейчас и когда освободится. */}
            {alternatives && (
              <div className="conflict-hint">
                {alternatives.tables.length > 0 && (
                  <>
                    <p className="form-hint">Free at this time — tap to move the visit:</p>
                    <div className="conflict-options">
                      {alternatives.tables.slice(0, 6).map((table) => (
                        <Button
                          key={table.id}
                          onClick={() => { setPicked([table.id]); onClearError?.() }}
                        >
                          {table.label} · {table.seats} seats
                        </Button>
                      ))}
                    </div>
                    <p className="form-hint">
                      Picking a table only changes the selection below — press
                      Save tables to apply it.
                    </p>
                  </>
                )}
                {alternatives.times.length > 0 && (
                  <>
                    <p className="form-hint">Nearest free times:</p>
                    <div className="conflict-options">
                      {alternatives.times.map((slot) => (
                        <Button
                          key={slot.at}
                          onClick={() => {
                            setForm((f) => ({ ...f, at: toLocalInput(slot.at, tz) }))
                            onClearError?.()
                          }}
                        >
                          {hhmm(slot.at)}
                        </Button>
                      ))}
                    </div>
                  </>
                )}
                {alternatives.tables.length === 0 && alternatives.times.length === 0 && (
                  <p className="form-hint">
                    Nothing is free nearby on this screen — try another day or
                    free a table first.
                  </p>
                )}
                <p className="form-hint">
                  Suggestions come from what this screen already knows; the
                  server checks availability again when you save.
                </p>
              </div>
            )}
            <div className="order-actions">
              <button type="button" className="secondary-button" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button type="button" className="primary-button compact" disabled={busy} onClick={saveEdit}>
                {busy ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        )}

        {active && !posSeated && (
          <>
            <div className="sheet-section">
              <span className="sheet-section-title">Tables</span>
              <div className="timeline-tablepick">
                {tables.filter((t) => !t.blocked).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={picked.includes(t.id) ? 'primary-button compact' : 'secondary-button compact'}
                    onClick={() => setPicked((cur) => (
                      cur.includes(t.id) ? cur.filter((x) => x !== t.id) : [...cur, t.id]
                    ))}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {picked.length > 1 && (
                <p className="form-hint">
                  {picked.length} tables combined — the first one is where the register seats the guest.
                </p>
              )}
              <button
                type="button"
                className="secondary-button"
                disabled={busy || !changed}
                onClick={() => onTables(picked)}
              >
                Save tables
              </button>
            </div>

            {/* Набор действий решает `visitActions`: экран не должен
                предлагать переход, который сервер всё равно отклонит. */}
            <div className="order-actions">
              {actions.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  className={action.tone === 'primary' ? 'primary-button compact' : 'secondary-button'}
                  data-danger={action.tone === 'danger' || undefined}
                  disabled={busy}
                  onClick={() => (action.confirm ? setAsking(action) : onAction(action.key))}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Служебное — внизу и тихо: нужно, когда с визитом что-то не
            так, а не при каждом открытии карточки. */}
        {asking && (
          <ConfirmDialog
            title={asking.key === 'rejected' ? 'Reject this booking?' : 'Cancel this booking?'}
            description={`${reservation.customer_name || 'Guest'} · ${when}, ${span} · ${
              reservation.party_size} guests. The table is freed immediately.`}
            confirmLabel={asking.key === 'rejected' ? 'Reject booking' : 'Cancel booking'}
            cancelLabel="Keep the booking"
            tone="danger"
            reason={{ label: 'Reason for the guest', placeholder: 'Fully booked, closed for a private event…' }}
            busy={busy}
            onCancel={() => setAsking(null)}
            onConfirm={(text) => { setAsking(null); onAction(asking.key, text) }}
          />
        )}

        {(sourceLabel || reservation.created_at) && (
          <p className="sheet-meta">
            {sourceLabel}
            {channel && `${sourceLabel ? ' · ' : ''}came from ${channel}`}
            {(sourceLabel || channel) && reservation.created_at && ' · '}
            {reservation.created_at && `booked ${new Date(reservation.created_at).toLocaleString([], {
              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
            })}`}
          </p>
        )}

    </Drawer>
  )
}
