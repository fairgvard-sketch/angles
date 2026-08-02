/**
 * Кнопки кабинета — одна реализация вместо четырёх классов, которые
 * раскиданы по экранам 151 раз.
 *
 * Классы намеренно остались прежние (`primary-button`, `secondary-button`,
 * `text-button`, `icon-button`): этот шаг вводит компонент, а не новый
 * внешний вид. Меняется то, что раньше зависело от внимательности автора
 * экрана — тип кнопки, состояние занятости и доступное имя у иконки.
 */

const VARIANT_CLASS = {
  primary: 'primary-button',
  secondary: 'secondary-button',
  text: 'text-button',
}

/**
 * `type="button"` по умолчанию — это не мелочь: кнопка без типа внутри
 * формы отправляет её, и «Отмена» превращается в «Сохранить».
 */
export function Button({
  variant = 'secondary',
  size = 'default',
  busy = false,
  busyLabel,
  disabled = false,
  className = '',
  type = 'button',
  children,
  ...rest
}) {
  const classes = [VARIANT_CLASS[variant] || VARIANT_CLASS.secondary]
  if (size === 'compact') classes.push('compact')
  if (className) classes.push(className)
  return (
    <button
      type={type}
      className={classes.join(' ')}
      disabled={disabled || busy}
      // Занятость — состояние, а не только текст: скринридер обязан
      // услышать, что кнопка сейчас работает.
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy && busyLabel ? busyLabel : children}
    </button>
  )
}

/**
 * Кнопка-иконка. `label` обязателен: иконка без доступного имени — это
 * кнопка «безымянная» для скринридера и подсказка «непонятно что» для
 * зрячего. В строках списка label должен называть объект: «Rename
 * Стойка 1», а не «Rename».
 */
export function IconButton({ label, title, className = '', type = 'button', children, ...rest }) {
  if (!label && process.env.NODE_ENV !== 'production') {
    console.error('IconButton: label обязателен — кнопка-иконка без имени недоступна')
  }
  return (
    <button
      type={type}
      className={className ? `icon-button ${className}` : 'icon-button'}
      aria-label={label}
      title={title}
      {...rest}
    >
      {children}
    </button>
  )
}
