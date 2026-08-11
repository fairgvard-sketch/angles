import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import {
  fetchLocation, patchLocationSettings, updateLocationConfig,
} from './settings'
import { agorotToInput, inputToAgorot } from './online'
import { visibleLocationTabs } from './navigation'
import { ErrorText, PageHeader } from './ui/Layout'
import ConfirmDialog from './ui/ConfirmDialog'
import Tabs from './ui/Tabs'
import Skeleton, { SkeletonBar, SkeletonPanel } from './ui/Skeleton'

/**
 * Настройки ОДНОЙ точки: как она называется, что печатает на чеке и с
 * какими умолчаниями работают её кассы.
 *
 * Раздел перестал быть складом всего, у чего есть `location_id`. Отсюда
 * ушли программа лояльности (вопрос про клиентов — `LoyaltySettings` в
 * Customers) и фискальная выгрузка (не настройка, а отчёт —
 * `FiscalExport` в Reports). Прежние ссылки на них продолжают работать:
 * их переводит `canonicalRoute` в routing.js.
 *
 * Колонки locations (имя, режим, НДС, реквизиты чека) идут через
 * update_location_config_web (Kassa 107) — касса печатает чек из колонок
 * receipt_*, поэтому запись в settings.receipt была бы потеряна.
 * JSONB-настройки (смена, интерфейс, содержимое чека) — через
 * patch_location_settings_web с server-side merge, шлём только изменённое.
 */

const SERVICE_MODES = [
  { value: 'counter', label: 'Counter — orders at the till' },
  { value: 'counter_tables', label: 'Counter + tables' },
  { value: 'tables', label: 'Full table service' },
]

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

function LocationPanelHeading({ title, description }) {
  return (
    <div className="location-settings-panel-heading">
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  )
}

export default function LocationSettings({
  context, locationId, tab: tabFromUrl, onTabChange, onLocationChange,
}) {
  const locations = context?.locations || []
  const activeId = locationId || locations[0]?.id || null
  /*
   * Вкладки — по продуктам аккаунта (см. navigation.js). Ссылка на скрытую
   * вкладку (закладка владельца, у которого кассу отключили) ведёт на
   * Details, а не на пустой экран.
   */
  const tabs = visibleLocationTabs(context)
  const tab = tabs.some((t) => t.key === tabFromUrl) ? tabFromUrl : 'details'
  const setTab = onTabChange
  const [location, setLocation] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  /*
   * Несохранённые правки. Раньше переключение вкладки просто
   * размонтировало форму — набранные реквизиты чека исчезали молча, и
   * узнать об этом можно было только по тому, что на чеке их нет.
   */
  const [dirty, setDirty] = useState(false)
  const [pendingTab, setPendingTab] = useState(null)
  const [pendingLocation, setPendingLocation] = useState(null)

  // Закрытие вкладки браузера — тот же случай, только чинить некому
  useEffect(() => {
    if (!dirty) return undefined
    function onBeforeUnload(event) {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  function askTab(next) {
    if (!dirty || next === tab) { setTab(next); return }
    setPendingTab(next)
  }

  function askLocation(next) {
    if (!next || next === activeId) return
    if (!dirty) { onLocationChange?.(next); return }
    setPendingLocation(next)
  }

  function discardAndLeave() {
    setDirty(false)
    if (pendingTab) setTab(pendingTab)
    if (pendingLocation) onLocationChange?.(pendingLocation)
    setPendingTab(null)
    setPendingLocation(null)
  }

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

      <label className="qr-field location-settings-picker">
        <span>Location</span>
        <select value={activeId || ''} onChange={(event) => askLocation(event.target.value)}>
          {locations.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </label>

      {/* Полоса тем — на общий примитив: до него все пять кнопок были
          отдельными остановками Tab, а стрелки не двигали ничего, хотя
          `role="tablist"` обещал читалке ровно обратное. Одна вкладка —
          полосы нет: выбор из самого себя ничего не выбирает. */}
      {tabs.length > 1 && (
        <Tabs
          className="location-tabs settings-topic-tabs location-settings-tabs"
          label="Settings topic"
          items={tabs.map((t) => ({ key: t.key, label: t.label }))}
          value={tab}
          onChange={askTab}
        />
      )}

      {/*
        Область действия. У сети настройки точек не общие, и владелец
        должен видеть это до того, как поменяет НДС «для всех».
      */}
      <p className="settings-scope">
        Applies to <strong>{location?.name || locations.find((l) => l.id === activeId)?.name}</strong>
        {locations.length > 1 ? ' only. Other locations are configured separately.' : ' only.'}
      </p>

      {error && <ErrorText>{error}</ErrorText>}

      {(pendingTab || pendingLocation) && (
        <ConfirmDialog
          title="Leave without saving?"
          description="The changes on this tab are not saved yet. Leaving loses them."
          confirmLabel="Discard changes"
          cancelLabel="Keep editing"
          tone="danger"
          onCancel={() => { setPendingTab(null); setPendingLocation(null) }}
          onConfirm={discardAndLeave}
        />
      )}

      {loading || !location ? (
        /* Форма настроек: пары «подпись — поле» и кнопка сохранения. */
        <Skeleton label="Loading the location settings…">
          <SkeletonPanel height={430}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div className="sk-row" key={i} style={{ height: 66, padding: 0, border: 0, display: 'grid', gap: 8 }}>
                <SkeletonBar width="18%" height={11} />
                <SkeletonBar width="100%" height={38} radius="var(--r-md)" />
              </div>
            ))}
            <SkeletonBar width="132px" height={40} radius="var(--r-md)" />
          </SkeletonPanel>
        </Skeleton>
      ) : (
        <>
          {tab === 'details' && <DetailsTab key={location.id} location={location} onSaved={setLocation} onDirty={setDirty} />}
          {tab === 'receipts' && <ReceiptsTab key={location.id} location={location} onSaved={setLocation} onDirty={setDirty} />}
          {tab === 'pos' && <PosDefaultsTab key={location.id} location={location} onSaved={setLocation} onDirty={setDirty} />}
        </>
      )}
    </>
  )
}

