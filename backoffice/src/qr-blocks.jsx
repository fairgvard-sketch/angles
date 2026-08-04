import { useEffect, useRef, useState } from 'react'
import { Check, ChevronRight, Copy, Download, ExternalLink } from 'lucide-react'
import QRCode from 'qrcode'

/**
 * Общие блоки экрана QR-каналов: копирование ссылок, QR-коды, тумблеры,
 * поля и раскрывающиеся группы настроек.
 *
 * Вынесены из QrChannels.jsx: экран строится из двух слоёв — «канал
 * работает, вот ссылка» сверху и свёрнутые группы настроек ниже, и оба
 * слоя используют одни и те же примитивы.
 */

/** Копирование в буфер с состоянием кнопки и понятным отказом. */
export function useCopy(text) {
  const [state, setState] = useState('idle')

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
      setTimeout(() => setState('idle'), 2000)
    } catch {
      // Буфер закрыт политикой браузера — просим скопировать вручную
      setState('failed')
    }
  }

  return [state, copy]
}

/** Скачивание QR в размере, пригодном для типографии. */
export async function downloadQr(url, name) {
  try {
    const dataUrl = await QRCode.toDataURL(url, {
      width: 1024,
      margin: 4,
      errorCorrectionLevel: 'H',
    })
    const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'guest'
    const anchor = document.createElement('a')
    anchor.href = dataUrl
    anchor.download = `${safeName}-qr.png`
    anchor.click()
  } catch {
    // Экранный QR остаётся доступен, даже если браузер запретил скачивание.
  }
}

/** Canvas с QR-кодом ссылки. */
export function QrCanvas({ url, size = 176, className = 'qr-canvas', label = 'Guest link' }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (canvasRef.current && url) {
      QRCode.toCanvas(canvasRef.current, url, { width: size, margin: 1 }).catch(() => {})
    }
  }, [url, size])

  return <canvas ref={canvasRef} className={className} aria-label={`QR code — ${label}`} />
}

/**
 * QR + ссылка с копированием, открытием и скачиванием PNG.
 *
 * Таких блоков на экране несколько (стойка, конкретный стол, бронь), а
 * подписи кнопок одинаковые. Скринридер читал бы «Copy link, Copy link,
 * Copy link», поэтому в доступное имя добавляется, какая это ссылка;
 * видимый текст в нём сохраняется целиком (WCAG «Label in Name»).
 */
