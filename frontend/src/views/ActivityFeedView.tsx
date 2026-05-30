// ActivityFeedView — Workspace → Activity Feed.
//
// The tenant-wide activity timeline. Wraps the existing ActivityTimeline
// component (frontend/src/components/ActivityTimeline.tsx), which owns the real
// fetch of GET /api/activity (global mode → no entity/record params), the
// loading skeleton, the 403 PermissionDenied state, the error banner, and the
// EmptyState ("No activity yet"). Lifted out of App.tsx's inline render branch
// per the Wave A scaffold so the Workspace nav item resolves to a first-class
// View.type instead of inline JSX.

import ViewHead from '../components/ViewHead'
import ActivityTimeline from '../components/ActivityTimeline'
import { ActivityIcon } from '../components/icons'

export default function ActivityFeedView({ token }: { token: string }) {
  return (
    <div className="view">
      <div className="view-inner fade">
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

        <div className="card" style={{ padding: 14 }}>
          <ActivityTimeline token={token} />
        </div>
      </div>
    </div>
  )
}
