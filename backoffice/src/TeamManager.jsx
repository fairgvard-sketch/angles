import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronRight, Clock, Plus, UserPlus, Users, X } from 'lucide-react'
import {
  ROLES, ROLE_LABELS, isValidPin,
  fetchStaff, createStaff, updateStaff, setStaffPin, deleteStaff,
  fetchRoles, saveRole, deleteRole,
  PERM_KEYS, PERM_LABELS, PERM_HINTS, permLevel,
  roleOf, accessRows, accessSource, accessScope, accessSummary,
  roleHolders, locationLabel, roleTitle,
  lastShiftLabel, SHIFT_WINDOW_DAYS, shiftIndex, statusOf, personRowLabel,
  sortRoster, filterRoster, rosterCounts, filterRoles,
  ROLE_SEARCH_FROM, PEOPLE_PAGE, ROLE_PAGE,
  TABS, resolveTeamRoute, staffErrorText, hasRecords,
  roleAccessDiff, levelChangeEffect,
} from './team'
import { fetchLocation, patchLocationSettings } from './settings'
import { fetchHours } from './timesheet'
import {
  PageHeader, Panel, SearchField, EmptyPanel, EmptyState, ErrorText, StatusBadge,
} from './ui/Layout'
import { Button } from './ui/Button'
import Tabs from './ui/Tabs'
import Drawer from './ui/Drawer'
import FormDialog from './ui/FormDialog'
import ConfirmDialog from './ui/ConfirmDialog'
import HoursManager from './HoursManager'
import Skeleton, { SkeletonPanel, SkeletonRow } from './ui/Skeleton'
import useNarrow from './ui/useNarrow'

/**
 * Команда — две вкладки: «People & access» и «Hours».
 *
 * Люди, роли и права точки съехались на одну страницу, потому что
 * отвечают на ОДИН вопрос — что человеку можно, — и переопределяют друг
 * друга по действиям. Разложенные по вкладкам, они заставляли владельца
 * держать матрицу в голове: там уровень точки, здесь галочки роли, а
 * какая победит — написано абзацем текста. Теперь право читается одной
 * строкой: «Refunds — только менеджер, плюс Senior barista».
 *
 * Часы остались отдельной вкладкой намеренно. Табель отвечает на другой
 * вопрос — кто когда работал и что уходит в зарплату; у него свой месяц,
 * своя правка задним числом, печать и выгрузка. Поставленный под матрицу
 * прав, он похоронил бы обе поверхности.
 *
 * Заодно исправлено обещание, которого система не выполняла. Прежний
 * редактор роли говорил «базовый уровень применяется ко всему, что не
 * перечислено ниже»; на деле набор роли ИСЧЕРПЫВАЮЩИЙ — `require_staff_perm`
 * (094) и `can()` кассы в этой ветке настройки точки не смотрят вовсе.
 *
 * Роль владельца защищена сервером (Kassa 093), клиент лишь не показывает
 * недоступное: менеджер не редактирует owner-строки и не выдаёт роль owner.
 */

/** Прокрутка к секции: движение выключено, если человек его отключил */
function scrollBehavior() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'auto'
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

// ── Люди ─────────────────────────────────────────────────────

/**
 * Строка человека.
 *
 * Вся строка — одна кнопка, как в клиентской базе: у строки ровно одно
 * назначение — открыть карточку, и действий в ней не живёт. Прежняя
 * строка держала иконку ключа «сменить PIN», которая открывала ту же
 * форму, что и «Edit», — обещание быстрого действия, которого не было.
 */
function PersonRow({ member, role, locations, access, shift, selected, onOpen }) {
  const status = statusOf(member, shift)
  return (
    <button
      type="button"
      className={`tm-row${selected ? ' is-selected' : ''}${member.is_active ? '' : ' is-off'}`}
      aria-label={personRowLabel(member, { role, locations, access, shift })}
      aria-expanded={selected}
      onClick={() => onOpen(member)}
    >
      <span className="tm-cell-name">
        <strong>{member.name}</strong>
        {role && <small>{ROLE_LABELS[member.role]} level</small>}
      </span>
      <span className="tm-cell-role">{roleTitle(member, role)}</span>
      {locations.length > 1 && (
        <span className="tm-cell-muted" data-label="Location">{locationLabel(member, locations)}</span>
      )}
      <span className="tm-cell-access" data-label="Access">{access.label}</span>
      <span className="tm-cell-muted" data-label="Last shift">
        {shift?.open ? 'Now' : lastShiftLabel(shift?.lastDay)}
      </span>
      <span className="tm-cell-status">
        <StatusBadge className="tm-status" tone={status.tone} label={status.label} />
      </span>
    </button>
  )
}

