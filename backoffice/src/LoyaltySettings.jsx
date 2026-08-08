import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { fetchLocation, updateLocationConfig } from './settings'
import { fetchCategories, updateCategory } from './menu'
import { agorotToInput, inputToAgorot } from './online'
import { ErrorText } from './ui/Layout'
import Skeleton, { SkeletonBar, SkeletonPanel } from './ui/Skeleton'

/**
 * Программа лояльности — вкладка Customers, а не настройка точки.
 *
 * Переехала из Locations без единой правки в хранении и на сервере: те же
 * колонки `locations.loyalty_*` через `update_location_config_web`, те же
 * `menu_categories.loyalty_stamps` для штампуемых категорий. Начисление и
 * списание по-прежнему делает только касса (Kassa 046/113).
 *
 * Почему здесь: владелец настраивает программу, думая про клиентов, а не
 * про заведение, и приходит за ней из базы клиентов. В настройках точки
 * она стояла между реквизитами чека и порогом наличных.
 *
 * ВАЖНО про скоуп. Правила программы хранятся НА ТОЧКЕ, а балансы гостей —
 * на организации. Значит единой организационной программы сегодня нет, и
 * называть её так нельзя: раздел обязан показывать, какая точка настраивается,
 * и предупреждать, когда у точек сети разные режимы. Организационная
 * программа с переопределениями — предмет отдельного релиза со схемой.
 */

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

/** Форма программы одной точки. Ключ по точке пересоздаёт её при переключении. */
function LoyaltyForm({ location, onSaved, onDirty }) {
  const initial = {
    loyalty_mode: location.loyalty_mode || 'off',
    loyalty_stamps_goal: String(location.loyalty_stamps_goal ?? 10),
    loyalty_points_percent: String(Number(location.loyalty_points_percent ?? 5)),
    loyalty_points_min_redeem: agorotToInput(location.loyalty_points_min_redeem ?? 1000),
  }
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [categories, setCategories] = useState(null)
  const [catError, setCatError] = useState('')

  /*
   * Несохранённое считается сравнением с исходным, а не флагом «трогали»:
   * вернул значение обратно — терять уже нечего, и предупреждать не о чем.
   */
  const dirty = Object.keys(initial).some(
    (key) => String(form[key] ?? '') !== String(initial[key] ?? ''),
  )
  useEffect(() => { onDirty?.(dirty) }, [dirty, onDirty])
  useEffect(() => () => onDirty?.(false), [onDirty])

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setSaved(false)
  }

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

  async function submit(event) {
    event.preventDefault()
    const goal = parseInt(form.loyalty_stamps_goal, 10)
    const percent = Number(String(form.loyalty_points_percent).replace(',', '.'))
    const minRedeem = inputToAgorot(form.loyalty_points_min_redeem)
    if (form.loyalty_mode === 'stamps' && (!Number.isInteger(goal) || goal < 2 || goal > 50)) return
    if (form.loyalty_mode === 'points' &&
        (!Number.isFinite(percent) || percent < 0 || percent > 50 || minRedeem === null)) return
    const patch = {
      loyalty_mode: form.loyalty_mode,
      loyalty_stamps_goal: Number.isInteger(goal) ? goal : 10,
      loyalty_points_percent: Number.isFinite(percent) ? percent : 5,
      loyalty_points_min_redeem: minRedeem ?? 1000,
    }
    setSaving(true)
    setError('')
    try {
      await updateLocationConfig(location.id, patch)
      onSaved({ ...location, ...patch })
      setSaved(true)
      onDirty?.(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
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
              {catError && <ErrorText>{catError}</ErrorText>}
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

        <div className="form-actions">
          {error && <ErrorText>{error}</ErrorText>}
          {/* role="status" — иначе подтверждение сохранения видно только
              глазами: читалка молчит, и владелец с ней не знает, ушли
              правки на сервер или нет. */}
          {saved && <span className="save-ok" role="status"><Check aria-hidden /> Saved</span>}
          <button className="primary-button narrow" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </section>
  )
}

export default function LoyaltySettings({ locations = [], locationId, onLocationChange, onDirty }) {
  const activeId = locationId || locations[0]?.id || null
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
    return <p className="empty-state">No locations are linked to this account.</p>
  }

  const activeName = location?.name || locations.find((l) => l.id === activeId)?.name

  return (
    <>
      {/*
        Скоуп программы — первое, что видно, и он честный: правила лежат
        на точке, а не на организации. У сети это означает, что «включил
        баллы» относится к одной точке, и владелец обязан узнать это до
        сохранения, а не после звонка из второй кофейни.
      */}
      {locations.length > 1 ? (
        <div className="settings-scope loyalty-scope">
          <label className="qr-field loyalty-scope-picker">
            <span>Location</span>
            <select value={activeId ?? ''} onChange={(e) => onLocationChange?.(e.target.value)}>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <p>
            Applies to <strong>{activeName}</strong> only — every location runs its own
            programme and is set up separately. Customer balances are shared across the
            organisation.
          </p>
        </div>
      ) : (
        <p className="settings-scope">
          Applies to <strong>{activeName}</strong>. Earning and redeeming happen at the
          register; the back office only sets the rules.
        </p>
      )}

      {error && <ErrorText>{error}</ErrorText>}

      {loading || !location ? (
        <Skeleton label="Loading the loyalty settings…">
          <SkeletonPanel height={260}>
            {[0, 1, 2].map((i) => (
              <div className="sk-row" key={i} style={{ height: 66, padding: 0, border: 0, display: 'grid', gap: 8 }}>
                <SkeletonBar width="18%" height={11} />
                <SkeletonBar width="100%" height={38} radius="var(--r-md)" />
              </div>
            ))}
            <SkeletonBar width="132px" height={40} radius="var(--r-md)" />
          </SkeletonPanel>
        </Skeleton>
      ) : (
        <LoyaltyForm key={location.id} location={location} onSaved={setLocation} onDirty={onDirty} />
      )}
    </>
  )
}
