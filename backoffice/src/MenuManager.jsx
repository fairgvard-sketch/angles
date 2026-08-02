import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown, ArrowRight, ArrowUp, CheckSquare, ChevronDown, ChevronRight,
  Plus, Search, Trash2, X,
} from 'lucide-react'
import {
  agorotToShekels, shekelsToAgorot,
  fetchCategories, fetchItems, fetchModifierGroups, fetchStations,
  createCategory, updateCategory, deleteCategory,
  saveItem, deleteItem, uploadItemImage,
  createModifierGroup, updateModifierGroup, deleteModifierGroup,
  createModifier, updateModifier, deleteModifier,
  createStation, updateStation, deleteStation,
  bulkUpdateItems, bulkErrorText, reorderItems,
} from './menu'
import {
  GAP_LABELS, bulkOutcome, bulkPreview, changedCount, filterItems, itemGaps, moveInOrder,
  undoPlan,
} from './catalog'
import ItemEditor from './ItemEditor'
import { hasCapability } from './navigation'
import Tabs from './ui/Tabs'
import { Button, IconButton } from './ui/Button'
import { PageHeader } from './ui/Layout'

/**
 * Меню в бэкофисе — паритет с POS: товары (создание/правка/удаление, варианты,
 * модификаторы, фото, станция), категории, группы модификаторов, станции.
 * Три вкладки, как в кассе.
 */

const TABS = [
  { key: 'items', label: 'Items' },
  { key: 'modifiers', label: 'Modifiers' },
  { key: 'stations', label: 'Stations' },
]

/** Отбор по умолчанию: ничего не отфильтровано. */
export const EMPTY_FILTERS = { query: '', category: 'all', availability: 'all', state: 'all' }

function money(agorot) {
  return `${agorotToShekels(agorot).toLocaleString('he-IL', { minimumFractionDigits: agorot % 100 ? 2 : 0 })} ₪`
}

/**
 * Набор свёрнутых секций по id. По умолчанию секции СВЁРНУТЫ: при первом
 * появлении данных все известные id схлопываются один раз (дальше — ручное
 * управление, initedRef не даёт повторно свернуть уже раскрытое пользователем).
 */
