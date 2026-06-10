import { Button } from './primitives'
import { createContext, useContext, useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { login, me, getEntities, orgTree } from './lib/api'
import ErrorBoundary from './components/ErrorBoundary'
import EntityView from './views/EntityView'
import StudioShell, { type StudioRoute } from './studio/StudioShell'
import ReportsView from './views/ReportsView'
import DashboardView from './views/DashboardView'
import MessagesView from './views/MessagesView'
import MailRouteAdapter from './views/mail/MailRouteAdapter'
import NotificationsView from './views/NotificationsView'
import ProfileView from './views/ProfileView'
import NotificationBell from './components/NotificationBell'
import LangMenu from './components/LangMenu'
import TopbarMenu from './components/TopbarMenu'
import OrgIdentity from './components/OrgIdentity'
import UserMenu from './components/UserMenu'
import ConfigureDrawer from './modals/ConfigureDrawer'
import InvoicesView from './views/InvoicesView'
import PaymentsView from './views/PaymentsView'
import PaymentMethodsView from './views/PaymentMethodsView'
import SubscriptionsView from './views/SubscriptionsView'
import ProductsView from './views/ProductsView'
import TariffPlansView from './views/TariffPlansView'
import WebhooksView from './views/WebhooksView'
import ServicesView from './views/ServicesView'
import UsageView from './views/UsageView'
import ResourcePoolsView from './views/ResourcePoolsView'
import AccountsView from './views/AccountsView'
import AnalyticsView from './views/AnalyticsView'
import PipelineView from './views/PipelineView'
import CustomerView from './views/CustomerView'
import AskGaaexView from './views/AskGaaexView'
import HelpdeskView from './views/HelpdeskView'
import PaymentGatewayView from './views/PaymentGatewayView'
import WorkItemsView from './views/WorkItemsView'
import MyTasksView from './views/MyTasksView'
import CustomerTasksView from './views/CustomerTasksView'
import MyApprovalsView from './views/MyApprovalsView'
import SavedViewsView from './views/SavedViewsView'
import ActivityFeedView from './views/ActivityFeedView'
import CalendarView from './views/CalendarView'
import SettingsView from './views/SettingsView'
import OrgView from './views/OrgView'
import OrdersView from './views/OrdersView'
import RevenueAssuranceView from './views/RevenueAssuranceView'
import CollectionsView from './views/CollectionsView'
import HomeView from './views/HomeView'
import ComingSoonView from './views/ComingSoonView'
import TeamWorkspaceView from './views/TeamWorkspaceView'
import NetworkTopologyView from './views/NetworkTopologyView'
import NetworkInventoryView from './views/NetworkInventoryView'
import ProvisioningView from './views/ProvisioningView'
import DispatchBoardView from './views/DispatchBoardView'
import InstallationBoardView from './views/InstallationBoardView'
import CoverageView from './views/CoverageView'
import NocDashboardView from './views/NocDashboardView'
import { NAV_SECTIONS, type NavItemDef, type NavSectionDef } from './lib/nav-config'
import { loadDynamicNav } from './lib/nav-loader'
import { useI18n, initI18n } from './lib/i18n'
import { RowsIcon, ChevronRightIcon, ServerIcon } from './components/icons'
import { PanelLeft, LogIn, Shield, Eye, EyeOff, Sun, Moon, Mail, MessageCircle, Calendar } from 'lucide-react'
import { fetchCapabilities, FULL_ACCESS, type Capabilities } from './lib/capabilities'
import { useAuth } from './context/AuthContext'
import ProfileModal from './modals/ProfileModal'
import SecurityModal from './modals/SecurityModal'
import { ShortcutsModal, DocsModal, WhatsNewModal } from './modals/SupportModals'

type Me = { email: string; name: string; can_configure?: boolean; avatar_url?: string | null }
type Entity = { key: string; label: string; label_plural: string; route_slug: string }
type OrgNode = { id: string; type: string; name: string; path: string; code?: string; parent_id?: string | null }

// Entity slugs that have dedicated nav-config items; others surface as extra Records
const BUILTIN_ENTITY_SLUGS = new Set(['customers', 'contacts', 'tickets', 'users'])

// ─── AppShellContext ──────────────────────────────────────────────────────────
// Non-auth App state shared with route-level adapters that can't read App scope.
interface AppShellContextValue { canConfigure: boolean; pageConfigVersion: number }
const AppShellContext = createContext<AppShellContextValue>({ canConfigure: false, pageConfigVersion: 0 })

// ─── Route adapters ───────────────────────────────────────────────────────────
// These are module-level because they call useParams()/useSearchParams().
// Simple routes (no URL params) are rendered inline in <Routes> with App scope.

function EntityRouteAdapter() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const { capabilities } = useAuth()
  const { canConfigure } = useContext(AppShellContext)
  return (
    <EntityView
      slug={slug}
      onOpenCustomer={(id) => navigate(`/customer/${id}`)}
      onOpenPipeline={() => navigate('/lead-pipeline')}
      capabilities={capabilities}
      onBack={() => navigate(-1)}
      canConfigure={canConfigure}
    />
  )
}

