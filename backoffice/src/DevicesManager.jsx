import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive, ArchiveRestore, MonitorSmartphone, Pencil, RefreshCw, AlertTriangle,
  Search, Wifi, X,
} from 'lucide-react'
import {
  fetchFleet, renameDevice, setDeviceArchived,
  deviceStatus, STATUS_LABEL, lastSeenLabel, outboxAgeLabel,
  deviceAdvice, filterFleet, fleetErrorText, isArchived,
} from './devices'

/**
 * «Девайсы» — парк касс организации. Данные из телеметрии (heartbeat 074)
 * через get_backoffice_fleet (097). Владельцу с несколькими кассами нужно
 * различать терминалы и замечать молчащий / с зависшей очередью.
 *
 * Переименование и архив — из кабинета (130). Архив НИЧЕГО не отключает:
 * терминал работает, записи и отчёты остаются, действие обратимо. Строки
 * сгруппированы по точке; сервер сортирует молчащие наверх.
 */

function statusVersions(device) {
  const parts = []
  if (device.app_version) parts.push(`v${device.app_version}`)
  if (device.bridge_version) parts.push(`bridge ${device.bridge_version}`)
  if (device.webview_version) parts.push(`Chrome ${device.webview_version}`)
  return parts.join(' · ')
}

function DeviceRow({ device, busy, onRename, onArchive }) {
  const status = deviceStatus(device)
  const outboxAge = outboxAgeLabel(device)
  const advice = deviceAdvice(device)
  const archived = isArchived(device)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(device.name)
  const inputRef = useRef(null)

  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  return (
    <div className={`data-row device-row${archived ? ' is-archived' : ''}`}>
      <div className="device-main">
        <span className={`device-status is-${status}`}><i />{STATUS_LABEL[status]}</span>
        <div className="device-name">
          {editing ? (
            <form
              className="device-rename"
              onSubmit={(e) => {
                e.preventDefault()
                setEditing(false)
                if (name.trim() && name.trim() !== device.name) onRename(name.trim())
                else setName(device.name)
              }}
              /* Отмена по уходу фокуса — только когда фокус покидает ФОРМУ.
                 Прежний onBlur на поле срабатывал раньше клика по «Save»:
                 форма размонтировалась, клик приземлялся в пустоту, и
                 переименование молча не отправлялось. */
              onBlur={(e) => {
                if (e.currentTarget.contains(e.relatedTarget)) return
                setEditing(false)
                setName(device.name)
              }}
            >
              <input
                ref={inputRef}
                value={name}
                maxLength={60}
                aria-label={`Name for ${device.name}`}
                onChange={(e) => setName(e.target.value)}
              />
              <button
                type="submit"
                className="text-button"
                /* Safari не фокусирует кнопки по клику, поэтому
                   relatedTarget там пуст — не даём увести фокус вовсе. */
                onMouseDown={(e) => e.preventDefault()}
              >
                Save
              </button>
            </form>
          ) : (
            <strong>
              {device.name}
              {archived && <small className="device-archived-tag"> · archived</small>}
            </strong>
          )}
          <small>{statusVersions(device) || 'No version reported'}</small>
        </div>
      </div>

      {/* Совет объясняет, что владельцу делать дальше: «Offline» само по
          себе не отличает сбой сети от списанного терминала. */}
      {advice && !archived && <p className="device-advice">{advice}</p>}

      <div className="device-meta">
        {device.outbox_pending > 0 && (
          <span className={`device-queue ${device.outbox_failed ? 'is-negative' : ''}`}>
            {device.outbox_failed && <AlertTriangle />}
            {device.outbox_pending} queued{outboxAge ? ` · ${outboxAge}` : ''}
          </span>
        )}
        <span className="device-seen">{lastSeenLabel(device)}</span>
        <div className="device-actions">
          <button
            type="button"
            className="icon-button"
            disabled={busy}
            aria-label={`Rename ${device.name}`}
            onClick={() => { setName(device.name); setEditing(true) }}
          >
            <Pencil />
          </button>
          <button
            type="button"
            className="icon-button"
            disabled={busy}
            aria-label={archived ? `Restore ${device.name}` : `Archive ${device.name}`}
            title={archived ? 'Back to the working list' : 'Hide from the working list — the terminal keeps working'}
            onClick={() => onArchive(!archived)}
          >
            {archived ? <ArchiveRestore /> : <Archive />}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function DevicesManager({ context }) {
  const [fleet, setFleet] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [busyId, setBusyId] = useState(null)

  async function load(silent = false) {
    if (!silent) setLoading(true)
    setError('')
    try {
      const data = await fetchFleet()
      setFleet(data)
      setUpdatedAt(new Date())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // Пока раздел открыт, тихо освежаем — heartbeat приходит раз в пару минут
    const timer = setInterval(() => load(true), 60_000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function mutate(deviceId, fn) {
    setBusyId(deviceId)
    setError('')
    try {
      await fn()
      await load(true)
    } catch (e) {
      setError(fleetErrorText(e.message))
    } finally {
      setBusyId(null)
    }
  }

  const visible = useMemo(
    () => filterFleet(fleet, { query, showArchived }),
    [fleet, query, showArchived]
  )
  const archivedCount = useMemo(() => (fleet ?? []).filter(isArchived).length, [fleet])

  // Группируем по точке; порядок устройств внутри группы сервер уже задал
  // (молчащие сверху), порядок групп — по имени точки.
  const groups = useMemo(() => {
    if (!fleet) return []
    const byLoc = new Map()
    for (const d of visible) {
      const key = d.location_id || '—'
      if (!byLoc.has(key)) byLoc.set(key, { name: d.location_name || 'No location', devices: [] })
      byLoc.get(key).devices.push(d)
    }
    return [...byLoc.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [fleet, visible])

  const total = visible.length
  // Архивные не считаем требующими внимания: владелец уже решил их судьбу
  const attention = useMemo(
    () => visible.filter((d) => ['offline', 'error', 'never'].includes(deviceStatus(d))).length,
    [visible],
  )

  return (
    <>
      <section className="page-heading compact-heading">
        <p className="eyebrow">{context.organization?.name}</p>
        <h1>Devices</h1>
        <p>POS terminals connected to your organisation.</p>
      </section>

      <div className="order-toolbar">
        <label className="order-search">
          <Search aria-hidden />
          <span className="visually-hidden">Search devices</span>
          <input
            type="search"
            value={query}
            placeholder="Name, location or version"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {/* Списанные кассы не должны занимать операционный список, но
            и потеряться не должны — переключатель, а не удаление. */}
        {archivedCount > 0 && (
          <button
            type="button"
            className={showArchived ? 'primary-button compact' : 'secondary-button'}
            aria-pressed={showArchived}
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
          </button>
        )}
        {query && (
          <button type="button" className="text-button" onClick={() => setQuery('')}><X /> Clear</button>
        )}
        <div className="device-summary">
          <span><Wifi /> {total} device{total === 1 ? '' : 's'}</span>
          {attention > 0 && <span className="is-negative"><AlertTriangle /> {attention} need attention</span>}
        </div>
        <button className="icon-button" onClick={() => load()} aria-label="Refresh devices" disabled={loading}><RefreshCw /></button>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {loading && !fleet ? (
        <p className="empty-state">Loading…</p>
      ) : total === 0 && (query || showArchived) ? (
        <section className="panel form-panel">
          <p className="empty-state">No devices match this search.</p>
        </section>
      ) : total === 0 ? (
        <section className="section-placeholder panel">
          <span className="section-icon"><MonitorSmartphone /></span>
          <div>
            <h2>No devices yet</h2>
            <p>Terminals appear here once your ANGLE POS has been set up on a device.</p>
          </div>
        </section>
      ) : (
        <>
          {groups.map((g, i) => (
            <section className="panel" key={i}>
              <div className="panel-heading">
                <div><h2>{g.name}</h2><p>{g.devices.length} device{g.devices.length === 1 ? '' : 's'}</p></div>
              </div>
              <div className="data-list">
                {g.devices.map((d) => (
                  <DeviceRow
                    key={d.id}
                    device={d}
                    busy={busyId === d.id}
                    onRename={(name) => mutate(d.id, () => renameDevice(d.id, name))}
                    onArchive={(next) => mutate(d.id, () => setDeviceArchived(d.id, next))}
                  />
                ))}
              </div>
            </section>
          ))}
          {updatedAt && (
            <p className="updated-at">Updated {updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>
          )}
        </>
      )}
    </>
  )
}
