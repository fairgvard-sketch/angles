import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Store } from 'lucide-react'
import QRCode from 'qrcode'
import { fetchLocation } from './settings'
import {
  ORDER_TYPES, ORDER_TYPE_LABELS,
  ONLINE_BACKGROUND_PRESETS,
  onlineEnabled, orderTypes, toggleOrderType, saveOnlineOrders,
  reservationsEnabled, saveReservations,
  orderUrl, reserveUrl,
  agorotToInput, inputToAgorot,
} from './online'

/**
 * QR-каналы гостя: онлайн-заказы и бронирование столов.
 *
 * Паритет с кассовыми разделами Настройки → Обслуживание, но БЕЗ печати:
 * QR здесь только показывается на экране — флаер печатается на 80мм принтере
 * кассы, у веб-кабинета такого принтера нет.
 *
 * Ссылка ведёт на домен КАССЫ, не на кабинет (см. online.js): публичные
 * страницы /order и /reserve обслуживает POS-приложение.
 */

const TABS = [
  { key: 'online', label: 'Online orders' },
  { key: 'reserve', label: 'Reservations' },
]

/** QR + ссылка с копированием. Только просмотр — печать остаётся в кассе. */
function LinkBlock({ url, hint }) {
  const canvasRef = useRef(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (canvasRef.current && url) {
      QRCode.toCanvas(canvasRef.current, url, { width: 176, margin: 1 }).catch(() => {})
    }
  }, [url])

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Копирование не критично — ссылку видно и можно выделить руками
    }
  }

  return (
    <div className="qr-block">
      <div className="qr-block-text">
        <h3>Guest link</h3>
        <p>{hint}</p>
        <div className="qr-link-row">
          <input value={url} readOnly onFocus={(e) => e.target.select()} />
          <button type="button" className="secondary-button narrow" onClick={copy}>
            {copied ? <><Check /> Copied</> : <><Copy /> Copy</>}
          </button>
        </div>
      </div>
      <canvas ref={canvasRef} className="qr-canvas" aria-label="QR code for the guest link" />
    </div>
  )
}

/** Тумблер в стиле кассового ToggleRow. */
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

