import { useRef } from 'react'

/**
 * Вкладки раздела.
 *
 * В кабинете восемь мест объявляют `role="tablist"`, и ни одно из них не
 * работает с клавиатуры: скринридер обещает вкладки, стрелки не двигают
 * ничего, а `tabindex` у всех кнопок одинаковый — Tab прогоняет по всем
 * пяти вместо одного входа в группу.
 *
 * Здесь это сделано один раз и по правилам WAI-ARIA: одна точка входа
 * (roving tabindex), стрелки внутри группы, Home/End по краям. Стрелки
 * учитывают направление письма — в RTL «вправо» означает предыдущую
 * вкладку, иначе владелец на иврите будет ходить задом наперёд.
 *
 * Классы задаёт вызывающий экран: компонент вводит поведение, а не новый
 * внешний вид.
 */
export default function Tabs({
  label,
  items,
  value,
  onChange,
  className = '',
  tabClassName = '',
  activeClassName = 'is-active',
}) {
  const listRef = useRef(null)

  function focusTab(index) {
    const buttons = listRef.current?.querySelectorAll('[role="tab"]')
    const button = buttons?.[index]
    if (!button) return
    button.focus()
    // Активная вкладка обязана быть видна: полоса прокручиваемая, и
    // «Analytics» на телефоне живёт за правым краем.
    button.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  function onKeyDown(event, index) {
    const rtl = listRef.current
      ? getComputedStyle(listRef.current).direction === 'rtl'
      : false
    const last = items.length - 1
    let next = null
    if (event.key === 'ArrowRight') next = rtl ? index - 1 : index + 1
    else if (event.key === 'ArrowLeft') next = rtl ? index + 1 : index - 1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = last
    if (next === null) return
    event.preventDefault()
    // По кругу: с последней вкладки вправо — на первую.
    if (next < 0) next = last
    if (next > last) next = 0
    onChange(items[next].key)
    focusTab(next)
  }

  return (
    <div className={className} role="tablist" aria-label={label} ref={listRef}>
      {items.map((item, index) => {
        const active = item.key === value
        const classes = []
        if (tabClassName) classes.push(tabClassName)
        if (active && activeClassName) classes.push(activeClassName)
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            // Одна точка входа в группу: Tab заводит на активную вкладку,
            // дальше движение стрелками.
            tabIndex={active ? 0 : -1}
            className={classes.join(' ')}
            onClick={() => onChange(item.key)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {item.icon}
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
