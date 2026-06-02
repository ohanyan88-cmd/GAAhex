// ActivityFeedView — Workspace → Activity Feed.
//
// The tenant-wide activity timeline. Wraps the ActivityTimeline component
// (frontend/src/components/ActivityTimeline.tsx), which owns the fetch of
// GET /api/activity (global mode → no entity/record params), loading skeleton,
// 403 PermissionDenied, error banner, and the designed empty state.
//
// Polish pass (2026-05-31):
//   - Wrapped in `.view-inner.section-page` so the page respects the
//     standard section max-width / padding rhythm.
//   - The feed lives inside a single `.card` with consistent padding.
//   - Wires row click-through via `onNavigate` — clicking a row opens the
//     target record (helpdesk ticket → HelpdeskView, generic entity →
//     EntityView for that slug).

import ActivityTimeline, { type ActivityNavTarget } from '../components/ActivityTimeline'
import { ActivityIcon } from '../components/icons'
import { PageShell } from '../page-shell'

export default function ActivityFeedView({
  token,
  onNavigate,
}: {
  token: string
  onNavigate?: (target: ActivityNavTarget) => void
}) {
  return (
    <PageShell
      type="WORKSPACE"
      breadcrumb={['Workspace', 'Activity Feed']}
      icon={<ActivityIcon size={18} />}
      title="Activity Feed"
      subtitle="System-wide event stream"
    >
      <div className="card act-feed-card">
        <ActivityTimeline token={token} onNavigate={onNavigate} />
      </div>
    </PageShell>
  )
}
