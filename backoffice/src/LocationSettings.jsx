import { useEffect, useState } from 'react'
import { Check, Store } from 'lucide-react'
import { fetchLocation, patchLocationSettings } from './settings'

/**
 * Настройки точки в бэкофисе. Первый пишущий экран (091): владелец выбирает
 * точку, правит реквизиты чека, НДС и часовой пояс. Пишем только изменённые
 * поля — сервер мержит остальное. Это обкатка модели записи перед меню.
 */

function useLocations(context) {
  return context?.locations || []
}

export default function LocationSettings({ context }) {
  const locations = useLocations(context)
  const [activeId, setActiveId] = useState(locations[0]?.id || null)
  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!activeId) return
    let cancelled = false
    setLoading(true)
    setError('')
    setSaved(false)
    fetchLocation(activeId)
      .then((data) => {
        if (cancelled) return
        const s = data.settings || {}
        setForm({
          business_name: s.receipt?.business_name || '',
          business_address: s.receipt?.business_address || '',
          tax_id: s.receipt?.tax_id || '',
          vat_rate: data.vat_rate ?? '',
          timezone: data.timezone || 'Asia/Jerusalem',
        })
      })
      .catch((loadError) => { if (!cancelled) setError(loadError.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [activeId])

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setSaved(false)
  }

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      // Только раздел receipt мержится сервером — vat/timezone здесь не трогаем
      // (это колонки locations, отдельный поток; в этом экране — реквизиты чека).
      await patchLocationSettings(activeId, {
        receipt: {
          business_name: form.business_name.trim(),
          business_address: form.business_address.trim(),
          tax_id: form.tax_id.trim(),
        },
      })
      setSaved(true)
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  if (locations.length === 0) {
    return (
      <>
        <section className="page-heading compact-heading">
          <p className="eyebrow">{context.organization?.name}</p>
          <h1>Settings</h1>
        </section>
        <p className="empty-state">No locations are linked to this account.</p>
      </>
    )
  }

  return (
    <>
      <section className="page-heading compact-heading">
        <p className="eyebrow">{context.organization?.name}</p>
        <h1>Settings</h1>
        <p>Receipt details for each location, shared with every connected register.</p>
      </section>

      {locations.length > 1 && (
        <div className="location-tabs" role="tablist" aria-label="Location">
          {locations.map((loc) => (
            <button
              key={loc.id}
              type="button"
              role="tab"
              aria-selected={loc.id === activeId}
              className={loc.id === activeId ? 'is-active' : ''}
              onClick={() => setActiveId(loc.id)}
            >
              <Store /> {loc.name}
            </button>
          ))}
        </div>
      )}

      <section className="panel form-panel">
        {loading || !form ? (
          <p className="empty-state">Loading…</p>
        ) : (
          <form onSubmit={submit} className="settings-form">
            <label>
              <span>Business name (on receipt)</span>
              <input value={form.business_name} onChange={(e) => update('business_name', e.target.value)} />
            </label>
            <label>
              <span>Business address</span>
              <input value={form.business_address} onChange={(e) => update('business_address', e.target.value)} />
            </label>
            <label>
              <span>Tax ID</span>
              <input value={form.tax_id} onChange={(e) => update('tax_id', e.target.value)} inputMode="numeric" />
            </label>

            <div className="form-readonly">
              <div><span>VAT rate</span><strong>{form.vat_rate}%</strong></div>
              <div><span>Timezone</span><strong>{form.timezone}</strong></div>
            </div>

            {error && <p className="form-error" role="alert">{error}</p>}

            <div className="form-actions">
              {saved && <span className="save-ok"><Check /> Saved</span>}
              <button className="primary-button narrow" type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        )}
      </section>
    </>
  )
}
