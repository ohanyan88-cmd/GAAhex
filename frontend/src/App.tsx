import { Button } from './primitives'
import { useEffect, useState } from 'react'
import { login, me, getEntities, orgTree } from './lib/api'
import ErrorBoundary from './components/ErrorBoundary'
import EntityView from './views/EntityView'
import StudioShell, { type StudioRoute } from './studio/StudioShell'
import ReportsView from './views/ReportsView'
import DashboardView from './views/DashboardView'
import MessagesView from './views/MessagesView'
import NotificationBell from './components/NotificationBell'
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
import CustomersListView from './views/CustomersListView'
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
import { useI18n, initI18n, type Lang } from './lib/i18n'
import { RowsIcon, ChevronRightIcon, ServerIcon } from './components/icons'
import { PanelLeft, Wand, LogIn, Shield, Eye, EyeOff, Sun, Moon, Mail, MessageCircle } from 'lucide-react'
import { fetchCapabilities, FULL_ACCESS, type Capabilities } from './lib/capabilities'
import { useAuth } from './context/AuthContext'
import ProfileModal from './modals/ProfileModal'
import SecurityModal from './modals/SecurityModal'
import { ShortcutsModal, DocsModal, WhatsNewModal } from './modals/SupportModals'

type Me = { email: string; name: string; can_configure?: boolean; avatar_url?: string | null }
type Entity = { key: string; label: string; label_plural: string; route_slug: string }
type OrgNode = { id: string; type: string; name: string; path: string; code?: string; parent_id?: string | null }
type View =
  | { type: 'org' }
  | { type: 'entity'; slug: string }
  | { type: 'studio'; focusSlug?: string; group?: string; module?: string; leaf?: string }
  | { type: 'home' }
  | { type: 'reports' }
  | { type: 'dashboards' }
  | { type: 'messages' }
  | { type: 'activity' }
  | { type: 'my-approvals' }
  | { type: 'saved-views' }
  | { type: 'activity-feed' }
  | { type: 'invoices'; initialStatus?: string }
  | { type: 'payments' }
  | { type: 'payment-methods' }
  | { type: 'subscriptions' }
  | { type: 'products' }
  | { type: 'tariff-plans' }
  | { type: 'usage' }
  | { type: 'webhooks' }
  | { type: 'services' }
  | { type: 'resource-pools' }
  | { type: 'accounts' }
  | { type: 'analytics' }
  | { type: 'lead-pipeline' }
  | { type: 'customer'; id: string }
  | { type: 'ask' }
  | { type: 'settings' }
  | { type: 'calendar' }
  | { type: 'helpdesk'; initialStatus?: string; initialOpenTicketId?: string }
  | { type: 'workitems' }
  | { type: 'mytasks' }
  | { type: 'customer-tasks' }
  | { type: 'gateway' }
  | { type: 'orders' }
  | { type: 'revenue-assurance' }
  | { type: 'collections' }
  | { type: 'team-workspace' }
  | { type: 'network-topology' }
  | { type: 'network-inventory' }
  | { type: 'provisioning' }
  | { type: 'dispatch-board' }
  | { type: 'installation-board' }
  | { type: 'coverage-gis' }
  | { type: 'noc-dashboard' }
  | { type: 'coming-soon'; id: string; title: string; parent: string }
  | { type: 'module-stub'; moduleId: string; moduleLabel: string }

// Entity slugs that have dedicated nav-config items; others surface as extra Records
const BUILTIN_ENTITY_SLUGS = new Set(['customers', 'contacts', 'tickets', 'users'])

