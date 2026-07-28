import { useEffect, useState } from 'react'
import {
  AlertTriangle, Check, Copy, Download, ExternalLink, Image, LayoutGrid,
  QrCode, RefreshCw, ShoppingBag, Smartphone, Store, Table, Code2,
  CalendarClock, Wallet, Contact,
} from 'lucide-react'
import { fetchLocation, fetchLocationSlug, fetchTables, saveLocationSlug } from './settings'
import {
  ORDER_TYPES, ORDER_TYPE_LABELS,
  ONLINE_BACKGROUND_PRESETS,
  onlineEnabled, orderTypes, toggleOrderType, saveOnlineOrders,
  reservationsEnabled, saveReservations,
  uploadHeroVideo,
  orderUrl, tableOrderUrl, reserveUrl,
  embedButtonSnippet, embedIframeSnippet,
  agorotToInput, inputToAgorot,
} from './online'
import {
  Field, LinkBlock, NumberSelect, QrCanvas, SettingGroup, SnippetBlock, Toggle,
  downloadQr, useCopy,
} from './qr-blocks'

/**
 * QR-каналы гостя: онлайн-заказы и бронирование столов.
 *
 * Экран строится сверху вниз по вопросам владельца:
 *   1. Принимает ли канал заказы прямо сейчас? — тумблер в герое.
 *   2. Где взять ссылку и QR? — там же, без прокрутки.
 *   3. Всё остальное — свёрнутые группы: правила заказа, вид витрины,
 *      раздача (столы, сайт), предпросмотр.
 * Раньше это был плоский список панелей, где ссылка оказывалась на
 * четвёртом экране прокрутки, а короткий адрес настраивался ПОСЛЕ
 * показанного QR с этим же адресом.
 *
 * Паритет с кассовыми разделами Настройки → Обслуживание. Печать на
 * встроенном 80мм-принтере остаётся в кассе.
 *
 * Ссылка ведёт на отдельный публичный домен меню, не на кабинет и не на POS
 * (см. online.js). Маршруты /order и /reserve обслуживает menu-приложение.
 */

const TABS = [
  { key: 'online', label: 'QR menu & ordering' },
  { key: 'reserve', label: 'Reservations' },
]

/**
 * Герой канала: состояние, гостевая ссылка и QR в одном блоке.
 *
 * Собран из отдельных элементов, а не из LinkBlock: здесь ссылка — главный
 * объект экрана, ей нужен свой заголовок-подпись и место под предупреждение
 * о выключенном канале, а QR стоит справа в меньшем размере.
 */
function ChannelHero({ title, hint, enabled, onToggle, url, qrName, offNote }) {
  const [copyState, copy] = useCopy(url)

  return (
    <section className="panel channel-hero">
      <div className="channel-hero-main">
        <div className="channel-hero-status">
          <div>
            <h2>{title}</h2>
            <p>{hint}</p>
          </div>
          <button
            type="button"
            className={`channel-switch${enabled ? ' is-on' : ''}`}
            aria-pressed={enabled}
            onClick={() => onToggle(!enabled)}
          >
            <i aria-hidden />
            {enabled ? 'Live' : 'Paused'}
          </button>
        </div>

        {!enabled && (
          <p className="channel-off-note" role="status">
            <AlertTriangle aria-hidden />
            {offNote}
          </p>
        )}

        <div>
          <span className="channel-link-label">Guest link</span>
          <div className="qr-link-row">
            <input value={url} readOnly onFocus={(e) => e.target.select()} />
          </div>
          <div className="qr-actions">
            <button type="button" className="secondary-button" onClick={copy}>
              {copyState === 'copied' ? <><Check /> Copied</> : <><Copy /> Copy link</>}
            </button>
            <button type="button" className="secondary-button" onClick={() => downloadQr(url, qrName)}>
              <Download /> Download QR
            </button>
            <a className="secondary-button" href={url} target="_blank" rel="noreferrer">
              <ExternalLink /> Open page
            </a>
          </div>
          {copyState === 'failed' && (
            <p className="qr-copy-error" role="alert">Copy was blocked. Select the link above and copy it manually.</p>
          )}
        </div>
      </div>

      <div className="channel-hero-qr">
        <QrCanvas url={url} size={148} />
      </div>
    </section>
  )
}

/**
 * Короткий адрес точки (Kassa 106): menu.angle.co.il/order/<slug>.
 *
 * Сохраняем по кнопке, а не по каждому нажатию клавиши: адрес попадает на
 * печатные флаеры, и промежуточные значения вроде «bul» не должны успевать
 * занять имя. Формат и занятость проверяет set_location_slug — форма лишь
 * показывает ответ сервера.
 */
