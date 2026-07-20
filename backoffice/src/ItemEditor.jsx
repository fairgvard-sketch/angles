import { useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { agorotToShekels, shekelsToAgorot } from './menu'

/**
 * Модальный редактор товара — паритет с кассовым ItemEditor: имя, цена,
 * категория, станция, доступность, фото, варианты (S/M/L), группы
 * модификаторов. Сохраняет через save_menu_item (единый гейт 092).
 */

function priceInput(agorot) {
  return agorot != null ? String(agorotToShekels(agorot)) : ''
}

export default function ItemEditor({ context, item, categories, stations, modifierGroups, onClose, onSaved, api }) {
  const isNew = !item.id
  const [name, setName] = useState(item.name || '')
  const [price, setPrice] = useState(priceInput(item.price))
  const [categoryId, setCategoryId] = useState(item.category_id || categories[0]?.id || '')
  const [stationId, setStationId] = useState(item.station_id || '')
  const [description, setDescription] = useState(item.description || '')
  const [available, setAvailable] = useState(item.is_available ?? true)
  const [askModifiers, setAskModifiers] = useState(item.ask_modifiers ?? false)
  const [imageUrl, setImageUrl] = useState(item.image_url || '')
  const [variants, setVariants] = useState(
    (item.item_variants || []).slice().sort((a, b) => a.sort_order - b.sort_order)
      .map((v) => ({ name: v.name, price: priceInput(v.price), is_default: v.is_default }))
  )
  const [groupIds, setGroupIds] = useState(
    (item.menu_item_modifier_groups || []).map((g) => g.group_id)
  )
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function addVariant() {
    setVariants((v) => [...v, { name: '', price: price || '0', is_default: v.length === 0 }])
  }
  function updateVariant(i, patch) {
    setVariants((v) => v.map((x, idx) => idx === i ? { ...x, ...patch } : x))
  }
  function removeVariant(i) {
    setVariants((v) => v.filter((_, idx) => idx !== i))
  }
  function toggleGroup(id) {
    setGroupIds((g) => g.includes(id) ? g.filter((x) => x !== id) : [...g, id])
  }

  async function onImage(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')
    try {
      setImageUrl(await api.uploadItemImage(context, file))
    } catch (e) { setError(e.message) } finally { setUploading(false) }
  }

  async function save() {
    if (!name.trim()) { setError('Name required'); return }
    if (!categoryId) { setError('Category required'); return }
    const basePrice = shekelsToAgorot(price || '0')
    if (basePrice === null) { setError('Invalid price'); return }

    const parsedVariants = []
    for (const v of variants) {
      if (!v.name.trim()) { setError('Variant name required'); return }
      const vp = shekelsToAgorot(v.price)
      if (vp === null) { setError(`Invalid price for "${v.name}"`); return }
      parsedVariants.push({ name: v.name.trim(), price: vp, is_default: v.is_default })
    }

    setSaving(true)
    setError('')
    try {
      await api.saveItem({
        name: name.trim(),
        description: description.trim() || null,
        category_id: categoryId,
        station_id: stationId || null,
        price: basePrice,
        image_url: imageUrl || null,
        is_available: available,
        ask_modifiers: askModifiers,
        variants: parsedVariants,
        modifier_group_ids: groupIds,
      }, item.id || null)
      onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  async function remove() {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
    setSaving(true)
    try { await api.deleteItem(item.id); onSaved() }
    catch (e) { setError(e.message); setSaving(false) }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="modal-head">
          <h2>{isNew ? 'New item' : 'Edit item'}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X /></button>
        </header>

        <div className="modal-body">
          <label><span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>

          <div className="field-row">
            <label><span>Base price ₪</span>
              <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
            </label>
            <label><span>Category</span>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          </div>

          <div className="field-row">
            <label><span>Station (kitchen/bar)</span>
              <select value={stationId} onChange={(e) => setStationId(e.target.value)}>
                <option value="">—</option>
                {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="check-field">
              <input type="checkbox" checked={available} onChange={(e) => setAvailable(e.target.checked)} />
              <span>Available for sale</span>
            </label>
          </div>

          <label><span>Description</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>

          <div className="editor-block">
            <div className="editor-block-head"><span>Photo</span></div>
            <div className="photo-row">
              {imageUrl && <img className="photo-preview" src={imageUrl} alt="" />}
              <label className="file-button">
                {uploading ? 'Uploading…' : imageUrl ? 'Replace' : 'Upload'}
                <input type="file" accept="image/*" onChange={onImage} hidden disabled={uploading} />
              </label>
              {imageUrl && <button className="secondary-button" onClick={() => setImageUrl('')}>Remove</button>}
            </div>
          </div>

          <div className="editor-block">
            <div className="editor-block-head">
              <span>Variants (sizes)</span>
              <button className="text-button" onClick={addVariant}><Plus /> Add</button>
            </div>
            {variants.length === 0 && <p className="hint">No variants — item sells at base price.</p>}
            {variants.map((v, i) => (
              <div className="variant-row" key={i}>
                <input placeholder="Name (S/M/L)" value={v.name} onChange={(e) => updateVariant(i, { name: e.target.value })} />
                <input placeholder="₪" value={v.price} onChange={(e) => updateVariant(i, { price: e.target.value })} inputMode="decimal" />
                <label className="check-field small">
                  <input type="radio" name="default-variant" checked={v.is_default}
                    onChange={() => setVariants((vs) => vs.map((x, idx) => ({ ...x, is_default: idx === i })))} />
                  <span>Default</span>
                </label>
                <button className="icon-button" onClick={() => removeVariant(i)} aria-label="Remove"><Trash2 /></button>
              </div>
            ))}
          </div>

          {modifierGroups.length > 0 && (
            <div className="editor-block">
              <div className="editor-block-head"><span>Modifier groups</span></div>
              <div className="group-checks">
                {modifierGroups.map((g) => (
                  <label key={g.id} className="check-field">
                    <input type="checkbox" checked={groupIds.includes(g.id)} onChange={() => toggleGroup(g.id)} />
                    <span>{g.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {error && <p className="form-error" role="alert">{error}</p>}
        </div>

        <footer className="modal-foot">
          {!isNew && (
            <button className="danger-button" onClick={remove} disabled={saving}>
              <Trash2 /> Delete
            </button>
          )}
          <div className="modal-foot-right">
            <button className="secondary-button" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="primary-button narrow" onClick={save} disabled={saving || uploading}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
