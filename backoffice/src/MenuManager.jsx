import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowRight, CheckSquare, ChevronDown, ChevronRight, ImageOff, MapPin, Plus, X,
} from 'lucide-react'
import {
  fetchCategories, fetchItems, fetchModifierGroups, fetchStations,
  createCategory, deleteCategory,
  saveItem, deleteItem, uploadItemImage,
  bulkUpdateItems, bulkErrorText, reorderItems,
} from './menu'
import {
  GAP_LABELS, SORT_MODES, bulkOutcome, bulkPreview, canReorder, changedCount,
  filterItems, itemGaps, moveInOrder, priceLabel, sizesLabel, sortItems, undoPlan,
} from './catalog'
import ItemEditor from './ItemEditor'
import ModifiersTab from './CatalogueModifiers'
import StationsTab from './CatalogueStations'
import Tabs from './ui/Tabs'
import { Button, IconButton } from './ui/Button'
import { RowMenu, OrderButtons } from './ui/RowMenu'
import FormDialog from './ui/FormDialog'
import ConfirmDialog from './ui/ConfirmDialog'
import { SearchField } from './ui/Layout'
import { overlayClass, useOverlayExit } from './ui/overlay-motion'
import useNarrow from './ui/useNarrow'

/**
 * Catalogue — рабочая поверхность всего, что заведение продаёт.
 *
 * Редизайн по `docs/claude-catalogue-approved-redesign-plan.md`. Раздел
 * остаётся универсальным «Каталогом», а не «Меню»: ресторанные блюда —
 * первый случай применения, а не предел продукта.
 *
 * Что изменилось по сравнению со списком-витриной. Каталог отвечает
 * одним взглядом на восемь вопросов — что это, где лежит, как
 * опознаётся, сколько стоит (включая размеры), продаётся ли сейчас,
 * чего не хватает, куда маршрутизируется и что изменится до применения
 * массовой правки. Для этого нужна таблица, а не карточки.
 *
 * Чего здесь намеренно НЕТ, хотя есть в макете: колонки `Channels`,
 * действий `Duplicate` и `Archive`, страниц по 48 позиций. В
 * `menu_items` одно поле `is_available` — вывести из него три
 * независимых канала нельзя, а рисовать всегда включённые галочки
 * значит врать. Разбор — `docs/catalogue-audit-phase0.md`.
 */

const TABS = [
  { key: 'items', label: 'Items' },
  { key: 'modifiers', label: 'Modifiers' },
  { key: 'stations', label: 'Stations' },
]

/** Колонки, которые прячутся на планшете: строка обязана оставаться читаемой */
const SECONDARY = 'cat-col-secondary'

/**
 * Отбор живёт в АДРЕСЕ, как у заказов и броней.
 *
 * До редизайна вкладка переживала перезагрузку, а отбор молча слетал:
 * ссылка «покажи неполные позиции» открывала полный каталог. Ключи
 * общие для всех разделов и безопасны — переход в другой раздел отбор
 * обнуляет, поэтому `st` каталога и `st` заказа не встречаются вместе.
 */
const KEYS = {
  // Товары
  category: 'zn', availability: 'st', state: 'fl', sort: 'so',
  // Модификаторы — свои ключи: «неполные» у товаров и у групп это
  // разные вопросы, и переход на соседнюю вкладку не должен молча
  // переносить туда чужой отбор.
  groupUsage: 'ch', groupState: 'sr', groupSort: 'rg',
}

export const EMPTY_FILTERS = {
  category: 'all', availability: 'all', state: 'all', sort: 'manual',
  groupUsage: 'all', groupState: 'all', groupSort: 'manual',
}

/** Значения отбора из адреса; пустое — «не выбрано» */
export function readFilters(urlFilters = {}) {
  const out = {}
  for (const [name, key] of Object.entries(KEYS)) {
    out[name] = urlFilters[key] || EMPTY_FILTERS[name]
  }
  return out
}

/** Отбор обратно в адрес: значения по умолчанию не пишем */
export function writeFilters(next) {
  const out = {}
  for (const [name, key] of Object.entries(KEYS)) {
    const value = next[name]
    if (value && value !== EMPTY_FILTERS[name]) out[key] = value
  }
  return out
}

/** Цена в шапке каталога — теми же правилами, что в кассе */
function money(agorot) {
  return `₪${((agorot ?? 0) / 100).toFixed(2).replace(/\.00$/, '')}`
}