function Field({ label, children }) {
  return (
    <label className="qr-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function NumberSelect({ value, fallback, options, onChange }) {
  return (
    <select value={value ?? fallback} onChange={(e) => onChange(Number(e.target.value))}>
      {options.map((n) => <option key={n} value={n}>{n}</option>)}
    </select>
  )
}

function BackgroundPresets({ value, onChange }) {
  const normalizedValue = value || null
  const activePreset = normalizedValue === null
    ? ONLINE_BACKGROUND_PRESETS.find((preset) => preset.value === null)
    : ONLINE_BACKGROUND_PRESETS.find((preset) => (
        preset.marker && normalizedValue.includes(preset.marker)
      ))
  const hasCustomBackground = normalizedValue !== null
    && !activePreset

  return (
    <div className="background-picker">
      <div className="background-picker-heading">
        <div>
          <h3>Menu background</h3>
          <p>Applied to this location’s guest menu.</p>
        </div>
        {hasCustomBackground && <span className="background-custom-note">Custom image active</span>}
      </div>
      <div className="background-presets" role="group" aria-label="Menu background">
        {ONLINE_BACKGROUND_PRESETS.map((preset) => {
          const selected = preset.id === activePreset?.id
          return (
            <button
              key={preset.id}
              type="button"
              className={`background-preset${selected ? ' is-selected' : ''}`}
              aria-pressed={selected}
              onClick={() => onChange(preset.value)}
            >
              <span className={`background-preset-preview${preset.preview ? '' : ' is-clean'}`}>
                {preset.preview && <img src={preset.preview} alt="" />}
                {preset.preview && <span className="background-preset-scrim" />}
                {selected && (
                  <span className="background-preset-check" title="Selected">
                    <Check aria-hidden="true" />
                  </span>
                )}
              </span>
              <span>{preset.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Онлайн-заказы ────────────────────────────────────────────

function OnlineTab({ locationId, settings, patch }) {
  const enabled = onlineEnabled(settings)
  const types = orderTypes(settings)
  const online = settings.online_orders || {}

  return (
    <>
      <section className="panel form-panel">
        <Toggle
          label="Accept online orders"
          hint="Guests can order from the link below. Turning this off stops new orders immediately."
          checked={enabled}
          onChange={(v) => patch({ enabled: v })}
        />
      </section>

      {enabled && (
        <section className="panel form-panel">
          <div className="panel-heading">
            <div>
              <h2>Order types</h2>
              <p>What the guest can choose. At least one stays on.</p>
            </div>
          </div>
          {ORDER_TYPES.map((type) => (
            <Toggle
              key={type}
              label={ORDER_TYPE_LABELS[type]}
              checked={types.includes(type)}
              // Последний включённый тип не выключаем — гостю нужен способ заказа
              disabled={types.length === 1 && types.includes(type)}
              onChange={() => patch({ order_types: toggleOrderType(types, type) })}
            />
          ))}
        </section>
      )}

      <section className="panel form-panel">
        <div className="panel-heading">
          <div>
            <h2>Guest page</h2>
            <p>How the ordering page introduces the place.</p>
          </div>
        </div>
        <div className="qr-grid">
          <Field label="Display name">
            <input
              defaultValue={online.display_name || ''}
              placeholder="Shown as the page title"
              onBlur={(e) => patch({ display_name: e.target.value.trim() || null })}
            />
          </Field>
          <Field label="Google review link">
            <input
              defaultValue={online.google_review || ''}
              placeholder="https://…"
              onBlur={(e) => patch({ google_review: e.target.value.trim() || null })}
            />
          </Field>
          <Field label="Instagram">
            <input
              defaultValue={online.instagram || ''}
              placeholder="https://instagram.com/…"
              onBlur={(e) => patch({ instagram: e.target.value.trim() || null })}
            />
          </Field>
          <Field label="Facebook">
            <input
              defaultValue={online.facebook || ''}
              placeholder="https://facebook.com/…"
              onBlur={(e) => patch({ facebook: e.target.value.trim() || null })}
            />
          </Field>
        </div>
        <BackgroundPresets
          value={online.background_url}
          onChange={(backgroundUrl) => patch({ background_url: backgroundUrl })}
        />
        <p className="form-hint">
          The header image is managed from the register under
          Settings → Service → Online orders.
        </p>
      </section>

      <section className="panel form-panel">
        <LinkBlock
          url={orderUrl(locationId)}
          hint="Put this on a QR code at the counter or behind the till."
        />
      </section>
    </>
  )
}

// ── Бронирование ─────────────────────────────────────────────

function ReserveTab({ locationId, settings, patch }) {
  const enabled = reservationsEnabled(settings)
  const rsv = settings.reservations || {}
  const instant = rsv.instant === true
  const depositOn = rsv.deposit_required === true

  // Депозит — деньги: держим черновик строкой, коммитим агороты на blur,
  // чтобы промежуточный ввод «1.» не улетал в базу как мусор.
  const [depositDraft, setDepositDraft] = useState(agorotToInput(rsv.deposit_amount))
  const [depositError, setDepositError] = useState('')

  function commitDeposit() {
    const agorot = inputToAgorot(depositDraft)
    if (agorot === null) {
      setDepositError('Enter an amount like 50 or 49.90')
      return
    }
    setDepositError('')
    setDepositDraft(agorotToInput(agorot))
    patch({ deposit_amount: agorot })
  }

  return (
    <>
      <section className="panel form-panel">
        <Toggle
          label="Take reservations"
          hint="Off by default. Guests book a table from the link below; the register confirms."
          checked={enabled}
          onChange={(v) => patch({ enabled: v })}
        />
      </section>

      {enabled && (
        <>
          <section className="panel form-panel">
            <div className="panel-heading">
              <div>
                <h2>Booking hours</h2>
                <p>Slots offered to the guest. Leave times empty to accept any hour.</p>
              </div>
            </div>
            <div className="qr-grid">
              <Field label="Opens">
                <input
                  type="time"
                  value={rsv.open ?? ''}
                  onChange={(e) => patch({ open: e.target.value || null })}
                />
              </Field>
              <Field label="Closes">
                <input
                  type="time"
                  value={rsv.close ?? ''}
                  onChange={(e) => patch({ close: e.target.value || null })}
                />
              </Field>
              <Field label="Slot, minutes">
                <NumberSelect
                  value={rsv.slot_min} fallback={15} options={[15, 30, 60]}
                  onChange={(v) => patch({ slot_min: v })}
                />
              </Field>
              <Field label="Max party size">
                <NumberSelect
                  value={rsv.max_party} fallback={20} options={[2, 4, 6, 8, 10, 12, 15, 20, 30, 50]}
                  onChange={(v) => patch({ max_party: v })}
                />
              </Field>
            </div>
          </section>

          <section className="panel form-panel">
            <Toggle
              label="Confirm instantly"
              hint="The server picks a free table and confirms without the register."
              checked={instant}
              onChange={(v) => patch({ instant: v })}
            />
            {instant && (
              <>
                <Toggle
                  label="Combine tables"
                  hint="Seat a large party across adjacent tables."
                  checked={rsv.combine === true}
                  onChange={(v) => patch({ combine: v })}
                />
                <div className="qr-grid">
                  <Field label="Visit length, minutes">
                    <NumberSelect
                      value={rsv.duration_min} fallback={90} options={[30, 45, 60, 90, 120, 150, 180]}
                      onChange={(v) => patch({ duration_min: v })}
                    />
                  </Field>
                  <Field label="Buffer between guests, minutes">
                    <NumberSelect
                      value={rsv.buffer_min} fallback={0} options={[0, 5, 10, 15, 30]}
                      onChange={(v) => patch({ buffer_min: v })}
                    />
                  </Field>
                </div>
              </>
            )}
          </section>

          <section className="panel form-panel">
            <Toggle
              label="Require a deposit"
              hint="Ask larger parties to pay upfront when booking."
              checked={depositOn}
              onChange={(v) => patch({ deposit_required: v })}
            />
            {depositOn && (
              <div className="qr-grid">
                <Field label="Deposit amount, ₪">
                  <input
                    inputMode="decimal"
                    placeholder="0"
                    value={depositDraft}
                    onChange={(e) => setDepositDraft(e.target.value)}
                    onBlur={commitDeposit}
                  />
                </Field>
                <Field label="From party of">
                  <NumberSelect
                    value={rsv.deposit_from_party} fallback={1} options={[1, 2, 4, 6, 8, 10, 12]}
                    onChange={(v) => patch({ deposit_from_party: v })}
                  />
                </Field>
              </div>
            )}
            {depositError && <p className="form-error" role="alert">{depositError}</p>}
          </section>

          <section className="panel form-panel">
            <div className="panel-heading">
              <div>
                <h2>Guest page</h2>
                <p>Shown to the guest while booking and on the confirmation.</p>
              </div>
            </div>
            <div className="qr-grid">
              <Field label="Display name">
                <input
                  defaultValue={rsv.display_name || ''}
                  onBlur={(e) => patch({ display_name: e.target.value.trim() || null })}
                />
              </Field>
              {/* Одна строка на день, день и время разделены «·» — так их
                  парсит HoursRows на гостевой странице (PublicReservePage).
                  Однострочный input не дал бы ввести перевод строки. */}
              <Field label="Opening hours">
                <textarea
                  rows={4}
                  defaultValue={rsv.hours || ''}
                  placeholder={'Sun–Thu · 8:00–22:00\nFri · 8:00–14:00\nSat · closed'}
                  onBlur={(e) => patch({ hours: e.target.value.trim() || null })}
                />
              </Field>
              <Field label="Address">
                <input
                  defaultValue={rsv.address || ''}
                  onBlur={(e) => patch({ address: e.target.value.trim() || null })}
                />
              </Field>
              <Field label="Google review link">
                <input
                  defaultValue={rsv.google_review || ''}
                  placeholder="https://…"
                  onBlur={(e) => patch({ google_review: e.target.value.trim() || null })}
                />
              </Field>
              <Field label="Instagram">
                <input
                  defaultValue={rsv.instagram || ''}
                  placeholder="https://instagram.com/…"
                  onBlur={(e) => patch({ instagram: e.target.value.trim() || null })}
                />
              </Field>
              <Field label="Facebook">
                <input
                  defaultValue={rsv.facebook || ''}
                  placeholder="https://facebook.com/…"
                  onBlur={(e) => patch({ facebook: e.target.value.trim() || null })}
                />
              </Field>
            </div>
            <p className="form-hint">
              Header image and the map pin are set from the register, under
              Settings → Service → Reservations.
            </p>
          </section>
        </>
      )}

      <section className="panel form-panel">
        <LinkBlock
          url={reserveUrl(locationId)}
          hint="Share this link on the site, in the bio, or as a QR code on the table."
        />
      </section>
    </>
  )
}

// ── Экран ────────────────────────────────────────────────────

/**
 * Прежние значения только тех ключей, что были в неудавшемся патче.
 * Ключ, которого в разделе не было, возвращается как undefined — при merge
 * он затрёт оптимистичное значение, и это верно: до патча его не существовало.
 */
function pickKeys(source, delta) {
  const result = {}
  for (const key of Object.keys(delta)) result[key] = source?.[key]
  return result
}

export default function QrChannels({ context }) {
  const locations = context?.locations || []
  const [activeId, setActiveId] = useState(locations[0]?.id || null)
  const [tab, setTab] = useState('online')
  const [settings, setSettings] = useState(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!activeId) return undefined
    let cancelled = false
    setSettings(null)
    setError('')
    fetchLocation(activeId)
      .then((data) => { if (!cancelled) setSettings(data.settings || {}) })
      .catch((loadError) => { if (!cancelled) setError(loadError.message) })
    return () => { cancelled = true }
  }, [activeId])

  /**
   * Оптимистичная запись: тумблер отзывается сразу, при ошибке откатываем.
   * Шлём только изменённые ключи — patch_location_settings_web (091) мержит
   * раздел поключево, так что остальные настройки не пострадают.
   */
  function makePatcher(section, save) {
    return async (delta) => {
      // Функциональное обновление, а не снимок из замыкания: два тумблера
      // подряд, пока первый запрос в полёте, иначе считались бы от одного
      // и того же состояния — второй откатывал бы первый.
      let previous
      setSettings((current) => {
        previous = current
        return { ...current, [section]: { ...(current[section] || {}), ...delta } }
      })
      setError('')
      setSaved(false)
      try {
        await save(activeId, delta)
        setSaved(true)
      } catch (saveError) {
        // Откат точечный: возвращаем только затронутые ключи, чтобы не стереть
        // параллельно применённый соседний патч.
        setSettings((current) => ({
          ...current,
          [section]: { ...(current[section] || {}), ...pickKeys(previous?.[section], delta) },
        }))
        setError(saveError.message)
      }
    }
  }

  if (locations.length === 0) {
    return (
      <>
        <section className="page-heading compact-heading">
          <p className="eyebrow">{context.organization?.name}</p>
          <h1>QR channels</h1>
        </section>
        <p className="empty-state">No locations are linked to this account.</p>
      </>
    )
  }

  return (
    <>
      <section className="page-heading compact-heading">
        <p className="eyebrow">{context.organization?.name}</p>
        <h1>QR channels</h1>
        <p>Online ordering and table reservations — the pages your guests reach by QR.</p>
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

      <div className="menu-tabs location-tabs" role="tablist" aria-label="Channel">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={tab === item.key ? 'is-active' : ''}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {saved && !error && <p className="save-ok inline"><Check /> Saved</p>}

      {settings === null ? (
        <p className="empty-state">Loading…</p>
      ) : tab === 'online' ? (
        // key по точке: поля витрины неуправляемые (defaultValue), без
        // пересоздания они сохранили бы значения предыдущей точки.
        <OnlineTab
          key={activeId}
          locationId={activeId}
          settings={settings}
          patch={makePatcher('online_orders', saveOnlineOrders)}
        />
      ) : (
        <ReserveTab
          key={activeId}
          locationId={activeId}
          settings={settings}
          patch={makePatcher('reservations', saveReservations)}
        />
      )}
    </>
  )
}
