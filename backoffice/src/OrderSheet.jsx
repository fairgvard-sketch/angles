import { useEffect, useState } from 'react'
import { Clock, PackageSearch, Phone, ShoppingBag, Store, StickyNote } from 'lucide-react'
import { fetchOrderEvents } from './orders'
import {
  DONE_STATUSES, NEXT_ACTIONS, ORDER_CHANNEL_LABELS, ORDER_TYPE_LABELS,
  STATUS_LABELS, STATUS_TONE,
  activityActor, activityLabel, formatMoney, orderItemLines, orderNumber,
  rowContext,
} from './orders-inbox'
import Drawer from './ui/Drawer'
import { Button } from './ui/Button'

/**
 * Панель заказа — одна на весь раздел.
 *
 * Таблица отвечает на вопрос «что у нас сейчас», панель — «что с этим
 * заказом». Строка не может нести позиции, модификаторы, заметку гостя и
 * историю переходов, а без них решение «принять или отказать» принимают
 * вслепую.
 *
 * Порядок сведений — от того, что решает, к тому, что уточняет:
 * состояние, откуда и как выдаём, когда пришёл, кто гость, что заказал,
 * сколько это стоит, что с ним уже делали, и только потом — действия.
 */

/** Полные дата и время: в панели заказ может быть любой давности */
function fullTime(iso, tz) {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(iso))
  } catch {
    return '—'
  }
}

/**
 * История переходов (140). Грузится отдельным запросом при открытии:
 * таблице она не нужна, а тянуть её для каждой строки — лишний вес.
 */
