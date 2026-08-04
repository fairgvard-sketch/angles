import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  BarChart3,
  CalendarDays,
  Check,
  ChevronRight,
  Copy,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  MonitorSmartphone,
  QrCode,
  ShoppingBag,
  Store,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { isSupabaseConfigured, supabase } from './supabase'
import {
  NAV_ITEMS, groupedNavigation, hasCapability, isLocationScoped, productState,
} from './navigation'
import { DEFAULT_VIEW, parseRoute, routeToUrl, sameRoute } from './routing'
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
import ViewErrorBoundary from './ErrorBoundary'
import AppShell, { Brand } from './ui/AppShell'
import HomeDashboard from './HomeDashboard'
import { PageHeader } from './ui/Layout'

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
      <PageHeader
        compact={false}
        eyebrow="YOUR BUSINESS"
        title={context.organization?.name || 'ANGLE business'}
        description={requests.length > 0
          ? 'Your workspace is ready. The ANGLE team is activating your products — this usually takes less than a business day.'
          : 'Your workspace is ready. Choose a product to get started.'}
      />
      <ProductsCard context={context} onReloadContext={onReloadContext} />
    </>
  )
}

/**
 * Быстрые действия Dashboard (Phase 2): каждое привязано к capability и
 * подписано тем, что даёт. Menu-only владельцу нечего делать в разделе
 * команды, а Reserve-only — в каталоге.
 */
const QUICK_ACTIONS = [
  {
    view: 'locations', capability: null, icon: Store,
    title: 'Locations', detail: 'Address, hours, taxes and guest-facing details',
  },
  {
    view: 'orders', capability: 'orders_desk', icon: ShoppingBag,
    title: 'Order inbox', detail: 'What guests ordered and where it stands',
  },
  {
    view: 'reservations', capability: 'reservations_desk', icon: CalendarDays,
    title: 'Host desk', detail: 'Today’s bookings, tables and waitlist',
  },
  {
    view: 'sales', capability: 'pos_reports', icon: BarChart3,
    title: 'Sales', detail: 'Revenue, orders and top items',
  },
  {
    view: 'menu', capability: 'catalog_manage', icon: MenuIcon,
    title: 'Catalogue', detail: 'Prices, items and modifiers',
  },
  {
    view: 'online', capability: 'public_menu', icon: QrCode,
    title: 'QR Menu & Online', detail: 'Guest link, ordering and table booking',
  },
  {
    view: 'team', capability: 'pos_operate', icon: Users,
    title: 'Team access', detail: 'Roles, PINs and permissions',
  },
]

/**
 * Описание кабинета словами клиента, а не набором продуктов ANGLE.
 * Standalone-клиенту нельзя говорить, что его организация «подключена к
 * ANGLE POS»: у него нет кассы, и это выглядит как чужой аккаунт.
 */
function overviewIntro(context) {
  const pos = hasCapability(context, 'pos_operate')
  const orders = hasCapability(context, 'orders_desk')
  const reserve = hasCapability(context, 'reservations_desk')
  const menu = hasCapability(context, 'public_menu')
  if (pos) return 'Everything that configures and supports your registers, in one place.'
  const parts = []
  if (menu) parts.push('menu')
  if (orders) parts.push('online orders')
  if (reserve) parts.push('table bookings')
  if (parts.length === 0) return 'Your business settings, in one place.'
  const list = parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
    : parts[0]
  // Про кассу не упоминаем вовсе — даже отрицанием: клиент без неё не
  // должен гадать, чего ему не хватает.
  return `Your ${list} — set up and run from here.`
}

/**
 * Главная. Виджеты «что сейчас» живут в HomeDashboard; здесь остаётся
 * то, что про настройку: быстрые действия, продукты и журнал.
 *
 * Прежние три счётчика (точки, сотрудники, кассы) и список точек убраны
 * намеренно: они отвечали на вопрос «из чего состоит мой аккаунт», а
 * владельцу, открывшему кабинет утром, нужен ответ «что происходит и что
 * требует внимания». Точки никуда не делись — они в быстрых действиях и
 * в своём разделе.
 */
