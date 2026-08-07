import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { IconButton } from './Button'
import { overlayClass, useOverlayExit } from './overlay-motion'

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
 *
 * `modal` — перехватывает ли панель работу со страницей. По умолчанию
 * да: визит открывают, чтобы принять по нему решение. Заказам нужно
 * другое — там панель стоит рядом с таблицей, и щелчок по соседней
 * строке обязан ОТКРЫТЬ её, а не закрыть панель. Немодальный вариант
 * отличается четырьмя вещами: фон не ловит клики, прокрутка страницы не
 * блокируется, Tab может уйти в список, и для скринридера остальная
 * страница остаётся доступной (`aria-modal` снят). Escape закрывает в
 * обоих случаях.
 *
 * Панель приезжает и уезжает: сбоку на широком экране, снизу на
 * телефоне. Уход идёт через `useOverlayExit` — иначе поверхность в пол-
 * экрана пропадала в один кадр, и было не видно, куда она делась.
 */
export default function Drawer({
  title, subtitle, onClose, children, footer, actions, labelledBy, modal = true,
}) {
  const panelRef = useRef(null)
  const returnRef = useRef(null)
  const titleId = labelledBy || 'drawer-title'
  /*
   * Место в стеке слоёв и уход панели живут в одном хуке: место берётся
   * ОДИН раз, на монтирование, и отдаётся в момент начала ухода.
   *
   * Соблазнительно было положить регистрацию в общий эффект ниже, но
   * тот перезапускается при смене `modal`, а перерегистрация возвращает
   * панель на вершину стека — и открытый поверх неё диалог снова теряет
   * Escape.
   */
  const { closing, close, isTop } = useOverlayExit(onClose)

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
      if (!isTop()) return
      if (event.key === 'Escape') {
        event.stopPropagation()
        close()
        return
      }
      // Ловушка фокуса — свойство модального слоя: рядом с немодальной
      // панелью список остаётся рабочим, и уводить из неё Tab нормально.
      if (event.key !== 'Tab' || !modal) return
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
    if (modal) document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey, true)
      if (modal) document.body.style.overflow = prevOverflow
      // Фокус возвращаем туда, откуда пришли: иначе клавиатурный
      // пользователь после закрытия оказывается в начале документа.
      if (returnRef.current instanceof HTMLElement) returnRef.current.focus()
    }
  }, [close, isTop, modal])

  return (
    <div
      className={overlayClass(modal ? 'drawer-backdrop' : 'drawer-backdrop is-bare', closing)}
      onClick={modal ? close : undefined}
      role="presentation"
    >
      <aside
        className="drawer"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        // Ложный aria-modal хуже отсутствующего: он объявляет остальную
        // страницу недоступной, а рядом с немодальной панелью список
        // работает и им пользуются.
        aria-modal={modal || undefined}
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="drawer-head">
          <div>
            <h3 id={titleId}>{title}</h3>
            {subtitle && <p className="drawer-sub">{subtitle}</p>}
          </div>
          <div className="drawer-head-actions">
            {actions}
            <IconButton label="Close" onClick={close}><X /></IconButton>
          </div>
        </header>
        <div className="drawer-body">{children}</div>
        {footer && <footer className="drawer-foot">{footer}</footer>}
      </aside>
    </div>
  )
}
