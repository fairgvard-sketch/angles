import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Trash2, X } from 'lucide-react'
import {
  agorotToShekels, shekelsToAgorot,
  fetchCategories, fetchItems, fetchModifierGroups, fetchStations,
  createCategory, updateCategory, deleteCategory,
  saveItem, deleteItem, uploadItemImage,
  createModifierGroup, updateModifierGroup, deleteModifierGroup,
  createModifier, updateModifier, deleteModifier,
  createStation, updateStation, deleteStation,
} from './menu'
import ItemEditor from './ItemEditor'

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

// ── Вкладка «Товары» ─────────────────────────────────────────
function ItemsTab({ context, data, reload }) {
  const [editorItem, setEditorItem] = useState(null) // {} = новый, {id...} = правка
  const [addingCat, setAddingCat] = useState(false)
  const [catName, setCatName] = useState('')
  const [catLoc, setCatLoc] = useState(context.locations?.[0]?.id || '')
  const [error, setError] = useState('')

  const byCat = useMemo(() => {
    const map = new Map(data.categories.map((c) => [c.id, { ...c, items: [] }]))
    const orphans = []
    for (const it of data.items) {
      const bucket = map.get(it.category_id)
      if (bucket) bucket.items.push(it); else orphans.push(it)
    }
    return { list: [...map.values()], orphans }
  }, [data])

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
  const { isCollapsed, toggle, collapseAll, expandAll, anyCollapsed } = useCollapsed(allCatIds)

  return (
    <>
      <div className="menu-toolbar">
        <button className="primary-button narrow" onClick={() => setEditorItem({})}>
          <Plus /> New item
        </button>
        {!addingCat ? (
          <button className="secondary-button" onClick={() => setAddingCat(true)}>
            <Plus /> New category
          </button>
        ) : (
          <div className="inline-add">
            <input placeholder="Category name" value={catName} onChange={(e) => setCatName(e.target.value)} autoFocus />
            {context.locations?.length > 1 && (
              <select value={catLoc} onChange={(e) => setCatLoc(e.target.value)}>
                {context.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            )}
            <button className="icon-button" onClick={addCategory} aria-label="Add"><Plus /></button>
            <button className="icon-button" onClick={() => { setAddingCat(false); setCatName('') }} aria-label="Cancel"><X /></button>
          </div>
        )}
        {byCat.list.length > 0 && (
          <button className="text-button collapse-all" onClick={() => anyCollapsed ? expandAll() : collapseAll(allCatIds)}>
            {anyCollapsed ? 'Expand all' : 'Collapse all'}
          </button>
        )}
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="menu-groups">
        {byCat.list.map((cat) => {
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
                    : cat.items.map((it) => (
                      <button className={`menu-row as-button ${it.is_available ? '' : 'is-off'}`} key={it.id} onClick={() => setEditorItem(it)}>
                        <span className="menu-name">{it.name}{!it.is_available && <small> · hidden</small>}</span>
                        <span className="menu-price">{money(it.price)}</span>
                      </button>
                    ))}
                  <button className="menu-delete-row" onClick={() => removeCategory(cat.id)}>
                    <Trash2 /> Delete category
                  </button>
                </div>
              )}
            </section>
          )
        })}
        {byCat.orphans.length > 0 && (() => {
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
                  {byCat.orphans.map((it) => (
                    <button className="menu-row as-button" key={it.id} onClick={() => setEditorItem(it)}>
                      <span className="menu-name">{it.name}</span>
                      <span className="menu-price">{money(it.price)}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )
        })()}
      </div>

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
function ModifiersTab({ context, data, reload }) {
  const [error, setError] = useState('')
  const [newGroup, setNewGroup] = useState('')

  async function addGroup() {
    if (!newGroup.trim()) return
    try {
      await createModifierGroup(context, newGroup.trim(), 0, 1, data.modifierGroups.length)
      setNewGroup(''); reload()
    } catch (e) { setError(e.message) }
  }

  async function addModifier(groupId, count) {
    const name = prompt('Modifier name')
    if (!name?.trim()) return
    const priceStr = prompt('Extra price in ₪ (0 for none)', '0') ?? '0'
    const delta = shekelsToAgorot(priceStr)
    if (delta === null) { setError('Invalid price'); return }
    try { await createModifier(context, groupId, name.trim(), delta, false, count); reload() }
    catch (e) { setError(e.message) }
  }

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
        {data.modifierGroups.length === 0 && <p className="empty-state">No modifier groups yet.</p>}
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
                  <button className="menu-add-row" onClick={() => addModifier(g.id, (g.modifiers || []).length)}>
                    <Plus /> Add modifier
                  </button>
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
function StationsTab({ context, data, reload }) {
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

export default function MenuManager({ context }) {
  const [tab, setTab] = useState('items')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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
      <section className="page-heading compact-heading">
        <p className="eyebrow">{context.organization?.name}</p>
        <h1>Menu & catalogue</h1>
        <p>Everything the register sells. Changes apply immediately.</p>
      </section>

      <div className="period-switch menu-tabs" role="tablist" aria-label="Menu section">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key}
            className={tab === t.key ? 'is-active' : ''} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {loading || !data ? (
        <p className="empty-state">Loading…</p>
      ) : (
        <>
          {tab === 'items' && <ItemsTab context={context} data={data} reload={reload} />}
          {tab === 'modifiers' && <ModifiersTab context={context} data={data} reload={reload} />}
          {tab === 'stations' && <StationsTab context={context} data={data} reload={reload} />}
        </>
      )}
    </>
  )
}
