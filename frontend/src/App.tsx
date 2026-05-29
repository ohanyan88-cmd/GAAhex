import { useEffect, useState } from 'react'
import { login, me, getEntities, orgTree } from './api'
import ErrorBoundary from './ErrorBoundary'
import EntityView from './EntityView'
import StudioView from './StudioView'
import ReportsView from './ReportsView'
import DashboardView from './DashboardView'
import MessagesView from './MessagesView'
import NotificationCenter from './NotificationCenter'
import ConfigureDrawer from './ConfigureDrawer'
import ActivityTimeline from './ActivityTimeline'
import InvoicesView from './InvoicesView'
import PaymentsView from './PaymentsView'
import SubscriptionsView from './SubscriptionsView'
import ProductsView from './ProductsView'
import ReportBuilderView from './ReportBuilderView'
import OutboundView from './OutboundView'
import WebhooksView from './WebhooksView'
import ServicesView from './ServicesView'
import UsageView from './UsageView'
import ResourcePoolsView from './ResourcePoolsView'
import AccountsView from './AccountsView'
import PartiesView from './PartiesView'
import AnalyticsView from './AnalyticsView'
import LeadPipelineView from './LeadPipelineView'
import CustomerView from './CustomerView'
import AskGaaexView from './AskGaaexView'
import HelpdeskView from './HelpdeskView'
import PaymentGatewayView from './PaymentGatewayView'
import WorkItemsView from './WorkItemsView'
import CalendarView from './CalendarView'
import CreateTenantWizard from './CreateTenantWizard'
import SettingsView from './SettingsView'
import OrgView from './OrgView'
import { NAV_SECTIONS, type NavItemDef } from './nav-config'
import { bget, bpost } from './billing'
import { useI18n, initI18n, type Lang } from './i18n'
import { GearIcon, SunIcon, MoonIcon, RowsIcon, MenuIcon, CloseIcon, SparkleIcon,
  ChevronRightIcon, ChevronDownIcon, ServerIcon, UsersIcon, ShieldIcon, GlobeIcon, InfoIcon } from './icons'
import { fetchCapabilities, FULL_ACCESS, type Capabilities } from './capabilities'
import ProfileModal from './ProfileModal'
import SecurityModal from './SecurityModal'
import { ShortcutsModal, DocsModal, WhatsNewModal } from './SupportModals'

type Me = { email: string; name: string; tenant_id: string; can_configure?: boolean; avatar_url?: string | null }
type Entity = { key: string; label: string; label_plural: string; route_slug: string }
type OrgNode = { id: string; type: string; name: string; path: string; code?: string; parent_id?: string | null }
type View =
  | { type: 'org' }
  | { type: 'entity'; slug: string }
  | { type: 'studio'; focusSlug?: string }
  | { type: 'reports' }
  | { type: 'dashboards' }
  | { type: 'messages' }
  | { type: 'activity' }
  | { type: 'invoices' }
  | { type: 'payments' }
  | { type: 'subscriptions' }
  | { type: 'products' }
  | { type: 'usage' }
  | { type: 'report-builder' }
  | { type: 'outbound' }
  | { type: 'webhooks' }
  | { type: 'services' }
  | { type: 'resource-pools' }
  | { type: 'accounts' }
  | { type: 'parties' }
  | { type: 'analytics' }
  | { type: 'lead-pipeline' }
  | { type: 'customer'; id: string }
  | { type: 'ask' }
  | { type: 'settings' }
  | { type: 'calendar' }
  | { type: 'helpdesk' }
  | { type: 'workitems' }
  | { type: 'gateway' }
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
  outbound: 'outbound',
  // Title-only pages.
  dashboards: 'dashboards',
  analytics: 'analytics',
  org: 'org',
  gateway: 'gateway',
  customer: 'customer',
  reports: 'reports',
  calendar: 'calendar',
  // Table-capable pages.
  helpdesk: 'helpdesk',
  workitems: 'workitems',
}