// Bespoke (non-entity) views that opt into "configure in place" — view.type → page-config key.
// Add a view.type here (and register the page in pageConfig.ts) to light up its Configure button +
// page-settings drawer. Template stage: Services only.
const BESPOKE_PAGE_KEYS: Partial<Record<View['type'], string>> = {
  services: 'services',
  invoices: 'invoices',
  payments: 'payments',
  subscriptions: 'subscriptions',
  accounts: 'accounts',
  products: 'products',
  usage: 'usage',
  webhooks: 'webhooks',
  'resource-pools': 'resource-pools',
  // Title-only pages.
  dashboards: 'dashboards',
  analytics: 'analytics',
  org: 'org',
  gateway: 'gateway',
  customer: 'customer',
  reports: 'reports',
  calendar: 'calendar',
  mytasks: 'mytasks',
  'my-approvals': 'my-approvals',
  'activity-feed': 'activity-feed',
  'saved-views': 'saved-views',
  // Table-capable pages.
  helpdesk: 'helpdesk',
  workitems: 'workitems',
  // Wave A §3 pages.
  'revenue-assurance': 'revenue-assurance',
}


export default function App() {
  // SM-1 — auth state (token, user, capabilities, entities, orgNodes) lives in
  // AuthContext now. App.tsx still drives login/logout but reads/writes through
  // the context so views can migrate to useAuth() incrementally.
  const {
    token, user, capabilities, entities, orgNodes,
    setToken, setUser, setCapabilities, setEntities, setOrgNodes, clearAuth,
  } = useAuth()
  const [view, setView] = useState<View>({ type: 'home' })
  const [prevView, setPrevView] = useState<View>({ type: 'home' })
  const [customerReturn, setCustomerReturn] = useState<View>({ type: 'home' })
  const [cfgSlug, setCfgSlug] = useState<string | null>(null)   // open the in-place Configure drawer for this entity slug
  const [cfgPageKey, setCfgPageKey] = useState<string | null>(null)   // …or for this bespoke page (page-config, not an entity)
  const [pageConfigVersion, setPageConfigVersion] = useState(0)   // bumped on a page-config save so the live view re-reads it

  function openCustomer(id: string) { setCustomerReturn(view); setView({ type: 'customer', id }) }

  // The config-entity slug for the current page (undefined ⇒ not an entity-config page).
  const configSlug: string | undefined =
    view.type === 'entity' ? (view as { type: 'entity'; slug: string }).slug
    : view.type === 'lead-pipeline' ? 'leads'
    : entities.some((e) => e.route_slug === (view as { type: string }).type) ? (view as { type: string }).type
    : undefined

  // The page-config key for the current bespoke page (undefined ⇒ not a page-config page).
  // Distinct from configSlug: this opens the drawer's "Page settings" pane, not entity Fields/Workflows.
  const pageConfigKey: string | undefined = configSlug ? undefined : BESPOKE_PAGE_KEYS[view.type]

  // Either kind of config makes the header "Configure page" button appear.
  const canConfigureThisPage = configSlug != null || pageConfigKey != null

  // Gear button → save current page, open Studio. Back button restores the saved page.
  const openConfigure = () => { setPrevView(view); setView({ type: 'studio' }) }
  const backFromStudio = () => setView(prevView)

  const [email, setEmail] = useState('admin@demo.isp')
  const [password, setPassword] = useState('admin123')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [navOpen, setNavOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  // Account-menu modals (My Profile, Security, and SUPPORT items).
  const [accountModal, setAccountModal] = useState<'profile' | 'security' | 'shortcuts' | 'docs' | 'whatsnew' | null>(null)
  const { t, lang, setLang } = useI18n()

  // SPEC §1 dynamic nav: attempt to load the nav tree from GAAhex /api/nav after
  // login; fall back to the static NAV_SECTIONS if the endpoint isn't reachable
  // or returns nothing usable. The static config stays bundled so the UI is
  // never blank.
  const [navSections, setNavSections] = useState<NavSectionDef[]>(NAV_SECTIONS)

  // Collapsible nav section state — pre-open sections marked defaultOpen in nav-config
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(NAV_SECTIONS.filter((s) => s.defaultOpen).map((s) => s.id)),
  )

  // After login, try the dynamic nav endpoint. Success ⇒ swap in the live tree
  // and re-seed openSections from its defaultOpen markers. Failure ⇒ keep the
  // static fallback.
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
      setView({ type: 'module-stub', moduleId: item.id, moduleLabel: item.label })
      return
    }
    if (item.viewType === 'entity') {
      setView({ type: 'entity', slug: item.viewArgs!.slug })
      return
    }
    if (item.viewType === 'coming-soon') {
      const a = item.viewArgs!
      setView({ type: 'coming-soon', id: a.id, title: a.title, parent: a.parent })
      return
    }
    setView({ type: item.viewType } as View)
  }

  function isItemActive(item: NavItemDef): boolean {
    if (!item.viewType) {
      return view.type === 'module-stub' && (view as { type: 'module-stub'; moduleId: string }).moduleId === item.id
    }
    if (item.viewType === 'entity') {
      return view.type === 'entity' && (view as { type: 'entity'; slug: string }).slug === item.viewArgs?.slug
    }
    if (item.viewType === 'coming-soon') {
      return view.type === 'coming-soon' && (view as { type: 'coming-soon'; id: string }).id === item.viewArgs?.id
    }
    return view.type === item.viewType
  }

  useEffect(() => { initI18n(token) }, [token])

  // theme + setTheme are consumed by the user-menu theme toggle (P5 UserMenu).
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
  // `gaahex:auth-401`; clearAuth() (from AuthContext) clears every piece of
  // session state and re-renders the login screen via the `if (!token)` gate
  // below. View state (current page, drawers) is App-local and reset here.
  useEffect(() => {
    const onAuth401 = () => {
      clearAuth()
      setView({ type: 'home' })
    }
    window.addEventListener('gaahex:auth-401', onAuth401)
    return () => window.removeEventListener('gaahex:auth-401', onAuth401)
  }, [clearAuth])

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
    setView({ type: 'home' })
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


  // Entities not covered by built-in nav items (Studio-created custom entities)
  const extraEntities = entities.filter((e) => !BUILTIN_ENTITY_SLUGS.has(e.route_slug))

  const breadcrumbLabel = view.type === 'entity'
    ? (view as { type: 'entity'; slug: string }).slug
    : view.type === 'module-stub'
      ? (view as { type: 'module-stub'; moduleLabel: string }).moduleLabel
      : view.type

  return (
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
            src={collapsed ? '/logo/GAAhex-mark.svg' : '/logo/GAAhex-logo-reversed.svg'}
            alt="GAAhex"
            className="wm"
          />
        </div>

        <div className="sb-scroll">
          {navSections.filter((sec) => !sec.adminOnly || !!user?.can_configure).map((sec) => {
            const isOpen = openSections.has(sec.id)
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
                    {/* Direct leaf items */}
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

                    {/* Nested sub-sections (one level deep). Used by Admin Panel to house
                        Records (auto-injected from extraEntities) + System + Dev Internals + Studio. */}
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
                      if (items.length === 0) return null  // hide empty subsections (e.g. Records when no custom entities)
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
        {/* P2: new topbar layout — [sidebar toggle][OrgIdentity] ...spacer... [Bell][UserMenu].
            The three right-of-toggle slots render placeholder skeletons here; they get real
            implementations in P3 (OrgIdentity), P4 (NotificationBell), P5 (UserMenu). */}
        <header className="tb">
          <button
            className="tb-icon"
            aria-label="Toggle sidebar"
            onClick={() => {
              // On narrow screens the sidebar is an off-canvas drawer (navOpen).
              // On wide screens it collapses to the icon rail (collapsed).
              if (window.matchMedia('(max-width: 900px)').matches) setNavOpen((o) => !o)
              else setCollapsed((c) => !c)
            }}
          >
            <PanelLeft size={18} />
          </button>

          <OrgIdentity token={token!} />

          <span className="spacer" />

          {/* Topbar quick tools — Email · Messenger · Language · Theme, beside the bell. */}
          <div className="tb-tools">
            <button className="tb-icon" aria-label={t('common.email', 'Email')} title={t('common.email', 'Email')}>
              <Mail size={18} />
            </button>
            <button className="tb-icon" aria-label={t('common.messenger', 'Messenger')} title={t('common.messenger', 'Messenger')}>
              <MessageCircle size={18} />
            </button>
            <div className="lang-switch" role="group" aria-label={t('common.language', 'Language')}>
              {(['en', 'hy', 'ru'] as Lang[]).map((l) => (
                <button
                  key={l}
                  className={'lang-opt' + (lang === l ? ' on' : '')}
                  onClick={() => setLang(l)}
                  aria-pressed={lang === l}
                >
                  {l === 'en' ? 'EN' : l === 'hy' ? 'AM' : 'RU'}
                </button>
              ))}
            </div>
            <button
              className="tb-icon"
              aria-label={theme === 'dark' ? t('common.themeLight', 'Light theme') : t('common.themeDark', 'Dark theme')}
              title={theme === 'dark' ? t('common.themeLight', 'Light theme') : t('common.themeDark', 'Dark theme')}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>

          <NotificationBell
            token={token!}
            entities={entities}
            onOpen={(slug) => setView({ type: 'entity', slug })}
          />

          {user && (
            <UserMenu
              user={user}
              theme={theme}
              onThemeChange={setTheme}
              onSignOut={logout}
              onOpenModal={(k) => setAccountModal(k)}
              lang={lang}
              onLangChange={setLang}
            />
          )}
        </header>
        <main id="main-content" className="view">
          <ErrorBoundary>
            {view.type === 'org'
              ? <OrgView
                  nodes={orgNodes}
                  configVersion={pageConfigVersion}
                  token={token}
                  canConfigure={!!user?.can_configure}
                  onRefresh={async () => setOrgNodes((await orgTree()).nodes)}
                 
                />
              : view.type === 'home'
                ? <HomeView
                    token={token}
                    capabilities={capabilities}
                    onNavigate={(type, id) => {
                      if (type === 'workitems') setView({ type: 'workitems' })
                      else if (type === 'mytasks') setView({ type: 'mytasks' })
                      else if (type === 'my-approvals') setView({ type: 'my-approvals' })
                      else if (type === 'helpdesk') setView({ type: 'helpdesk', initialOpenTicketId: id })
                      else if (type === 'entity' && id) setView({ type: 'entity', slug: id })
                    }}
                  />
              : view.type === 'dashboards'
                ? <DashboardView
                    configVersion={pageConfigVersion}
                    canConfigure={!!user?.can_configure}
                    capabilities={capabilities}
                    onNavigate={(target) => {
                      if (target.type === 'subscriptions') setView({ type: 'subscriptions' })
                      else if (target.type === 'invoices') setView({ type: 'invoices' })
                      else if (target.type === 'helpdesk') setView({ type: 'helpdesk' })
                      else if (target.type === 'workitems') setView({ type: 'workitems' })
                    }}
                  />
              : view.type === 'analytics'
                ? <AnalyticsView token={token} configVersion={pageConfigVersion} canConfigure={!!user?.can_configure} />
              : view.type === 'lead-pipeline'
                ? <PipelineView token={token} onOpenCustomer={openCustomer} canConfigure={!!user?.can_configure} capabilities={capabilities} />
              : view.type === 'customer'
                ? <CustomerView token={token} customerId={view.id} onBack={() => setView(customerReturn)} configVersion={pageConfigVersion} canConfigure={!!user?.can_configure} capabilities={capabilities} onOpenInvoices={(initialStatus) => setView({ type: 'invoices', initialStatus })} />
              : view.type === 'ask'
                ? <AskGaaexView token={token} />
              : view.type === 'messages'
                ? <MessagesView token={token} capabilities={capabilities} />
              : view.type === 'activity' || view.type === 'activity-feed'
                ? <ActivityFeedView
                    token={token}
                    onNavigate={(target) => {
                      if (target.type === 'helpdesk') {
                        setView({ type: 'helpdesk', initialOpenTicketId: target.openTicketId })
                      } else if (target.type === 'entity') {
                        setView({ type: 'entity', slug: target.slug })
                      }
                    }}
                  />
              : view.type === 'my-approvals'
                ? <MyApprovalsView token={token} />
              : view.type === 'team-workspace'
                ? <TeamWorkspaceView token={token} />
              : view.type === 'network-topology'
                ? <NetworkTopologyView token={token} />
              : view.type === 'network-inventory'
                ? <NetworkInventoryView token={token} canConfigure={!!user?.can_configure} capabilities={capabilities} />
              : view.type === 'provisioning'
                ? <ProvisioningView token={token} />
              : view.type === 'dispatch-board'
                ? <DispatchBoardView token={token} />
              : view.type === 'installation-board'
                ? <InstallationBoardView token={token} canConfigure={!!user?.can_configure} capabilities={capabilities} />
              : view.type === 'coverage-gis'
                ? <CoverageView token={token} />
              : view.type === 'noc-dashboard'
                ? <NocDashboardView token={token} canConfigure={!!user?.can_configure} capabilities={capabilities} />
              : view.type === 'saved-views'
                ? <SavedViewsView token={token} onOpenEntity={(slug) => setView({ type: 'entity', slug })} />
              : view.type === 'invoices'
                ? <InvoicesView token={token} canConfigure={!!user?.can_configure} configVersion={pageConfigVersion} initialStatus={view.initialStatus} capabilities={capabilities} />
              : view.type === 'payments'
                ? <PaymentsView token={token} canConfigure={!!user?.can_configure} configVersion={pageConfigVersion} />
              : view.type === 'payment-methods'
                ? <PaymentMethodsView token={token} canConfigure={!!user?.can_configure} capabilities={capabilities} />
              : view.type === 'gateway'
                ? <PaymentGatewayView token={token} canConfigure={!!user?.can_configure} configVersion={pageConfigVersion} />
              : view.type === 'subscriptions'
                ? <SubscriptionsView token={token} canConfigure={!!user?.can_configure} configVersion={pageConfigVersion} />
              : view.type === 'products'
                ? <ProductsView token={token} canConfigure={!!user?.can_configure} configVersion={pageConfigVersion} />
              : view.type === 'tariff-plans'
                ? <TariffPlansView token={token} canConfigure={!!user?.can_configure} capabilities={capabilities} />
              : view.type === 'webhooks'
                ? <WebhooksView token={token} canConfigure={!!user?.can_configure} configVersion={pageConfigVersion} onConfigure={() => setCfgPageKey('webhooks')} />
              : view.type === 'services'
                ? <ServicesView token={token} canConfigure={!!user?.can_configure} configVersion={pageConfigVersion} capabilities={capabilities} />
              : view.type === 'usage'
                ? <UsageView token={token} canConfigure={!!user?.can_configure} configVersion={pageConfigVersion} />
              : view.type === 'resource-pools'
                ? <ResourcePoolsView token={token} canConfigure={!!user?.can_configure} configVersion={pageConfigVersion} />
              : view.type === 'accounts'
                ? <AccountsView token={token} canConfigure={!!user?.can_configure} configVersion={pageConfigVersion} />
              : view.type === 'helpdesk'
                ? <HelpdeskView token={token} canConfigure={!!user?.can_configure} configVersion={pageConfigVersion} capabilities={capabilities} initialStatus={view.initialStatus} openTicketId={view.initialOpenTicketId} />
              : view.type === 'workitems'
                ? <WorkItemsView token={token} canConfigure={!!user?.can_configure} configVersion={pageConfigVersion} />
              : view.type === 'mytasks'
                ? <MyTasksView token={token} canConfigure={!!user?.can_configure} onNavigate={(t) => { if (t === 'home') setView({ type: 'home' }) }} />
              : view.type === 'customer-tasks'
                ? <CustomerTasksView token={token} />
              : view.type === 'calendar'
                ? <CalendarView token={token} configVersion={pageConfigVersion} canConfigure={!!user?.can_configure} />
              : view.type === 'settings'
                ? <SettingsView token={token} />
              : view.type === 'reports'
                ? <ReportsView token={token} configVersion={pageConfigVersion} canConfigure={!!user?.can_configure} capabilities={capabilities} />
              : view.type === 'orders'
                ? <OrdersView token={token} capabilities={capabilities} />
              : view.type === 'revenue-assurance'
                ? <RevenueAssuranceView token={token} configVersion={pageConfigVersion} canConfigure={!!user?.can_configure} capabilities={capabilities} />
              : view.type === 'collections'
                ? <CollectionsView token={token} canConfigure={!!user?.can_configure} capabilities={capabilities} />
              : view.type === 'studio'
                ? <StudioShell
                    token={token}
                    canConfigure={!!user?.can_configure}
                    route={{ group: view.group, module: view.module, leaf: view.leaf }}
                    onRoute={(r: StudioRoute) => setView({ type: 'studio', group: r.group, module: r.module, leaf: r.leaf })}
                    onBack={backFromStudio}
                  />
              : view.type === 'coming-soon'
                ? <ComingSoonView title={view.title} parent={view.parent} id={view.id} />
              : view.type === 'module-stub'
                ? <ModuleStubView moduleId={view.moduleId} moduleLabel={view.moduleLabel} />
              : <EntityView token={token} slug={(view as { slug: string }).slug} onOpenCustomer={openCustomer} onOpenPipeline={() => setView({ type: 'lead-pipeline' })} capabilities={capabilities} onBack={() => setView({ type: 'org' })} canConfigure={!!user?.can_configure} />}
          </ErrorBoundary>
        </main>
      </div>

      {cfgSlug && (
        <ConfigureDrawer
          token={token}
          slug={cfgSlug}
          entities={entities}
          onClose={() => setCfgSlug(null)}
          onSwitchPage={(slug) => {
            setView(slug === 'leads' ? { type: 'lead-pipeline' } : { type: 'entity', slug })
            setCfgSlug(slug)
          }}
        />
      )}

      {/* Page-config drawer for bespoke pages (Services): same shell, "Page settings" pane. */}
      {cfgPageKey && (
        <ConfigureDrawer
          token={token}
          pageKey={cfgPageKey}
          entities={entities}
          onClose={() => setCfgPageKey(null)}
          onSaved={() => setPageConfigVersion((v) => v + 1)}
        />
      )}

      {/* Account-menu modals (personal scope only). */}
      <ProfileModal
        open={accountModal === 'profile'}
        onClose={() => setAccountModal(null)}
        token={token}
        name={user?.name ?? ''}
        email={user?.email ?? ''}
        avatarUrl={user?.avatar_url ?? null}
        onAvatarChange={(avatar_url) => setUser((u) => (u ? { ...u, avatar_url } : u))}
      />
      <SecurityModal
        open={accountModal === 'security'}
        onClose={() => setAccountModal(null)}
        token={token}
      />
      <ShortcutsModal open={accountModal === 'shortcuts'} onClose={() => setAccountModal(null)} />
      <DocsModal open={accountModal === 'docs'} onClose={() => setAccountModal(null)} />
      <WhatsNewModal open={accountModal === 'whatsnew'} onClose={() => setAccountModal(null)} />
    </div>
  )
}

function ModuleStubView({ moduleId, moduleLabel }: { moduleId: string; moduleLabel: string }) {
  // SPEC §1 modules that don't have a GAAhex view yet land here. Honest "coming soon" message,
  // no scary "not enabled for this tenant" copy (that read as a config problem when it's just
  // "this page hasn't been built yet").
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