/** Заведение человека: имя, уровень, точка и PIN — всё, что просит сервер */
function AddPersonDialog({ locations, roles, canAssignOwner, onClose, onSaved }) {
  const [name, setName] = useState('')
  const [role, setRole] = useState('barista')
  const [roleId, setRoleId] = useState('')
  const [locationId, setLocationId] = useState(locations[0]?.id || '')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const baseRoles = canAssignOwner ? ROLES : ROLES.filter((r) => r !== 'owner')
  const ready = name.trim() && isValidPin(pin) && locationId && !busy

  async function submit() {
    if (!ready) {
      setError(isValidPin(pin) ? 'Give the person a name.' : 'A PIN is 4 to 8 digits.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const id = await createStaff({ name, role, pin, locationId })
      // create_staff роль не принимает — проставляем вторым вызовом.
      // Сбой здесь не теряет человека: он уже создан с базовым уровнем.
      if (roleId) await updateStaff(id, { role_id: roleId })
      onSaved()
    } catch (saveError) {
      setError(staffErrorText(saveError.message))
      setBusy(false)
    }
  }

  return (
    <FormDialog
      title="Add person"
      description="They sign in on the register with a PIN."
      submitLabel="Add"
      error={error}
      busy={busy}
      onSubmit={submit}
      onCancel={onClose}
    >
      <label className="qr-field">
        <span>Name</span>
        <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required />
      </label>

      <div className="field-row">
        <label className="qr-field">
          <span>Level</span>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {baseRoles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </label>
        {locations.length > 1 && (
          <label className="qr-field">
            <span>Location</span>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
        )}
      </div>

      {roles.length > 0 && role !== 'owner' && (
        <label className="qr-field">
          <span>Role</span>
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="">None — follow the location rules</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
      )}

      <label className="qr-field">
        <span>PIN (4–8 digits)</span>
        <input
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
          required
        />
      </label>
      {/* Точка названа рядом с полем, а не в справке: сменить её потом
          нечем — allow-лист update_staff (093/094) её не принимает */}
      <p className="tm-hint">
        The PIN is stored encrypted and can only be replaced, never read.
        {locations.length > 1 && ' The location cannot be changed later.'}
      </p>
    </FormDialog>
  )
}

/** Смена PIN — отдельный блок карточки: это отдельный RPC и отдельный риск */
function PinBlock({ member }) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  async function save() {
    setBusy(true)
    setError('')
    try {
      await setStaffPin(member.id, pin)
      setPin('')
      setSaved(true)
    } catch (saveError) {
      setError(staffErrorText(saveError.message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tm-pin">
      <label className="qr-field">
        <span>New PIN</span>
        <input
          inputMode="numeric"
          autoComplete="off"
          placeholder="4–8 digits"
          value={pin}
          onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 8)); setSaved(false) }}
        />
      </label>
      <Button size="compact" disabled={!isValidPin(pin)} busy={busy} busyLabel="Saving…" onClick={save}>
        Replace PIN
      </Button>
      {saved && <span className="tm-saved" role="status"><Check aria-hidden /> PIN replaced</span>}
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  )
}

/**
 * Карточка человека рядом со списком.
 *
 * Панель, а не модалка: щелчок по соседней строке обязан открыть её, а не
 * закрыть карточку — сравнивают людей, а не изучают по одному.
 */
