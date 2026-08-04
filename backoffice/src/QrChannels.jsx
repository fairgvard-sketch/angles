import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, Check, Clock, Copy, Download, ExternalLink, Image, LayoutGrid,
  QrCode, RefreshCw, ShoppingBag, Table, Code2, ListTree,
  CalendarClock, Contact, Ban,
} from 'lucide-react'
import { fetchLocation, fetchLocationSlug, fetchTables, saveLocationSlug } from './settings'
import {
  ORDER_TYPES, ORDER_TYPE_LABELS,
  ONLINE_BACKGROUND_PRESETS, PUBLIC_MENU_ORIGIN,
  onlineEnabled, orderTypes, toggleOrderType, saveOnlineOrders,
  reservationsEnabled, saveReservations,
  uploadHeroVideo,
  orderUrl, tableOrderUrl, reserveUrl,
  embedButtonSnippet, embedIframeSnippet,
  WEEK_DAYS, dayWindow, withDay, defaultHours, hoursSummary,
} from './online'
import {
  WEEK_DAYS as RSV_WEEK_DAYS, normalizeSchedule, dayWindows, withAddedWindow,
  withRemovedWindow, withWindowEdge, withDayWindows, withException,
  withoutException, exceptionList, previewDays, formatWindows, scheduleSummary,
  validateSchedule, todayInZone,
} from './reserve-schedule'
import {
  Field, LinkBlock, NumberSelect, QrCanvas, SettingGroup, SettingLink, SnippetBlock,
  Toggle, downloadQr, useCopy,
} from './qr-blocks'
import { hasCapability } from './navigation'
import { PageHeader } from './ui/Layout'
import Tabs from './ui/Tabs'

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
 * Рабочая шапка канала: состояние, гостевая ссылка, действия и QR.
 *
 * Первый экран отвечает на два вопроса владельца — принимает ли канал
 * гостей прямо сейчас и где взять ссылку. Раньше это был герой в пол-экрана
 * с QR 148px; теперь та же информация занимает одну компактную панель, а
 * место отдано настройкам и живому превью.
 *
 * Тумблер остаётся тумблером: цветная подпись «открыто» сама по себе не
 * даёт способа закрыть канал, а закрывать его приходится в тот момент,
 * когда на кухне встало.
 *
 * `qrUrl` отличается от `url` там, где напечатанный код нужно уметь
 * отличить от ссылки в профиле (Kassa 124): гость видит одну и ту же
 * страницу, но в отчёте это разные каналы. По умолчанию совпадают.
 */
