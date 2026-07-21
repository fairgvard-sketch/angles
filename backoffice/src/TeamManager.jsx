import { useEffect, useMemo, useState } from 'react'
import { Check, KeyRound, Plus, Trash2, X } from 'lucide-react'
import {
  ROLES, ROLE_LABELS, isValidPin,
  fetchStaff, createStaff, updateStaff, setStaffPin, deleteStaff,
  PERM_KEYS, PERM_LABELS, permLevel,
  fetchRoles, saveRole, deleteRole,
} from './team'
import { fetchLocation, patchLocationSettings } from './settings'

/**
 * Команда в бэкофисе — паритет с кассовым разделом «Сотрудники»: список,
 * добавление, правка имени/роли, смена PIN, деактивация, удаление и права
 * доступа по действиям.
 *
 * Роль владельца защищена сервером (Kassa 093), клиент лишь не показывает
 * недоступное: менеджер не редактирует owner-строки и не выдаёт роль owner.
 */

const TABS = [
  { key: 'staff', label: 'Staff' },
  { key: 'roles', label: 'Roles' },
  { key: 'perms', label: 'Permissions' },
]

/** Строка сотрудника: имя, роль, статус. */
function StaffRow({ member, onEdit, onChangePin, editable, roleName }) {
  return (
    <div className={`menu-row team-row${member.is_active ? '' : ' is-off'}`}>
      <span className="menu-name">
        {member.name}
        {!member.is_active && <small> · inactive</small>}
      </span>
      <span className="menu-price">{roleName || ROLE_LABELS[member.role] || member.role}</span>
      <span className="team-row-actions">
        {editable && (
          <>
            <button className="icon-button" onClick={() => onChangePin(member)} title="Change PIN" aria-label={`Change PIN for ${member.name}`}>
              <KeyRound />
            </button>
            <button className="text-button" onClick={() => onEdit(member)}>Edit</button>
          </>
        )}
      </span>
    </div>
  )
}