export function LinkBlock({ url, hint, title = 'Guest link' }) {
  const [copyState, copy] = useCopy(url)

  return (
    <div className="qr-block">
      <div className="qr-block-text">
        <h3>{title}</h3>
        <p>{hint}</p>
        <div className="qr-link-row">
          <input value={url} readOnly aria-label={`${title} — address`} onFocus={(e) => e.target.select()} />
        </div>
        <div className="qr-actions">
          <button type="button" className="secondary-button" aria-label={`Copy link — ${title}`} onClick={copy}>
            {copyState === 'copied' ? <><Check /> Copied</> : <><Copy /> Copy link</>}
          </button>
          <button
            type="button"
            className="secondary-button"
            aria-label={`Download PNG — ${title}`}
            onClick={() => downloadQr(url, title)}
          >
            <Download /> Download PNG
          </button>
          <a
            className="secondary-button"
            href={url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open menu — ${title}`}
          >
            <ExternalLink /> Open menu
          </a>
        </div>
        {copyState === 'failed' && (
          <p className="qr-copy-error" role="alert">Copy was blocked. Select the link above and copy it manually.</p>
        )}
      </div>
      <QrCanvas url={url} label={title} />
    </div>
  )
}

/**
 * Готовый HTML-сниппет для сайта ресторана: readonly-код + копирование.
 * Тот же паттерн копирования, что LinkBlock; QR здесь не нужен.
 */
export function SnippetBlock({ title, hint, code }) {
  const [copyState, copy] = useCopy(code)

  return (
    <div className="qr-block-text snippet-block">
      <h3>{title}</h3>
      <p>{hint}</p>
      <div className="qr-field">
        <textarea
          value={code}
          readOnly
          aria-label={`${title} — HTML`}
          rows={code.split('\n').length}
          spellCheck={false}
          onFocus={(e) => e.target.select()}
        />
      </div>
      <div className="qr-actions">
        <button type="button" className="secondary-button" aria-label={`Copy code — ${title}`} onClick={copy}>
          {copyState === 'copied' ? <><Check /> Copied</> : <><Copy /> Copy code</>}
        </button>
      </div>
      {copyState === 'failed' && (
        <p className="qr-copy-error" role="alert">Copy was blocked. Select the code above and copy it manually.</p>
      )}
    </div>
  )
}

/** Тумблер в стиле кассового ToggleRow. */
export function Toggle({ label, hint, checked, onChange, disabled }) {
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

export function Field({ label, hint, children }) {
  return (
    <label className="qr-field">
      <span>{label}</span>
      {children}
      {/* Подпись под полем раньше молча терялась: компонент принимал
          только label, а вызывающий думал, что объяснил владельцу, откуда
          берётся значение. */}
      {hint && <small>{hint}</small>}
    </label>
  )
}

export function NumberSelect({ value, fallback, options, onChange }) {
  return (
    <select value={value ?? fallback} onChange={(e) => onChange(Number(e.target.value))}>
      {options.map((n) => <option key={n} value={n}>{n}</option>)}
    </select>
  )
}

/**
 * Раскрывающаяся группа настроек — строка списка.
 *
 * Свёрнутая строка показывает текущее значение (`value`), поэтому проверить
 * настройку можно не открывая её. Открытое состояние держит вызывающий
 * компонент — так группы переживают перерисовку после сохранения и можно
 * открыть нужную по умолчанию.
 *
 * Значение стоит под заголовком, а не в правом краю: на узкой колонке
 * рабочей области правая колонка схлопывалась до многоточия, и владелец
 * видел «Sun–Thu 08:00…» вместо расписания. Подпись-подсказка остаётся
 * третьей строкой — она объясняет, ЧТО настраивается, а значение
 * отвечает, КАК сейчас.
 *
 * Нажимается вся строка целиком: `Edit` — подпись, усиливающая действие,
 * а не единственная цель, поэтому она скрыта от скринридера (кнопка уже
 * названа заголовком).
 */
export function SettingGroup({ icon: Icon, title, hint, value, open, onToggle, children }) {
  return (
    <section className={`setting-group${open ? ' is-open' : ''}`}>
      <button type="button" className="setting-group-head" aria-expanded={open} onClick={onToggle}>
        <span className="setting-group-icon" aria-hidden><Icon /></span>
        <span className="setting-group-text">
          <strong>{title}</strong>
          {value && <span className="setting-group-value">{value}</span>}
          {hint && <small>{hint}</small>}
        </span>
        <span className="setting-group-edit" aria-hidden>{open ? 'Close' : 'Edit'}</span>
        <span className="setting-group-chevron" aria-hidden><ChevronRight /></span>
      </button>
      {open && <div className="setting-group-body">{children}</div>}
    </section>
  )
}

/**
 * Строка того же списка, но ведущая в соседний раздел кабинета.
 *
 * Не кнопка на всю строку: внутри лежит настоящая кнопка перехода, а
 * интерактивный элемент внутри интерактивного — это и сломанная
 * клавиатура, и невнятное объявление скринридером.
 */
export function SettingLink({ icon: Icon, title, hint, value, actionLabel, onAction }) {
  return (
    <section className="setting-group is-static">
      <div className="setting-group-head">
        <span className="setting-group-icon" aria-hidden><Icon /></span>
        <span className="setting-group-text">
          <strong>{title}</strong>
          {value && <span className="setting-group-value">{value}</span>}
          {hint && <small>{hint}</small>}
        </span>
        <button type="button" className="text-button setting-group-action" onClick={onAction}>
          {actionLabel}
        </button>
      </div>
    </section>
  )
}
