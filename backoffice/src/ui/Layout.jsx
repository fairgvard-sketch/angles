import { Search } from 'lucide-react'

/**
 * Каркасные примитивы раздела: заголовок страницы, панель, поиск,
 * состояние-пустышка и метка состояния.
 *
 * Всё это уже было на каждом экране, но переписанное заново — с чуть
 * разными отступами, разной вложенностью и, местами, без доступного
 * имени у поля поиска. Классы сохранены прежние: шаг вводит общую
 * реализацию, а не новую верстку.
 */

/**
 * Заголовок страницы. `compact` — рабочий режим (40px), крупный вариант
 * остаётся только там, где страница действительно титульная.
 *
 * `actions` — действия раздела справа от заголовка (выгрузка, обновление).
 * Разметка с обёрткой появляется только когда они переданы: разделы без
 * действий обязаны отрендериться ровно так же, как раньше.
 */
export function PageHeader({ eyebrow, title, description, compact = true, actions, children }) {
  const copy = (
    <>
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </>
  )
  const className = compact ? 'page-heading compact-heading' : 'page-heading'
  if (!actions) {
    return <section className={className}>{copy}{children}</section>
  }
  return (
    <section className={`${className} has-actions`}>
      <div className="page-heading-copy">{copy}</div>
      <div className="page-heading-actions">{actions}</div>
      {children}
    </section>
  )
}

/** Панель с необязательной шапкой: заголовок, подпись и действия справа */
export function Panel({ title, description, actions, className = '', children }) {
  return (
    <section className={className ? `panel ${className}` : 'panel'}>
      {(title || actions) && (
        <div className="panel-heading">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

/**
 * Поле поиска. Подпись обязательна и живёт визуально скрытой: поле с
 * одним лишь плейсхолдером для скринридера безымянно, а плейсхолдер
 * исчезает ровно тогда, когда пользователь начал печатать.
 */
export function SearchField({
  label,
  value,
  onChange,
  placeholder,
  className = 'order-search',
  type = 'search',
}) {
  return (
    <label className={className}>
      <Search aria-hidden />
      <span className="visually-hidden">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

/** Короткое пустое состояние внутри панели или списка */
export function EmptyState({ children }) {
  return <p className="empty-state">{children}</p>
}

/**
 * Крупное пустое состояние раздела: иконка, что это, и что сделать,
 * чтобы здесь что-то появилось.
 */
export function EmptyPanel({ icon, title, description, action }) {
  return (
    <section className="section-placeholder panel">
      <span className="section-icon">{icon}</span>
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
        {action}
      </div>
    </section>
  )
}

/**
 * Метка состояния. Текст обязателен: точка сама по себе — состояние,
 * переданное одним лишь цветом, и его не увидит ни дальтоник, ни
 * скринридер.
 */
export function StatusBadge({ tone, label, className = 'status' }) {
  return (
    <span className={tone ? `${className} is-${tone}` : className}>
      <i aria-hidden />
      {label}
    </span>
  )
}

/** Сообщение об ошибке рядом с тем, что сломалось */
export function ErrorText({ children }) {
  return <p className="form-error" role="alert">{children}</p>
}
