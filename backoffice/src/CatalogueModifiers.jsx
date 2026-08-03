import { useEffect, useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import {
  createModifierGroup, updateModifierGroup, deleteModifierGroup,
  createModifier, updateModifier, deleteModifier,
  reorderModifiers, setDefaultModifier, shekelsToAgorot, agorotToShekels, bulkErrorText,
} from './menu'
import {
  GROUP_GAP_LABELS, filterGroups, groupGaps, groupUsage, modifierDelta, moveInOrder,
  money, ruleError, selectionRule,
} from './catalog'
import Drawer from './ui/Drawer'
import ConfirmDialog from './ui/ConfirmDialog'
import FormDialog from './ui/FormDialog'
import { Button } from './ui/Button'
import { RowMenu, OrderButtons } from './ui/RowMenu'
import useNarrow from './ui/useNarrow'

/**
 * Модификаторы — структурированный набор опций.
 *
 * Группа задаёт ПРАВИЛО выбора («молоко: не больше одного»), модификатор
 * — один доступный вариант и его ДОПЛАТУ. Раньше экран не различал их
 * ничем, кроме отступа, а правило показывал как «Choose 0–1»: числа,
 * которые нужно расшифровывать в уме. Теперь правило написано словами и
 * посчитано из тех же `min_select`/`max_select`.
 *
 * Зелёного бейджа `Active` из макета здесь нет: у группы такого поля не
 * существует, и рисовать его — значит обещать выключатель, которого
 * нет. Вместо него — реальные проблемы: пустая группа, минимум больше
 * максимума, обязательная группа без доступного выбора, недоступный
 * выбор по умолчанию.
 */

/** Порядок групп: только то, что действительно вычисляется */
const SORTS = [
  { key: 'manual', label: 'Manual order' },
  { key: 'name', label: 'Name A–Z' },
  { key: 'usage', label: 'Most used' },
]

function sortGroups(groups, mode, usage) {
  const list = [...groups]
  if (mode === 'name') return list.sort((a, b) => String(a.name).localeCompare(String(b.name)))
  if (mode === 'usage') return list.sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0))
  return list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
}

/** Состояние группы словом; цвет только усиливает текст */
function GroupState({ group }) {
  const gaps = groupGaps(group)
  if (gaps.length === 0) return <span className="cat-state is-ok">Ready</span>
  return (
    <span className="cat-state is-attention">
      Needs attention
      <small>{gaps.map((g) => GROUP_GAP_LABELS[g]).join(', ')}</small>
    </span>
  )
}

/** Форма группы: имя и правило выбора, которое тут же читается словами */
function GroupForm({ group, count, context, onDone, onCancel }) {
  const isNew = !group?.id
  const [name, setName] = useState(group?.name ?? '')
  const [min, setMin] = useState(String(group?.min_select ?? 0))
  const [max, setMax] = useState(String(group?.max_select ?? 1))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const lo = Number(min)
  const hi = Number(max)
  const invalid = ruleError(lo, hi)
  const preview = invalid ? null : selectionRule({ min_select: lo, max_select: hi })

  async function submit() {
    if (!name.trim()) { setError('Give the group a name.'); return }
    if (invalid) { setError(invalid); return }
    setBusy(true)
    setError('')
    try {
      if (isNew) await createModifierGroup(context, name.trim(), lo, hi, count)
      else await updateModifierGroup(group.id, { name: name.trim(), min_select: lo, max_select: hi })
      await onDone()
    } catch (e) {
      setError(bulkErrorText(e.message))
      setBusy(false)
    }
  }

  return (
    <FormDialog
      title={isNew ? 'Add modifier group' : `Edit ${group.name}`}
      submitLabel={isNew ? 'Add group' : 'Save group'}
      busy={busy}
      error={error}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <label className="qr-field">
        <span>Group name</span>
        <input
          value={name}
          maxLength={64}
          placeholder="Milk choice"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className="field-row">
        <label className="qr-field">
          <span>Minimum</span>
          <input
            value={min}
            inputMode="numeric"
            onChange={(e) => setMin(e.target.value.replace(/[^\d]/g, ''))}
          />
        </label>
        <label className="qr-field">
          <span>Maximum</span>
          <input
            value={max}
            inputMode="numeric"
            onChange={(e) => setMax(e.target.value.replace(/[^\d]/g, ''))}
          />
        </label>
      </div>
      {/* Правило читается словами ДО сохранения: «0 и 0» иначе никак не
          отличить от ошибки, хотя это «сколько угодно». */}
      <p className={invalid ? 'form-error' : 'hint'} role={invalid ? 'alert' : undefined}>
        {invalid || `Guests see: ${preview}`}
      </p>
      <p className="hint">Maximum 0 means there is no limit.</p>
    </FormDialog>
  )
}

