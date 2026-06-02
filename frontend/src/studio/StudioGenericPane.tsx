// GAAhex Studio — generic leaf pane router.
//
// Resolution order for every Studio leaf:
//   1. REAL_PANE_BY_LEAF_ID  → real, backend-wired CRUD panes (7 leaves, RLS).
//   2. richPaneFor(label)    → curated rich panes (StudioRichPanes.tsx).
//   3. Otherwise             → an honest "Not yet wired" empty state.
//
// We do NOT render archetype scaffolds with fake seed data or inert TODO
// buttons anymore. If a leaf has no real backend wiring, the surface tells
// the user that plainly instead of pretending.

import { type FlatLeaf } from './tree'
import { iconFor } from './iconMap'
import { richPaneFor, FeatureFlagsPane } from './StudioRichPanes'
import { EmptyState } from '../components/States'
import FieldsPane from './FieldsPane'
import EntitiesPane from './EntitiesPane'
import ViewsPane from './ViewsPane'
import WorkflowsPane from './WorkflowsPane'
import RolesPane from './RolesPane'
import UsersPane from './UsersPane'
import ReportsPane from './ReportsPane'
import DashboardsPane from './DashboardsPane'
import AutomationsPane from './AutomationsPane'
import NotificationsPane from './NotificationsPane'
import WebhooksPane from './WebhooksPane'
import ApiDocsPane from './ApiDocsPane'
import AuditLogPane from './AuditLogPane'
import SystemHealthPane from './SystemHealthPane'

// ── real-data pane resolver ──────────────────────────────────────────────────
// These panes are wired to the backend (CRUD + RLS). For the Studio leaves
// listed below, render the REAL pane instead of the mock rich-pane / empty
// state. All require a bearer `token`; StudioShell threads it down. Notifications
// uses ONE shared component (NotificationsPane) parameterised per leaf.
//
// Leaf id format = `${groupId}.${moduleId?}.${leafId}` (see tree.ts).
const REAL_PANE_BY_LEAF_ID: Record<string, React.ComponentType<{ token: string }>> = {
  'data.models.entities':                       EntitiesPane,
  'data.models.fields':                         FieldsPane,
  'experience.pages.page-registry':             ViewsPane,
  'logic.workflows.workflow-designer':          WorkflowsPane,
  'security.roles':                             RolesPane,
  'security.users':                             UsersPane,
  'intelligence.analytics.reports':             ReportsPane,
  'intelligence.analytics.dashboards':          DashboardsPane,
  'logic.automations.triggers':                 AutomationsPane,
  // Notifications group — all five leaves share NotificationsPane, parametrised
  // by channel or `rulesView`. One backend (/meta/notification-defs) drives them all.
  'notifications.email-templates':              (p) => <NotificationsPane {...p} channel="email" />,
  'notifications.sms-templates':                (p) => <NotificationsPane {...p} channel="sms" />,
  'notifications.push-notifications':           (p) => <NotificationsPane {...p} channel="push" />,
  'notifications.in-app-notifications':         (p) => <NotificationsPane {...p} channel="inapp" />,
  'notifications.notification-rules':           (p) => <NotificationsPane {...p} rulesView />,
  // Developer group — Webhooks + API Docs (Task 3 Module 4). All other Developer
  // leaves (Custom Code, SDK, CLI) stay on "Not yet wired".
  'developer.webhooks':                         WebhooksPane,
  'developer.api-docs':                         ApiDocsPane,
  // System Control / Release / Governance — Module 5 priority-1 leaves.
  // Feature Flags lives under Release in tree.ts; Audit Logs lives under
  // Governance; System Health lives under System Control. All three are
  // platform-infrastructure concerns and ship together as Module 5.
  'release.feature-flags':                      FeatureFlagsPane,
  'governance.audit-logs':                      AuditLogPane,
  'system-control.system-health':               SystemHealthPane,
}

// ── StudioGenericPane (exported default) ─────────────────────────────────────

export default function StudioGenericPane({ leaf, token }: { leaf: FlatLeaf; token: string | null }) {
  // Real-data panes take top priority — backend-wired CRUD for these leaves.
  // They require a token; if absent (not logged in), fall through so the
  // surface still renders rather than crashing.
  const RealPane = REAL_PANE_BY_LEAF_ID[leaf.id]
  if (RealPane && token) {
    return (
      <div>
        <div className="crumbs" style={{ marginTop: 0 }}>
          <span>{leaf.groupLabel}</span>
          {leaf.moduleLabel && (
            <>
              <span className="sep">/</span>
              <span>{leaf.moduleLabel}</span>
            </>
          )}
          <span className="sep">/</span>
          <span style={{ color: 'var(--gx-text-1)' }}>{leaf.leafLabel}</span>
        </div>
        <RealPane token={token} />
      </div>
    )
  }

  // Rich pane takes priority over the empty-state fallback.
  const RichPane = richPaneFor(leaf.leafLabel)
  if (RichPane) {
    return (
      <div>
        <div className="crumbs" style={{ marginTop: 0 }}>
          <span>{leaf.groupLabel}</span>
          {leaf.moduleLabel && (
            <>
              <span className="sep">/</span>
              <span>{leaf.moduleLabel}</span>
            </>
          )}
          <span className="sep">/</span>
          <span style={{ color: 'var(--gx-text-1)' }}>{leaf.leafLabel}</span>
        </div>
        <RichPane token={token ?? undefined} />
      </div>
    )
  }

  // Honest fallback — no fake data, no inert buttons.
  const IconCmp = iconFor(leaf.moduleIcon ?? leaf.groupIcon)
  return (
    <div>
      <div className="crumbs" style={{ marginTop: 0 }}>
        <span>{leaf.groupLabel}</span>
        {leaf.moduleLabel && (
          <>
            <span className="sep">/</span>
            <span>{leaf.moduleLabel}</span>
          </>
        )}
        <span className="sep">/</span>
        <span style={{ color: 'var(--gx-text-1)' }}>{leaf.leafLabel}</span>
      </div>
      <div className="section-head" style={{ marginTop: 6 }}>
        <IconCmp size={16} className="section-icon" />
        {leaf.leafLabel}
      </div>
      <EmptyState
        title="Not yet wired"
        message="This Studio surface is reserved for a future backend integration. No data or actions are available yet."
      />
    </div>
  )
}