function SlugBlock({ locationId, slug, onSaved }) {
  const [value, setValue] = useState(slug)
  const [state, setState] = useState('idle')
  const [error, setError] = useState('')

  useEffect(() => { setValue(slug); setError(''); setState('idle') }, [slug, locationId])

  const trimmed = value.trim().toLowerCase()
  const dirty = trimmed !== slug

  async function save() {
    setState('saving')
    setError('')
    try {
      const next = await saveLocationSlug(locationId, trimmed)
      onSaved(next)
      setValue(next)
      setState('saved')
      setTimeout(() => setState('idle'), 2000)
    } catch (saveError) {
      setError(saveError.message)
      setState('idle')
    }
  }

  return (
    <div className="qr-block-text">
      <p>
        A readable link for flyers and social profiles. The long link with the
        location id keeps working, so printed QR codes stay valid.
      </p>
      <div className="qr-field" style={{ marginTop: 14 }}>
        <div className="slug-input">
          <span className="slug-prefix">menu.angle.co.il/order/</span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="bulochka"
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
          />
        </div>
      </div>
      <div className="qr-actions">
        <button type="button" onClick={save} disabled={!dirty || state === 'saving'}>
          {state === 'saving' ? 'Saving…' : state === 'saved' ? <><Check /> Saved</> : 'Save address'}
        </button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {!error && (
        <p className="form-hint">
          3–40 characters: lowercase latin letters, digits and dashes.
          Leave empty to remove the short address.
        </p>
      )}
    </div>
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

/**
 * Hero-видео витрины: загрузка файла с компьютера — основной сценарий,
 * прямая ссылка остаётся дополнительным (ролик уже лежит на своём CDN).
 *
 * Паритет с кассой (Настройки → Обслуживание → Онлайн-заказы): те же
 * форматы, тот же лимит и тот же бакет, поэтому владельцу неважно, откуда
 * он загрузил ролик — на витрине результат одинаковый.
 */
function HeroVideoField({ context, url, onChange }) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [linkOpen, setLinkOpen] = useState(false)

  async function onFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''          // тот же файл можно выбрать повторно
    if (!file) return
    setUploading(true)
    setError('')
    try {
      onChange(await uploadHeroVideo(context, file))
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="hero-video-field">
      <div className="hero-video-head">
        <div>
          <h3>Hero video</h3>
          <p>Plays muted and loops at the top of the guest menu.</p>
        </div>
      </div>

      {url && (
        <video
          key={url}
          className="hero-video-preview"
          src={url}
          muted
          loop
          playsInline
          controls
          preload="metadata"
        />
      )}

      <div className="photo-row">
        <label className={`file-button${uploading ? ' is-busy' : ''}`}>
          {uploading ? 'Uploading…' : url ? 'Replace video' : 'Upload video'}
          <input
            type="file"
            accept="video/mp4,video/webm"
            onChange={onFile}
            hidden
            disabled={uploading}
          />
        </label>
        {url && !uploading && (
          <button type="button" className="secondary-button" onClick={() => onChange(null)}>
            Remove
          </button>
        )}
        <span className="hint">MP4 · WebM · up to 30 MB</span>
      </div>

      {error && <p className="hero-video-error">{error}</p>}

      <button
        type="button"
        className="text-button hero-video-link-toggle"
        onClick={() => setLinkOpen((open) => !open)}
      >
        {linkOpen ? 'Hide link option' : 'Use a link instead'}
      </button>
      {linkOpen && (
        <label className="qr-field hero-video-link">
          <span>Video URL</span>
          {/* key по url: поле неуправляемое, иначе после загрузки файла
              в нём осталась бы прежняя ссылка. */}
          <input
            key={url || ''}
            defaultValue={url || ''}
            placeholder="https://cdn.example.com/hero.mp4"
            onBlur={(e) => onChange(e.target.value.trim() || null)}
          />
          <small>Direct MP4 or WebM URL. The register header image is used as its poster.</small>
        </label>
      )}
    </div>
  )
}

function GuestPreview({ url }) {
  const [previewKey, setPreviewKey] = useState(0)

  return (
    <section className="panel guest-preview-panel">
      <div className="guest-preview-copy">
        <span className="guest-preview-icon" aria-hidden><Smartphone /></span>
        <div>
          <h2>Guest menu preview</h2>
          <p>This is the same mobile page guests open from the counter QR.</p>
        </div>
        <div className="guest-preview-actions">
          <button type="button" className="secondary-button" onClick={() => setPreviewKey((key) => key + 1)}>
            <RefreshCw /> Refresh
          </button>
          <a className="secondary-button" href={url} target="_blank" rel="noreferrer">
            <ExternalLink /> Open full page
          </a>
        </div>
      </div>
      <div className="guest-phone-frame">
        <iframe
          key={previewKey}
          src={url}
          title="Guest ordering menu preview"
          loading="lazy"
          tabIndex={-1}
        />
      </div>
    </section>
  )
}

// ── Онлайн-заказы ────────────────────────────────────────────

/** Подпись выбранного фона для свёрнутой группы «Look». */
function backgroundLabel(value) {
  if (!value) return 'Clean'
  const preset = ONLINE_BACKGROUND_PRESETS.find((p) => p.marker && value.includes(p.marker))
  return preset ? preset.label : 'Custom image'
}

function OnlineTab({ context, locationId, settings, tables, patch, slug, onSlugSaved, openGroup, onOpenGroup }) {
  const enabled = onlineEnabled(settings)
  const types = orderTypes(settings)
  const online = settings.online_orders || {}
  const [selectedTableId, setSelectedTableId] = useState(tables[0]?.id || '')
  const selectedTable = tables.find((table) => table.id === selectedTableId) || tables[0] || null

  const url = orderUrl(locationId, slug)
  const group = (key) => ({
    open: openGroup === key,
    onToggle: () => onOpenGroup(openGroup === key ? null : key),
  })

  return (
    <>
      <ChannelHero
        title="QR menu"
        hint="Guests scan the code, browse the menu and order from their phone."
        enabled={enabled}
        onToggle={(v) => patch({ enabled: v })}
        url={url}
        qrName="counter"
        offNote="Ordering is paused — guests who scan the code see the menu but cannot order."
      />

      <SettingGroup
        {...group('address')}
        icon={QrCode}
        title="Link & address"
        hint="The short address printed on flyers and shown in the browser."
        value={slug ? `/${slug}` : 'Location id'}
      >
        <SlugBlock locationId={locationId} slug={slug} onSaved={onSlugSaved} />
      </SettingGroup>

      <SettingGroup
        {...group('ordering')}
        icon={ShoppingBag}
        title="How guests order"
        hint="Which fulfilment options the guest can pick."
        value={types.map((t) => ORDER_TYPE_LABELS[t]).join(' · ') || 'None'}
      >
        {enabled ? (
          ORDER_TYPES.map((type) => (
            <Toggle
              key={type}
              label={ORDER_TYPE_LABELS[type]}
              checked={types.includes(type)}
              // Последний включённый тип не выключаем — гостю нужен способ заказа
              disabled={types.length === 1 && types.includes(type)}
              onChange={() => patch({ order_types: toggleOrderType(types, type) })}
            />
          ))
        ) : (
          <p className="form-hint" style={{ marginTop: 12 }}>
            Turn ordering on above to choose fulfilment options.
          </p>
        )}
      </SettingGroup>

      <SettingGroup
        {...group('look')}
        icon={Image}
        title="Look of the guest page"
        hint="Name, background, hero video and social links."
        value={backgroundLabel(online.background_url)}
      >
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
        <HeroVideoField
          context={context}
          url={online.hero_video_url || null}
          onChange={(videoUrl) => patch({ hero_video_url: videoUrl })}
        />
        <BackgroundPresets
          value={online.background_url}
          onChange={(backgroundUrl) => patch({ background_url: backgroundUrl })}
        />
        <p className="form-hint">
          The header image is managed from the register under
          Settings → Service → Online orders.
        </p>
      </SettingGroup>

      <SettingGroup
        {...group('tables')}
        icon={Table}
        title="Table QR codes"
        hint="A separate code per table — the table is filled in automatically."
        value={tables.length > 0 ? `${tables.length} tables` : 'No tables'}
      >
        {selectedTable ? (
          <>
            <p className="form-hint" style={{ marginTop: 12 }}>
              Guests who scan a table code skip contact and fulfilment questions.
            </p>
            <Field label="Table">
              <select
                value={selectedTable.id}
                onChange={(event) => setSelectedTableId(event.target.value)}
              >
                {tables.map((table) => (
                  <option key={table.id} value={table.id}>
                    Table {table.label}{table.zone ? ` · ${table.zone}` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <div className="qr-table-link">
              <LinkBlock
                url={tableOrderUrl(locationId, selectedTable.public_token, slug)}
                title={`Table ${selectedTable.label}`}
                hint="Print this specific code for the selected table. The public URL contains an opaque token, not the internal table ID."
              />
            </div>
          </>
        ) : (
          <p className="empty-state compact">No active tables yet. Create tables in the register first.</p>
        )}
      </SettingGroup>

      <SettingGroup
        {...group('embed')}
        icon={Code2}
        title="Put the menu on your website"
        hint="A button or the live menu embedded in your own page."
        value="HTML snippets"
      >
        <SnippetBlock
          title="Menu button"
          hint="A plain link styled as a button. Works in any site builder — paste it into an HTML block."
          code={embedButtonSnippet(locationId, slug)}
        />
        <SnippetBlock
          title="Embedded menu (iframe)"
          hint="The menu inside your page. Responsive up to 480px wide; menu edits appear automatically."
          code={embedIframeSnippet(locationId, slug)}
        />
      </SettingGroup>

      <GuestPreview url={url} />
    </>
  )
}

// ── Бронирование ─────────────────────────────────────────────

function ReserveTab({ locationId, settings, patch, slug, openGroup, onOpenGroup }) {
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

  const group = (key) => ({
    open: openGroup === key,
    onToggle: () => onOpenGroup(openGroup === key ? null : key),
  })

  const hoursValue = rsv.open && rsv.close ? `${rsv.open}–${rsv.close}` : 'Any hour'

  return (
    <>
      <ChannelHero
        title="Table reservations"
        hint="Guests book a table from the link; the register confirms."
        enabled={enabled}
        onToggle={(v) => patch({ enabled: v })}
        url={reserveUrl(locationId, slug)}
        qrName="reserve"
        offNote="Bookings are paused — the guest page tells visitors reservations are closed."
      />

      <SettingGroup
        {...group('hours')}
        icon={CalendarClock}
        title="Booking hours & party size"
        hint="Which slots the guest can pick."
        value={`${hoursValue} · up to ${rsv.max_party ?? 20}`}
      >
        {enabled ? (
          <>
            <p className="form-hint" style={{ marginTop: 12 }}>
              Leave the times empty to accept any hour.
            </p>
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
          </>
        ) : (
          <p className="form-hint" style={{ marginTop: 12 }}>
            Turn reservations on above to set booking hours.
          </p>
        )}
      </SettingGroup>

      <SettingGroup
        {...group('confirm')}
        icon={LayoutGrid}
        title="Confirmation"
        hint="Confirm automatically or let the register decide."
        value={instant ? 'Instant' : 'By the register'}
      >
        {enabled ? (
          <>
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
          </>
        ) : (
          <p className="form-hint" style={{ marginTop: 12 }}>
            Turn reservations on above to choose how bookings are confirmed.
          </p>
        )}
      </SettingGroup>

      <SettingGroup
        {...group('deposit')}
        icon={Wallet}
        title="Deposit"
        hint="Ask larger parties to pay upfront when booking."
        value={depositOn ? `₪ ${agorotToInput(rsv.deposit_amount)} from ${rsv.deposit_from_party ?? 1}` : 'Off'}
      >
        {enabled ? (
          <>
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
          </>
        ) : (
          <p className="form-hint" style={{ marginTop: 12 }}>
            Turn reservations on above to require a deposit.
          </p>
        )}
      </SettingGroup>

      <SettingGroup
        {...group('page')}
        icon={Contact}
        title="Look of the booking page"
        hint="Name, opening hours, address and social links."
        value={rsv.display_name || 'Location name'}
      >
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
      </SettingGroup>
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
  const [tables, setTables] = useState([])
  const [slug, setSlug] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  // Открыта максимум одна группа: экран остаётся коротким, и владелец
  // не теряет герой со ссылкой из виду. Состояние живёт здесь, чтобы
  // переживать перерисовку после сохранения настройки.
  const [openGroup, setOpenGroup] = useState(null)

  useEffect(() => {
    if (!activeId) return undefined
    let cancelled = false
    setSettings(null)
    setTables([])
    setSlug('')
    setError('')
    Promise.all([fetchLocation(activeId), fetchTables(activeId), fetchLocationSlug(activeId)])
      .then(([data, tableRows, locationSlug]) => {
        if (!cancelled) {
          setSettings(data.settings || {})
          setTables(tableRows)
          setSlug(locationSlug)
        }
      })
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
          <h1>QR menu</h1>
        </section>
        <p className="empty-state">No locations are linked to this account.</p>
      </>
    )
  }

  return (
    <>
      <section className="page-heading compact-heading">
        <p className="eyebrow">{context.organization?.name}</p>
        <h1>QR menu</h1>
        <p>The pages your guests open by scanning a code — ordering and table booking.</p>
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
            // Группы принадлежат каналу: при смене вкладки закрываем
            // открытую, иначе на соседней вкладке раскрылась бы чужая.
            onClick={() => { setTab(item.key); setOpenGroup(null) }}
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
          context={context}
          locationId={activeId}
          settings={settings}
          tables={tables}
          patch={makePatcher('online_orders', saveOnlineOrders)}
          slug={slug}
          onSlugSaved={setSlug}
          openGroup={openGroup}
          onOpenGroup={setOpenGroup}
        />
      ) : (
        <ReserveTab
          key={activeId}
          locationId={activeId}
          settings={settings}
          patch={makePatcher('reservations', saveReservations)}
          slug={slug}
          openGroup={openGroup}
          onOpenGroup={setOpenGroup}
        />
      )}
    </>
  )
}
