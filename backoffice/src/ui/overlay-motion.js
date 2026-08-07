import { useCallback, useEffect, useRef, useState } from 'react'
import { isTopLayer, pushLayer } from './overlay-stack'

/**
 * Уход слоя: панель, лист и диалог не исчезают, а уезжают.
 *
 * Появление умеет и один CSS — как только элемент вставлен, анимация
 * играет сама. С уходом так нельзя: React снимает узел из документа в тот
 * же кадр, в котором экран переключил состояние, и анимировать уже
 * нечего. Поэтому закрытие идёт в два шага: слой сначала получает
 * `is-closing` и играет свою обратную анимацию, и только потом зовёт
 * `onClose` экрана — тот снимает его с монтирования.
 *
 * Отсюда важное свойство: анимация ухода есть у тех путей, которые
 * проходят через сам слой (Escape, крестик, фон, «Отмена»). Закрытие
 * после сохранения выполняет экран — он снимает панель сам, и там уход
 * мгновенный, как раньше.
 *
 * `prefers-reduced-motion` не «ускоряет» анимацию, а выключает её
 * вместе с задержкой: человеку, которому движение мешает, ждать эти
 * 200 мс не за чем.
 */

/**
 * Длительность ухода в JS. Обязана совпадать с `--motion-out` в
 * styles.css: раньше времени снятый узел обрывает анимацию на середине,
 * позже — оставляет застывшую пустую поверхность поверх страницы.
 */
export const OVERLAY_EXIT_MS = 200

function reducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Возвращает `{ closing, close, isTop }`:
 *   • `closing` — идёт ли уход; из него берётся класс `is-closing`;
 *   • `close`   — закрыть слой. Ссылка ПОСТОЯННАЯ: обработчик клавиш
 *     вешается один раз и слой не срывается с вершины стека при каждом
 *     рендере экрана;
 *   • `isTop`   — этому ли слою сейчас принадлежат Escape и Tab.
 *
 * Место в стеке слоёв берётся здесь же, и не случайно: «кто уходит» и
 * «чья сейчас клавиатура» — один вопрос. Слой отдаёт клавиатуру в
 * момент НАЧАЛА ухода, а не в момент снятия: иначе два Escape подряд
 * работали бы как один — диалог ещё уезжает, стек по-прежнему считает
 * верхним его, и панель под ним второе нажатие не получает.
 */
export function useOverlayExit(onClose) {
  const [closing, setClosing] = useState(false)
  const timerRef = useRef(null)
  const layerRef = useRef({})
  const popRef = useRef(null)
  // Экраны создают `onClose` заново на каждый рендер, а звать через
  // 200 мс нужно свежий: за это время у экрана могли смениться данные.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    popRef.current = pushLayer(layerRef.current)
    return () => {
      popRef.current()
      clearTimeout(timerRef.current)
    }
  }, [])

  /*
   * Клавиатура отдаётся слою под собой в момент начала ухода — но
   * ЭФФЕКТОМ, а не прямо в `close()`.
   *
   * Обработчики всех открытых слоёв висят рядом на документе и получают
   * одно и то же нажатие по очереди (`stopPropagation` между
   * слушателями одного узла не работает). Слой, освободивший вершину
   * посреди события, отдал бы это же нажатие ещё и слою под собой — и
   * один Escape закрыл бы сразу два. Эффект выполняется после того, как
   * событие разошлось целиком, и до следующего нажатия.
   */
  useEffect(() => {
    if (closing) popRef.current?.()
  }, [closing])

  const close = useCallback(() => {
    // Уход уже идёт: второй Escape не должен запускать его заново.
    if (timerRef.current) return
    if (reducedMotion()) {
      closeRef.current()
      return
    }
    setClosing(true)
    timerRef.current = setTimeout(() => closeRef.current(), OVERLAY_EXIT_MS)
  }, [])

  const isTop = useCallback(() => isTopLayer(layerRef.current), [])

  return { closing, close, isTop }
}

/** Класс поверхности с учётом ухода: `sheet-backdrop is-closing` */
export function overlayClass(base, closing) {
  return closing ? `${base} is-closing` : base
}