/** Модальный редактор: и создание, и правка (как ItemEditor в меню). */
function StaffEditor({ member, locations, roles, canAssignOwner, canDelete, onClose, onSaved }) {
  const isNew = !member.id
  const [name, setName] = useState(member.name || '')
  const [role, setRole] = useState(member.role || 'barista')
  const [roleId, setRoleId] = useState(member.role_id || '')
  const [locationId, setLocationId] = useState(member.location_id || locations[0]?.id || '')
  const [pin, setPin] = useState('')
  const [active, setActive] = useState(member.is_active ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Базовые уровни (owner/manager/barista) — НЕ путать с кастомными ролями
  // из пропа `roles`: раньше локальная константа называлась так же и затеняла его.
  const baseRoles = canAssignOwner ? ROLES : ROLES.filter((r) => r !== 'owner')
  // При создании PIN обязателен, при правке — пустое поле значит «не менять»
  const pinOk = isNew ? isValidPin(pin) : pin === '' || isValidPin(pin)
  const canSave = name.trim() && pinOk && (!isNew || locationId) && !busy

  async function save() {
    setBusy(true)
    setError('')
    try {
      if (isNew) {
        const newId = await createStaff({ name, role, pin, locationId })
        // create_staff роль не принимает — проставляем вторым вызовом.
        // Сбой здесь не теряет сотрудника: он уже создан с базовой ролью.
        if (roleId) await updateStaff(newId, { role_id: roleId })
      } else {
        await updateStaff(member.id, {
          name: name.trim(), role, is_active: active,
          role_id: roleId || null,
        })
        if (pin) await setStaffPin(member.id, pin)
      }
      onSaved()
    } catch (saveError) {
      setError(saveError.message)
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirm(`Delete ${member.name}? This cannot be undone.`)) return
    setBusy(true)
    setError('')
    try {
      await deleteStaff(member.id)
      onSaved()
    } catch (deleteError) {
      // Сотрудник с историей не удаляется — аудит неприкосновенен
      setError(deleteError.hasRecords
        ? 'This person already has sales history and cannot be deleted. Deactivate them instead.'
        : deleteError.message)
      setBusy(false)
    }
  }

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-head">
          <h2>{isNew ? 'Add person' : name || 'Edit person'}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X /></button>
        </div>

        <div className="modal-body">
          <label>
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>

          <div className="field-row">
            <label>
              <span>Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                {baseRoles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </label>

            {isNew && locations.length > 1 && (
              <label>
                <span>Location</span>
                <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
            )}
          </div>

          {roles.length > 0 && role !== 'owner' && (
            <label>
              <span>Custom role</span>
              <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                <option value="">None — use base role and location settings</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
          )}

          <label>
            <span>{isNew ? 'PIN (4–8 digits)' : 'New PIN (leave blank to keep current)'}</span>
            <input
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
            />
          </label>
          <p className="hint">The PIN is used to sign in on the register. It is stored encrypted and can only be replaced, never read.</p>

          {!isNew && (
            <label className="check-field">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              <span>Active — can sign in on the register</span>
            </label>
          )}

          {error && <p className="form-error" role="alert">{error}</p>}
        </div>

        <div className="modal-foot">
          {!isNew && canDelete && (
            <button className="danger-button" onClick={remove} disabled={busy}>
              <Trash2 /><span className="btn-label">Delete</span>
            </button>
          )}
          <div className="modal-foot-right">
            <button className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="primary-button" onClick={save} disabled={!canSave}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Роли (094) ───────────────────────────────────────────────
/** Модальный редактор роли: имя, базовый уровень и галочки прав. */
function RoleEditor({ role, onClose, onSaved }) {
  const isNew = !role.id
  const [name, setName] = useState(role.name || '')
  const [base, setBase] = useState(role.base || 'barista')
  const [perms, setPerms] = useState(() => new Set(role.perms || []))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function toggle(key) {
    setPerms((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  async function save() {
    setBusy(true)
    setError('')
    try {
      await saveRole({ id: role.id, name, base, perms: [...perms] })
      onSaved()
    } catch (saveError) {
      setError(saveError.message)
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirm(`Delete role “${name}”? People with this role go back to their base level.`)) return
    setBusy(true)
    setError('')
    try {
      await deleteRole(role.id)
      onSaved()
    } catch (deleteError) {
      setError(deleteError.message)
      setBusy(false)
    }
  }

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-head">
          <h2>{isNew ? 'New role' : name || 'Edit role'}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X /></button>
        </div>

        <div className="modal-body">
          <label>
            <span>Role name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Senior barista" />
          </label>

          <label>
            <span>Base level</span>
            <select value={base} onChange={(e) => setBase(e.target.value)}>
              <option value="barista">Barista</option>
              <option value="manager">Manager</option>
            </select>
          </label>
          <p className="hint">The base level applies to anything not listed below. Owner access cannot be granted by a role.</p>

          <div className="editor-block">
            <div className="editor-block-head"><span>Allowed actions</span></div>
            <div className="group-checks">
              {PERM_KEYS.map((key) => (
                <label className="check-field small" key={key}>
                  <input type="checkbox" checked={perms.has(key)} onChange={() => toggle(key)} />
                  <span>{PERM_LABELS[key]}</span>
                </label>
              ))}
            </div>
          </div>
          <p className="hint">Managing team, roles and settings always stays with owners and managers.</p>

          {error && <p className="form-error" role="alert">{error}</p>}
        </div>

        <div className="modal-foot">
          {!isNew && (
            <button className="danger-button" onClick={remove} disabled={busy}>
              <Trash2 /><span className="btn-label">Delete</span>
            </button>
          )}
          <div className="modal-foot-right">
            <button className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="primary-button" onClick={save} disabled={!name.trim() || busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function RolesTab({ roles, staff, reload }) {
  const [editing, setEditing] = useState(null)

  /** Сколько человек носит роль — чтобы удаление не было вслепую */
  function holders(roleId) {
    return (staff || []).filter((s) => s.role_id === roleId).length
  }

  return (
    <>
      <div className="menu-toolbar">
        <button className="secondary-button" onClick={() => setEditing({})}>
          <Plus /> New role
        </button>
      </div>

      {roles === null ? (
        <p className="empty-state">Loading…</p>
      ) : roles.length === 0 ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>No custom roles yet</h2>
              <p>Create one to allow specific actions — like refunds for a senior barista — without making someone a manager.</p>
            </div>
          </div>
        </section>
      ) : (
        <section className="panel">
          <div className="menu-list">
            {roles.map((role) => {
              const count = holders(role.id)
              return (
                <button className="menu-row team-row as-button" key={role.id} onClick={() => setEditing(role)}>
                  <span className="menu-name">
                    {role.name}
                    <small> · {ROLE_LABELS[role.base]} base</small>
                  </span>
                  <span className="menu-price">
                    {role.perms?.length || 0} allowed
                  </span>
                  <span className="team-row-actions">
                    {count > 0 ? `${count} ${count === 1 ? 'person' : 'people'}` : 'unused'}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {editing && (
        <RoleEditor
          role={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload() }}
        />
      )}
    </>
  )
}

// ── Вкладка «Права доступа» ──────────────────────────────────
/**
 * Права живут в locations.settings.perms и задаются на точку: 'all' — действие
 * доступно всем, 'manager' — только менеджеру и владельцу.
 */
function PermsTab({ locations }) {
  const [activeId, setActiveId] = useState(locations[0]?.id || null)
  const [settings, setSettings] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!activeId) return undefined
    let cancelled = false
    setSettings(null)
    setSaved(false)
    fetchLocation(activeId)
      .then((data) => { if (!cancelled) setSettings(data.settings || {}) })
      .catch((loadError) => { if (!cancelled) setError(loadError.message) })
    return () => { cancelled = true }
  }, [activeId])

  async function toggle(key, level) {
    setSaving(true)
    setError('')
    setSaved(false)
    // Оптимистично: переключатель отзывается сразу, ошибку откатываем
    const previous = settings
    setSettings({ ...settings, perms: { ...(settings.perms || {}), [key]: level } })
    try {
      await patchLocationSettings(activeId, { perms: { [key]: level } })
      setSaved(true)
    } catch (saveError) {
      setSettings(previous)
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {locations.length > 1 && (
        <div className="location-tabs" role="tablist" aria-label="Location">
          {locations.map((loc) => (
            <button
              key={loc.id}
              role="tab"
              aria-selected={loc.id === activeId}
              className={loc.id === activeId ? 'is-active' : ''}
              onClick={() => setActiveId(loc.id)}
            >
              {loc.name}
            </button>
          ))}
        </div>
      )}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>What baristas can do</h2>
            <p>Restricted actions ask for a manager or owner PIN on the register.</p>
          </div>
          {saved && !saving && <span className="save-ok"><Check /> Saved</span>}
        </div>

        {!settings ? (
          <p className="empty-state">Loading…</p>
        ) : (
          <div className="menu-list">
            {PERM_KEYS.map((key) => {
              const level = permLevel(settings, key)
              return (
                <div className="menu-row" key={key}>
                  <span className="menu-name">{PERM_LABELS[key]}</span>
                  <span className="perm-switch">
                    <button
                      className={level === 'all' ? 'is-active' : ''}
                      onClick={() => toggle(key, 'all')}
                      disabled={saving}
                    >
                      Everyone
                    </button>
                    <button
                      className={level === 'manager' ? 'is-active' : ''}
                      onClick={() => toggle(key, 'manager')}
                      disabled={saving}
                    >
                      Manager
                    </button>
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}
      </section>
    </>
  )
}

export default function TeamManager({ context }) {
  const locations = context.locations || []
  const myRole = context.member?.role
  const iAmOwner = myRole === 'owner'

  const [tab, setTab] = useState('staff')
  const [staff, setStaff] = useState(null)
  const [roles, setRoles] = useState(null)
  const [editing, setEditing] = useState(null) // {} = новый, {id...} = правка
  const [error, setError] = useState('')

  async function reload() {
    setError('')
    try {
      const [nextStaff, nextRoles] = await Promise.all([fetchStaff(), fetchRoles()])
      setStaff(nextStaff)
      setRoles(nextRoles)
    } catch (loadError) {
      setError(loadError.message)
    }
  }

  useEffect(() => { reload() }, [])

  const { active, inactive } = useMemo(() => {
    const list = staff || []
    return {
      active: list.filter((s) => s.is_active),
      inactive: list.filter((s) => !s.is_active),
    }
  }, [staff])

  /** Строку владельца правит только владелец — сервер это тоже проверяет. */
  function canEdit(member) {
    return member.role !== 'owner' || iAmOwner
  }

  /** Имя кастомной роли для строки списка (пусто — покажется базовая) */
  function roleNameFor(member) {
    if (!member.role_id) return null
    return (roles || []).find((r) => r.id === member.role_id)?.name || null
  }

  return (
    <>
      <section className="page-heading compact-heading">
        <p className="eyebrow">{context.organization?.name}</p>
        <h1>Team</h1>
        <p>People who work on the register, their PINs and what they are allowed to do.</p>
      </section>

      <div className="menu-tabs location-tabs" role="tablist" aria-label="Team section">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? 'is-active' : ''}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'staff' && (
        <>
          <div className="menu-toolbar">
            <button className="secondary-button" onClick={() => setEditing({})} disabled={locations.length === 0}>
              <Plus /> Add person
            </button>
          </div>

          {error && <p className="form-error" role="alert">{error}</p>}

          {staff === null ? (
            <p className="empty-state">Loading…</p>
          ) : staff.length === 0 ? (
            <p className="empty-state">Nobody has been added yet.</p>
          ) : (
            <div className="menu-groups">
              <section className="panel">
                <div className="panel-heading">
                  <div><h2>Active</h2><p>{active.length} on the register</p></div>
                </div>
                <div className="menu-list">
                  {active.map((member) => (
                    <StaffRow
                      key={member.id}
                      member={member}
                        roleName={roleNameFor(member)}
                      editable={canEdit(member)}
                      onEdit={setEditing}
                      onChangePin={setEditing}
                    />
                  ))}
                </div>
              </section>

              {inactive.length > 0 && (
                <section className="panel">
                  <div className="panel-heading">
                    <div><h2>Inactive</h2><p>Kept for sales history, cannot sign in</p></div>
                  </div>
                  <div className="menu-list">
                    {inactive.map((member) => (
                      <StaffRow
                        key={member.id}
                        member={member}
                          roleName={roleNameFor(member)}
                        editable={canEdit(member)}
                        onEdit={setEditing}
                        onChangePin={setEditing}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </>
      )}

      {tab === 'roles' && <RolesTab roles={roles} staff={staff} reload={reload} />}

      {tab === 'perms' && (
        locations.length === 0
          ? <p className="empty-state">No locations are linked to this account.</p>
          : <PermsTab locations={locations} />
      )}

      {editing && (
        <StaffEditor
          member={editing}
          locations={locations}
          roles={roles || []}
          canAssignOwner={iAmOwner}
          canDelete={iAmOwner || editing.role !== 'owner'}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload() }}
        />
      )}
    </>
  )
}
