import { useEffect, useState } from 'react'
import { Check, Download } from 'lucide-react'
import {
  fetchLocation, patchLocationSettings, updateLocationConfig, runUfExport,
} from './settings'
import { fetchCategories, updateCategory } from './menu'
import { agorotToInput, inputToAgorot } from './online'
import { PageHeader } from './ui/Layout'

/**
 * Настройки точки в бэкофисе — теперь единственное место, где правится
 * конфигурация уровня заведения (POS оставил себе только device-scoped:
 * печать, быстрые суммы, автоблокировку).
 *
 * Колонки locations (имя, режим, НДС, реквизиты чека, лояльность) идут
 * через update_location_config_web (Kassa 107) — касса печатает чек из
 * колонок receipt_*, поэтому запись в settings.receipt была бы потеряна.
 * JSONB-настройки (смена, интерфейс, содержимое чека) — через
 * patch_location_settings_web с server-side merge, шлём только изменённое.
 */

const TABS = [
  { key: 'general', label: 'General' },
  { key: 'receipt', label: 'Receipt & tax' },
  { key: 'loyalty', label: 'Loyalty' },
  { key: 'register', label: 'Register defaults' },
  { key: 'export', label: 'Fiscal export' },
]

const SERVICE_MODES = [
  { value: 'counter', label: 'Counter — orders at the till' },
  { value: 'counter_tables', label: 'Counter + tables' },
  { value: 'tables', label: 'Full table service' },
]

/** Названия типов документов Единого формата — всегда на иврите, как в документах. */
const DOC_TYPE_NAMES = {
  305: 'חשבונית מס',
  320: 'חשבונית מס/קבלה',
  330: 'חשבונית מס זיכוי',
  400: 'קבלה',
}

function Toggle({ label, hint, checked, onChange, disabled }) {
  return (
    <label className={`toggle-row${disabled ? ' is-disabled' : ''}`}>
      <span className="toggle-text">
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  )
}

function Field({ label, hint, children }) {
  return (
    <label className="qr-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}

function shekels(agorot) {
  return `₪${(agorot / 100).toLocaleString('he-IL', { minimumFractionDigits: 2 })}`
}

export default function LocationSettings({ context, locationId, tab: tabFromUrl, onTabChange }) {
  const locations = context?.locations || []
  const activeId = locationId || locations[0]?.id || null
  const tab = TABS.some((t) => t.key === tabFromUrl) ? tabFromUrl : 'general'
  const setTab = onTabChange
  const [location, setLocation] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!activeId) return undefined
    let cancelled = false
    setLoading(true)
    setError('')
    fetchLocation(activeId)
      .then((data) => { if (!cancelled) setLocation(data) })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [activeId])

  if (locations.length === 0) {
    return (
      <>
        <PageHeader title="Locations" />
        <p className="empty-state">No locations are linked to this account.</p>
      </>
    )
  }

  return (
    <>
      <PageHeader title="Locations" />

      <div className="location-tabs settings-topic-tabs" role="tablist" aria-label="Settings topic">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? 'is-active' : ''}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {loading || !location ? (
        <section className="panel form-panel"><p className="empty-state">Loading…</p></section>
      ) : (
        <>
          {tab === 'general' && <GeneralTab key={location.id} location={location} onSaved={setLocation} />}
          {tab === 'receipt' && <ReceiptTab key={location.id} location={location} onSaved={setLocation} />}
          {tab === 'loyalty' && <LoyaltyTab key={location.id} location={location} onSaved={setLocation} />}
          {tab === 'register' && <RegisterTab key={location.id} location={location} onSaved={setLocation} />}
          {tab === 'export' && <ExportTab key={location.id} location={location} />}
        </>
      )}
    </>
  )
}

/** Кнопка сохранения с индикатором — общий низ форм-табов. */
function SaveRow({ saving, saved, error }) {
  return (
    <div className="form-actions">
      {error && <p className="form-error" role="alert">{error}</p>}
      {saved && <span className="save-ok"><Check /> Saved</span>}
      <button className="primary-button narrow" type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  )
}

