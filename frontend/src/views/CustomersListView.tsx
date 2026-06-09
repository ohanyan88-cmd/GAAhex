// Customers page — the Active Customer / Subscriber Registry.
//
// Customers are NOT created from this page as the primary flow. New customers
// arrive here only after a Lead has been validated, contracted, installed,
// provisioned, payment confirmed, and activated. The acquisition flow starts
// at the Pipeline (Sales tab) with "Create Lead".
//
// This wrapper renders the standard EntityView under a PageShell registry frame.
// The lifecycle context (previously a banner) is now carried by the subtitle prop.
import EntityView from './EntityView'
import { type Capabilities } from '../lib/capabilities'
import { UsersIcon, SparkleIcon } from '../components/icons'
import { PageShell } from '../page-shell'
export interface CustomersListViewProps {
  capabilities?: Capabilities
  canConfigure?: boolean
  onOpenCustomer?: (id: string) => void
  onGoToPipeline?: () => void
  onBack?:      () => void
}

export default function CustomersListView(props: CustomersListViewProps) {
  return (
    <PageShell
      type="REGISTRY"
      breadcrumb={['CRM', 'Customers']}
      icon={<UsersIcon size={18} />}
      title="Customers"
      subtitle="Active customer and subscriber registry. New customers are created through the Lead lifecycle and appear here after activation."
      primaryAction={props.onGoToPipeline ? {
        label: 'Create Lead',
        icon: <SparkleIcon size={14} />,
        onClick: props.onGoToPipeline,
      } : undefined}
    >
      {/* Standard customers entity view — CRUD, filters, columns, permissions all preserved */}
      <EntityView
        slug="customers"
        capabilities={props.capabilities ?? ({} as Capabilities)}
        canConfigure={props.canConfigure}
        onOpenCustomer={props.onOpenCustomer}
        onBack={props.onBack}
      />
    </PageShell>
  )
}