function ChannelBar({ title, enabled, onToggle, onLabel, offLabel, url, qrUrl, qrName, offNote }) {
  const [copyState, copy] = useCopy(url)
  const codeUrl = qrUrl || url

  return (
    <section className="panel channel-bar">
      <div className="channel-bar-main">
        <div className="channel-bar-state">
          <h2>{title}</h2>
          <button
            type="button"
            className={`channel-switch${enabled ? ' is-on' : ''}`}
            aria-pressed={enabled}
            onClick={() => onToggle(!enabled)}
          >
            <i aria-hidden />
            {enabled ? onLabel : offLabel}
          </button>
          {/* Автосохранение — обещание, которое экран обязан назвать
              вслух: кнопки «Опубликовать» здесь нет и не будет. */}
          <span className="channel-bar-auto">Changes save automatically</span>
        </div>

        <div className="channel-bar-link">
          {/* Такие же блоки есть у каждого канала: доступное имя
              называет канал, иначе подряд читается «Copy link». */}
          <input
            className="channel-bar-url"
            value={url}
            readOnly
            aria-label={`${title} — guest link`}
            onFocus={(e) => e.target.select()}
          />
          <div className="qr-actions channel-bar-actions">
            <button type="button" className="secondary-button" aria-label={`Copy link — ${title}`} onClick={copy}>
              {copyState === 'copied' ? <><Check /> Copied</> : <><Copy /> Copy link</>}
            </button>
            <button
              type="button"
              className="secondary-button"
              aria-label={`Download QR — ${title}`}
              onClick={() => downloadQr(codeUrl, qrName)}
            >
              <Download /> Download QR
            </button>
            <a
              className="secondary-button"
              href={url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open page — ${title}`}
            >
              <ExternalLink /> Open page
            </a>
          </div>
        </div>

        {!enabled && (
          <p className="channel-off-note" role="status">
            <AlertTriangle aria-hidden />
            {offNote}
          </p>
        )}
        {copyState === 'failed' && (
          <p className="qr-copy-error" role="alert">Copy was blocked. Select the link above and copy it manually.</p>
        )}
      </div>

      {/* QR остаётся на виду в компактном размере: его сканируют прямо с
          экрана, чтобы проверить страницу телефоном. Печатный размер даёт
          «Download QR». */}
      <div className="channel-bar-qr">
        <QrCanvas url={codeUrl} size={104} label={title} />
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

/**
 * Часы работы — окно приёма заказов (Kassa 112).
 *
 * Гость выбирает время только внутри этих окон, и сервер проверяет то же
 * правило независимо от UI. Пока расписание не включено, приём идёт
 * круглосуточно — это и есть поведение точек, которые часы не настраивали.
 *
 * Один интервал на день: перерыв на обед формат поддерживает (массив окон),
 * но в редакторе его нет — ради простоты частого случая. День без окна
 * считается закрытым.
 */
function OpeningHours({ hours, onChange }) {
  const enabled = hours !== null && hours !== undefined

  return (
    <>
      <Toggle
        label="Limit ordering to opening hours"
        hint="Off — orders are accepted around the clock. On — guests can only order for times inside the hours below."
        checked={enabled}
        onChange={(on) => onChange(on ? defaultHours() : null)}
      />

      {enabled && (
        <div className="hours-editor">
          {WEEK_DAYS.map((day) => {
            const window = dayWindow(hours, day.key)
            const open = window !== null
            return (
              <div key={day.key} className={`hours-row${open ? '' : ' is-closed'}`}>
                <label className="hours-day">
                  <input
                    type="checkbox"
                    checked={open}
                    onChange={(event) => onChange(
                      withDay(hours, day.key, event.target.checked ? ['08:00', '20:00'] : null)
                    )}
                  />
                  <span>{day.label}</span>
                </label>
                {open ? (
                  <div className="hours-window">
                    <input
                      type="time"
                      value={window[0]}
                      onChange={(event) => onChange(
                        withDay(hours, day.key, [event.target.value, window[1]])
                      )}
                    />
                    <span className="hours-dash">–</span>
                    <input
                      type="time"
                      value={window[1]}
                      onChange={(event) => onChange(
                        withDay(hours, day.key, [window[0], event.target.value])
                      )}
                    />
                  </div>
                ) : (
                  <span className="hours-closed">Closed</span>
                )}
              </div>
            )
          })}
          <p className="form-hint">
            Times are in the location’s own time zone. A closing time earlier
            than the opening time means the day runs past midnight — 20:00–02:00
            keeps orders open until two in the morning.
          </p>
        </div>
      )}
    </>
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

/**
 * Превью гостевой страницы — общее для меню и брони.
 *
 * Кросс-доменный кадр невозможно опросить: заблокированный он выглядит
 * снаружи так же, как ещё не загруженный, поэтому страница сама шлёт
 * «я поднялась» (`angle-public` / `ready`). Состояния:
 *
 *   loading      — кадр ещё не отдал ни одного события;
 *   ready        — пришло подтверждение от самой страницы;
 *   unconfirmed  — кадр загрузился, но подтверждения нет (старая версия
 *                  публичной страницы либо блокировка) — показываем кадр
 *                  И подсказку, а не прячем работающее превью;
 *   blocked      — событий не было вовсе: вместо белого прямоугольника
 *                  объяснение и ссылка «открыть страницу гостя».
 *
 * Оба канала обслуживает одно публичное приложение (PublicApp кассы), и
 * сигнал `ready` оно шлёт на уровне приложения — и для `/order/*`, и для
 * `/reserve/*`. Поэтому контракт готовности параметром не сделан:
 * отдельный origin/тип сообщения означал бы, что где-то живёт вторая
 * публичная страница, а её нет.
 */
const PREVIEW_TIMEOUT_MS = 8000

export function GuestPreview({
  url,
  title = 'Guest menu preview',
  description = 'This is the same mobile page guests open from the counter QR.',
  iframeTitle = 'Guest ordering menu preview',
  openLabel = 'Open full page',
  blockedLinkLabel = 'Open the guest page',
}) {
  const [previewKey, setPreviewKey] = useState(0)
  // `idle` — кадр ещё не поднимали намеренно. Без этого состояния таймаут
  // объявлял бы «превью не загрузилось» про кадр, который мы сами и не
  // просили грузить.
  const [status, setStatus] = useState('idle')
  // Кадр не монтируется, пока панель не показалась: раздел, открытый
  // сверху, не должен вообще запускать гостевую страницу.
  const [armed, setArmed] = useState(false)
  const [entered, setEntered] = useState(false)
  const loadedRef = useRef(false)
  const frameRef = useRef(null)
  const iframeRef = useRef(null)
  const refreshRef = useRef(null)
  const anchorRef = useRef(null)
  const timersRef = useRef([])
  // Отложенное восстановление якоря читает «зашёл ли владелец сам» из
  // ref: таймеры переживают рендер, а состояние в замыкании — нет.
  const enteredRef = useRef(false)
  enteredRef.current = entered

  useEffect(() => {
    if (!armed) return undefined
    loadedRef.current = false
    setStatus('loading')
    function onMessage(event) {
      if (event.origin !== PUBLIC_MENU_ORIGIN) return
      if (event.source !== iframeRef.current?.contentWindow) return
      if (event.data?.source !== 'angle-public' || event.data?.type !== 'ready') return
      setStatus('ready')
    }
    window.addEventListener('message', onMessage)
    const timer = setTimeout(() => {
      setStatus((s) => (s === 'ready' ? s : (loadedRef.current ? 'unconfirmed' : 'blocked')))
    }, PREVIEW_TIMEOUT_MS)
    return () => {
      window.removeEventListener('message', onMessage)
      clearTimeout(timer)
    }
  }, [previewKey, url, armed])

  useEffect(() => {
    const el = frameRef.current
    if (!el || typeof IntersectionObserver !== 'function') {
      setArmed(true)
      return undefined
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setArmed(true)
        observer.disconnect()
      }
    }, { rootMargin: '150px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  /**
   * Кадр не имеет права двигать страницу под собой.
   *
   * Гостевая страница внутри ставит фокус своей кнопке, а браузер, чтобы
   * «показать» сфокусированное, подкручивает и родительский документ —
   * владелец, открывший раздел, оказывался в середине страницы, у
   * телефона с превью. Опросить чужой домен нельзя, поэтому положение
   * страницы и активный элемент запоминаются ДО загрузки и возвращаются
   * после: и на первой загрузке, и на «Refresh preview».
   */
  const remember = () => {
    anchorRef.current = {
      x: window.scrollX,
      y: window.scrollY,
      active: document.activeElement,
    }
  }

  // Якорь снимается перед каждой загрузкой кадра, включая первую.
  useEffect(() => { if (armed) remember() }, [armed, previewKey])

  const restore = () => {
    const anchor = anchorRef.current
    if (!anchor || !iframeRef.current) return
    // Длинные контрольные таймеры не должны мешать владельцу скроллить
    // страницу самому. Возвращаем якорь только когда кадр действительно
    // забрал фокус без явного «Enter preview».
    const stolenFocus = !enteredRef.current && document.activeElement === iframeRef.current
    if (!stolenFocus) return
    if (window.scrollX !== anchor.x || window.scrollY !== anchor.y) {
      window.scrollTo(anchor.x, anchor.y)
    }
    iframeRef.current.blur()
    const back = anchor.active
    if (back && back !== iframeRef.current && document.contains(back)) {
      back.focus({ preventScroll: true })
    }
  }

  // Страница внутри кадра ставит фокус не синхронно с onLoad, поэтому
  // якорь возвращается ещё несколько раз в ближайшие кадры.
  const restoreSoon = () => {
    restore()
    timersRef.current.forEach(clearTimeout)
    // Hero/video внутри чужой страницы может поставить autofocus сильно
    // позже события load. Редкие проверки ловят это без постоянного
    // polling; restore выше ничего не делает, если фокус не украден.
    timersRef.current = [0, 60, 200, 600, 1200, 2000, 3500, 6000, 9000]
      .map((ms) => setTimeout(restore, ms))
  }

  // Раздел закрыли — никаких отложенных прыжков по чужой странице.
  useEffect(() => () => timersRef.current.forEach(clearTimeout), [])

  function refresh() {
    remember()
    enteredRef.current = false
    setEntered(false)
    setPreviewKey((key) => key + 1)
    // Управление возвращается той кнопке, которой владелец воспользовался.
    refreshRef.current?.focus({ preventScroll: true })
  }

  function enterPreview() {
    // ref меняется до focus(): React-состояние применится следующим
    // рендером, а onFocus кадра сработает синхронно.
    enteredRef.current = true
    setEntered(true)
    iframeRef.current?.focus({ preventScroll: true })
  }

  // Ушли из кадра — он снова вне обхода табом.
  useEffect(() => {
    if (!entered) return undefined
    function onFocusIn(event) {
      if (event.target !== iframeRef.current) setEntered(false)
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [entered])

  const blocked = status === 'blocked'
  return (
    <section className="panel guest-preview-panel">
      <div className="guest-preview-copy">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <div className="guest-preview-actions">
          {/* Кадр вне обхода табом, иначе владелец «проваливается» в чужую
              страницу мимоходом. Зайти в него можно намеренно — и выйти
              обычным Tab: следующий focusin вернёт кадр в прежнее
              состояние. */}
          <button
            type="button"
            className="text-button"
            onClick={enterPreview}
            disabled={!armed || blocked}
          >
            Enter preview
          </button>
          {/* Иконка без видимой подписи, но не безымянная: текст остаётся
              в разметке для скринридера — колонка узкая, а обновление
              нажимают чаще всего. */}
          <button
            type="button"
            className="secondary-button is-icon"
            ref={refreshRef}
            onClick={refresh}
          >
            <RefreshCw aria-hidden />
            <span className="visually-hidden">Refresh preview</span>
          </button>
          <a className="secondary-button" href={url} target="_blank" rel="noreferrer">
            <ExternalLink /> {openLabel}
          </a>
        </div>
      </div>
      <div ref={frameRef} className={`guest-phone-frame${status === 'ready' ? ' is-ready' : ''}`}>
        {status === 'loading' && (
          <p className="guest-preview-state" role="status">Loading the guest page…</p>
        )}
        {blocked && (
          <div className="guest-preview-state is-blocked" role="status">
            <AlertTriangle />
            <strong>The preview did not load here</strong>
            <p>
              Some browsers block pages shown inside another page. The guest link
              itself keeps working — open it in a new tab to check it.
            </p>
            <a className="secondary-button" href={url} target="_blank" rel="noreferrer">
              <ExternalLink /> {blockedLinkLabel}
            </a>
          </div>
        )}
        {armed && (
          <iframe
            key={previewKey}
            ref={iframeRef}
            src={url}
            title={iframeTitle}
            loading="lazy"
            tabIndex={entered ? 0 : -1}
            hidden={blocked}
            onLoad={() => { loadedRef.current = true; restoreSoon() }}
            onFocus={() => {
              // Реальная гостевая страница может повторно поставить focus
              // спустя секунды после load (например, после запуска hero).
              // Таймеры загрузки этого уже не поймают, а событие поймает.
              if (!enteredRef.current) restoreSoon()
            }}
          />
        )}
      </div>
      {status === 'unconfirmed' && (
        <p className="guest-preview-note" role="status">
          <AlertTriangle aria-hidden />
          <span>
            If the phone above looks empty, your browser blocked the embedded page.
            Use <strong>Open full page</strong> — the guest link itself is fine.
          </span>
        </p>
      )}
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

/**
 * Вкладки экспортируются ради тестов: раздел рисуется только после
 * загрузки настроек, и без прямого рендера ни одна строка настройки
 * проверке не поддаётся — а именно в них живёт всё, что нельзя потерять.
 */
export function OnlineTab({
  context, locationId, settings, tables, patch, slug, onSlugSaved,
  url, openGroup, onOpenGroup, onManageCatalogue,
}) {
  const enabled = onlineEnabled(settings)
  const types = orderTypes(settings)
  const online = settings.online_orders || {}
  const [selectedTableId, setSelectedTableId] = useState(tables[0]?.id || '')
  const selectedTable = tables.find((table) => table.id === selectedTableId) || tables[0] || null

  const group = (key) => ({
    open: openGroup === key,
    onToggle: () => onOpenGroup(openGroup === key ? null : key),
  })

  return (
    <>
      <ChannelBar
        title="QR menu"
        enabled={enabled}
        onToggle={(v) => patch({ enabled: v })}
        onLabel="Ordering is live"
        offLabel="Ordering is paused"
        url={url}
        qrName="counter"
        offNote="Ordering is paused — guests who scan the code see the menu but cannot order."
      />

      <h2 className="setting-section-title">Guest experience</h2>
      <div className="setting-rows">
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
          {...group('hours')}
          icon={Clock}
          title="Opening hours"
          hint="When the guest page accepts orders — now and for later."
          value={hoursSummary(online.hours)}
        >
          {enabled ? (
            <OpeningHours
              hours={online.hours ?? null}
              onChange={(next) => patch({ hours: next })}
            />
          ) : (
            <p className="form-hint" style={{ marginTop: 12 }}>
              Turn ordering on above to set opening hours.
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
            The header image comes from this location’s settings — Locations →
            Online orders.
          </p>
        </SettingGroup>

        {/* Каталог редактируется в своём разделе — здесь только короткий
            путь туда. Второй редактор меню в этом экране означал бы две
            правды об одном и том же товаре. */}
        {onManageCatalogue && (
          <SettingLink
            icon={ListTree}
            title="Menu content"
            hint="Items, categories and photos live in Catalogue and appear here automatically."
            value="Synced from Catalogue"
            actionLabel="Manage catalogue"
            onAction={onManageCatalogue}
          />
        )}
      </div>

      <h2 className="setting-section-title">Ways guests open the menu</h2>
      <div className="setting-rows">
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
            <p className="empty-state compact">
              No active tables yet. Add them in Reservations → Tables &amp; zones.
            </p>
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
      </div>
    </>
  )
}

// ── Бронирование ─────────────────────────────────────────────

/**
 * Недельное расписание брони (Kassa 117): окна по дням (несколько на день —
 * обед и ужин), исключения по датам, запас до визита и горизонт записи.
 *
 * Заменяет пару open/close, действовавшую на все семь дней сразу, и
 * свободный текст «часы работы», который вёлся отдельно от неё. Расхождение
 * этих двух полей и было причиной субботних слотов у заведения, закрытого
 * по субботам: гостю показывали одно, сервер принимал другое.
 *
 * Расписание сохраняется целиком одним патчем: серверный merge заменяет
 * ключ schedule целиком, поэтому частичная отправка стёрла бы остальные дни.
 */
/**
 * Правило отсечки: за сколько минут до визита гость теряет право менять
 * бронь. Значение — минуты (их читает `reservation_guest_block`, Kassa 118),
 * но выбирать «1440» вместо «за сутки» владелец не должен.
 */
const CUTOFF_OPTIONS = [
  { value: 0, label: 'Any time before the visit' },
  { value: 60, label: '1 hour before' },
  { value: 120, label: '2 hours before' },
  { value: 180, label: '3 hours before' },
  { value: 360, label: '6 hours before' },
  { value: 720, label: '12 hours before' },
  { value: 1440, label: '24 hours before' },
  { value: 2880, label: '2 days before' },
]

function CutoffSelect({ value, onChange }) {
  return (
    <select value={Number(value) || 0} onChange={(e) => onChange(Number(e.target.value))}>
      {CUTOFF_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

function cutoffLabel(value) {
  const found = CUTOFF_OPTIONS.find((o) => o.value === (Number(value) || 0))
  return found ? found.label : `${value} min before`
}

function ReservationSchedule({ schedule, tz, onChange }) {
  const [error, setError] = useState('')
  const [newDate, setNewDate] = useState('')

  function commit(next) {
    const problem = validateSchedule(next)
    setError(problem || '')
    if (problem) return
    onChange(next)
  }

  const exceptions = exceptionList(schedule)
  const preview = previewDays(schedule, tz)

  return (
    <>
      <div className="hours-editor">
        {RSV_WEEK_DAYS.map((day) => {
          const windows = dayWindows(schedule, day.key)
          const open = windows.length > 0
          return (
            <div key={day.key} className={`hours-row${open ? '' : ' is-closed'}`}>
              <label className="hours-day">
                <input
                  type="checkbox"
                  checked={open}
                  onChange={(event) => commit(withDayWindows(
                    schedule, day.key, event.target.checked ? [['08:00', '20:00']] : []
                  ))}
                />
                <span>{day.label}</span>
              </label>
              {open ? (
                <div className="hours-windows">
                  {windows.map((window, index) => (
                    <div key={index} className="hours-window">
                      <input
                        type="time"
                        value={window[0]}
                        onChange={(event) => commit(
                          withWindowEdge(schedule, day.key, index, 0, event.target.value)
                        )}
                      />
                      <span className="hours-dash">–</span>
                      <input
                        type="time"
                        value={window[1]}
                        onChange={(event) => commit(
                          withWindowEdge(schedule, day.key, index, 1, event.target.value)
                        )}
                      />
                      {windows.length > 1 && (
                        <button
                          type="button"
                          className="secondary-button compact"
                          onClick={() => commit(withRemovedWindow(schedule, day.key, index))}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    className="secondary-button compact"
                    onClick={() => commit(withAddedWindow(schedule, day.key))}
                  >
                    Add a service period
                  </button>
                </div>
              ) : (
                <span className="hours-closed">Closed</span>
              )}
            </div>
          )
        })}
      </div>
      <p className="form-hint">
        Times are in the location’s own time zone. A second period on the same
        day covers a split shift — lunch and dinner. A closing time earlier than
        the opening time means the shift runs past midnight: 20:00–02:00 keeps
        bookings open until two in the morning.
      </p>

      <div className="panel-heading" style={{ marginTop: 20 }}>
        <div>
          <h3>Holidays and one-off changes</h3>
          <p>A date here replaces the weekly rule for that day entirely.</p>
        </div>
      </div>
      {exceptions.length > 0 && (
        <div className="hours-editor">
          {exceptions.map(({ date, windows }) => (
            <div key={date} className={`hours-row${windows.length ? '' : ' is-closed'}`}>
              <span className="hours-day"><span>{date}</span></span>
              {windows.length > 0 ? (
                <div className="hours-window">
                  <input
                    type="time"
                    value={windows[0][0]}
                    onChange={(event) => commit(withException(
                      schedule, date, [[event.target.value, windows[0][1]]]
                    ))}
                  />
                  <span className="hours-dash">–</span>
                  <input
                    type="time"
                    value={windows[0][1]}
                    onChange={(event) => commit(withException(
                      schedule, date, [[windows[0][0], event.target.value]]
                    ))}
                  />
                </div>
              ) : (
                <span className="hours-closed">Closed</span>
              )}
              <div className="order-actions">
                <button
                  type="button"
                  className="secondary-button compact"
                  onClick={() => commit(withException(
                    schedule, date, windows.length ? [] : [['18:00', '23:00']]
                  ))}
                >
                  {windows.length ? 'Mark closed' : 'Set hours'}
                </button>
                <button
                  type="button"
                  className="secondary-button compact"
                  onClick={() => commit(withoutException(schedule, date))}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="qr-grid">
        <Field label="Add a date">
          <input
            type="date"
            value={newDate}
            min={todayInZone(tz)}
            onChange={(event) => setNewDate(event.target.value)}
          />
        </Field>
        <Field label="&nbsp;">
          <button
            type="button"
            className="secondary-button"
            disabled={!newDate}
            onClick={() => {
              commit(withException(schedule, newDate, []))
              setNewDate('')
            }}
          >
            Close this date
          </button>
        </Field>
      </div>

      <div className="panel-heading" style={{ marginTop: 20 }}>
        <div>
          <h3>Next seven days</h3>
          <p>Exactly what a guest can book right now.</p>
        </div>
      </div>
      <div className="hours-editor">
        {preview.map((day) => (
          <div key={day.date} className={`hours-row${day.windows.length ? '' : ' is-closed'}`}>
            <span className="hours-day">
              <span>
                {RSV_WEEK_DAYS[day.dow]?.short} {day.date.slice(5)}
                {day.isToday ? ' · today' : ''}
                {day.isException ? ' · one-off' : ''}
              </span>
            </span>
            <span className={day.windows.length ? '' : 'hours-closed'}>
              {formatWindows(day.windows)}
            </span>
          </div>
        ))}
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
    </>
  )
}

/**
 * Адрес на странице брони.
 *
 * Источник правды — адрес заведения (Locations → Business address); в
 * настройках брони живёт только необязательное переопределение. Сервер
 * так и резолвит: `settings.reservations.address || receipt_address`.
 * Экран обязан показывать этот же результат, иначе владелец не увидит,
 * что гостю показывается не то.
 */
function AddressField({ override, businessAddress, onChange }) {
  const effective = override.trim() || businessAddress
  const overridden = override.trim() !== ''
  return (
    <div className="address-field">
      <Field
        label="Address shown to guests"
        hint={businessAddress
          ? 'Comes from Locations → Business address. Fill this in only to override it.'
          : 'Set the business address in Locations — guests see it on the booking page.'}
      >
        <input
          key={override}
          defaultValue={override}
          placeholder={businessAddress || 'Street, number, city'}
          onBlur={(e) => onChange(e.target.value.trim() || null)}
        />
      </Field>
      <p className={`address-effective${effective ? '' : ' is-empty'}`}>
        {effective
          ? <>Guests see: <strong>{effective}</strong>{overridden ? ' (override)' : ' (business address)'}</>
          : 'Guests see no address — fill in the business address in Locations.'}
      </p>
      {overridden && businessAddress && (
        <button type="button" className="text-button" onClick={() => onChange(null)}>
          Use the business address instead
        </button>
      )}
    </div>
  )
}

export function ReserveTab({ locationId, settings, patch, slug, tz, businessAddress, url, openGroup, onOpenGroup }) {
  const enabled = reservationsEnabled(settings)
  const rsv = settings.reservations || {}
  const instant = rsv.instant === true
  // Расписание (Kassa 117). Точка без ключа schedule разворачивается из
  // legacy open/close, поэтому редактор всегда открывается заполненным.
  const schedule = normalizeSchedule(rsv)

  const group = (key) => ({
    open: openGroup === key,
    onToggle: () => onOpenGroup(openGroup === key ? null : key),
  })


  return (
    <>
      <ChannelBar
        title="Table reservations"
        enabled={enabled}
        onToggle={(v) => patch({ enabled: v })}
        onLabel="Reservations are open"
        offLabel="Reservations are paused"
        url={url}
        qrUrl={reserveUrl(locationId, slug, 'qr')}
        qrName="reserve"
        offNote="Bookings are paused — the guest page tells visitors reservations are closed."
      />

      <h2 className="setting-section-title">Booking setup</h2>
      <div className="setting-rows">
        <SettingGroup
          {...group('hours')}
          icon={CalendarClock}
          title="Booking hours"
          hint="The one schedule guests see and book by."
          value={scheduleSummary(schedule)}
        >
          {enabled ? (
            <ReservationSchedule
              schedule={schedule}
              tz={tz}
              onChange={(next) => patch({ schedule: next })}
            />
          ) : (
            <p className="form-hint" style={{ marginTop: 12 }}>
              Turn reservations on above to set booking hours.
            </p>
          )}
        </SettingGroup>

        <SettingGroup
          {...group('window')}
          icon={Clock}
          title="Slots & booking window"
          hint="Slot length, party limit and how far ahead guests can book."
          value={`${rsv.slot_min ?? 15} min slots · up to ${rsv.max_party ?? 20} guests · ${schedule.horizon_days ?? 30} days ahead`}
        >
          {enabled ? (
            <div className="qr-grid">
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
              <Field label="Book at least, minutes ahead">
                <NumberSelect
                  value={schedule.lead_min} fallback={30} options={[0, 15, 30, 60, 120, 180, 1440]}
                  onChange={(v) => patch({ schedule: { ...schedule, lead_min: v } })}
                />
              </Field>
              <Field label="Book at most, days ahead">
                <NumberSelect
                  value={schedule.horizon_days} fallback={30} options={[7, 14, 30, 60, 90, 180, 365]}
                  onChange={(v) => patch({ schedule: { ...schedule, horizon_days: v } })}
                />
              </Field>
            </div>
          ) : (
            <p className="form-hint" style={{ marginTop: 12 }}>
              Turn reservations on above to set the booking window.
            </p>
          )}
        </SettingGroup>

        <SettingGroup
          {...group('cutoff')}
          icon={Ban}
          title="Cancellation & changes"
          hint="Until when a guest may cancel or move the booking themselves."
          value={`${cutoffLabel(rsv.cancel_cutoff_min)} · ${rsv.waitlist === true ? 'waitlist on' : 'no waitlist'}`}
        >
          {enabled ? (
            <>
              <div className="qr-grid">
                <Field label="Guests can cancel">
                  <CutoffSelect
                    value={rsv.cancel_cutoff_min}
                    onChange={(v) => patch({ cancel_cutoff_min: v })}
                  />
                </Field>
                <Field label="Guests can move the booking">
                  <CutoffSelect
                    value={rsv.reschedule_cutoff_min}
                    onChange={(v) => patch({ reschedule_cutoff_min: v })}
                  />
                </Field>
              </div>
              <p className="form-hint">
                After the cut-off the buttons disappear from the guest page and the
                server refuses the change — the rule is not a hint. A booking the
                register has not confirmed yet can always be withdrawn by the guest:
                holding someone on an undecided request and refusing to release it
                would not be fair.
              </p>
              <Toggle
                label="Keep a waitlist"
                hint="When the day is full, guests can leave a wish instead of leaving empty-handed. Only turn this on if someone will actually call them back."
                checked={rsv.waitlist === true}
                onChange={(v) => patch({ waitlist: v })}
              />
              <Field label="Cancellation policy shown to the guest">
                <textarea
                  rows={3}
                  defaultValue={rsv.policy || ''}
                  placeholder="Please let us know at least 2 hours ahead if your plans change."
                  onBlur={(e) => patch({ policy: e.target.value.trim() || null })}
                />
              </Field>
            </>
          ) : (
            <p className="form-hint" style={{ marginTop: 12 }}>
              Turn reservations on above to set cancellation rules.
            </p>
          )}
        </SettingGroup>

        <SettingGroup
          {...group('confirm')}
          icon={LayoutGrid}
          title="Confirmation"
          hint="Confirm automatically or decide each booking yourself."
          value={instant ? 'Instant' : 'Manual'}
        >
          {enabled ? (
            <>
              <Toggle
                label="Confirm instantly"
                hint="A free table is picked and the guest is confirmed straight away."
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

        {/* Депозит убран из интерфейса (Kassa 117). Поля deposit_* и серверная
            логика сохранены — точка, у которой флаг уже проставлен, ведёт себя
            как прежде, — но показывать переключатель нельзя: оплаты за ним нет
            и не планируется, а владелец воспринимал его как работающую
            предоплату. Вернуть — только вместе с реальным приёмом платежа. */}
        <SettingGroup
          {...group('page')}
          icon={Contact}
          title="Look of the booking page"
          hint="Name, address and social links."
          value={`${rsv.display_name || 'Location name'} · ${rsv.address ? 'address override' : 'business address'}`}
        >
          <div className="qr-grid">
            <Field label="Display name">
              <input
                defaultValue={rsv.display_name || ''}
                onBlur={(e) => patch({ display_name: e.target.value.trim() || null })}
              />
            </Field>
            {/* Свободный текст часов убран (Kassa 117): он вёлся ОТДЕЛЬНО от
                часов приёма и расходился с ними — страница писала «шабат
                закрыто» и предлагала субботние слоты. Гостю теперь показывается
                расписание из группы «Booking hours». */}
            {/* Адрес у точки один. Плейсхолдера мало: он не виден гостю и
                не спасает от мусора, уже лежащего в переопределении —
                у живой точки там оказалась подпись поля «כתובת העסק», и
                гость видел её вместо улицы. Поэтому показываем ФАКТ:
                что именно откроется у гостя, и чем это задано. */}
            <AddressField
              override={rsv.address || ''}
              businessAddress={businessAddress}
              onChange={(value) => patch({ address: value })}
            />
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
            Header image and the map pin come from this location’s settings —
            Locations → Reservations.
          </p>
        </SettingGroup>
      </div>
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

export default function QrChannels({ context, locationId, tab: tabFromUrl, onTabChange, onNavigate }) {
  const locations = context?.locations || []
  const activeId = locationId || locations[0]?.id || null
  const tab = TABS.some((t) => t.key === tabFromUrl) ? tabFromUrl : 'online'
  const setTab = onTabChange
  const [settings, setSettings] = useState(null)
  // Адрес заведения — канонический источник для гостевой страницы
  const [businessAddress, setBusinessAddress] = useState('')
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
          setBusinessAddress(data.receipt_address || '')
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
        <PageHeader eyebrow={context.organization?.name} title="QR Menu & Online" />
        <p className="empty-state">No locations are linked to this account.</p>
      </>
    )
  }

  // Адрес гостевой страницы считается один раз на экран: его показывает
  // шапка канала И грузит превью, и разойтись они не имеют права.
  const guestUrl = tab === 'online' ? orderUrl(activeId, slug) : reserveUrl(activeId, slug)
  // Каталог редактируется в своём разделе. Ярлык показываем только
  // тому, у кого этот раздел вообще есть: ссылка в никуда хуже её
  // отсутствия.
  const canManageCatalogue = typeof onNavigate === 'function' && hasCapability(context, 'catalog_manage')

  return (
    <>
      <PageHeader
        eyebrow={context.organization?.name}
        title="QR Menu & Online"
        description="The pages your guests open by scanning a code — ordering and table booking."
      />

      {/* Ровно два канала — ровно две вкладки. Клавиатура и RTL живут в
          общем примитиве Tabs, а не переписываются здесь заново. */}
      <Tabs
        className="channel-tabs"
        label="Channel"
        items={TABS}
        value={tab}
        // Группы принадлежат каналу: при смене вкладки закрываем
        // открытую, иначе на соседней вкладке раскрылась бы чужая.
        onChange={(key) => { setTab(key); setOpenGroup(null) }}
      />

      {/* Место под отклик зарезервировано: «Saved» не должен сдвигать
          весь экран на строку вниз каждый раз, когда он появляется. */}
      <div className="qr-feedback">
        {error && <p className="form-error" role="alert">{error}</p>}
        {saved && !error && <p className="save-ok inline"><Check /> Saved</p>}
      </div>

      {settings === null ? (
        <p className="empty-state">Loading…</p>
      ) : (
        <div className="qr-workspace">
          <div className="qr-workspace-main">
            {tab === 'online' ? (
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
                url={guestUrl}
                openGroup={openGroup}
                onOpenGroup={setOpenGroup}
                onManageCatalogue={canManageCatalogue ? () => onNavigate('menu') : null}
              />
            ) : (
              <ReserveTab
                key={activeId}
                locationId={activeId}
                settings={settings}
                patch={makePatcher('reservations', saveReservations)}
                slug={slug}
                businessAddress={businessAddress}
                tz={locations.find((l) => l.id === activeId)?.timezone || 'Asia/Jerusalem'}
                url={guestUrl}
                openGroup={openGroup}
                onOpenGroup={setOpenGroup}
              />
            )}
          </div>

          {/* Превью — второй канал правды на экране: настройка слева,
              её результат справа. Ключ по каналу и точке: это разные
              страницы, и переиспользовать кадр между ними нельзя. */}
          <aside className="qr-workspace-side">
            {tab === 'online' ? (
              <GuestPreview key={`online:${activeId}`} url={guestUrl} />
            ) : (
              <GuestPreview
                key={`reserve:${activeId}`}
                url={guestUrl}
                title="Booking page preview"
                description="The page guests open from the booking link."
                iframeTitle="Guest booking page preview"
                openLabel="Open booking page"
                blockedLinkLabel="Open the booking page"
              />
            )}
          </aside>
        </div>
      )}
    </>
  )
}
