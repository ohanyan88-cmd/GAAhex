// Reusable "Coming Soon" placeholder for routes that are locked in the nav but
// don't have a real page implementation yet. Renders via PageShell type='PLACEHOLDER':
//   - breadcrumbs (Section › Item) via PageShell header
//   - page title via PageShell header
//   - centered empty-state with a "Coming Soon" pill + description as children
//   - optional preview-list showing what the page will contain once shipped
//
// Used by every nav item whose target is a stub destination. The renderer is
// generic — pass title + parent + optional description + optional previewItems
// from the route layer.
import { LayersIcon, CheckIcon } from '../components/icons'
import { PageShell } from '../page-shell'

export interface ComingSoonViewProps {
  /** The leaf item label, e.g. "Customer Tasks" — appears as the page title + last breadcrumb. */
  title:    string
  /** The section the item lives in, e.g. "CRM" — first breadcrumb. */
  parent:   string
  /** Optional one-line description shown under the title. */
  description?: string
  /** Optional stable identifier (e.g. "customer-tasks") shown as a small mono tag next to the title. */
  id?:      string
  /** Optional bullet list shown below the description — concrete items the page WILL contain. */
  previewItems?: string[]
  /** Optional label for the preview list (default: "Planned scope"). */
  previewLabel?: string
}

// Per-stub preview content. Keyed by the nav-config `id` (e.g. "warehouse",
// "organisation-chart"). When a stub renders with a known id, the preview list
// + description below render automatically — no nav-config changes needed.
// Adding a new stub: append a new entry here with the same id used in the
// nav-config `viewArgs.id`.
const STUB_PREVIEWS: Record<string, { description?: string; previewLabel?: string; previewItems: string[] }> = {
  'warehouse': {
    description: 'Platform-level warehouse module — distinct from the NOC "Network & Stock Inventory" hardware section. Houses non-network stock, deliveries, transfers, and consumables.',
    previewLabel: 'Module scope',
    previewItems: [
      'Stock catalog (SKUs, categories, units of measure)',
      'Inbound receiving + supplier deliveries',
      'Outbound dispatch + internal transfers',
      'Stock-level alerts and reorder thresholds',
      'Audit trail across every quantity change',
    ],
  },
  'infrastructure-projects': {
    description: 'Project workspace for infrastructure rollouts — fiber routes, new POPs, pole installations, distribution upgrades. Linked to the OLT inventory and field-dispatch board.',
    previewLabel: 'Module scope',
    previewItems: [
      'Project records with milestones + budgets',
      'Crew + equipment allocation per project',
      'Linked work-orders into the Installation Board',
      'Geo-tagged route data tied to fiber inventory',
      'Per-project audit + change history',
    ],
  },
  'organisation-chart': {
    description: 'Visual hierarchy of every employee and role across the tenant. Cross-cut by department and reporting line. Updates live as Assignments change.',
    previewLabel: 'Page scope',
    previewItems: [
      'Tree view of employees grouped by org node',
      'Drill into any employee for full profile + assignments',
      'Filter by department, role, or status',
      'Export to PNG / PDF for handouts',
    ],
  },
  'organisation-depts': {
    description: 'Department directory — ownership, workload, head, and reporting structure. Backed by the OrgNode + RoleDef + Assignment kernel data.',
    previewLabel: 'Page scope',
    previewItems: [
      'Department list with member count + head',
      'Per-department workload + assignment overview',
      'Inline edit of department metadata (super_admin only)',
      'Audit trail of every department change',
    ],
  },
  'organisation-legal': {
    description: 'Legal-entity tree for multi-entity tenants. Captures the corporate structure (holding, subsidiaries, branches) and binds documents to the right entity.',
    previewLabel: 'Page scope',
    previewItems: [
      'Hierarchical view of legal entities',
      'Per-entity contracts, contacts, regulatory IDs',
      'Document binding (invoices, NDAs, licenses)',
      'Compliance-status dashboard',
    ],
  },
}


