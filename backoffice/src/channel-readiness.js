import { LAUNCH_STEPS } from './launch'

/**
 * Что мешает гостю воспользоваться каналом ПРЯМО СЕЙЧАС.
 *
 * План требует «readiness checklist containing real blockers only», и
 * ударение здесь на real. Список зелёных галочек про то, что и так
 * работает, — это не помощь, а шум: владелец перестаёт читать его на
 * второй раз. Поэтому здесь только НЕвыполненное и только то, что
 * действительно ломает гостю сценарий.
 *
 * Проверено по серверу, а не по интуиции: пустое расписание — НЕ
 * блокер. `online_hours_open_at` (миграция 112) трактует отсутствие
 * `hours` как «принимаем в любое время», поэтому пункт «задайте часы»
 * был бы выдуманным препятствием.
 */

/**
 * Блокеры гостевого меню точки.
 *
 * Каталог общий на организацию, но категория принадлежит точке —
 * гостю показывается ровно её меню. Поэтому считаем позиции в
 * категориях ЭТОЙ точки, а не всё, что есть у организации.
 */
export function menuBlockers({ categories, items, locationId, tables, settings } = {}) {
  const blockers = []
  if (!Array.isArray(categories) || !Array.isArray(items)) return blockers

  const mine = new Set(
    categories.filter((c) => !locationId || c.location_id === locationId).map((c) => c.id)
  )
  const inLocation = items.filter((i) => mine.has(i.category_id))
  const onSale = inLocation.filter((i) => i.is_available)

  if (mine.size === 0) {
    blockers.push({
      id: 'no-categories',
      title: 'The menu for this location is empty',
      detail: 'Guests open the link and see nothing to order.',
      action: { label: 'Manage catalogue', view: 'menu' },
    })
  } else if (onSale.length === 0) {
    blockers.push({
      id: 'nothing-on-sale',
      title: inLocation.length === 0
        ? 'No items in this location’s menu'
        : `All ${inLocation.length} items are hidden`,
      detail: 'Guests open the link and see nothing to order.',
      action: { label: 'Manage catalogue', view: 'menu' },
    })
  }

  // Столы нужны только тому, кто обещал гостям обслуживание за столом
  const types = settings?.types
  const wantsTables = Array.isArray(types) ? types.includes('here') : false
  if (wantsTables && Array.isArray(tables) && tables.length === 0) {
    blockers.push({
      id: 'no-tables',
      title: 'Dine-in is on, but there are no tables',
      detail: 'Table QR codes have nothing to point at.',
      action: { label: 'Tables & zones', view: 'reservations', tab: 'floor' },
    })
  }

  return blockers
}

/**
 * Блокеры страницы брони.
 *
 * Считает СЕРВЕР (`reserve_launch_checklist_web`, миграция 126) — по
 * данным, а не по галочкам «я настроил». Здесь только перевод
 * невыполненных шагов в строки канала: дублировать серверную логику на
 * клиенте значит однажды разойтись с ней.
 *
 * Тестовая бронь в блокеры не попадает: она проверяет настройку, но
 * гостю не мешает.
 */
const RESERVE_STEP_ACTION = {
  tables: { label: 'Tables & zones', view: 'reservations', tab: 'floor' },
  schedule: { label: 'Booking hours', group: 'hours' },
  policy: { label: 'Cancellation & changes', group: 'cutoff' },
  branding: { label: 'Look of the booking page', group: 'page' },
  link: { label: 'Link & address', group: 'address' },
}

export function reserveBlockers(checklist) {
  const steps = checklist?.steps
  if (!Array.isArray(steps)) return []
  return steps
    .filter((step) => !step.done && step.key !== 'test_booking')
    .map((step) => ({
      id: step.key,
      title: LAUNCH_STEPS[step.key]?.title || step.key,
      detail: LAUNCH_STEPS[step.key]?.hint || null,
      action: RESERVE_STEP_ACTION[step.key] || null,
    }))
}

/** Заголовок полосы: сколько мешает и чему именно */
export function blockerSummary(blockers, channel) {
  const count = blockers.length
  if (count === 0) return null
  const what = channel === 'reserve' ? 'guests can book' : 'guests can order'
  return count === 1
    ? `One thing to fix before ${what}`
    : `${count} things to fix before ${what}`
}
