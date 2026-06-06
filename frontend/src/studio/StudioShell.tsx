// GAAhex Studio shell — the SuperAdmin builder + configuration center + publishing control.
// P1: header + frame + SuperAdmin gate + /studio URL sync. Left tree and right pane are filled
// in P2 (tree nav) and P3 (overview landing).
//
// SuperAdmin gate: rendered behind `user.can_configure`. Server gate is the same flag —
// any future /studio/* endpoint must depend on `current_user` and `can(grants, "config", "manage")`
// (see backend/app/routers/auth.py `me` for the canonical check, and backend/app/access.py
// for `load_grants` + `can`). UI hiding alone is not security.
import { Button } from '../primitives'
import { useEffect } from 'react'
import { ChevronLeft, Eye, Rocket, Shield } from 'lucide-react'
import ViewHead from '../components/ViewHead'
import StudioTree, { type StudioPick } from './StudioTree'
import StudioOverview from './StudioOverview'
import StudioGenericPane from './StudioGenericPane'
import { LEAF_BY_ID } from './tree'

export type StudioRoute = { group?: string; module?: string; leaf?: string }

export default function StudioShell({
  token,
  canConfigure,
  route,
  onRoute,
  onBack,
}: {
  token: string | null
  canConfigure: boolean
  route: StudioRoute
  onRoute: (r: StudioRoute) => void
  onBack?: () => void
}) {
  // Keep the browser URL in sync with the in-app route so deep links work and the back button
  // navigates within Studio. The GAAhex app uses a `view` state union (no React Router yet);
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

  // Resolve the current selection: 'overview' when there's no leaf, or the canonical leaf id
  // (groupId[.moduleId].leafId) which the tree highlights with a gold rail.
  const leafIdGuess = route.leaf
    ? (route.module
        ? `${route.group}.${route.module}.${route.leaf}`
        : `${route.group}.${route.leaf}`)
    : null
  const leaf = leafIdGuess ? LEAF_BY_ID[leafIdGuess] : undefined
  const activeId = leaf ? leaf.id : 'overview'

  function onPick(p: StudioPick) {
    onRoute({ group: p.group, module: p.module, leaf: p.leaf })
  }

  if (!canConfigure) {
    // Defense-in-depth: server is primary, but never render the shell without the flag.
    return (
      <div className="view-inner fade section-page" style={{ maxWidth: 720 }}>
        <div className="crumbs">
          <span style={{ color: 'var(--gx-text-1)' }}>Studio</span>
        </div>
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
    <div className="view-inner fade">
      <ViewHead
        icon={<Shield size={20} />}
        title="Studio"
        sub="Visual builder · configuration center · publishing control"
        actions={
          <>
            {onBack && (
              <Button variant="ghost" size="sm"
            type="button" onClick={onBack}>
                <ChevronLeft size={14} />Back
              </Button>
            )}
            <span className="pill pill-gold" style={{ marginRight: 'var(--gx-space-1)' }}>
              <Shield size={12} />SuperAdmin
            </span>
            <span className="studio-pill draft">
              <span className="d" />Draft
            </span>
            <Button variant="secondary" size="sm"
            type="button"
              onClick={() => onRoute({ group: 'quality', leaf: 'preview' })}
              title="Open Preview Mode"
            >
              <Eye size={14} />Preview
            </Button>
            <Button variant="primary" size="sm"
            type="button"
              onClick={() => onRoute({ group: 'release', leaf: 'deployment' })}
              title="Open Publish Settings"
            >
              <Rocket size={14} />Publish
            </Button>
          </>
        }
      />
      <div className="studio tree-studio">
        <StudioTree activeId={activeId} onPick={onPick} />
        <section className="studio-pane">
          {leaf ? (
            <StudioGenericPane leaf={leaf} token={token} />
          ) : (
            <StudioOverview onPick={onPick} />
          )}
        </section>
      </div>
    </div>
  )
}
