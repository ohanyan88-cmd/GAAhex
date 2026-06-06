// LeadGatesStrip — the Leads page control-spine.
//
// The four LOCKED control gates (Standard 11): Commercial · Technical · Service ·
// Operational. Gates are CHECKPOINTS, not buckets — a record passes through a gate, it
// does not live in one. So each gate reports pending / blocked / pass-rate, never a
// "records here" count. The Commercial Gate is computed from real lead status; the later
// gates await Order / Service / Billing data and render as honest labelled-empty (no fake
// numbers) until that data exists.
interface GateRow {
  status?: string | null
}

interface GateSpec {
  key: string
  name: string
  scope: string
  metrics?: { pending: number; blocked: number; passRate: number | null }
  awaiting?: string
}

export function LeadGatesStrip({ rows, onOpenGate }: { rows: GateRow[]; onOpenGate?: () => void }) {
  const by = (s: string) => rows.filter((r) => r.status === s).length
  // Commercial Gate = contract / pricing / approvals checkpoint. A lead PASSES it when it
  // becomes a signed contract (CONVERTED); it is BLOCKED when disqualified or lost; it is
  // PENDING while still working through the commercial funnel.
  const passed = by('CONVERTED')
  const blocked = by('DISQUALIFIED') + by('LOST')
  const pending = by('NEW') + by('CONTACTED') + by('WORKING') + by('QUALIFIED')
  const resolved = passed + blocked
  const passRate = resolved > 0 ? Math.round((passed / resolved) * 100) : null

  const gates: GateSpec[] = [
    {
      key: 'commercial',
      name: 'Commercial Gate',
      scope: 'Contract · pricing · compliance · approvals',
      metrics: { pending, blocked, passRate },
    },
    {
      key: 'technical',
      name: 'Technical Gate',
      scope: 'Feasibility · capacity · infrastructure readiness',
      awaiting: 'Awaiting order data',
    },
    {
      key: 'service',
      name: 'Service Gate',
      scope: 'Installation · billing readiness · activation',
      awaiting: 'Awaiting service data',
    },
    {
      key: 'operational',
      name: 'Operational Gate',
      scope: 'SLA · quality · incidents · satisfaction',
      awaiting: 'Awaiting live-service data',
    },
  ]

  return (
    <div className="gate-strip" role="group" aria-label="Lifecycle control gates">
      {gates.map((g, i) => {
        const cls = 'gate-card' + (g.metrics ? ' on' : ' awaiting') + (i === 0 ? ' first' : '')
        const inner = (
          <>
            <div className="gate-card-head">
              <span className="gate-card-name">
                <span className="gate-dot" aria-hidden />
                {g.name}
              </span>
              <span className="gate-card-scope">{g.scope}</span>
            </div>
            {g.metrics ? (
              <div className="gate-card-metrics">
                <span className="gate-metric"><b>{g.metrics.pending}</b> pending</span>
                <span className="gate-metric gate-metric-block"><b>{g.metrics.blocked}</b> blocked</span>
                <span className="gate-metric-pass">
                  {g.metrics.passRate == null ? '—' : `${g.metrics.passRate}%`} pass
                </span>
              </div>
            ) : (
              <div className="gate-card-awaiting">{g.awaiting}</div>
            )}
          </>
        )
        return onOpenGate ? (
          <button
            type="button"
            className={cls + ' gate-card-link'}
            key={g.key}
            data-gate={g.key}
            onClick={onOpenGate}
            aria-label={`${g.name} — open the pipeline`}
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
