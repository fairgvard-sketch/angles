import { useCallback, useEffect, useState } from 'react'
import {
  Check, ChevronDown, ChevronRight, Circle, Copy, ExternalLink, RefreshCw, Rocket,
} from 'lucide-react'
import {
  LAUNCH_STEPS, fetchLaunchChecklist, fetchPreviewToken, createTestBooking,
  launchErrorText,
} from './launch'
import { reserveUrl } from './online'
import { useCopy } from './qr-blocks'

/**
 * «Готовность к запуску» (Kassa 126).
 *
 * Раньше владелец включал приём тумблером — и всё. Есть ли столы, задано
 * ли расписание, написаны ли правила, получил ли он короткую ссылку — не
 * проверял никто, и тумблер честно открывал гостю страницу пустого зала.
 *
 * Блок исчезает сам, когда всё готово и приём включён: чеклист нужен
 * первую неделю, а не навсегда.
 *
 * Свёрнут по умолчанию: он стоит над КАЖДОЙ вкладкой броней и на
 * телефоне занимал весь первый экран — хостес пролистывал его каждый
 * раз, когда открывал таймлайн в час пик. Развёрнутое состояние
 * запоминается по точке.
 */

function Step({ step, onGo }) {
  const meta = LAUNCH_STEPS[step.key]
  if (!meta) return null
  return (
    <div className={`launch-step ${step.done ? 'is-done' : ''}`}>
      <span className="launch-mark">{step.done ? <Check /> : <Circle />}</span>
      <span className="launch-text">
        <strong>{meta.title}</strong>
        <small>{step.detail || meta.hint}</small>
      </span>
      {!step.done && meta.view && (
        <button type="button" className="text-button" onClick={() => onGo(meta.view)}>
          Open
        </button>
      )}
    </div>
  )
}

const OPEN_KEY = 'angle.launch.open'

function readOpen(locationId) {
  try {
    return window.localStorage.getItem(`${OPEN_KEY}.${locationId}`) === '1'
  } catch {
    return false
  }
}

export default function LaunchChecklist({ locationId, locationSlug, onGo }) {
  const [open, setOpen] = useState(() => readOpen(locationId))
  const [data, setData] = useState(null)
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  const previewUrl = preview
    ? `${reserveUrl(locationId, locationSlug)}${reserveUrl(locationId, locationSlug).includes('?') ? '&' : '?'}preview=${preview}`
    : ''
  const [copyState, copy] = useCopy(previewUrl)

  const reload = useCallback(async () => {
    if (!locationId) return
    try {
      setData(await fetchLaunchChecklist(locationId))
      setError('')
    } catch (e) {
      setError(launchErrorText(e.message))
    }
  }, [locationId])

  useEffect(() => { setData(null); setPreview(''); setNote(''); reload() }, [reload])
  useEffect(() => { setOpen(readOpen(locationId)) }, [locationId])

  function toggle() {
    setOpen((prev) => {
      const next = !prev
      try { window.localStorage.setItem(`${OPEN_KEY}.${locationId}`, next ? '1' : '0') } catch { /* приватный режим */ }
      return next
    })
  }

  async function openPreview() {
    setBusy(true)
    setError('')
    try {
      const token = await fetchPreviewToken(locationId)
      setPreview(token)
    } catch (e) {
      setError(launchErrorText(e.message))
    } finally {
      setBusy(false)
    }
  }

  async function testBooking() {
    setBusy(true)
    setError('')
    setNote('')
    try {
      const result = await createTestBooking(locationId)
      const at = new Date(result.reserved_at)
      setNote(`Test booking placed for ${at.toLocaleString('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short',
        hour: '2-digit', minute: '2-digit',
      })} — open the timeline to see it, then cancel it.`)
      await reload()
    } catch (e) {
      setError(launchErrorText(e.message))
    } finally {
      setBusy(false)
    }
  }

  if (!data) return null

  const steps = data.steps ?? []
  const done = steps.filter((s) => s.done).length
  // Всё сделано и приём включён — блок больше не нужен.
  if (data.accepting && done === steps.length) return null

  return (
    <section className={`panel launch-panel${open ? '' : ' is-collapsed'}`}>
      <div className="panel-heading">
        <button type="button" className="launch-toggle" aria-expanded={open} onClick={toggle}>
          {open ? <ChevronDown /> : <ChevronRight />}
          <span>
            <strong><Rocket /> Ready to launch</strong>
            <small>
              {done} of {steps.length} done
              {!data.accepting && ' · bookings are still paused'}
            </small>
          </span>
        </button>
        {open && (
          <button type="button" className="icon-button" onClick={reload} aria-label="Refresh checklist">
            <RefreshCw />
          </button>
        )}
      </div>

      {!open ? null : (
      <>
      <div className="launch-list">
        {steps.map((step) => <Step key={step.key} step={step} onGo={onGo} />)}
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {note && <p className="form-hint" role="status">{note}</p>}

      <div className="launch-actions">
        {previewUrl ? (
          <>
            <a className="secondary-button" href={previewUrl} target="_blank" rel="noreferrer">
              <ExternalLink /> Open preview
            </a>
            <button type="button" className="secondary-button" onClick={copy}>
              {copyState === 'copied' ? <><Check /> Copied</> : <><Copy /> Copy preview link</>}
            </button>
          </>
        ) : (
          <button type="button" className="secondary-button" onClick={openPreview} disabled={busy}>
            <ExternalLink /> Preview the guest page
          </button>
        )}
        <button type="button" className="secondary-button" onClick={testBooking} disabled={busy}>
          Make a test booking
        </button>
      </div>
      <p className="form-hint">
        The preview link works even while bookings are paused and is marked on the
        page — guests never get it. A test booking is real: it holds a table and shows
        on the timeline, but stays out of the reports.
      </p>
      </>
      )}
    </section>
  )
}
