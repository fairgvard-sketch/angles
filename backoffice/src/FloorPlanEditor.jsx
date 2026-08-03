import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Redo2, Trash2, Undo2 } from 'lucide-react'
import {
  fetchFloorPlan, createZone, renameZone, deleteZone,
  saveTable, deleteTable, setTableStatus, saveFloorLayout, clearTableMinParty,
  floorErrorText,
} from './floorplan'
import {
  GRID_STEP, hasUnsavedLayout, layoutPayload, nudge, placeAt, pushHistory,
  redo, undo, withDefaultPositions,
} from './floorplan-layout'
import Drawer from './ui/Drawer'
import ConfirmDialog from './ui/ConfirmDialog'
import { Button, IconButton } from './ui/Button'

/**
 * План зала (Kassa 123 + 138) — теперь план, а не список.
 *
 * Столы существовали строками: «стол 12» никак не связан с местом в
 * зале, и на вопрос гостя «можно у окна» ответить по такому списку
 * нельзя. Координаты в схеме были с 017, но правила их только касса.
 *
 * Здесь зал раскладывается мышью и клавиатурой, а сохраняется по кнопке:
 * автосохранение каждого перетаскивания лишает возможности передумать,
 * а пять запросов на пять движений — это пять шансов сохранить половину
 * зала.
 */

const SEAT_CHOICES = [1, 2, 3, 4, 5, 6, 8, 10, 12]

/** Зона, к которой относится стол, или «без зоны» */
const zoneKeyOf = (table) => table.zone_id ?? '__none__'

