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
 * Заголовок раздела — одна рабочая строка: название и, если они есть,
 * действия раздела справа. Ровно то же, что уже стоит в Orders,
 * Catalogue и Reservations.
 *
 * Ни надзаголовка с названием организации, ни описания раздела здесь
 * нет намеренно: организация и точка и так стоят в шапке приложения,
 * а раздел открывают, чтобы работать, а не чтобы прочитать, что это
 * за раздел.
 *
 * `children` — строка данных под названием (охват отчёта и подобное),
 * а не подпись к разделу.
 */
export function PageHeader({ title, actions, children }) {
  return (
    <section className="page-heading">
      <h1>{title}</h1>
      {actions && <div className="page-heading-actions">{actions}</div>}
      {children}
    </section>
  )
}

/**
 * Панель с необязательной шапкой: заголовок, подпись и действия справа.
 *
 * `titleId` нужен, когда панель — адресуемая секция страницы: обёртка
 * ссылается на её заголовок через `aria-labelledby`, и читалка называет
 * место, к которому подвела ссылка, а не «группа».
 */
export function Panel({ title, titleId, description, actions, className = '', children }) {
  return (
    <section className={className ? `panel ${className}` : 'panel'}>
      {(title || actions) && (
        <div className="panel-heading">
          <div>
            {title && <h2 id={titleId}>{title}</h2>}
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
