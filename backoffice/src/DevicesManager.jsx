import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive, ArchiveRestore, MonitorSmartphone, Pencil, RefreshCw, AlertTriangle,
  Wifi, X,
} from 'lucide-react'
import {
  fetchFleet, renameDevice, setDeviceArchived,
  deviceStatus, STATUS_LABEL, lastSeenLabel, outboxAgeLabel,
  deviceAdvice, filterFleet, fleetErrorText, isArchived,
} from './devices'
import { Button, IconButton } from './ui/Button'
import {
  EmptyPanel, EmptyState, ErrorText, PageHeader, Panel, SearchField, StatusBadge,
} from './ui/Layout'

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

export function DeviceRow({ device, busy, onRename, onArchive }) {
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
        <StatusBadge className="device-status" tone={status} label={STATUS_LABEL[status]} />
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
              <Button
                type="submit"
                variant="text"
                /* Safari не фокусирует кнопки по клику, поэтому
                   relatedTarget там пуст — не даём увести фокус вовсе. */
                onMouseDown={(e) => e.preventDefault()}
              >
                Save
              </Button>
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
          <IconButton
            disabled={busy}
            label={`Rename ${device.name}`}
            onClick={() => { setName(device.name); setEditing(true) }}
          >
            <Pencil />
          </IconButton>
          <IconButton
            disabled={busy}
            label={archived ? `Restore ${device.name}` : `Archive ${device.name}`}
            title={archived ? 'Back to the working list' : 'Hide from the working list — the terminal keeps working'}
            onClick={() => onArchive(!archived)}
          >
            {archived ? <ArchiveRestore /> : <Archive />}
          </IconButton>
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
      <PageHeader
        eyebrow={context.organization?.name}
        title="Devices"
        description="POS terminals connected to your organisation."
      />

      <div className="order-toolbar">
        <SearchField
          label="Search devices"
          value={query}
          onChange={setQuery}
          placeholder="Name, location or version"
        />
        {/* Списанные кассы не должны занимать операционный список, но
            и потеряться не должны — переключатель, а не удаление. */}
        {archivedCount > 0 && (
          <Button
            variant={showArchived ? 'primary' : 'secondary'}
            size={showArchived ? 'compact' : 'default'}
            aria-pressed={showArchived}
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
          </Button>
        )}
        {query && (
          <Button variant="text" onClick={() => setQuery('')}><X /> Clear</Button>
        )}
        <div className="device-summary">
          <span><Wifi /> {total} device{total === 1 ? '' : 's'}</span>
          {attention > 0 && <span className="is-negative"><AlertTriangle /> {attention} need attention</span>}
        </div>
        <IconButton onClick={() => load()} label="Refresh devices" disabled={loading}><RefreshCw /></IconButton>
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      {loading && !fleet ? (
        <EmptyState>Loading…</EmptyState>
      ) : total === 0 && (query || showArchived) ? (
        <Panel className="form-panel">
          <EmptyState>No devices match this search.</EmptyState>
        </Panel>
      ) : total === 0 ? (
        <EmptyPanel
          icon={<MonitorSmartphone />}
          title="No devices yet"
          description="Terminals appear here once your ANGLE POS has been set up on a device."
        />
      ) : (
        <>
          {groups.map((g, i) => (
            <Panel
              key={i}
              title={g.name}
              description={`${g.devices.length} device${g.devices.length === 1 ? '' : 's'}`}
            >
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
            </Panel>
          ))}
          {updatedAt && (
            <p className="updated-at">Updated {updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>
          )}
        </>
      )}
    </>
  )
}