/** Кнопка сохранения с индикатором — общий низ форм-табов. */
function SaveRow({ saving, saved, error }) {
  return (
    <div className="form-actions">
      {error && <ErrorText>{error}</ErrorText>}
      {/* role="status" — иначе подтверждение сохранения видно только
          глазами: читалка молчит, и владелец с ней не знает, ушли
          правки на сервер или нет. */}
      {saved && <span className="save-ok" role="status"><Check aria-hidden /> Saved</span>}
      <button className="primary-button narrow location-save-button" type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  )
}

/** Обёртка «форма из колонок locations»: собирает diff и шлёт RPC. */
function useConfigForm(location, initial, onSaved, onDirty) {
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  /*
   * Несохранённое считается сравнением с исходным, а не флагом «трогали»:
   * вернул значение обратно — терять уже нечего, и предупреждать не о чем.
   */
  const dirty = Object.keys(initial).some((key) => String(form[key] ?? '') !== String(initial[key] ?? ''))
  useEffect(() => { onDirty?.(dirty) }, [dirty, onDirty])
  useEffect(() => () => onDirty?.(false), [onDirty])

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
      onDirty?.(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return { form, update, save, saving, saved, error, dirty }
}

// ── Details: имя, витринное имя, режим обслуживания, НДС ─────
function DetailsTab({ location, onSaved, onDirty }) {
  const { form, update, save, saving, saved, error } = useConfigForm(location, {
    name: location.name || '',
    display_name: location.settings?.display_name || '',
    service_mode: location.service_mode || 'counter',
    vat_rate: String(Number(location.vat_rate ?? 18)),
  }, onSaved, onDirty)

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
    <section className="panel form-panel location-settings-panel">
      <LocationPanelHeading
        title="Location details"
        description="Identity and operating defaults for this location."
      />
      <form onSubmit={submit} className="settings-form location-details-form">
        <div className="location-details-grid">
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
        </div>

        <dl className="settings-facts location-details-facts">
          <div>
            <dt>Currency</dt>
            <dd>{location.currency || '—'}</dd>
          </div>
          <div>
            <dt>Time zone</dt>
            <dd>{location.timezone || '—'}</dd>
          </div>
        </dl>
        <p className="form-hint location-settings-lock">
          Currency and time zone are set when the location is created — ask your
          ANGLE contact to change them.
        </p>
        <SaveRow saving={saving} saved={saved} error={error} />
      </form>
    </section>
  )
}

/**
 * ── Receipts & tax ───────────────────────────────────────────
 *
 * Две разные вещи в одной вкладке, и их надо различать глазом: слева от
 * закона — кто выпускает документ (название, ח.פ, адрес), справа от
 * закона — как он выглядит (телефон, подпись, модификаторы, копии).
 * Раньше все семь полей стояли одним списком, и «Receipt footer» читался
 * так же весомо, как налоговый номер.
 *
 * Про неизменность выпущенных документов здесь НЕ обещается ничего.
 * Проверено (docs/locations-settings-audit-phase0.md): чек и выгрузка
 * מבנה אחיד читают эти колонки живыми, в момент печати и экспорта, а не
 * из слепка документа. Значит правка задним числом меняет и уже
 * выпущенное — и владелец обязан узнать это здесь, а не от бухгалтера.
 */