// The 10 gx color palettes (color-tokens.css). `primary`/`bg` here are the DARK-variant
// hex values, used only to paint the mini swatch in the profile chooser — the live colors
// always come from the CSS `--gx-*` tokens. Order roughly follows the token file.
const GX_PALETTES: Array<{ id: string; label: string; primary: string; bg: string }> = [
  { id: 'navy', label: 'Navy', primary: '#E3B341', bg: '#0E1B33' },
  { id: 'petrol', label: 'Petrol', primary: '#2DD4BF', bg: '#08272B' },
  { id: 'forest', label: 'Forest', primary: '#58C46A', bg: '#0C2317' },
  { id: 'olive', label: 'Olive', primary: '#C9B458', bg: '#1E2310' },
  { id: 'espresso', label: 'Espresso', primary: '#E0915A', bg: '#241813' },
  { id: 'oxblood', label: 'Oxblood', primary: '#E27A7A', bg: '#2A0F14' },
  { id: 'plum', label: 'Plum', primary: '#C189E8', bg: '#221128' },
  { id: 'indigo', label: 'Indigo', primary: '#8B7CF7', bg: '#161433' },
  { id: 'slate', label: 'Slate', primary: '#5BA3F0', bg: '#1E2228' },
  { id: 'sand', label: 'Sand', primary: '#C9A45A', bg: '#241E14' },
]

