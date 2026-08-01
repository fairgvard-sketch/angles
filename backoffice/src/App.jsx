import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  BarChart3,
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  CircleHelp,
  Copy,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  MonitorSmartphone,
  MoreHorizontal,
  QrCode,
  Settings,
  ShoppingBag,
  Store,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { isSupabaseConfigured, supabase } from './supabase'
import {
  NAV_ITEMS, hasCapability, productState, visibleNavigation,
} from './navigation'
import SalesOverview from './SalesOverview'
import LocationSettings from './LocationSettings'
import MenuManager from './MenuManager'
import TeamManager from './TeamManager'
import QrChannels from './QrChannels'
import OrdersInbox from './OrdersInbox'
import ReservationsDesk from './ReservationsDesk'
import DevicesManager from './DevicesManager'
import GuestsManager from './GuestsManager'
import ActivityManager, { ActivityCard } from './ActivityManager'

/**
 * Иконки разделов. Список разделов и правила видимости живут в
 * `navigation.js` (чистый модуль под тесты), здесь — только оформление.
 */
const NAV_ICONS = {
  overview: LayoutDashboard,
  orders: ShoppingBag,
  reservations: CalendarDays,
  sales: BarChart3,
  activity: Activity,
  locations: Store,
  menu: MenuIcon,
  team: Users,
  guests: UserRound,
  online: QrCode,
  devices: MonitorSmartphone,
  reports: BarChart3,
  integrations: CreditCard,
}

function Brand({ compact = false }) {
  return (
    <a className="brand" href="/" aria-label="ANGLE home">
      <img src="/favicon.png" alt="" />
      {!compact && <span>ANGLE</span>}
    </a>
  )
}

function SignIn() {
  // mode: signin | signup. Регистрация — вход в digital-only онбординг (100):
  // владелец без POS создаёт аккаунт сам, дальше Onboarding спрашивает цель.
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    if (mode === 'signin') {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) setError(signInError.message)
    } else {
      const { data, error: signUpError } = await supabase.auth.signUp({ email, password })
      if (signUpError) {
        setError(signUpError.message)
      } else if (!data.session) {
        // Подтверждение почты включено: сессии ещё нет, онбординг — после клика в письме.
        setNotice('Check your inbox and confirm the email, then sign in to continue.')
        setMode('signin')
      }
      // Если сессия есть — onAuthStateChange поднимет App, дальше Onboarding.
    }
    setBusy(false)
  }

  const isSignup = mode === 'signup'
  return (
    <div className="auth-shell">
      <header className="auth-header"><Brand /></header>
      <main className="auth-main">
        <section className="auth-panel" aria-labelledby="sign-in-title">
          <p className="eyebrow">BACK OFFICE</p>
          <h1 id="sign-in-title">{isSignup ? 'Create account' : 'Sign in'}</h1>
          <p className="auth-intro">
            {isSignup
              ? 'Publish a menu, take orders and reservations — no terminal required.'
              : 'Manage your locations, team and online channels.'}
          </p>
          <form onSubmit={submit} className="auth-form">
            <label>
              <span>Email</span>
              <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </label>
            <label>
              <span>Password</span>
              <input
                type="password"
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={6}
              />
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            {notice && <p className="form-hint" role="status">{notice}</p>}
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? (isSignup ? 'Creating…' : 'Signing in…') : 'Continue'}
            </button>
          </form>
          <p className="auth-footnote">
            {isSignup ? (
              <>Already with ANGLE? <a href="#signin" onClick={(e) => { e.preventDefault(); setMode('signin'); setError('') }}>Sign in</a></>
            ) : (
              <>New to ANGLE? <a href="#signup" onClick={(e) => { e.preventDefault(); setMode('signup'); setError('') }}>Create an account</a></>
            )}
          </p>
        </section>
      </main>
    </div>
  )
}

// ── Digital-only онбординг (100) ─────────────────────────────
/**
 * Аккаунт без организации: спрашиваем ЦЕЛЬ клиента, не настройку терминала
 * (продуктовое требование standalone-модулей). Выбранные цели уходят в
 * bootstrap_digital_org: RPC создаёт org+точку+членство и пишет org_id в
 * app_metadata; 'pos' сервер отбрасывает — POS подключается на терминале.
 */
