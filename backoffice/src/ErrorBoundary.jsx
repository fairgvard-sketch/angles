import { Component, Fragment } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { logViewError, safeErrorReport } from './errors'
import { recoveryPlan } from './chunk-recovery'

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
 *
 * ДВА РАЗНЫХ ПАДЕНИЯ, КОТОРЫЕ ЛЕЧАТСЯ ПО-РАЗНОМУ.
 *
 * Обычная ошибка рендера чинится повторным монтированием. Пропавший
 * после выкладки чанк — НЕТ: `React.lazy` запоминает отклонённый
 * промис, и «Try again» отдаёт ту же ошибку сколько угодно раз. Там
 * помогает только перезагрузка документа, забирающая свежий
 * `index.html`. Что именно случилось, решает `chunk-recovery`, а не
 * владелец, читающий «Failed to fetch dynamically imported module».
 */
/**
 * sessionStorage бывает недоступен (приватный режим, запрет хранилища).
 * Обращение к нему само по себе кидает, и уронить границу ошибки на
 * попытке обработать ошибку — худший из возможных исходов.
 */
function safeSessionStorage() {
  try {
    return globalThis.sessionStorage ?? null
  } catch {
    return null
  }
}

export default class ViewErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, attempt: 0, stale: false }
    this.retry = this.retry.bind(this)
    this.reload = this.reload.bind(this)
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    logViewError(safeErrorReport(this.props.view, error, info))

    /*
     * Перезагрузка сохраняет адрес целиком — вместе с `view`, `tab`,
     * `loc` и датой. Владелец возвращается туда же, где был, а не на
     * дашборд.
     */
    const plan = recoveryPlan(error, {
      doc: this.props.doc ?? globalThis.document,
      storage: this.props.storage ?? safeSessionStorage(),
    })
    /*
     * Панель помечается устаревшей и когда перезагружаемся сами: пока
     * браузер уходит на новый документ, на экране обязана быть правда.
     * Иначе в эту долю секунды — а при медленной сети и дольше —
     * владелец видит «раздел не открылся» и кнопку «Try again»,
     * которая для пропавшего чанка заведомо не работает.
     */
    if (plan !== 'render') this.setState({ stale: true })
    if (plan === 'reload') {
      ;(this.props.reload ?? (() => globalThis.location?.reload()))()
    }
  }

  reload() {
    ;(this.props.reload ?? (() => globalThis.location?.reload()))()
  }

  retry() {
    // attempt меняет key поддерева: повтор должен начинаться с чистого
    // монтирования, иначе сломанное состояние падает снова тем же местом.
    this.setState((prev) => ({ error: null, attempt: prev.attempt + 1 }))
  }

  render() {
    const { error, stale } = this.state
    if (!error) {
      return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>
    }

    /*
     * Пропавший чанк называется своим именем. «Try again» здесь не
     * предлагается вовсе: он гарантированно не сработает, а кнопка,
     * которая заведомо не помогает, хуже её отсутствия.
     */
    if (stale) {
      return (
        <section className="panel view-crash" role="alert">
          <span className="view-crash-icon" aria-hidden><RefreshCw /></span>
          <h2>A new version was released</h2>
          <p>
            This tab is still running the previous version, and part of it is no
            longer available. Reloading picks up the new one — you stay on this
            same screen.
          </p>
          <div className="order-actions">
            <button type="button" className="primary-button compact" onClick={this.reload}>
              Reload updated version
            </button>
          </div>
        </section>
      )
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