export default function App() {
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<Me | null>(null)
  const [entities, setEntities] = useState<Entity[]>([])
  const [orgNodes, setOrgNodes] = useState<OrgNode[]>([])
  const [view, setView] = useState<View>({ type: 'org' })
  const [customerReturn, setCustomerReturn] = useState<View>({ type: 'org' })
  const [cfgSlug, setCfgSlug] = useState<string | null>(null)   // open the in-place Configure drawer for this entity slug
  const [cfgPageKey, setCfgPageKey] = useState<string | null>(null)   // …or for this bespoke page (page-config, not an entity)
  const [pageConfigVersion, setPageConfigVersion] = useState(0)   // bumped on a page-config save so the live view re-reads it
  const [capabilities, setCapabilities] = useState<Capabilities>(FULL_ACCESS)

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

  const [email, setEmail] = useState('admin@demo.isp')
  const [password, setPassword] = useState('admin123')
  const [error, setError] = useState('')
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [nudge, setNudge] = useState(false)
  // Account-menu modals (My Profile, Security, and SUPPORT items).
  const [accountModal, setAccountModal] = useState<'profile' | 'security' | 'shortcuts' | 'docs' | 'whatsnew' | null>(null)
  const { t, lang, setLang } = useI18n()

  // Collapsible nav section state — pre-open sections marked defaultOpen in nav-config
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(NAV_SECTIONS.filter((s) => s.defaultOpen).map((s) => s.id)),
  )

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
    setView({ type: item.viewType } as View)
  }

  function isItemActive(item: NavItemDef): boolean {
    if (!item.viewType) {
      return view.type === 'module-stub' && (view as { type: 'module-stub'; moduleId: string }).moduleId === item.id
    }
    if (item.viewType === 'entity') {
      return view.type === 'entity' && (view as { type: 'entity'; slug: string }).slug === item.viewArgs?.slug
    }
    return view.type === item.viewType
  }

  useEffect(() => { initI18n(token) }, [token])

  useEffect(() => {
    if (!token) { setNudge(false); return }
    bget<{ onboarded?: boolean }>(token, '/api/tenant/settings')
      .then((r) => { if (r.ok && r.data && r.data.onboarded === false) setNudge(true) })
      .catch(() => {})
  }, [token])

  function finishSetup() {
    if (token) bpost(token, '/api/tenant/onboarded', {}).catch(() => {})
    setNudge(false)
    setView({ type: 'settings' })
  }

  // Close the user-profile menu on outside click or Escape
  useEffect(() => {
    if (!userMenuOpen) return
    function onMouseDown(e: MouseEvent) {
      const el = document.getElementById('user-menu')
      if (el && !el.contains(e.target as Node)) setUserMenuOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setUserMenuOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [userMenuOpen])

  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('gaaex-theme') === 'light' ? 'light' : 'dark'),
  )
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    // Unify the dark/light toggle with the gx token system: the same choice drives
    // both the legacy `--theme` light overrides and the gx palette's dark/light block.
    document.documentElement.setAttribute('data-gx-theme', theme)
    localStorage.setItem('gaaex-theme', theme)
  }, [theme])

  // Per-user PALETTE choice (gx 10-palette system). Default 'navy' = closest to the
  // original cobalt/gold look, so existing users aren't jarred on first load.
  const [gxPalette, setGxPalette] = useState<string>(
    () => localStorage.getItem('gaaex-gx-palette') || 'navy',
  )
  useEffect(() => {
    document.documentElement.setAttribute('data-gx-palette', gxPalette)
    localStorage.setItem('gaaex-gx-palette', gxPalette)
  }, [gxPalette])

  // Legacy density/palette switchers were removed (owner's call). Everyone is pinned to the
  // 'comfortable' density; clear any stale legacy `data-palette` an earlier build may have left.
  useEffect(() => {
    document.documentElement.setAttribute('data-density', 'comfortable')
    document.documentElement.removeAttribute('data-palette')
    localStorage.removeItem('gaaex-density')
    localStorage.removeItem('gaaex-palette')
  }, [])

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
    setToken(null); setUser(null); setEntities([]); setView({ type: 'org' }); setCapabilities(FULL_ACCESS)
  }

  if (!token) {
    return (
      <div className="center">
        <form className="card" onSubmit={handleLogin}>
          {/* The login banner is always dark, so always use the reversed (platinum+gold)
              lockup — the cobalt lockup would vanish into the dark banner in light theme. */}
          <img
            src="/logo/GAAex-logo-reversed.svg"
            alt="GAAex"
            className="logo-lg"
          />
          <p className="muted">{t('auth.signin', 'Sign in')}</p>
          <input className={'inp inp-md' + (error ? ' is-error' : '')} value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('auth.email', 'email')} aria-label={t('auth.email', 'email')} />
          <input className={'inp inp-md' + (error ? ' is-error' : '')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('auth.password', 'password')} aria-label={t('auth.password', 'password')} />
          <button type="submit" className="btn btn-primary btn-md">{t('auth.signin', 'Sign in')}</button>
          {error && <p className="err">{error}</p>}
          <p className="hint">demo: admin@demo.isp / admin123</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setWizardOpen(true)}>
            {t('wizard.cta', 'Set up a new ISP')} <span aria-hidden>→</span>
          </button>
        </form>
        <CreateTenantWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
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
    <div className={'shell' + (navOpen ? ' nav-collapsed' : '')}>
      <a href="#main-content" className="skip-link">Skip to content</a>
      {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} />}
      <aside className={'sidebar' + (navOpen ? ' open' : '')} onClick={() => setNavOpen(false)}>
        <div className="sidebar-brand">
          <div className="sidebar-logo">
            <img src="/favicon/favicon.svg" alt="" width="22" height="22" />
          </div>
          <div className="sidebar-brand-name">GAAex<small>ISP Platform</small></div>
        </div>

        <nav className="sidebar-scroll">
          {/* Studio — its own top-level item, superadmin only (config.manage). */}
          {user?.can_configure && (
            <button
              className={'nav nav-standalone' + (view.type === 'studio' ? ' on' : '')}
              onClick={() => setView({ type: 'studio' })}
            >
              <GearIcon className="nav-icon" size={14} /><span>Studio</span>
            </button>
          )}
          {NAV_SECTIONS.filter((sec) => !sec.adminOnly || !!user?.can_configure).map((sec) => {
            const isOpen = openSections.has(sec.id)
            return (
              <div key={sec.id} className="nav-section">
                <button
                  className={'nav-section-header' + (isOpen ? ' open' : '')}
                  onClick={(e) => toggleSection(sec.id, e)}
                  aria-expanded={isOpen}
                >
                  <sec.icon size={13} className="nav-section-icon" />
                  <span>{sec.label}</span>
                  <ChevronRightIcon size={11} className="nav-section-chevron" />
                </button>
                {isOpen && (
                  <div className="nav-section-items">
                    {sec.items.map((item) => (
                      <button
                        key={item.id}
                        className={'nav nav-sub' + (isItemActive(item) ? ' on' : '')}
                        onClick={(e) => navItemClick(item, e)}
                      >
                        <item.icon size={13} className="nav-icon" />
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          {extraEntities.length > 0 && (
            <div className="nav-section">
              <button
                className={'nav-section-header' + (openSections.has('records') ? ' open' : '')}
                onClick={(e) => toggleSection('records', e)}
                aria-expanded={openSections.has('records')}
              >
                <RowsIcon size={13} className="nav-section-icon" />
                <span>Records</span>
                <ChevronRightIcon size={11} className="nav-section-chevron" />
              </button>
              {openSections.has('records') && (
                <div className="nav-section-items">
                  {extraEntities.map((en) => (
                    <button
                      key={en.key}
                      className={'nav nav-sub' + (view.type === 'entity' && (view as { type: 'entity'; slug: string }).slug === en.route_slug ? ' on' : '')}
                      onClick={() => setView({ type: 'entity', slug: en.route_slug })}
                    >
                      <RowsIcon className="nav-icon" size={13} /><span>{en.label_plural}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </nav>

        <div className="sidebar-tenant">
          <div className="sidebar-tenant-avatar">
            {user?.avatar_url
              ? <img src={user.avatar_url} alt="" className="avatar-img" />
              : (user?.name || 'G').slice(0, 1).toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="sidebar-tenant-name">{user?.name || 'GAAex'}</div>
            <div className="sidebar-tenant-role">{user?.email}</div>
          </div>
        </div>
      </aside>

      <div className="content">
        <header>
          <button className="iconbtn nav-toggle" aria-label="Menu" onClick={() => setNavOpen((o) => !o)}><MenuIcon /></button>
          <div className="header-bcrumb">
            <span style={{ color: 'var(--text-3)' }}>GAAex</span>
            <ChevronRightIcon size={14} className="header-bcrumb-sep" />
            <span className="header-bcrumb-cur">
              {breadcrumbLabel.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
            </span>
          </div>
          {user?.can_configure && canConfigureThisPage && view.type !== 'studio' && (
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginLeft: 12 }}
              onClick={() => { if (configSlug) setCfgSlug(configSlug); else if (pageConfigKey) setCfgPageKey(pageConfigKey) }}
              title={t('common.configurePageTitle', 'Configure this page')}
            >
              <GearIcon size={13} /> {t('common.configurePage', 'Configure page')}
            </button>
          )}
          <div className="header-right">
            {/* Theme toggle — moved inline next to the bell (was inside the dropdown). */}
            <button
              className="iconbtn"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              title={theme === 'dark' ? t('common.themeLight', 'Light theme') : t('common.themeDark', 'Dark theme')}
              aria-label={t('common.toggleTheme', 'Toggle theme')}
            >
              {theme === 'dark' ? <SunIcon size={18} /> : <MoonIcon size={18} />}
            </button>

            {/* Language — EN / AM / RU inline. The Armenian locale value stays 'hy'; the button is
                just labelled "AM". RU has no catalog yet → falls back to English via t(). */}
            <div className="lang-switch" role="group" aria-label={t('common.language', 'Language')}>
              {([['en', 'EN'], ['hy', 'AM'], ['ru', 'RU']] as Array<[Lang, string]>).map(([l, label]) => (
                <button key={l} className={'lang-opt' + (lang === l ? ' on' : '')} onClick={() => setLang(l)} aria-pressed={lang === l}>
                  {label}
                </button>
              ))}
            </div>

            <NotificationCenter
              token={token}
              entities={entities}
              onOpen={(slug) => setView({ type: 'entity', slug })}
            />
            <div id="user-menu" className="user-menu">
              <button
                className={'user-chip' + (userMenuOpen ? ' on' : '')}
                onClick={() => setUserMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                aria-label={t('common.accountMenu', 'Account menu')}
              >
                <span className="user-avatar">
                  {user?.avatar_url
                    ? <img src={user.avatar_url} alt="" className="avatar-img" />
                    : (user?.name || 'U').slice(0, 1).toUpperCase()}
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <span className="user-chip-name">{user?.name}</span>
                  <span className="user-chip-role">{user?.can_configure ? t('role.admin', 'Admin') : t('role.member', 'Member')}</span>
                </div>
                <ChevronDownIcon size={14} className="user-chip-caret" />
              </button>

              {userMenuOpen && (
                /* Account menu — PERSONAL scope only. Boundary rule: anything that affects OTHER
                   users, billing, system config, or tenant administration does NOT belong here —
                   route those to a dedicated Settings module instead. */
                <div className="user-pop" role="menu" aria-label={t('common.accountMenu', 'Account menu')}>
                  <div className="user-pop-head">
                    <span className="user-avatar">
                      {user?.avatar_url
                        ? <img src={user.avatar_url} alt="" className="avatar-img" />
                        : (user?.name || 'U').slice(0, 1).toUpperCase()}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div className="user-pop-name">{user?.name}</div>
                      <div className="user-pop-email">{user?.email}</div>
                      <span className="user-pop-rolebadge">{user?.can_configure ? t('role.admin', 'Admin') : t('role.member', 'Member')}</span>
                    </div>
                  </div>

                  <div className="user-pop-section">
                    <div className="user-pop-label">{t('account.section', 'Account')}</div>
                    <button className="user-pop-item" role="menuitem" onClick={() => { setUserMenuOpen(false); setAccountModal('profile') }}>
                      <UsersIcon size={16} />
                      <span>{t('profile.title', 'My Profile')}</span>
                    </button>
                    <button className="user-pop-item" role="menuitem" onClick={() => { setUserMenuOpen(false); setAccountModal('security') }}>
                      <ShieldIcon size={16} />
                      <span>{t('security.title', 'Security & Sign-in')}</span>
                    </button>
                  </div>

                  <div className="user-pop-divider" />

                  <div className="user-pop-section">
                    <div className="user-pop-label">{t('appearance.section', 'Appearance')}</div>
                    <div className="gx-palette-grid" role="radiogroup" aria-label={t('appearance.palette', 'Color palette')}>
                      {GX_PALETTES.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          role="radio"
                          aria-checked={gxPalette === p.id}
                          aria-label={p.label}
                          title={p.label}
                          className={'gx-palette-opt' + (gxPalette === p.id ? ' on' : '')}
                          onClick={() => setGxPalette(p.id)}
                        >
                          <span
                            className="gx-palette-swatch"
                            style={{ background: p.bg }}
                            aria-hidden
                          >
                            <span className="gx-palette-dot" style={{ background: p.primary }} />
                          </span>
                          <span className="gx-palette-name">{p.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="user-pop-section">
                    <div className="user-pop-label">{t('support.section', 'Support')}</div>
                    <button className="user-pop-item" role="menuitem" onClick={() => { setUserMenuOpen(false); setAccountModal('shortcuts') }}>
                      <InfoIcon size={16} />
                      <span>{t('shortcuts.title', 'Keyboard shortcuts')}</span>
                    </button>
                    <button className="user-pop-item" role="menuitem" onClick={() => { setUserMenuOpen(false); setAccountModal('docs') }}>
                      <GlobeIcon size={16} />
                      <span>{t('docs.title', 'Documentation')}</span>
                    </button>
                    <button className="user-pop-item" role="menuitem" onClick={() => { setUserMenuOpen(false); setAccountModal('whatsnew') }}>
                      <SparkleIcon size={16} />
                      <span>{t('whatsnew.title', "What's new")}</span>
                    </button>
                  </div>

                  <div className="user-pop-divider" />
                  <button
                    className="user-pop-item user-pop-signout"
                    role="menuitem"
                    onClick={() => { setUserMenuOpen(false); logout() }}
                  >
                    <span>{t('common.signout', 'Sign out')}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main id="main-content">
          {nudge && (
            <div className="onboard-nudge" role="status"
                 style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', marginBottom: 14,
                          border: '1px solid var(--border)', borderRadius: 'var(--r-md, 8px)', background: 'var(--accent-soft)' }}>
              <GearIcon size={16} />
              <span style={{ flex: 1 }}>{t('onboard.nudge', 'Finish setting up your ISP.')}</span>
              <button className="btn btn-primary btn-sm" onClick={finishSetup}>{t('onboard.finish', 'Finish setting up')}</button>
              <button className="iconbtn" aria-label={t('common.close', 'Close')} onClick={() => setNudge(false)}><CloseIcon size={16} /></button>
            </div>
          )}
          <ErrorBoundary>
            {view.type === 'org'
              ? <OrgView nodes={orgNodes} configVersion={pageConfigVersion} token={token} />
              : view.type === 'dashboards'
                ? <DashboardView token={token} configVersion={pageConfigVersion} />
              : view.type === 'analytics'
                ? <AnalyticsView token={token} configVersion={pageConfigVersion} />
              : view.type === 'lead-pipeline'
                ? <LeadPipelineView token={token} onOpenCustomer={openCustomer} />
              : view.type === 'customer'
                ? <CustomerView token={token} customerId={view.id} onBack={() => setView(customerReturn)} configVersion={pageConfigVersion} />
              : view.type === 'ask'
                ? <AskGaaexView token={token} />
              : view.type === 'messages'
                ? <MessagesView token={token} />
              : view.type === 'activity'
                ? <div><div className="view-head"><h2>{t('nav.activity', 'Activity')}</h2></div><ActivityTimeline token={token} /></div>
              : view.type === 'invoices'
                ? <InvoicesView token={token} canConfigure={!!user?.can_configure} configVersion={pageConfigVersion} />
              : view.type === 'payments'
                ? <PaymentsView token={token} configVersion={pageConfigVersion} />
              : view.type === 'gateway'
                ? <PaymentGatewayView token={token} configVersion={pageConfigVersion} />
              : view.type === 'subscriptions'
                ? <SubscriptionsView token={token} configVersion={pageConfigVersion} />
              : view.type === 'products'
                ? <ProductsView token={token} configVersion={pageConfigVersion} />
              : view.type === 'report-builder'
                ? <ReportBuilderView token={token} entities={entities} />
              : view.type === 'outbound'
                ? <OutboundView token={token} configVersion={pageConfigVersion} />
              : view.type === 'webhooks'
                ? <WebhooksView token={token} configVersion={pageConfigVersion} />
              : view.type === 'services'
                ? <ServicesView token={token} configVersion={pageConfigVersion} />
              : view.type === 'usage'
                ? <UsageView token={token} configVersion={pageConfigVersion} />
              : view.type === 'resource-pools'
                ? <ResourcePoolsView token={token} configVersion={pageConfigVersion} />
              : view.type === 'accounts'
                ? <AccountsView token={token} configVersion={pageConfigVersion} />
              : view.type === 'parties'
                ? <PartiesView token={token} />
              : view.type === 'helpdesk'
                ? <HelpdeskView token={token} canConfigure={!!user?.can_configure} configVersion={pageConfigVersion} />
              : view.type === 'workitems'
                ? <WorkItemsView token={token} canConfigure={!!user?.can_configure} configVersion={pageConfigVersion} />
              : view.type === 'calendar'
                ? <CalendarView token={token} configVersion={pageConfigVersion} />
              : view.type === 'settings'
                ? <SettingsView token={token} onSaved={() => setNudge(false)} />
              : view.type === 'reports'
                ? <ReportsView token={token} configVersion={pageConfigVersion} />
              : view.type === 'studio'
                ? <StudioView token={token} onCreated={async () => setEntities(await getEntities(token))} />
              : view.type === 'module-stub'
                ? <ModuleStubView moduleId={view.moduleId} moduleLabel={view.moduleLabel} />
              : <EntityView token={token} slug={(view as { slug: string }).slug} onOpenCustomer={openCustomer} capabilities={capabilities} onBack={() => setView({ type: 'org' })} />}
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
  return (
    <div>
      <div className="view-head">
        <div className="view-icon"><ServerIcon size={20} /></div>
        <div className="view-title-wrap">
          <h2>{moduleLabel}</h2>
          <span className="view-sub">Module · coming soon</span>
        </div>
      </div>
      <div style={{ marginTop: 40, textAlign: 'center', color: 'var(--text-3)' }}>
        <div style={{ fontSize: 13, marginBottom: 6 }}>
          <strong style={{ color: 'var(--text-2)' }}>{moduleLabel}</strong> is not yet enabled for this tenant.
        </div>
        <div style={{ fontSize: 12 }}>Module ID: <code style={{ fontFamily: 'monospace' }}>{moduleId}</code></div>
      </div>
    </div>
  )
}
