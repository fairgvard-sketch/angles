import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Users, Pencil, Download, GitMerge, ShieldOff, AlertTriangle,
  ChevronDown, ChevronUp, Check,
} from 'lucide-react'
import {
  fetchGuests, fetchGuestCard, fetchGuestTags, fetchDuplicates,
  saveGuestProfile, mergeGuests, anonymizeGuest,
  formatMoney, formatPhone, normalizePhoneInput, lastVisitLabel, formatDateTime,
  visitsLabel, loyaltyLabel, guestRowLabel, loadedCountLabel, tagTone,
  SEGMENT_LABEL, primarySegment, whySegment,
  SEGMENTS, SORTS, segmentSummary, parseTagsInput, TAG_LIMIT,
  guestsToCsv, csvFileName, duplicateReason, mergeConfirmText, mergePreview, mergeSources,
  customerErrorText,
} from './guests'
import { visibleCustomerTabs } from './navigation'
import LoyaltySettings from './LoyaltySettings'
import { EmptyPanel, ErrorText, PageHeader, SearchField } from './ui/Layout'
import Drawer from './ui/Drawer'
import Tabs from './ui/Tabs'
import ConfirmDialog from './ui/ConfirmDialog'
import { Button } from './ui/Button'
import Skeleton, { SkeletonPanel, SkeletonRow } from './ui/Skeleton'

/**
 * «Customers» — база клиентов организации (114/115/121, правки 131).
 *
 * Раздел умел только читать: имя и заметку правили на терминале, телефон
 * не правился нигде, а один человек с двумя написаниями номера жил двумя
 * записями. Здесь владелец правит профиль, объединяет дубли, режет базу
 * на сегменты, выгружает срез и стирает данные по просьбе клиента.
 *
 * Балансы по-прежнему меняет только касса (apply_loyalty/pay_order):
 * начислять баллы из кабинета — это не правка профиля, а операция.
 *
 * Редизайн по `docs/claude-customers-approved-redesign-plan.md`. Прежний
 * список отвечал на вопросы вразнобой: имя, баланс, визиты, сумма и
 * «когда был» стояли в потоке без колонок, поэтому две строки нельзя
 * было сравнить глазом — а именно за этим в базу и заходят («кто ходит
 * чаще», «кто оставляет больше»). Теперь это таблица с устойчивыми
 * колонками, а профиль открывается сбоку, не убирая список из вида.
 *
 * Серверное здесь всё, кроме оформления: поиск (300 мс), сегменты, метки
 * и порядок считает `get_backoffice_guests`, метки и дубли — свои RPC.
 * Ни клиентского отбора, ни клиентской «страницы» не добавлено: RPC
 * отдаёт срез в 200 строк, и счётчик над списком говорит об этом прямо.
 */

/** Метка: один и тот же оттенок в строке, в фильтре и в профиле */
function TagChip({ tag }) {
  return <span className={`cus-tag is-tone-${tagTone(tag)}`}>{tag}</span>
}

function TagChips({ tags }) {
  if (!tags?.length) return null
  return (
    <span className="cus-row-tags">
      {tags.map((tag) => <TagChip tag={tag} key={tag} />)}
    </span>
  )
}

/**
 * Строка клиента.
 *
 * Вся строка — одна кнопка, и это осознанно иначе, чем в заказах и
 * каталоге: там в строке живут меню действий и стрелки порядка, и кнопка
 * поверх ячеек ломала бы их. Здесь у строки ровно одно назначение —
 * открыть профиль, поэтому целью служит вся строка, а не имя в первой
 * ячейке. Отсюда и разметка: не `<table>`, а сетка, у которой шапка
 * повторяет колонки строки.
 *
 * Числа до читалки не доходят: `aria-label` заменяет содержимое кнопки
 * целиком, поэтому имя строки собирает `guestRowLabel`.
 */