function ReceiptsTab({ location, onSaved, onDirty }) {
  const { form, update, save, saving, saved, error } = useConfigForm(location, {
    receipt_business_name: location.receipt_business_name || '',
    receipt_tax_id: location.receipt_tax_id || '',
    receipt_address: location.receipt_address || '',
    receipt_phone: location.receipt_phone || '',
    receipt_footer: location.receipt_footer || '',
    print_modifiers: location.settings?.receipt?.print_modifiers ?? false,
    copies: location.settings?.receipt?.copies ?? 1,
  }, onSaved, onDirty)

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
    <section className="panel form-panel location-settings-panel">
      <LocationPanelHeading
        title="Receipts & tax"
        description="Legal identity and receipt appearance for this location."
      />
      <form onSubmit={submit} className="settings-form">
        <fieldset className="settings-group">
          <legend>Legal details</legend>
          <div className="settings-group-body">
            <p className="form-hint">
              Who issues the document. These values are printed on every
              חשבונית and are used for the Uniform Format export.
            </p>
            {/*
              Предупреждение стоит рядом с полями, а не в конце формы:
              читают его перед правкой, а не после сохранения. Формулировка
              описывает то, что код делает сегодня, — без обещаний.
            */}
            {/*
              Обещание, которое теперь ПРАВДА: документ запоминает эмитента
              в момент выпуска (Kassa 150), печать и выгрузка читают слепок
              (Kassa 151). До этого здесь стояло предупреждение об обратном.
            */}
            <p className="form-hint">
              Changes apply to future documents only. Receipts and tax exports
              already issued keep the details they were issued with.
            </p>
            <Field label="Business name (on receipt)" hint="Header of the printed receipt (חשבונית).">
              <input value={form.receipt_business_name} onChange={(e) => update('receipt_business_name', e.target.value)} />
            </Field>
            <Field label="Tax ID (ח.פ / עוסק מורשה)" hint="Required for the fiscal export.">
              <input value={form.receipt_tax_id} inputMode="numeric" onChange={(e) => update('receipt_tax_id', e.target.value)} />
            </Field>
            <Field label="Business address" hint="The registered address printed on the document.">
              <input value={form.receipt_address} onChange={(e) => update('receipt_address', e.target.value)} />
            </Field>
          </div>
        </fieldset>

        <fieldset className="settings-group">
          <legend>Receipt appearance and contact</legend>
          <div className="settings-group-body">
            <p className="form-hint">
              How the receipt looks. Nothing here affects the tax figures.
            </p>
            <Field label="Phone" hint="Public number guests can call about an order.">
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
          </div>
        </fieldset>

        <SaveRow saving={saving} saved={saved} error={error} />
      </form>
    </section>
  )
}

/**
 * ── POS defaults ─────────────────────────────────────────────
 *
 * Умолчания смены и видимость элементов на кассах ЭТОЙ точки. Не путать с
 * настройками терминала: принтер, ширина ленты, быстрые суммы, экран
 * клиента и автоблокировка живут на самой кассе (Kassa 107) — они разные
 * у двух аппаратов одной стойки, и место им не здесь.
 */
function PosDefaultsTab({ location, onSaved, onDirty }) {
  const shift = location.settings?.shift || {}
  const ui = location.settings?.interface || {}
  const { form, update, save, saving, saved, error } = useConfigForm(location, {
    default_opening_float: agorotToInput(shift.default_opening_float ?? 0),
    close_reminder: shift.close_reminder || '',
    day_cutoff: shift.day_cutoff || '',
    cash_warn_threshold: agorotToInput(shift.cash_warn_threshold ?? 0),
    show_all_items_tab: ui.show_all_items_tab !== false,
    inventory_enabled: ui.inventory_enabled !== false,
  }, onSaved, onDirty)

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
    <section className="panel form-panel location-settings-panel">
      <LocationPanelHeading
        title="POS defaults"
        description="Shift and register defaults shared by this location."
      />
      <form onSubmit={submit} className="settings-form">
        <p className="form-hint">
          Applies to every register at this location. Printer, receipt width,
          quick amounts and auto-lock are set on each terminal itself.
        </p>
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
