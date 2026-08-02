// React инициализируется ПЕРВЫМ и до регистрации хуков: иначе
// `react-dom/server`, попавший в граф раньше, подтягивает react через
// свой CJS-require и видит его недоинициализированным
// («Incompatible React versions: react undefined»).
import 'react'

import { existsSync, readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'

/**
 * Даёт `node --test` читать исходники кабинета как есть: с JSX и с
 * `import.meta.env`, которые понимает только Vite.
 *
 * Зачем. До этого тестами покрывалась только чистая логика, и целый
 * класс поломок — свободная переменная в компоненте — не ловился ничем:
 * сборка проходит, вкладка падает у владельца. Компонент, который можно
 * отрендерить в тесте, такую ошибку показывает сразу.
 *
 * Новых зависимостей нет: esbuild уже стоит внутри Vite.
 */

// Подкаталоги тоже наши: общие примитивы живут в `src/ui/`.
const SOURCE = /\/backoffice\/(src|test)\/.+\.(jsx|js)$/

registerHooks({
  // Внутри кабинета соседи импортируются без расширения — так их
  // разрешает Vite. Node этого не умеет, поэтому дописываем сами.
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
      for (const ext of ['.jsx', '.js']) {
        try {
          const candidate = nextResolve(specifier + ext, context)
          if (existsSync(fileURLToPath(candidate.url))) return candidate
        } catch {
          /* пробуем следующее расширение */
        }
      }
    }
    return nextResolve(specifier, context)
  },

  load(url, context, nextLoad) {
    if (!url.startsWith('file://') || !SOURCE.test(url)) return nextLoad(url, context)
    const path = fileURLToPath(url)
    const { code } = transformSync(readFileSync(path, 'utf8'), {
      loader: path.endsWith('.jsx') ? 'jsx' : 'js',
      format: 'esm',
      target: 'node22',
      jsx: 'automatic',
      sourcefile: path,
      // Ключей окружения в тестах нет намеренно: клиент Supabase не
      // создаётся, и ни один тест не может случайно сходить в сеть.
      define: { 'import.meta.env': '{}' },
    })
    return { format: 'module', shortCircuit: true, source: code }
  },
})
