import { useEffect, useMemo, useState } from 'react'
import {
  BarChart3,
  Building2,
  ChevronRight,
  CircleHelp,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  MonitorSmartphone,
  MoreHorizontal,
  QrCode,
  RefreshCw,
  Settings,
  Store,
  Users,
  X,
} from 'lucide-react'
import { isSupabaseConfigured, supabase } from './supabase'
import SalesOverview from './SalesOverview'
import LocationSettings from './LocationSettings'
import MenuManager from './MenuManager'

const navigation = [
  { id: 'overview', label: 'Home', icon: LayoutDashboard },
  { id: 'sales', label: 'Overview', icon: BarChart3 },
  { id: 'locations', label: 'Locations', icon: Store },
  { id: 'menu', label: 'Menu & catalogue', icon: MenuIcon },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'online', label: 'QR & reservations', icon: QrCode },
  { id: 'devices', label: 'Devices', icon: MonitorSmartphone },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'integrations', label: 'Integrations', icon: CreditCard },
]

function Brand({ compact = false }) {
  return (
    <a className="brand" href="/" aria-label="ANGLE home">
      <img src="/favicon.png" alt="" />
      {!compact && <span>ANGLE</span>}
    </a>
  )
}

function SignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) setError(signInError.message)
    setBusy(false)
  }

  return (
    <div className="auth-shell">
      <header className="auth-header"><Brand /></header>
      <main className="auth-main">
        <section className="auth-panel" aria-labelledby="sign-in-title">
          <p className="eyebrow">BACK OFFICE</p>
          <h1 id="sign-in-title">Sign in</h1>
          <p className="auth-intro">Manage your locations, team and online channels.</p>
          <form onSubmit={submit} className="auth-form">
            <label>
              <span>Email</span>
              <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </label>
            <label>
              <span>Password</span>
              <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} />
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Continue'}
            </button>
          </form>
          <p className="auth-footnote">New to ANGLE? <a href="/#contact">Get started</a></p>
        </section>
      </main>
    </div>
  )
}

function Sidebar({ active, onNavigate, open, onClose, email }) {
  return (
    <>
      {open && <button className="drawer-scrim" aria-label="Close navigation" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'is-open' : ''}`}>
        <div className="sidebar-top">
          <Brand />
          <button className="icon-button sidebar-close" onClick={onClose} aria-label="Close navigation"><X /></button>
        </div>
        <nav className="side-nav" aria-label="Back office">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button key={id} className={active === id ? 'active' : ''} onClick={() => { onNavigate(id); onClose() }}>
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button><CircleHelp /><span>Help</span></button>
          <button><Settings /><span>Settings</span></button>
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

function Overview({ context, onNavigate }) {
  const counts = context.counts || {}
  const locations = context.locations || []
  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">YOUR BUSINESS</p>
        <h1>{context.organization?.name || 'ANGLE business'}</h1>
        <p>Everything that configures and supports your POS, in one place.</p>
      </section>

      <section className="stats-grid" aria-label="Business overview">
        <Stat icon={Store} label="Locations" value={counts.locations ?? 0} detail="Business locations" />
        <Stat icon={Users} label="Team" value={counts.staff ?? 0} detail="Active staff profiles" />
        <Stat icon={MonitorSmartphone} label="Devices" value={counts.devices ?? 0} detail="Connected POS devices" />
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
            <button onClick={() => onNavigate('sales')}><BarChart3 /><span><strong>Sales overview</strong><small>Revenue, orders and top items</small></span><ChevronRight /></button>
            <button onClick={() => onNavigate('menu')}><MenuIcon /><span><strong>Menu & catalogue</strong><small>Prices, items and modifiers</small></span><ChevronRight /></button>
            <button onClick={() => onNavigate('online')}><QrCode /><span><strong>Online channels</strong><small>QR menu and reservations</small></span><ChevronRight /></button>
            <button onClick={() => onNavigate('team')}><Users /><span><strong>Team access</strong><small>Roles, PINs and permissions</small></span><ChevronRight /></button>
          </div>
        </section>
      </div>
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

function Dashboard({ session, context, refresh }) {
  const [active, setActive] = useState('overview')
  const [drawer, setDrawer] = useState(false)

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
      <Sidebar active={active} onNavigate={setActive} open={drawer} onClose={() => setDrawer(false)} email={session.user.email} />
      <div className="app-main">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setDrawer(true)} aria-label="Open navigation"><MenuIcon /></button>
          <div className="topbar-context"><span>{context.organization?.name}</span><small>{context.member?.role}</small></div>
          <div className="topbar-actions">
            <button className="icon-button" onClick={refresh} title="Refresh"><RefreshCw /></button>
            <button className="secondary-button" onClick={signOut}><LogOut /> Sign out</button>
          </div>
        </header>
        <main className="content">
          {active === 'overview' && <Overview context={context} onNavigate={setActive} />}
          {active === 'sales' && <SalesOverview organizationName={context.organization?.name} />}
          {active === 'locations' && <LocationSettings context={context} />}
          {active === 'menu' && <MenuManager context={context} />}
          {!['overview', 'sales', 'locations', 'menu'].includes(active) && (
            <SectionPage section={active} context={context} />
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
    if (!context) return <AccessDenied message={contextError} />
    return <Dashboard session={session} context={context} refresh={() => loadContext(session)} />
  }, [session, context, loading, contextError])

  return content
}