function Activity({ orderId, tz }) {
  const [events, setEvents] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setEvents(null)
    setFailed(false)
    fetchOrderEvents(orderId)
      .then((list) => { if (alive) setEvents(list) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [orderId])

  // Упавшая история не должна ломать панель: остальное о заказе известно
  if (failed) return <p className="ord-sheet-muted">History is unavailable right now.</p>
  if (events === null) return <p className="ord-sheet-muted">Loading history…</p>
  if (events.length === 0) return <p className="ord-sheet-muted">No history recorded.</p>

  return (
    <ol className="ord-activity">
      {events.map((event) => (
        <li key={event.id} className={`is-${STATUS_TONE[event.status] ?? 'done'}`}>
          <div>
            <strong>{activityLabel(event.status)}</strong>
            {activityActor(event) && <small>{activityActor(event)}</small>}
            {event.reason && <small>{event.reason}</small>}
          </div>
          <span className="ord-activity-at">{fullTime(event.created_at, tz)}</span>
        </li>
      ))}
    </ol>
  )
}

export default function OrderSheet({
  row, currency, tz, mode, canManage, posShiftOpen, busy, onClose, onAction,
}) {
  const lines = orderItemLines(row.items)
  const posSeated = Boolean(row.order_id)
  const transitions = canManage && !posSeated ? (NEXT_ACTIONS[row.status] ?? []) : []
  const primary = transitions.find((a) => a.tone === 'primary')
  const rest = transitions.filter((a) => a !== primary)

  return (
    <Drawer
      title={orderNumber(row)}
      subtitle={`${rowContext(row)} · ${fullTime(row.created_at, tz)}`}
      labelledBy="order-sheet-title"
      onClose={onClose}
      /* Панель стоит рядом с таблицей: щелчок по соседнему заказу должен
         открыть его, а не закрыть панель. */
      modal={false}
      footer={transitions.length > 0 ? (
        <>
          {rest.map((action) => (
            <Button
              key={action.to}
              variant={action.tone === 'danger' ? 'secondary' : 'secondary'}
              data-danger={action.tone === 'danger' || undefined}
              busy={busy === action.to}
              busyLabel="…"
              onClick={() => onAction(action.to)}
            >
              {action.label}
            </Button>
          ))}
          {primary && (
            <Button
              variant="primary"
              size="compact"
              busy={busy === primary.to}
              busyLabel="…"
              onClick={() => onAction(primary.to)}
            >
              {primary.label}
            </Button>
          )}
        </>
      ) : null}
    >
      <span className={`ord-status is-${STATUS_TONE[row.status] ?? 'done'} ord-sheet-status`}>
        {STATUS_LABELS[row.status] ?? row.status}
      </span>

      <dl className="ord-sheet-meta">
        <div>
          <dt><ShoppingBag aria-hidden /> Source</dt>
          <dd>{ORDER_CHANNEL_LABELS[row.order_channel] ?? row.order_channel}</dd>
        </div>
        <div>
          <dt><PackageSearch aria-hidden /> Fulfilment</dt>
          <dd>
            {ORDER_TYPE_LABELS[row.order_type] ?? row.order_type}
            {row.table_label && ` · Table ${row.table_label}`}
          </dd>
        </div>
        <div>
          <dt><Clock aria-hidden /> Placed at</dt>
          <dd>{fullTime(row.created_at, tz)}</dd>
        </div>
        {/* Время выдачи — только у предзаказа: у заказа «на сейчас» его
            нет, и пустая строка сообщала бы о несуществующем сроке. */}
        {row.pickup_at && (
          <div>
            <dt><Clock aria-hidden /> Pickup</dt>
            <dd>{fullTime(row.pickup_at, tz)}</dd>
          </div>
        )}
        {row.customer_phone && (
          <div>
            <dt><Phone aria-hidden /> Phone</dt>
            <dd><a href={`tel:${row.customer_phone}`}>{row.customer_phone}</a></dd>
          </div>
        )}
        {row.delivery_address && (
          <div>
            <dt>Address</dt>
            <dd>{row.delivery_address}</dd>
          </div>
        )}
      </dl>

      <section className="ord-sheet-block">
        <h4>Items</h4>
        <ul className="order-lines">
          {lines.map((line) => (
            <li key={line.key}>
              <span className="order-qty">{line.qty} ×</span>
              <span className="order-line-text">{line.text}</span>
              <span className="order-line-total">{formatMoney(line.total, currency)}</span>
            </li>
          ))}
        </ul>
        {row.note && <p className="order-note"><StickyNote /> {row.note}</p>}
        <p className="ord-sheet-total">
          <span>Total</span>
          <strong>{formatMoney(row.total, currency)}</strong>
        </p>
      </section>

      {row.reject_reason && DONE_STATUSES.includes(row.status) && (
        <p className="order-note">{row.reject_reason}</p>
      )}

      <section className="ord-sheet-block">
        <h4>Activity</h4>
        <Activity orderId={row.id} tz={tz} />
      </section>

      {/*
        Кто владеет заказом. Ссылки в интерфейс кассы здесь нет и быть не
        может: маршрут терминала требует аккаунт устройства и PIN и не
        принимает идентификатор заказа. Честный хендофф — номер, по
        которому заказ найдут на кассе, и состояние смены.
      */}
      {(mode === 'pos' || posSeated) && (
        <div className="ord-handoff">
          <p className="ord-handoff-head"><Store aria-hidden /> Handled on the register</p>
          {posSeated ? (
            <p>
              {row.pos_daily_number
                ? <>On the register as order <strong>#{row.pos_daily_number}</strong>
                  {row.pos_status ? ` · ${row.pos_status}` : ''}.</>
                : 'Accepted on the register — the visit continues there.'}
            </p>
          ) : (
            <p>
              {posShiftOpen
                ? <>Ask for order <strong>{orderNumber(row)}</strong> at the register — the shift is open.</>
                : <>No shift is open right now, so nobody sees this order at the register yet.</>}
            </p>
          )}
        </div>
      )}

      {mode === 'standalone' && !canManage && (
        <p className="ord-sheet-muted">
          Your role can view orders but not change them.
        </p>
      )}
    </Drawer>
  )
}
