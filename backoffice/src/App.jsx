import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  BarChart3,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronRight,
  Copy,
  CreditCard,
  LayoutDashboard,
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
  NAV_ITEMS, groupedNavigation, hasCapability, isLocationScoped,
} from './navigation'
import { DEFAULT_VIEW, readRoute, routeToUrl, sameRoute } from './routing'
import ProductsCard from './ProductsCard'
import ViewErrorBoundary from './ErrorBoundary'
import AppShell, { Brand } from './ui/AppShell'
import HomeDashboard from './HomeDashboard'
import { ActivityCard } from './ActivityManager'
import { PageHeader } from './ui/Layout'
import { overlayClass, useOverlayExit } from './ui/overlay-motion'
import Skeleton, { SkeletonBar, SkeletonPanel } from './ui/Skeleton'

/**
 * Разделы загружаются по требованию.
 *
 * До этого кабинет приезжал одним файлом на 871 kB: владелец, открывший
 * дашборд, ждал ещё и редактор товара, план зала, генератор QR и отчёт
 * по броням — всё, чем он сегодня не пользуется. На T2 Mini и на
 * телефоне в зале это не «пара сотен килобайт», а секунды до первого
 * экрана.
 *
 * Что осталось в первом чанке и почему: оболочка, навигация и
 * `HomeDashboard` — их видно сразу, и делить их значило бы менять
 * ожидание одного файла на мигание двух. `ActivityCard` тоже: она
 * стоит на самом дашборде.
 *
 * Каждый `lazy` — отдельный чанк Vite. Ожидание держит тот же скелет,
 * что и загрузка данных: подмена экрана не должна выглядеть иначе,
 * чем подмена его содержимого.
 */
const VIEW_MODULES = {
  reports: () => import('./ReportsSection'),
  locations: () => import('./LocationSettings'),
  menu: () => import('./MenuManager'),
  team: () => import('./TeamManager'),
  online: () => import('./QrChannels'),
  orders: () => import('./OrdersInbox'),
  reservations: () => import('./ReservationsDesk'),
  devices: () => import('./DevicesManager'),
  guests: () => import('./GuestsManager'),
  activity: () => import('./ActivityManager'),
  settings: () => import('./SettingsPage'),
}

const ReportsSection = lazy(VIEW_MODULES.reports)
const SettingsPage = lazy(VIEW_MODULES.settings)
const LocationSettings = lazy(VIEW_MODULES.locations)
const MenuManager = lazy(VIEW_MODULES.menu)
const TeamManager = lazy(VIEW_MODULES.team)
const QrChannels = lazy(VIEW_MODULES.online)
const OrdersInbox = lazy(VIEW_MODULES.orders)
const ReservationsDesk = lazy(VIEW_MODULES.reservations)
const DevicesManager = lazy(VIEW_MODULES.devices)
const GuestsManager = lazy(VIEW_MODULES.guests)
const ActivityManager = lazy(VIEW_MODULES.activity)

/**
 * Прогрев чанков в простое.
 *
 * Разделённый бандл платит за первый экран ожиданием при первом заходе
 * в каждый раздел. Владелец этого ждать не должен: пока он смотрит на
 * дашборд, браузер простаивает — там и забираем остальное.
 *
 * Греем только то, что этому аккаунту доступно: у Menu-only клиента
 * чанков броней и заказов нет вовсе, и тянуть их значило бы вернуть
 * тот же лишний вес другим путём.
 */
function useModulePrefetch(views) {
  useEffect(() => {
    let cancelled = false
    const queue = views.filter((id) => VIEW_MODULES[id])
    function next() {
      if (cancelled) return
      const id = queue.shift()
      if (!id) return
      // Отказ прогрева — не ошибка: раздел загрузится при открытии
      VIEW_MODULES[id]().then(next, next)
    }
    const idle = window.requestIdleCallback
      ? window.requestIdleCallback(next, { timeout: 4000 })
      : window.setTimeout(next, 1200)
    return () => {
      cancelled = true
      if (window.cancelIdleCallback && window.requestIdleCallback) window.cancelIdleCallback(idle)
      else window.clearTimeout(idle)
    }
  }, [views])
}

