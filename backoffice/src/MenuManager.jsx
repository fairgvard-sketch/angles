import { useEffect, useState } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { agorotToShekels, fetchMenu, saveMenuItem, shekelsToAgorot } from './menu'

/**
 * Меню в бэкофисе. Список категорий с товарами, инлайн-правка имени, цены и
 * доступности. Пишем через save_menu_item (092) — PIN не нужен. Правка одного
 * товара за раз: сохраняет варианты/группы без изменений (см. menu.js).
 */

function ItemRow({ item, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(item.name)
  const [price, setPrice] = useState(String(agorotToShekels(item.price)))
  const [available, setAvailable] = useState(item.is_available)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function cancel() {
    setName(item.name)
    setPrice(String(agorotToShekels(item.price)))
    setAvailable(item.is_available)
    setError('')
    setEditing(false)
  }

  async function save() {
    const agorot = shekelsToAgorot(price)
    if (!name.trim()) { setError('Name required'); return }
    if (agorot === null) { setError('Invalid price'); return }
    setSaving(true)
    setError('')
    try {
      await saveMenuItem({
        id: item.id,
        category_id: item.category_id,
        name: name.trim(),
        price: agorot,
        is_available: available,
      })
      setEditing(false)
      onSaved()
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <div className={`menu-row ${item.is_available ? '' : 'is-off'}`}>
        <span className="menu-name">{item.name}{!item.is_available && <small> · hidden</small>}</span>
        <span className="menu-price">{agorotToShekels(item.price).toLocaleString('he-IL', { minimumFractionDigits: item.price % 100 ? 2 : 0 })} ₪</span>
        <button className="icon-button" onClick={() => setEditing(true)} aria-label="Edit"><Pencil /></button>
      </div>
    )
  }

  return (
    <div className="menu-row is-editing">
      <input className="menu-edit-name" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="menu-edit-price" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
      <label className="menu-avail">
        <input type="checkbox" checked={available} onChange={(e) => setAvailable(e.target.checked)} />
        <span>Available</span>
      </label>
      {error && <span className="menu-edit-error">{error}</span>}
      <div className="menu-edit-actions">
        <button className="icon-button" onClick={save} disabled={saving} aria-label="Save"><Check /></button>
        <button className="icon-button" onClick={cancel} disabled={saving} aria-label="Cancel"><X /></button>
      </div>
    </div>
  )
}

export default function MenuManager({ context }) {
  const [menu, setMenu] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      setMenu(await fetchMenu())
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <>
      <section className="page-heading compact-heading">
        <p className="eyebrow">{context.organization?.name}</p>
        <h1>Menu & catalogue</h1>
        <p>Items and prices used by every connected register. Changes apply immediately.</p>
      </section>

      {error && <p className="form-error" role="alert">{error}</p>}

      {loading || !menu ? (
        <p className="empty-state">Loading…</p>
      ) : menu.categories.length === 0 ? (
        <p className="empty-state">No categories yet.</p>
      ) : (
        <div className="menu-groups">
          {menu.categories.map((cat) => (
            <section className="panel menu-category" key={cat.id}>
              <div className="panel-heading">
                <div><h2>{cat.name}</h2><p>{cat.items.length} item{cat.items.length === 1 ? '' : 's'}</p></div>
              </div>
              <div className="menu-list">
                {cat.items.length === 0
                  ? <p className="empty-state">No items.</p>
                  : cat.items.map((item) => <ItemRow key={item.id} item={item} onSaved={load} />)}
              </div>
            </section>
          ))}
          {menu.orphans.length > 0 && (
            <section className="panel menu-category">
              <div className="panel-heading"><div><h2>Uncategorised</h2><p>{menu.orphans.length} items</p></div></div>
              <div className="menu-list">
                {menu.orphans.map((item) => <ItemRow key={item.id} item={item} onSaved={load} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </>
  )
}