function CustomerRow({ guest, mode, selected, onOpen }) {
  return (
    <button
      type="button"
      className={`cus-row${selected ? ' is-selected' : ''}`}
      aria-label={guestRowLabel(guest, mode)}
      aria-expanded={selected}
      onClick={() => onOpen(guest)}
    >
      <span className="cus-cell-name">
        <strong>{guest.name || formatPhone(guest.phone)}</strong>
        {guest.name && guest.phone && <small>{formatPhone(guest.phone)}</small>}
        {/* Автоматический сегмент и ручные метки различимы: первый
            считает сервер по визитам (155), вторые ставит человек. */}
        <SegmentChip guest={guest} />
        <TagChips tags={guest.tags} />
      </span>
      <span className="cus-cell-loyalty">{loyaltyLabel(guest, mode)}</span>
      {/* Визиты считает сервер по броням И кассе (155): у точки без
          кассы колонка лояльности нулевая, а гость ходит каждую неделю. */}
      <span className="cus-cell-num" data-label="Visits">
        {guest.why_segment?.visits ?? guest.visits ?? 0}
      </span>
      <span className="cus-cell-num" data-label="Total spent">
        {formatMoney(guest.total_spent)}
      </span>
      <span className="cus-cell-seen" data-label="Last visit">
        {lastVisitLabel(guest.last_visit_at)}
      </span>
    </button>
  )
}

/**
 * Автоматический сегмент строки.
 *
 * Ровно один — тот, что важнее прочих; остальные видны в карточке.
 * Метка без объяснения бесполезна, поэтому «почему» уходит в подсказку
 * и в имя для читалки.
 */
function SegmentChip({ guest }) {
  const key = primarySegment(guest.segments)
  if (!key) return null
  const why = whySegment(key, guest.why_segment)
  const label = SEGMENT_LABEL[key] ?? key
  return (
    <span
      className={`cus-segment is-${key.replace('_', '-')}`}
      title={why || undefined}
    >
      {label}
    </span>
  )
}

/**
 * Правка профиля. Телефон — ключ узнавания: по нему находят человека
 * заказы с сайта и брони, поэтому занятый номер сервер отдаёт отдельным
 * кодом, а кабинет предлагает слияние вместо «нарушения уникальности».
 */
function ProfileEditor({ guest, card, onSaved, onCancel }) {
  const [name, setName] = useState(card?.name ?? guest.name ?? '')
  const [phone, setPhone] = useState(card?.phone ?? guest.phone ?? '')
  const [notes, setNotes] = useState(card?.notes ?? '')
  const [tagText, setTagText] = useState((card?.tags ?? []).join(', '))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const tags = parseTagsInput(tagText)

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const digits = normalizePhoneInput(phone)
      await saveGuestProfile(guest.id, {
        name: name.trim() || null,
        // Телефон отправляем только изменённым: иначе любая правка
        // заметки спотыкалась бы о проверку номера.
        phone: digits && digits !== (card?.phone ?? guest.phone) ? digits : null,
        notes,
        tags,
      })
      onSaved()
    } catch (err) {
      setError(customerErrorText(err.message))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="cus-form" onSubmit={submit}>
      {/* Первый фокус ставит сама панель: она объявляет читалке имя
          клиента целиком, а не первое попавшееся поле. Поэтому autoFocus
          здесь не стоит — он всё равно был бы перебит. */}
      <div className="field-row">
        <label>
          <span>Name</span>
          <input
            type="text"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          <span>Phone</span>
          <input
            type="text"
            inputMode="tel"
            value={phone}
            maxLength={20}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
      </div>
      <label>
        <span>Tags</span>
        <input
          type="text"
          value={tagText}
          placeholder="VIP, allergy, regular"
          onChange={(e) => setTagText(e.target.value)}
        />
      </label>
      <p className="form-hint cus-form-hint">
        Separate tags with commas — up to {TAG_LIMIT}. Tags and notes stay
        internal: guests never see them.
      </p>
      <label>
        <span>Note</span>
        <textarea
          value={notes}
          maxLength={500}
          rows={3}
          placeholder="Oat milk, no sugar"
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="cus-form-actions">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" size="compact" type="submit" busy={saving} busyLabel="Saving…">
          Save
        </Button>
      </div>
    </form>
  )
}

/**
 * Стирание личных данных. Необратимо, поэтому сервер сверяет введённый
 * номер с профилем: промах строкой в списке не должен стереть чужого
 * человека. Что остаётся — сказано прямо здесь, а не в справке.
 */
