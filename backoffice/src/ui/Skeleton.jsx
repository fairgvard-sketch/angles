/**
 * Скелет загрузки: форма будущего содержимого, а не слово «Loading…».
 *
 * Зачем это отдельный примитив. Замер Phase 11 показал, во что
 * обходится строчка «Loading…»: рабочая область Dashboard в ожидании
 * данных высотой 427px, с данными — 1479px. Экран вырастает на целый
 * рост окна под руками владельца: то, во что он целится, уезжает вниз
 * ровно в момент, когда данные приходят. У Sales это 884px, у QR — 741,
 * у Девайсов — 577.
 *
 * Разделы, переделанные владельцем (Заказы, Каталог, Брони), скелеты
 * уже имели — каждый со своим набором классов. Здесь они сведены в
 * один: полоса, панель и строка таблицы. Внешний вид взят у
 * существующих (`ord-skeleton`, `cat-skeleton`), чтобы ожидание
 * выглядело одинаково во всём кабинете.
 *
 * Правила примитива:
 *   • геометрия скелета повторяет геометрию готового экрана, иначе он
 *     меняет одно смещение на другое;
 *   • сам скелет `aria-hidden` — читалке нужны не серые полосы, а
 *     слово «загружается», и его говорит живая область;
 *   • мерцание выключается при `prefers-reduced-motion`.
 */

export function SkeletonBar({ width = '100%', height = 12, radius }) {
  return (
    <span
      className="sk-bar"
      style={{ width, height, ...(radius ? { borderRadius: radius } : null) }}
    />
  )
}

/** Строка списка или таблицы: столбцы задаются долями ширины. */
export function SkeletonRow({ columns = ['30%', '20%', '15%'], height = 52, lead = 0 }) {
  return (
    <div className="sk-row" style={{ height }}>
      {lead > 0 && <SkeletonBar width={lead} height={lead} radius={10} />}
      {columns.map((w, i) => <SkeletonBar key={i} width={w} />)}
    </div>
  )
}

/** Панель кабинета: рамка и отступы настоящей `.panel`. */
export function SkeletonPanel({ height, children }) {
  return <div className="sk-panel" style={height ? { minHeight: height } : null}>{children}</div>
}

/**
 * Обёртка. `label` — то, что услышит читалка; глазами его не видно, и
 * это правильно: серые полосы уже сказали то же самое.
 */
export default function Skeleton({ label, children }) {
  return (
    <>
      <div role="status" aria-live="polite" className="visually-hidden">{label}</div>
      <div className="sk" aria-hidden>{children}</div>
    </>
  )
}
