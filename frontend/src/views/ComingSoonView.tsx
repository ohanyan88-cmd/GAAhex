// Reusable "Coming Soon" placeholder for routes that are locked in the nav but
// don't have a real page implementation yet. Renders via PageShell type='PLACEHOLDER':
//   - breadcrumbs (Section › Item) via PageShell header
//   - page title via PageShell header
//   - centered empty-state with a "Coming Soon" pill + description as children
//
// Used by every nav item whose target is a stub destination. The renderer is
// generic — pass title + parent + optional description from the route layer.
import { LayersIcon } from '../components/icons'
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
}

export default function ComingSoonView({ title, parent, description, id }: ComingSoonViewProps) {
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
          marginTop: 60,
          padding: '56px 24px',
          textAlign: 'center',
          background: 'var(--gx-surface, #ffffff)',
          border: '1px dashed var(--gx-border, #e2e8f0)',
          borderRadius: 'var(--gx-radius-lg, 12px)',
          maxWidth: 620,
          marginLeft: 'auto',
          marginRight: 'auto',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '5px 14px',
            background: 'var(--gx-warning-soft)',
            color: 'var(--gx-warning-fg, #92400e)',
            border: '1px solid var(--gx-warning)',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase' as const,
            letterSpacing: '0.06em',
            marginBottom: 18,
          }}
        >
          Coming Soon
        </div>

        <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--gx-text-1, #0f172a)', marginBottom: 8 }}>
          {title}
          {id && (
            <span
              className="mono"
              style={{
                fontSize: 11,
                padding: '2px 8px',
                background: 'var(--gx-bg-subtle)',
                color: 'var(--gx-text-3, #64748b)',
                border: '1px solid var(--gx-border, #e2e8f0)',
                borderRadius: 6,
                fontWeight: 500,
                marginLeft: 10,
              }}
            >
              {id}
            </span>
          )}
        </div>

        <p style={{ fontSize: 13, color: 'var(--gx-text-3, #64748b)', maxWidth: 440, margin: '0 auto', lineHeight: 1.6 }}>
          {description ?? 'This page is locked in the navigation and reserved for upcoming functionality. The route, title, and section position are in place — the implementation lands in an upcoming build phase.'}
        </p>
      </div>
    </PageShell>
  )
}