function CustomerRouteAdapter() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { capabilities } = useAuth()
  const { canConfigure, pageConfigVersion } = useContext(AppShellContext)
  return (
    <CustomerView
      customerId={id}
      onBack={() => navigate(-1)}
      configVersion={pageConfigVersion}
      canConfigure={canConfigure}
      capabilities={capabilities}
      onOpenInvoices={(initialStatus) =>
        navigate(initialStatus ? `/invoices?status=${encodeURIComponent(initialStatus)}` : '/invoices')
      }
    />
  )
}

function StudioRouteAdapter() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { canConfigure } = useContext(AppShellContext)
  return (
    <StudioShell
      canConfigure={canConfigure}
      route={{
        group:  searchParams.get('group')  ?? undefined,
        module: searchParams.get('module') ?? undefined,
        leaf:   searchParams.get('leaf')   ?? undefined,
      }}
      onRoute={(r: StudioRoute) => {
        const p = new URLSearchParams()
        if (r.group)  p.set('group', r.group)
        if (r.module) p.set('module', r.module)
        if (r.leaf)   p.set('leaf', r.leaf)
        setSearchParams(p)
      }}
      onBack={() => navigate(-1)}
    />
  )
}

function InvoicesRouteAdapter() {
  const [searchParams] = useSearchParams()
  const { capabilities } = useAuth()
  const { canConfigure, pageConfigVersion } = useContext(AppShellContext)
  return (
    <InvoicesView
      canConfigure={canConfigure}
      configVersion={pageConfigVersion}
      initialStatus={searchParams.get('status') ?? undefined}
      capabilities={capabilities}
    />
  )
}

function HelpdeskRouteAdapter() {
  const [searchParams] = useSearchParams()
  const { capabilities } = useAuth()
  const { canConfigure, pageConfigVersion } = useContext(AppShellContext)
  return (
    <HelpdeskView
      canConfigure={canConfigure}
      configVersion={pageConfigVersion}
      capabilities={capabilities}
      initialStatus={searchParams.get('status') ?? undefined}
      openTicketId={searchParams.get('ticket') ?? undefined}
    />
  )
}

function ComingSoonRouteAdapter() {
  const { id = '' } = useParams()
  const [searchParams] = useSearchParams()
  return (
    <ComingSoonView
      id={id}
      title={searchParams.get('title') ?? ''}
      parent={searchParams.get('parent') ?? ''}
    />
  )
}

