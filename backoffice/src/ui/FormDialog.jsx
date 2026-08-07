import { useEffect, useRef } from 'react'
import { Button } from './Button'
import { overlayClass, useOverlayExit } from './overlay-motion'

/**
 * Компактный диалог с формой: завести категорию, группу модификаторов,
 * модификатор или станцию.
 *
 * Заменяет два способа, которыми это делалось раньше, и оба плохи:
 *   • инлайн-поле в панели инструментов — появляясь, оно сдвигало
 *     соседние кнопки, и владелец нажимал не туда;
 *   • `window.prompt` — в части браузеров и внутри кадра он просто не
 *     поддерживается, а там, где есть, спрашивает цену без валюты и без
 *     права передумать на втором шаге.
 *
 * Ведёт себя как диалог: Escape отменяет (пока не идёт запись), фокус
 * входит внутрь и не уходит на фон, после закрытия возвращается на
 * кнопку-источник, ошибка сервера показывается ЗДЕСЬ — иначе диалог
 * закрывается, набранное теряется, и непонятно, изменилось ли что-то.
 */
export default function FormDialog({
  title,
  description,
  submitLabel = 'Save',
  cancelLabel = 'Cancel',
  error = '',
  busy = false,
  onSubmit,
  onCancel,
  children,
}) {
  const panelRef = useRef(null)
  const returnRef = useRef(null)
  // Занятость читается из ref: пересобирать обработчик клавиш на каждый
  // вдох формы значит терять место в стеке слоёв.
  const busyRef = useRef(busy)
  busyRef.current = busy
  // Отмена уводит лист вниз (на телефоне) или гасит его на месте (на
  // десктопе), и только после этого экран снимает диалог.
  const { closing, close, isTop } = useOverlayExit(onCancel)

  useEffect(() => {
    returnRef.current = document.activeElement
    const panel = panelRef.current
    // Первое поле формы, а не кнопка: диалог открыт, чтобы что-то ввести.
    panel?.querySelector('input, select, textarea')?.focus()

    function onKey(event) {
      if (!isTop()) return
      if (event.key === 'Escape') {
        event.stopPropagation()
        // Закрыть форму посреди записи — значит не узнать, чем она
        // кончилась: запрос уже ушёл.
        if (!busyRef.current) close()
        return
      }
      if (event.key !== 'Tab') return
      const items = [...(panel?.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
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
  }, [close, isTop])

  return (
    <div
      className={overlayClass('sheet-backdrop', closing)}
      onClick={busy ? undefined : close}
      role="presentation"
    >
      <form
        className="sheet form-dialog"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="form-dialog-title"
        aria-busy={busy || undefined}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => { event.preventDefault(); onSubmit() }}
      >
        <h3 id="form-dialog-title">{title}</h3>
        {description && <p className="sheet-sub">{description}</p>}
        <div className="form-dialog-body">{children}</div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="order-actions">
          <Button onClick={close} disabled={busy}>{cancelLabel}</Button>
          <Button variant="primary" size="compact" type="submit" busy={busy} busyLabel="Saving…">
            {submitLabel}
          </Button>
        </div>
      </form>
    </div>
  )
}