/**
 * Ожидание раздела. Нейтральная форма «строка заголовка + рабочая
 * панель»: какой именно раздел приедет, здесь ещё не знают, а обещать
 * чужую геометрию хуже, чем не обещать никакой.
 */
function ViewFallback() {
  return (
    <Skeleton label="Loading the section…">
      <SkeletonBar width="180px" height={26} />
      <SkeletonPanel height={360}>
        <SkeletonBar width="30%" height={16} />
        {[0, 1, 2, 3, 4].map((i) => (
          <SkeletonBar key={i} width={`${72 - i * 9}%`} />
        ))}
      </SkeletonPanel>
    </Skeleton>
  )
}

/**
 * Иконки разделов. Список разделов и правила видимости живут в
 * `navigation.js` (чистый модуль под тесты), здесь — только оформление.
 */
const NAV_ICONS = {
  overview: LayoutDashboard,
  orders: ShoppingBag,
  reservations: CalendarDays,
  activity: Activity,
  locations: Store,
  menu: MenuIcon,
  team: Users,
  guests: UserRound,
  online: QrCode,
  // Каналы соседи по группе, и одинаковый QR у обоих делал бы список
  // нечитаемым: у брони календарь со стрелкой времени, у стола хостес
  // (`reservations`) — обычный календарь.
  reserve: CalendarClock,
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
  const { closing, close, isTop } = useOverlayExit(onClose)

  useEffect(() => {
    closeRef.current?.focus()
    function onKey(event) {
      // Escape принадлежит верхнему слою: поверх помощи может стоять
      // диалог, и закрывать надо его, а не лист под ним.
      if (event.key === 'Escape' && isTop()) close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [close, isTop])

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
    <div className={overlayClass('sheet-backdrop', closing)} onClick={close} role="presentation">
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
            onClick={close}
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
                  onClick={() => { onNavigate(step.view); close() }}
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
 * Стабильный экран «Choose a product / Pending activation» (104):
 * организация без активного продукта — валидное состояние (заявка ждёт
 * оператора), а не сломанный кабинет. Операционные разделы не рендерим.
 */
function ActivationHome({ context, onReloadContext }) {
  const requests = Array.isArray(context?.product_requests) ? context.product_requests : []
  return (
    <>
      {/* Единственный титульный заголовок кабинета: работать здесь ещё
          негде, и экран целиком — приветствие, а не рабочий раздел.
          Разделы за ним живут одной рабочей строкой (PageHeader). */}
      <section className="welcome-heading">
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

/**
 * Главная. Всё «что сейчас» живёт в HomeDashboard; здесь остаётся только
 * журнал последних событий.
 *
 * Быстрых действий больше нет: семь кнопок повторяли семь пунктов
 * сайдбара, то есть занимали экран, ничего не добавляя. Карточка
 * продуктов уехала в аккаунт — это состояние подписки, а не сегодняшний
 * день; заявка, которая ждёт активации, приходит сюда строкой «требует
 * внимания».
 */
function Overview({ context, locationId, onNavigate }) {
  const pos = hasCapability(context, 'pos_operate')
  return (
    <HomeDashboard context={context} locationId={locationId} onNavigate={onNavigate}>
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
      <PageHeader title={item.label} />
      <section className="section-placeholder panel">
        <span className="section-icon"><Icon /></span>
        <div>
          <h2>Not built yet</h2>
          {/* Что здесь появится — объясняет сама заглушка, а не подпись
              к заголовку раздела. */}
          {planned?.summary && <p>{planned.summary}</p>}
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
  // Чанки доступных разделов забираем в простое — см. useModulePrefetch
  useModulePrefetch(allowedViews)

  // Стартовое состояние берётся из адреса: ссылка и перезагрузка
  // открывают тот же экран, что и был.
  const [route, setRoute] = useState(() => {
    // readRoute — разбор ПЛЮС перевод устаревших ссылок в сегодняшние
    // координаты (Sales → Reports, выгрузка и лояльность из Locations).
    const parsed = readRoute(window.location.search)
    return {
      view: parsed.view,
      locationId: parsed.locationId || readStoredLocation(),
      tab: parsed.tab,
      mode: parsed.mode,
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
      view, locationId, tab: route.tab, mode: route.mode, date: route.date, filters: route.filters,
    }
    routeRef.current = current
    const url = routeToUrl(current, window.location.pathname)
    if (url !== window.location.pathname + window.location.search) {
      window.history.replaceState({ ...current }, '', url)
    }
  }, [view, locationId, route.tab, route.mode, route.date, route.filters])

  // Назад/Вперёд браузера меняют раздел, а не выкидывают из кабинета
  const poppedRef = useRef(false)
  useEffect(() => {
    function onPopState() {
      // Тот же перевод устаревших ссылок: Назад может вернуть в закладку,
      // сохранённую до перестройки разделов.
      const parsed = readRoute(window.location.search)
      const next = {
        view: parsed.view, locationId: parsed.locationId, tab: parsed.tab,
        mode: parsed.mode, date: parsed.date, filters: parsed.filters,
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
      // Режим — свойство вкладки: уходя из раздела или меняя вкладку явно,
      // его нельзя тащить (экран дублей не должен открыться в Loyalty).
      mode: nextView === prev.view && !nextTab ? prev.mode : null,
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
    // Смена вкладки обнуляет режим: он принадлежит вкладке, а не разделу
    applyRoute({ ...routeRef.current, tab: nextTab, mode: null }, 'replace')
  }, [applyRoute])

  // Режим внутри вкладки (экран дублей Directory) — тоже уточнение того же
  // экрана: он адресуем, но не набивает историю браузера.
  const changeMode = useCallback((nextMode) => {
    applyRoute({ ...routeRef.current, mode: nextMode || null }, 'replace')
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
        {/* Suspense — ВНУТРИ границы ошибки: не приехавший чанк (сеть
            отвалилась после деплоя) обязан выглядеть как упавший
            раздел, с кнопкой «Try again», а не как белый экран. */}
        <Suspense fallback={<ViewFallback />}>
        {view === 'overview' && (noProducts
          ? <ActivationHome context={context} onReloadContext={onReloadContext} />
          : (
            <Overview context={context} locationId={locationId} onNavigate={navigate} />
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
        {/* Reports — продажи и фискальный набор. Точка НЕ показывается в
            шапке: у Sales свой выбор нескольких точек, у Fiscal — свой
            обязательный выбор одной, и третий переключатель наверху
            обещал бы им общий скоуп, которого нет. */}
        {view === 'reports' && (
          <ReportsSection
            context={context}
            {...tabProps}
            locationId={locationId}
            onLocationChange={changeLocation}
            onNavigate={navigate}
          />
        )}
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
          <QrChannels context={context} channel="online" {...scopedProps} onNavigate={navigate} />
        )}
        {view === 'reserve' && (
          <QrChannels context={context} channel="reserve" {...scopedProps} onNavigate={navigate} />
        )}
        {view === 'devices' && <DevicesManager context={context} />}
        {/* Точка нужна только вкладке Loyalty — она и показывает свой
            выбор внутри раздела: список клиентов организационный, и
            переключатель в шапке обещал бы фильтрацию, которой нет. */}
        {view === 'guests' && (
          <GuestsManager
            context={context}
            {...tabProps}
            mode={route.mode}
            onModeChange={changeMode}
            locationId={locationId}
            onLocationChange={changeLocation}
          />
        )}
        {view === 'settings' && (
          <SettingsPage
            email={session.user.email}
            context={context}
            {...tabProps}
            onSignOut={signOut}
            onReloadContext={onReloadContext}
            onNavigate={navigate}
          />
        )}
        {PLANNED_SECTIONS[view] && <SectionPage section={view} context={context} onNavigate={navigate} />}
        </Suspense>
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
