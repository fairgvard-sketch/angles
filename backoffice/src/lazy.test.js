import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

/**
 * Разделение бандла проверяется исходником, а не глазами.
 *
 * Кабинет приезжал одним файлом на 871 kB. После разделения первый чанк
 * — 516 kB, остальное приходит по требованию. Сломать это можно одной
 * строкой: дописать `import MenuManager from './MenuManager'` наверху
 * `App.jsx` — и Vite снова соберёт всё в один файл. Ни один тест
 * поведения этого не заметит: экраны работают, просто первый показ
 * снова стоит вдвое дороже.
 *
 * Поэтому граница зафиксирована здесь.
 */

const APP = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8')

/**
 * Разделы, которые обязаны приезжать своим чанком.
 *
 * `SalesOverview` в списке больше нет: он перестал быть разделом и стал
 * вкладкой внутри `ReportsSection` — по требованию приезжает раздел, а
 * отчёт едет вместе с ним. `SettingsPage` появился: экран аккаунта
 * дорос до трёх вкладок и в первом чанке ему делать нечего.
 */
const LAZY_VIEWS = [
  'ReportsSection', 'SettingsPage', 'LocationSettings', 'MenuManager', 'TeamManager',
  'QrChannels', 'OrdersInbox', 'ReservationsDesk', 'DevicesManager', 'GuestsManager',
  'ActivityManager',
]

describe('разделение бандла', () => {
  it('ни один раздел не импортируется статически', () => {
    for (const name of LAZY_VIEWS) {
      const statically = new RegExp(`^import\\s+(\\w+,\\s*)?\\{?[^}]*\\b${name}\\b[^}]*\\}?\\s+from`, 'm')
      assert.doesNotMatch(
        APP, statically,
        `${name} импортирован статически — чанк раздела вернётся в первый файл`
      )
    }
  })

  it('каждый раздел объявлен через lazy', () => {
    for (const name of LAZY_VIEWS) {
      assert.match(APP, new RegExp(`const ${name} = lazy\\(`), `${name} должен грузиться по требованию`)
    }
  })

  it('ожидание держит скелет, а не пустоту', () => {
    // Пустой fallback — это мигание: экран схлопывается в ноль и
    // разворачивается обратно. Ради этого разделение делать не стоило.
    assert.match(APP, /<Suspense fallback={<ViewFallback \/>}>/)
    assert.match(APP, /function ViewFallback/)
  })

  it('Suspense стоит внутри границы ошибки', () => {
    /*
     * Порядок важен: не приехавший чанк (сеть отвалилась, выкатили
     * новую сборку и старые файлы удалены) обязан выглядеть как
     * упавший раздел — с кнопкой «Try again» и живой навигацией, — а
     * не как белый экран.
     */
    const boundary = APP.indexOf('<ViewErrorBoundary')
    const suspense = APP.indexOf('<Suspense')
    assert.ok(boundary > 0 && suspense > boundary, 'Suspense обязан быть внутри ViewErrorBoundary')
  })

  it('на дашборде экономить нечего — он остаётся в первом чанке', () => {
    // Его видно сразу; ленивая загрузка того, что и так показывают
    // первым, меняет ожидание файла на мигание двух.
    assert.match(APP, /^import HomeDashboard from '\.\/HomeDashboard'$/m)
  })
})
