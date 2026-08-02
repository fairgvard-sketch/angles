import { useEffect, useRef, useState } from 'react'
import { Button } from './Button'

/**
 * Подтверждение действия — с необязательным полем причины.
 *
 * Заменяет `window.prompt`, который в кабинете отвечал за причину отказа
 * гостю. Нативный prompt плох не только видом: в части браузеров и в
 * кабинете внутри iframe он просто не поддерживается («prompt() is not
 * supported»), и действие тихо уходило без причины — или не уходило
 * вовсе.
 *
 * Ведёт себя как диалог: Escape отменяет, фокус входит внутрь и не
 * уходит на фон, после закрытия возвращается на кнопку-источник.
 */
export default function ConfirmDialog({
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  reason = null, // { label, placeholder, optional }
  busy = false,
  onConfirm,
  onCancel,
}) {
  const panelRef = useRef(null)
  const returnRef = useRef(null)
  const firstRef = useRef(null)
  const [text, setText] = useState('')

  useEffect(() => {
    returnRef.current = document.activeElement
    firstRef.current?.focus()
    const panel = panelRef.current

    function onKey(event) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCancel()
        return
      }
      if (event.key !== 'Tab') return
      const items = [...(panel?.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled])'
      ) ?? [])]
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      if (returnRef.current instanceof HTMLElement) returnRef.current.focus()
    }
  }, [onCancel])

  return (
    <div className="sheet-backdrop" onClick={onCancel} role="presentation">
      <div
        className="sheet confirm-dialog"
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="confirm-title">{title}</h3>
        {description && <p className="sheet-sub">{description}</p>}
        {reason && (
          <label className="qr-field">
            <span>{reason.label}{reason.optional === false ? '' : ' (optional)'}</span>
            <input
              ref={firstRef}
              value={text}
              maxLength={200}
              placeholder={reason.placeholder}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
        )}
        <div className="order-actions">
          <Button ref={reason ? undefined : firstRef} onClick={onCancel}>{cancelLabel}</Button>
          <Button
            variant={tone === 'danger' ? 'secondary' : 'primary'}
            size="compact"
            className={tone === 'danger' ? 'is-danger' : undefined}
            busy={busy}
            busyLabel="Working…"
            onClick={() => onConfirm(text.trim() || null)}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
