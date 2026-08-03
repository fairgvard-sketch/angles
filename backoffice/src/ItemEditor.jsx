import { useEffect, useState } from 'react'
import { ImageOff, Plus, Trash2 } from 'lucide-react'
import { agorotToShekels, shekelsToAgorot, bulkErrorText } from './menu'
import { GAP_LABELS, itemGaps, money, priceLabel, sizesLabel } from './catalog'
import Drawer from './ui/Drawer'
import ConfirmDialog from './ui/ConfirmDialog'
import { Button } from './ui/Button'
import { RowMenu } from './ui/RowMenu'

/**
 * Карточка позиции: сначала показать, потом править.
 *
 * Раньше это была модалка по центру: щелчок по товару накрывал каталог
 * целиком, и, чтобы просто посмотреть цену, владелец попадал в форму со
 * всеми полями сразу. Теперь панель стоит СБОКУ и не отменяет таблицу —
 * отбор, прокрутка и выделенная строка остаются на месте, а править
 * начинают отдельным решением.
 *
 * Панель чтения немодальная намеренно: щелчок по соседней строке обязан
 * ОТКРЫТЬ её, а не закрыть панель. Правка, наоборот, модальна — уйти из
 * неё случайным щелчком мимо значит потерять набранное.
 */

function priceInput(agorot) {
  return agorot != null ? String(agorotToShekels(agorot)) : ''
}

