import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive, ArchiveRestore, MonitorSmartphone, Pencil, AlertTriangle,
  Trash2, Wifi, X,
} from 'lucide-react'
import {
  fetchFleet, renameDevice, setDeviceArchived, deleteDevice,
  deviceStatus, STATUS_LABEL, lastSeenLabel, outboxAgeLabel,
  deviceAdvice, filterFleet, fleetErrorText, isArchived,
  fleetSection, deleteOutcome, deleteErrorText,
} from './devices'
import { Button, IconButton } from './ui/Button'
import ConfirmDialog from './ui/ConfirmDialog'
import Skeleton, { SkeletonBar, SkeletonPanel, SkeletonRow } from './ui/Skeleton'
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

export function DeviceRow({ device, busy, onRename, onArchive, onDelete }) {
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
      </div>

      <span className="device-version">{statusVersions(device) || 'No version reported'}</span>

      {/* Совет объясняет, что владельцу делать дальше: «Offline» само по
          себе не отличает сбой сети от списанного терминала. */}
      {advice && !archived && (
        <p className="device-advice"><AlertTriangle aria-hidden /><span>{advice}</span></p>
      )}

      <div className="device-meta">
        {device.outbox_pending > 0 && (
          <span className={`device-queue ${device.outbox_failed ? 'is-negative' : ''}`}>
            {device.outbox_failed && <AlertTriangle />}
            {device.outbox_pending} queued{outboxAge ? ` · ${outboxAge}` : ''}
          </span>
        )}
        <span className="device-seen">Last seen {lastSeenLabel(device)}</span>
      </div>

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
        {/* Удаление живёт только в архиве: сначала владелец убирает
            кассу из работы и убеждается, что она не нужна. */}
        {archived && (
          <IconButton
            className="device-delete-action"
            disabled={busy}
            label={`Delete ${device.name} permanently`}
            title="Delete for good — the terminal loses access and disappears from the list"
            onClick={onDelete}
          >
            <Trash2 />
          </IconButton>
        )}
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
  // Удаление необратимо: спрашиваем подтверждение и называем терминал
  const [deleting, setDeleting] = useState(null)
  const [notice, setNotice] = useState('')

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

  /*
   * Три секции вместо одного списка: требующие внимания, рабочие и
   * архив. Смешанный список заставлял искать молчащую кассу глазами
   * среди двадцати рабочих. Внутри секции — по точке, как раньше.
   */
  const sections = useMemo(() => {
    const empty = { attention: [], active: [], archived: [] }
    for (const d of visible) empty[fleetSection(d)].push(d)
    const byLocation = (list) => {
      const byLoc = new Map()
      for (const d of list) {
        const key = d.location_id || '—'
        if (!byLoc.has(key)) byLoc.set(key, { name: d.location_name || 'No location', devices: [] })
        byLoc.get(key).devices.push(d)
      }
      return [...byLoc.values()].sort((a, b) => a.name.localeCompare(b.name))
    }
    return [
      {
        key: 'attention',
        title: 'Needs attention',
        hint: 'Not reporting, or the queue is stuck.',
        groups: byLocation(empty.attention),
      },
      {
        key: 'active',
        title: 'Working',
        hint: 'Reporting in and sending their queue.',
        groups: byLocation(empty.active),
      },
      {
        key: 'archived',
        title: 'Archived',
        hint: 'Out of the working list. They keep working until you delete them.',
        groups: byLocation(empty.archived),
      },
    ].filter((section) => section.groups.length > 0)
  }, [visible])

  const total = visible.length
  // Архивные не считаем требующими внимания: владелец уже решил их судьбу
  const attention = useMemo(
    () => visible.filter((d) => ['offline', 'error', 'never'].includes(deviceStatus(d))).length,
    [visible],
  )

  return (
    <>
      <PageHeader title="Devices">
        <p className="devices-subtitle">Monitor and manage the terminals connected to your locations.</p>
      </PageHeader>

      <div className="devices-toolbar">
        <SearchField
          label="Search devices"
          value={query}
          onChange={setQuery}
          placeholder="Name, location or version"
          className="order-search devices-search"
        />
        {/* Списанные кассы не должны занимать операционный список, но
            и потеряться не должны — переключатель, а не удаление. */}
        {archivedCount > 0 && (
          <Button
            variant="secondary"
            className={`devices-archive-toggle${showArchived ? ' is-active' : ''}`}
            aria-pressed={showArchived}
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
          </Button>
        )}
        {query && (
          <Button className="devices-clear" variant="text" onClick={() => setQuery('')}><X /> Clear</Button>
        )}
        <div className="device-summary">
          <span><Wifi /> {total} device{total === 1 ? '' : 's'}</span>
          {attention > 0 && <span className="is-negative"><AlertTriangle /> {attention} need attention</span>}
        </div>
      </div>

      {error && <ErrorText>{error}</ErrorText>}
      {notice && (
        <div className="bulk-result" role="status">
          <span>{notice}</span>
          <IconButton label="Dismiss" onClick={() => setNotice('')}><X /></IconButton>
        </div>
      )}

      {/*
        Удаление необратимо и закрывает терминалу вход: подтверждение
        называет кассу по имени и говорит, что останется, а что исчезнет.
      */}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name} for good?`}
          description={
            'The register disappears from this list and loses its sign-in — '
            + 'it cannot come back on its own, and setting it up again means '
            + 'connecting the terminal from scratch. '
            + 'Orders, shifts and reports made on it stay untouched.'
          }
          confirmLabel="Delete permanently"
          cancelLabel="Keep it archived"
          tone="danger"
          busy={busyId === deleting.id}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            const device = deleting
            setDeleting(null)
            setBusyId(device.id)
            setError('')
            try {
              const result = await deleteDevice(device.id)
              setNotice(deleteOutcome(result))
              await load(true)
            } catch (e) {
              setError(deleteErrorText(e.message))
            } finally {
              setBusyId(null)
            }
          }}
        />
      )}

      {loading && !fleet ? (
        /* Парк касс группами: заголовок группы и строки терминалов. */
        <Skeleton label="Loading the terminals…">
          {[3, 2].map((rows, group) => (
            <SkeletonPanel key={group}>
              <SkeletonBar width="22%" height={16} />
              {Array.from({ length: rows }, (_, i) => (
                <SkeletonRow key={i} height={64} lead={34} columns={['26%', '18%', '12%']} />
              ))}
            </SkeletonPanel>
          ))}
        </Skeleton>
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
          {sections.map((section) => (
            <section className="fleet-section" key={section.key}>
              <div className="fleet-section-head">
                <h2>{section.title}</h2>
                <p>{section.hint}</p>
              </div>
              {section.groups.map((g, i) => (
                <Panel
                  key={i}
                  title={g.name}
                  description={`${g.devices.length} device${g.devices.length === 1 ? '' : 's'}`}
                  className="fleet-location-panel"
                >
                  <div className="data-list">
                    {g.devices.map((d) => (
                      <DeviceRow
                        key={d.id}
                        device={d}
                        busy={busyId === d.id}
                        onRename={(name) => mutate(d.id, () => renameDevice(d.id, name))}
                        onArchive={(next) => mutate(d.id, () => setDeviceArchived(d.id, next))}
                        onDelete={() => setDeleting(d)}
                      />
                    ))}
                  </div>
                </Panel>
              ))}
            </section>
          ))}
          {updatedAt && (
            <p className="updated-at devices-updated">
              Updated automatically · {updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </>
      )}
    </>
  )
}