const ONBOARDING_GOALS = [
  { id: 'menu', title: 'Publish menu', detail: 'A QR menu guests open on their phones or on your website.' },
  { id: 'online_orders', title: 'Accept orders', detail: 'Pickup and dine-in orders straight from the QR menu.' },
  { id: 'reservations', title: 'Take reservations', detail: 'Table booking requests from your guests.' },
]

function Onboarding({ email }) {
  const [selected, setSelected] = useState(new Set(['menu']))
  const [orgName, setOrgName] = useState('')
  const [locationName, setLocationName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function toggleGoal(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        if (next.size > 1) next.delete(id) // хотя бы одна цель остаётся
      } else {
        next.add(id)
      }
      return next
    })
  }

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const { error: rpcError } = await supabase.rpc('bootstrap_digital_org', {
      p_org_name: orgName.trim(),
      p_location_name: locationName.trim() || orgName.trim(),
      p_products: Array.from(selected),
    })
    if (rpcError) {
      setError(rpcError.message)
      setBusy(false)
      return
    }
    // org_id уже в app_metadata на сервере — обновляем JWT; TOKEN_REFRESHED
    // в App перезагрузит контекст и откроет кабинет.
    const { error: refreshError } = await supabase.auth.refreshSession()
    if (refreshError) setError(refreshError.message)
    setBusy(false)
  }

  return (
    <div className="auth-shell">
      <header className="auth-header"><Brand /></header>
      <main className="auth-main">
        <section className="auth-panel" aria-labelledby="onboarding-title">
          <p className="eyebrow">WELCOME</p>
          <h1 id="onboarding-title">What do you want to do?</h1>
          <p className="auth-intro">Pick everything that applies — you can add more later.</p>
          <form onSubmit={submit} className="auth-form">
            <div className="goal-grid">
              {ONBOARDING_GOALS.map((goal) => {
                const isSelected = selected.has(goal.id)
                return (
                  <button
                    type="button"
                    key={goal.id}
                    className={`goal-card ${isSelected ? 'is-selected' : ''}`}
                    aria-pressed={isSelected}
                    onClick={() => toggleGoal(goal.id)}
                  >
                    <span className="goal-check" aria-hidden>{isSelected && <Check />}</span>
                    <span>
                      <strong>{goal.title}</strong>
                      <small>{goal.detail}</small>
                    </span>
                  </button>
                )
              })}
              <div className="goal-card" aria-disabled>
                <span className="goal-check" aria-hidden />
                <span>
                  <strong>Use ANGLE POS</strong>
                  <small>The register is set up on the terminal itself and connects to this same account later.</small>
                </span>
              </div>
            </div>
            <label>
              <span>Business name</span>
              <input value={orgName} onChange={(event) => setOrgName(event.target.value)} required maxLength={120} />
            </label>
            <label>
              <span>Location name</span>
              <input
                value={locationName}
                onChange={(event) => setLocationName(event.target.value)}
                placeholder={orgName.trim() || 'Same as business name'}
                maxLength={120}
              />
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button" type="submit" disabled={busy || !orgName.trim()}>
              {busy ? 'Setting up…' : 'Create workspace'}
            </button>
          </form>
          <p className="auth-footnote">Signed in as {email} · <a href="#signout" onClick={(e) => { e.preventDefault(); supabase.auth.signOut() }}>Sign out</a></p>
        </section>
      </main>
    </div>
  )
}

/**
 * Панель помощи (Phase 1).
 *
 * До неё кнопка Help была нарисована в двух местах и не делала ничего.
 * Содержимое — только то, что действительно есть: шаги настройки ведут в
 * существующие разделы по capabilities, а диагностика копируется одной
 * кнопкой, чтобы владельцу не пришлось искать id организации в консоли.
 */
const HELP_STEPS = [
  {
    view: 'menu',
    capability: 'catalog_manage',
    title: 'Fill in the catalogue',
    detail: 'Categories, items, sizes and modifiers. Everything else reads from here.',
  },
  {
    view: 'online',
    capability: 'public_menu',
    title: 'Publish the guest menu',
    detail: 'Short link, QR code and the snippet for your own website.',
  },
  {
    view: 'orders',
    capability: 'orders_desk',
    title: 'Take online orders',
    detail: 'Turn ordering on, pick fulfilment types and watch the inbox.',
  },
  {
    view: 'reservations',
    capability: 'reservations_desk',
    title: 'Open table bookings',
    detail: 'Zones and tables, weekly schedule, then the launch checklist.',
  },
  {
    view: 'team',
    capability: 'pos_operate',
    title: 'Set up the team and registers',
    detail: 'Roles and PINs for staff, connected devices and their health.',
  },
]

