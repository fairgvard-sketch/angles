import { useEffect, useMemo, useState } from 'react'
import { MonitorSmartphone, RefreshCw, AlertTriangle, Wifi } from 'lucide-react'
import {
  fetchFleet, deviceStatus, STATUS_LABEL, lastSeenLabel, outboxAgeLabel,
} from './devices'

/**
 * «Девайсы» — парк касс организации. Данные из телеметрии (heartbeat 074)
 * через get_backoffice_fleet (097). Владельцу с несколькими кассами нужно
 * различать терминалы и замечать молчащий / с зависшей очередью.
 *
 * Read-only: управления устройством из веба пока нет (имя/отвязка — на самой
 * кассе). Строки сгруппированы по точке; сервер сортирует молчащие наверх.
 */

function statusVersions(device) {
  const parts = []
  if (device.app_version) parts.push(`v${device.app_version}`)
  if (device.bridge_version) parts.push(`bridge ${device.bridge_version}`)
  if (device.webview_version) parts.push(`Chrome ${device.webview_version}`)
  return parts.join(' · ')
}

function DeviceRow({ device }) {
  const status = deviceStatus(device)
  const outboxAge = outboxAgeLabel(device)
  return (
    <div className="data-row device-row">
      <div className="device-main">
        <span className={`device-status is-${status}`}><i />{STATUS_LABEL[status]}</span>
        <div className="device-name">
          <strong>{device.name}</strong>
          <small>{statusVersions(device) || '—'}</small>
        </div>
      </div>
      <div className="device-meta">
        {device.outbox_pending > 0 && (
          <span className={`device-queue ${device.outbox_failed ? 'is-negative' : ''}`}>
            {device.outbox_failed && <AlertTriangle />}
            {device.outbox_pending} queued{outboxAge ? ` · ${outboxAge}` : ''}
          </span>
        )}
        <span className="device-seen">{lastSeenLabel(device)}</span>
      </div>
    </div>
  )
}

export default function DevicesManager({ context }) {
  const [fleet, setFleet] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)

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

  // Группируем по точке; порядок устройств внутри группы сервер уже задал
  // (молчащие сверху), порядок групп — по имени точки.
  const groups = useMemo(() => {
    if (!fleet) return []
    const byLoc = new Map()
    for (const d of fleet) {
      const key = d.location_id || '—'
      if (!byLoc.has(key)) byLoc.set(key, { name: d.location_name || 'No location', devices: [] })
      byLoc.get(key).devices.push(d)
    }
    return [...byLoc.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [fleet])

  const total = fleet?.length ?? 0
  const attention = useMemo(
    () => (fleet ?? []).filter((d) => ['offline', 'error', 'never'].includes(deviceStatus(d))).length,
    [fleet],
  )

  return (
    <>
      <section className="page-heading compact-heading">
        <p className="eyebrow">{context.organization?.name}</p>
        <h1>Devices</h1>
        <p>POS terminals connected to your organisation.</p>
      </section>

      <div className="overview-toolbar">
        <div className="device-summary">
          <span><Wifi /> {total} device{total === 1 ? '' : 's'}</span>
          {attention > 0 && <span className="is-negative"><AlertTriangle /> {attention} need attention</span>}
        </div>
        <button className="icon-button" onClick={() => load()} title="Refresh" disabled={loading}><RefreshCw /></button>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {loading && !fleet ? (
        <p className="empty-state">Loading…</p>
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
                {g.devices.map((d) => <DeviceRow key={d.id} device={d} />)}
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
