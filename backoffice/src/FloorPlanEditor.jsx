import { useCallback, useEffect, useMemo, useState } from 'react'
import { Ban, Plus, Trash2, Users, X } from 'lucide-react'
import {
  fetchFloorPlan, createZone, renameZone, deleteZone,
  saveTable, deleteTable, setTableStatus, floorErrorText,
} from './floorplan'

/**
 * План зала (Kassa 123) — зоны и столы точки прямо в кабинете.
 *
 * Это последнее, что Reserve не умел без кассы: столов нет — таймлайн
 * хостес пуст, instant-режим никого не сажает, а гость видит «мест нет»
 * на пустой зал. Экран строится под первый час нового клиента: зона
 * заводится вместе с набором столов одной строкой, поимённая правка —
 * уже потом и по желанию.
 *
 * Столы без зоны показываются отдельной группой, а не прячутся: после
 * удаления зоны они остаются в зале, и владелец должен их видеть.
 */

const SEAT_CHOICES = [1, 2, 3, 4, 5, 6, 8, 10, 12]

/** Строка стола: имя, вместимость, признаки объединения и простоя. */
function TableRow({ table, onOpen }) {
  const off = table.status === 'disabled'
  return (
    <button
      className={`menu-row as-button floor-row ${off ? 'is-off' : ''}`}
      onClick={() => onOpen(table)}
    >
      <span className="floor-table-name">
        <strong>{table.label}</strong>
        <small>
          {off ? 'Out of service' : table.combinable ? 'Can be combined' : 'Single table'}
        </small>
      </span>
      <span className="floor-seats"><Users /> {table.seats}</span>
    </button>
  )
}

