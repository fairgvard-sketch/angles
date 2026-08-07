import { useEffect, useRef, useState } from 'react'
import {
  Building2, CircleHelp, LogOut, Menu as MenuIcon, MoreHorizontal, UserRound, X,
} from 'lucide-react'
import { IconButton } from './Button'

/**
 * Рабочая оболочка кабинета: сайдбар, шапка и область содержимого.
 *
 * Раньше всё это жило внутри `App.jsx` вместе с маршрутизацией, загрузкой
 * контекста, онбордингом и экраном входа — полторы тысячи строк, где
 * навигация и данные правились в одном файле. Оболочка обязана быть
 * стабильной: она не перемонтируется при смене раздела, и её поведение
 * (фокус, шторка, Escape) не должно зависеть от того, какой раздел
 * открыт.
 */

export function Brand({ compact = false }) {
  return (
    <a className="brand" href="/" aria-label="ANGLE home">
      <img src="/favicon.png" alt="" />
      {!compact && <span>ANGLE</span>}
    </a>
  )
}

/**
 * Меню аккаунта: Account, Help и выход живут у имени владельца, а не
 * среди операционных разделов — их ищут у своего имени.
 */
function AccountMenu({ email, active, onNavigate, onHelp, onSignOut, onClose }) {
  const ref = useRef(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return undefined
    function onDocClick(event) {
      if (!ref.current?.contains(event.target)) setOpen(false)
    }
    function onKey(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function pick(action) {
    setOpen(false)
    onClose()
    action()
  }

  return (
    <div className="account-menu" ref={ref}>
      <button
        type="button"
        className={`account-chip${open ? ' is-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="avatar">{email?.slice(0, 1).toUpperCase() || 'A'}</span>
        <span className="account-email">{email}</span>
        <MoreHorizontal />
      </button>
      {open && (
        <div className="account-popover" role="menu">
          <button
            type="button"
            role="menuitem"
            className={active === 'settings' ? 'active' : ''}
            onClick={() => pick(() => onNavigate('settings'))}
          >
            <UserRound /><span>Account</span>
          </button>
          <button type="button" role="menuitem" onClick={() => pick(onHelp)}>
            <CircleHelp /><span>Help</span>
          </button>
          <button type="button" role="menuitem" className="is-danger" onClick={() => pick(onSignOut)}>
            <LogOut /><span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Сайдбар и он же — полноэкранная шторка на телефоне.
 *
 * Что здесь важно и почему:
 *   • список разделов прокручивается сам, а не вместе со страницей —
 *     иначе на 390px последние группы оказываются под футером аккаунта;
 *   • у прокрутки есть край-подсказка (CSS-тень), иначе владелец не
 *     догадывается, что ниже есть ещё разделы;
 *   • открытие уводит фокус в шторку, закрытие возвращает его на бургер:
 *     иначе клавиатурный пользователь после закрытия оказывается в
 *     начале документа;
 *   • Escape закрывает — это ожидаемое поведение любого оверлея.
 */
function Sidebar({
  nav, icons, active, onNavigate, open, onClose, onHelp, onSignOut, email, closeRef,
}) {
  const go = (id) => { onNavigate(id); onClose() }

  useEffect(() => {
    if (!open) return undefined
    /*
     * Фокус переводим через два кадра, а не сразу. Шторка выезжает
     * трансформом и в закрытом состоянии стоит `visibility: hidden`; в
     * момент эффекта класс уже проставлен, но стиль ещё не пересчитан, а
     * `focus()` по скрытому элементу молча ничего не делает — фокус
     * оставался на бургере, и клавиатурный пользователь открывал меню,
     * не попадая в него.
     */
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => closeRef.current?.focus())
    })
    function onKey(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, closeRef])

  const item = ({ id, label }) => {
    const Icon = icons[id]
    return (
      <button
        key={id}
        type="button"
        className={active === id ? 'active' : ''}
        aria-current={active === id ? 'page' : undefined}
        onClick={() => go(id)}
      >
        {Icon && <Icon />}
        <span>{label}</span>
      </button>
    )
  }

  return (
    <>
      {open && <button className="drawer-scrim" aria-label="Close navigation" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'is-open' : ''}`} id="app-navigation">
        <div className="sidebar-top">
          <Brand />
          <div className="sidebar-top-actions">
            <IconButton
              className="sidebar-mobile-action"
              label="Help"
              onClick={() => { onHelp(); onClose() }}
            >
              <CircleHelp />
            </IconButton>
            <IconButton className="sidebar-close" onClick={onClose} label="Close navigation" ref={closeRef}>
              <X />
            </IconButton>
          </div>
        </div>
        <nav className="side-nav" aria-label="Back office">
          {nav.primary.map(item)}
          {nav.groups.map((group) => (
            <div className="side-nav-group" key={group.id} role="group" aria-labelledby={`nav-${group.id}`}>
              <p className="side-nav-title" id={`nav-${group.id}`}>{group.label}</p>
              {group.items.map(item)}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <AccountMenu
            email={email}
            active={active}
            onNavigate={onNavigate}
            onHelp={onHelp}
            onSignOut={onSignOut}
            onClose={onClose}
          />
        </div>
      </aside>
    </>
  )
}

/**
 * Выбранная точка. Одна на кабинет и показывается только там, где от неё
 * зависят данные: в Team или Customers она обещала бы фильтрацию,
 * которой нет.
 */
function LocationPicker({ locations, locationId, onChange }) {
  const current = locations.find((l) => l.id === locationId)
  if (locations.length === 0) return null
  if (locations.length === 1) {
    return <span className="topbar-location is-single"><Building2 /> {current?.name ?? locations[0].name}</span>
  }
  return (
    <label className="topbar-location">
      <Building2 aria-hidden />
      <span className="visually-hidden">Location</span>
      <select value={locationId ?? ''} onChange={(event) => onChange(event.target.value)}>
        {locations.map((location) => (
          <option key={location.id} value={location.id}>{location.name}</option>
        ))}
      </select>
    </label>
  )
}

export default function AppShell({
  nav, icons, view, onNavigate, email, onSignOut, onHelp,
  organization, role, isDeveloper, locations, locationId, onLocationChange, scoped,
  children,
}) {
  const [drawer, setDrawer] = useState(false)
  const menuRef = useRef(null)
  const closeRef = useRef(null)
  const wasOpen = useRef(false)

  /**
   * Смена раздела — событие, которого не видно без экрана. Мышью её
   * подтверждает сама страница, с читалкой не подтверждает ничто:
   * содержимое подменяется молча, и фокус остаётся на пункте меню.
   *
   * Объявляем название нового раздела вежливой живой областью. Первый
   * показ пропускаем: страницу читалка и так только что прочитала, и
   * второе «Dashboard» подряд — шум.
   */
  const [announcement, setAnnouncement] = useState('')
  const firstView = useRef(true)
  const label = [...nav.primary, ...nav.groups.flatMap((g) => g.items)]
    .find((item) => item.id === view)?.label
  useEffect(() => {
    if (firstView.current) {
      firstView.current = false
      return
    }
    setAnnouncement(label || '')
  }, [view, label])

  // Назад/Вперёд меняют раздел мимо клика по пункту — шторку всё равно
  // закрываем, иначе она остаётся поверх нового экрана.
  useEffect(() => { setDrawer(false) }, [view])

  // Полноэкранное меню открыто — фон под ним не скроллится
  useEffect(() => {
    if (!drawer) {
      // Возвращаем фокус на бургер, но только если шторка правда была
      // открыта: иначе первый рендер утащит фокус у формы.
      if (wasOpen.current) menuRef.current?.focus()
      wasOpen.current = false
      return undefined
    }
    wasOpen.current = true
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [drawer])

  return (
    <div className="app-shell">
      {/*
        Первая остановка клавиатуры во всём кабинете. До неё до рабочей
        области доходили за 16–17 нажатий Tab: сначала логотип, потом
        все тринадцать разделов, потом меню аккаунта — и так на КАЖДОМ
        экране, включая возврат из формы.
      */}
      <a className="skip-link" href="#app-content">Skip to content</a>
      <Sidebar
        nav={nav}
        icons={icons}
        active={view}
        onNavigate={onNavigate}
        open={drawer}
        onClose={() => setDrawer(false)}
        onHelp={onHelp}
        onSignOut={onSignOut}
        email={email}
        closeRef={closeRef}
      />
      <div className="app-main">
        <header className="topbar">
          <IconButton
            className="mobile-menu"
            onClick={() => setDrawer(true)}
            label="Open navigation"
            aria-expanded={drawer}
            aria-controls="app-navigation"
            ref={menuRef}
          >
            <MenuIcon />
          </IconButton>
          <div className="topbar-context">
            <span>{organization}</span>
            <small>{role}</small>
            {isDeveloper && <span className="developer-badge">Developer workspace</span>}
          </div>
          {scoped && (
            <LocationPicker locations={locations} locationId={locationId} onChange={onLocationChange} />
          )}
        </header>
        {/* tabIndex=-1: без него переход по «Skip to content» двигает
            только прокрутку, а фокус остаётся в шапке — следующий Tab
            возвращает в меню. */}
        <main className="content" id="app-content" tabIndex={-1}>{children}</main>
        <p className="visually-hidden" role="status" aria-live="polite">{announcement}</p>
      </div>
    </div>
  )
}
