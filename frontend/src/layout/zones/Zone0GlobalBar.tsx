// Zone 0 — Global Top Bar (56px, persistent on every page).
//
// Layout: [Sidebar toggle] [Logo] [Brand]    [Search]    [Bell] [Avatar + Name]
//
// Always rendered. Never customized by pages. The contract.
import { Menu, Bell, ChevronDown, Search } from 'lucide-react'
import { useMasterLayout } from '../MasterLayoutContext'

export interface Zone0Props {
  tenantInitials: string         // "DI"
  tenantName:     string         // "Demo ISP"
  userInitials:   string         // "DA"
  userName:       string         // "Demo Admin"
  userRole:       string         // "Administrator"
  notificationCount?: number
  onSearchClick?: () => void
  onBellClick?:   () => void
  onProfileClick?:() => void
}

export default function Zone0GlobalBar(props: Zone0Props) {
  const { sidebarOpen, setSidebarOpen } = useMasterLayout()

  return (
    <header className="zone-0">
      {/* LEFT */}
      <div className="zone-0-left">
        <button
          className="zone-0-iconbtn"
          aria-label={sidebarOpen ? 'Collapse sidebar' : 'Open sidebar'}
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          <Menu size={18} />
        </button>

        <div className="zone-0-tenant">
          <div className="zone-0-logo" title={props.tenantName}>{props.tenantInitials}</div>
          <span className="zone-0-brand">{props.tenantName}</span>
        </div>
      </div>

      {/* CENTER — global search hotkey container */}
      <div className="zone-0-center">
        <button className="zone-0-search" onClick={props.onSearchClick}>
          <Search size={13} />
          <span className="zone-0-search-text">Search everything…</span>
          <kbd className="zone-0-kbd">Ctrl + K</kbd>
        </button>
      </div>

      {/* RIGHT */}
      <div className="zone-0-right">
        <button className="zone-0-iconbtn zone-0-bell" aria-label="Notifications" onClick={props.onBellClick}>
          <Bell size={16} />
          {props.notificationCount != null && props.notificationCount > 0 && (
            <span className="zone-0-bell-badge">{props.notificationCount > 99 ? '99+' : props.notificationCount}</span>
          )}
        </button>

        <button className="zone-0-profile" onClick={props.onProfileClick}>
          <span className="zone-0-avatar">{props.userInitials}</span>
          <span className="zone-0-userblock">
            <span className="zone-0-username">{props.userName}</span>
            <span className="zone-0-userrole">{props.userRole}</span>
          </span>
          <ChevronDown size={13} className="zone-0-chevron" />
        </button>
      </div>
    </header>
  )
}