/**
 * Фото позиции. Размер коробки фиксирован ДО загрузки: иначе строка
 * прыгает, пока едут картинки, и попасть в нужную невозможно.
 */
function Thumb({ item }) {
  if (!item.image_url) {
    return (
      <span className="cat-thumb is-empty" aria-hidden>
        <ImageOff />
      </span>
    )
  }
  return (
    <span className="cat-thumb">
      <img src={item.image_url} alt="" loading="lazy" decoding="async" />
    </span>
  )
}

/** Состояние позиции словом: цвет только усиливает текст, но не заменяет */
function ItemStatus({ item }) {
  const gaps = itemGaps(item)
  if (gaps.length === 0) return <span className="cat-state is-ok">Complete</span>
  return (
    <span className="cat-state is-attention">
      Needs attention
      <small>{gaps.map((g) => GAP_LABELS[g]).join(', ')}</small>
    </span>
  )
}

/** Продаётся или скрыта. Скрытая — нейтрально-серая, это не ошибка. */
function Availability({ item }) {
  return item.is_available
    ? <span className="cat-avail is-on">On sale</span>
    : <span className="cat-avail is-off">Hidden</span>
}

/**
 * Обязательный шаг перед массовой правкой: что именно изменится и во
 * что. Без него владелец узнаёт о переоценке всего меню по выручке.
 */
