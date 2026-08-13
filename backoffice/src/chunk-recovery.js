/**
 * Восстановление после деплоя, случившегося под открытой вкладкой.
 *
 * ЧТО ЛОМАЕТСЯ.
 *
 * Кабинет — SPA с разделением по разделам: входной бандл держит
 * `() => import('./ReservationsDesk')`, и сборщик зашивает туда
 * КОНКРЕТНЫЙ адрес чанка вместе с хешем. После выкладки новой версии
 * файлы получают новые хеши, старые исчезают — а вкладка, открытая до
 * деплоя, продолжает просить старый адрес. Первый же переход в раздел
 * падает с «Failed to fetch dynamically imported module».
 *
 * ПОЧЕМУ ЭТО НЕ ЛЕЧИТСЯ ЗАГОЛОВКАМИ КЭША.
 *
 * Проверено на проде: и `index.html`, и ассеты отдаются с
 * `max-age=0, must-revalidate`, service worker в проекте отсутствует.
 * Кэш ни при чём — адрес зашит в УЖЕ ВЫПОЛНЯЮЩИЙСЯ код. Помогает только
 * перезагрузка документа: она забирает свежий `index.html` с новым
 * входным бандлом.
 *
 * ПОЧЕМУ «TRY AGAIN» НЕ ПОМОГАЕТ.
 *
 * `React.lazy` запоминает отклонённый промис. Повторное монтирование
 * того же компонента отдаёт ТУ ЖЕ ошибку, сколько ни нажимай. Для
 * обычного падения рендера кнопка верна, для пропавшего чанка — нет, и
 * различать их обязан код, а не владелец.
 */

/**
 * Формулировки браузеров. Совпадение должно быть УЗКИМ: голое
 * «Failed to fetch» — это упавший запрос данных, и перезагружать из-за
 * него страницу нельзя.
 */
const CHUNK_PATTERNS = [
  // Chromium
  /failed to fetch dynamically imported module/i,
  // Firefox
  /error loading dynamically imported module/i,
  // Safari
  /importing a module script failed/i,
  /unable to load module script/i,
  // Vite: соседний CSS того же чанка
  /unable to preload css/i,
]

/**
 * Похожа ли ошибка на пропавший после деплоя чанк.
 *
 * Ошибка данных, свободная переменная и любое другое падение рендера
 * сюда не попадают: они лечатся «Try again», а не перезагрузкой.
 */
export function isChunkLoadError(error) {
  if (!error) return false
  // Сборщики помечают такое имя явно
  if (error.name === 'ChunkLoadError') return true
  const message = String(error.message ?? error ?? '')
  return CHUNK_PATTERNS.some((re) => re.test(message))
}

/**
 * Идентификатор выложенной сборки.
 *
 * Берётся из адреса входного модуля в самом документе: он несёт хеш
 * содержимого и меняется ровно тогда, когда меняется сборка. Отдельная
 * переменная сборки для этого не нужна — а значит, нечему разойтись с
 * тем, что реально загружено.
 *
 * Ничего не нашли — возвращаем null, и тогда автоперезагрузка не
 * выполняется: без ключа защиты от петли нет, а петля хуже ручной
 * кнопки.
 */
export function buildKey(doc) {
  const script = doc?.querySelector?.('script[type="module"][src]')
  const src = script?.getAttribute?.('src')
  if (!src) return null
  const match = /([^/]+)\.js(?:\?.*)?$/.exec(src)
  return match ? match[1] : null
}

const STORAGE_KEY = 'angle:chunk-reload'

/**
 * Можно ли перезагрузиться автоматически.
 *
 * Ровно один раз на сборку. Если после перезагрузки чанк снова не
 * пришёл (сеть лежит, документ отдан из кэша — ключ тот же), второй
 * перезагрузки не будет: владелец увидит кнопку и решит сам.
 *
 * Хранилище недоступно (приватный режим, отключённые куки) — считаем,
 * что автоперезагрузка запрещена: молчаливая петля дороже лишнего
 * нажатия.
 */
export function shouldAutoReload(storage, key) {
  if (!key || !storage) return false
  try {
    return storage.getItem(STORAGE_KEY) !== key
  } catch {
    return false
  }
}

/** Запомнить, что для этой сборки перезагрузка уже была. */
export function markReloadAttempt(storage, key) {
  if (!key || !storage) return false
  try {
    storage.setItem(STORAGE_KEY, key)
    return true
  } catch {
    return false
  }
}

/**
 * Решение целиком: что делать с пойманной ошибкой.
 *
 * Вынесено сюда, чтобы граница ошибки осталась разметкой, а правило
 * проверялось тестом. Возвращает одно из трёх:
 *
 *   'render'  — обычное падение, кнопка «Try again»;
 *   'reload'  — пропал чанк, перезагружаем сами (один раз на сборку);
 *   'offer'   — пропал чанк, но автоматически уже пробовали: кнопка.
 */
export function recoveryPlan(error, { doc, storage } = {}) {
  if (!isChunkLoadError(error)) return 'render'
  const key = buildKey(doc)
  if (!shouldAutoReload(storage, key)) return 'offer'
  return markReloadAttempt(storage, key) ? 'reload' : 'offer'
}
