/**
 * Подача блока на полотне: что показать, когда места мало.
 *
 * Раскладка (`timeline.js`) отвечает на вопрос «где и какой ширины»
 * блок — она порт кассового модуля и трогать её нельзя. Здесь решается
 * то, чего у кассы нет: узкий блок обязан терять СНАЧАЛА метаданные, а
 * не имя гостя.
 *
 * Порядок важности внутри блока: время → имя → компания и состояние.
 * Час на полотне — 96 px, поэтому визит на 30 минут это 48 px: туда не
 * помещается ничего, кроме времени начала, и делать вид, что помещается,
 * значит показать хостес обрубок вроде «Дан…».
 */

/**
 * Пороги в пикселях. Ниже — блок теряет очередной уровень подробности.
 *
 * Час полотна — 96 px, поэтому пороги подобраны под реальные визиты:
 * обычная бронь на 90 минут (144 px) обязана показывать состояние
 * словом, а не одним цветом; часовая (96 px) — время и имя; получасовая
 * (48 px) — только время.
 */
export const BLOCK_WIDE_PX = 200
export const BLOCK_FULL_PX = 132
export const BLOCK_NAME_PX = 80

/**
 * Уровень подробности блока по его ширине:
 *   'wide'    — начало и конец, имя, «компания · состояние»;
 *   'full'    — начало, имя, «компания · состояние»;
 *   'name'    — начало и имя;
 *   'minimal' — только время начала.
 *
 * Полная подпись (гость, стол, время, состояние) в любом случае остаётся
 * в `aria-label` и подсказке: сжимается картинка, а не смысл.
 */
export function blockDetail(widthPx) {
  const px = Number(widthPx)
  if (!Number.isFinite(px)) return 'minimal'
  if (px >= BLOCK_WIDE_PX) return 'wide'
  if (px >= BLOCK_FULL_PX) return 'full'
  if (px >= BLOCK_NAME_PX) return 'name'
  return 'minimal'
}

/** Показывать ли строку «компания · состояние» */
export const showsMeta = (level) => level === 'wide' || level === 'full'

/** Показывать ли имя гостя */
export const showsName = (level) => level !== 'minimal'

/** Ширина блока в пикселях из его доли трека */
export function blockWidthPx(widthPct, trackWidth) {
  const pct = Number(widthPct)
  const track = Number(trackWidth)
  if (!Number.isFinite(pct) || !Number.isFinite(track)) return 0
  return (pct / 100) * track
}

/**
 * Визиты, которые пересекаются с выбранным на его же столах.
 *
 * Полотно помечает конфликт красной рамкой, и на этом разговор
 * заканчивался: хостес видел, что «что-то не так», но не знал, с кем
 * именно столкнулась бронь — приходилось водить пальцем по строке.
 * Здесь тот же конфликт называется по имени.
 *
 * Считается по уже разложенным строкам: полотно и панель обязаны
 * говорить об одном и том же наборе броней.
 */
export function overlappingVisits(rows, bookingId) {
  if (!Array.isArray(rows) || !bookingId) return []
  const target = []
  for (const row of rows) {
    for (const block of row.blocks) {
      if (block.booking.id === bookingId) target.push({ row, block })
    }
  }
  if (target.length === 0) return []

  const out = new Map()
  for (const { row, block } of target) {
    for (const other of row.blocks) {
      if (other.booking.id === bookingId) continue
      const clash = other.booking.startMs < block.booking.endMs
        && block.booking.startMs < other.booking.endMs
      // Конфликтом считаем то же, что и раскладка: только живые визиты.
      // Отменённый или завершённый стол не держит.
      if (!clash || !other.conflict || !block.conflict) continue
      out.set(other.booking.id, { booking: other.booking, table: row.table })
    }
  }
  return [...out.values()]
}

/**
 * Получасовые деления между часовыми отметками.
 *
 * Считаются от самих отметок, а не от левого края: окно дня начинается с
 * расписания точки и ровным часом быть не обязано — раздача по «каждые
 * 48 px» уехала бы на полчаса и рисовала бы получас на месте часа.
 */
export function halfHourMarks(ticks, win, hourMs = 3_600_000) {
  const span = win?.endMs - win?.startMs
  if (!Array.isArray(ticks) || !(span > 0)) return []
  const half = hourMs / 2
  const out = []
  // Первое деление слева от первой отметки: начало окна редко ровно час,
  // и полоса до него не должна оставаться без разметки.
  for (const tick of [{ ts: ticks[0]?.ts - hourMs }, ...ticks]) {
    const ts = tick?.ts + half
    if (!Number.isFinite(ts) || ts <= win.startMs || ts >= win.endMs) continue
    out.push({ ts, leftPct: ((ts - win.startMs) / span) * 100 })
  }
  return out
}