function HelpPanel({ context, email, onNavigate, onClose }) {
  const closeRef = useRef(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    closeRef.current?.focus()
    function onKey(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const locations = context.locations || []
  const diagnostics = [
    `Organisation: ${context.organization?.name || '—'} (${context.organization?.id || '—'})`,
    `Account: ${email}`,
    `Role: ${context.member?.role || '—'}`,
    ...locations.map((l) => `Location: ${l.name} (${l.id})`),
    `Products: ${(context.products || []).join(', ') || '—'}`,
  ].join('\n')

  async function copyDiagnostics() {
    try {
      await navigator.clipboard.writeText(diagnostics)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  const steps = HELP_STEPS.filter((step) => hasCapability(context, step.capability))

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet help-sheet"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
      >
        <div className="help-head">
          <h3 id="help-title">Help</h3>
          <button
            type="button"
            className="icon-button"
            aria-label="Close help"
            onClick={onClose}
            ref={closeRef}
          >
            <X />
          </button>
        </div>

        {steps.length > 0 && (
          <div className="sheet-section">
            <span className="sheet-section-title">Setting up</span>
            <div className="help-list">
              {steps.map((step) => (
                <button
                  key={step.view}
                  type="button"
                  className="help-step"
                  onClick={() => { onNavigate(step.view); onClose() }}
                >
                  <span>
                    <strong>{step.title}</strong>
                    <small>{step.detail}</small>
                  </span>
                  <ChevronRight />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="sheet-section">
          <span className="sheet-section-title">Your details</span>
          <pre className="help-diagnostics">{diagnostics}</pre>
          <button type="button" className="secondary-button" onClick={copyDiagnostics}>
            {copied ? <><Check /> Copied</> : <><Copy /> Copy these details</>}
          </button>
          <p className="form-hint">
            Send these details to your ANGLE contact when something needs looking
            at — they identify the workspace without any personal data.
          </p>
        </div>

        <button type="button" className="secondary-button" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}

function Sidebar({ items, active, onNavigate, open, onClose, onHelp, email }) {
  function openSettings() {
    onNavigate('settings')
    onClose()
  }

  return (
    <>
      {open && <button className="drawer-scrim" aria-label="Close navigation" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'is-open' : ''}`}>
        <div className="sidebar-top">
          <Brand />
          <div className="sidebar-top-actions">
            <button
              className="icon-button sidebar-mobile-action"
              aria-label="Help"
              onClick={() => { onHelp(); onClose() }}
            >
              <CircleHelp />
            </button>
            <button className="icon-button sidebar-mobile-action" aria-label="Settings" onClick={openSettings}><Settings /></button>
            <button className="icon-button sidebar-close" onClick={onClose} aria-label="Close navigation"><X /></button>
          </div>
        </div>
        <nav className="side-nav" aria-label="Back office">
          {items.map(({ id, label }) => {
            const Icon = NAV_ICONS[id]
            return (
              <button key={id} className={active === id ? 'active' : ''} onClick={() => { onNavigate(id); onClose() }}>
                {Icon && <Icon />}
                <span>{label}</span>
              </button>
            )
          })}
        </nav>
        <div className="sidebar-bottom">
          <button onClick={() => { onHelp(); onClose() }}><CircleHelp /><span>Help</span></button>
          <button className={active === 'settings' ? 'active' : ''} onClick={openSettings}><Settings /><span>Settings</span></button>
          <div className="account-chip">
            <span className="avatar">{email?.slice(0, 1).toUpperCase() || 'A'}</span>
            <span className="account-email">{email}</span>
            <MoreHorizontal />
          </div>
        </div>
      </aside>
    </>
  )
}

function Stat({ label, value, detail, icon: Icon }) {
  return (
    <div className="stat-card">
      <div className="stat-icon"><Icon /></div>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
        <div className="stat-detail">{detail}</div>
      </div>
    </div>
  )
}

/**
 * Карточка продуктов (100/104/105): жизненный цикл каждой карточки —
 * Active / Developer / Included with ANGLE Orders / Pending activation /
 * Available as add-on. Биллинга нет: «запросить» создаёт заявку
 * (request_product_activation), активирует оператор ANGLE. Карточка —
 * маркетинг/UX-состояние; настоящие запреты живут на сервере
 * (module_disabled).
 */
const PRODUCT_META = [
  { id: 'menu', label: 'ANGLE Menu', detail: 'QR menu for phones and your website' },
  { id: 'online_orders', label: 'ANGLE Orders', detail: 'Online orders without a register' },
  { id: 'reservations', label: 'ANGLE Reserve', detail: 'Table bookings and host desk' },
  { id: 'pos', label: 'ANGLE POS', detail: 'The register, shifts and receipts' },
]

function ProductRow({ context, product, onReloadContext }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const state = productState(context, product.id)

  async function requestActivation() {
    setBusy(true)
    setError('')
    const { error: rpcError } = await supabase.rpc('request_product_activation', {
      p_product: product.id,
    })
    if (rpcError) {
      setError(rpcError.message)
      setBusy(false)
      return
    }
    await onReloadContext?.()
    setBusy(false)
  }

  const isOn = state === 'active' || state === 'developer' || state === 'included'
  return (
    <div className={`product-row ${isOn ? 'is-active' : ''}`}>
      <span>
        <strong>{product.label}</strong>
        <small>{product.detail}</small>
        {error && <small className="form-error">{error}</small>}
      </span>
      {state === 'active' && <span className="status"><i /> Active</span>}
      {state === 'developer' && <span className="status status-developer"><i /> Developer</span>}
      {state === 'included' && <span className="status">Included with ANGLE Orders</span>}
      {state === 'pending' && <span className="status status-pending"><i /> Pending activation</span>}
      {state === 'addon' && (
        <button className="text-button" onClick={requestActivation} disabled={busy}>
          {busy ? 'Requesting…' : 'Available as add-on — request'}
        </button>
      )}
    </div>
  )
}

function ProductsCard({ context, onReloadContext }) {
  if (!Array.isArray(context?.products)) return null
  return (
    <section className="panel form-panel">
      <div className="panel-heading">
        <div><h2>Your products</h2><p>Modules enabled for this organisation. Everything shares one catalogue and account.</p></div>
      </div>
      <div className="product-list">
        {PRODUCT_META.map((product) => (
          <ProductRow key={product.id} context={context} product={product} onReloadContext={onReloadContext} />
        ))}
      </div>
    </section>
  )
}

/**
 * Стабильный экран «Choose a product / Pending activation» (104):
 * организация без активного продукта — валидное состояние (заявка ждёт
 * оператора), а не сломанный кабинет. Операционные разделы не рендерим.
 */
function ActivationHome({ context, onReloadContext }) {
  const requests = Array.isArray(context?.product_requests) ? context.product_requests : []
  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">YOUR BUSINESS</p>
        <h1>{context.organization?.name || 'ANGLE business'}</h1>
        <p>
          {requests.length > 0
            ? 'Your workspace is ready. The ANGLE team is activating your products — this usually takes less than a business day.'
            : 'Your workspace is ready. Choose a product to get started.'}
        </p>
      </section>
      <ProductsCard context={context} onReloadContext={onReloadContext} />
    </>
  )
}

function Overview({ context, onNavigate, onReloadContext }) {
  const counts = context.counts || {}
  const locations = context.locations || []
  // Capabilities (105): menu-only клиенту не показываем staff/девайсы/кассу.
  const pos = hasCapability(context, 'pos_operate')
  const catalog = hasCapability(context, 'catalog_manage')
  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">YOUR BUSINESS</p>
        <h1>{context.organization?.name || 'ANGLE business'}</h1>
        <p>{pos
          ? 'Everything that configures and supports your POS, in one place.'
          : 'Your menu, guest pages and settings, in one place.'}</p>
      </section>

      <section className="stats-grid" aria-label="Business overview">
        <Stat icon={Store} label="Locations" value={counts.locations ?? 0} detail="Business locations" />
        {pos && <Stat icon={Users} label="Team" value={counts.staff ?? 0} detail="Active staff profiles" />}
        {pos && <Stat icon={MonitorSmartphone} label="Devices" value={counts.devices ?? 0} detail="Connected POS devices" />}
      </section>

      <div className="overview-grid">
        <section className="panel location-panel">
          <div className="panel-heading">
            <div><h2>Locations</h2><p>Configuration shared with every connected register.</p></div>
            <button className="text-button" onClick={() => onNavigate('locations')}>View all <ChevronRight /></button>
          </div>
          <div className="location-list">
            {locations.map((location) => (
              <button className="location-row" key={location.id} onClick={() => onNavigate('locations')}>
                <span className="location-mark"><Building2 /></span>
                <span><strong>{location.name}</strong><small>{location.timezone} · {location.currency}</small></span>
                <span className="status"><i /> Active</span>
                <ChevronRight />
              </button>
            ))}
            {locations.length === 0 && <p className="empty-state">No locations are linked to this account.</p>}
          </div>
        </section>

        <section className="panel quick-panel">
          <div className="panel-heading"><div><h2>Quick access</h2><p>Common owner tasks.</p></div></div>
          <div className="quick-list">
            {hasCapability(context, 'pos_reports') && <button onClick={() => onNavigate('sales')}><BarChart3 /><span><strong>Sales overview</strong><small>Revenue, orders and top items</small></span><ChevronRight /></button>}
            {catalog && <button onClick={() => onNavigate('menu')}><MenuIcon /><span><strong>Menu & catalogue</strong><small>Prices, items and modifiers</small></span><ChevronRight /></button>}
            <button onClick={() => onNavigate('online')}><QrCode /><span><strong>QR menu</strong><small>Guest link, ordering and table booking</small></span><ChevronRight /></button>
            {pos && <button onClick={() => onNavigate('team')}><Users /><span><strong>Team access</strong><small>Roles, PINs and permissions</small></span><ChevronRight /></button>}
          </div>
        </section>
      </div>

      <ProductsCard context={context} onReloadContext={onReloadContext} />

      {pos && <ActivityCard onNavigate={onNavigate} />}
    </>
  )
}

/**
 * Раздел, которого ещё нет (Phase 1).
 *
 * Reports и Integrations выглядели как работающие модули, а открывали
 * пустую панель с текстом про POS. Клиентским аккаунтам их больше не
 * показывают (`navigation.js`), developer видит честное «в планах» и то,
 * чем пользоваться сейчас.
 */
const PLANNED_SECTIONS = {
  reports: {
    summary: 'Cross-location reporting beyond what Overview already shows.',
    instead: { view: 'sales', label: 'Overview', detail: 'Revenue, orders and top items for a period.' },
  },
  integrations: {
    summary: 'Payments, accounting and connected business tools.',
    instead: null,
  },
}

function SectionPage({ section, context, onNavigate }) {
  const item = NAV_ITEMS.find((entry) => entry.id === section) || NAV_ITEMS[0]
  const Icon = NAV_ICONS[item.id]
  const planned = PLANNED_SECTIONS[section]
  return (
    <>
      <section className="page-heading compact-heading">
        <p className="eyebrow">{context.organization?.name}</p>
        <h1>{item.label}</h1>
        <p>{planned?.summary}</p>
      </section>
      <section className="section-placeholder panel">
        <span className="section-icon"><Icon /></span>
        <div>
          <h2>Not built yet</h2>
          <p>
            This module is planned and is visible only in the developer
            workspace. Nothing here is available to customer accounts, and no
            data is collected for it.
          </p>
          {planned?.instead && (
            <button className="text-button" onClick={() => onNavigate(planned.instead.view)}>
              Use {planned.instead.label} meanwhile <ChevronRight />
            </button>
          )}
        </div>
      </section>
    </>
  )
}

function AccountSettingsPage({ email, onSignOut }) {
  return (
    <>
      <section className="page-heading compact-heading">
        <p className="eyebrow">ACCOUNT</p>
        <h1>Settings</h1>
        <p>Manage your back-office account and session.</p>
      </section>
      <section className="panel account-settings-panel">
        <div className="account-settings-copy">
          <h2>Account</h2>
          <p>{email}</p>
        </div>
        <button className="secondary-button" onClick={onSignOut}><LogOut /> Sign out</button>
      </section>
    </>
  )
}

function Dashboard({ session, context, onReloadContext }) {
  const [active, setActive] = useState('overview')
  const [drawer, setDrawer] = useState(false)
  const [help, setHelp] = useState(false)
  // Организация без активного продукта (104): стабильный экран выбора/
  // ожидания активации вместо пустых операционных разделов.
  const noProducts = Array.isArray(context.products) && context.products.length === 0
  // Capabilities (105): скрытая секция недостижима и из state (например,
  // после перезагрузки контекста) — молча возвращаем на Home.
  const nav = noProducts
    ? NAV_ITEMS.filter(({ id }) => id === 'overview')
    : visibleNavigation(context)
  const activeSection = active === 'settings' || nav.some((item) => item.id === active) ? active : 'overview'
  const isDeveloper = context.account_type === 'developer'

  // Полноэкранное меню открыто — фон под ним не скроллится
  useEffect(() => {
    if (!drawer) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [drawer])

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <div className="app-shell">
      <Sidebar
        items={nav}
        active={activeSection}
        onNavigate={setActive}
        open={drawer}
        onClose={() => setDrawer(false)}
        onHelp={() => setHelp(true)}
        email={session.user.email}
      />
      <div className="app-main">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setDrawer(true)} aria-label="Open navigation"><MenuIcon /></button>
          <div className="topbar-context">
            <span>{context.organization?.name}</span>
            <small>{context.member?.role}</small>
            {isDeveloper && <span className="developer-badge">Developer workspace</span>}
          </div>
        </header>
        <main className="content">
          {activeSection === 'overview' && (noProducts
            ? <ActivationHome context={context} onReloadContext={onReloadContext} />
            : <Overview context={context} onNavigate={setActive} onReloadContext={onReloadContext} />)}
          {activeSection === 'orders' && <OrdersInbox context={context} />}
          {activeSection === 'reservations' && <ReservationsDesk context={context} />}
          {activeSection === 'sales' && <SalesOverview organizationName={context.organization?.name} />}
          {activeSection === 'activity' && <ActivityManager context={context} />}
          {activeSection === 'locations' && <LocationSettings context={context} />}
          {activeSection === 'menu' && <MenuManager context={context} />}
          {activeSection === 'team' && <TeamManager context={context} />}
          {activeSection === 'online' && <QrChannels context={context} />}
          {activeSection === 'devices' && <DevicesManager context={context} />}
          {activeSection === 'guests' && <GuestsManager context={context} />}
          {activeSection === 'settings' && <AccountSettingsPage email={session.user.email} onSignOut={signOut} />}
          {!['overview', 'orders', 'reservations', 'sales', 'activity', 'locations', 'menu', 'team', 'online', 'devices', 'guests'].includes(activeSection) && (
            activeSection !== 'settings'
              && <SectionPage section={activeSection} context={context} onNavigate={setActive} />
          )}
        </main>
      </div>
      {help && (
        <HelpPanel
          context={context}
          email={session.user.email}
          onNavigate={setActive}
          onClose={() => setHelp(false)}
        />
      )}
    </div>
  )
}

function ConfigurationMissing() {
  return (
    <main className="center-state">
      <Brand />
      <h1>Back office is not configured</h1>
      <p>Add the Supabase URL and anon key to the deployment environment.</p>
    </main>
  )
}

function Loading() {
  return <main className="loading-state"><Brand /><span className="spinner" aria-label="Loading" /></main>
}

function AccessDenied({ message }) {
  return (
    <main className="center-state">
      <Brand />
      <h1>Back office access is not enabled</h1>
      <p>{message || 'This account is not linked to an ANGLE organisation.'}</p>
      <button className="primary-button narrow" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </main>
  )
}

export default function App() {
  const [session, setSession] = useState(null)
  const [context, setContext] = useState(null)
  const [loading, setLoading] = useState(true)
  const [contextError, setContextError] = useState('')

  async function loadContext(currentSession) {
    if (!currentSession) {
      setContext(null)
      setLoading(false)
      return
    }
    // Аккаунт без организации (свежая регистрация): RPC упадёт с
    // 'not authenticated' — вместо запроса показываем онбординг (100).
    if (!currentSession.user?.app_metadata?.org_id) {
      setContext(null)
      setContextError('')
      setLoading(false)
      return
    }
    setLoading(true)
    setContextError('')
    const { data, error } = await supabase.rpc('get_backoffice_context')
    if (error) {
      setContextError(error.message)
      setContext(null)
    } else {
      setContext(data)
    }
    setLoading(false)
  }

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return undefined
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      loadContext(data.session)
    })
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      queueMicrotask(() => loadContext(nextSession))
    })
    return () => subscription.subscription.unsubscribe()
  }, [])

  const content = useMemo(() => {
    if (!isSupabaseConfigured) return <ConfigurationMissing />
    if (loading) return <Loading />
    if (!session) return <SignIn />
    // Без организации в JWT — digital-only онбординг (100), не AccessDenied.
    if (!session.user?.app_metadata?.org_id) return <Onboarding email={session.user.email} />
    if (!context) return <AccessDenied message={contextError} />
    return <Dashboard session={session} context={context} onReloadContext={() => loadContext(session)} />
  }, [session, context, loading, contextError])

  return content
}