export default function ComingSoonView({ title, parent, description, id, previewItems, previewLabel }: ComingSoonViewProps) {
  // Prefer prop-provided description/preview; fall back to the per-stub map when the id matches.
  const preset = id ? STUB_PREVIEWS[id] : undefined
  const effectiveDescription = description ?? preset?.description
  const effectivePreviewItems = previewItems ?? preset?.previewItems
  const effectivePreviewLabel = previewLabel ?? preset?.previewLabel
  return (
    <PageShell
      type="PLACEHOLDER"
      breadcrumb={[parent, title]}
      icon={<LayersIcon size={18} />}
      title={title}
      subtitle="Placeholder · destination wired in nav, page not built yet"
    >
      <div
        style={{
          marginTop: 'var(--gx-space-9)',
          padding: 'var(--gx-space-16) var(--gx-space-12)',
          textAlign: 'center',
          background: 'var(--gx-surface)',
          border: '1px dashed var(--gx-border)',
          borderRadius: 'var(--gx-radius-lg)',
          maxWidth: 620,
          marginLeft: 'auto',
          marginRight: 'auto',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--gx-space-3)',
            padding: 'var(--gx-space-3) var(--gx-space-7)',
            background: 'var(--gx-warning-soft)',
            color: 'var(--gx-warning-fg)',
            border: '1px solid var(--gx-warning)',
            borderRadius: 'var(--gx-radius-full)',
            fontSize: 'var(--gx-text-11)',
            fontWeight: 'var(--gx-weight-bold)',
            textTransform: 'uppercase' as const,
            letterSpacing: '0.06em',
            marginBottom: 'var(--gx-space-8)',
          }}
        >
          Coming Soon
        </div>

        <div style={{ fontSize: 'var(--gx-text-lg)', fontWeight: 'var(--gx-weight-semibold)', color: 'var(--gx-text-1)', marginBottom: 'var(--gx-space-4)' }}>
          {title}
          {id && (
            <span
              className="mono"
              style={{
                fontSize: 'var(--gx-text-11)',
                padding: 'var(--gx-space-1) var(--gx-space-4)',
                background: 'var(--gx-bg-subtle)',
                color: 'var(--gx-text-3)',
                border: '1px solid var(--gx-border)',
                borderRadius: 'var(--gx-radius-xs)',
                fontWeight: 'var(--gx-weight-medium)',
                marginLeft: 'var(--gx-space-5)',
              }}
            >
              {id}
            </span>
          )}
        </div>

        <p style={{ fontSize: 'var(--gx-text-13)', color: 'var(--gx-text-3)', maxWidth: 440, margin: '0 auto', lineHeight: 1.6 }}>
          {effectiveDescription ?? 'This page is locked in the navigation and reserved for upcoming functionality. The route, title, and section position are in place — the implementation lands in an upcoming build phase.'}
        </p>

        {effectivePreviewItems && effectivePreviewItems.length > 0 && (
          <div
            style={{
              marginTop: 'var(--gx-space-12)',
              padding: 'var(--gx-space-7) var(--gx-space-8)',
              background: 'var(--gx-bg-subtle)',
              border: '1px solid var(--gx-border-subtle)',
              borderRadius: 'var(--gx-radius-md)',
              textAlign: 'left',
              maxWidth: 480,
              margin: 'var(--gx-space-12) auto 0',
            }}
          >
            <div
              style={{
                fontSize: 'var(--gx-text-11)',
                fontWeight: 'var(--gx-weight-bold)',
                textTransform: 'uppercase' as const,
                letterSpacing: '0.08em',
                color: 'var(--gx-text-3)',
                marginBottom: 'var(--gx-space-4)',
              }}
            >
              {effectivePreviewLabel ?? 'Planned scope'}
            </div>
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--gx-space-3)',
              }}
            >
              {effectivePreviewItems.map((item, i) => (
                <li
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 'var(--gx-space-4)',
                    fontSize: 'var(--gx-text-13)',
                    color: 'var(--gx-text-2)',
                    lineHeight: 1.5,
                  }}
                >
                  <CheckIcon size={14} style={{ color: 'var(--gx-success)', marginTop: 'var(--gx-space-1)', flexShrink: 0 }} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </PageShell>
  )
}