/** Форма модификатора: имя, доплата, выбор по умолчанию и доступность */
function ModifierForm({ modifier, group, count, context, onDone, onCancel }) {
  const isNew = !modifier?.id
  const [name, setName] = useState(modifier?.name ?? '')
  const [price, setPrice] = useState(
    modifier ? String(agorotToShekels(modifier.price_delta ?? 0)) : '0'
  )
  const [isDefault, setIsDefault] = useState(Boolean(modifier?.is_default))
  const [available, setAvailable] = useState(modifier?.is_available ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (!name.trim()) { setError('Give the modifier a name.'); return }
    const delta = shekelsToAgorot(price || '0')
    if (delta === null) { setError('Extra price must be a number, for example 3 or 3.50'); return }
    setBusy(true)
    setError('')
    try {
      let id = modifier?.id
      if (isNew) {
        id = await createModifier(context, group.id, {
          name: name.trim(), price_delta: delta, is_default: false,
          is_available: available, sort_order: count,
        })
      } else {
        await updateModifier(id, {
          name: name.trim(), price_delta: delta, is_available: available,
        })
      }
      /*
       * Выбор по умолчанию ставится отдельным шагом, который сначала
       * снимает флаг со всей группы: касса применяет КАЖДЫЙ default
       * одним тапом, и два молока по умолчанию — это две порции молока
       * в заказе.
       */
      if (isDefault !== Boolean(modifier?.is_default)) {
        await setDefaultModifier(group.id, isDefault ? id : null)
      }
      await onDone()
    } catch (e) {
      setError(bulkErrorText(e.message))
      setBusy(false)
    }
  }

  return (
    <FormDialog
      title={isNew ? `Add modifier to ${group.name}` : `Edit ${modifier.name}`}
      submitLabel={isNew ? 'Add modifier' : 'Save modifier'}
      busy={busy}
      error={error}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <label className="qr-field">
        <span>Modifier name</span>
        <input
          value={name}
          maxLength={64}
          placeholder="Oat milk"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="qr-field">
        <span>Extra charge ₪</span>
        <input
          value={price}
          inputMode="decimal"
          onChange={(e) => setPrice(e.target.value)}
        />
      </label>
      <p className="hint">0 means the choice is free.</p>
      <label className="check-field">
        <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
        <span>Chosen by default</span>
      </label>
      <label className="check-field">
        <input type="checkbox" checked={available} onChange={(e) => setAvailable(e.target.checked)} />
        <span>Available to order</span>
      </label>
    </FormDialog>
  )
}

