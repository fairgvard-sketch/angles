/**
 * Раскладка зала: где стоит стол, как его двигать и что считать
 * несохранённым.
 *
 * План зала правился списком: «стол 12» существовал как строка, но с
 * местом в зале никак не связан. Хостес, глядя на список, не может
 * ответить на вопрос «какой из них у окна» — а именно так гости и
 * просят.
 *
 * Координаты — в ПРОЦЕНТАХ холста (миграция 017): план тянется под
 * любой экран, а столы держат взаимное расположение. Пиксели тут были бы
 * привязкой к разрешению того ноутбука, на котором зал рисовали.
 */

export const GRID_STEP = 2.5
export const DEFAULT_WIDTH = 10
export const DEFAULT_HEIGHT = 10

/** Прижать значение к границам холста с учётом размера стола */
export function clampPos(value, size) {
  const half = (Number(size) || 0) / 2
  const min = half
  const max = 100 - half
  if (!Number.isFinite(Number(value))) return min
  return Math.min(Math.max(Number(value), min), Math.max(min, max))
}

/** Округлить к шагу сетки — стол не должен вставать «почти ровно» */
export function snap(value, step = GRID_STEP) {
  if (!Number.isFinite(Number(value))) return 0
  return Math.round(Number(value) / step) * step
}

/**
 * Разложить столы, у которых координат ещё нет.
 *
 * Так выглядят все столы, заведённые до плана: pos_x/pos_y = NULL (017).
 * Показать их «в углу друг на друге» значит заставить владельца
 * растащить весь зал руками, поэтому сетка-дефолт раскладывает их
 * рядами — дальше он двигает то, что хочет.
 */
export function withDefaultPositions(tables) {
  const list = [...(tables ?? [])]
  let index = 0
  return list.map((table) => {
    const hasPos = table.pos_x != null && table.pos_y != null
    if (hasPos) {
      return {
        ...table,
        x: Number(table.pos_x),
        y: Number(table.pos_y),
        w: Number(table.width) || DEFAULT_WIDTH,
        h: Number(table.height) || DEFAULT_HEIGHT,
        shape: table.shape || 'square',
        placed: true,
      }
    }
    // Нерасставленные складываем внизу холста отдельной полосой, а не
    // поверх уже расставленного зала: иначе новый стол появляется на
    // чужом месте, и владелец решает, что план сломался.
    const col = index % 7
    const row = Math.floor(index / 7)
    index += 1
    return {
      ...table,
      x: 10 + col * 13,
      y: 90 - row * 12,
      w: Number(table.width) || DEFAULT_WIDTH,
      h: Number(table.height) || DEFAULT_HEIGHT,
      shape: table.shape || 'square',
      placed: false,
    }
  })
}

/** Сдвинуть стол на шаг — клавиатурой, а не только мышью */
export function nudge(table, dx, dy, step = GRID_STEP) {
  return {
    ...table,
    x: clampPos(snap(table.x + dx * step), table.w),
    y: clampPos(snap(table.y + dy * step), table.h),
  }
}

/** Поставить стол в точку холста (перетаскивание) */
export function placeAt(table, x, y) {
  return {
    ...table,
    x: clampPos(snap(x), table.w),
    y: clampPos(snap(y), table.h),
  }
}

/**
 * Что изменилось против сохранённого.
 *
 * Сравнение с точностью до сотой процента: холст даёт дробные
 * координаты, и строгое равенство объявляло бы несохранёнными столы,
 * которых никто не трогал.
 */
const same = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.01

export function layoutChanges(original, current) {
  const before = new Map((original ?? []).map((t) => [t.id, t]))
  return (current ?? []).filter((table) => {
    const was = before.get(table.id)
    if (!was) return true
    // Стол, которого не было на плане, считается изменённым: сетка-дефолт
    // ещё не выбор владельца, но сохранить её нужно — иначе план
    // раскладывается заново при каждом открытии.
    if (!was.placed) return true
    return !(same(was.x, table.x) && same(was.y, table.y)
      && same(was.w, table.w) && same(was.h, table.h)
      && was.shape === table.shape)
  })
}

export const hasUnsavedLayout = (original, current) =>
  layoutChanges(original, current).length > 0

/** Полезная нагрузка для сервера — только то, что он умеет применять */
export function layoutPayload(tables) {
  return (tables ?? []).map((table) => ({
    id: table.id,
    x: Number(table.x.toFixed(2)),
    y: Number(table.y.toFixed(2)),
    w: Number(table.w.toFixed(2)),
    h: Number(table.h.toFixed(2)),
    shape: table.shape,
  }))
}

/**
 * История правок для отмены и повтора.
 *
 * Владелец двигает зал наощупь, и «Ctrl+Z» здесь ожидаем не меньше, чем
 * в редакторе текста. Глубина ограничена: помнить весь вечер
 * перетаскиваний незачем, а память браузера не бесконечна.
 */
export const HISTORY_LIMIT = 50

export function pushHistory(history, snapshot) {
  const next = [...history.past, snapshot]
  return {
    past: next.slice(Math.max(0, next.length - HISTORY_LIMIT)),
    future: [],
  }
}

export function undo(history, current) {
  if (history.past.length === 0) return null
  const past = [...history.past]
  const previous = past.pop()
  return { state: previous, history: { past, future: [current, ...history.future] } }
}

export function redo(history, current) {
  if (history.future.length === 0) return null
  const [next, ...rest] = history.future
  return { state: next, history: { past: [...history.past, current], future: rest } }
}
