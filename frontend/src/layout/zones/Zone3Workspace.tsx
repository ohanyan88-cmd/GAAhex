// Zone 3 — Master Split-Screen Workspace.
//
// Layout: [main 65-70%] | [sidecar 30-35%]
//
// Left side: tab-driven content from <MainSlot />.
// Right side: entity-persistent context from <SidecarSlot />. The sidecar does NOT
// re-mount when tabs change — its scroll/state survives tab switches.
//
// Below 1100px the sidecar auto-collapses (mobile/tablet); pages can also collapse
// it manually via context.setSidecarCollapsed(true).
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { useMasterLayout, useSlot } from '../MasterLayoutContext'

export default function Zone3Workspace() {
  const mainNode    = useSlot('main')
  const sidecarNode = useSlot('sidecar')
  const { sidecarCollapsed, setSidecarCollapsed } = useMasterLayout()

  const hasSidecar = sidecarNode != null
  const collapsed  = sidecarCollapsed || !hasSidecar

  return (
    <section className={`zone-3 ${collapsed ? 'zone-3--collapsed' : ''}`}>
      <main className="zone-3-left" aria-label="Main content">
        {mainNode ?? <EmptyMain />}
      </main>

      {hasSidecar && !collapsed && (
        <aside className="zone-3-right" aria-label="Context sidecar">
          <div className="zone-3-right-head">
            <span className="zone-3-right-title">Context</span>
            <button
              className="zone-3-right-toggle"
              aria-label="Collapse sidecar"
              title="Collapse sidecar"
              onClick={() => setSidecarCollapsed(true)}
            >
              <PanelRightClose size={14} />
            </button>
          </div>
          <div className="zone-3-right-body">{sidecarNode}</div>
        </aside>
      )}

      {hasSidecar && collapsed && (
        <button
          className="zone-3-reopen"
          aria-label="Open sidecar"
          title="Open sidecar"
          onClick={() => setSidecarCollapsed(false)}
        >
          <PanelRightOpen size={14} />
        </button>
      )}
    </section>
  )
}

function EmptyMain() {
  return (
    <div className="zone-3-empty">
      <p className="muted">No content. This page hasn't published into the main slot yet.</p>
    </div>
  )
}