function ModuleRouteAdapter() {
  const { id = '' } = useParams()
  const [searchParams] = useSearchParams()
  return <ModuleStubView moduleId={id} moduleLabel={searchParams.get('label') ?? ''} />
}

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const {
    token, user, capabilities, entities, orgNodes,
    setToken, setUser, setCapabilities, setEntities, setOrgNodes, clearAuth,
  } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // Overlays — page Configure drawer (entity config or page-config flavor)
  const [cfgSlug, setCfgSlug] = useState<string | null>(null)
  const [cfgPageKey, setCfgPageKey] = useState<string | null>(null)
  const [pageConfigVersion, setPageConfigVersion] = useState(0)

  const canConfigure = !!user?.can_configure

  function openCustomer(id: string) { navigate(`/customer/${id}`) }

  const [email, setEmail] = useState('admin@demo.isp')
  const [password, setPassword] = useState('admin123')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [navOpen, setNavOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [accountModal, setAccountModal] = useState<'profile' | 'security' | 'shortcuts' | 'docs' | 'whatsnew' | null>(null)
  const { t, lang, setLang } = useI18n()

  const [navSections, setNavSections] = useState<NavSectionDef[]>(NAV_SECTIONS)
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(NAV_SECTIONS.filter((s) => s.defaultOpen).map((s) => s.id)),
  )

  useEffect(() => {
    if (!token) return
    // Dynamic nav loader is intentionally OFF: the static NAV_SECTIONS already
    // mirrors SPEC §1 exactly (9 groups, 71 items, [O]/[V] flags) AND carries
    // the viewType wiring that the dynamic loader can't yet generate. Re-enable
    // once /api/nav rows carry per-module viewType metadata.
    // eslint-disable-next-line no-console
    console.info('[nav] source=static (SPEC §1 layout)')
    void loadDynamicNav  // keep import live so tree-shaker doesn't remove the file
    return () => { /* noop */ }
  }, [token])

  function toggleSection(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setOpenSections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function navItemClick(item: NavItemDef, e: React.MouseEvent) {
    e.stopPropagation()
    if (!item.viewType) {
      navigate(`/module/${item.id}?label=${encodeURIComponent(item.label)}`)
      return
    }
    if (item.viewType === 'entity') {
      navigate(`/entity/${item.viewArgs!.slug}`)
      return
    }
    if (item.viewType === 'coming-soon') {
      const a = item.viewArgs!
      navigate(`/coming-soon/${a.id}?title=${encodeURIComponent(a.title)}&parent=${encodeURIComponent(a.parent)}`)
      return
    }
    navigate(item.viewType === 'home' ? '/' : `/${item.viewType}`)
  }

  function isItemActive(item: NavItemDef): boolean {
    const p = location.pathname
    if (!item.viewType) return p.startsWith('/module/') && p === `/module/${item.id}`
    if (item.viewType === 'home') return p === '/'
    if (item.viewType === 'entity') return p === `/entity/${item.viewArgs?.slug}`
    if (item.viewType === 'coming-soon') return p === `/coming-soon/${item.viewArgs?.id}`
    return p === `/${item.viewType}`
  }

  useEffect(() => { initI18n(token) }, [token])

  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('gaahex-theme') === 'light' ? 'light' : 'dark'),
  )
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('gaahex-theme', theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.setAttribute('data-density', 'comfortable')
    document.documentElement.removeAttribute('data-palette')
    document.documentElement.removeAttribute('data-gx-palette')
    localStorage.removeItem('gaahex-density')
    localStorage.removeItem('gaahex-palette')
    localStorage.removeItem('gaahex-gx-palette')
  }, [])

  // AC-3 — listen for centralized 401 events from the canonical API client
  // (frontend/src/lib/billing.ts). Any bget/bpost/etc. that hits a 401 dispatches
  // `gaahex:auth-401`; clearAuth() clears every piece of session state and
  // re-renders the login screen via the `if (!token)` gate below.
  useEffect(() => {
    const onAuth401 = () => { clearAuth(); navigate('/') }
    window.addEventListener('gaahex:auth-401', onAuth401)
    return () => window.removeEventListener('gaahex:auth-401', onAuth401)
  }, [clearAuth, navigate])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const t = await login(email, password)
      setToken(t)
      setUser(await me(t))
      setEntities(await getEntities(t))
      setOrgNodes((await orgTree()).nodes)
      fetchCapabilities(t).then(setCapabilities).catch(() => setCapabilities(FULL_ACCESS))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  function logout() {
    clearAuth()
    navigate('/')
    setNavSections(NAV_SECTIONS)
    setOpenSections(new Set(NAV_SECTIONS.filter((s) => s.defaultOpen).map((s) => s.id)))
  }

  if (!token) {
    return (
      <div className="login-wrap">
        <div className="login-brand">
          <img src="/logo/GAAhex-logo-reversed.svg" alt="GAAhex" style={{ height: 102, position: 'relative', zIndex: 1 }} />
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div className="gx-eyebrow" style={{ marginBottom: 14 }}>THE OPERATING SYSTEM FOR ISPs</div>
            <h1 style={{ fontFamily: 'var(--gx-font-display)', fontSize: 40, fontWeight: 600, lineHeight: 1.08, letterSpacing: '-.03em', margin: 0, maxWidth: 420 }}>
              Every department.<br />Every role.<br /><span style={{ color: 'var(--gx-gold)' }}>One system.</span>
            </h1>
            <ul style={{
              listStyle: 'none', padding: 0, margin: '22px 0 0',
              display: 'flex', flexDirection: 'column', gap: 6,
              fontFamily: 'var(--gx-font-display)',
              fontSize: 18, fontWeight: 500,
              color: 'var(--gx-text-1)',
              letterSpacing: '-.01em',
            }}>
              {['CRM', 'Billing', 'Network', 'Field Ops', 'Finance & More'].map((m) => (
                <li key={m} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    display: 'inline-block',
                    width: 4, height: 4,
                    background: 'var(--gx-gold)',
                    borderRadius: 'var(--gx-radius-full)',
                  }} />
                  {m}
                </li>
              ))}
            </ul>
          </div>
          <p style={{
            color: 'var(--gx-text-2)',
            fontSize: 14, lineHeight: 1.6, maxWidth: 380,
            margin: 0,
            position: 'relative', zIndex: 1,
          }}>
            Configurable modules and workflows<br />built for ISPs.
          </p>
        </div>
        <div className="login-card">
          <form className="login-form fade" onSubmit={handleLogin}>
            <h2 style={{ fontFamily: 'var(--gx-font-display)', fontSize: 24, fontWeight: 600, margin: '0 0 6px', letterSpacing: '-.02em' }}>{t('auth.signin', 'Sign in')}</h2>
            <p className="hint" style={{ margin: '0 0 24px' }}>Welcome back. Use your tenant credentials.</p>
            <label className="field" style={{ marginBottom: 14 }}>
              <span>{t('auth.email', 'Email')}</span>
              <input className={'inp' + (error ? ' inp-error' : '')} value={email} onChange={(e) => setEmail(e.target.value)} aria-label={t('auth.email', 'Email')} />
            </label>
            <label className="field" style={{ marginBottom: 8 }}>
              <span>{t('auth.password', 'Password')}</span>
              <div style={{ position: 'relative' }}>
                <input
                  className={'inp' + (error ? ' inp-error' : '')}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-label={t('auth.password', 'Password')}
                  style={{ paddingRight: 38, width: '100%' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? t('auth.hidePassword', 'Hide password') : t('auth.showPassword', 'Show password')}
                  title={showPassword ? t('auth.hidePassword', 'Hide password') : t('auth.showPassword', 'Show password')}
                  tabIndex={-1}
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    padding: 'var(--gx-space-2)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--gx-text-3)',
                    cursor: 'pointer',
                  }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '10px 0 22px' }}>
              <label style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5, color: 'var(--gx-text-2)' }}>
                <input type="checkbox" defaultChecked /> Remember me
              </label>
              <a className="btn-link" style={{ fontSize: 12.5, cursor: 'pointer' }}>Forgot password?</a>
            </div>
            {error && <p className="err" style={{ marginTop: -10, marginBottom: 14, color: 'var(--gx-danger-fg)', fontSize: 12.5 }}>{error}</p>}
            <Button variant="primary" size="lg"
            style={{ width: '100%' }} type="submit"><LogIn size={16} />{t('auth.signin', 'Sign in')}</Button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-4)', margin: '22px 0' }}>
              <div style={{ flex: 1, height: 1, background: 'var(--gx-border)' }} />
              <span className="hint" style={{ fontSize: 11 }}>or</span>
              <div style={{ flex: 1, height: 1, background: 'var(--gx-border)' }} />
            </div>
            <Button variant="secondary" size="lg"
            style={{ width: '100%' }} type="button"><Shield size={16} />Continue with SSO</Button>
            <p className="hint" style={{ marginTop: 18, fontSize: 11, textAlign: 'center' }}>demo: admin@demo.isp / admin123</p>
          </form>
        </div>
      </div>
    )
  }

  const extraEntities = entities.filter((e) => !BUILTIN_ENTITY_SLUGS.has(e.route_slug))

  return (
    <AppShellContext.Provider value={{ canConfigure, pageConfigVersion }}>
      <div className={'app' + (collapsed ? ' collapsed' : '') + (navOpen ? ' navopen' : '')}>
        <a href="#main-content" className="skip-link">Skip to content</a>
        {navOpen && (
          <div
            className="nav-scrim"
            role="button"
            tabIndex={-1}
            aria-label="Close navigation"
            onClick={() => setNavOpen(false)}
            onKeyDown={(e) => { if (e.key === 'Escape') setNavOpen(false) }}
          />
        )}
        <aside className="sb">
          <div className="sb-head">
            <img
              src={collapsed ? '/logo/GAAhex-mark-animated.svg' : '/logo/GAAhex-logo-reversed.svg'}
              alt="GAAhex"
              className="wm"
            />
          </div>

          <div className="sb-scroll">
            {navSections.filter((sec) => !sec.adminOnly || canConfigure).map((sec) => {
              const isOpen = openSections.has(sec.id)
              if (sec.standalone) {
                const synth: NavItemDef = { id: sec.id, label: sec.label, icon: sec.icon, viewType: sec.viewType }
                return (
                  <div key={sec.id} className="sb-sec">
                    <button
                      className={'sb-sec-btn' + (isItemActive(synth) ? ' on' : '')}
                      onClick={(e) => navItemClick(synth, e)}
                    >
                      <sec.icon size={16} />
                      <span>{sec.label}</span>
                    </button>
                  </div>
                )
              }
              return (
                <div key={sec.id} className="sb-sec">
                  <button
                    className={'sb-sec-btn' + (isOpen ? ' open' : '')}
                    onClick={(e) => toggleSection(sec.id, e)}
                    aria-expanded={isOpen}
                  >
                    <sec.icon size={16} />
                    <span>{sec.label}</span>
                    <ChevronRightIcon size={14} className="chev" />
                  </button>
                  {isOpen && (
                    <>
                      {sec.items.length > 0 && (
                        <div className="sb-items">
                          {sec.items.map((item) => (
                            <button
                              key={item.id}
                              className={'sb-item' + (isItemActive(item) ? ' on' : '')}
                              onClick={(e) => navItemClick(item, e)}
                            >
                              <span className="ic"><item.icon size={15} /></span>
                              <span>{item.label}</span>
                            </button>
                          ))}
                        </div>
                      )}

                      {sec.subsections?.map((sub) => {
                        const isAdminRecords = sec.id === 'admin_panel' && sub.id === 'admin_records'
                        const items: NavItemDef[] = isAdminRecords
                          ? extraEntities.map((en) => ({
                              id: `extra-${en.key}`,
                              label: en.label_plural,
                              icon: RowsIcon,
                              viewType: 'entity',
                              viewArgs: { slug: en.route_slug },
                            }))
                          : sub.items
                        if (items.length === 0) return null
                        const subKey = `${sec.id}/${sub.id}`
                        const subOpen = openSections.has(subKey)
                        return (
                          <div key={sub.id} className="sb-sec" style={{ paddingLeft: 8 }}>
                            <button
                              className={'sb-sec-btn' + (subOpen ? ' open' : '')}
                              onClick={(e) => toggleSection(subKey, e)}
                              aria-expanded={subOpen}
                              style={{ fontSize: 12, opacity: 0.85 }}
                            >
                              <sub.icon size={14} />
                              <span>{sub.label}</span>
                              <ChevronRightIcon size={12} className="chev" />
                            </button>
                            {subOpen && (
                              <div className="sb-items">
                                {items.map((item) => (
                                  <button
                                    key={item.id}
                                    className={'sb-item' + (isItemActive(item) ? ' on' : '')}
                                    onClick={(e) => navItemClick(item, e)}
                                  >
                                    <span className="ic"><item.icon size={15} /></span>
                                    <span>{item.label}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </>
                  )}
                </div>
              )
            })}
          </div>

        </aside>

        <div className="main">
          <header className="tb">
            <div className="tb-tools">
              <button
                className="tb-icon"
                aria-label="Toggle sidebar"
                onClick={() => {
                  if (window.matchMedia('(max-width: 900px)').matches) setNavOpen((o) => !o)
                  else setCollapsed((c) => !c)
                }}
              >
                <PanelLeft size={18} />
              </button>
              <NotificationBell
                entities={entities}
                onOpen={(slug) => navigate(`/entity/${slug}`)}
                onViewAll={() => navigate('/notifications')}
              />
              <TopbarMenu
                icon={<Mail size={18} />}
                itemIcon={<Mail size={16} />}
                title={t('common.email', 'Email')}
                emptyLabel={t('email.empty', 'No new emails')}
                viewAllLabel={t('common.viewAll', 'View all')}
                onViewAll={() => navigate('/messages')}
                items={[
                  { title: 'Մելքոնյան Շուշան', body: 'WiFi ծածկույթ 2-րդ հարկում', time: '2ժ' },
                  { title: 'Erebuni IT Solutions', body: 'Պայմանագրի երկարաձգում', time: '5ժ' },
                  { title: 'Հակոբյան Արամ', body: 'Նոր փաթեթի հարցում', time: '1օր' },
                  { title: 'Tumo Center', body: 'Enterprise կապի հարց', time: '1օր' },
                  { title: 'Սարգսյան Լիլիթ', body: 'Հաշիվ-ապրանքագիր #1042', time: '2օր' },
                ]}
              />
              <TopbarMenu
                icon={<MessageCircle size={18} />}
                itemIcon={<MessageCircle size={16} />}
                title={t('common.messenger', 'Messenger')}
                emptyLabel={t('messenger.empty', 'No new messages')}
                viewAllLabel={t('common.viewAll', 'View all')}
                onViewAll={() => navigate('/messages')}
                items={[
                  { title: 'Tigran Auto', body: 'Երբ կգաք տեղադրման?', time: '10ր' },
                  { title: 'Ավագյան Նարեկ', body: 'Շնորհակալություն 🙏', time: '1ժ' },
                  { title: 'Davit Group', body: 'Office link-ի կարգավիճակ?', time: '4ժ' },
                  { title: 'Մարտիրոսյան Գոռ', body: 'Վճարումը կատարված է', time: '1օր' },
                  { title: 'Aren Tech', body: 'Fiber quote-ի հարց', time: '2օր' },
                ]}
              />
              <TopbarMenu
                icon={<Calendar size={18} />}
                itemIcon={<Calendar size={16} />}
                title={t('common.calendar', 'Calendar')}
                emptyLabel={t('calendar.empty', 'No upcoming events')}
                viewAllLabel={t('common.viewAll', 'View all')}
                onViewAll={() => navigate('/calendar')}
                items={[
                  { title: 'Team sync', body: 'Weekly standup', time: '10:00' },
                  { title: 'Customer call', body: 'Tumo Center onboarding', time: '14:00' },
                  { title: 'Network maintenance', body: 'Scheduled downtime', time: 'Tomorrow' },
                ]}
              />
              <LangMenu />
              <button
                className="tb-icon"
                aria-label={theme === 'dark' ? t('common.themeLight', 'Light theme') : t('common.themeDark', 'Dark theme')}
                title={theme === 'dark' ? t('common.themeLight', 'Light theme') : t('common.themeDark', 'Dark theme')}
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              >
                {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
              </button>
            </div>

            <span className="spacer" />
            <OrgIdentity />

            {user && (
              <UserMenu
                user={user}
                onSignOut={logout}
              />
            )}
          </header>

          <main id="main-content" className="view">
            <ErrorBoundary>
              <Routes>
                <Route path="/"                   element={<HomeView capabilities={capabilities} onNavigate={(type, id) => {
                  if (type === 'workitems') navigate('/workitems')
                  else if (type === 'mytasks') navigate('/mytasks')
                  else if (type === 'my-approvals') navigate('/my-approvals')
                  else if (type === 'helpdesk') navigate(id ? `/helpdesk?ticket=${encodeURIComponent(id)}` : '/helpdesk')
                  else if (type === 'entity' && id) navigate(`/entity/${id}`)
                }} />} />
                <Route path="/org"                element={<OrgView nodes={orgNodes} configVersion={pageConfigVersion} canConfigure={canConfigure} onRefresh={async () => setOrgNodes((await orgTree()).nodes)} />} />
                <Route path="/dashboards"         element={<DashboardView configVersion={pageConfigVersion} canConfigure={canConfigure} capabilities={capabilities} onNavigate={(target) => {
                  if (target.type === 'subscriptions') navigate('/subscriptions')
                  else if (target.type === 'invoices') navigate('/invoices')
                  else if (target.type === 'helpdesk') navigate('/helpdesk')
                  else if (target.type === 'workitems') navigate('/workitems')
                }} />} />
                <Route path="/analytics"          element={<AnalyticsView configVersion={pageConfigVersion} canConfigure={canConfigure} />} />
                <Route path="/lead-pipeline"      element={<PipelineView onOpenCustomer={openCustomer} canConfigure={canConfigure} capabilities={capabilities} />} />
                <Route path="/ask"                element={<AskGaaexView />} />
                <Route path="/messages"           element={<MessagesView capabilities={capabilities} />} />
                <Route path="/mail"               element={<MailRouteAdapter />} />
                <Route path="/notifications"      element={<NotificationsView />} />
                <Route path="/profile"            element={<ProfileView />} />
                <Route path="/activity-feed"      element={<ActivityFeedView onNavigate={(target) => {
                  if (target.type === 'helpdesk') navigate(`/helpdesk?ticket=${encodeURIComponent(target.openTicketId ?? '')}`)
                  else if (target.type === 'entity') navigate(`/entity/${target.slug}`)
                }} />} />
                <Route path="/activity"           element={<Navigate to="/activity-feed" replace />} />
                <Route path="/my-approvals"       element={<MyApprovalsView />} />
                <Route path="/team-workspace"     element={<TeamWorkspaceView />} />
                <Route path="/network-topology"   element={<NetworkTopologyView />} />
                <Route path="/network-inventory"  element={<NetworkInventoryView canConfigure={canConfigure} capabilities={capabilities} />} />
                <Route path="/provisioning"       element={<ProvisioningView />} />
                <Route path="/dispatch-board"     element={<DispatchBoardView />} />
                <Route path="/installation-board" element={<InstallationBoardView canConfigure={canConfigure} capabilities={capabilities} />} />
                <Route path="/coverage-gis"       element={<CoverageView />} />
                <Route path="/noc-dashboard"      element={<NocDashboardView canConfigure={canConfigure} capabilities={capabilities} />} />
                <Route path="/saved-views"        element={<SavedViewsView onOpenEntity={(slug) => navigate(`/entity/${slug}`)} />} />
                <Route path="/payments"           element={<PaymentsView canConfigure={canConfigure} configVersion={pageConfigVersion} />} />
                <Route path="/payment-methods"    element={<PaymentMethodsView canConfigure={canConfigure} capabilities={capabilities} />} />
                <Route path="/gateway"            element={<PaymentGatewayView canConfigure={canConfigure} configVersion={pageConfigVersion} />} />
                <Route path="/subscriptions"      element={<SubscriptionsView canConfigure={canConfigure} configVersion={pageConfigVersion} />} />
                <Route path="/products"           element={<ProductsView canConfigure={canConfigure} configVersion={pageConfigVersion} />} />
                <Route path="/tariff-plans"       element={<TariffPlansView canConfigure={canConfigure} capabilities={capabilities} />} />
                <Route path="/webhooks"           element={<WebhooksView canConfigure={canConfigure} configVersion={pageConfigVersion} onConfigure={() => setCfgPageKey('webhooks')} />} />
                <Route path="/services"           element={<ServicesView canConfigure={canConfigure} configVersion={pageConfigVersion} capabilities={capabilities} />} />
                <Route path="/usage"              element={<UsageView canConfigure={canConfigure} configVersion={pageConfigVersion} />} />
                <Route path="/resource-pools"     element={<ResourcePoolsView canConfigure={canConfigure} configVersion={pageConfigVersion} />} />
                <Route path="/accounts"           element={<AccountsView canConfigure={canConfigure} configVersion={pageConfigVersion} />} />
                <Route path="/workitems"          element={<WorkItemsView canConfigure={canConfigure} configVersion={pageConfigVersion} />} />
                <Route path="/mytasks"            element={<MyTasksView canConfigure={canConfigure} onNavigate={(t) => { if (t === 'home') navigate('/') }} />} />
                <Route path="/customer-tasks"     element={<CustomerTasksView />} />
                <Route path="/calendar"           element={<CalendarView configVersion={pageConfigVersion} canConfigure={canConfigure} />} />
                <Route path="/settings"           element={<SettingsView />} />
                <Route path="/reports"            element={<ReportsView configVersion={pageConfigVersion} canConfigure={canConfigure} capabilities={capabilities} />} />
                <Route path="/orders"             element={<OrdersView capabilities={capabilities} />} />
                <Route path="/revenue-assurance"  element={<RevenueAssuranceView configVersion={pageConfigVersion} canConfigure={canConfigure} capabilities={capabilities} />} />
                <Route path="/collections"        element={<CollectionsView canConfigure={canConfigure} capabilities={capabilities} />} />
                {/* Param-bearing routes use module-level adapters */}
                <Route path="/invoices"           element={<InvoicesRouteAdapter />} />
                <Route path="/helpdesk"           element={<HelpdeskRouteAdapter />} />
                <Route path="/entity/:slug"       element={<EntityRouteAdapter />} />
                <Route path="/customer/:id"       element={<CustomerRouteAdapter />} />
                <Route path="/studio"             element={<StudioRouteAdapter />} />
                <Route path="/coming-soon/:id"    element={<ComingSoonRouteAdapter />} />
                <Route path="/module/:id"         element={<ModuleRouteAdapter />} />
                <Route path="*"                   element={<Navigate to="/" replace />} />
              </Routes>
            </ErrorBoundary>
          </main>
        </div>

        {cfgSlug && (
          <ConfigureDrawer
            slug={cfgSlug}
            entities={entities}
            onClose={() => setCfgSlug(null)}
            onSwitchPage={(slug) => {
              navigate(slug === 'leads' ? '/lead-pipeline' : `/entity/${slug}`)
              setCfgSlug(slug)
            }}
          />
        )}

        {cfgPageKey && (
          <ConfigureDrawer
            pageKey={cfgPageKey}
            entities={entities}
            onClose={() => setCfgPageKey(null)}
            onSaved={() => setPageConfigVersion((v) => v + 1)}
          />
        )}

        <ProfileModal
          open={accountModal === 'profile'}
          onClose={() => setAccountModal(null)}
          name={user?.name ?? ''}
          email={user?.email ?? ''}
          avatarUrl={user?.avatar_url ?? null}
          onAvatarChange={(avatar_url) => setUser((u) => (u ? { ...u, avatar_url } : u))}
        />
        <SecurityModal
          open={accountModal === 'security'}
          onClose={() => setAccountModal(null)}
        />
        <ShortcutsModal open={accountModal === 'shortcuts'} onClose={() => setAccountModal(null)} />
        <DocsModal open={accountModal === 'docs'} onClose={() => setAccountModal(null)} />
        <WhatsNewModal open={accountModal === 'whatsnew'} onClose={() => setAccountModal(null)} />
      </div>
    </AppShellContext.Provider>
  )
}

// ─── ModuleStubView ───────────────────────────────────────────────────────────

function ModuleStubView({ moduleId, moduleLabel }: { moduleId: string; moduleLabel: string }) {
  void moduleId
  return (
    <div className="view">
      <div className="view-inner section-page fade">
        <div className="crumbs">
          <span style={{ color: 'var(--gx-text-1)' }}>{moduleLabel}</span>
        </div>
        <div className="view-head">
          <div className="view-icon"><ServerIcon size={20} /></div>
          <div className="view-title-wrap">
            <h2>{moduleLabel}</h2>
            <span className="view-sub">Coming soon</span>
          </div>
        </div>
        <div style={{
          marginTop: 60, padding: '40px 20px', textAlign: 'center',
          background: 'var(--gx-surface)',
          border: '1px solid var(--gx-border)',
          borderRadius: 'var(--gx-radius-lg)',
          maxWidth: 540, marginLeft: 'auto', marginRight: 'auto',
        }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--gx-text-1)', marginBottom: 8 }}>
            {moduleLabel}
          </div>
          <div style={{ fontSize: 13, color: 'var(--gx-text-3)' }}>
            This page hasn't been built yet.
          </div>
        </div>
      </div>
    </div>
  )
}
