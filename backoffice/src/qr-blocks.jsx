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
export function QrCanvas({ url, size = 176, className = 'qr-canvas' }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (canvasRef.current && url) {
      QRCode.toCanvas(canvasRef.current, url, { width: size, margin: 1 }).catch(() => {})
    }
  }, [url, size])

  return <canvas ref={canvasRef} className={className} aria-label="QR code for the guest link" />
}

/** QR + ссылка с копированием, открытием и скачиванием PNG. */
export function LinkBlock({ url, hint, title = 'Guest link' }) {
  const [copyState, copy] = useCopy(url)

  return (
    <div className="qr-block">
      <div className="qr-block-text">
        <h3>{title}</h3>
        <p>{hint}</p>
        <div className="qr-link-row">
          <input value={url} readOnly onFocus={(e) => e.target.select()} />
        </div>
        <div className="qr-actions">
          <button type="button" className="secondary-button" onClick={copy}>
            {copyState === 'copied' ? <><Check /> Copied</> : <><Copy /> Copy link</>}
          </button>
          <button type="button" className="secondary-button" onClick={() => downloadQr(url, title)}>
            <Download /> Download PNG
          </button>
          <a className="secondary-button" href={url} target="_blank" rel="noreferrer">
            <ExternalLink /> Open menu
          </a>
        </div>
        {copyState === 'failed' && (
          <p className="qr-copy-error" role="alert">Copy was blocked. Select the link above and copy it manually.</p>
        )}
      </div>
      <QrCanvas url={url} />
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
          rows={code.split('\n').length}
          spellCheck={false}
          onFocus={(e) => e.target.select()}
        />
      </div>
      <div className="qr-actions">
        <button type="button" className="secondary-button" onClick={copy}>
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

export function Field({ label, children }) {
  return (
    <label className="qr-field">
      <span>{label}</span>
      {children}
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
 * Раскрывающаяся группа настроек.
 *
 * Свёрнутая строка показывает текущее значение (`value`), поэтому проверить
 * настройку можно не открывая её. Открытое состояние держит вызывающий
 * компонент — так группы переживают перерисовку после сохранения и можно
 * открыть нужную по умолчанию.
 */
export function SettingGroup({ icon: Icon, title, hint, value, open, onToggle, children }) {
  return (
    <section className={`setting-group${open ? ' is-open' : ''}`}>
      <button type="button" className="setting-group-head" aria-expanded={open} onClick={onToggle}>
        <span className="setting-group-icon"><Icon /></span>
        <span>
          <strong>{title}</strong>
          <small>{hint}</small>
        </span>
        <span className="setting-group-value">{value}</span>
        <span className="setting-group-chevron" aria-hidden><ChevronRight /></span>
      </button>
      {open && <div className="setting-group-body">{children}</div>}
    </section>
  )
}
