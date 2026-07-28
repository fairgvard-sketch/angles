import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  BarChart3,
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  CircleHelp,
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

const navigation = [
  { id: 'overview', label: 'Home', icon: LayoutDashboard },
  { id: 'orders', label: 'Orders', icon: ShoppingBag },
  { id: 'reservations', label: 'Reservations', icon: CalendarDays },
  { id: 'sales', label: 'Overview', icon: BarChart3 },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'locations', label: 'Locations', icon: Store },
  { id: 'menu', label: 'Menu & catalogue', icon: MenuIcon },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'guests', label: 'Customers', icon: UserRound },
  { id: 'online', label: 'QR menu', icon: QrCode },
  { id: 'devices', label: 'Devices', icon: MonitorSmartphone },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'integrations', label: 'Integrations', icon: CreditCard },
]

// ── Продукты и capabilities (100/103/105) ────────────────────
/**
 * Навигация строится из ЭФФЕКТИВНЫХ capabilities контекста (105), а не из
 * сырого ключа продукта: ANGLE Orders даёт публичное меню без покупки Menu,
 * поэтому раздел каталога виден по catalog_manage, а не по products.
 * Это только видимость — авторизация остаётся на сервере (RLS + RPC-гейты,
 * module_disabled). Контекст без поля capabilities (функция до 105) —
 * фолбэк на прежнюю продуктовую логику.
 */
export function hasProduct(products, product) {
  return !Array.isArray(products) || products.includes(product)
}

export function hasCapability(context, capability) {
  const caps = context?.capabilities
  if (!Array.isArray(caps)) {
    // Старый контекст: приближение по продуктам (как до 105)
    const products = context?.products
    if (!Array.isArray(products)) return true
    const has = (p) => products.includes(p)
    switch (capability) {
      case 'catalog_manage': return has('pos') || has('menu') || has('online_orders')
      case 'public_menu': return has('menu') || has('online_orders')
      case 'online_orders':
      case 'orders_desk': return has('online_orders')
      case 'public_reservations':
      case 'reservations_desk': return has('reservations')
      default: return has('pos')
    }
  }
  return caps.includes(capability)
}

export function visibleNavigation(context) {
  const products = context?.products
  if (!Array.isArray(products) && !Array.isArray(context?.capabilities)) return navigation
  const can = (c) => hasCapability(context, c)
  return navigation.filter(({ id }) => {
    if (id === 'overview' || id === 'locations') return true
    if (id === 'menu') return can('catalog_manage')
    if (id === 'online') {
      return can('public_menu') || can('online_orders')
        || can('public_reservations') || can('reservations_desk')
    }
    // Инбокс заказов (101): capability orders_desk — pos-точки видят его
    // read-only, их цикл живёт на кассе.
    if (id === 'orders') return can('orders_desk')
    // Веб-стол хостес (102): reservations_desk, работает и у POS-точек
    if (id === 'reservations') return can('reservations_desk')
    if (id === 'sales') return can('pos_reports')
    // activity/team/devices/reports/integrations — POS-контур
    return can('pos_operate')
  })
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

function Sidebar({ items, active, onNavigate, open, onClose, email }) {
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
            <button className="icon-button sidebar-mobile-action" aria-label="Help"><CircleHelp /></button>
            <button className="icon-button sidebar-mobile-action" aria-label="Settings" onClick={openSettings}><Settings /></button>
            <button className="icon-button sidebar-close" onClick={onClose} aria-label="Close navigation"><X /></button>
          </div>
        </div>
        <nav className="side-nav" aria-label="Back office">
          {items.map(({ id, label, icon: Icon }) => (
            <button key={id} className={active === id ? 'active' : ''} onClick={() => { onNavigate(id); onClose() }}>
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button><CircleHelp /><span>Help</span></button>
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

export function productState(context, productId) {
  const products = Array.isArray(context?.products) ? context.products : []
  const requests = Array.isArray(context?.product_requests) ? context.product_requests : []
  const sources = context?.product_sources || {}
  if (products.includes(productId)) {
    return sources[productId] === 'developer' ? 'developer' : 'active'
  }
  // Orders включает публичное меню технически — вторая покупка не нужна
  if (productId === 'menu' && products.includes('online_orders')) return 'included'
  if (requests.includes(productId)) return 'pending'
  return 'addon'
}

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

function SectionPage({ section, context }) {
  const item = navigation.find((entry) => entry.id === section) || navigation[0]
  const Icon = item.icon
  const descriptions = {
    locations: 'Business details, opening hours and settings for each location.',
    menu: 'Catalogue, categories, prices, sizes and modifiers used by the POS.',
    team: 'Owner, manager and staff access across your locations.',
    online: 'QR menu, online ordering and table reservations.',
    devices: 'POS terminals connected to your organisation.',
    reports: 'Sales and operating performance across every location.',
    integrations: 'Payments, accounting and connected business tools.',
  }
  return (
    <>
      <section className="page-heading compact-heading">
        <p className="eyebrow">{context.organization?.name}</p>
        <h1>{item.label}</h1>
        <p>{descriptions[section]}</p>
      </section>
      <section className="section-placeholder panel">
        <span className="section-icon"><Icon /></span>
        <div>
          <h2>{item.label}</h2>
          <p>This workspace is connected to the same organisation as your ANGLE POS.</p>
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
  // Организация без активного продукта (104): стабильный экран выбора/
  // ожидания активации вместо пустых операционных разделов.
  const noProducts = Array.isArray(context.products) && context.products.length === 0
  // Capabilities (105): скрытая секция недостижима и из state (например,
  // после перезагрузки контекста) — молча возвращаем на Home.
  const nav = noProducts
    ? navigation.filter(({ id }) => id === 'overview')
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
      <Sidebar items={nav} active={activeSection} onNavigate={setActive} open={drawer} onClose={() => setDrawer(false)} email={session.user.email} />
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
            activeSection !== 'settings' && <SectionPage section={activeSection} context={context} />
          )}
        </main>
      </div>
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
