import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { IconButton } from './Button'

/**
 * Боковая панель для деталей и правки.
 *
 * Почему панель, а не модалка по центру: открывая визит, хостес не
 * должен терять из виду сетку зала — список, фильтры и позиция
 * прокрутки остаются на месте, а решение принимается рядом с ними.
 *
 * Что панель обязана делать и чего раньше не делал ни один из десяти
 * самодельных диалогов кабинета:
 *   • закрываться по Escape;
 *   • держать фокус внутри, пока открыта (Tab не уводит на фон);
 *   • возвращать фокус туда, откуда её открыли;
 *   • объявляться как диалог с именем.
 */
export default function Drawer({ title, subtitle, onClose, children, footer, labelledBy }) {
  const panelRef = useRef(null)
  const returnRef = useRef(null)
  const titleId = labelledBy || 'drawer-title'

  useEffect(() => {
    returnRef.current = document.activeElement
    const panel = panelRef.current
    // Первый фокус — на саму панель: читалка объявит заголовок целиком,
    // а не первое попавшееся поле.
    panel?.focus()

    function focusables() {
      return [...(panel?.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? [])]
    }

    function onKey(event) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      // Ловушка фокуса: за пределами панели сейчас нет ничего, чем можно
      // пользоваться, и уводить туда клавиатуру — значит терять человека.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey, true)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prevOverflow
      // Фокус возвращаем туда, откуда пришли: иначе клавиатурный
      // пользователь после закрытия оказывается в начале документа.
      if (returnRef.current instanceof HTMLElement) returnRef.current.focus()
    }
  }, [onClose])

  return (
    <div className="drawer-backdrop" onClick={onClose} role="presentation">
      <aside
        className="drawer"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="drawer-head">
          <div>
            <h3 id={titleId}>{title}</h3>
            {subtitle && <p className="drawer-sub">{subtitle}</p>}
          </div>
          <IconButton label="Close" onClick={onClose}><X /></IconButton>
        </header>
        <div className="drawer-body">{children}</div>
        {footer && <footer className="drawer-foot">{footer}</footer>}
      </aside>
    </div>
  )
}