/** Панель выбранной группы: правило, где используется и сами варианты */
function GroupDrawer({
  group, usedBy, busy, onClose, onEdit, onAddModifier, onEditModifier,
  onMoveModifier, onDeleteModifier, onDeleteGroup, error,
}) {
  const mods = (group.modifiers ?? []).slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const gaps = groupGaps(group)

  return (
    <Drawer
      modal={false}
      title={group.name}
      subtitle={`${selectionRule(group)} · used by ${usedBy} item${usedBy === 1 ? '' : 's'}`}
      onClose={onClose}
      actions={(
        <RowMenu
          label={`More actions for ${group.name}`}
          items={[{ key: 'delete', label: 'Delete group', tone: 'danger' }]}
          onPick={onDeleteGroup}
        />
      )}
      footer={(
        <Button variant="primary" className="cat-drawer-main" onClick={onEdit}>Edit group</Button>
      )}
    >
      <div className="cat-detail">
        <dl className="cat-detail-facts">
          <div><dt>Minimum</dt><dd>{group.min_select ?? 0}</dd></div>
          <div>
            <dt>Maximum</dt>
            <dd>{Number(group.max_select ?? 0) === 0 ? 'No limit' : group.max_select}</dd>
          </div>
        </dl>

        {gaps.length > 0 && (
          <p className="cat-detail-gaps">
            Needs attention: {gaps.map((g) => GROUP_GAP_LABELS[g]).join(', ')}
          </p>
        )}

        <section className="cat-detail-block">
          <div className="cat-detail-block-head">
            <h4>Modifiers</h4>
            <Button size="compact" onClick={onAddModifier}><Plus /> Add modifier</Button>
          </div>
          {mods.length === 0 ? (
            <p className="empty-state">
              No modifiers yet — a group without choices offers the guest nothing.
            </p>
          ) : (
            <ul className="cat-mod-list">
              {mods.map((m, index) => (
                <li key={m.id}>
                  <OrderButtons
                    label={m.name}
                    index={index}
                    total={mods.length}
                    disabled={busy}
                    onMove={(dir) => onMoveModifier(mods, m.id, dir)}
                  />
                  <span className="cat-mod-name">
                    {m.name}
                    {/* Цена модификатора — всегда доплата, а не цена товара */}
                    <small>{modifierDelta(m.price_delta, money)}</small>
                  </span>
                  <span className="cat-mod-tags">
                    {m.is_default && <span className="cat-tag">Default</span>}
                    {m.is_available === false && <span className="cat-avail is-off">Unavailable</span>}
                  </span>
                  <RowMenu
                    label={`Actions for ${m.name}`}
                    items={[
                      { key: 'edit', label: 'Edit modifier' },
                      { key: 'delete', label: 'Delete modifier', tone: 'danger' },
                    ]}
                    onPick={(key) => (key === 'edit' ? onEditModifier(m) : onDeleteModifier(m))}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </Drawer>
  )
}

export default function ModifiersTab({
  context, data, reload, filters, onFilters, query, creating, onCreating,
}) {
  const [openId, setOpenId] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editingGroup, setEditingGroup] = useState(null)
  const [modifierForm, setModifierForm] = useState(null) // { group, modifier|null }
  const [confirm, setConfirm] = useState(null) // { kind, target }
  const narrow = useNarrow()

  const usage = filters.groupUsage
  const state = filters.groupState
  const sort = filters.groupSort

  const usageMap = useMemo(() => groupUsage(data.items), [data.items])
  const matched = useMemo(
    () => filterGroups(data.modifierGroups, { query, state, usage }, usageMap),
    [data.modifierGroups, query, state, usage, usageMap]
  )
  const groups = useMemo(() => sortGroups(matched, sort, usageMap), [matched, sort, usageMap])
  const attention = useMemo(
    () => data.modifierGroups.filter((g) => groupGaps(g).length > 0).length,
    [data.modifierGroups]
  )
  const filtersOn = query.trim() !== '' || state !== 'all' || usage !== 'all'

  const current = openId ? data.modifierGroups.find((g) => g.id === openId) ?? null : null
  useEffect(() => { if (openId && !current) setOpenId(null) }, [openId, current])

  async function run(action) {
    setBusy(true)
    setError('')
    try {
      await action()
      await reload()
    } catch (e) {
      setError(bulkErrorText(e.message))
    } finally {
      setBusy(false)
    }
  }

  async function moveModifier(list, id, direction) {
    const ids = moveInOrder(list.map((m) => m.id), id, direction)
    await run(() => reorderModifiers(ids))
  }

  async function confirmed() {
    if (!confirm) return
    const { kind, target } = confirm
    await run(async () => {
      if (kind === 'group') await deleteModifierGroup(target.id)
      else await deleteModifier(target.id)
      if (kind === 'group') setOpenId(null)
    })
    setConfirm(null)
  }

  return (
    <>
      <div className="cat-toolbar">
        <label className="cat-select-filter">
          <span className="visually-hidden">Usage</span>
          <select value={usage} onChange={(e) => onFilters({ groupUsage: e.target.value })}>
            <option value="all">All usage</option>
            <option value="used">Used by items</option>
            <option value="unused">Not used yet</option>
          </select>
        </label>
        <button
          type="button"
          className={`cat-chip${state === 'incomplete' ? ' is-on' : ''}`}
          aria-pressed={state === 'incomplete'}
          onClick={() => onFilters({ groupState: state === 'incomplete' ? 'all' : 'incomplete' })}
        >
          Needs attention <span>{attention}</span>
        </button>
        <label className="cat-select-filter">
          <span className="visually-hidden">Sort</span>
          <select value={sort} onChange={(e) => onFilters({ groupSort: e.target.value })}>
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        {filtersOn && (
          <button
            type="button"
            className="text-button"
            onClick={() => onFilters({ groupUsage: 'all', groupState: 'all' })}
          >
            <X /> Clear
          </button>
        )}
        <span className="cat-count">
          {groups.length} group{groups.length === 1 ? '' : 's'}
        </span>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      <section className="panel cat-panel">
        {groups.length === 0 ? (
          <p className="empty-state">
            {filtersOn
              ? 'No group matches these filters.'
              : 'No modifier groups yet — add the first one.'}
          </p>
        ) : narrow ? (
          <ul className="cat-cards">
            {groups.map((g) => (
              <li key={g.id} className={g.id === openId ? 'is-selected' : undefined}>
                <button
                  type="button"
                  className="cat-card-open"
                  aria-expanded={g.id === openId}
                  onClick={() => setOpenId(g.id)}
                >
                  <span className="cat-card-name">{g.name}</span>
                  <span className="cat-card-meta">{selectionRule(g)}</span>
                  <span className="cat-card-meta">
                    {(g.modifiers ?? []).length} modifiers · used by {usageMap.get(g.id) ?? 0}
                  </span>
                </button>
                <span className="cat-card-side"><GroupState group={g} /></span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="cat-table-scroll">
            <table className="cat-table">
              <thead>
                <tr>
                  <th scope="col">Group</th>
                  <th scope="col">Selection rule</th>
                  <th scope="col">Modifiers</th>
                  <th scope="col">Used by</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="cat-col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const used = usageMap.get(g.id) ?? 0
                  return (
                    <tr key={g.id} className={`cat-row${g.id === openId ? ' is-selected' : ''}`}>
                      <td>
                        <button
                          type="button"
                          className="cat-open"
                          aria-expanded={g.id === openId}
                          onClick={() => setOpenId(g.id)}
                        >
                          {g.name}
                        </button>
                      </td>
                      <td className="cat-cell-muted">{selectionRule(g)}</td>
                      <td className="cat-cell-muted">{(g.modifiers ?? []).length}</td>
                      <td className="cat-cell-muted">
                        {used} item{used === 1 ? '' : 's'}
                      </td>
                      <td><GroupState group={g} /></td>
                      <td className="cat-col-actions">
                        <RowMenu
                          label={`Actions for ${g.name}`}
                          items={[
                            { key: 'edit', label: 'Edit group' },
                            { key: 'add', label: 'Add modifier' },
                            { key: 'delete', label: 'Delete group', tone: 'danger' },
                          ]}
                          onPick={(key) => {
                            if (key === 'edit') setEditingGroup(g)
                            if (key === 'add') setModifierForm({ group: g, modifier: null })
                            if (key === 'delete') setConfirm({ kind: 'group', target: g })
                          }}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {current && (
        <GroupDrawer
          group={current}
          usedBy={usageMap.get(current.id) ?? 0}
          busy={busy}
          error={error}
          onClose={() => setOpenId(null)}
          onEdit={() => setEditingGroup(current)}
          onAddModifier={() => setModifierForm({ group: current, modifier: null })}
          onEditModifier={(m) => setModifierForm({ group: current, modifier: m })}
          onMoveModifier={moveModifier}
          onDeleteModifier={(m) => setConfirm({ kind: 'modifier', target: m })}
          onDeleteGroup={() => setConfirm({ kind: 'group', target: current })}
        />
      )}

      {(creating === 'group' || editingGroup) && (
        <GroupForm
          context={context}
          group={editingGroup}
          count={data.modifierGroups.length}
          onDone={async () => { onCreating(null); setEditingGroup(null); await reload() }}
          onCancel={() => { onCreating(null); setEditingGroup(null) }}
        />
      )}

      {modifierForm && (
        <ModifierForm
          context={context}
          group={modifierForm.group}
          modifier={modifierForm.modifier}
          count={(modifierForm.group.modifiers ?? []).length}
          onDone={async () => { setModifierForm(null); await reload() }}
          onCancel={() => setModifierForm(null)}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === 'group'
            ? `Delete group “${confirm.target.name}”?`
            : `Delete “${confirm.target.name}”?`}
          /* Удаление группы уносит и её модификаторы — это записано в
             схеме (ON DELETE CASCADE), и человек обязан узнать об этом
             до, а не после. */
          description={confirm.kind === 'group'
            ? `Its ${(confirm.target.modifiers ?? []).length} modifiers are deleted too, and items using this group lose it.`
            : 'The choice disappears from every item that uses this group.'}
          confirmLabel="Delete"
          tone="danger"
          busy={busy}
          error={error}
          onConfirm={confirmed}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  )
}