/** Обёртка «форма из колонок locations»: собирает diff и шлёт RPC. */
function useConfigForm(location, initial, onSaved) {
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setSaved(false)
  }

  async function save(patch, settingsPatch) {
    setSaving(true)
    setError('')
    try {
      if (patch && Object.keys(patch).length > 0) {
        await updateLocationConfig(location.id, patch)
      }
      let nextSettings = location.settings
      if (settingsPatch && Object.keys(settingsPatch).length > 0) {
        nextSettings = await patchLocationSettings(location.id, settingsPatch)
      }
      onSaved({ ...location, ...patch, settings: nextSettings })
      setSaved(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return { form, update, save, saving, saved, error }
}

// ── General: имя, витринное имя, режим обслуживания, НДС ─────
function GeneralTab({ location, onSaved }) {
  const { form, update, save, saving, saved, error } = useConfigForm(location, {
    name: location.name || '',
    display_name: location.settings?.display_name || '',
    service_mode: location.service_mode || 'counter',
    vat_rate: String(Number(location.vat_rate ?? 18)),
  }, onSaved)

  function submit(event) {
    event.preventDefault()
    const vat = Number(String(form.vat_rate).replace(',', '.'))
    if (!Number.isFinite(vat) || vat < 0 || vat > 50) return
    save(
      {
        name: form.name.trim() || location.name,
        service_mode: form.service_mode,
        vat_rate: vat,
      },
      { display_name: form.display_name.trim() || null },
    )
  }

  return (
    <section className="panel form-panel">
      <form onSubmit={submit} className="settings-form">
        <Field label="Location name" hint="Internal name in lists and reports.">
          <input value={form.name} onChange={(e) => update('name', e.target.value)} />
        </Field>
        <Field label="Display name" hint="Shown to guests on the public menu and ordering pages.">
          <input value={form.display_name} onChange={(e) => update('display_name', e.target.value)} />
        </Field>
        <Field label="Service mode" hint="Defines what the register shows: counter flow, tables or both.">
          <select value={form.service_mode} onChange={(e) => update('service_mode', e.target.value)}>
            {SERVICE_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </Field>
        <Field label="VAT rate (%)" hint="Applied to new orders on every register of this location.">
          <input
            inputMode="decimal"
            value={form.vat_rate}
            onChange={(e) => update('vat_rate', e.target.value)}
          />
        </Field>
        <SaveRow saving={saving} saved={saved} error={error} />
      </form>
    </section>
  )
}

// ── Receipt & tax: реквизиты хешбонита + содержимое чека ─────
function ReceiptTab({ location, onSaved }) {
  const { form, update, save, saving, saved, error } = useConfigForm(location, {
    receipt_business_name: location.receipt_business_name || '',
    receipt_tax_id: location.receipt_tax_id || '',
    receipt_address: location.receipt_address || '',
    receipt_phone: location.receipt_phone || '',
    receipt_footer: location.receipt_footer || '',
    print_modifiers: location.settings?.receipt?.print_modifiers ?? false,
    copies: location.settings?.receipt?.copies ?? 1,
  }, onSaved)

  function submit(event) {
    event.preventDefault()
    save(
      {
        receipt_business_name: form.receipt_business_name.trim(),
        receipt_tax_id: form.receipt_tax_id.trim(),
        receipt_address: form.receipt_address.trim(),
        receipt_phone: form.receipt_phone.trim(),
        receipt_footer: form.receipt_footer.trim(),
      },
      { receipt: { print_modifiers: form.print_modifiers, copies: form.copies } },
    )
  }

  return (
    <section className="panel form-panel">
      <form onSubmit={submit} className="settings-form">
        <Field label="Business name (on receipt)" hint="Header of the printed receipt (חשבונית).">
          <input value={form.receipt_business_name} onChange={(e) => update('receipt_business_name', e.target.value)} />
        </Field>
        <Field label="Tax ID (ח.פ / עוסק מורשה)" hint="Required for the fiscal export.">
          <input value={form.receipt_tax_id} inputMode="numeric" onChange={(e) => update('receipt_tax_id', e.target.value)} />
        </Field>
        <Field label="Business address">
          <input value={form.receipt_address} onChange={(e) => update('receipt_address', e.target.value)} />
        </Field>
        <Field label="Phone">
          <input value={form.receipt_phone} onChange={(e) => update('receipt_phone', e.target.value)} />
        </Field>
        <Field label="Receipt footer" hint="Free text at the bottom of every receipt.">
          <input value={form.receipt_footer} onChange={(e) => update('receipt_footer', e.target.value)} />
        </Field>

        <Toggle
          label="Print modifiers"
          hint="Show each item's modifiers on the receipt."
          checked={form.print_modifiers}
          onChange={(v) => update('print_modifiers', v)}
        />
        <Field label="Receipt copies">
          <select value={form.copies} onChange={(e) => update('copies', Number(e.target.value))}>
            <option value={1}>1</option>
            <option value={2}>2</option>
          </select>
        </Field>
        <SaveRow saving={saving} saved={saved} error={error} />
      </form>
    </section>
  )
}

// ── Loyalty: механика + штампуемые категории ─────────────────
function LoyaltyTab({ location, onSaved }) {
  const { form, update, save, saving, saved, error } = useConfigForm(location, {
    loyalty_mode: location.loyalty_mode || 'off',
    loyalty_stamps_goal: String(location.loyalty_stamps_goal ?? 10),
    loyalty_points_percent: String(Number(location.loyalty_points_percent ?? 5)),
    loyalty_points_min_redeem: agorotToInput(location.loyalty_points_min_redeem ?? 1000),
  }, onSaved)

  const [categories, setCategories] = useState(null)
  const [catError, setCatError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchCategories()
      .then((rows) => {
        if (cancelled) return
        setCategories(rows.filter((c) => c.location_id === location.id && c.is_active))
      })
      .catch((e) => { if (!cancelled) setCatError(e.message) })
    return () => { cancelled = true }
  }, [location.id])

  async function toggleStamps(category) {
    try {
      await updateCategory(category.id, { loyalty_stamps: !category.loyalty_stamps })
      setCategories((prev) => prev.map((c) => (
        c.id === category.id ? { ...c, loyalty_stamps: !c.loyalty_stamps } : c
      )))
    } catch (e) {
      setCatError(e.message)
    }
  }

  function submit(event) {
    event.preventDefault()
    const goal = parseInt(form.loyalty_stamps_goal, 10)
    const percent = Number(String(form.loyalty_points_percent).replace(',', '.'))
    const minRedeem = inputToAgorot(form.loyalty_points_min_redeem)
    if (form.loyalty_mode === 'stamps' && (!Number.isInteger(goal) || goal < 2 || goal > 50)) return
    if (form.loyalty_mode === 'points' &&
        (!Number.isFinite(percent) || percent < 0 || percent > 50 || minRedeem === null)) return
    save({
      loyalty_mode: form.loyalty_mode,
      loyalty_stamps_goal: Number.isInteger(goal) ? goal : 10,
      loyalty_points_percent: Number.isFinite(percent) ? percent : 5,
      loyalty_points_min_redeem: minRedeem ?? 1000,
    })
  }

  return (
    <section className="panel form-panel">
      <form onSubmit={submit} className="settings-form">
        <Field label="Loyalty program" hint="Stamps — free item after N purchases; points — cashback in ₪.">
          <select value={form.loyalty_mode} onChange={(e) => update('loyalty_mode', e.target.value)}>
            <option value="off">Off</option>
            <option value="stamps">Stamps</option>
            <option value="points">Points</option>
          </select>
        </Field>

        {form.loyalty_mode === 'stamps' && (
          <>
            <Field label="Stamps to reward" hint="How many stamped purchases earn a free item (2–50).">
              <input
                inputMode="numeric"
                value={form.loyalty_stamps_goal}
                onChange={(e) => update('loyalty_stamps_goal', e.target.value)}
              />
            </Field>
            <div className="qr-field">
              <span>Categories that earn stamps</span>
              {categories === null ? (
                <small>Loading…</small>
              ) : categories.length === 0 ? (
                <small>No active categories in this location yet.</small>
              ) : (
                categories.map((c) => (
                  <Toggle
                    key={c.id}
                    label={c.name}
                    checked={Boolean(c.loyalty_stamps)}
                    onChange={() => toggleStamps(c)}
                  />
                ))
              )}
              {catError && <p className="form-error" role="alert">{catError}</p>}
            </div>
          </>
        )}

        {form.loyalty_mode === 'points' && (
          <>
            <Field label="Cashback (%)" hint="Share of each purchase returned as points (0–50).">
              <input
                inputMode="decimal"
                value={form.loyalty_points_percent}
                onChange={(e) => update('loyalty_points_percent', e.target.value)}
              />
            </Field>
            <Field label="Minimum to redeem (₪)">
              <input
                inputMode="decimal"
                value={form.loyalty_points_min_redeem}
                onChange={(e) => update('loyalty_points_min_redeem', e.target.value)}
              />
            </Field>
          </>
        )}

        <SaveRow saving={saving} saved={saved} error={error} />
      </form>
    </section>
  )
}

// ── Register defaults: смена и видимость элементов POS ───────
function RegisterTab({ location, onSaved }) {
  const shift = location.settings?.shift || {}
  const ui = location.settings?.interface || {}
  const { form, update, save, saving, saved, error } = useConfigForm(location, {
    default_opening_float: agorotToInput(shift.default_opening_float ?? 0),
    close_reminder: shift.close_reminder || '',
    day_cutoff: shift.day_cutoff || '',
    cash_warn_threshold: agorotToInput(shift.cash_warn_threshold ?? 0),
    show_all_items_tab: ui.show_all_items_tab !== false,
    inventory_enabled: ui.inventory_enabled !== false,
  }, onSaved)

  function submit(event) {
    event.preventDefault()
    const float = inputToAgorot(form.default_opening_float)
    const warn = inputToAgorot(form.cash_warn_threshold)
    if (float === null || warn === null) return
    save(null, {
      shift: {
        default_opening_float: float || null,
        close_reminder: form.close_reminder || null,
        day_cutoff: form.day_cutoff || null,
        cash_warn_threshold: warn || null,
      },
      interface: {
        show_all_items_tab: form.show_all_items_tab,
        inventory_enabled: form.inventory_enabled,
      },
    })
  }

  return (
    <section className="panel form-panel">
      <form onSubmit={submit} className="settings-form">
        <Field label="Default opening float (₪)" hint="Suggested cash amount when a shift opens. Empty — off.">
          <input
            inputMode="decimal"
            value={form.default_opening_float}
            onChange={(e) => update('default_opening_float', e.target.value)}
          />
        </Field>
        <Field label="Close-shift reminder" hint="The register nudges staff at this time. Empty — off.">
          <input type="time" value={form.close_reminder} onChange={(e) => update('close_reminder', e.target.value)} />
        </Field>
        <Field label="Business day cutoff" hint="Shifts crossing this hour count as overdue. Empty — 04:00.">
          <input type="time" value={form.day_cutoff} onChange={(e) => update('day_cutoff', e.target.value)} />
        </Field>
        <Field label="Cash warning threshold (₪)" hint="Warn when the drawer holds more cash than this. Empty — off.">
          <input
            inputMode="decimal"
            value={form.cash_warn_threshold}
            onChange={(e) => update('cash_warn_threshold', e.target.value)}
          />
        </Field>

        <Toggle
          label="“All items” tab"
          hint="Show the combined tab before categories on the sell screen."
          checked={form.show_all_items_tab}
          onChange={(v) => update('show_all_items_tab', v)}
        />
        <Toggle
          label="Inventory"
          hint="Show the stock section on registers of this location."
          checked={form.inventory_enabled}
          onChange={(v) => update('inventory_enabled', v)}
        />
        <SaveRow saving={saving} saved={saved} error={error} />
      </form>
    </section>
  )
}

// ── Fiscal export: Единый формат 1.31 ────────────────────────
/** Прошлый календарный месяц — типовой отчётный период по умолчанию. */
function previousMonthRange() {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const last = new Date(now.getFullYear(), now.getMonth(), 0)
  const iso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { from: iso(first), to: iso(last) }
}

function downloadBase64(filename, base64, mime) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function ExportTab({ location }) {
  const defaults = previousMonthRange()
  const [from, setFrom] = useState(defaults.from)
  const [to, setTo] = useState(defaults.to)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  async function generate() {
    setBusy(true)
    setError('')
    setResult(null)
    try {
      setResult(await runUfExport(location.id, from, to))
    } catch (e) {
      setError(e.message === 'missing_tax_id'
        ? 'Tax ID is missing — fill it in on the Receipt & tax tab first.'
        : 'Export failed. Try again or narrow the period.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel form-panel">
      <div className="settings-form">
        <p className="hint">
          Uniform Format 1.31 (מבנה אחיד) for the Israeli Tax Authority: INI.TXT and
          BKMVDATA.zip for the selected period, generated server-side from fiscal documents.
        </p>
        <Field label="From">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <div className="form-actions">
          {error && <p className="form-error" role="alert">{error}</p>}
          <button
            type="button"
            className="primary-button narrow"
            disabled={busy || !from || !to || from > to}
            onClick={generate}
          >
            {busy ? 'Generating…' : 'Generate export'}
          </button>
        </div>

        {result && (
          <>
            <div className="form-actions export-downloads">
              <button
                type="button"
                className="secondary-button"
                onClick={() => downloadBase64('INI.TXT', result.ini_base64, 'text/plain')}
              >
                <Download /> INI.TXT
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => downloadBase64('BKMVDATA.zip', result.bkmvdata_zip_base64, 'application/zip')}
              >
                <Download /> BKMVDATA.zip
              </button>
              <span className="hint">
                Records: {result.total_records} · {result.range?.from} — {result.range?.to}
              </span>
            </div>

            <table className="export-report">
              <thead>
                <tr><th>Document type</th><th>Count</th><th>Total inc. VAT</th></tr>
              </thead>
              <tbody>
                {result.control_report.map((row) => (
                  <tr key={row.docTypeCode}>
                    <td>{row.docTypeCode} · {DOC_TYPE_NAMES[row.docTypeCode] ?? ''}</td>
                    <td>{row.count}</td>
                    <td>{shekels(row.totalIncVat)}</td>
                  </tr>
                ))}
                {result.control_report.length === 0 && (
                  <tr><td colSpan={3}>No fiscal documents in this period.</td></tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </div>
    </section>
  )
}