function Overview({ context, locationId, onNavigate, onReloadContext }) {
  const pos = hasCapability(context, 'pos_operate')
  const actions = QUICK_ACTIONS.filter((action) => (
    action.capability === null || hasCapability(context, action.capability)
  ))
  return (
    <HomeDashboard context={context} locationId={locationId} onNavigate={onNavigate}>
      <section className="panel quick-panel">
        <div className="panel-heading"><div><h2>Quick access</h2><p>Common owner tasks.</p></div></div>
        <div className="quick-list">
          {actions.map(({ view, icon: Icon, title, detail }) => (
            <button key={view} onClick={() => onNavigate(view)}>
              <Icon /><span><strong>{title}</strong><small>{detail}</small></span><ChevronRight />
            </button>
          ))}
        </div>
      </section>

      <ProductsCard context={context} onReloadContext={onReloadContext} />

      {pos && <ActivityCard onNavigate={onNavigate} />}
    </HomeDashboard>
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
      <PageHeader
        eyebrow={context.organization?.name}
        title={item.label}
        description={planned?.summary}
      />
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
      <PageHeader
        eyebrow="ACCOUNT"
        title="Settings"
        description="Manage your back-office account and session."
      />
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

/**
 * Выбранная точка — общий контекст (Phase 2).
 *
 * Раньше каждый раздел выбирал точку сам и начинал с первой в списке:
 * владелец сети, перейдя из броней в каталог, молча оказывался в другой
 * точке. Теперь выбор один на кабинет, живёт в адресе (ссылка открывает
 * ту же точку) и переживает перезагрузку.
 */
const LOCATION_STORAGE_KEY = 'angle.backoffice.location'

function readStoredLocation() {
  try {
    return window.localStorage.getItem(LOCATION_STORAGE_KEY)
  } catch {
    return null
  }
}

function storeLocation(id) {
  try {
    if (id) window.localStorage.setItem(LOCATION_STORAGE_KEY, id)
  } catch {
    // Приватный режим — выбор просто не переживёт перезагрузку
  }
}

function Dashboard({ session, context, onReloadContext }) {
  const [help, setHelp] = useState(false)
  // Организация без активного продукта (104): стабильный экран выбора/
  // ожидания активации вместо пустых операционных разделов.
  const noProducts = Array.isArray(context.products) && context.products.length === 0
  const nav = useMemo(() => (noProducts
    ? { primary: NAV_ITEMS.filter(({ id }) => id === 'overview'), groups: [] }
    : groupedNavigation(context)), [context, noProducts])

  const locations = useMemo(() => context.locations || [], [context])
  // settings — экран аккаунта: он не в списке разделов, но адресуем
  const allowedViews = useMemo(
    () => [...nav.primary, ...nav.groups.flatMap((g) => g.items)].map((i) => i.id).concat('settings'),
    [nav]
  )

  // Стартовое состояние берётся из адреса: ссылка и перезагрузка
  // открывают тот же экран, что и был.
  const [route, setRoute] = useState(() => {
    const parsed = parseRoute(window.location.search)
    return {
      view: parsed.view,
      locationId: parsed.locationId || readStoredLocation(),
      tab: parsed.tab,
      date: parsed.date,
      filters: parsed.filters,
    }
  })

  // Раздел, недоступный этому аккаунту (устаревшая ссылка, смена
  // продуктов) — не ошибка: молча возвращаем на Dashboard.
  const view = allowedViews.includes(route.view) ? route.view : DEFAULT_VIEW
  const locationId = locations.some((l) => l.id === route.locationId)
    ? route.locationId
    : (locations[0]?.id ?? null)
  const scoped = isLocationScoped(view)
  const isDeveloper = context.account_type === 'developer'

  /**
   * Текущий маршрут дублируется в ref: запись в history — побочный
   * эффект, и делать его внутри апдейтера состояния нельзя. React
   * вызывает апдейтер дважды (StrictMode), и каждый переход добавлял в
   * историю ДВЕ записи — Назад возвращал на тот же экран.
   */
  const routeRef = useRef(route)

  const applyRoute = useCallback((next, mode = 'push') => {
    if (sameRoute(routeRef.current, next)) return
    routeRef.current = next
    const url = routeToUrl(next, window.location.pathname)
    if (mode === 'replace') window.history.replaceState({ ...next }, '', url)
    else window.history.pushState({ ...next }, '', url)
    setRoute(next)
  }, [])

  // Адрес всегда отражает то, что на экране; кривой приводим в порядок
  // заменой записи, чтобы Назад не возвращал в него же.
  useEffect(() => {
    const current = {
      view, locationId, tab: route.tab, date: route.date, filters: route.filters,
    }
    routeRef.current = current
    const url = routeToUrl(current, window.location.pathname)
    if (url !== window.location.pathname + window.location.search) {
      window.history.replaceState({ ...current }, '', url)
    }
  }, [view, locationId, route.tab, route.date, route.filters])

  // Назад/Вперёд браузера меняют раздел, а не выкидывают из кабинета
  const poppedRef = useRef(false)
  useEffect(() => {
    function onPopState() {
      const parsed = parseRoute(window.location.search)
      const next = {
        view: parsed.view, locationId: parsed.locationId, tab: parsed.tab,
        date: parsed.date, filters: parsed.filters,
      }
      routeRef.current = next
      poppedRef.current = true
      setRoute(next)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  /**
   * Новый раздел открывается СВЕРХУ. Без этого браузер оставляет прокрутку
   * от предыдущего экрана, и владелец, открыв «QR menu & online» из меню,
   * попадал в середину страницы — к встроенному превью гостя, а не к
   * заголовку и настройкам.
   *
   * Назад/Вперёд — исключение: там место в странице принадлежит истории,
   * и восстанавливать его должен браузер, а не мы.
   */
  useEffect(() => {
    if (poppedRef.current) {
      poppedRef.current = false
      return
    }
    window.scrollTo(0, 0)
  }, [view, locationId])

  const navigate = useCallback((nextView, nextLocationId = null, nextTab = null) => {
    const prev = routeRef.current
    applyRoute({
      view: nextView,
      locationId: nextLocationId ?? prev.locationId,
      // Вкладка принадлежит разделу: уходя из него, её нельзя тащить.
      // Явно переданная вкладка — переход «в конкретное место раздела».
      tab: nextTab ?? (nextView === prev.view ? prev.tab : null),
      // День и отбор — тоже свойства раздела, а не кабинета целиком.
      date: nextView === prev.view ? prev.date : null,
      filters: nextView === prev.view ? prev.filters : null,
    })
  }, [applyRoute])

  const changeLocation = useCallback((nextId) => {
    storeLocation(nextId)
    applyRoute({ ...routeRef.current, locationId: nextId })
  }, [applyRoute])

  // Вкладка внутри раздела — уточнение того же экрана, а не новый шаг:
  // иначе Назад из «Waitlist» вело бы в «Timeline», а не в прошлый раздел.
  const changeTab = useCallback((nextTab) => {
    applyRoute({ ...routeRef.current, tab: nextTab }, 'replace')
  }, [applyRoute])

  // Смена дня — то же самое: листание календаря не должно набивать
  // историю браузера десятком шагов назад.
  const changeDate = useCallback((nextDate) => {
    applyRoute({ ...routeRef.current, date: nextDate || null }, 'replace')
  }, [applyRoute])

  // Отбор — уточнение того же экрана: он живёт в адресе, но не набивает
  // историю браузера шагом на каждый выбранный фильтр.
  const changeFilters = useCallback((nextFilters) => {
    applyRoute({ ...routeRef.current, filters: nextFilters || null }, 'replace')
  }, [applyRoute])

  useEffect(() => { if (locationId) storeLocation(locationId) }, [locationId])

  async function signOut() {
    await supabase.auth.signOut()
  }

  // Вкладка живёт в адресе у КАЖДОГО раздела с вкладками: перезагрузка и
  // ссылка в поддержку должны открывать тот же экран, а не первый таб.
  const scopedProps = { locationId, onLocationChange: changeLocation }
  const tabProps = { tab: route.tab, onTabChange: changeTab }
  // День живёт в адресе только у раздела броней — остальным он не нужен
  const dateProps = {
    date: route.date,
    onDateChange: changeDate,
    filters: route.filters ?? {},
    onFiltersChange: changeFilters,
  }

  return (
    <AppShell
      nav={nav}
      icons={NAV_ICONS}
      view={view}
      onNavigate={navigate}
      email={session.user.email}
      onSignOut={signOut}
      onHelp={() => setHelp(true)}
      organization={context.organization?.name}
      role={context.member?.role}
      isDeveloper={isDeveloper}
      locations={locations}
      locationId={locationId}
      onLocationChange={changeLocation}
      /* Точка показывается там, где от неё зависят данные — и нигде
         больше: в Team или Customers она вводила бы в заблуждение. */
      scoped={scoped && !noProducts}
    >
      {/* Граница ошибки живёт внутри рабочей области и пересоздаётся при
          смене раздела: упавший модуль не уносит навигацию, шапку и
          возможность уйти в другой раздел.
          Вкладки в ключе НЕТ намеренно: раньше переход Timeline → List и
          обратно пересоздавал раздел целиком — полотно теряло день,
          зону и позицию прокрутки и заново тянуло данные. Вкладка — это
          другой ответ на тот же вопрос, а не другой экран. */}
      <ViewErrorBoundary
        key={`${view}:${locationId ?? ''}`}
        view={view}
        onHome={() => navigate(DEFAULT_VIEW)}
      >
        {view === 'overview' && (noProducts
          ? <ActivationHome context={context} onReloadContext={onReloadContext} />
          : (
            <Overview
              context={context}
              locationId={locationId}
              onNavigate={navigate}
              onReloadContext={onReloadContext}
            />
          ))}
        {/* Вкладка и отбор заказов живут в адресе — как у броней. Дня в
            адресе у раздела нет: «сегодня» ему задаёт сервер по часам
            точки, а не выбор в шапке. */}
        {view === 'orders' && (
          <OrdersInbox
            {...scopedProps}
            {...tabProps}
            filters={route.filters ?? {}}
            onFiltersChange={changeFilters}
          />
        )}
        {view === 'reservations' && (
          <ReservationsDesk context={context} {...scopedProps} {...tabProps} {...dateProps} />
        )}
        {view === 'sales' && <SalesOverview context={context} />}
        {view === 'activity' && <ActivityManager context={context} />}
        {view === 'locations' && <LocationSettings context={context} {...scopedProps} {...tabProps} />}
        {/* Отбор каталога живёт в адресе — как у заказов: ссылка
            «покажи неполные позиции» обязана открывать их, а не полный
            каталог после перезагрузки. */}
        {view === 'menu' && (
          <MenuManager
            context={context}
            {...scopedProps}
            {...tabProps}
            filters={route.filters ?? {}}
            onFiltersChange={changeFilters}
          />
        )}
        {view === 'team' && <TeamManager context={context} {...tabProps} />}
        {/* onNavigate — короткий путь «меню собирается в Каталоге»:
            раздел QR не редактирует товары, он только уводит туда. */}
        {view === 'online' && (
          <QrChannels context={context} {...scopedProps} {...tabProps} onNavigate={navigate} />
        )}
        {view === 'devices' && <DevicesManager context={context} />}
        {view === 'guests' && <GuestsManager context={context} {...tabProps} />}
        {view === 'settings' && <AccountSettingsPage email={session.user.email} onSignOut={signOut} />}
        {PLANNED_SECTIONS[view] && <SectionPage section={view} context={context} onNavigate={navigate} />}
      </ViewErrorBoundary>
      {help && (
        <HelpPanel
          context={context}
          email={session.user.email}
          onNavigate={navigate}
          onClose={() => setHelp(false)}
        />
      )}
    </AppShell>
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
