import { Component, Fragment } from 'react'
import { AlertTriangle } from 'lucide-react'
import { logViewError, safeErrorReport } from './errors'

/**
 * Граница ошибки уровня раздела.
 *
 * До неё любая ошибка рендера в одном модуле (например, свободная
 * переменная во вкладке «Модификаторы») размонтировала всё дерево React —
 * владелец получал белый экран и не мог даже уйти в другой раздел.
 * Граница стоит ВНУТРИ рабочей области: меню, шапка и выбор точки
 * остаются живыми, падает только содержимое.
 *
 * Сброс — по смене раздела (`key={view}` снаружи) и по кнопке «Try
 * again»: без неё единственный способ восстановиться — перезагрузка,
 * которая теряет и несохранённую работу, и место в интерфейсе.
 */
export default class ViewErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, attempt: 0 }
    this.retry = this.retry.bind(this)
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    logViewError(safeErrorReport(this.props.view, error, info))
  }

  retry() {
    // attempt меняет key поддерева: повтор должен начинаться с чистого
    // монтирования, иначе сломанное состояние падает снова тем же местом.
    this.setState((prev) => ({ error: null, attempt: prev.attempt + 1 }))
  }

  render() {
    const { error } = this.state
    if (!error) {
      return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>
    }
    return (
      <section className="panel view-crash" role="alert">
        <span className="view-crash-icon" aria-hidden><AlertTriangle /></span>
        <h2>This section could not be displayed</h2>
        <p>
          The rest of the back office keeps working — pick another section in the
          menu, or try this one again.
        </p>
        <div className="order-actions">
          <button type="button" className="primary-button compact" onClick={this.retry}>
            Try again
          </button>
          {this.props.onHome && (
            <button type="button" className="secondary-button" onClick={this.props.onHome}>
              Go to Dashboard
            </button>
          )}
        </div>
        {/* Техническая строка — вычищенная от данных: с ней обращение в
            поддержку осмысленно, без неё остаётся «что-то сломалось». */}
        <p className="view-crash-detail">
          {safeErrorReport(this.props.view, error, null).message || 'Unknown error'}
        </p>
      </section>
    )
  }
}