function PersonCard({
  member, roles, locations, settingsByLocation, shift,
  editable, canAssignOwner, onChanged, onClose, onOpenHours,
}) {
  const role = roleOf(member, roles)
  const [name, setName] = useState(member.name || '')
  const [base, setBase] = useState(member.role || 'barista')
  const [roleId, setRoleId] = useState(member.role_id || '')
  const [active, setActive] = useState(member.is_active ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // 'delete' | 'deactivate' — второе состояние того же диалога
  const [removing, setRemoving] = useState(null)
  const [removeError, setRemoveError] = useState('')

  const baseRoles = canAssignOwner ? ROLES : ROLES.filter((r) => r !== 'owner')
  const dirty = name.trim() !== (member.name || '')
    || base !== member.role
    || (roleId || null) !== (member.role_id || null)
    || active !== member.is_active

  // Карточка показывает права ПОСЛЕ правки, а не до: владелец меняет
  // роль, чтобы посмотреть, что из этого выйдет.
  const draft = { ...member, role: base, role_id: roleId || null }
  const draftRole = roleId ? (roles.find((r) => r.id === roleId) ?? null) : null
  const scope = accessScope(draft, draftRole, locations)

  async function save() {
    setBusy(true)
    setError('')
    try {
      await updateStaff(member.id, {
        name: name.trim(), role: base, is_active: active, role_id: roleId || null,
      })
      onChanged()
    } catch (saveError) {
      setError(staffErrorText(saveError.message))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Удаление и деактивация — один диалог в двух состояниях.
   *
   * Есть ли у человека история, знает только сервер: на клиенте нет ни
   * продаж, ни смен. Поэтому сначала пробуем удалить, и ровно на код
   * 'staff has records' диалог превращается в предложение деактивировать.
   * Любая другая ошибка остаётся ошибкой — сетевой сбой не повод
   * подсовывать владельцу другое действие.
   */
  async function confirmRemove() {
    setBusy(true)
    setRemoveError('')
    try {
      if (removing === 'deactivate') await updateStaff(member.id, { is_active: false })
      else await deleteStaff(member.id)
      setRemoving(null)
      onChanged()
    } catch (deleteError) {
      setRemoveError(staffErrorText(deleteError.message))
      if (hasRecords(deleteError.message)) setRemoving('deactivate')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Drawer
        labelledBy="tm-person-title"
        title={member.name}
        subtitle={[
          roleTitle(member, role),
          locations.length > 1 ? locationLabel(member, locations) : null,
          statusOf(member, shift).label,
        ].filter(Boolean).join(' · ')}
        onClose={onClose}
        modal={false}
      >
        {!editable && (
          <p className="tm-hint">Only an owner can change another owner.</p>
        )}

        <fieldset className="tm-fields" disabled={!editable}>
          <label className="qr-field">
            <span>Name</span>
            <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </label>

          {/* Уровень и роль стоят строками, а не парой в ряд: в панели 440 px
              «None — follow the location rules» обрезалось на середине, и
              выбор «без роли» переставал читаться */}
          <label className="qr-field">
            <span>Level</span>
            <select value={base} onChange={(e) => setBase(e.target.value)}>
              {baseRoles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </label>

          {roles.length > 0 && base !== 'owner' && (
            <label className="qr-field">
              <span>Role</span>
              <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                <option value="">None — follow the location rules</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
          )}

          <label className="check-field">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span>Can sign in on the register</span>
          </label>
        </fieldset>

        {error && <ErrorText>{error}</ErrorText>}

        {editable && (
          <div className="tm-card-actions">
            <Button variant="primary" size="compact" disabled={!dirty || !name.trim()} busy={busy} busyLabel="Saving…" onClick={save}>
              Save changes
            </Button>
          </div>
        )}

        {/* ── Что человеку можно ── */}
        <section className="tm-block">
          <h4>What this person can do</h4>
          {scope.length === 0 ? (
            <>
              <p className="tm-source">{accessSource(draft, draftRole, null)}</p>
              <AccessList member={draft} settings={null} role={draftRole} />
            </>
          ) : (
            scope.map((location) => (
              <div className="tm-scope" key={location.id}>
                {scope.length > 1 && <h5>{location.name}</h5>}
                <p className="tm-source">{accessSource(draft, draftRole, location.name)}</p>
                <AccessList member={draft} settings={settingsByLocation[location.id]} role={draftRole} />
              </div>
            ))
          )}
        </section>

        {/* ── Смены и PIN ── */}
        <section className="tm-block">
          <h4>Shifts</h4>
          <p className="tm-source">
            {shift?.open
              ? 'On shift right now.'
              : `Last shift: ${lastShiftLabel(shift?.lastDay)} (last ${SHIFT_WINDOW_DAYS} days).`}
          </p>
          <Button size="compact" onClick={() => onOpenHours(member.id)}>
            <Clock aria-hidden /> Open hours
          </Button>
        </section>

        {editable && (
          <section className="tm-block">
            <h4>PIN</h4>
            <PinBlock member={member} />
          </section>
        )}

        {editable && (
          <section className="tm-block tm-block-danger">
            <button
              type="button"
              className="text-button tm-remove"
              onClick={() => { setRemoveError(''); setRemoving('delete') }}
            >
              Remove from the team
            </button>
          </section>
        )}
      </Drawer>

      {removing && (
        <ConfirmDialog
          title={removing === 'deactivate' ? 'This person cannot be deleted' : `Remove ${member.name}?`}
          description={removing === 'deactivate'
            ? 'Deactivating keeps their sales and shifts in the reports, and stops them signing in on the register.'
            : 'If they have ever made a sale or clocked in, they cannot be deleted — you will be offered to deactivate instead.'}
          confirmLabel={removing === 'deactivate' ? 'Deactivate' : 'Remove'}
          tone="danger"
          error={removeError}
          busy={busy}
          onConfirm={confirmRemove}
          onCancel={() => { setRemoving(null); setRemoveError('') }}
        />
      )}
    </>
  )
}

/** Девять действий с ответом «можно / нельзя» */
function AccessList({ member, settings, role }) {
  return (
    <ul className="tm-access">
      {accessRows(member, settings, role).map((row) => (
        <li className={row.allowed ? 'is-on' : 'is-off'} key={row.key}>
          <span className="tm-access-mark" aria-hidden>{row.allowed ? <Check /> : <X />}</span>
          <span className="tm-access-name">
            {row.label}
            <small>{row.hint}</small>
          </span>
          <span className="visually-hidden">{row.allowed ? 'allowed' : 'not allowed'}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Люди — первая и главная секция страницы.
 *
 * Список ограничен по высоте, а не по числу загруженных строк: штат
 * организации приезжает целиком, поэтому поиск и счётчики отвечают за
 * ВЕСЬ штат, а не за первую страницу. Прокрутка живёт внутри списка,
 * иначе двадцать человек уводят роли и права на два экрана вниз.
 */
function PeopleSection({
  staff, roles, locations, settingsByLocation, shifts, loading,
  iAmOwner, narrow, sectionRef, onAdd, onChanged, onOpenHours,
}) {
  const [search, setSearch] = useState('')
  const [locationId, setLocationId] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [shown, setShown] = useState(PEOPLE_PAGE)

  const rows = useMemo(
    () => sortRoster(filterRoster(staff, { search, locationId, roles })),
    [staff, search, locationId, roles],
  )
  const counts = useMemo(() => rosterCounts(staff), [staff])

  const selected = (staff ?? []).find((s) => s.id === selectedId) || null
  const filtered = search.trim() !== '' || locationId !== ''

  // Телефон досматривает список по частям, десктоп прокручивает его
  // внутри панели: вложенная прокрутка на телефоне ловит палец и не
  // отпускает страницу.
  useEffect(() => { setShown(PEOPLE_PAGE) }, [search, locationId, narrow])
  const visible = narrow ? rows.slice(0, shown) : rows

  /** Строку владельца правит только владелец — сервер это тоже проверяет */
  function editable(member) {
    return member.role !== 'owner' || iAmOwner
  }

  return (
    <section
      className="tm-section"
      ref={sectionRef}
      tabIndex={-1}
      aria-labelledby="tm-people-title"
    >
      <div className="tm-section-head">
        <h2 id="tm-people-title">People</h2>
        {staff !== null && (
          <p className="tm-section-count">
            {counts.active} active · {counts.inactive} inactive
          </p>
        )}

        <div className="tm-toolbar">
          <SearchField
            label="Search the team"
            value={search}
            onChange={setSearch}
            placeholder="Search team"
            className="order-search tm-search"
          />

          {locations.length > 1 && (
            <label className="tm-select">
              <span className="visually-hidden">Location</span>
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">All locations</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
          )}

          {/* Сколько нашлось — только когда идёт отбор: у полного списка на
              этот вопрос уже отвечает счётчик под заголовком */}
          <p className="tm-count" role="status">
            {loading && !staff
              ? 'Loading…'
              : filtered
                ? `${rows.length} of ${counts.total}`
                : ''}
          </p>
        </div>
      </div>

      {staff === null ? (
        /* Таблица людей: имя, роль, статус, действия. */
        <Skeleton label="Loading the team…">
          <SkeletonPanel>
            {Array.from({ length: 5 }, (_, i) => (
              <SkeletonRow key={i} height={56} columns={['22%', '16%', '12%', '10%']} />
            ))}
          </SkeletonPanel>
        </Skeleton>
      ) : rows.length === 0 ? (
        <EmptyPanel
          icon={<Users />}
          title={filtered ? 'Nobody found' : 'No one on the team yet'}
          description={filtered
            ? 'No one matches this search. Try another name or clear the filter.'
            : 'Add the people who work the register. Each of them signs in with their own PIN.'}
          action={!filtered && locations.length > 0 && (
            <Button variant="primary" size="compact" onClick={onAdd}>
              <UserPlus aria-hidden /> Add person
            </Button>
          )}
        />
      ) : (
        <Panel className="tm-panel">
          {/* Прокручиваемая область названа и доступна с клавиатуры: без
              этого до строк за нижней границей не добраться Tab'ом */}
          <div
            className="tm-scroll"
            role={narrow ? undefined : 'region'}
            aria-label={narrow ? undefined : 'People'}
            tabIndex={!narrow && rows.length > 8 ? 0 : undefined}
          >
            <div className={`tm-list${locations.length > 1 ? ' has-location' : ''}`}>
              {/* Шапка скрыта от читалки: имя строки уже называет все
                  значения, и второй раз перечислять их незачем */}
              <div className="tm-head" aria-hidden="true">
                <span>Person</span>
                <span>Role</span>
                {locations.length > 1 && <span>Location</span>}
                <span>Access</span>
                <span>Last shift</span>
                <span>Status</span>
              </div>
              {visible.map((member) => {
                const role = roleOf(member, roles)
                return (
                  <PersonRow
                    key={member.id}
                    member={member}
                    role={role}
                    locations={locations}
                    access={accessSummary(member, role, settingsByLocation, locations)}
                    shift={shifts?.get(member.id)}
                    selected={member.id === selectedId}
                    onOpen={(m) => setSelectedId(m.id === selectedId ? null : m.id)}
                  />
                )
              })}
            </div>
          </div>

          {visible.length < rows.length && (
            <div className="tm-more">
              <Button size="compact" onClick={() => setShown((n) => n + PEOPLE_PAGE)}>
                Load more
              </Button>
              <span className="tm-more-count">{visible.length} of {rows.length}</span>
            </div>
          )}
        </Panel>
      )}

      {selected && (
        <PersonCard
          /* Ключ по человеку: панель немодальна, соседнюю строку открывают
             щелчком, и поля прошлой карточки не должны в ней досидеть */
          key={selected.id}
          member={selected}
          roles={roles ?? []}
          locations={locations}
          settingsByLocation={settingsByLocation}
          shift={shifts?.get(selected.id)}
          editable={editable(selected)}
          canAssignOwner={iAmOwner}
          onChanged={onChanged}
          onClose={() => setSelectedId(null)}
          onOpenHours={onOpenHours}
        />
      )}
    </section>
  )
}

// ── Доступ ───────────────────────────────────────────────────

/**
 * Редактор роли: имя и галочки, больше в роли ничего нет.
 *
 * Базового уровня в форме нет сознательно. Ни `require_staff_perm`
 * (094), ни `can()` кассы его при разрешении не читают — набор галочек
 * исчерпывающий, а второе поле про «уровень» читалось как ещё один
 * источник прав. `save_role` его требует аргументом, поэтому значение
 * едет прежнее (у новой роли — 'barista') и роль его не меняет.
 */
function RoleCard({ role, holders, onClose, onSaved }) {
  const isNew = !role.id
  const [name, setName] = useState(role.name || '')
  const base = role.base || 'barista'
  const [perms, setPerms] = useState(() => new Set(role.perms || []))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState(false)
  const diff = roleAccessDiff(role, [...perms], Array.from({ length: holders }))

  function toggle(key) {
    setPerms((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
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
      setError(staffErrorText(saveError.message))
      setBusy(false)
    }
  }

  async function confirmRemove() {
    setBusy(true)
    setError('')
    try {
      await deleteRole(role.id)
      onSaved()
    } catch (deleteError) {
      setError(staffErrorText(deleteError.message))
      setBusy(false)
      setRemoving(false)
    }
  }

  return (
    <>
      <Drawer
        labelledBy="tm-role-title"
        title={isNew ? 'New role' : role.name}
        subtitle={isNew
          ? 'A named set of actions you can hand to a person'
          : `${perms.size} of ${PERM_KEYS.length} actions · ${holders} ${holders === 1 ? 'person' : 'people'}`}
        onClose={onClose}
        modal={false}
      >
        <label className="qr-field">
          <span>Role name</span>
          <input value={name} maxLength={40} placeholder="Senior barista" onChange={(e) => setName(e.target.value)} />
        </label>

        <p className="tm-hint">
          A person with this role can do exactly what is ticked below and
          nothing else, whatever the location rules say. Managing the team,
          roles and settings always stays with owners and managers.
        </p>

        <section className="tm-block">
          <h4>Allowed actions</h4>
          <ul className="tm-checks">
            {PERM_KEYS.map((key) => (
              <li key={key}>
                <label className="check-field">
                  <input type="checkbox" checked={perms.has(key)} onChange={() => toggle(key)} />
                  <span>
                    {PERM_LABELS[key]}
                    <small>{PERM_HINTS[key]}</small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>

        {/*
          Что изменится, если сохранить. Набор роли исчерпывающий: снятая
          галочка отбирает действие у всех носителей, даже если точка
          разрешает его всем. Владелец должен увидеть это ДО сохранения,
          а не узнать от людей за прилавком.
        */}
        {diff.changed && (
          <section className="tm-effect" aria-live="polite">
            <h4>If you save this</h4>
            {diff.lost.length > 0 && (
              <p className="tm-effect-lose">
                <strong>{holders} {holders === 1 ? 'person loses' : 'people lose'}</strong>{' '}
                {diff.lost.map((p) => p.label).join(', ')}
              </p>
            )}
            {diff.gained.length > 0 && (
              <p className="tm-effect-gain">
                <strong>{holders} {holders === 1 ? 'person gains' : 'people gain'}</strong>{' '}
                {diff.gained.map((p) => p.label).join(', ')}
              </p>
            )}
            {holders === 0 && (
              <p className="tm-hint">Nobody has this role yet — nothing changes for anyone today.</p>
            )}
          </section>
        )}

        {error && <ErrorText>{error}</ErrorText>}

        <div className="tm-card-actions">
          <Button variant="primary" size="compact" disabled={!name.trim()} busy={busy} busyLabel="Saving…" onClick={save}>
            {isNew ? 'Create role' : 'Save role'}
          </Button>
          {!isNew && (
            <button type="button" className="text-button tm-remove" onClick={() => setRemoving(true)}>
              Delete role
            </button>
          )}
        </div>
      </Drawer>

      {removing && (
        <ConfirmDialog
          title={`Delete “${role.name}”?`}
          description={holders > 0
            ? `${holders} ${holders === 1 ? 'person goes' : 'people go'} back to the location rules for their level. Nobody loses access to the register.`
            : 'Nobody is using this role.'}
          confirmLabel="Delete role"
          tone="danger"
          error={error}
          busy={busy}
          onConfirm={confirmRemove}
          onCancel={() => setRemoving(false)}
        />
      )}
    </>
  )
}

/**
 * Кастомные роли — узкая колонка рядом с правами точки.
 *
 * Список компактный, а не карточками: роль опознают по имени и по тому,
 * сколько людей её носит, а полный набор действий живёт в редакторе.
 * Считать носителей можно только по полному штату — поэтому счётчики
 * берутся из общего списка, а не из видимой страницы.
 */
function RolesPanel({ roles, staff, narrow, sectionRef, onOpen }) {
  const [search, setSearch] = useState('')
  const [shown, setShown] = useState(ROLE_PAGE)

  const rows = useMemo(() => filterRoles(roles, search), [roles, search])
  useEffect(() => { setShown(ROLE_PAGE) }, [search, narrow])
  const visible = narrow ? rows.slice(0, shown) : rows
  const searchable = (roles?.length ?? 0) >= ROLE_SEARCH_FROM

  return (
    <section
      className="tm-section"
      ref={sectionRef}
      tabIndex={-1}
      aria-labelledby="tm-roles-title"
    >
      <Panel
        className="tm-roles-panel"
        titleId="tm-roles-title"
        title="Custom roles"
        description="A role is a fixed set of actions for one person — it replaces the location rules entirely."
        actions={(
          <Button size="compact" onClick={() => onOpen({})}>
            <Plus aria-hidden /> New role
          </Button>
        )}
      >
        {searchable && (
          <div className="tm-panel-toolbar">
            <SearchField
              label="Search roles"
              value={search}
              onChange={setSearch}
              placeholder="Search roles"
              className="order-search tm-search"
            />
          </div>
        )}

        {roles === null ? (
          <EmptyState>Loading…</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState>
            {search.trim()
              ? 'No role matches this search.'
              : `No custom roles yet. Create one to allow a single action — refunds for a
                 senior barista — without making someone a manager.`}
          </EmptyState>
        ) : (
          <>
            <div className="tm-scroll tm-scroll-roles">
              <div className="tm-roles">
                {visible.map((role) => {
                  const holders = roleHolders(staff, role.id)
                  const allowed = (role.perms ?? []).length
                  return (
                    <button
                      type="button"
                      className="tm-role-row"
                      key={role.id}
                      onClick={() => onOpen(role)}
                      aria-label={`Open role ${role.name} · ${allowed} of ${PERM_KEYS.length} actions · ${holders} people`}
                    >
                      <span className="tm-role-name">{role.name}</span>
                      <span className="tm-role-meta">
                        {allowed} of {PERM_KEYS.length} actions
                      </span>
                      <span className="tm-role-holders">
                        {holders > 0 ? `${holders} ${holders === 1 ? 'person' : 'people'}` : 'unused'}
                        <ChevronRight aria-hidden />
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {visible.length < rows.length && (
              <div className="tm-more">
                <Button size="compact" onClick={() => setShown((n) => n + ROLE_PAGE)}>
                  Load more
                </Button>
                <span className="tm-more-count">{visible.length} of {rows.length}</span>
              </div>
            )}
          </>
        )}
      </Panel>
    </section>
  )
}

/**
 * Права точки: девять действий, у каждого выбор из двух уровней.
 *
 * Переключатель отзывается сразу и откатывается, если сервер отказал:
 * право — это переключатель, а не форма, и ждать сети он не должен. Кого
 * задело последнее нажатие, написано ПОД той самой строкой и с возвратом
 * как было — искать объяснение в другом конце панели никто не станет.
 */
function PermissionsPanel({
  locations, roles, staff, settingsByLocation, sectionRef, onSettingsChanged,
}) {
  const [locationId, setLocationId] = useState(locations[0]?.id || '')
  const [saving, setSaving] = useState('')
  const [saved, setSaved] = useState('')
  const [error, setError] = useState('')
  // Что изменило последнее переключение: { key, from, to, effect }
  const [lastChange, setLastChange] = useState(null)

  const settings = settingsByLocation[locationId]
  const here = locations.find((l) => l.id === locationId) || null

  // «Saved» гаснет само: подпись, висящая до следующего нажатия, через
  // минуту уже врёт — она про то, чего человек не помнит.
  useEffect(() => {
    if (!saved) return undefined
    const timer = setTimeout(() => setSaved(''), 2500)
    return () => clearTimeout(timer)
  }, [saved])

  async function applyLevel(key, level) {
    const previous = permLevel(settings, key)
    setSaving(key)
    setError('')
    setSaved('')
    // Оптимистично: нажатие отзывается сразу, сеть догоняет
    onSettingsChanged(locationId, { [key]: level })
    try {
      await patchLocationSettings(locationId, { perms: { [key]: level } })
      setSaved(key)
    } catch (saveError) {
      // Сервер отказал — возвращаем то, что на нём и осталось
      onSettingsChanged(locationId, { [key]: previous })
      setLastChange(null)
      setError(staffErrorText(saveError.message))
    } finally {
      setSaving('')
    }
  }

  /**
   * Право меняется одним нажатием — так и должно быть, это переключатель,
   * а не форма. Но оно действует на людей, поэтому сразу после записи
   * кабинет говорит, на кого именно, и предлагает вернуть как было.
   *
   * Диалога подтверждения здесь нет намеренно: он превратил бы быстрый
   * переключатель в анкету. Объяснение постфактум с отменой честнее и
   * быстрее — ошибка стоит одного нажатия.
   */
  function setLevel(key, level) {
    const staffHere = (staff ?? []).filter((m) => !m.location_id || m.location_id === locationId)
    const effect = levelChangeEffect(key, level, staffHere, roles, settings)
    const from = permLevel(settings, key)
    applyLevel(key, level)
    setLastChange(effect.people.length > 0 ? { key, from, to: level, effect } : null)
  }

  return (
    <section
      className="tm-section"
      ref={sectionRef}
      tabIndex={-1}
      aria-labelledby="tm-perms-title"
    >
      <Panel
        className="tm-matrix-panel"
        titleId="tm-perms-title"
        title="Default register permissions"
        description="Applied to everyone without a custom role. Restricted actions ask for a manager PIN on the register."
        actions={(
          <div className="tm-panel-actions">
            {/* Одна точка себя не выбирает: селектор из одного пункта —
                это подпись, притворившаяся управлением */}
            {locations.length > 1 ? (
              <label className="tm-select">
                <span className="visually-hidden">Location</span>
                <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
            ) : here && <span className="tm-panel-where">{here.name}</span>}
            <span className="tm-panel-state" role="status">
              {saved && <><Check aria-hidden /> Saved</>}
            </span>
          </div>
        )}
      >
        {error && <ErrorText>{error}</ErrorText>}

        {!settings ? (
          <EmptyState>Loading…</EmptyState>
        ) : (
          <div className="tm-matrix">
            <div className="tm-matrix-head" aria-hidden="true">
              <span>Action</span>
              <span>Allowed for</span>
            </div>
            {PERM_KEYS.map((key) => {
              const level = permLevel(settings, key)
              return (
                <div className="tm-matrix-group" key={key}>
                  <div className="tm-matrix-row">
                    <span className="tm-matrix-name" id={`tm-perm-${key}`}>
                      {PERM_LABELS[key]}
                      <small>{PERM_HINTS[key]}</small>
                    </span>
                    {/* Выбор одного из двух, а не две независимые кнопки:
                        radiogroup говорит это читалке, а подпись называет
                        действие — иначе она читает подряд «Everyone,
                        Manager, Everyone, Manager». */}
                    <span className="perm-switch" role="radiogroup" aria-labelledby={`tm-perm-${key}`}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={level === 'all'}
                        aria-label={`${PERM_LABELS[key]}: everyone`}
                        className={level === 'all' ? 'is-active' : ''}
                        disabled={saving === key}
                        onClick={() => setLevel(key, 'all')}
                      >
                        Everyone
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={level === 'manager'}
                        aria-label={`${PERM_LABELS[key]}: manager and owner only`}
                        className={level === 'manager' ? 'is-active' : ''}
                        disabled={saving === key}
                        onClick={() => setLevel(key, 'manager')}
                      >
                        Manager
                      </button>
                    </span>
                  </div>

                  {/* Кого это задело — под той самой строкой, с возвратом
                      как было: объяснение в другом конце панели не читают */}
                  {lastChange?.key === key && (
                    <div className="tm-effect-live" role="status">
                      <span>
                        <strong>{lastChange.effect.label}</strong>
                        {lastChange.to === 'manager' ? ' — manager and owner only. ' : ' — everyone. '}
                        {lastChange.effect.people.join(', ')}
                        {lastChange.effect.people.length === 1 ? ' is affected' : ' are affected'}
                        {lastChange.effect.withOwnRole > 0
                          ? `; ${lastChange.effect.withOwnRole} with their own role ${lastChange.effect.withOwnRole === 1 ? 'is' : 'are'} not.`
                          : '.'}
                      </span>
                      <Button
                        size="compact"
                        disabled={saving === lastChange.key}
                        onClick={() => { applyLevel(lastChange.key, lastChange.from); setLastChange(null) }}
                      >
                        Undo
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Panel>
    </section>
  )
}

/**
 * Первая вкладка: люди, а под ними — правила, по которым им что-то можно.
 *
 * Одна загрузка на обе секции: роли нужны и колонке доступа в списке, и
 * панели ролей, и счётчику носителей — тянуть их дважды значит показать
 * два разных ответа на один вопрос.
 */
function PeopleAndAccess({
  staff, roles, locations, settingsByLocation, shifts, loading, iAmOwner,
  focus, onAdd, onChanged, onSettingsChanged, onOpenHours,
}) {
  const narrow = useNarrow()
  const [editing, setEditing] = useState(null)
  const peopleRef = useRef(null)
  const permsRef = useRef(null)
  const rolesRef = useRef(null)
  const focused = useRef(null)
  const [mobileAccess, setMobileAccess] = useState(() => (
    focus === 'roles' ? 'roles' : (focus === 'access' || focus === 'perms' ? 'permissions' : null)
  ))

  const ready = staff !== null && roles !== null

  useEffect(() => {
    if (!narrow || !focus) return
    if (focus === 'roles') setMobileAccess('roles')
    if (focus === 'access' || focus === 'perms') setMobileAccess('permissions')
  }, [focus, narrow])

  /*
   * Прежний адрес ведёт к своей секции.
   *
   * Подводим только когда секция уже отрисована с данными: до этого её
   * высота ещё меняется, и прокрутка попадёт мимо. Наведение делается
   * один раз на значение из адреса — иначе каждая перерисовка утаскивала
   * бы страницу обратно.
   */
  useEffect(() => {
    if (!focus || !ready || focused.current === focus) return
    const target = { access: permsRef, perms: permsRef, roles: rolesRef }[focus]?.current
    if (!target) return
    focused.current = focus
    target.scrollIntoView({ block: 'start', behavior: scrollBehavior() })
    target.focus({ preventScroll: true })
  }, [focus, ready, mobileAccess])

  const rolesPanel = (
    <RolesPanel
      roles={roles}
      staff={staff}
      narrow={narrow}
      sectionRef={rolesRef}
      onOpen={setEditing}
    />
  )
  const permissionsPanel = (
    <PermissionsPanel
      locations={locations}
      roles={roles}
      staff={staff}
      settingsByLocation={settingsByLocation}
      sectionRef={permsRef}
      onSettingsChanged={onSettingsChanged}
    />
  )

  return (
    <>
      <PeopleSection
        staff={staff}
        roles={roles}
        locations={locations}
        settingsByLocation={settingsByLocation}
        shifts={shifts}
        loading={loading}
        iAmOwner={iAmOwner}
        narrow={narrow}
        sectionRef={peopleRef}
        onAdd={onAdd}
        onChanged={onChanged}
        onOpenHours={onOpenHours}
      />

      {locations.length === 0 ? (
        <EmptyState>No locations are linked to this account.</EmptyState>
      ) : (
        <>
          {narrow ? (
            /*
             * Гармошка, а не список с общей полкой внизу: раскрытое
             * содержимое стоит сразу под своей строкой. Иначе роли
             * выезжали под «Default access» и читались как его часть.
             */
            <div className="tm-mobile-access" aria-label="Roles and access settings">
              <button
                type="button"
                aria-expanded={mobileAccess === 'roles'}
                onClick={() => setMobileAccess((current) => current === 'roles' ? null : 'roles')}
              >
                <span><strong>Custom roles</strong><small>{roles?.length ?? 0} configured</small></span>
                <ChevronRight aria-hidden />
              </button>
              {mobileAccess === 'roles' && rolesPanel}
              <button
                type="button"
                aria-expanded={mobileAccess === 'permissions'}
                onClick={() => setMobileAccess((current) => current === 'permissions' ? null : 'permissions')}
              >
                <span><strong>Default access</strong><small>{PERM_KEYS.length} actions per location</small></span>
                <ChevronRight aria-hidden />
              </button>
              {mobileAccess === 'permissions' && permissionsPanel}
            </div>
          ) : (
            <div className="tm-access-grid">
              {rolesPanel}
              {permissionsPanel}
            </div>
          )}
        </>
      )}

      {editing && (
        <RoleCard
          key={editing.id || 'new'}
          role={editing}
          holders={editing.id ? roleHolders(staff, editing.id) : 0}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged() }}
        />
      )}
    </>
  )
}

// ── Раздел ───────────────────────────────────────────────────

export default function TeamManager({ context, tab: tabFromUrl, onTabChange }) {
  const locations = useMemo(() => context.locations || [], [context.locations])
  const iAmOwner = context.member?.role === 'owner'
  const route = resolveTeamRoute(tabFromUrl)
  const tab = route.tab

  const [staff, setStaff] = useState(null)
  const [roles, setRoles] = useState(null)
  const [settingsByLocation, setSettings] = useState({})
  const [shifts, setShifts] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [hoursStaffId, setHoursStaffId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [nextStaff, nextRoles] = await Promise.all([fetchStaff(), fetchRoles()])
      setStaff(nextStaff)
      setRoles(nextRoles)
    } catch (loadError) {
      setError(staffErrorText(loadError.message))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  /*
   * Настройки всех точек, а не выбранной: колонка «Access» считается для
   * точки КАЖДОГО человека, и одной локацией её не собрать. Точек у
   * организации единицы — это не выборка, а справочник.
   */
  useEffect(() => {
    let alive = true
    Promise.all(locations.map((l) => fetchLocation(l.id).then(
      (data) => [l.id, data.settings || {}],
      // Настройки одной точки не должны ронять раздел: без них
      // применяются дефолты, те же, что на сервере
      () => [l.id, {}],
    )))
      .then((pairs) => { if (alive) setSettings(Object.fromEntries(pairs)) })
    return () => { alive = false }
  }, [locations])

  /*
   * Последняя смена и «на смене сейчас» — из отчёта часов за месяц. Это
   * подсказка, а не содержимое раздела: не приехала — колонка молчит
   * прочерком, список работает.
   */
  useEffect(() => {
    let alive = true
    const to = new Date()
    const from = new Date()
    from.setDate(from.getDate() - SHIFT_WINDOW_DAYS)
    fetchHours({ from, to })
      .then((report) => { if (alive) setShifts(shiftIndex(report)) })
      .catch(() => { if (alive) setShifts(new Map()) })
    return () => { alive = false }
  }, [])

  /*
   * Уходя из табеля, забываем, кого в нём открывали: иначе владелец,
   * заглянувший в часы Даны неделю назад, получит её карточку в лицо при
   * следующем заходе в раздел.
   */
  useEffect(() => { if (tab !== 'hours') setHoursStaffId(null) }, [tab])

  /** Правку прав держим в общем состоянии: её видит и колонка доступа */
  function applySettings(locationId, permPatch) {
    setSettings((prev) => ({
      ...prev,
      [locationId]: {
        ...(prev[locationId] || {}),
        perms: { ...(prev[locationId]?.perms || {}), ...permPatch },
      },
    }))
  }

  function openHours(staffId) {
    setHoursStaffId(staffId)
    onTabChange('hours')
  }

  return (
    <>
      <PageHeader
        title="Team"
        actions={tab === 'people' && (
          <Button
            variant="primary"
            size="compact"
            disabled={locations.length === 0}
            onClick={() => setAdding(true)}
          >
            <UserPlus aria-hidden /> Add person
          </Button>
        )}
      />

      <Tabs
        label="Team section"
        className="menu-tabs location-tabs"
        items={TABS}
        value={tab}
        onChange={onTabChange}
      />

      {error && <ErrorText>{error}</ErrorText>}

      {tab === 'people' && (
        <PeopleAndAccess
          staff={staff}
          roles={roles}
          locations={locations}
          settingsByLocation={settingsByLocation}
          shifts={shifts}
          loading={loading}
          iAmOwner={iAmOwner}
          focus={route.focus}
          onAdd={() => setAdding(true)}
          onChanged={load}
          onSettingsChanged={applySettings}
          onOpenHours={openHours}
        />
      )}

      {/* Часы стоят в «Команде», а не отдельным разделом: их открывают о
          том же человеке, что и карточку сотрудника, и в один клик от неё */}
      {tab === 'hours' && <HoursManager context={context} initialStaffId={hoursStaffId} />}

      {adding && (
        <AddPersonDialog
          locations={locations}
          roles={roles ?? []}
          canAssignOwner={iAmOwner}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); load() }}
        />
      )}
    </>
  )
}