function ErasePanel({ guest, onDone, onCancel }) {
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await anonymizeGuest(guest.id, confirm)
      onDone()
    } catch (err) {
      setError(customerErrorText(err.message))
      setBusy(false)
    }
  }

  return (
    <form className="cus-form cus-erase" onSubmit={submit}>
      <p className="cus-erase-lead">
        <AlertTriangle aria-hidden />
        Erase the name, phone, note and tags of this customer, and the contact
        details on their past bookings.
      </p>
      <p className="cus-erase-keep">
        Orders and receipts stay: they are accounting records and must be kept.
        Loyalty balance stays with the empty profile and can no longer be
        claimed — the phone will not match anyone.
      </p>
      <label>
        <span>Type {formatPhone(guest.phone)} to confirm</span>
        <input
          type="text"
          inputMode="tel"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="cus-form-actions">
        <Button onClick={onCancel}>Cancel</Button>
        <button type="submit" className="danger-button" disabled={busy}>
          {busy ? 'Erasing…' : 'Erase personal data'}
        </button>
      </div>
    </form>
  )
}

/** Тихий раздел профиля: подпись и содержимое, а не карточка в карточке */
function CardSection({ label, children }) {
  return (
    <section className="cus-section">
      <h4>{label}</h4>
      {children}
    </section>
  )
}

