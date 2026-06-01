// Customers page — the Active Customer / Subscriber Registry.
//
// Customers are NOT created from this page as the primary flow. New customers
// arrive here only after a Lead has been validated, contracted, installed,
// provisioned, payment confirmed, and activated. The acquisition flow starts
// at the Pipeline (Sales tab) with "Create Lead".
//
// This wrapper renders an info banner above the standard EntityView so the
// underlying CRUD + columns + filters + permissions stay intact — only the
// primary call-to-action shifts from "Create Customer" to "Create Lead".
import EntityView from './EntityView'
import { type Capabilities } from '../lib/capabilities'
import { UsersIcon, ArrowRightIcon, SparkleIcon } from '../components/icons'

export interface CustomersListViewProps {
  token:        string
  capabilities?: Capabilities
  canConfigure?: boolean
  onOpenCustomer?: (id: string) => void
  onGoToPipeline?: () => void
  onBack?:      () => void
}

export default function CustomersListView(props: CustomersListViewProps) {
  return (
    <div className="view">
      <div className="view-inner section-page fade" style={{ paddingBottom: 0 }}>
        {/* Registry banner — explains the lifecycle + offers the lead-first primary action */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            padding: '14px 18px',
            background: 'var(--gx-bg-2, #f8fafc)',
            border: '1px solid var(--gx-border, #e2e8f0)',
            borderRadius: 'var(--gx-radius-lg, 12px)',
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0 }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 36, height: 36,
                background: 'var(--gx-surface, #ffffff)',
                color: 'var(--gx-primary, #2563eb)',
                border: '1px solid var(--gx-border, #e2e8f0)',
                borderRadius: 10,
                flexShrink: 0,
              }}
            >
              <UsersIcon size={18} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--gx-text-1, #0f172a)', marginBottom: 2 }}>
                Active Customer / Subscriber Registry
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--gx-text-3, #64748b)', lineHeight: 1.55 }}>
                New customers are created through the Lead lifecycle and appear here after activation.
                To acquire a customer, start with <strong>Create Lead</strong> in the Pipeline.
              </div>
            </div>
          </div>

          {props.onGoToPipeline && (
            <button
              onClick={props.onGoToPipeline}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                background: 'var(--gx-primary, #2563eb)',
                color: '#ffffff',
                border: '1px solid var(--gx-primary, #2563eb)',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
              title="Go to the Sales Pipeline to start a new lead"
            >
              <SparkleIcon size={14} />
              Create Lead
              <ArrowRightIcon size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Standard customers entity view — CRUD, filters, columns, permissions all preserved */}
      <EntityView
        token={props.token}
        slug="customers"
        capabilities={props.capabilities ?? ({} as Capabilities)}
        canConfigure={props.canConfigure}
        onOpenCustomer={props.onOpenCustomer}
        onBack={props.onBack}
      />
    </div>
  )
}
