// ActivityFeedView — Workspace → Activity Feed.
//
// The tenant-wide activity timeline. Wraps the ActivityTimeline component
// (frontend/src/components/ActivityTimeline.tsx), which owns the fetch of
// GET /api/activity (global mode → no entity/record params), loading skeleton,
// 403 PermissionDenied, error banner, and the designed empty state.
//
// Polish pass (2026-05-31):
//   - Wrapped in `.view-inner.workspace-page` so the page respects the
//     standard Workspace max-width / padding rhythm.
//   - The feed lives inside a single `.card` with consistent padding.
//   - Wires row click-through via `onNavigate` — clicking a row opens the
//     target record (helpdesk ticket → HelpdeskView, generic entity →
//     EntityView for that slug).

import ViewHead from '../components/ViewHead'
import ActivityTimeline, { type ActivityNavTarget } from '../components/ActivityTimeline'
import { ActivityIcon } from '../components/icons'

export default function ActivityFeedView({
  token,
  onNavigate,
}: {
  token: string
  onNavigate?: (target: ActivityNavTarget) => void
}) {
  return (
    <div className="view">
      <div className="view-inner workspace-page fade">
        <div className="crumbs">
          <span>Workspace</span>
          <span className="sep">/</span>
          <span style={{ color: 'var(--gx-text-1)' }}>Activity Feed</span>
        </div>

        <ViewHead
          icon={<ActivityIcon size={18} />}
          title="Activity Feed"
          sub="Recent actions across records you can see"
        />

        <div className="card act-feed-card">
          <ActivityTimeline token={token} onNavigate={onNavigate} />
        </div>
      </div>
    </div>
  )
}