function useCollapsed(allIds) {
  const [collapsed, setCollapsed] = useState(() => new Set())
  const inited = useRef(false)

  useEffect(() => {
    if (inited.current || allIds.length === 0) return
    inited.current = true
    setCollapsed(new Set(allIds))
  }, [allIds])

  const isCollapsed = (id) => collapsed.has(id)
  const toggle = (id) => setCollapsed((prev) => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const collapseAll = (ids) => setCollapsed(new Set(ids))
  const expandAll = () => setCollapsed(new Set())
  return { isCollapsed, toggle, collapseAll, expandAll, anyCollapsed: collapsed.size > 0 }
}

/** Кликабельная шапка секции с шевроном сворачивания. */
function CollapsibleHead({ collapsed, onToggle, title, subtitle, action }) {
  return (
    <div className="panel-heading collapsible">
      <button className="collapse-toggle" onClick={onToggle} aria-expanded={!collapsed}>
        {collapsed ? <ChevronRight /> : <ChevronDown />}
        <span><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</span>
      </button>
      {action}
    </div>
  )
}

/**
 * Строка позиции. Чекбокс появляется только в режиме выбора: обычная
 * работа — открыть карточку, а не отмечать галочки.
 *
 * Стрелки порядка — вместо перетаскивания: пальцем и с клавиатуры оно
 * одинаково недоступно, а поменять местами два блюда владельцу нужно.
 */
function ItemRow({ item, index, total, selecting, selected, onToggleSelect, onOpen, onMove }) {
  const gaps = itemGaps(item)
  const label = `${item.name}, ${money(item.price)}${item.is_available ? '' : ', hidden'}`
  return (
    <div className={`menu-row-wrap${selected ? ' is-selected' : ''}`}>
      {selecting && (
        <label className="menu-select">
          <input type="checkbox" checked={selected} onChange={onToggleSelect} />
          <span className="visually-hidden">Select {item.name}</span>
        </label>
      )}
      <button
        className={`menu-row as-button ${item.is_available ? '' : 'is-off'}`}
        aria-label={`Edit ${label}`}
        onClick={onOpen}
      >
        <span className="menu-name">
          {item.name}
          {/* Артикул виден прямо в строке: иначе поиск по нему нечем
              проверить и незачем использовать. */}
          {item.sku && <small className="menu-sku"> · {item.sku}</small>}
          {!item.is_available && <small> · hidden</small>}
          {/* Пробел подписан словом, а не только цветом */}
          {gaps.length > 0 && (
            <small className="menu-gap"> · {gaps.map((g) => GAP_LABELS[g]).join(', ')}</small>
          )}
        </span>
        <span className="menu-price">{money(item.price)}</span>
      </button>
      <div className="menu-order">
        <button
          type="button"
          className="icon-button"
          disabled={index === 0}
          aria-label={`Move ${item.name} up`}
          onClick={() => onMove('up')}
        >
          <ArrowUp />
        </button>
        <button
          type="button"
          className="icon-button"
          disabled={index === total - 1}
          aria-label={`Move ${item.name} down`}
          onClick={() => onMove('down')}
        >
          <ArrowDown />
        </button>
      </div>
    </div>
  )
}

/**
 * Строка компактного списка: то, по чему работают, а не любуются —
 * название, артикул, категория, пробелы и цена в одной строке.
 *
 * Стрелок порядка здесь нет намеренно: порядок существует ВНУТРИ
 * категории, и менять его имеет смысл там, где категории видны, — в
 * режиме «By category».
 */
function CatalogRow({ item, categoryName, selecting, selected, onToggleSelect, onOpen }) {
  const gaps = itemGaps(item)
  const label = `${item.name}, ${money(item.price)}${item.is_available ? '' : ', hidden'}`
  return (
    <div className={`menu-row-wrap catalog-row${selected ? ' is-selected' : ''}`}>
      {selecting && (
        <label className="menu-select">
          <input type="checkbox" checked={selected} onChange={onToggleSelect} />
          <span className="visually-hidden">Select {item.name}</span>
        </label>
      )}
      <button
        className={`menu-row as-button ${item.is_available ? '' : 'is-off'}`}
        aria-label={`Edit ${label}`}
        onClick={onOpen}
      >
        <span className="menu-name">
          {item.name}
          {item.sku && <small className="menu-sku"> · {item.sku}</small>}
          {!item.is_available && <small> · hidden</small>}
          {gaps.length > 0 && (
            <small className="menu-gap"> · {gaps.map((g) => GAP_LABELS[g]).join(', ')}</small>
          )}
        </span>
        <span className="catalog-row-cat">{categoryName || 'Uncategorised'}</span>
        <span className="menu-price">{money(item.price)}</span>
      </button>
    </div>
  )
}

/**
 * Обязательный шаг перед массовой правкой: что именно изменится и во
 * что. Без него владелец узнаёт о переоценке всего меню по выручке.
 */
function BulkReview({ rows, action, busy, error, onCancel, onApply }) {
  const changing = changedCount(rows)
  const titles = {
    availability: 'Change availability',
    category: 'Move to another category',
    price: 'Change prices',
  }
  return (
    <div className="sheet-backdrop" onClick={onCancel} role="presentation">
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="bulk-title">
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
          <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="primary-button compact"
            disabled={busy || changing === 0}
            onClick={onApply}
          >
            {busy ? 'Applying…' : `Apply to ${changing} item${changing === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Вкладка «Товары» ─────────────────────────────────────────
export function ItemsTab({ context, locationId, data, reload, filters, onFilters }) {
  const [editorItem, setEditorItem] = useState(null) // {} = новый, {id...} = правка
  const [addingCat, setAddingCat] = useState(false)
  const [catName, setCatName] = useState('')
  // Каталог общий, но новая категория принадлежит точке: по умолчанию —
  // та, с которой владелец работает в кабинете.
  const [catLoc, setCatLoc] = useState(locationId || context.locations?.[0]?.id || '')
  const [error, setError] = useState('')

  // Поиск и фильтры живут в разделе, а не во вкладке: заглянуть в
  // «Модификаторы» и вернуться — не повод потерять отбор, который
  // владелец только что набрал.
  const { query, category: catFilter, availability, state: stateFilter } = filters
  const setQuery = (value) => onFilters({ query: value })
  const setCatFilter = (value) => onFilters({ category: value })
  const setAvailability = (value) => onFilters({ availability: value })
  const setStateFilter = (value) => onFilters({ state: value })
  // Массовая правка
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [pending, setPending] = useState(null) // { action, params, rows }
  const [busy, setBusy] = useState(false)
  /*
   * Каталог по умолчанию — рабочая поверхность, а не витрина: плоский
   * список, где видно цену, категорию и пробелы позиции. Разбивка по
   * категориям остаётся вторым режимом: в ней живёт порядок внутри
   * категории, ради которого она и нужна.
   */
  const [mode, setMode] = useState('list')
  // Последняя массовая правка — чтобы её можно было отменить
  const [lastChange, setLastChange] = useState(null)
  const [undoing, setUndoing] = useState(false)

  const filtersOn = query.trim() !== '' || catFilter !== 'all'
    || availability !== 'all' || stateFilter !== 'all'

  const withVariants = useMemo(
    () => data.items.map((i) => ({ ...i, variantCount: (i.item_variants ?? []).length })),
    [data.items]
  )
  const visible = useMemo(
    () => filterItems(withVariants, data.categories, {
      query, categoryId: catFilter, availability, state: stateFilter,
    }),
    [withVariants, data.categories, query, catFilter, availability, stateFilter]
  )

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
   * Порядок внутри категории. Сервер принимает полный список id, поэтому
   * отправляем порядок всей категории, а не «поменять два местами».
   */
  async function moveItem(list, id, direction) {
    const ids = moveInOrder(list.map((i) => i.id), id, direction)
    try {
      await reorderItems(ids)
      await reload()
    } catch (e) {
      setError(e.message)
    }
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

  async function addCategory() {
    if (!catName.trim()) return
    setError('')
    try {
      await createCategory(context, catLoc, catName.trim(), data.categories.length)
      setCatName(''); setAddingCat(false); reload()
    } catch (e) { setError(e.message) }
  }

  async function removeCategory(id) {
    if (!confirm('Delete this category? Items keep existing but lose their category.')) return
    try { await deleteCategory(id); reload() } catch (e) { setError(e.message) }
  }

  const allCatIds = useMemo(
    () => byCat.list.map((c) => c.id).concat(byCat.orphans.length ? ['__orphans__'] : []),
    [byCat]
  )
  const {
    isCollapsed: isCollapsedByUser, toggle, collapseAll, expandAll, anyCollapsed,
  } = useCollapsed(allCatIds)
  // При активном поиске/фильтре категории раскрыты принудительно: иначе
  // найденное лежит внутри свёрнутой категории, и поиск выглядит как
  // «ничего не нашлось».
  const isCollapsed = (id) => !filtersOn && isCollapsedByUser(id)

  return (
    <>
      {/* Поиск и фильтры выше кнопок создания: чаще ищут существующее,
          чем заводят новое. Скрыть позицию на телефоне — путь в три
          касания: найти, выбрать, «Hide». */}
      <div className="catalog-filters">
        <label className="order-search">
          <Search aria-hidden />
          <span className="visually-hidden">Search the catalogue</span>
          <input
            type="search"
            value={query}
            placeholder="Name, SKU, description or category"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="order-filter">
          <span className="visually-hidden">Category</span>
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
            <option value="all">Any category</option>
            {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="order-filter">
          <span className="visually-hidden">Availability</span>
          <select value={availability} onChange={(e) => setAvailability(e.target.value)}>
            <option value="all">On sale and hidden</option>
            <option value="available">On sale</option>
            <option value="hidden">Hidden</option>
          </select>
        </label>
        <label className="order-filter">
          <span className="visually-hidden">Completeness</span>
          <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
            <option value="all">Complete and not</option>
            <option value="incomplete">Needs attention</option>
          </select>
        </label>
        {filtersOn && (
          <button
            type="button"
            className="text-button"
            onClick={() => onFilters(EMPTY_FILTERS)}
          >
            <X /> Clear
          </button>
        )}
        <span className="catalog-count">{visible.length} of {data.items.length}</span>
      </div>

      <div className="menu-toolbar">
        <button className="primary-button narrow" onClick={() => setEditorItem({})}>
          <Plus /> New item
        </button>
        <button
          type="button"
          className={selecting ? 'primary-button narrow' : 'secondary-button'}
          aria-pressed={selecting}
          onClick={() => { setSelecting((v) => !v); setSelected(new Set()) }}
        >
          <CheckSquare /> {selecting ? 'Done selecting' : 'Select'}
        </button>
        {!addingCat ? (
          <button className="secondary-button" onClick={() => setAddingCat(true)}>
            <Plus /> New category
          </button>
        ) : (
          <div className="inline-add">
            <input placeholder="Category name" value={catName} onChange={(e) => setCatName(e.target.value)} autoFocus />
            {context.locations?.length > 1 && (
              <select
                value={catLoc}
                aria-label="Location for the new category"
                onChange={(e) => setCatLoc(e.target.value)}
              >
                {context.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            )}
            <button className="icon-button" onClick={addCategory} aria-label="Add"><Plus /></button>
            <button className="icon-button" onClick={() => { setAddingCat(false); setCatName('') }} aria-label="Cancel"><X /></button>
          </div>
        )}
        <div className="menu-mode">
          <Tabs
            className="period-switch"
            label="Catalogue view"
            items={[{ key: 'list', label: 'List' }, { key: 'groups', label: 'By category' }]}
            value={mode}
            onChange={setMode}
          />
        </div>
        {mode === 'groups' && byCat.list.length > 0 && (
          <button className="text-button collapse-all" onClick={() => anyCollapsed ? expandAll() : collapseAll(allCatIds)}>
            {anyCollapsed ? 'Expand all' : 'Collapse all'}
          </button>
        )}
      </div>

      {selecting && (
        <div className="bulk-bar" role="group" aria-label="Bulk actions">
          <span className="bulk-count">{selected.size} selected</span>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setSelected(new Set(visible.map((i) => i.id)))}
          >
            Select all shown
          </button>
          <button type="button" className="secondary-button" disabled={selected.size === 0}
            onClick={() => askBulk('availability', { available: false })}>Hide</button>
          <button type="button" className="secondary-button" disabled={selected.size === 0}
            onClick={() => askBulk('availability', { available: true })}>Put on sale</button>
          <label className="order-filter">
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
          <label className="order-filter">
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
        <div className="bulk-result" role="status">
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

      {visible.length === 0 && (
        <section className="panel form-panel">
          <p className="empty-state">
            {filtersOn ? 'Nothing matches these filters.' : 'The catalogue is empty — add the first item.'}
          </p>
        </section>
      )}

      {mode === 'list' && visible.length > 0 && (
        <section className="panel">
          <div className="menu-list">
            {visible.map((it) => (
              <CatalogRow
                key={it.id}
                item={it}
                categoryName={data.categories.find((c) => c.id === it.category_id)?.name}
                selecting={selecting}
                selected={selected.has(it.id)}
                onToggleSelect={() => toggleSelected(it.id)}
                onOpen={() => setEditorItem(it)}
              />
            ))}
          </div>
        </section>
      )}

      <div className="menu-groups">
        {mode === 'groups' && byCat.list.map((cat) => {
          const collapsed = isCollapsed(cat.id)
          return (
            <section className="panel menu-category" key={cat.id}>
              {/* Корзина не в шапке: в свёрнутом списке она визуально шумит.
                  Удаление — строкой внутри раскрытой категории. */}
              <CollapsibleHead
                collapsed={collapsed}
                onToggle={() => toggle(cat.id)}
                title={cat.name}
                subtitle={`${cat.items.length} item${cat.items.length === 1 ? '' : 's'}`}
              />
              {!collapsed && (
                <div className="menu-list">
                  {cat.items.length === 0
                    ? <p className="empty-state">No items.</p>
                    : cat.items.map((it, index) => (
                      <ItemRow
                        key={it.id}
                        item={it}
                        index={index}
                        total={cat.items.length}
                        selecting={selecting}
                        selected={selected.has(it.id)}
                        onToggleSelect={() => toggleSelected(it.id)}
                        onOpen={() => setEditorItem(it)}
                        onMove={(dir) => moveItem(cat.items, it.id, dir)}
                      />
                    ))}
                  <button
                    className="menu-delete-row"
                    aria-label={`Delete category ${cat.name}`}
                    onClick={() => removeCategory(cat.id)}
                  >
                    <Trash2 /> Delete category
                  </button>
                </div>
              )}
            </section>
          )
        })}
        {mode === 'groups' && byCat.orphans.length > 0 && (() => {
          const collapsed = isCollapsed('__orphans__')
          return (
            <section className="panel menu-category">
              <CollapsibleHead
                collapsed={collapsed}
                onToggle={() => toggle('__orphans__')}
                title="Uncategorised"
                subtitle={`${byCat.orphans.length} items`}
              />
              {!collapsed && (
                <div className="menu-list">
                  {byCat.orphans.map((it, index) => (
                    <ItemRow
                      key={it.id}
                      item={it}
                      index={index}
                      total={byCat.orphans.length}
                      selecting={selecting}
                      selected={selected.has(it.id)}
                      onToggleSelect={() => toggleSelected(it.id)}
                      onOpen={() => setEditorItem(it)}
                      onMove={(dir) => moveItem(byCat.orphans, it.id, dir)}
                    />
                  ))}
                </div>
              )}
            </section>
          )
        })()}
      </div>

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

      {editorItem && (
        <ItemEditor
          context={context}
          item={editorItem}
          categories={data.categories}
          stations={data.stations}
          modifierGroups={data.modifierGroups}
          onClose={() => setEditorItem(null)}
          onSaved={() => { setEditorItem(null); reload() }}
          api={{ saveItem, deleteItem, uploadItemImage }}
        />
      )}
    </>
  )
}

// ── Вкладка «Модификаторы» ───────────────────────────────────
export function ModifiersTab({ context, data, reload }) {
  const [error, setError] = useState('')
  const [newGroup, setNewGroup] = useState('')

  async function addGroup() {
    if (!newGroup.trim()) return
    try {
      await createModifierGroup(context, newGroup.trim(), 0, 1, data.modifierGroups.length)
      setNewGroup(''); reload()
    } catch (e) { setError(e.message) }
  }

  /**
   * Добавление модификатора — строкой прямо в группе, как категории и
   * станции. Раньше это были два подряд `window.prompt`: они не
   * поддерживаются в части браузеров (и внутри встроенного кадра), а
   * там, где поддерживаются, спрашивают цену без валюты и без права
   * передумать на втором шаге.
   */
  async function addModifier(groupId, count, name, priceStr) {
    if (!name.trim()) return
    const delta = shekelsToAgorot(priceStr || '0')
    if (delta === null) { setError('Extra price must be a number, for example 3 or 3.50'); return }
    try {
      await createModifier(context, groupId, name.trim(), delta, false, count)
      setAdding(null)
      reload()
    } catch (e) { setError(e.message) }
  }

  // Открытая строка добавления: { groupId, name, price }
  const [adding, setAdding] = useState(null)

  const groupIds = useMemo(() => data.modifierGroups.map((g) => g.id), [data.modifierGroups])
  const { isCollapsed, toggle, collapseAll, expandAll, anyCollapsed } = useCollapsed(groupIds)

  return (
    <>
      <div className="menu-toolbar">
        <div className="inline-add">
          <input placeholder="Group name (e.g. Milk, Syrup)" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
          <button className="icon-button" onClick={addGroup} aria-label="Add group"><Plus /></button>
        </div>
        {data.modifierGroups.length > 0 && (
          <button className="text-button collapse-all" onClick={() => anyCollapsed ? expandAll() : collapseAll(data.modifierGroups.map((g) => g.id))}>
            {anyCollapsed ? 'Expand all' : 'Collapse all'}
          </button>
        )}
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="menu-groups">
        {data.modifierGroups.length === 0 && (
          <section className="panel form-panel">
            <p className="empty-state">
              No modifier groups yet — add the first one above.
            </p>
          </section>
        )}
        {data.modifierGroups.map((g) => {
          const collapsed = isCollapsed(g.id)
          return (
            <section className="panel menu-category" key={g.id}>
              <CollapsibleHead
                collapsed={collapsed}
                onToggle={() => toggle(g.id)}
                title={g.name}
                subtitle={`Choose ${g.min_select}–${g.max_select} · ${(g.modifiers || []).length}`}
              />
              {!collapsed && (
                <div className="menu-list">
                  {(g.modifiers || []).map((m) => (
                    <div className="menu-row" key={m.id}>
                      <span className="menu-name">{m.name}</span>
                      <span className="menu-price">{m.price_delta ? `+${money(m.price_delta)}` : '—'}</span>
                      <button className="icon-button" onClick={async () => {
                        try { await deleteModifier(m.id); reload() } catch (e) { setError(e.message) }
                      }} aria-label="Delete"><Trash2 /></button>
                    </div>
                  ))}
                  {adding?.groupId === g.id ? (
                    <form
                      className="inline-add modifier-add"
                      onSubmit={(e) => {
                        e.preventDefault()
                        addModifier(g.id, (g.modifiers || []).length, adding.name, adding.price)
                      }}
                    >
                      <input
                        autoFocus
                        placeholder="Modifier name"
                        aria-label={`Modifier name in ${g.name}`}
                        value={adding.name}
                        onChange={(e) => setAdding((a) => ({ ...a, name: e.target.value }))}
                      />
                      <input
                        inputMode="decimal"
                        placeholder="Extra ₪"
                        aria-label="Extra price in shekels"
                        value={adding.price}
                        onChange={(e) => setAdding((a) => ({ ...a, price: e.target.value }))}
                      />
                      <IconButton type="submit" label="Add modifier"><Plus /></IconButton>
                      <IconButton label="Cancel" onClick={() => setAdding(null)}><X /></IconButton>
                    </form>
                  ) : (
                    <button
                      className="menu-add-row"
                      onClick={() => setAdding({ groupId: g.id, name: '', price: '0' })}
                    >
                      <Plus /> Add modifier
                    </button>
                  )}
                  <button className="menu-delete-row" onClick={async () => {
                    if (!confirm(`Delete group "${g.name}" and its modifiers?`)) return
                    try { await deleteModifierGroup(g.id); reload() } catch (e) { setError(e.message) }
                  }}>
                    <Trash2 /> Delete group
                  </button>
                </div>
              )}
            </section>
          )
        })}
      </div>
    </>
  )
}

// ── Вкладка «Станции» ────────────────────────────────────────
export function StationsTab({ context, data, reload }) {
  const [error, setError] = useState('')
  const [newName, setNewName] = useState('')

  async function add() {
    if (!newName.trim()) return
    try { await createStation(context, context.locations?.[0]?.id, newName.trim(), data.stations.length); setNewName(''); reload() }
    catch (e) { setError(e.message) }
  }

  return (
    <>
      <div className="menu-toolbar">
        <div className="inline-add">
          <input placeholder="Station name (e.g. Kitchen, Bar)" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button className="icon-button" onClick={add} aria-label="Add"><Plus /></button>
        </div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <section className="panel">
        <div className="menu-list">
          {data.stations.length === 0 && <p className="empty-state">No stations yet.</p>}
          {data.stations.map((s) => (
            <div className="menu-row" key={s.id}>
              <span className="menu-name">{s.name}</span>
              <button className="icon-button" onClick={async () => {
                if (!confirm(`Delete station "${s.name}"?`)) return
                try { await deleteStation(s.id); reload() } catch (e) { setError(e.message) }
              }} aria-label="Delete"><Trash2 /></button>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

export default function MenuManager({ context, locationId, tab: tabFromUrl, onTabChange }) {
  // Вкладка живёт в адресе: перезагрузка и присланная ссылка открывают
  // тот же экран. Неизвестное значение — устаревшая ссылка, не ошибка.
  const tab = TABS.some((t) => t.key === tabFromUrl) ? tabFromUrl : 'items'
  const setTab = onTabChange
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Отбор каталога переживает переключение вкладок: см. ItemsTab.
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const patchFilters = useCallback(
    (patch) => setFilters((prev) => ({ ...prev, ...patch })),
    []
  )

  async function reload() {
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
  }

  useEffect(() => { reload() }, [])

  return (
    <>
      {/* Menu-only клиенту нельзя говорить про кассу: у него её нет,
          и каталог для него — то, что видит гость. */}
      <PageHeader
        eyebrow={context.organization?.name}
        title="Catalogue"
        description={hasCapability(context, 'pos_operate')
          ? 'Everything your registers and guest pages sell. Changes apply immediately.'
          : 'Everything your guest pages show. Changes apply immediately.'}
      />

      <Tabs
        className="period-switch menu-tabs"
        label="Menu section"
        items={TABS}
        value={tab}
        onChange={setTab}
      />

      {error && <p className="form-error" role="alert">{error}</p>}

      {loading || !data ? (
        <p className="empty-state">Loading…</p>
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
            />
          )}
          {tab === 'modifiers' && <ModifiersTab context={context} data={data} reload={reload} />}
          {tab === 'stations' && <StationsTab context={context} data={data} reload={reload} />}
        </>
      )}
    </>
  )
}
