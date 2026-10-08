import { useEffect, useState } from 'react'
import { Smartphone } from 'lucide-react'
import {
  countdownLabel, createPairingCode, fetchWaiterPhones, formatPairCode,
  isRevoked, pairingUrl, phoneErrorText, phoneSeenLabel, revokeWaiterPhone,
  secondsLeft,
} from './waiter-phones'
import { Button } from './ui/Button'
import ConfirmDialog from './ui/ConfirmDialog'
import FormDialog from './ui/FormDialog'
import { EmptyState, ErrorText, Panel } from './ui/Layout'
import { QrCanvas } from './qr-blocks'

/**
 * «Waiter phones» в разделе Devices: какие телефоны допущены в точки,
 * подключить новый (QR на 10 минут) и отключить потерянный или чужой.
 */

export function WaiterPhoneRow({ phone, busy, onRevoke }) {
  const revoked = isRevoked(phone)
  return (
    <div className={`data-row waiter-phone-row${revoked ? ' is-archived' : ''}`}>
      <div className="waiter-phone-name">
        <strong>{phone.label || 'Phone'}</strong>
        <small>{phone.location_name}</small>
      </div>
      <span className="device-seen">{revoked ? 'Disconnected' : phoneSeenLabel(phone)}</span>
      {!revoked && (
        <Button variant="secondary" disabled={busy} onClick={onRevoke}>
          Disconnect<span className="visually-hidden"> {phone.label || 'phone'} at {phone.location_name}</span>
        </Button>
      )}
    </div>
  )
}

function ConnectDialog({ locations, onClose }) {
  const many = locations.length > 1
  const [location, setLocation] = useState(locations[0]?.id ?? '')
  const [code, setCode] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!code) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [code])

  const left = code ? secondsLeft(code.expires_at, now) : 0
  const expired = !!code && left === 0

  async function create() {
    setBusy(true)
    setError('')
    try {
      setCode(await createPairingCode(location))
      setNow(Date.now())
    } catch (e) {
      setError(phoneErrorText(e.message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormDialog
      title="Connect a waiter's phone"
      description="The waiter scans the code with the phone camera. After that, any waiter signs in on that phone with their own PIN."
      submitLabel={code && !expired ? 'Done' : code ? 'New code' : 'Show code'}
      cancelLabel="Close"
      busy={busy}
      error={error}
      onCancel={onClose}
      onSubmit={() => (code && !expired ? onClose() : create())}
    >
      {!code && many && (
        <label className="qr-field">
          <span>Location</span>
          <select value={location} onChange={(e) => setLocation(e.target.value)}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
      )}
      {code && !expired && (
        <div className="waiter-pair-code">
          <QrCanvas url={pairingUrl(code.code)} size={208} label="Connect a waiter's phone" />
          <strong className="waiter-pair-text" aria-label={`Code ${code.code.split('').join(' ')}`}>
            {formatPairCode(code.code)}
          </strong>
          <p>
            No camera? Open <span className="waiter-pair-url">{pairingUrl('').replace(/#$/, '')}</span> on
            the phone and type the code. It works once and expires in {countdownLabel(left)}.
          </p>
        </div>
      )}
      {expired && <p className="sheet-sub">This code has expired. Show a new one.</p>}
      {!code && (
        <p className="sheet-sub">
          Waiters take orders at the table and send them to the kitchen. Payments, refunds,
          discounts and reports stay on the main register. Kitchen tickets print on the
          register that has “Print waiter orders” turned on.
        </p>
      )}
    </FormDialog>
  )
}

export default function WaiterPhones({ context }) {
  const locations = context?.locations ?? []
  const [phones, setPhones] = useState(null)
  const [error, setError] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [revoking, setRevoking] = useState(null)
  const [busyId, setBusyId] = useState(null)

  async function load() {
    try {
      setPhones(await fetchWaiterPhones())
    } catch (e) {
      setError(phoneErrorText(e.message))
    }
  }

  useEffect(() => {
    load()
    const timer = setInterval(load, 60_000)
    return () => clearInterval(timer)
  }, [])

  const active = (phones ?? []).filter((p) => !isRevoked(p))

  return (
    <section className="fleet-section">
      <div className="fleet-section-head">
        <h2>Waiter phones</h2>
        <p>Personal phones allowed to take orders at the table. Waiters sign in with their own PIN.</p>
      </div>
      <Panel
        title={`${active.length} connected`}
        actions={<Button variant="primary" size="compact" onClick={() => setConnecting(true)}><Smartphone /> Connect a phone</Button>}
      >
        {error && <ErrorText>{error}</ErrorText>}
        {phones && phones.length === 0 && (
          <EmptyState>No phones yet. Connect one and the waiter can take orders at the table.</EmptyState>
        )}
        {phones && phones.length > 0 && (
          <div className="data-list">
            {phones.map((p) => (
              <WaiterPhoneRow
                key={p.id}
                phone={p}
                busy={busyId === p.id}
                onRevoke={() => setRevoking(p)}
              />
            ))}
          </div>
        )}
      </Panel>

      {connecting && (
        <ConnectDialog
          locations={locations}
          onClose={() => {
            setConnecting(false)
            load()
          }}
        />
      )}

      {revoking && (
        <ConfirmDialog
          title={`Disconnect ${revoking.label || 'this phone'}?`}
          description={
            'The phone stops working right away and needs a new code to come back. '
            + 'Orders already sent stay on their tables. To remove a waiter who left, '
            + 'delete them in Team — their PIN stops working on every phone.'
          }
          confirmLabel="Disconnect"
          cancelLabel="Keep it"
          tone="danger"
          busy={busyId === revoking.id}
          onCancel={() => setRevoking(null)}
          onConfirm={async () => {
            const phone = revoking
            setRevoking(null)
            setBusyId(phone.id)
            setError('')
            try {
              await revokeWaiterPhone(phone.id)
              await load()
            } catch (e) {
              setError(phoneErrorText(e.message))
            } finally {
              setBusyId(null)
            }
          }}
        />
      )}
    </section>
  )
}
