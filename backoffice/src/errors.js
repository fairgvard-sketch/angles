/**
 * Отчёт об упавшем разделе кабинета.
 *
 * Один упавший модуль не должен уносить весь кабинет, но и лог падения не
 * должен уносить данные клиента. В `error.message` попадает что угодно из
 * того, над чем модуль работал в момент падения: имя гостя, телефон,
 * почта, id брони. Поэтому наружу уходит ФОРМА ошибки — тип, вычищенное
 * сообщение и стек компонентов, — а не содержимое экрана.
 */

/** Телефон, почта, uuid и длинные числовые последовательности. */
const PATTERNS = [
  [/[^\s<>()[\]{}"',;:]+@[^\s<>()[\]{}"',;:]+\.[a-z]{2,}/gi, '[email]'],
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[id]'],
  [/\+?\d[\d ().-]{6,}\d/g, '[number]'],
]

/** Вырезать из строки всё, что может оказаться персональными данными. */
export function redact(text) {
  let out = String(text ?? '')
  for (const [pattern, mask] of PATTERNS) out = out.replace(pattern, mask)
  return out
}

/**
 * Что именно писать в консоль. Возвращает простой объект, чтобы его можно
 * было проверить тестом, а не разглядывать глазами в браузере.
 */
export function safeErrorReport(view, error, info) {
  const name = (error && error.name) || 'Error'
  const message = redact((error && error.message) || String(error ?? '')).slice(0, 200)
  const stack = redact((info && info.componentStack) || '').trim().slice(0, 800)
  return { view: String(view ?? 'unknown'), name, message, componentStack: stack }
}

/** Единственная точка логирования: в проде её проще заменить на sink. */
export function logViewError(report) {
  // eslint-disable-next-line no-console
  console.error('[back office] section failed to render', report)
}
