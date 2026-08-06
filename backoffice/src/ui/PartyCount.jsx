/**
 * Размер компании — фигуркой и числом вместо слова «guests».
 *
 * В строках визитов, блоках таймлайна и шапках карточек слово занимало
 * больше места, чем сама величина, и повторялось в каждой строке. Тот же
 * компонент есть в кассе (`src/components/ui/PartySize.tsx`, Kassa 145),
 * поэтому одна и та же бронь выглядит одинаково у хостес и у владельца.
 *
 * Слово остаётся доступным имени: скринридер по-прежнему произносит
 * «4 guests», а не «4».
 */
export default function PartyCount({ n, className = '' }) {
  const label = `${n} ${n === 1 ? 'guest' : 'guests'}`
  return (
    <span className={`party-count ${className}`.trim()} aria-label={label} title={label}>
      <PersonGlyph />
      {n}
    </span>
  )
}

/** Фигурка масштабируется от размера шрифта: одна на мелкую строку и на шапку */
export function PersonGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" aria-hidden focusable="false">
      <circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M5.5 19.5c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}
