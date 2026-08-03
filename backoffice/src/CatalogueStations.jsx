import { useEffect, useMemo, useState } from 'react'
import { Search, Utensils } from 'lucide-react'
import {
  createStation, updateStation, deleteStation, reorderStations, setItemStation, bulkErrorText,
} from './menu'
import {
  filterStations, itemsByStation, money, moveInOrder, priceLabel, unassignedItems,
} from './catalog'
import Drawer from './ui/Drawer'
import ConfirmDialog from './ui/ConfirmDialog'
import FormDialog from './ui/FormDialog'
import { Button } from './ui/Button'
import { RowMenu, OrderButtons } from './ui/RowMenu'
import useNarrow from './ui/useNarrow'

/**
 * Станции приготовления — маршрутизация проданного на нужную бригаду:
 * бар, горячий цех, холодный цех, пекарня.
 *
 * Станция это НЕ касса, не терминал, не принтер и не рабочее место
 * сотрудника: за железо отвечает раздел `Devices`, и столкновение этих
 * двух понятий предсказуемо, поэтому разница написана на экране словами.
 * Ни одного поля про связь, серийник или скорость печати здесь нет —
 * таких данных у станции не существует.
 */

/** Форма станции: имя и точка, которой станция принадлежит */
function StationForm({ station, count, context, locationId, onDone, onCancel }) {
  const isNew = !station?.id
  const [name, setName] = useState(station?.name ?? '')
  const [location, setLocation] = useState(locationId || context.locations?.[0]?.id || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const many = (context.locations?.length ?? 0) > 1

  async function submit() {
    if (!name.trim()) { setError('Give the station a name.'); return }
    setBusy(true)
    setError('')
    try {
      if (isNew) await createStation(context, location, name.trim(), count)
      else await updateStation(station.id, name.trim())
      await onDone()
    } catch (e) {
      setError(bulkErrorText(e.message))
      setBusy(false)
    }
  }

  return (
    <FormDialog
      title={isNew ? 'Add station' : `Rename ${station.name}`}
      description="A preparation station routes sold items to the team that makes them."
      submitLabel={isNew ? 'Add station' : 'Save station'}
      busy={busy}
      error={error}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <label className="qr-field">
        <span>Station name</span>
        <input
          value={name}
          maxLength={64}
          placeholder="Hot kitchen"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      {isNew && many && (
        <label className="qr-field">
          <span>Location</span>
          <select value={location} onChange={(e) => setLocation(e.target.value)}>
            {context.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
      )}
    </FormDialog>
  )
}

/** Панель станции: что на неё маршрутизируется и как это снять */
function StationDrawer({
  station, items, busy, error, onClose, onRename, onDelete, onUnassign,
}) {
  const [find, setFind] = useState('')
  const needle = find.trim().toLowerCase()
  const shown = needle
    ? items.filter((i) => String(i.name ?? '').toLowerCase().includes(needle))
    : items

  return (
    <Drawer
      modal={false}
      title={station.name}
      subtitle={`Preparation station · ${items.length} assigned item${items.length === 1 ? '' : 's'}`}
      onClose={onClose}
      actions={(
        <RowMenu
          label={`More actions for ${station.name}`}
          items={[{ key: 'delete', label: 'Delete station', tone: 'danger' }]}
          onPick={onDelete}
        />
      )}
      footer={(
        <Button variant="primary" className="cat-drawer-main" onClick={onRename}>Edit station</Button>
      )}
    >
      <div className="cat-detail">
        <section className="cat-detail-block">
          <h4>Assigned items</h4>
          {items.length > 3 && (
            <label className="order-search cat-drawer-search">
              <Search aria-hidden />
              <span className="visually-hidden">Find assigned item</span>
              <input
                type="search"
                value={find}
                placeholder="Find assigned item"
                onChange={(e) => setFind(e.target.value)}
              />
            </label>
          )}
          {items.length === 0 ? (
            <p className="empty-state">
              Nothing is routed here yet. Assign a station in the item’s card.
            </p>
          ) : shown.length === 0 ? (
            <p className="empty-state">No assigned item matches “{find}”.</p>
          ) : (
            <ul className="cat-mod-list">
              {shown.map((item) => (
                <li key={item.id}>
                  <span className="cat-mod-name">
                    {item.name}
                    <small>{priceLabel(item, money)}</small>
                  </span>
                  <Button
                    size="compact"
                    disabled={busy}
                    onClick={() => onUnassign(item)}
                  >
                    Unassign
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {/* Честно про последствие: снятая станция не снимает с продажи */}
          <p className="hint">
            Items without a station stay on sale but are not routed to a preparation team.
          </p>
        </section>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </Drawer>
  )
}

export default function StationsTab({
  context, locationId, data, reload, query, creating, onCreating,
}) {
  const [openId, setOpenId] = useState(null)
  /*
   * Разбор непривязанных — ОТДЕЛЬНОЕ состояние, а не особый `openId`.
   * Сначала это была строка-метка, и сторож ниже («выбранная станция
   * исчезла — закрыть панель») честно закрывал её сразу же: такой
   * станции в списке нет и быть не может.
   */
  const [reviewing, setReviewing] = useState(false)
  const [editing, setEditing] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const narrow = useNarrow()

  const byStation = useMemo(() => itemsByStation(data.items), [data.items])
  const stations = useMemo(
    () => filterStations(
      [...data.stations].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
      { query },
      byStation
    ),
    [data.stations, query, byStation]
  )
  const unassigned = useMemo(
    () => unassignedItems(data.items, data.stations),
    [data.items, data.stations]
  )

  const current = openId ? data.stations.find((s) => s.id === openId) ?? null : null
  useEffect(() => { if (openId && !current) setOpenId(null) }, [openId, current])

  /** Открыть станцию: разбор непривязанных при этом закрывается */
  const openStation = (id) => { setReviewing(false); setOpenId(id) }

  async function run(action) {
    setBusy(true)
    setError('')
    try {
      await action()
      await reload()
    } catch (e) {
      setError(bulkErrorText(e.message))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Порядок станций — полным списком id, как ждёт `reorder_menu`.
   * Двигаем в ПОЛНОМ списке, а не в отфильтрованном: иначе поиск
   * превращает «на шаг вверх» в прыжок через невидимые станции.
   */
  async function move(id, direction) {
    const all = [...data.stations].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    const ids = moveInOrder(all.map((s) => s.id), id, direction)
    await run(() => reorderStations(ids))
  }

  const orderIndex = (id) => [...data.stations]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .findIndex((s) => s.id === id)

  return (
    <>
      {/* Предсказуемое столкновение с разделом «Devices» — снимаем сразу */}
      <p className="cat-note">
        <Utensils aria-hidden />
        Preparation stations route sold items to the right team. They are not POS devices.
      </p>

      {unassigned.length > 0 && (
        <div className="cat-attention" role="status">
          <span>
            {unassigned.length === 1
              ? '1 catalogue item has no preparation station'
              : `${unassigned.length} catalogue items have no preparation station`}
          </span>
          {/* Не красным: непривязанная позиция продаётся, просто не
              печатается на цех — это внимание, а не отказ. */}
          <Button size="compact" onClick={() => { setOpenId(null); setReviewing(true) }}>
            Review items
          </Button>
        </div>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      <section className="panel cat-panel">
        {stations.length === 0 ? (
          <p className="empty-state">
            {query.trim()
              ? 'No station matches this search.'
              : 'No stations yet — add the first one to route items to a team.'}
          </p>
        ) : narrow ? (
          <ul className="cat-cards">
            {stations.map((s) => {
              const items = byStation.get(s.id) ?? []
              return (
                <li key={s.id} className={s.id === openId ? 'is-selected' : undefined}>
                  <button
                    type="button"
                    className="cat-card-open"
                    aria-expanded={s.id === openId}
                    onClick={() => openStation(s.id)}
                  >
                    <span className="cat-card-name">{s.name}</span>
                    <span className="cat-card-meta">
                      {items.length} item{items.length === 1 ? '' : 's'}
                    </span>
                    <span className="cat-card-meta">
                      {items.slice(0, 3).map((i) => i.name).join(', ') || 'Nothing routed yet'}
                    </span>
                  </button>
                  <span className="cat-card-side">
                    <OrderButtons
                      label={s.name}
                      index={orderIndex(s.id)}
                      total={data.stations.length}
                      disabled={busy}
                      onMove={(dir) => move(s.id, dir)}
                    />
                  </span>
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="cat-table-scroll">
            <table className="cat-table">
              <thead>
                <tr>
                  <th scope="col" className="cat-col-order">Order</th>
                  <th scope="col">Station</th>
                  <th scope="col">Assigned items</th>
                  <th scope="col">Item examples</th>
                  <th scope="col" className="cat-col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {stations.map((s) => {
                  const items = byStation.get(s.id) ?? []
                  return (
                    <tr key={s.id} className={`cat-row${s.id === openId ? ' is-selected' : ''}`}>
                      <td className="cat-col-order">
                        <OrderButtons
                          label={s.name}
                          index={orderIndex(s.id)}
                          total={data.stations.length}
                          disabled={busy}
                          onMove={(dir) => move(s.id, dir)}
                        />
                      </td>
                      <td>
                        <span className="cat-station-name">
                          {/* Нейтральный значок приготовления, а не касса,
                              экран, принтер или индикатор связи */}
                          <Utensils aria-hidden />
                          <button
                            type="button"
                            className="cat-open"
                            aria-expanded={s.id === openId}
                            onClick={() => openStation(s.id)}
                          >
                            {s.name}
                          </button>
                        </span>
                      </td>
                      <td className="cat-cell-muted">
                        {items.length} item{items.length === 1 ? '' : 's'}
                      </td>
                      <td className="cat-cell-muted cat-cell-examples">
                        {items.slice(0, 3).map((i) => i.name).join(', ') || '—'}
                      </td>
                      <td className="cat-col-actions">
                        <RowMenu
                          label={`Actions for ${s.name}`}
                          items={[
                            { key: 'rename', label: 'Edit station' },
                            { key: 'delete', label: 'Delete station', tone: 'danger' },
                          ]}
                          onPick={(key) => {
                            if (key === 'rename') setEditing(s)
                            if (key === 'delete') setConfirm(s)
                          }}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Разбор непривязанных: тот же список, но с назначением станции */}
      {reviewing && (
        <Drawer
          modal={false}
          title="Items with no preparation station"
          subtitle={`${unassigned.length} item${unassigned.length === 1 ? '' : 's'}`}
          onClose={() => setReviewing(false)}
        >
          <div className="cat-detail">
            <p className="hint">
              These items stay on sale — they are simply not routed to a preparation team.
            </p>
            {unassigned.length === 0 && (
              <p className="empty-state">
                Every catalogue item is routed to a preparation station now.
              </p>
            )}
            <ul className="cat-mod-list">
              {unassigned.map((item) => (
                <li key={item.id}>
                  <span className="cat-mod-name">
                    {item.name}
                    <small>{priceLabel(item, money)}</small>
                  </span>
                  <label className="cat-select-filter">
                    <span className="visually-hidden">Station for {item.name}</span>
                    <select
                      value=""
                      disabled={busy}
                      onChange={(e) => e.target.value
                        && run(() => setItemStation(item.id, e.target.value))}
                    >
                      <option value="">Assign to…</option>
                      {data.stations.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </label>
                </li>
              ))}
            </ul>
            {error && <p className="form-error" role="alert">{error}</p>}
          </div>
        </Drawer>
      )}

      {current && (
        <StationDrawer
          station={current}
          items={byStation.get(current.id) ?? []}
          busy={busy}
          error={error}
          onClose={() => setOpenId(null)}
          onRename={() => setEditing(current)}
          onDelete={() => setConfirm(current)}
          onUnassign={(item) => run(() => setItemStation(item.id, null))}
        />
      )}

      {(creating === 'station' || editing) && (
        <StationForm
          context={context}
          locationId={locationId}
          station={editing}
          count={data.stations.length}
          onDone={async () => { onCreating(null); setEditing(null); await reload() }}
          onCancel={() => { onCreating(null); setEditing(null) }}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={`Delete station “${confirm.name}”?`}
          /* Последствие взято из схемы: menu_items.station_id имеет
             ON DELETE SET NULL — позиции остаются и теряют маршрут. */
          description={`${(byStation.get(confirm.id) ?? []).length} item(s) stay on sale and lose their preparation station.`}
          confirmLabel="Delete station"
          tone="danger"
          busy={busy}
          error={error}
          onConfirm={async () => {
            await run(() => deleteStation(confirm.id))
            setOpenId(null)
            setConfirm(null)
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  )
}
