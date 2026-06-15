// gx-AppShell — composable platform layout shell.
// EN: Owns the three-column grid (.app / .sb / .main), collapsed/navOpen
//     state, skip-link, nav-scrim, and logo swap. Consumers inject content
//     through four slots: header (render-prop), leftNav, contentArea, portals.
// HY: Կառավारим é érеkhstyun grid-ը (.app / .sb / .main), collapsed/navOpen
//     state-ը, skip-link-ը, nav-scrim-ը, logo swap-ը: Consumer-ը content
//     inject é chors slot-ով՝ header (render-prop), leftNav, contentArea, portals:
import { useState, type ReactNode } from 'react'
import { t } from '../../lib/i18n'

// EN: Controls surface exposed to the header render-prop.
// HY: Controls surface, որ փոխանցվում է header render-prop-ին:
export type GxShellControls = {
  /** EN: Toggle sidebar — desktop: collapse/expand, mobile: open/close.
   *  HY: Sidebar toggle — desktop: collapse/expand, mobile: open/close: */
  handleToggle: () => void
}

export interface GxAppShellProps {
  /** EN: Render-prop for the topbar — receives shell controls so caller
   *      can wire the sidebar toggle button inside .tb-tools.
   *  HY: Topbar render-prop — ստանում է shell controls, որ caller-ը
   *      sidebar toggle button-ը կարողանա .tb-tools-ի ներսում կապել: */
  header: (controls: GxShellControls) => ReactNode

  /** EN: Sidebar body rendered inside .sb-scroll.
   *  HY: Sidebar բովանդակություն — ռেն্ডেরвум է .sb-scroll-ի ներসому: */
  leftNav: ReactNode

  /** EN: Main view content rendered inside <main id="main-content" className="view">.
   *  HY: Հиmkanakan view content — ռендервум é <main id="main-content"> nung: */
  contentArea: ReactNode

  /** EN: Optional persistent right panel (reserved for Phase N).
   *  HY: Ըст ֆансияуйона persistent right panel (Phase N-ի чаmam): */
  rightPanel?: ReactNode

  /** EN: Portal overlays rendered as siblings to .main inside .app (ConfigureDrawer,
   *      SecurityModal, etc.). Kept outside <main> to preserve original DOM depth.
   *  HY: Portal overlays, ռендервум են .main-ի կилим .app-ի ner wen (ConfigureDrawer,
   *      SecurityModal, etc.): Мnat <main>-ici durs original DOM depth-ं сторожит: */
  portals?: ReactNode

  /** EN: Full wordmark src — displayed when sidebar is expanded.
   *  HY: Full wordmark src — ցুইт्सandрум é expanded sidebar-um: */
  logoSrc: string

  /** EN: Compact mark src — displayed when sidebar is collapsed.
   *  HY: Compact mark src — ցуצадрум є collapsed sidebar-um: */
  logoMarkSrc: string

  /** EN: Logo img alt text.
   *  HY: Logo img alt text: */
  logoAlt?: string
}

/**
 * EN: gx-AppShell — the GAAhex platform layout shell.
 *     Drop-in wrapper that owns collapsed/navOpen state and renders the
 *     three-panel layout (sidebar + main + optional right panel).
 *     Visual behavior is identical to the inline layout extracted from App.tsx.
 *
 * HY: gx-AppShell — GAAhex platform layout shell-ը:
 *     Drop-in wrapper, owned collapsed/navOpen state, ռендервум é
 *     érеkhstyun layout (sidebar + main + optional right panel):
 *     Visual behavior-ը identik é App.tsx-icum enegvac inline layout-ina:
 */
export default function GxAppShell({
  header,
  leftNav,
  contentArea,
  rightPanel,
  portals,
  logoSrc,
  logoMarkSrc,
  logoAlt = 'Logo',
}: GxAppShellProps) {
  // EN: Shell state lives here — no parent component tracks layout.
  // HY: Shell state-ը aps é — parent component-ը layout track chi ani:
  const [collapsed, setCollapsed] = useState(false)
  const [navOpen, setNavOpen] = useState(false)

  // EN: Single toggle handler — desktop collapses, mobile opens/closes.
  // HY: Меk toggle handler — desktop-ume collapse, mobile-ume open/close:
  function handleToggle() {
    if (window.matchMedia('(max-width: 900px)').matches) setNavOpen((o) => !o)
    else setCollapsed((c) => !c)
  }

  return (
    <div className={'app' + (collapsed ? ' collapsed' : '') + (navOpen ? ' navopen' : '')}>
      {/* EN: Skip link — keyboard accessibility anchor.
          HY: Skip link — keyboard accessibility anchor: */}
      <a href="#main-content" className="skip-link">
        {t('shell.skipToContent', 'Skip to content')}
      </a>

      {/* EN: Mobile nav-scrim — closes sidebar on outside click/Escape.
          HY: Mobile nav-scrim — sidebar-ը փаккум é drsic click/Escape-ow: */}
      {navOpen && (
        <div
          className="nav-scrim"
          role="button"
          tabIndex={-1}
          aria-label={t('shell.closeNav', 'Close navigation')}
          onClick={() => setNavOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setNavOpen(false)
          }}
        />
      )}

      {/* EN: Sidebar — left nav column. Logo swaps on collapse.
          HY: Sidebar — daks nav stsakak. Logo-ն swap é collapse-ow: */}
      <aside className="sb" data-theme="dark">
        <div className="sb-head">
          <img src={collapsed ? logoMarkSrc : logoSrc} alt={logoAlt} className="wm" />
        </div>
        <div className="sb-scroll">{leftNav}</div>
      </aside>

      {/* EN: Main area — topbar header above, view content below.
          HY: Hylavnakan terakan — topbar header veryew, view content nerqew: */}
      <div className="main">
        <header className="tb">{header({ handleToggle })}</header>
        <main id="main-content" className="view">
          {contentArea}
        </main>
      </div>

      {/* EN: Portal overlays — sit outside .main at .app level, matching original DOM depth.
          HY: Portal overlays — .main-ic durs en .app mаkatardumow, original DOM depth-ं сохраненіє: */}
      {portals}

      {rightPanel}
    </div>
  )
}