function BulkReview({ rows, action, busy, error, onCancel, onApply }) {
  const changing = changedCount(rows)
  const { closing, close } = useOverlayExit(onCancel)
  const titles = {
    availability: 'Change availability',
    category: 'Move to another category',
    price: 'Change prices',
  }
  return (
    <div
      className={overlayClass('sheet-backdrop', closing)}
      onClick={busy ? undefined : close}
      role="presentation"
    >
      <div
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-title"
      >
        <h3 id="bulk-title">{titles[action]}</h3>
        <p className="sheet-sub">
          {changing} of {rows.length} selected items change. The rest already look like this.
        </p>
        <div className="bulk-list">
          {rows.map((row) => (
            <div key={row.id} className={`bulk-row${row.changes ? '' : ' is-noop'}`}>
              <span className="bulk-name">{row.name}{row.note && <small> · {row.note}</small>}</span>
              <span className="bulk-change">
                {row.from} <ArrowRight aria-hidden /> <strong>{row.to}</strong>
              </span>
            </div>
          ))}
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="order-actions">
          <Button onClick={close} disabled={busy}>Cancel</Button>
          <Button
            variant="primary"
            size="compact"
            disabled={changing === 0}
            busy={busy}
            busyLabel="Applying…"
            onClick={onApply}
          >
            {`Apply to ${changing} item${changing === 1 ? '' : 's'}`}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Диалог новой категории: имя и точка, которой она принадлежит */
function CategoryDialog({ context, locationId, count, onDone, onCancel }) {
  const [name, setName] = useState('')
  const [location, setLocation] = useState(locationId || context.locations?.[0]?.id || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const many = (context.locations?.length ?? 0) > 1

  async function submit() {
    if (!name.trim()) { setError('Give the category a name.'); return }
    if (!location) { setError('Choose the location this category belongs to.'); return }
    setBusy(true)
    setError('')
    try {
      await createCategory(context, location, name.trim(), count)
      await onDone()
    } catch (e) {
      setError(bulkErrorText(e.message))
      setBusy(false)
    }
  }

  return (
    <FormDialog
      title="Add category"
      description={many
        ? 'Categories belong to one location — items follow their category.'
        : undefined}
      submitLabel="Add category"
      busy={busy}
      error={error}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <label className="qr-field">
        <span>Category name</span>
        <input
          value={name}
          maxLength={64}
          placeholder="Hot drinks"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      {many && (
        <label className="qr-field">
          <span>Location</span>
          <select value={location} onChange={(e) => setLocation(e.target.value)}>
            {context.locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>
      )}
    </FormDialog>
  )
}

// ── Вкладка «Товары» ─────────────────────────────────────────
export function ItemsTab({
  context, locationId, data, reload, filters, onFilters, query, creating, onCreating,
}) {
  const [openItem, setOpenItem] = useState(null) // выбранная позиция
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [pending, setPending] = useState(null) // { action, params, rows }
  const [busy, setBusy] = useState(false)
  const [lastChange, setLastChange] = useState(null)
  const [undoing, setUndoing] = useState(false)
  const [moving, setMoving] = useState(false)
  /*
   * Каталог по умолчанию — рабочая таблица. Разбивка по категориям
   * остаётся вторым режимом: в ней живёт порядок внутри категории,
   * ради которого она и нужна.
   */
  const [mode, setMode] = useState('list')
  const narrow = useNarrow()

  const { category: catFilter, availability, state: stateFilter, sort } = filters
  const filtersOn = query.trim() !== '' || catFilter !== 'all'
    || availability !== 'all' || stateFilter !== 'all'

  const withVariants = useMemo(
    () => data.items.map((i) => ({ ...i, variantCount: (i.item_variants ?? []).length })),
    [data.items]
  )
  const matched = useMemo(
    () => filterItems(withVariants, data.categories, {
      query, categoryId: catFilter, availability, state: stateFilter,
    }),
    [withVariants, data.categories, query, catFilter, availability, stateFilter]
  )
  const visible = useMemo(() => sortItems(matched, sort), [matched, sort])
  const catNames = useMemo(
    () => new Map(data.categories.map((c) => [c.id, c.name])),
    [data.categories]
  )
  const stationNames = useMemo(
    () => new Map(data.stations.map((s) => [s.id, s.name])),
    [data.stations]
  )
  const attentionCount = useMemo(
    () => withVariants.filter((i) => itemGaps(i).length > 0).length,
    [withVariants]
  )
  // Порядок существует внутри категории: в смешанном списке стрелка
  // переставила бы позицию относительно чужих блюд.
  const reorderable = canReorder({ categoryId: catFilter, sort })

  // Выбранная позиция обязана пережить перезагрузку каталога после
  // сохранения: панель показывает свежие данные, а не снимок до правки.
  const current = openItem ? data.items.find((i) => i.id === openItem) ?? null : null
  useEffect(() => {
    if (openItem && !current && !editing) setOpenItem(null)
  }, [openItem, current, editing])

  function toggleSelected(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function askBulk(action, params) {
    setError('')
    setPending({
      action,
      params,
      rows: bulkPreview(withVariants, data.categories, selected, action, params, money),
    })
  }

  async function applyBulk() {
    setBusy(true)
    try {
      await bulkUpdateItems([...selected], pending.action, pending.params)
      const categoryName = pending.action === 'category'
        ? data.categories.find((c) => c.id === pending.params.categoryId)?.name
        : null
      setLastChange({
        summary: bulkOutcome(pending.rows, pending.action, pending.params, categoryName),
        plan: undoPlan(pending.rows, pending.action),
        action: pending.action,
      })
      setPending(null)
      setSelecting(false)
      setSelected(new Set())
      await reload()
    } catch (e) {
      setError(bulkErrorText(e.message))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Отмена. Возвращается ровно то, что изменилось, тем же атомарным RPC.
   * Если один из вызовов не прошёл — говорим об этом прямо: половина
   * отменённой правки хуже, чем неотменённая, только если о ней молчать.
   */
  async function undoLast() {
    if (!lastChange?.plan?.length) return
    setUndoing(true)
    setError('')
    let done = 0
    try {
      for (const step of lastChange.plan) {
        await bulkUpdateItems(step.ids, step.action, step.params)
        done += 1
      }
      setLastChange(null)
      await reload()
    } catch (e) {
      setError(done === 0
        ? bulkErrorText(e.message)
        : `Undo stopped halfway: ${done} of ${lastChange.plan.length} groups restored. ${bulkErrorText(e.message)}`)
      await reload()
    } finally {
      setUndoing(false)
    }
  }

  /**
   * Полный порядок каждой категории — БЕЗ поиска и фильтров.
   *
   * Считать его по видимому списку нельзя: `reorder_menu` расставляет
   * присланным id номера 0..n−1, и отправка отфильтрованной части
   * присвоила бы эти же номера позициям, которых на экране нет. Порядок
   * категории после такого «перемещения на шаг» рассыпается.
   */
  const fullOrders = useMemo(() => {
    const map = new Map()
    for (const item of sortItems(withVariants, 'manual')) {
      const key = catNames.has(item.category_id) ? item.category_id : '__orphans__'
      const list = map.get(key) ?? []
      list.push(item.id)
      map.set(key, list)
    }
    return map
  }, [withVariants, catNames])

  /** Где позиция стоит в порядке СВОЕЙ категории и сколько их всего */
  const orderOf = useCallback((item) => {
    const key = catNames.has(item.category_id) ? item.category_id : '__orphans__'
    const ids = fullOrders.get(key) ?? []
    return { ids, index: ids.indexOf(item.id), total: ids.length }
  }, [fullOrders, catNames])

  /**
   * Порядок внутри категории. Сервер принимает полный список id, поэтому
   * отправляем порядок всей категории, а не «поменять два местами».
   */
  async function moveItem(item, direction) {
    const { ids } = orderOf(item)
    const next = moveInOrder(ids, item.id, direction)
    setMoving(true)
    setError('')
    try {
      await reorderItems(next)
      await reload()
    } catch (e) {
      setError(bulkErrorText(e.message))
    } finally {
      setMoving(false)
    }
  }

  async function hideOne(item, available) {
    setError('')
    try {
      await bulkUpdateItems([item.id], 'availability', { available })
      await reload()
    } catch (e) { setError(bulkErrorText(e.message)) }
  }

  const byCat = useMemo(() => {
    const map = new Map(data.categories.map((c) => [c.id, { ...c, items: [] }]))
    const orphans = []
    for (const it of visible) {
      const bucket = map.get(it.category_id)
      if (bucket) bucket.items.push(it); else orphans.push(it)
    }
    // Пустые категории при активном фильтре только шумят
    const list = [...map.values()].filter((c) => c.items.length > 0 || !filtersOn)
    return { list, orphans }
  }, [data.categories, visible, filtersOn])

  /*
   * Последний нативный `confirm` в кабинете. Он не только выглядит
   * чужим: браузер рисует его без фокус-ловушки и без нашего текста
   * кнопок, а внутри кадра его может не быть вовсе — тогда удаление
   * уходило молча. Спрашиваем своим диалогом.
   */
  const [removing, setRemoving] = useState(null)
  async function removeCategory(id) {
    try { await deleteCategory(id); await reload() } catch (e) { setError(bulkErrorText(e.message)) }
  }

  const rowMenu = (item) => [
    { key: 'edit', label: 'Edit item' },
    item.is_available
      ? { key: 'hide', label: 'Hide from sale' }
      : { key: 'show', label: 'Put on sale' },
  ]
  function onRowAction(item, key) {
    if (key === 'edit') { setOpenItem(item.id); setEditing(true) }
    if (key === 'hide') hideOne(item, false)
    if (key === 'show') hideOne(item, true)
  }

  const allShownSelected = visible.length > 0 && visible.every((i) => selected.has(i.id))

  return (
    <>
      <div className="cat-toolbar">
        <label className="cat-select-filter">
          <span className="visually-hidden">Category</span>
          <select value={catFilter} onChange={(e) => onFilters({ category: e.target.value })}>
            <option value="all">All categories</option>
            {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="cat-select-filter">
          <span className="visually-hidden">Availability</span>
          <select value={availability} onChange={(e) => onFilters({ availability: e.target.value })}>
            <option value="all">All statuses</option>
            <option value="available">On sale</option>
            <option value="hidden">Hidden</option>
          </select>
        </label>
        {/* Счётчик считается по каталогу, а не берётся из макета */}
        <button
          type="button"
          className={`cat-chip${stateFilter === 'incomplete' ? ' is-on' : ''}`}
          aria-pressed={stateFilter === 'incomplete'}
          onClick={() => onFilters({
            state: stateFilter === 'incomplete' ? 'all' : 'incomplete',
          })}
        >
          Needs attention <span>{attentionCount}</span>
        </button>
        <label className="cat-select-filter">
          <span className="visually-hidden">Sort</span>
          <select value={sort} onChange={(e) => onFilters({ sort: e.target.value })}>
            {SORT_MODES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        <Button
          className={selecting ? 'is-on' : undefined}
          aria-pressed={selecting}
          onClick={() => { setSelecting((v) => !v); setSelected(new Set()) }}
        >
          <CheckSquare /> {selecting ? 'Done' : 'Select'}
        </Button>
        <div className="cat-mode">
          <Tabs
            className="period-switch"
            label="Catalogue view"
            items={[{ key: 'list', label: 'List' }, { key: 'groups', label: 'By category' }]}
            value={mode}
            onChange={setMode}
          />
        </div>
        {filtersOn && (
          <button type="button" className="text-button" onClick={() => onFilters(EMPTY_FILTERS)}>
            <X /> Clear
          </button>
        )}
        <span className="cat-count">{visible.length} of {data.items.length}</span>
      </div>

      {selecting && (
        <div className="cat-bulk" role="group" aria-label="Bulk actions">
          <span className="cat-bulk-count">{selected.size} selected</span>
          <Button
            onClick={() => setSelected(allShownSelected ? new Set() : new Set(visible.map((i) => i.id)))}
          >
            {allShownSelected ? 'Clear selection' : 'Select all shown'}
          </Button>
          <Button disabled={selected.size === 0} onClick={() => askBulk('availability', { available: false })}>
            Hide
          </Button>
          <Button disabled={selected.size === 0} onClick={() => askBulk('availability', { available: true })}>
            Put on sale
          </Button>
          <label className="cat-select-filter">
            <span className="visually-hidden">Move to category</span>
            <select
              value=""
              disabled={selected.size === 0}
              onChange={(e) => e.target.value && askBulk('category', { categoryId: e.target.value })}
            >
              <option value="">Move to…</option>
              {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="cat-select-filter">
            <span className="visually-hidden">Change prices</span>
            <select
              value=""
              disabled={selected.size === 0}
              onChange={(e) => e.target.value && askBulk('price', { percent: Number(e.target.value) })}
            >
              <option value="">Change price…</option>
              <option value="10">+10%</option>
              <option value="5">+5%</option>
              <option value="-5">−5%</option>
              <option value="-10">−10%</option>
            </select>
          </label>
        </div>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      {/* Что именно произошло и можно ли это вернуть. Цена не
          отменяется: сервер применяет правило, округление необратимо. */}
      {lastChange && (
        <div className="cat-result" role="status">
          <span>{lastChange.summary}</span>
          {lastChange.plan?.length > 0 ? (
            <Button size="compact" onClick={undoLast} busy={undoing} busyLabel="Undoing…">
              Undo
            </Button>
          ) : (
            <small>
              {lastChange.action === 'price'
                ? 'Prices cannot be rolled back automatically — apply the opposite change if needed.'
                : 'Nothing to undo.'}
            </small>
          )}
          <IconButton label="Dismiss" onClick={() => setLastChange(null)}><X /></IconButton>
        </div>
      )}

      {visible.length === 0 ? (
        <section className="panel cat-panel">
          <p className="empty-state">
            {filtersOn
              ? 'No item matches these filters.'
              : 'The catalogue is empty — add the first item.'}
          </p>
        </section>
      ) : mode === 'list' ? (
        <section className="panel cat-panel">
          {narrow ? (
            <ItemCards
              items={visible}
              catNames={catNames}
              selecting={selecting}
              selected={selected}
              onToggle={toggleSelected}
              openId={openItem}
              onOpen={setOpenItem}
              onAction={onRowAction}
              menuFor={rowMenu}
            />
          ) : (
            <ItemsTable
              items={visible}
              catNames={catNames}
              stationNames={stationNames}
              selecting={selecting}
              selected={selected}
              onToggle={toggleSelected}
              onToggleAll={() => setSelected(
                allShownSelected ? new Set() : new Set(visible.map((i) => i.id))
              )}
              allSelected={allShownSelected}
              openId={openItem}
              onOpen={setOpenItem}
              onAction={onRowAction}
              menuFor={rowMenu}
              reorderable={reorderable}
              moving={moving}
              onMove={moveItem}
              orderOf={orderOf}
            />
          )}
        </section>
      ) : (
        <div className="cat-groups">
          {byCat.list.map((cat) => (
            <CategorySection
              key={cat.id}
              title={cat.name}
              items={cat.items}
              catNames={catNames}
              stationNames={stationNames}
              narrow={narrow}
              selecting={selecting}
              selected={selected}
              onToggle={toggleSelected}
              openId={openItem}
              onOpen={setOpenItem}
              onAction={onRowAction}
              menuFor={rowMenu}
              moving={moving}
              onMove={moveItem}
              orderOf={orderOf}
              onDelete={() => setRemoving({ id: cat.id, name: cat.name })}
            />
          ))}
          {byCat.orphans.length > 0 && (
            <CategorySection
              title="Uncategorised"
              items={byCat.orphans}
              catNames={catNames}
              stationNames={stationNames}
              narrow={narrow}
              selecting={selecting}
              selected={selected}
              onToggle={toggleSelected}
              openId={openItem}
              onOpen={setOpenItem}
              onAction={onRowAction}
              menuFor={rowMenu}
              moving={moving}
              onMove={moveItem}
              orderOf={orderOf}
            />
          )}
        </div>
      )}

      {pending && (
        <BulkReview
          rows={pending.rows}
          action={pending.action}
          busy={busy}
          error={error}
          onCancel={() => setPending(null)}
          onApply={applyBulk}
        />
      )}

      {removing && (
        <ConfirmDialog
          title={`Delete category “${removing.name}”?`}
          description="Items keep existing but lose their category — they move to Uncategorised."
          confirmLabel="Delete category"
          tone="danger"
          onCancel={() => setRemoving(null)}
          onConfirm={async () => { const { id } = removing; setRemoving(null); await removeCategory(id) }}
        />
      )}

      {creating === 'category' && (
        <CategoryDialog
          context={context}
          locationId={locationId}
          count={data.categories.length}
          onDone={async () => { onCreating(null); await reload() }}
          onCancel={() => onCreating(null)}
        />
      )}

      {(creating === 'item' || current) && (
        <ItemEditor
          context={context}
          item={creating === 'item' ? {} : current}
          categories={data.categories}
          stations={data.stations}
          modifierGroups={data.modifierGroups}
          editing={creating === 'item' ? true : editing}
          onEdit={setEditing}
          onClose={() => {
            if (creating === 'item') onCreating(null)
            setOpenItem(null)
            setEditing(false)
          }}
          onSaved={async () => {
            if (creating === 'item') onCreating(null)
            setEditing(false)
            await reload()
          }}
          onDeleted={async () => {
            if (creating === 'item') onCreating(null)
            setOpenItem(null)
            setEditing(false)
            await reload()
          }}
          api={{ saveItem, deleteItem, uploadItemImage }}
        />
      )}
    </>
  )
}

/**
 * Таблица каталога.
 *
 * Настоящая `<table>`, а не строки-кнопки: строка с `role="button"`
 * ломается, как только внутрь попадает чекбокс, стрелки порядка и меню
 * действий — клавиатура начинает открывать карточку вместо нажатия на
 * то, на чём стоит фокус. Карточку открывает отдельная кнопка на имени.
 */
function ItemsTable({
  items, catNames, stationNames, selecting, selected, onToggle, onToggleAll, allSelected,
  openId, onOpen, onAction, menuFor, reorderable, moving, onMove, orderOf,
}) {
  return (
    <div className="cat-table-scroll">
      <table className="cat-table">
        <thead>
          <tr>
            {selecting && (
              <th scope="col" className="cat-col-check">
                <input
                  type="checkbox"
                  checked={allSelected}
                  aria-label="Select all shown items"
                  onChange={onToggleAll}
                />
              </th>
            )}
            {reorderable && <th scope="col" className="cat-col-order">Order</th>}
            <th scope="col" className="cat-col-thumb"><span className="visually-hidden">Photo</span></th>
            <th scope="col">Item</th>
            <th scope="col">Category</th>
            <th scope="col" className={SECONDARY}>SKU</th>
            <th scope="col" className="cat-col-price">Price</th>
            <th scope="col">Availability</th>
            <th scope="col" className={SECONDARY}>Station</th>
            <th scope="col">Status</th>
            <th scope="col" className="cat-col-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const sizes = sizesLabel(item)
            const order = reorderable ? orderOf(item) : null
            return (
              <tr key={item.id} className={`cat-row${item.id === openId ? ' is-selected' : ''}`}>
                {selecting && (
                  <td className="cat-col-check">
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      aria-label={`Select ${item.name}`}
                      onChange={() => onToggle(item.id)}
                    />
                  </td>
                )}
                {reorderable && (
                  <td className="cat-col-order">
                    <OrderButtons
                      label={item.name}
                      index={order.index}
                      total={order.total}
                      disabled={moving}
                      onMove={(dir) => onMove(item, dir)}
                    />
                  </td>
                )}
                <td className="cat-col-thumb"><Thumb item={item} /></td>
                <td>
                  <button
                    type="button"
                    className="cat-open"
                    aria-expanded={item.id === openId}
                    onClick={() => onOpen(item.id)}
                  >
                    {item.name}
                  </button>
                </td>
                <td className="cat-cell-muted">{catNames.get(item.category_id) ?? 'Uncategorised'}</td>
                <td className={`${SECONDARY} cat-cell-sku`}>{item.sku || '—'}</td>
                <td className="cat-col-price">
                  {priceLabel(item, money)}
                  {sizes && <small>{sizes}</small>}
                </td>
                <td><Availability item={item} /></td>
                <td className={`${SECONDARY} cat-cell-muted`}>
                  {stationNames.get(item.station_id) ?? '—'}
                </td>
                <td><ItemStatus item={item} /></td>
                <td className="cat-col-actions">
                  <RowMenu
                    label={`Actions for ${item.name}`}
                    items={menuFor(item)}
                    onPick={(key) => onAction(item, key)}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Каталог на телефоне. Десять колонок, ужатых до 375 px, — это не
 * таблица, а сетка, которую нельзя прочесть; здесь список отвечает на
 * то, ради чего в каталог заходят с телефона: что это, сколько стоит,
 * продаётся ли и чего не хватает.
 */
function ItemCards({
  items, catNames, selecting, selected, onToggle, openId, onOpen, onAction, menuFor,
}) {
  return (
    <ul className="cat-cards">
      {items.map((item) => {
        const sizes = sizesLabel(item)
        return (
          <li key={item.id} className={item.id === openId ? 'is-selected' : undefined}>
            {selecting && (
              <label className="cat-card-check">
                <input
                  type="checkbox"
                  checked={selected.has(item.id)}
                  onChange={() => onToggle(item.id)}
                />
                <span className="visually-hidden">Select {item.name}</span>
              </label>
            )}
            <Thumb item={item} />
            <button
              type="button"
              className="cat-card-open"
              aria-expanded={item.id === openId}
              onClick={() => onOpen(item.id)}
            >
              <span className="cat-card-name">{item.name}</span>
              <span className="cat-card-meta">
                {catNames.get(item.category_id) ?? 'Uncategorised'}
                {item.sku && ` · ${item.sku}`}
              </span>
              <span className="cat-card-price">
                {priceLabel(item, money)}{sizes && <small> · {sizes}</small>}
              </span>
            </button>
            <span className="cat-card-side">
              <Availability item={item} />
              <ItemStatus item={item} />
              <RowMenu
                label={`Actions for ${item.name}`}
                items={menuFor(item)}
                onPick={(key) => onAction(item, key)}
              />
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Категория в режиме «By category»: здесь живёт ручной порядок — тот
 * самый случай, когда «выше» и «ниже» действительно что-то значат.
 */
function CategorySection({
  title, items, catNames, stationNames, narrow, selecting, selected, onToggle,
  openId, onOpen, onAction, menuFor, moving, onMove, orderOf, onDelete,
}) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <section className="panel cat-panel cat-category">
      <div className="cat-category-head">
        <button
          type="button"
          className="collapse-toggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? <ChevronRight /> : <ChevronDown />}
          <span>
            <strong>{title}</strong>
            <small>{items.length} item{items.length === 1 ? '' : 's'}</small>
          </span>
        </button>
        {onDelete && (
          <RowMenu
            label={`Actions for category ${title}`}
            items={[{ key: 'delete', label: 'Delete category', tone: 'danger' }]}
            onPick={onDelete}
          />
        )}
      </div>
      {!collapsed && (items.length === 0 ? (
        <p className="empty-state">No items.</p>
      ) : narrow ? (
        <ItemCards
          items={items}
          catNames={catNames}
          selecting={selecting}
          selected={selected}
          onToggle={onToggle}
          openId={openId}
          onOpen={onOpen}
          onAction={onAction}
          menuFor={menuFor}
        />
      ) : (
        <ItemsTable
          items={items}
          catNames={catNames}
          stationNames={stationNames}
          selecting={selecting}
          selected={selected}
          onToggle={onToggle}
          onToggleAll={() => {}}
          allSelected={false}
          openId={openId}
          onOpen={onOpen}
          onAction={onAction}
          menuFor={menuFor}
          reorderable
          moving={moving}
          onMove={onMove}
          orderOf={orderOf}
        />
      ))}
    </section>
  )
}

export { ModifiersTab, StationsTab }

/** Точка, которой принадлежат новые категории и станции */
function LocationContext({ locations, locationId, onChange }) {
  if (!locations || locations.length < 2) return null
  const title = 'Location for new categories and stations'
  return (
    <label className="cat-location" title={title}>
      <MapPin aria-hidden />
      <span className="visually-hidden">{title}</span>
      <select value={locationId ?? ''} onChange={(event) => onChange?.(event.target.value)}>
        {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
    </label>
  )
}

/** Скелет той же геометрии, что таблица: раздел не прыгает при загрузке */
function CatalogueSkeleton() {
  return (
    <section className="panel cat-panel">
      <div role="status" aria-live="polite" className="visually-hidden">Loading catalogue…</div>
      <div className="cat-skeleton" aria-hidden>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="cat-skeleton-row">
            <span style={{ width: '44px', height: '44px', borderRadius: '10px' }} />
            <span style={{ width: '22%' }} />
            <span style={{ width: '14%' }} />
            <span style={{ width: '10%' }} />
            <span style={{ width: '12%' }} />
          </div>
        ))}
      </div>
    </section>
  )
}

export default function MenuManager({
  context, locationId, onLocationChange, tab: tabFromUrl, onTabChange,
  filters: urlFilters = {}, onFiltersChange,
}) {
  // Вкладка живёт в адресе: перезагрузка и присланная ссылка открывают
  // тот же экран. Неизвестное значение — устаревшая ссылка, не ошибка.
  const tab = TABS.some((t) => t.key === tabFromUrl) ? tabFromUrl : 'items'
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  /*
   * Поиск свой у каждой вкладки: «Search items» и «Search stations» —
   * разные вопросы, и набранное про эспрессо не должно приезжать в
   * отбор станций.
   */
  const [queries, setQueries] = useState({ items: '', modifiers: '', stations: '' })
  // Создание начинается из шапки, а диалог рисует вкладка: так шапка не
  // знает про поля категории, а вкладка — про раскладку шапки.
  const [creating, setCreating] = useState(null)

  const filters = useMemo(() => readFilters(urlFilters), [urlFilters])
  const patchFilters = useCallback((patch) => {
    const next = { ...readFilters(urlFilters), ...patch }
    onFiltersChange?.(writeFilters(next))
  }, [urlFilters, onFiltersChange])

  const setQuery = useCallback(
    (value) => setQueries((prev) => ({ ...prev, [tab]: value })),
    [tab]
  )

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [categories, items, modifierGroups, stations] = await Promise.all([
        fetchCategories(), fetchItems(), fetchModifierGroups(), fetchStations(),
      ])
      setData({ categories, items, modifierGroups, stations })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  const SEARCH = {
    items: 'Search items, SKU or category',
    modifiers: 'Search groups or modifiers',
    stations: 'Search stations or assigned items',
  }

  return (
    <>
      <div className="cat-header">
        <h1>Catalogue</h1>
        <LocationContext
          locations={context.locations}
          locationId={locationId}
          onChange={onLocationChange}
        />
        <SearchField
          className="order-search cat-search"
          label={SEARCH[tab]}
          placeholder={SEARCH[tab]}
          value={queries[tab]}
          onChange={setQuery}
        />
        {/* Действия создания меняются вместе с вкладкой: заводить
            станцию со вкладки товаров незачем, а «Add item» и «Add
            category» на десктопе видны ОБА и не прячутся в меню. */}
        <div className="cat-header-actions">
          {tab === 'items' && (
            <>
              <Button onClick={() => setCreating('category')}>
                <Plus /> Add category
              </Button>
              <Button variant="primary" onClick={() => setCreating('item')}>
                <Plus /> Add item
              </Button>
            </>
          )}
          {tab === 'modifiers' && (
            <Button variant="primary" onClick={() => setCreating('group')}>
              <Plus /> Add modifier group
            </Button>
          )}
          {tab === 'stations' && (
            <Button variant="primary" onClick={() => setCreating('station')}>
              <Plus /> Add station
            </Button>
          )}
        </div>
      </div>

      <Tabs
        className="cat-tabs"
        label="Catalogue section"
        items={TABS}
        value={tab}
        onChange={onTabChange}
      />

      {error && <p className="form-error" role="alert">{error}</p>}

      {loading || !data ? (
        <CatalogueSkeleton />
      ) : (
        <>
          {tab === 'items' && (
            <ItemsTab
              context={context}
              locationId={locationId}
              data={data}
              reload={reload}
              filters={filters}
              onFilters={patchFilters}
              query={queries.items}
              creating={creating}
              onCreating={setCreating}
            />
          )}
          {tab === 'modifiers' && (
            <ModifiersTab
              context={context}
              data={data}
              reload={reload}
              filters={filters}
              onFilters={patchFilters}
              query={queries.modifiers}
              creating={creating}
              onCreating={setCreating}
            />
          )}
          {tab === 'stations' && (
            <StationsTab
              context={context}
              locationId={locationId}
              data={data}
              reload={reload}
              query={queries.stations}
              creating={creating}
              onCreating={setCreating}
            />
          )}
        </>
      )}
    </>
  )
}
