// MasterLayout — the immutable 4-Zone page shell + LeftNav.
//
// Every page in the application MUST render inside this layout. The structural
// contract is enforced here, not in the page authors' code.
//
//   <MasterLayout zone0={...} nav={...}>
//     <YourPage />
//   </MasterLayout>
//
// Where YourPage renders <PageHeaderSlot />, <TabsSlot />, <MainSlot>, <SidecarSlot>
// to fill the zones. The page never renders <header> / tabs / split / nav itself.
import { type ReactNode } from 'react'
import { MasterLayoutProvider, useMasterLayout } from './MasterLayoutContext'
import LeftNav, { type NavConfig } from './LeftNav'
import Zone0GlobalBar, { type Zone0Props } from './zones/Zone0GlobalBar'
import Zone1PageHeader from './zones/Zone1PageHeader'
import Zone2Tabs       from './zones/Zone2Tabs'
import Zone3Workspace  from './zones/Zone3Workspace'

export interface MasterLayoutProps {
  zone0:    Zone0Props
  nav:      NavConfig
  children: ReactNode
}

export default function MasterLayout({ zone0, nav, children }: MasterLayoutProps) {
  return (
    <MasterLayoutProvider>
      <Shell zone0={zone0} nav={nav}>{children}</Shell>
    </MasterLayoutProvider>
  )
}

function Shell({ zone0, nav, children }: { zone0: Zone0Props; nav: NavConfig; children: ReactNode }) {
  const { sidecarCollapsed, navExpanded } = useMasterLayout()
  const classes = [
    'master-layout',
    navExpanded ? 'master-layout--nav-expanded' : 'master-layout--nav-rail',
    sidecarCollapsed ? 'master-layout--sidecar-collapsed' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      <LeftNav nav={nav} />
      <Zone0GlobalBar {...zone0} />
      <Zone1PageHeader />
      <Zone2Tabs />
      <Zone3Workspace />
      {/* Page renders here but PRODUCES nothing visible — it only publishes into slots.
          The slots above pick up the content and render it inside the zone chrome. */}
      <div style={{ display: 'none' }} aria-hidden="true">{children}</div>
    </div>
  )
}