export default function FloorPlanEditor({ locationId }) {
  const [plan, setPlan] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [zoneFilter, setZoneFilter] = useState(null)
  const [selected, setSelected] = useState(null)
  const [editing, setEditing] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [removingZone, setRemovingZone] = useState(null)
  const [addingZone, setAddingZone] = useState(false)

  // Раскладка живёт в состоянии до нажатия Save: пока владелец двигает
  // столы, сервер об этом не знает — и это осознанно.
  const [layout, setLayout] = useState([])
  const [saved, setSaved] = useState([])
  const [history, setHistory] = useState({ past: [], future: [] })

  const canvasRef = useRef(null)
  const dragRef = useRef(null)

  const reload = useCallback(async () => {
    if (!locationId) return
    try {
      const next = await fetchFloorPlan(locationId)
      const placed = withDefaultPositions(next.tables)
      setPlan(next)
      setLayout(placed)
      setSaved(placed)
      setHistory({ past: [], future: [] })
      setError('')
    } catch (e) {
      setError(floorErrorText(e.message))
    }
  }, [locationId])

  useEffect(() => { setPlan(null); reload() }, [reload])

  const zones = plan?.zones ?? []
  const dirty = hasUnsavedLayout(saved, layout)

  /*
   * Несохранённый план не должен исчезнуть вместе с вкладкой. Браузер
   * покажет своё предупреждение — заменить его нельзя, но и молчать
   * нельзя: расстановка зала занимает полчаса.
   */
  useEffect(() => {
    if (!dirty) return undefined
    const onBeforeUnload = (event) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const visible = useMemo(() => (
    zoneFilter === null ? layout : layout.filter((t) => zoneKeyOf(t) === zoneFilter)
  ), [layout, zoneFilter])

  const selectedTable = layout.find((t) => t.id === selected) ?? null

  /** Правка раскладки с записью в историю — отсюда работает и отмена */
  const applyLayout = useCallback((next) => {
    setLayout((current) => {
      setHistory((h) => pushHistory(h, current))
      return next(current)
    })
  }, [])

  const moveTable = (id, fn) => applyLayout((current) => (
    current.map((table) => (table.id === id ? fn(table) : table))
  ))

  function onUndo() {
    const step = undo(history, layout)
    if (!step) return
    setLayout(step.state)
    setHistory(step.history)
  }

  function onRedo() {
    const step = redo(history, layout)
    if (!step) return
    setLayout(step.state)
    setHistory(step.history)
  }

  /** Перетаскивание: координаты считаем в процентах холста */
  function onPointerDown(event, table) {
    if (event.button != null && event.button !== 0) return
    setSelected(table.id)
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    dragRef.current = {
      id: table.id,
      // Точка захвата: без неё стол прыгает центром под курсор
      dx: ((event.clientX - rect.left) / rect.width) * 100 - table.x,
      dy: ((event.clientY - rect.top) / rect.height) * 100 - table.y,
      moved: false,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function onPointerMove(event) {
    const drag = dragRef.current
    const canvas = canvasRef.current
    if (!drag || !canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * 100 - drag.dx
    const y = ((event.clientY - rect.top) / rect.height) * 100 - drag.dy
    if (!drag.moved) {
      drag.moved = true
      // Историю пишем один раз на перетаскивание, а не на каждый пиксель
      setHistory((h) => pushHistory(h, layout))
    }
    setLayout((current) => current.map((t) => (t.id === drag.id ? placeAt(t, x, y) : t)))
  }

  function onPointerUp() { dragRef.current = null }

  /** Клавиатура двигает выбранный стол — перетаскивания мало */
  function onCanvasKeyDown(event) {
    if (!selectedTable) return
    const map = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    }
    const delta = map[event.key]
    if (!delta) return
    event.preventDefault()
    const step = event.shiftKey ? GRID_STEP * 4 : GRID_STEP
    moveTable(selectedTable.id, (t) => nudge(t, delta[0], delta[1], step / GRID_STEP * GRID_STEP))
  }

  async function run(fn) {
    setBusy(true)
    setError('')
    try {
      await fn()
      return true
    } catch (e) {
      setError(floorErrorText(e.message))
      return false
    } finally {
      setBusy(false)
    }
  }

  const saveLayout = () => run(async () => {
    await saveFloorLayout(locationId, layoutPayload(layout))
    setSaved(layout.map((t) => ({ ...t, placed: true })))
    setLayout((current) => current.map((t) => ({ ...t, placed: true })))
    setHistory({ past: [], future: [] })
  })

  // Холст той же геометрии, что и готовый план: иначе раздел схлопывается
  // в строку и через секунду прыгает обратно на весь экран.
  if (plan === null) {
    return (
      <section className="panel form-panel floor-panel">
        <div role="status" aria-live="polite" className="visually-hidden">Loading the floor plan…</div>
        <div className="floor-canvas is-loading" aria-hidden />
      </section>
    )
  }

  return (
    <>
      {error && <p className="form-error" role="alert">{error}</p>}

      <section className="panel form-panel floor-panel">
        <div className="floor-toolbar">
          <div className="timeline-zones" aria-label="Zone filter">
            <button
              type="button"
              className={`timeline-filter-button${zoneFilter === null ? ' is-active' : ''}`}
              aria-pressed={zoneFilter === null}
              onClick={() => setZoneFilter(null)}
            >
              All zones
            </button>
            {zones.map((zone) => (
              <button
                key={zone.id}
                type="button"
                className={`timeline-filter-button${zoneFilter === zone.id ? ' is-active' : ''}`}
                aria-pressed={zoneFilter === zone.id}
                onClick={() => setZoneFilter(zone.id)}
              >
                {zone.name}
              </button>
            ))}
          </div>

          <div className="floor-toolbar-actions">
            <Button size="compact" onClick={() => setAddingZone(true)}>
              <Plus /> Add zone
            </Button>
            <Button
              size="compact"
              onClick={() => setEditing({ zone_id: zoneFilter === '__none__' ? '' : (zoneFilter ?? ''), sort_order: layout.length })}
            >
              <Plus /> Add table
            </Button>
            <IconButton label="Undo" disabled={history.past.length === 0} onClick={onUndo}>
              <Undo2 />
            </IconButton>
            <IconButton label="Redo" disabled={history.future.length === 0} onClick={onRedo}>
              <Redo2 />
            </IconButton>
            <Button
              variant="primary"
              size="compact"
              disabled={!dirty || busy}
              busy={busy}
              busyLabel="Saving…"
              onClick={saveLayout}
            >
              {dirty ? 'Save layout' : 'Layout saved'}
            </Button>
          </div>
        </div>

        {layout.length === 0 ? (
          <p className="empty-state">
            No tables yet. Add a zone with its first tables — bookings need them
            to be seated.
          </p>
        ) : (
          <>
            {/*
              Холст — обычный div с абсолютным позиционированием в
              процентах: canvas или SVG здесь дали бы свою систему
              координат и свою же доступность, которую пришлось бы
              изобретать заново. Столы остаются кнопками, и клавиатура
              работает без единой строчки лишнего кода.
            */}
            <div
              className="floor-canvas"
              ref={canvasRef}
              role="application"
              aria-label="Floor plan"
              onKeyDown={onCanvasKeyDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            >
              {visible.map((table) => {
                const off = table.status === 'disabled'
                return (
                  <button
                    key={table.id}
                    type="button"
                    className={`floor-table is-${table.shape}${
                      selected === table.id ? ' is-selected' : ''}${
                      off ? ' is-off' : ''}${
                      table.auto_assign === false ? ' is-manual' : ''}`}
                    style={{
                      left: `${table.x}%`,
                      top: `${table.y}%`,
                      width: `${table.w}%`,
                      height: `${table.h}%`,
                    }}
                    aria-pressed={selected === table.id}
                    aria-label={`Table ${table.label}, ${table.seats} seats${
                      off ? ', out of service' : ''}. Arrow keys move it.`}
                    onPointerDown={(e) => onPointerDown(e, table)}
                    onClick={() => setSelected(table.id)}
                    onDoubleClick={() => setEditing(table)}
                  >
                    <strong>{table.label}</strong>
                    <small>{table.seats} seats</small>
                  </button>
                )
              })}
            </div>

            <p className="form-hint">
              Drag tables or move the selected one with arrow keys (Shift for a
              bigger step). Changes publish when you press Save layout.
            </p>
          </>
        )}
      </section>

      {selectedTable && (
        <TableInspector
          table={selectedTable}
          zones={zones}
          busy={busy}
          onClose={() => setSelected(null)}
          onEdit={() => setEditing(selectedTable)}
          onShape={(shape) => moveTable(selectedTable.id, (t) => ({ ...t, shape }))}
          onSize={(w, h) => moveTable(selectedTable.id, (t) => ({ ...t, w, h }))}
          onProps={async (patch) => {
            const ok = await run(() => saveTable(locationId, {
              id: selectedTable.id,
              label: selectedTable.label,
              zoneId: selectedTable.zone_id ?? null,
              seats: selectedTable.seats,
              combinable: selectedTable.combinable ?? false,
              sortOrder: selectedTable.sort_order ?? 0,
              ...patch,
            }))
            if (ok) await reload()
          }}
          onClearMinParty={async () => {
            const ok = await run(() => clearTableMinParty(locationId, selectedTable.id))
            if (ok) await reload()
          }}
          onService={async () => {
            const ok = await run(() => setTableStatus(
              locationId, selectedTable.id,
              selectedTable.status === 'disabled' ? 'free' : 'disabled',
            ))
            if (ok) await reload()
          }}
          onDelete={async () => {
            const ok = await run(() => deleteTable(locationId, selectedTable.id))
            if (ok) { setSelected(null); await reload() }
          }}
        />
      )}

      {editing && (
        <TableEditor
          table={editing}
          zones={zones}
          locationId={locationId}
          tableCount={layout.length}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await reload() }}
        />
      )}

      {addingZone && (
        <AddZone
          locationId={locationId}
          zoneCount={zones.length}
          tableCount={layout.length}
          onClose={() => setAddingZone(false)}
          onSaved={async () => { setAddingZone(false); await reload() }}
        />
      )}

      {/* Зоны правятся диалогом кабинета, а не window.prompt: тот не
          поддерживается в части встроенных браузеров, и переименование
          там молча не работало. */}
      {renaming && (
        <ConfirmDialog
          title={`Rename “${renaming.name}”`}
          confirmLabel="Rename zone"
          cancelLabel="Keep the name"
          reason={{ label: 'Zone name', placeholder: 'Main room, Terrace, Bar', optional: false }}
          busy={busy}
          onCancel={() => setRenaming(null)}
          onConfirm={async (name) => {
            if (!name) { setRenaming(null); return }
            const ok = await run(() => renameZone(locationId, renaming.id, name))
            setRenaming(null)
            if (ok) await reload()
          }}
        />
      )}

      {removingZone && (
        <ConfirmDialog
          title={`Delete zone “${removingZone.name}”?`}
          description={(() => {
            const count = layout.filter((t) => t.zone_id === removingZone.id).length
            return count > 0
              ? `Its ${count} table${count === 1 ? '' : 's'} stay in the room without a zone.`
              : 'The zone has no tables.'
          })()}
          confirmLabel="Delete zone"
          cancelLabel="Keep the zone"
          tone="danger"
          busy={busy}
          onCancel={() => setRemovingZone(null)}
          onConfirm={async () => {
            const zone = removingZone
            setRemovingZone(null)
            const ok = await run(() => deleteZone(locationId, zone.id))
            if (ok) { setZoneFilter(null); await reload() }
          }}
        />
      )}

      {/* Зоны списком под планом: их немного, и это настройка, а не
          рабочая поверхность. */}
      {zones.length > 0 && (
        <section className="panel floor-zone-panel">
          <div className="panel-heading">
            <div>
              <h2>Zones</h2>
              <p>{zones.length} zones · {layout.length} tables · {
                layout.reduce((sum, t) => sum + (t.seats ?? 0), 0)} seats</p>
            </div>
          </div>
          <div className="menu-list">
            {zones.map((zone) => (
              <div className="menu-row floor-zone-row" key={zone.id}>
                <span className="floor-table-name">
                  <strong>{zone.name}</strong>
                  <small>
                    {layout.filter((t) => t.zone_id === zone.id).length} tables
                  </small>
                </span>
                <span className="team-row-actions">
                  <button type="button" className="text-button" onClick={() => setRenaming(zone)}>
                    Rename
                  </button>
                  <IconButton label={`Delete zone ${zone.name}`} onClick={() => setRemovingZone(zone)}>
                    <Trash2 />
                  </IconButton>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

/** Инспектор стола: форма, размер и правила подбора */
function TableInspector({
  table, zones, busy, onClose, onEdit, onShape, onSize, onProps, onClearMinParty,
  onService, onDelete,
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const zoneName = zones.find((z) => z.id === table.zone_id)?.name ?? 'No zone'
  const off = table.status === 'disabled'

  return (
    <Drawer
      labelledBy="table-inspector-title"
      title={`Table ${table.label}`}
      subtitle={`${table.seats} seats · ${zoneName}`}
      onClose={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className="sheet-section">
        <span className="sheet-section-title">Shape</span>
        <div className="order-actions">
          {['square', 'circle'].map((shape) => (
            <button
              key={shape}
              type="button"
              className={table.shape === shape ? 'primary-button compact' : 'secondary-button'}
              aria-pressed={table.shape === shape}
              onClick={() => onShape(shape)}
            >
              {shape === 'square' ? 'Rectangle' : 'Round'}
            </button>
          ))}
        </div>
        <div className="order-actions">
          <button type="button" className="secondary-button" onClick={() => onSize(8, 8)}>Small</button>
          <button type="button" className="secondary-button" onClick={() => onSize(12, 12)}>Medium</button>
          <button type="button" className="secondary-button" onClick={() => onSize(18, 12)}>Long</button>
        </div>
        {/* Форма и размер — часть раскладки, поэтому уезжают на сервер
            вместе с ней, по кнопке Save layout. */}
        <p className="form-hint">Shape and size are part of the layout — press Save layout to apply.</p>
      </div>

      <div className="sheet-section">
        <span className="sheet-section-title">Booking rules</span>
        <label className="qr-field">
          <span>Minimum party</span>
          <input
            type="number"
            min={1}
            max={table.seats}
            defaultValue={table.min_party ?? ''}
            placeholder="No minimum"
            disabled={busy}
            onBlur={(e) => {
              const value = e.target.value.trim()
              if (value === '') {
                if (table.min_party != null) onClearMinParty()
                return
              }
              const next = Number(value)
              if (next !== table.min_party) onProps({ minParty: next })
            }}
          />
        </label>
        {/* Порог — про автоподбор, а не запрет: хостес всё равно может
            посадить сюда кого угодно вручную. */}
        <p className="form-hint">
          Automatic assignment will not give this table to a smaller party. You
          can still seat anyone here by hand.
        </p>
        <label className="check-field">
          <input
            type="checkbox"
            checked={table.auto_assign !== false}
            disabled={busy}
            onChange={(e) => onProps({ autoAssign: e.target.checked })}
          />
          <span>Include in automatic assignment</span>
        </label>
        <p className="form-hint">
          Turn this off for tables you hand out yourself — a window seat you
          keep for walk-ins, or a table reserved for staff.
        </p>
      </div>

      <div className="order-actions">
        <button type="button" className="secondary-button" onClick={onEdit}>
          Edit name, seats, zone
        </button>
        <button type="button" className="secondary-button" disabled={busy} onClick={onService}>
          {off ? 'Return to service' : 'Take out of service'}
        </button>
      </div>

      {confirmDelete ? (
        <ConfirmDialog
          title={`Remove table ${table.label}?`}
          description="The table leaves the floor plan. Past orders and bookings keep their reference."
          confirmLabel="Remove table"
          cancelLabel="Keep it"
          tone="danger"
          busy={busy}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => { setConfirmDelete(false); onDelete() }}
        />
      ) : (
        <button
          type="button"
          className="text-button"
          data-danger
          disabled={busy}
          onClick={() => setConfirmDelete(true)}
        >
          Remove table from the plan
        </button>
      )}
    </Drawer>
  )
}

/** Имя, вместимость и зона — то, что не относится к раскладке */
function TableEditor({ table, zones, locationId, tableCount, onClose, onSaved }) {
  const isNew = !table.id
  const [label, setLabel] = useState(table.label || '')
  const [zoneId, setZoneId] = useState(table.zone_id || '')
  const [seats, setSeats] = useState(table.seats ?? 2)
  const [combinable, setCombinable] = useState(table.combinable ?? false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setBusy(true)
    setError('')
    try {
      await saveTable(locationId, {
        id: table.id,
        label,
        zoneId: zoneId || null,
        seats: Number(seats),
        combinable,
        sortOrder: table.sort_order ?? tableCount,
      })
      await onSaved()
    } catch (e) {
      setError(floorErrorText(e.message))
      setBusy(false)
    }
  }

  return (
    <Drawer
      labelledBy="table-editor-title"
      title={isNew ? 'New table' : `Edit table ${table.label}`}
      subtitle={isNew ? 'It appears on the plan right away.' : null}
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="compact" busy={busy} busyLabel="Saving…" onClick={save}>
            Save table
          </Button>
        </>
      )}
    >
      <div className="qr-grid">
        <label className="qr-field">
          <span>Name</span>
          <input value={label} maxLength={24} placeholder="12, Bar 3, Terrace A"
            onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="qr-field">
          <span>Seats</span>
          <select value={seats} onChange={(e) => setSeats(Number(e.target.value))}>
            {SEAT_CHOICES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="qr-field">
          <span>Zone</span>
          <select value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
            <option value="">No zone</option>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </label>
      </div>
      <label className="check-field">
        <input type="checkbox" checked={combinable}
          onChange={(e) => setCombinable(e.target.checked)} />
        <span>Can be combined with a neighbouring table for a large party</span>
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
    </Drawer>
  )
}

/** Зона вместе с первыми столами — обычный старт нового зала */
function AddZone({ locationId, zoneCount, tableCount, onClose, onSaved }) {
  const [name, setName] = useState('')
  const [count, setCount] = useState(6)
  const [seats, setSeats] = useState(2)
  const [prefix, setPrefix] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (!name.trim()) return
    setBusy(true)
    setError('')
    try {
      await createZone(locationId, name, zoneCount, {
        tableCount: Number(count),
        prefix,
        tableSortOrder: tableCount,
        seats: Number(seats),
      })
      await onSaved()
    } catch (e) {
      setError(floorErrorText(e.message))
      setBusy(false)
    }
  }

  return (
    <Drawer
      labelledBy="zone-add-title"
      title="Add a zone"
      subtitle="Create its first tables in the same step."
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="compact" busy={busy} busyLabel="Adding…" onClick={save}>
            Add zone
          </Button>
        </>
      )}
    >
      <div className="qr-grid">
        <label className="qr-field">
          <span>Zone name</span>
          <input value={name} maxLength={40} placeholder="Main room, Terrace, Bar"
            onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="qr-field">
          <span>Tables</span>
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[0, 2, 4, 6, 8, 10, 12, 16, 20].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="qr-field">
          <span>Seats each</span>
          <select value={seats} onChange={(e) => setSeats(Number(e.target.value))}>
            {SEAT_CHOICES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="qr-field">
          <span>Name prefix</span>
          <input value={prefix} maxLength={8} placeholder="none"
            onChange={(e) => setPrefix(e.target.value)} />
        </label>
      </div>
      <p className="form-hint">
        Tables are named {prefix || ''}1…{prefix || ''}{count || 'N'} and can be
        renamed one by one afterwards.
      </p>
      {error && <p className="form-error" role="alert">{error}</p>}
    </Drawer>
  )
}
