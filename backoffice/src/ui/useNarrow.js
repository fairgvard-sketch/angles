import { useEffect, useState } from 'react'

/**
 * Узкий экран. Раскладку решает разметка, а не только CSS: девять
 * колонок, ужатых до телефона, — это не таблица, а нечитаемая сетка.
 * На телефоне рисуется другой компонент, поэтому ширину надо знать в JS.
 *
 * Значение считается и при первом рендере: иначе телефон успевает
 * показать таблицу и только потом перерисоваться списком.
 */
export default function useNarrow(query = '(max-width: 720px)') {
  const [narrow, setNarrow] = useState(
    () => (typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia(query).matches
      : false)
  )
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mq = window.matchMedia(query)
    const onChange = () => setNarrow(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return narrow
}
