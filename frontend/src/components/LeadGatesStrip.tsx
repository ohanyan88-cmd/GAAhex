// LeadGatesStrip — the Leads page control-spine.
//
// Four control gates, each a phase of the end-to-end SST flow and each backed by a DIFFERENT
// entity (a record becomes lead → order → customer as it moves through the lifecycle):
//   • Commercial   — Leads working through the commercial funnel
//   • Technical    — Orders in validation → config → install → connection
//   • Billing      — Orders in payment → activation
//   • Customer Care— active Customers (monitoring / care)
// Each card shows HOW MANY records are currently in that gate; clicking opens a same-page window
// listing them. No navigation to the Pipeline (that is a management page), no fake numbers.
interface Row { status?: string | null }

export interface GateSpec {
  key:      string
  name:     string
  scope:    string
  entity:   'lead' | 'order' | 'customer'
  statuses: string[]   // statuses of `entity` that count as "currently in" this gate
}

// Single source for the gate → entity + statuses mapping — shared with EntityView so the strip
// count and the gate window's filtered list always agree. All statuses are UPPER_SNAKE — every
// canonical entity (lead/order/customer) is SST-aligned with no exception (B1b 2026-06-14).
export const GATES: GateSpec[] = [
  { key: 'commercial',   name: 'Commercial Gate',    scope: 'Lead · contract · pricing · approvals',      entity: 'lead',     statuses: ['LEAD', 'VALIDATED_LEAD', 'ASSIGNED', 'DEAL', 'CONTRACT_SIGNED'] },
  { key: 'technical',    name: 'Technical Gate',     scope: 'Validation · config · install · connection', entity: 'order',    statuses: ['ORDER_VALIDATED', 'SCHEDULING', 'CONFIG', 'INSTALLATION', 'CONNECTION_TEST'] },
  { key: 'billing',      name: 'Billing Gate',       scope: 'First payment · activation',                 entity: 'order',    statuses: ['PAYMENT_CONFIRMED', 'ACTIVATION'] },
  { key: 'customercare', name: 'Customer Care Gate', scope: 'Monitoring · care · SLA · satisfaction',      entity: 'customer', statuses: ['ACTIVE', 'SUSPENDED'] },
]

const ENTITY_LABEL: Record<GateSpec['entity'], [string, string]> = {
  lead:     ['lead', 'leads'],
  order:    ['order', 'orders'],
  customer: ['customer', 'customers'],
}

export function LeadGatesStrip({ leads, orders, customers, onOpenGate }: {
  leads: Row[]
  orders: Row[]
  customers: Row[]
  onOpenGate?: (gateKey: string) => void
}) {
  const dataFor = (e: GateSpec['entity']): Row[] => e === 'lead' ? leads : e === 'order' ? orders : customers
  const countIn = (g: GateSpec) => dataFor(g.entity).filter((r) => g.statuses.includes(r.status ?? '')).length

  return (
    <div className="gate-strip" role="group" aria-label="Lifecycle control gates">
      {GATES.map((g, i) => {
        const count = countIn(g)
        const [one, many] = ENTITY_LABEL[g.entity]
        const cls = 'gate-card on' + (i === 0 ? ' first' : '')
        const inner = (
          <>
            <div className="gate-card-head">
              <span className="gate-card-name">
                <span className="gate-dot" aria-hidden />
                <span className="gate-card-label">{g.name}</span>
              </span>
              <span className="gate-card-scope">{g.scope}</span>
            </div>
            <div className="gate-card-metrics">
              <span className="gate-metric"><b>{count}</b> {count === 1 ? one : many}</span>
            </div>
          </>
        )
        return onOpenGate ? (
          <button
            type="button"
            className={cls + ' gate-card-link'}
            key={g.key}
            data-gate={g.key}
            onClick={() => onOpenGate(g.key)}
            aria-label={`${g.name} — ${count} ${count === 1 ? one : many}, open list`}
          >
            {inner}
          </button>
        ) : (
          <div className={cls} key={g.key} data-gate={g.key}>{inner}</div>
        )
      })}
    </div>
  )
}

export default LeadGatesStrip
