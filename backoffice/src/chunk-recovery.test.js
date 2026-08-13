import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildKey, isChunkLoadError, markReloadAttempt, recoveryPlan, shouldAutoReload,
} from './chunk-recovery.js'

/**
 * Правила восстановления после деплоя под открытой вкладкой.
 *
 * Проверяется то, из-за чего это и написано: пропавший чанк лечится
 * только перезагрузкой, обычное падение — нет, и перепутать их нельзя
 * ни в одну сторону. Плюс главное свойство: перезагрузка не должна
 * зациклиться.
 */

/** Минимальный документ с входным модулем — как его отдаёт сборка */
const docWith = (src) => ({
  querySelector: (sel) => (sel.includes('script') && src
    ? { getAttribute: () => src }
    : null),
})

/** sessionStorage в памяти */
function memoryStorage(initial = {}) {
  const data = { ...initial }
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v) },
    data,
  }
}

describe('распознавание пропавшего чанка', () => {
  it('Chromium: не пришёл динамически импортированный модуль', () => {
    assert.equal(isChunkLoadError(new Error(
      'Failed to fetch dynamically imported module: '
      + 'https://angle.co.il/account/assets/ReservationsDesk-BKN8FXGb.js')), true)
  })

  it('Safari: импорт модульного скрипта не удался', () => {
    assert.equal(isChunkLoadError(new Error('Importing a module script failed.')), true)
    assert.equal(isChunkLoadError(new Error('Unable to load module script')), true)
  })

  it('Firefox: ошибка загрузки динамического модуля', () => {
    assert.equal(isChunkLoadError(new Error(
      'error loading dynamically imported module: https://angle.co.il/x.js')), true)
  })

  it('сборщик пометил ошибку именем', () => {
    const e = new Error('boom')
    e.name = 'ChunkLoadError'
    assert.equal(isChunkLoadError(e), true)
  })

  it('соседний CSS того же чанка тоже считается', () => {
    assert.equal(isChunkLoadError(new Error('Unable to preload CSS for /account/assets/x.css')), true)
  })

  it('обычное падение рендера чанком НЕ считается', () => {
    assert.equal(isChunkLoadError(new ReferenceError('selecting is not defined')), false)
    assert.equal(isChunkLoadError(new TypeError(
      "Cannot read properties of undefined (reading 'map')")), false)
  })

  it('упавший запрос данных не повод перезагружать страницу', () => {
    // Голое «Failed to fetch» — это сеть под запросом, а не пропавший
    // чанк. Перезагрузка здесь ничего не чинит и теряет работу.
    assert.equal(isChunkLoadError(new TypeError('Failed to fetch')), false)
    assert.equal(isChunkLoadError(new Error('NetworkError when attempting to fetch resource.')), false)
  })

  it('пустая ошибка не ломает классификатор', () => {
    assert.equal(isChunkLoadError(null), false)
    assert.equal(isChunkLoadError(undefined), false)
    assert.equal(isChunkLoadError(''), false)
  })
})

describe('идентификатор сборки', () => {
  it('берётся из хеша входного модуля документа', () => {
    assert.equal(buildKey(docWith('/account/assets/index-rEn4Imxq.js')), 'index-rEn4Imxq')
  })

  it('переживает строку запроса', () => {
    assert.equal(buildKey(docWith('/account/assets/index-abc123.js?v=2')), 'index-abc123')
  })

  it('без входного модуля ключа нет — и это не ошибка', () => {
    assert.equal(buildKey(docWith(null)), null)
    assert.equal(buildKey(undefined), null)
  })
})

describe('однократность перезагрузки', () => {
  it('первый раз для этой сборки — можно', () => {
    assert.equal(shouldAutoReload(memoryStorage(), 'index-a'), true)
  })

  it('второй раз для ТОЙ ЖЕ сборки — нельзя: это была бы петля', () => {
    const storage = memoryStorage({ 'angle:chunk-reload': 'index-a' })
    assert.equal(shouldAutoReload(storage, 'index-a'), false)
  })

  it('новая сборка снимает запрет: это уже другая выкладка', () => {
    const storage = memoryStorage({ 'angle:chunk-reload': 'index-a' })
    assert.equal(shouldAutoReload(storage, 'index-b'), true)
  })

  it('без ключа сборки автоперезагрузки не бывает', () => {
    assert.equal(shouldAutoReload(memoryStorage(), null), false)
  })

  it('недоступное хранилище запрещает авто, а не роняет', () => {
    const broken = {
      getItem() { throw new Error('denied') },
      setItem() { throw new Error('denied') },
    }
    assert.equal(shouldAutoReload(broken, 'index-a'), false)
    assert.equal(markReloadAttempt(broken, 'index-a'), false)
  })
})

describe('решение целиком', () => {
  const doc = docWith('/account/assets/index-rEn4Imxq.js')
  const chunkError = new Error('Failed to fetch dynamically imported module: /x.js')

  it('обычная ошибка → «Try again», без перезагрузки', () => {
    assert.equal(
      recoveryPlan(new ReferenceError('x is not defined'), { doc, storage: memoryStorage() }),
      'render')
  })

  it('пропавший чанк в первый раз → перезагружаемся сами', () => {
    const storage = memoryStorage()
    assert.equal(recoveryPlan(chunkError, { doc, storage }), 'reload')
    assert.equal(storage.data['angle:chunk-reload'], 'index-rEn4Imxq')
  })

  it('пропавший чанк во второй раз → предлагаем кнопку, НЕ зацикливаемся', () => {
    const storage = memoryStorage()
    assert.equal(recoveryPlan(chunkError, { doc, storage }), 'reload')
    assert.equal(recoveryPlan(chunkError, { doc, storage }), 'offer')
    assert.equal(recoveryPlan(chunkError, { doc, storage }), 'offer')
  })

  it('без ключа сборки чанк лечится кнопкой, а не молчаливой петлёй', () => {
    assert.equal(
      recoveryPlan(chunkError, { doc: docWith(null), storage: memoryStorage() }),
      'offer')
  })

  it('после новой выкладки одна автоперезагрузка снова разрешена', () => {
    const storage = memoryStorage()
    recoveryPlan(chunkError, { doc, storage })
    assert.equal(
      recoveryPlan(chunkError, { doc: docWith('/account/assets/index-NEW.js'), storage }),
      'reload')
  })
})