/** История заказов гостя: строка раскрывается в состав */
function OrderHistory({ orders }) {
  const [openId, setOpenId] = useState(null)

  if (orders.length === 0) return <p className="empty-state">No orders yet</p>

  return (
    <div className="cus-orders">
      {orders.map((o) => {
        const open = openId === o.id
        return (
          <div className={`cus-order${open ? ' is-open' : ''}`} key={o.id}>
            <button
              type="button"
              className="cus-order-head"
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : o.id)}
            >
              <strong>#{o.daily_number}</strong>
              <span className="cus-order-date">{formatDateTime(o.created_at)}</span>
              <span className="cus-order-total">{formatMoney(o.total)}</span>
              {open ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
            </button>
            {open && (
              <div className="cus-order-items">
                {o.items.length === 0 ? (
                  <p className="empty-state">No items</p>
                ) : o.items.map((it, i) => (
                  <div className="cus-order-item" key={i}>
                    <span className="qty">{it.qty}×</span>
                    <span className="name">
                      {it.name}{it.variant_name ? ` · ${it.variant_name}` : ''}
                    </span>
                    <span className="sum">{formatMoney(it.line_total)}</span>
                  </div>
                ))}
                {o.loyalty_discount > 0 && (
                  <div className="cus-order-item is-discount">
                    <span className="name">Loyalty reward</span>
                    <span className="sum">−{formatMoney(o.loyalty_discount)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Что видно в профиле: четыре числа, поведение в бронях, внутренние
 * метки, заметка, любимые позиции и история. Отдельный компонент, а не
 * ветка тернарника в панели: чтение — самая крупная часть карточки, и
 * рядом с формами правки его невозможно было читать.
 */
function ProfileView({ guest, card, mode, error, onErase }) {
  const [tab, setTab] = useState('orders')
  const orders = card?.orders ?? []
  const favorites = card?.favorites ?? []
  const events = card?.events ?? []
  // Kassa 121: ресторанное поведение и внутренние метки. У точки без кассы
  // заказы пусты, а этот блок полон — профиль осмыслен и без POS.
  const rsv = card?.reservations
  const tags = card?.tags ?? []

  return (
    <>
      <div className="cus-stats">
        <div>
          <span>{mode === 'stamps' ? 'Stamps' : 'Points'}</span>
          <strong>{mode === 'stamps' ? guest.stamps ?? 0 : formatMoney(guest.points)}</strong>
        </div>
        <div><span>Visits</span><strong>{guest.visits ?? 0}</strong></div>
        <div><span>Total spent</span><strong>{formatMoney(guest.total_spent)}</strong></div>
        <div><span>Last visit</span><strong>{lastVisitLabel(guest.last_visit_at)}</strong></div>
      </div>

      {rsv && rsv.total > 0 && (
        <CardSection label="Bookings">
          <div className="cus-chips">
            <span className="cus-chip">{rsv.visits} visits</span>
            {rsv.upcoming > 0 && <span className="cus-chip">{rsv.upcoming} upcoming</span>}
            {rsv.no_shows > 0 && (
              <span className="cus-chip is-warn">{rsv.no_shows} no-show</span>
            )}
            {rsv.cancelled > 0 && <span className="cus-chip">{rsv.cancelled} cancelled</span>}
            {rsv.zone && <span className="cus-chip">{rsv.zone}</span>}
            {rsv.avg_party && <span className="cus-chip">~{rsv.avg_party} guests</span>}
          </div>
        </CardSection>
      )}

      {tags.length > 0 && (
        <CardSection label="Tags">
          <div className="cus-chips">
            {tags.map((tag) => <TagChip tag={tag} key={tag} />)}
          </div>
        </CardSection>
      )}

      {card?.notes && (
        <CardSection label="Internal note">
          <p className="cus-note">{card.notes}</p>
          {/* Обещание, данное в правке профиля, повторено там, где заметку
              читают: метки и заметки гостю не показываются нигде. */}
          <p className="cus-note-hint">Visible to staff only — never to the guest.</p>
        </CardSection>
      )}

      {favorites.length > 0 && (
        <CardSection label="Usually orders">
          <div className="cus-chips">
            {favorites.map((f) => (
              <span className="cus-chip" key={f.name}>{f.name} · {f.qty}</span>
            ))}
          </div>
        </CardSection>
      )}

      <Tabs
        className="cus-tabs"
        label="Guest history"
        items={[
          { key: 'orders', label: 'Orders' },
          { key: 'events', label: 'Loyalty log' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {error && <ErrorText>{error}</ErrorText>}

      {!card && !error ? (
        /*
         * Скелет, а не «Loading…»: карточка открывается листом снизу, и
         * пока она едет, приходит ответ сервера. Строка текста
         * сменялась историей заказов прямо посреди движения — лист менял
         * высоту на ходу и дёргался. Скелет держит ту же геометрию,
         * что и готовый список.
         */
        <Skeleton label="Loading the customer…">
          {[0, 1, 2].map((i) => <SkeletonRow key={i} height={46} columns={['28%', '18%']} />)}
        </Skeleton>
      ) : tab === 'orders' ? (
        <OrderHistory orders={orders} />
      ) : events.length === 0 ? (
        <p className="empty-state">Nothing earned yet</p>
      ) : (
        <div className="cus-events">
          {events.map((e, i) => {
            const delta = mode === 'stamps' ? e.stamps_delta : e.points_delta
            return (
              <div className="cus-event" key={i}>
                <span className="cus-event-date">{formatDateTime(e.created_at)}</span>
                <span className={`cus-event-delta ${delta > 0 ? 'is-positive' : ''}`}>
                  {delta > 0 ? '+' : ''}
                  {mode === 'stamps' ? delta : formatMoney(Math.abs(delta))}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Приватность внизу карточки: это последнее, что делают с
          клиентом, и оно не должно стоять рядом с «Edit». */}
      <div className="cus-privacy">
        <h4>Privacy</h4>
        <button type="button" className="text-button is-danger" onClick={onErase}>
          <ShieldOff aria-hidden /> Erase personal data
        </button>
      </div>
    </>
  )
}

/**
 * Профиль клиента: чтение, правка и стирание в одной панели.
 *
 * Панель, а не модалка: список остаётся на месте, выбранная строка видна
 * рядом, и щелчок по соседней открывает её — как в заказах и каталоге.
 */
function GuestCard({ guest, onModeKnown, onChanged, onClose }) {
  const [card, setCard] = useState(null)
  const [error, setError] = useState('')
  const [pane, setPane] = useState('view')

  const load = useCallback(() => {
    let alive = true
    fetchGuestCard(guest.id)
      .then((d) => { if (alive) { setCard(d); onModeKnown(d?.loyalty_mode) } })
      .catch((e) => { if (alive) setError(customerErrorText(e.message)) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guest.id])

  useEffect(() => load(), [load])

  // Режим приходит с сервера (115): штампы — счёт, баллы — деньги
  const mode = card?.loyalty_mode === 'stamps' ? 'stamps' : 'points'
  const title = card?.name || guest.name || formatPhone(card?.phone || guest.phone)
  const subtitle = card?.phone ? formatPhone(card.phone) : null

  return (
    <Drawer
      labelledBy="guest-card-title"
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      /*
       * Чтение стоит рядом со списком: щелчок по соседнему клиенту должен
       * открыть его, а не закрыть панель. Правка и стирание, наоборот,
       * модальны — в них набран текст, и промах мимо панели не должен ни
       * переключить клиента, ни потерять набранное.
       */
      modal={pane !== 'view'}
      actions={pane === 'view' && card && (
        <Button size="compact" onClick={() => setPane('edit')}>
          <Pencil aria-hidden /> Edit
        </Button>
      )}
    >
      {pane === 'edit' ? (
        <ProfileEditor
          guest={guest}
          card={card}
          onCancel={() => setPane('view')}
          onSaved={() => { setPane('view'); load(); onChanged() }}
        />
      ) : pane === 'erase' ? (
        <ErasePanel
          guest={{ ...guest, phone: card?.phone ?? guest.phone }}
          onCancel={() => setPane('view')}
          onDone={() => { onChanged(); onClose() }}
        />
      ) : (
        <ProfileView
          guest={guest}
          card={card}
          mode={mode}
          error={error}
          onErase={() => setPane('erase')}
        />
      )}
    </Drawer>
  )
}

/**
 * Дубли. Кабинет только подсказывает: «Дана Леви» бывает и двумя разными
 * людьми, поэтому владелец сам выбирает, какой профиль останется.
 */
function DuplicateGroup({ group, busy, onMerge }) {
  const [targetId, setTargetId] = useState(group.guests?.[0]?.id ?? null)
  // Слияние необратимо: спрашиваем ещё раз и называем обе стороны
  const [asking, setAsking] = useState(false)
  const target = (group.guests ?? []).find((g) => g.id === targetId)
  const sources = mergeSources(group, targetId)
  const targetName = target ? (target.name || formatPhone(target.phone)) : ''

  return (
    <div className="dup-group">
      <p className="dup-reason">{duplicateReason(group)}</p>
      <div className="dup-options" role="radiogroup" aria-label="Profile to keep">
        {(group.guests ?? []).map((g) => {
          const label = g.name || formatPhone(g.phone)
          const chosen = g.id === targetId
          return (
            <button
              type="button"
              role="radio"
              aria-checked={chosen}
              className={`dup-option${chosen ? ' is-selected' : ''}`}
              key={g.id}
              onClick={() => setTargetId(g.id)}
            >
              <span className="dup-option-mark" aria-hidden>
                {chosen && <Check />}
              </span>
              <span className="dup-option-body">
                <strong>{label}</strong>
                <small>{formatPhone(g.phone)}</small>
                <span>
                  {visitsLabel(g.visits)} · {formatMoney(g.total_spent)}
                  {' · '}{lastVisitLabel(g.last_visit_at)}
                </span>
              </span>
              {/* Те же слова, что в подтверждении: «останется» и «уйдёт из
                  списка». Иначе владелец сверяет две разные формулировки. */}
              <span className="dup-option-state">
                {chosen ? 'Keeping' : 'Disappears from the list'}
              </span>
            </button>
          )
        })}
      </div>
      <p className="dup-preview">
        {sources.length === 1
          ? mergePreview(target, sources[0])
          : `Everything from ${sources.length} profiles moves to ${targetName}. The old numbers keep working — they will lead to this profile.`}
      </p>
      <Button
        variant="primary"
        size="compact"
        disabled={busy || !target || sources.length === 0}
        onClick={() => setAsking(true)}
      >
        {busy ? 'Merging…' : `Merge into ${targetName}`}
      </Button>

      {/*
        Последний шаг именует обе стороны: что останется и что исчезнет.
        Слияние не удаляет исходный профиль (он становится указателем), но
        из списков он уходит навсегда, и вернуть его кнопкой нельзя.
      */}
      {asking && (
        <ConfirmDialog
          title={`Merge into ${targetName}?`}
          description={mergeConfirmText(target, sources)}
          confirmLabel="Merge profiles"
          cancelLabel="Keep them separate"
          tone="danger"
          busy={busy}
          onCancel={() => setAsking(false)}
          onConfirm={() => { setAsking(false); onMerge(targetId, sources.map((g) => g.id)) }}
        />
      )}
    </div>
  )
}

/**
 * Directory — сам список клиентов, дубли и профиль. Это прежний экран
 * целиком: он лишь стал вкладкой раздела, поэтому получает полосу вкладок
 * (`tabs`) в свою строку заголовка, а экран дублей переехал из вкладки в
 * режим (`duplicates`) — вкладок у раздела теперь две настоящие.
 */
function CustomerDirectory({ context, duplicates: showDuplicates, onDuplicatesChange, tabs: tabStrip }) {
  const [guests, setGuests] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [segment, setSegment] = useState('all')
  const [tags, setTags] = useState([])
  const [sort, setSort] = useState('recent')
  const [tagCounts, setTagCounts] = useState([])
  const [duplicates, setDuplicates] = useState([])
  // Экран дублей — тоже адресуемое состояние: ссылку на него шлют в
  // поддержку, и перезагрузка не должна возвращать в общий список.
  const view = showDuplicates ? 'duplicates' : 'list'
  const setView = (next) => onDuplicatesChange?.(next === 'duplicates')
  const [merging, setMerging] = useState(null)
  const [selected, setSelected] = useState(null)

  // Поиск идёт на сервер — не дёргаем его на каждую букву
  useEffect(() => {
    const id = setTimeout(() => setQuery(search), 300)
    return () => clearTimeout(id)
  }, [search])

  const filters = useMemo(
    () => ({ search: query, segment, tags, sort }),
    [query, segment, tags, sort],
  )

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    try {
      setGuests(await fetchGuests(filters))
    } catch (e) {
      setError(customerErrorText(e.message))
    } finally {
      setLoading(false)
    }
  }, [filters])

  // Метки и дубли считаются по всей базе, а не по срезу: они и нужны,
  // чтобы срез выбрать.
  const loadAside = useCallback(async () => {
    try {
      const [t, d] = await Promise.all([fetchGuestTags(), fetchDuplicates()])
      setTagCounts(t)
      setDuplicates(d)
    } catch {
      // Подсказки не должны ронять список: он полезен и без них
    }
  }, [])

  useEffect(() => {
    load()
    loadAside()
    const timer = setInterval(() => {
      load(true)
      loadAside()
    }, 60_000)
    return () => clearInterval(timer)
  }, [load, loadAside])

  // Режим программы (штампы/баллы) знает только сервер — контекст
  // бэкофиса его не отдаёт. Берём из первой открытой карточки (115) и
  // запоминаем; до этого список показывает и штампы, и баллы.
  const [mode, setMode] = useState(null)

  const total = guests?.length ?? 0
  const timeZone = context.locations?.[0]?.timezone || 'Asia/Jerusalem'

  function exportCsv() {
    const csv = guestsToCsv(guests ?? [], { timeZone })
    // BOM: без него Excel открывает ивритские имена как мусор
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = csvFileName()
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function runMerge(targetId, sourceIds) {
    setMerging(targetId)
    setError('')
    try {
      // По одному: слияние атомарно на паре, и частичный успех честнее
      // молчаливого «что-то не переехало».
      for (const sourceId of sourceIds) await mergeGuests(targetId, sourceId)
      await Promise.all([load(true), loadAside()])
    } catch (e) {
      setError(customerErrorText(e.message))
      await loadAside()
    } finally {
      setMerging(null)
    }
  }

  const filtered = segment !== 'all' || tags.length > 0 || query.trim() !== ''

  return (
    <>
      <PageHeader
        title="Customers"
        actions={(
          <Button
            className="page-export-button"
            size="compact"
            aria-label="Export customers as CSV"
            disabled={!total}
            onClick={exportCsv}
            title="Download the customers you are looking at right now"
          >
            <Download aria-hidden /> <span className="page-export-label">Export CSV</span>
          </Button>
        )}
      />

      {tabStrip}

      <div className="cus-toolbar">
        <SearchField
          label="Search customers"
          value={search}
          onChange={setSearch}
          placeholder="Name or phone"
          className="order-search cus-search"
        />

        <label className="cus-select">
          <span className="visually-hidden">Sort customers</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>

        {/* Пока экран дублей открыт, кнопка остаётся: после слияния
            последней пары список подсказок пустеет, и без неё владелец
            оставался на экране без выхода. */}
        {(duplicates.length > 0 || view === 'duplicates') && (
          <Button
            variant={view === 'duplicates' ? 'primary' : 'secondary'}
            size="compact"
            aria-pressed={view === 'duplicates'}
            onClick={() => setView(view === 'duplicates' ? 'list' : 'duplicates')}
          >
            <GitMerge aria-hidden />
            {view === 'duplicates' ? 'Back to list' : `Possible duplicates (${duplicates.length})`}
          </Button>
        )}

        {/* Счётчик — загруженный срез, а не размер базы: листать нечем,
            и обещать «столько у вас клиентов» кабинет не вправе. */}
        <p className="cus-count" role="status">
          {loading && !guests ? 'Loading…' : loadedCountLabel(total)}
        </p>
      </div>

      {view === 'list' && (
        <div className="cus-filters">
          <div className="cus-chip-row" role="radiogroup" aria-label="Customer segment">
            {SEGMENTS.map((s) => (
              <button
                type="button"
                role="radio"
                aria-checked={segment === s.key}
                className={`segment-chip${segment === s.key ? ' is-selected' : ''}`}
                key={s.key}
                title={s.hint || undefined}
                onClick={() => setSegment(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Метки — отдельная строка и отдельная семантика: сегмент один,
              меток можно набрать несколько. Одной полосой чипов это
              различие приходилось угадывать. */}
          {tagCounts.length > 0 && (
            <div className="cus-chip-row is-tags" role="group" aria-label="Filter by tag">
              {tagCounts.map((t) => {
                const on = tags.includes(t.tag)
                return (
                  <button
                    type="button"
                    className={`cus-tag-chip is-tone-${tagTone(t.tag)}${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    key={t.tag}
                    onClick={() => setTags((prev) => (
                      prev.includes(t.tag) ? prev.filter((x) => x !== t.tag) : [...prev, t.tag]
                    ))}
                  >
                    {on && <Check aria-hidden />}
                    {t.tag} <small>{t.guests}</small>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {error && <ErrorText>{error}</ErrorText>}

      {view === 'duplicates' ? (
        duplicates.length === 0 ? (
          <EmptyPanel
            icon={<GitMerge />}
            title="No duplicates left"
            description="Every profile here looks like a different person."
            action={(
              <Button variant="primary" size="compact" onClick={() => setView('list')}>
                Back to customers
              </Button>
            )}
          />
        ) : (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>{duplicates.length} possible duplicate{duplicates.length === 1 ? '' : 's'}</h2>
                <p>
                  The same person can have two profiles — one number written two
                  ways, or a second phone. Choose which profile to keep.
                </p>
              </div>
            </div>
            <div className="dup-list">
              {duplicates.map((group) => (
                <DuplicateGroup
                  key={`${group.reason}:${group.key}`}
                  group={group}
                  busy={merging !== null}
                  onMerge={runMerge}
                />
              ))}
            </div>
          </section>
        )
      ) : loading && !guests ? (
        /* Таблица клиентов: имя, телефон, визиты, сумма, последний раз. */
        <Skeleton label="Loading the customer list…">
          <SkeletonPanel>
            {Array.from({ length: 7 }, (_, i) => (
              <SkeletonRow key={i} height={56} columns={['24%', '16%', '8%', '12%', '14%']} />
            ))}
          </SkeletonPanel>
        </Skeleton>
      ) : total === 0 ? (
        <EmptyPanel
          icon={<Users />}
          title={filtered ? 'Nothing found' : 'No customers yet'}
          description={filtered
            ? 'No customer matches this segment. Try another one or clear the search.'
            : 'Members appear here once the loyalty programme is switched on and guests start paying at the till.'}
        />
      ) : (
        <section className="panel cus-panel">
          {/* Что именно показано, говорится только когда список сужен:
              у нетронутой базы это повторяло бы порядок сортировки. */}
          {filtered && (
            <p className="cus-summary">{segmentSummary({ segment, tags, search: query })}</p>
          )}
          <div className="cus-list">
            {/* Шапка колонок скрыта от читалки: имя строки уже называет
                все значения, и второй раз перечислять их незачем. */}
            <div className="cus-head" aria-hidden="true">
              <span>Customer</span>
              <span>Loyalty</span>
              <span className="cus-cell-num">Visits</span>
              <span className="cus-cell-num">Total spent</span>
              <span>Last visit</span>
            </div>
            {guests.map((g) => (
              <CustomerRow
                key={g.id}
                guest={g}
                mode={mode}
                selected={selected?.id === g.id}
                onOpen={setSelected}
              />
            ))}
          </div>
        </section>
      )}

      {selected && (
        <GuestCard
          /* Ключ по клиенту: панель немодальна, соседнюю строку открывают
             щелчком, и карточка прошлого клиента не должна досидеть до
             ответа сервера по новому. */
          key={selected.id}
          guest={selected}
          onModeKnown={(m) => { if (m && m !== 'off') setMode(m) }}
          onChanged={() => { load(true); loadAside() }}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  )
}

/**
 * «Customers» отвечает на два вопроса: кто эти люди (Directory) и как
 * устроена программа лояльности (Loyalty).
 *
 * Программа переехала сюда из настроек точки — см. `LoyaltySettings`.
 * Хранение и сервер не изменились; изменилось место, где её ищут.
 */
export default function GuestsManager({
  context, tab: tabFromUrl, onTabChange, mode, onModeChange, locationId, onLocationChange,
}) {
  const tabs = visibleCustomerTabs(context)
  /*
   * Ссылка на скрытую вкладку (закладка владельца, у которого отключили
   * кассу) ведёт в Directory, а не на пустой экран.
   */
  const tab = tabs.some((t) => t.key === tabFromUrl) ? tabFromUrl : 'directory'

  /*
   * Несохранённые правила программы. Ровно та же защита, что была в
   * настройках точки: уход с вкладки спрашивает, закрытие вкладки браузера
   * предупреждает. Потерять набранный процент кэшбэка молча нельзя.
   */
  const [dirty, setDirty] = useState(false)
  const [pendingTab, setPendingTab] = useState(null)

  useEffect(() => {
    if (!dirty) return undefined
    function onBeforeUnload(event) {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  function askTab(next) {
    if (!dirty || next === tab) { onTabChange?.(next); return }
    setPendingTab(next)
  }

  const tabStrip = tabs.length > 1 ? (
    <Tabs
      className="location-tabs settings-topic-tabs"
      label="Customers topic"
      items={tabs.map((t) => ({ key: t.key, label: t.label }))}
      value={tab}
      onChange={askTab}
    />
  ) : null

  const leaveGuard = pendingTab && (
    <ConfirmDialog
      title="Leave without saving?"
      description="The loyalty changes are not saved yet. Leaving loses them."
      confirmLabel="Discard changes"
      cancelLabel="Keep editing"
      tone="danger"
      onCancel={() => setPendingTab(null)}
      onConfirm={() => { setDirty(false); onTabChange?.(pendingTab); setPendingTab(null) }}
    />
  )

  if (tab === 'loyalty') {
    return (
      <>
        <PageHeader title="Customers" />
        {tabStrip}
        {leaveGuard}
        <LoyaltySettings
          locations={context?.locations || []}
          locationId={locationId}
          onLocationChange={onLocationChange}
          onDirty={setDirty}
        />
      </>
    )
  }

  return (
    <>
      {leaveGuard}
      <CustomerDirectory
        context={context}
        duplicates={mode === 'duplicates'}
        onDuplicatesChange={(on) => onModeChange?.(on ? 'duplicates' : null)}
        tabs={tabStrip}
      />
    </>
  )
}
