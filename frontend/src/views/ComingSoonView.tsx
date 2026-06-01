// Reusable "Coming Soon" placeholder for routes that are locked in the nav but
// don't have a real page implementation yet. Renders:
//   - breadcrumbs (Section › Item)
//   - page title + identifier badge
//   - centered empty-state with a "Coming Soon" pill + description
//
// Used by every nav item whose target is a stub destination. The renderer is
// generic — pass title + parent + optional description from the route layer.
import { ChevronRightIcon, LayersIcon } from '../components/icons'

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
    <div className="view">
      <div className="view-inner section-page fade">
        <div className="crumbs">
          <span>{parent}</span>
          <ChevronRightIcon size={14} />
          <span style={{ color: 'var(--gx-text-1)' }}>{title}</span>
        </div>

        <div className="view-head">
          <div className="view-icon"><LayersIcon size={20} /></div>
          <div className="view-title-wrap">
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {title}
              {id && (
                <span
                  className="mono"
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    background: 'var(--gx-bg-2, #f1f5f9)',
                    color: 'var(--gx-text-3, #64748b)',
                    border: '1px solid var(--gx-border, #e2e8f0)',
                    borderRadius: 6,
                    fontWeight: 500,
                  }}
                >
                  {id}
                </span>
              )}
            </h2>
            <span className="view-sub">Placeholder · destination wired in nav, page not built yet</span>
          </div>
        </div>

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
              background: 'var(--gx-warning-bg, #fef3c7)',
              color: 'var(--gx-warning-fg, #92400e)',
              border: '1px solid var(--gx-warning-border, #fde68a)',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 18,
            }}
          >
            Coming Soon
          </div>

          <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--gx-text-1, #0f172a)', marginBottom: 8 }}>
            {title}
          </div>

          <p style={{ fontSize: 13, color: 'var(--gx-text-3, #64748b)', maxWidth: 440, margin: '0 auto', lineHeight: 1.6 }}>
            {description ?? 'This page is locked in the navigation and reserved for upcoming functionality. The route, title, and section position are in place — the implementation lands in an upcoming build phase.'}
          </p>
        </div>
      </div>
    </div>
  )
}
