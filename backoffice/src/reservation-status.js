import { blockState } from './timeline'

/**
 * Состояние визита — один источник для таймлайна, списка, листа ожидания
 * и панели визита.
 *
 * До этого подписи и классы жили в трёх местах сразу: `STATE_LABEL` и
 * `STATE_CLASS` в таймлайне, `RESERVATION_STATUS_LABELS` в модуле данных
 * и цветовые литералы в стилях. Один и тот же визит назывался «Seated» на
 * полотне и «Confirmed» в списке, а цвет статуса нельзя было изменить,
 * не обойдя весь кабинет глазами.
 *
 * Здесь состояние названо один раз: ключ → подпись + класс. Цвет живёт в
 * переменных `--rsv-*` и в CSS-классах, а не в компонентах: экран не
 * должен знать, каким оттенком синего рисуется подтверждённая бронь.
 *
 * Состояние ВСЕГДА передаётся словом. Цвет — это подсказка для тех, кто
 * различает цвета и смотрит на экран целиком; подпись — то, что читает
 * скринридер и то, что остаётся в чёрно-белой печати и на солнце.
 */

export const VISIT_STATUS = {
  pending: { label: 'Pending', className: 'is-pending' },
  confirmed: { label: 'Confirmed', className: 'is-confirmed' },
  arrived: { label: 'Seated', className: 'is-arrived' },
  done: { label: 'Completed', className: 'is-done' },
  noshow: { label: 'No-show', className: 'is-noshow' },
  rejected: { label: 'Rejected', className: 'is-cancelled' },
  cancelled: { label: 'Cancelled', className: 'is-cancelled' },
}

/**
 * Состояние визита из его полей.
 *
 * `blockState` (порт кассовой раскладки) отвечает за живые состояния
 * полотна и про отказ с отменой не знает — на таймлайне их нет. В списке
 * они есть, поэтому решаются здесь, а эталонный модуль не трогаем.
 */
export function visitState(reservation) {
  const status = reservation?.status
  if (status === 'rejected' || status === 'cancelled') return status
  return blockState(status, reservation?.arrived_at, reservation?.order_id)
}

/** Подпись состояния. Неизвестное состояние показываем как есть. */
export function statusLabel(state) {
  return VISIT_STATUS[state]?.label ?? String(state ?? '')
}

/** Класс состояния для блока, бейджа или строки таблицы */
export function statusClass(state) {
  return VISIT_STATUS[state]?.className ?? ''
}

/**
 * Что можно сделать с визитом прямо сейчас.
 *
 * Раньше это была россыпь условий внутри разметки, и каждый экран
 * решал заново: на полотне у визита не было ни отказа, ни отмены —
 * хостес открывал карточку, видел «Completed / No-show» и уходил искать
 * отмену в список. Здесь переходы названы один раз и зеркалят
 * `set_reservation_status_web`; сервер остаётся судьёй, экран лишь не
 * предлагает того, что заведомо будет отклонено.
 *
 * Посаженная на кассе бронь (`order_id`) не редактируется из кабинета:
 * её визит живёт в POS-заказе, и веб его не трогает.
 *
 * `confirm: true` — действие, которое нельзя откатить: оно обязано
 * спрашивать причину или подтверждение, а не срабатывать с одного тапа.
 */
export function visitActions(reservation) {
  if (!reservation || reservation.order_id != null) return []
  const seated = reservation.arrived_at != null
  switch (reservation.status) {
    case 'new':
      return [
        { key: 'confirmed', label: 'Confirm', tone: 'primary' },
        { key: 'rejected', label: 'Reject', tone: 'danger', confirm: true },
      ]
    case 'confirmed':
      return [
        ...(seated ? [] : [{ key: 'arrived', label: 'Guest seated', tone: 'primary' }]),
        { key: 'completed', label: 'Completed' },
        { key: 'no_show', label: 'No-show' },
        { key: 'cancelled', label: 'Cancel booking', tone: 'danger', confirm: true },
      ]
    default:
      // Завершённый, отменённый, отклонённый визит — история. Возвращать
      // его в работу нельзя: это была бы правка финансово значимого следа.
      return []
  }
}
