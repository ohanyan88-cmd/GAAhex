// GAAex Studio shell — the SuperAdmin builder + configuration center + publishing control.
// P1: header + frame + SuperAdmin gate + /studio URL sync. Left tree and right pane are filled
// in P2 (tree nav) and P3 (overview landing).
//
// SuperAdmin gate: rendered behind `user.can_configure`. Server gate is the same flag —
// any future /studio/* endpoint must depend on `current_user` and `can(grants, "config", "manage")`
// (see backend/app/routers/auth.py `me` for the canonical check, and backend/app/access.py
// for `load_grants` + `can`). UI hiding alone is not security.
import { useEffect } from 'react'
import { Eye, Rocket, Shield } from 'lucide-react'
import ViewHead from '../components/ViewHead'

export type StudioRoute = { group?: string; module?: string; leaf?: string }

export default function StudioShell({
  canConfigure,
  route,
  onRoute,
}: {
  token: string | null
  canConfigure: boolean
  route: StudioRoute
  onRoute: (r: StudioRoute) => void
}) {
  // Keep the browser URL in sync with the in-app route so deep links work and the back button
  // navigates within Studio. The Portal app uses a `view` state union (no React Router yet);
  // pushState + popstate gives us URL fidelity without pulling in a router. P2 fills group/module/
  // leaf — for P1 the only path is `/studio`.
  useEffect(() => {
    const segs = ['studio']
    if (route.group) segs.push(route.group)
    if (route.module) segs.push(route.module)
    if (route.leaf) segs.push(route.leaf)
    const url = '/' + segs.join('/')
    if (window.location.pathname !== url) {
      window.history.pushState({ studio: route }, '', url)
    }
  }, [route.group, route.module, route.leaf])

  useEffect(() => {
    function onPop(e: PopStateEvent) {
      const path = window.location.pathname
      if (!path.startsWith('/studio')) return
      const parts = path.slice(1).split('/').filter(Boolean)
      // parts[0] === 'studio'; the rest = group/module/leaf
      const next: StudioRoute = {
        group: parts[1],
        module: parts[2],
        leaf: parts[3],
      }
      // Fall back to history-state if the URL was truncated.
      const stateRoute = e.state && (e.state as { studio?: StudioRoute }).studio
      onRoute(stateRoute ?? next)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [onRoute])

  if (!canConfigure) {
    // Defense-in-depth: server is primary, but never render the shell without the flag.
    return (
      <div className="view-inner fade" style={{ maxWidth: 720 }}>
        <ViewHead
          icon={<Shield size={20} />}
          title="Studio"
          sub="Visual builder · configuration center · publishing control"
        />
        <div className="studio-empty-state">
          <Shield size={36} />
          <h3>SuperAdmin only</h3>
          <p>Studio is restricted to users with platform-configuration grants.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="view-inner fade" style={{ maxWidth: 1320 }}>
      <ViewHead
        icon={<Shield size={20} />}
        title="Studio"
        sub="Visual builder · configuration center · publishing control"
        actions={
          <>
            <span className="pill pill-gold" style={{ marginRight: 2 }}>
              <Shield size={12} />SuperAdmin
            </span>
            <span className="studio-pill draft">
              <span className="d" />Draft
            </span>
            <button className="btn btn-secondary btn-sm" type="button">
              <Eye size={14} />Preview
            </button>
            <button className="btn btn-primary btn-sm" type="button">
              <Rocket size={14} />Publish
            </button>
          </>
        }
      />
      <div className="studio tree-studio">
        <aside className="studio-nav tree">
          {/* P2 fills this with STUDIO_TREE + search. */}
          <div className="studio-empty">Tree (Prompt 2)</div>
        </aside>
        <section className="studio-pane">
          {/* P3 renders StudioOverview here when no leaf is selected; P2 wires leaf panes. */}
          <div className="studio-empty">Pane (Prompt 3)</div>
        </section>
      </div>
    </div>
  )
}
