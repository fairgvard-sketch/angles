import { useEffect, useRef, useState } from 'react'
import { Button } from './Button'
import { overlayClass, useOverlayExit } from './overlay-motion'
import { focusOnOpen } from './focus-entry'

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
  /*
   * Ошибка сервера показывается ЗДЕСЬ, а не на странице за диалогом:
   * иначе человек видит закрывшийся диалог, набранную причину теряет и
   * не понимает, изменилось ли что-нибудь.
   */
  error = '',
  busy = false,
  onConfirm,
  onCancel,
}) {
  const panelRef = useRef(null)
  const returnRef = useRef(null)
  const firstRef = useRef(null)
  const [text, setText] = useState('')
  /*
   * Отказ от действия уводит диалог тем же путём, которым он пришёл.
   * Подтверждение — дело экрана: он ждёт сервера и снимает диалог сам.
   *
   * Слой берётся один раз, на монтирование: диалог открывается поверх
   * панели, и клавиатура принадлежит ему, пока он не начал уходить.
   */
  const { closing, close, isTop } = useOverlayExit(onCancel)

  const hasReason = Boolean(reason)

  useEffect(() => {
    returnRef.current = document.activeElement
    const panel = panelRef.current
    /*
     * Кнопка отказа фокусируется всегда — клавиатуру она не вызывает.
     * Поле причины — только с мышью: пальцем клавиатура выехала бы
     * прежде, чем человек успел прочитать сам вопрос.
     */
    if (hasReason) focusOnOpen(panel, firstRef.current)
    else firstRef.current?.focus()

    function onKey(event) {
      if (!isTop()) return
      if (event.key === 'Escape') {
        event.stopPropagation()
        close()
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
  }, [close, isTop, hasReason])

  return (
    <div className={overlayClass('sheet-backdrop', closing)} onClick={close} role="presentation">
      <div
        className="sheet confirm-dialog"
        ref={panelRef}
        tabIndex={-1}
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
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="order-actions">
          <Button ref={reason ? undefined : firstRef} onClick={close}>{cancelLabel}</Button>
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