/** Карточка стола: правка, простой и снятие с плана. */
function TableEditor({ table, zones, locationId, onClose, onSaved }) {
  const isNew = !table.id
  const [label, setLabel] = useState(table.label || '')
  const [zoneId, setZoneId] = useState(table.zone_id || '')
  const [seats, setSeats] = useState(table.seats ?? 2)
  const [combinable, setCombinable] = useState(table.combinable ?? false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(action) {
    setBusy(true)
    setError('')
    try {
      await action()
      onSaved()
    } catch (e) {
      setError(floorErrorText(e.message))
      setBusy(false)
    }
  }

  const save = () => run(() => saveTable(locationId, {
    id: table.id,
    label,
    zoneId: zoneId || null,
    seats: Number(seats),
    combinable,
    sortOrder: table.sort_order ?? 0,
  }))

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="modal-head">
          <h2>{isNew ? 'New table' : 'Edit table'}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X /></button>
        </header>

        <div className="modal-body">
          <label><span>Name</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="12, Bar 3, Terrace A"
            />
          </label>

          <div className="field-row">
            <label><span>Seats</span>
              <select value={seats} onChange={(e) => setSeats(Number(e.target.value))}>
                {SEAT_CHOICES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label><span>Zone</span>
              <select value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                <option value="">No zone</option>
                {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </label>
          </div>

          <label className="check-field">
            <input
              type="checkbox"
              checked={combinable}
              onChange={(e) => setCombinable(e.target.checked)}
            />
            <span>Can be combined with a neighbouring table for a large party</span>
          </label>
          <p className="hint">
            Seats decide which bookings fit this table. Combinable tables are joined
            automatically when one table is too small.
          </p>

          {!isNew && (
            <button
              className="floor-service-toggle"
              disabled={busy}
              onClick={() => run(() => setTableStatus(
                locationId, table.id, table.status === 'disabled' ? 'free' : 'disabled',
              ))}
            >
              <span>
                <strong>
                  {table.status === 'disabled' ? 'Return to service' : 'Take out of service'}
                </strong>
                <small>
                  {table.status === 'disabled'
                    ? 'The table can be booked and seated again.'
                    : 'The table stays on the plan but takes no bookings.'}
                </small>
              </span>
              <Ban />
            </button>
          )}

          {error && <p className="form-error" role="alert">{error}</p>}
        </div>

        <footer className="modal-foot">
          {!isNew && (
            <button
              className="danger-button"
              disabled={busy}
              onClick={() => {
                if (!confirm(`Remove table "${table.label}" from the plan?`)) return
                run(() => deleteTable(locationId, table.id))
              }}
              aria-label="Remove table"
            >
              <Trash2 /><span className="btn-label">Remove</span>
            </button>
          )}
          <div className="modal-foot-right">
            <button className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="primary-button narrow" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

/** Заведение зоны сразу с набором столов — обычный старт нового зала. */
function AddZoneForm({ locationId, zoneCount, tableCount, onDone, onError }) {
  const [name, setName] = useState('')
  const [count, setCount] = useState(6)
  const [prefix, setPrefix] = useState('')
  const [seats, setSeats] = useState(2)
  const [busy, setBusy] = useState(false)

  async function add() {
    if (!name.trim() || busy) return
    setBusy(true)
    onError('')
    try {
      await createZone(locationId, name, zoneCount, {
        tableCount: Number(count),
        prefix,
        tableSortOrder: tableCount,
        seats: Number(seats),
      })
      setName('')
      setPrefix('')
      onDone()
    } catch (e) {
      onError(floorErrorText(e.message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="floor-add-zone">
      <div className="floor-add-copy">
        <strong>Add a zone</strong>
        <small>Create its first tables in the same step.</small>
      </div>
      <div className="inline-add">
        <input
          placeholder="Zone name (Main room, Terrace, Bar)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }}
        />
        <button className="icon-button" onClick={add} disabled={busy} aria-label="Add zone">
          <Plus />
        </button>
      </div>
      <div className="floor-add-options">
        <label><span>Tables</span>
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[0, 2, 4, 6, 8, 10, 12, 16, 20].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label><span>Seats each</span>
          <select value={seats} onChange={(e) => setSeats(Number(e.target.value))}>
            {SEAT_CHOICES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label><span>Name prefix</span>
          <input
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder="none"
          />
        </label>
      </div>
      <p className="form-hint">
        Tables are named {prefix || ''}1…{prefix || ''}{count || 'N'} and can be renamed
        one by one afterwards.
      </p>
    </div>
  )
}

export default function FloorPlanEditor({ locationId }) {
  const [plan, setPlan] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // стол или заготовка нового

  const reload = useCallback(async () => {
    if (!locationId) return
    try {
      setPlan(await fetchFloorPlan(locationId))
      setError('')
    } catch (e) {
      setError(floorErrorText(e.message))
    }
  }, [locationId])

  useEffect(() => { setPlan(null); reload() }, [reload])

  const zones = plan?.zones ?? []
  const tables = plan?.tables ?? []

  /** Зоны в порядке сортировки + «без зоны» последней, если она не пуста. */
  const groups = useMemo(() => {
    const byZone = new Map(zones.map((z) => [z.id, []]))
    const loose = []
    for (const t of tables) {
      const bucket = t.zone_id ? byZone.get(t.zone_id) : null
      if (bucket) bucket.push(t)
      else loose.push(t)
    }
    const list = zones.map((z) => ({ zone: z, tables: byZone.get(z.id) ?? [] }))
    if (loose.length > 0) list.push({ zone: null, tables: loose })
    return list
  }, [zones, tables])

  const seatTotal = tables.reduce((sum, t) => sum + (t.seats ?? 0), 0)

  async function rename(zone) {
    const next = window.prompt('Zone name', zone.name)
    if (next == null || !next.trim() || next.trim() === zone.name) return
    try { await renameZone(locationId, zone.id, next); await reload() }
    catch (e) { setError(floorErrorText(e.message)) }
  }

  async function removeZone(zone) {
    const inZone = tables.filter((t) => t.zone_id === zone.id).length
    const note = inZone > 0
      ? `\n\nIts ${inZone} table(s) stay in the room without a zone.`
      : ''
    if (!confirm(`Delete zone "${zone.name}"?${note}`)) return
    try { await deleteZone(locationId, zone.id); await reload() }
    catch (e) { setError(floorErrorText(e.message)) }
  }

  if (plan === null) return <p className="empty-state">Loading…</p>

  return (
    <>
      {error && <p className="form-error" role="alert">{error}</p>}

      <section className="panel form-panel floor-plan-panel">
        <div className="panel-heading">
          <div>
            <h2>Tables & zones</h2>
            <p>
              {tables.length === 0
                ? 'Add your rooms and tables — bookings need them to be seated.'
                : `${tables.length} tables · ${seatTotal} seats · ${zones.length} zones. Edit any table below.`}
            </p>
          </div>
        </div>
        <AddZoneForm
          locationId={locationId}
          zoneCount={zones.length}
          tableCount={tables.length}
          onDone={reload}
          onError={setError}
        />
      </section>

      {groups.length === 0 && (
        <p className="empty-state">No zones yet — start with the room above.</p>
      )}

      {groups.map(({ zone, tables: rows }) => (
        <section className="panel floor-zone-panel" key={zone?.id ?? 'loose'}>
          <div className="panel-heading">
            <div>
              <h2>{zone ? zone.name : 'Without a zone'}</h2>
              <p>
                {rows.length === 0
                  ? 'No tables yet.'
                  : `${rows.length} tables · ${rows.reduce((s, t) => s + (t.seats ?? 0), 0)} seats`}
              </p>
            </div>
            {zone && (
              <div className="team-row-actions">
                <button className="text-button" onClick={() => rename(zone)}>Rename</button>
                <button className="icon-button" onClick={() => removeZone(zone)} aria-label="Delete zone">
                  <Trash2 />
                </button>
              </div>
            )}
          </div>
          <div className="menu-list">
            {rows.map((t) => <TableRow key={t.id} table={t} onOpen={setEditing} />)}
            <button
              className="menu-add-row"
              onClick={() => setEditing({ zone_id: zone?.id ?? '', sort_order: tables.length })}
            >
              <Plus /> Add table
            </button>
          </div>
        </section>
      ))}

      {editing && (
        <TableEditor
          table={editing}
          zones={zones}
          locationId={locationId}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload() }}
        />
      )}
    </>
  )
}
