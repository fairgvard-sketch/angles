import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, MoreHorizontal } from 'lucide-react'
import { IconButton } from './Button'

/**
 * Управление строкой таблицы: меню редких действий и стрелки порядка.
 *
 * Оба примитива доказаны тремя вкладками каталога — товарами, группами
 * модификаторов и станциями. Раньше каждая вкладка решала это по-своему:
 * корзина прямо в строке (нажимается случайно), безымянный «плюс» и
 * порядок, который менялся только перетаскиванием, то есть не менялся
 * ни пальцем, ни с клавиатуры.
 */

/**
 * Меню действий строки. Открывается по кнопке с именем, закрывается по
 * Escape и щелчку мимо.
 *
 * Escape ГАСИТСЯ здесь (`stopPropagation`): меню живёт внутри боковой
 * панели, и один Escape обязан закрывать верхний слой — меню, — а не
 * панель вместе с ним.
 */
export function RowMenu({ label, items, disabled, onPick }) {
  const ref = useRef(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return undefined
    function onDocClick(event) {
      if (!ref.current?.contains(event.target)) setOpen(false)
    }
    function onKey(event) {
      if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) }
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const usable = (items ?? []).filter(Boolean)
  if (usable.length === 0) return null
  return (
    <div className="row-menu" ref={ref}>
      <IconButton
        label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal />
      </IconButton>
      {open && (
        <div className="row-menu-pop" role="menu">
          {usable.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className={item.tone === 'danger' ? 'is-danger' : undefined}
              onClick={() => { setOpen(false); item.onPick ? item.onPick() : onPick?.(item.key) }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Порядок на шаг вверх/вниз.
 *
 * Стрелки, а не перетаскивание: пальцем на планшете и с клавиатуры
 * перетаскивание одинаково недоступно, а поменять местами два блюда
 * владельцу нужно каждую неделю.
 *
 * `stopPropagation` в обработчике — не перестраховка: строка таблицы
 * рядом умеет открывать карточку, и Enter на стрелке не должен заодно
 * открывать панель.
 */
export function OrderButtons({ label, index, total, disabled, onMove }) {
  const first = index <= 0
  const last = index >= total - 1
  return (
    <span className="row-order">
      <IconButton
        label={`Move ${label} up`}
        disabled={disabled || first}
        onClick={(event) => { event.stopPropagation(); onMove('up') }}
      >
        <ArrowUp />
      </IconButton>
      <IconButton
        label={`Move ${label} down`}
        disabled={disabled || last}
        onClick={(event) => { event.stopPropagation(); onMove('down') }}
      >
        <ArrowDown />
      </IconButton>
    </span>
  )
}