/** Что видно в позиции до того, как её открыли на правку */
function ItemDetails({ item, stations, modifierGroups }) {
  const gaps = itemGaps(item)
  const station = stations.find((s) => s.id === item.station_id)
  const groups = (item.menu_item_modifier_groups ?? [])
    .map((link) => modifierGroups.find((g) => g.id === link.group_id))
    .filter(Boolean)
  const variants = (item.item_variants ?? [])
    .slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  return (
    <div className="cat-detail">
      <div className="cat-detail-top">
        {item.image_url
          ? <img className="cat-detail-photo" src={item.image_url} alt="" />
          : <span className="cat-detail-photo is-empty" aria-hidden><ImageOff /></span>}
        <div>
          {/* Категория уже стоит подписью панели — второй раз её не повторяем */}
          {item.sku
            ? <p className="cat-detail-sku">SKU {item.sku}</p>
            : <p className="cat-detail-sku">No SKU</p>}
          <p>
            {item.is_available
              ? <span className="cat-avail is-on">On sale</span>
              : <span className="cat-avail is-off">Hidden</span>}
          </p>
        </div>
      </div>

      {gaps.length > 0 && (
        <p className="cat-detail-gaps">
          Needs attention: {gaps.map((g) => GAP_LABELS[g]).join(', ')}
        </p>
      )}

      {item.description
        ? <p className="cat-detail-desc">{item.description}</p>
        : <p className="cat-detail-desc is-empty">No description yet.</p>}

      <dl className="cat-detail-facts">
        <div>
          <dt>Price</dt>
          <dd>
            {priceLabel(item, money)}
            {sizesLabel(item) && <small> · {sizesLabel(item)}</small>}
          </dd>
        </div>
        <div>
          <dt>Preparation station</dt>
          <dd>{station?.name ?? 'Not routed to a station'}</dd>
        </div>
      </dl>

      {variants.length > 0 && (
        <section className="cat-detail-block">
          <h4>Sizes</h4>
          <ul className="cat-detail-list">
            {variants.map((v) => (
              <li key={v.id ?? v.name}>
                <span>{v.name}{v.is_default && <small> · default</small>}</span>
                <strong>{money(v.price)}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}

      {groups.length > 0 && (
        <section className="cat-detail-block">
          <h4>Modifier groups</h4>
          <ul className="cat-detail-list">
            {groups.map((g) => (
              <li key={g.id}>
                <span>{g.name}</span>
                <small>{(g.modifiers ?? []).length} options</small>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

export default function ItemEditor({
  context, item, categories, stations, modifierGroups,
  editing, onEdit, onClose, onSaved, onDeleted, api,
}) {
  const isNew = !item.id
  const [name, setName] = useState(item.name || '')
  const [price, setPrice] = useState(priceInput(item.price))
  const [categoryId, setCategoryId] = useState(item.category_id || categories[0]?.id || '')
  const [stationId, setStationId] = useState(item.station_id || '')
  const [description, setDescription] = useState(item.description || '')
  const [available, setAvailable] = useState(item.is_available ?? true)
  const [askModifiers, setAskModifiers] = useState(item.ask_modifiers ?? false)
  const [imageUrl, setImageUrl] = useState(item.image_url || '')
  // Артикул: по нему ищут в каталоге и сверяются с поставщиком.
  const [sku, setSku] = useState(item.sku || '')
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
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  /*
   * Форма перезаряжается, когда открыли ДРУГУЮ позицию: панель
   * немодальная, соседнюю строку открывают щелчком, и поля обязаны
   * приехать от неё, а не остаться от предыдущей.
   */
  useEffect(() => {
    setName(item.name || '')
    setPrice(priceInput(item.price))
    setCategoryId(item.category_id || categories[0]?.id || '')
    setStationId(item.station_id || '')
    setDescription(item.description || '')
    setAvailable(item.is_available ?? true)
    setAskModifiers(item.ask_modifiers ?? false)
    setImageUrl(item.image_url || '')
    setSku(item.sku || '')
    setVariants((item.item_variants || []).slice().sort((a, b) => a.sort_order - b.sort_order)
      .map((v) => ({ name: v.name, price: priceInput(v.price), is_default: v.is_default })))
    setGroupIds((item.menu_item_modifier_groups || []).map((g) => g.group_id))
    setError('')
  }, [item.id]) // eslint-disable-line react-hooks/exhaustive-deps

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
    } catch (e) { setError(bulkErrorText(e.message)) } finally { setUploading(false) }
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
      if (vp === null) { setError(`Invalid price for “${v.name}”`); return }
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
        sku: sku.trim() || null,
        is_available: available,
        ask_modifiers: askModifiers,
        variants: parsedVariants,
        modifier_group_ids: groupIds,
      }, item.id || null)
      await onSaved()
    } catch (e) {
      setError(bulkErrorText(e.message))
      setSaving(false)
    }
  }

  async function remove() {
    setDeleting(true)
    setError('')
    try {
      await api.deleteItem(item.id)
      await onDeleted()
    } catch (e) {
      setError(bulkErrorText(e.message))
      setDeleting(false)
      setConfirming(false)
    }
  }

  // Пока идёт запись или загрузка фото — закрывать нечего: запрос уже
  // ушёл, и уйти сейчас значит не узнать, чем он кончился.
  const locked = saving || uploading || deleting
  const close = () => { if (!locked) onClose() }

  if (!editing) {
    return (
      <>
        <Drawer
          modal={false}
          title={item.name}
          subtitle={categories.find((c) => c.id === item.category_id)?.name}
          onClose={close}
          actions={(
            <RowMenu
              label={`More actions for ${item.name}`}
              items={[{ key: 'delete', label: 'Delete item', tone: 'danger' }]}
              onPick={() => setConfirming(true)}
            />
          )}
          footer={(
            <Button variant="primary" className="cat-drawer-main" onClick={() => onEdit(true)}>
              Edit item
            </Button>
          )}
        >
          <ItemDetails item={item} stations={stations} modifierGroups={modifierGroups} />
          {error && <p className="form-error" role="alert">{error}</p>}
        </Drawer>
        {confirming && (
          <ConfirmDialog
            title={`Delete “${item.name}”?`}
            description="The item disappears from every register and guest page. This cannot be undone."
            confirmLabel="Delete item"
            tone="danger"
            busy={deleting}
            error={error}
            onConfirm={remove}
            onCancel={() => setConfirming(false)}
          />
        )}
      </>
    )
  }

  return (
    <>
      <Drawer
        title={isNew ? 'New item' : `Edit ${item.name}`}
        onClose={close}
        footer={(
          <>
            <Button onClick={close} disabled={locked}>Cancel</Button>
            <Button
              variant="primary"
              className="cat-drawer-main"
              busy={saving}
              busyLabel="Saving…"
              disabled={uploading}
              onClick={save}
            >
              Save
            </Button>
          </>
        )}
      >
        <div className="cat-form">
          <label><span>Name</span>
            {/* Без autoFocus: на телефоне это сразу выбрасывало клавиатуру
                и уводило форму вверх, хотя товар просто открыли */}
            <input value={name} onChange={(e) => setName(e.target.value)} />
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
            <label><span>SKU</span>
              <input
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                maxLength={64}
                placeholder="COF-1"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
            </label>
            <label><span>Preparation station</span>
              <select value={stationId} onChange={(e) => setStationId(e.target.value)}>
                <option value="">Not routed</option>
                {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </div>

          <label className="check-field">
            <input type="checkbox" checked={available} onChange={(e) => setAvailable(e.target.checked)} />
            <span>Available for sale</span>
          </label>

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
              {imageUrl && (
                <Button onClick={() => setImageUrl('')} disabled={uploading}>Remove</Button>
              )}
            </div>
          </div>

          <div className="editor-block">
            <div className="editor-block-head">
              <span>Sizes</span>
              <button type="button" className="text-button" onClick={addVariant}><Plus /> Add</button>
            </div>
            {variants.length === 0 && <p className="hint">No sizes — the item sells at its base price.</p>}
            {variants.map((v, i) => (
              <div className="variant-row" key={i}>
                <input
                  placeholder="Name (S/M/L)"
                  aria-label={`Size ${i + 1} name`}
                  value={v.name}
                  onChange={(e) => updateVariant(i, { name: e.target.value })}
                />
                <input
                  placeholder="₪"
                  aria-label={`Size ${i + 1} price`}
                  value={v.price}
                  onChange={(e) => updateVariant(i, { price: e.target.value })}
                  inputMode="decimal"
                />
                <label className="check-field small">
                  <input
                    type="radio"
                    name="default-variant"
                    checked={v.is_default}
                    onChange={() => setVariants((vs) => vs.map((x, idx) => ({ ...x, is_default: idx === i })))}
                  />
                  <span>Default</span>
                </label>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => removeVariant(i)}
                  aria-label={`Remove size ${v.name || i + 1}`}
                >
                  <Trash2 />
                </button>
              </div>
            ))}
          </div>

          {modifierGroups.length > 0 && (
            <div className="editor-block">
              <div className="editor-block-head"><span>Modifier groups</span></div>
              <div className="group-checks">
                {modifierGroups.map((g) => (
                  <label key={g.id} className="check-field">
                    <input
                      type="checkbox"
                      checked={groupIds.includes(g.id)}
                      onChange={() => toggleGroup(g.id)}
                    />
                    <span>{g.name}</span>
                  </label>
                ))}
              </div>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={askModifiers}
                  onChange={(e) => setAskModifiers(e.target.checked)}
                />
                <span>Ask for modifiers as soon as the item is added</span>
              </label>
            </div>
          )}

          {!isNew && (
            <div className="editor-block">
              <button
                type="button"
                className="menu-delete-row"
                disabled={locked}
                onClick={() => setConfirming(true)}
              >
                <Trash2 /> Delete item
              </button>
            </div>
          )}

          {/* Ошибка живёт рядом с формой: закрывшаяся панель с ошибкой
              где-то на странице — это потерянная правка */}
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
      </Drawer>
      {confirming && (
        <ConfirmDialog
          title={`Delete “${item.name}”?`}
          description="The item disappears from every register and guest page. This cannot be undone."
          confirmLabel="Delete item"
          tone="danger"
          busy={deleting}
          error={error}
          onConfirm={remove}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  )
}
