import type { CSSProperties } from 'react'
import { Modal } from '../../components/Modal'
import { Button, StatusPill } from '../../primitives'
import { timeAgo, fmtDate } from '../../lib/time'
import type { RaFinding, FindingStatus, DetailState } from './types'
import { FINDING_TYPE_LABEL, STATUS_LABEL, statusToPill, severityToPill } from './types'

const drawerSectionTitleStyle: CSSProperties = {
  fontSize: 'var(--gx-text-11)',
  fontWeight: 'var(--gx-weight-semibold)',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: 'var(--gx-text-3)',
  marginBottom: 8,
}

const drawerCardStyle: CSSProperties = {
  padding: 12,
  background: 'var(--gx-surface-2)',
  border: '1px solid var(--gx-border-subtle)',
  borderRadius: 8,
}

const drawerLabelStyle: CSSProperties = {
  display: 'inline-block',
  minWidth: 84,
  fontSize: 'var(--gx-text-11)',
  color: 'var(--gx-text-3)',
  fontWeight: 'var(--gx-weight-medium)',
}

function DetailJsonFields({ detail }: { detail: Record<string, any> | null | undefined }) {
  if (!detail || typeof detail !== 'object' || Object.keys(detail).length === 0) {
    return (
      <div style={{ fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-3)' }}>No additional context.</div>
    )
  }
  const KNOWN = new Set(['customer_id', 'gap_days', 'activated_at', 'cycle_start', 'cycle_end'])
  const rest: Record<string, any> = {}
  for (const [k, v] of Object.entries(detail)) {
    if (!KNOWN.has(k)) rest[k] = v
  }
  const gap = typeof detail.gap_days === 'number' ? detail.gap_days : null
  const activatedAt = typeof detail.activated_at === 'string' ? detail.activated_at : null
  const cycleStart = typeof detail.cycle_start === 'string' ? detail.cycle_start : null
  const cycleEnd = typeof detail.cycle_end === 'string' ? detail.cycle_end : null
  const hasCycle = !!(cycleStart || cycleEnd)
  const restHasContent = Object.keys(rest).length > 0

  return (
    <>
      {gap != null && (
        <div>
          <span style={drawerLabelStyle}>Gap</span>
          <span>Service has been active {gap} day{gap === 1 ? '' : 's'} without billing</span>
        </div>
      )}
      {activatedAt && (
        <div>
          <span style={drawerLabelStyle}>Activated</span>
          <span title={activatedAt}>
            {timeAgo(activatedAt) || fmtDate(activatedAt)}
            <span style={{ marginLeft: 'var(--gx-space-3)', color: 'var(--gx-text-3)', fontSize: 'var(--gx-text-11)' }}>{activatedAt}</span>
          </span>
        </div>
      )}
      {hasCycle && (
        <div>
          <span style={drawerLabelStyle}>Cycle</span>
          <span>
            {cycleStart ? fmtDate(cycleStart) : '?'} → {cycleEnd ? fmtDate(cycleEnd) : '?'}
          </span>
        </div>
      )}
      {restHasContent && (
        <div>
          <div style={{ ...drawerLabelStyle, marginBottom: 'var(--gx-space-2)' }}>Other</div>
          <pre style={{
            margin: 0,
            padding: 'var(--gx-space-3)',
            background: 'var(--gx-surface)',
            border: '1px solid var(--gx-border-subtle)',
            borderRadius: 'var(--gx-radius-sm)',
            fontSize: 'var(--gx-text-11)',
            lineHeight: 1.5,
            color: 'var(--gx-text-2)',
            overflowX: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>{JSON.stringify(rest, null, 2)}</pre>
        </div>
      )}
    </>
  )
}

function StatusFlow({ current }: { current: FindingStatus }) {
  const steps: { key: FindingStatus; label: string }[] = current === 'false_positive'
    ? [
        { key: 'open', label: 'Open' },
        { key: 'investigating', label: 'Investigating' },
        { key: 'false_positive', label: 'False positive' },
      ]
    : [
        { key: 'open', label: 'Open' },
        { key: 'investigating', label: 'Investigating' },
        { key: 'resolved', label: 'Resolved' },
      ]
  const order = { open: 0, investigating: 1, resolved: 2, false_positive: 2 } as const
  const currentIdx = order[current]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-3)', flexWrap: 'wrap' }}>
      {steps.map((s, i) => {
        const reached = order[s.key] <= currentIdx
        const isCurrent = s.key === current
        return (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-3)' }}>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: 'var(--gx-space-2) var(--gx-space-5)',
              borderRadius: 'var(--gx-radius-full)',
              fontSize: 'var(--gx-text-11)',
              fontWeight: isCurrent ? 600 : 500,
              background: isCurrent
                ? (s.key === 'resolved'
                    ? 'var(--gx-success-soft)'
                    : s.key === 'false_positive'
                      ? 'var(--gx-bg-subtle)'
                      : s.key === 'investigating'
                        ? 'var(--gx-warning-soft)'
                        : 'var(--gx-danger-soft)')
                : reached ? 'var(--gx-surface)' : 'transparent',
              color: isCurrent
                ? (s.key === 'resolved'
                    ? 'var(--gx-success)'
                    : s.key === 'false_positive'
                      ? 'var(--gx-text-2)'
                      : s.key === 'investigating'
                        ? 'var(--gx-warning)'
                        : 'var(--gx-danger)')
                : reached ? 'var(--gx-text-2)' : 'var(--gx-text-3)',
              border: '1px solid ' + (isCurrent
                ? 'transparent'
                : reached ? 'var(--gx-border-subtle)' : 'var(--gx-border-subtle)'),
            }}>
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <span style={{
                width: 'var(--gx-space-18)',
                height: 1,
                background: 'var(--gx-border)',
                display: 'inline-block',
              }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export function FindingDrawer(props: {
  seed: RaFinding
  detail: DetailState
  customer: { id: string; name: string | null } | null
  canAdmin: boolean
  onClose: () => void
  onAck: () => void
  onOpenResolve: (f: RaFinding) => void
  onOpenMarkFP: (f: RaFinding) => void
}) {
  const { seed, detail, customer, canAdmin, onClose, onAck, onOpenResolve, onOpenMarkFP } = props
  const f: RaFinding = detail.state === 'ok' ? detail.value : seed
  const actionable = f.status === 'open' || f.status === 'investigating'

  return (
    <Modal
      open
      onClose={onClose}
      title={FINDING_TYPE_LABEL[f.finding_type] ?? f.finding_type}
      subtitle={f.id ? f.id : undefined}
      size="lg"
      hero={
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-5)', flexWrap: 'wrap' }}>
          <StatusPill variant={severityToPill(f.severity)} label={f.severity} size="sm" />
          <StatusPill variant={statusToPill(f.status)} label={STATUS_LABEL[f.status]} size="sm" />
          <span style={{ fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-3)' }} title={f.detected_at}>
            Detected {timeAgo(f.detected_at) || fmtDate(f.detected_at)}
          </span>
          {detail.state === 'loading' && (
            <span style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)', marginLeft: 'auto' }}>Refreshing…</span>
          )}
          {detail.state === 'error' && (
            <span style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-warning)', marginLeft: 'auto' }} title={detail.message}>
              Using cached row
            </span>
          )}
        </div>
      }
      footer={
        <>
          {canAdmin && actionable && f.status === 'open' && (
            <Button variant="ghost" size="md" onClick={onAck}>Acknowledge</Button>
          )}
          {canAdmin && actionable && (
            <Button variant="secondary" size="md" onClick={() => onOpenMarkFP(f)}>Mark False Positive…</Button>
          )}
          {canAdmin && actionable && (
            <Button variant="primary" size="md" onClick={() => onOpenResolve(f)}>Resolve…</Button>
          )}
          <Button variant="ghost" size="md" onClick={onClose}>Close</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-8)' }}>
        <section>
          <div style={drawerSectionTitleStyle}>Summary</div>
          <p style={{ margin: 0, color: 'var(--gx-text-1)', fontSize: 'var(--gx-text-13)', lineHeight: 1.5 }}>
            {f.summary || <span style={{ color: 'var(--gx-text-3)' }}>No summary recorded.</span>}
          </p>
        </section>

        <section style={drawerCardStyle}>
          <div style={drawerSectionTitleStyle}>Entity context</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-3)', fontSize: 'var(--gx-text-13)' }}>
            <div>
              <span style={drawerLabelStyle}>Entity</span>
              <span style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)', textTransform: 'uppercase', marginRight: 'var(--gx-space-3)' }}>
                {f.entity_type}
              </span>
              <span className="mono" style={{ fontSize: 'var(--gx-text-sm)' }} title={f.entity_id}>
                {f.entity_id ? f.entity_id.slice(0, 8) : '—'}
              </span>
            </div>

            {customer && (
              <div>
                <span style={drawerLabelStyle}>Customer</span>
                {customer.name
                  ? <span style={{ color: 'var(--gx-text-1)' }}>{customer.name}</span>
                  : <span className="mono" style={{ fontSize: 'var(--gx-text-sm)' }} title={customer.id}>{customer.id.slice(0, 8)}</span>}
              </div>
            )}

            <DetailJsonFields detail={f.detail_json} />
          </div>
        </section>

        <section style={drawerCardStyle}>
          <div style={drawerSectionTitleStyle}>Status flow</div>
          <StatusFlow current={f.status} />
        </section>

        {f.ack_at && (
          <section style={drawerCardStyle}>
            <div style={drawerSectionTitleStyle}>Acknowledged</div>
            <div style={{ fontSize: 'var(--gx-text-13)', color: 'var(--gx-text-2)' }}>
              {f.ack_by && (
                <>
                  <span className="mono" style={{ fontSize: 'var(--gx-text-sm)' }} title={f.ack_by}>{f.ack_by.slice(0, 8)}</span>
                  <span> · </span>
                </>
              )}
              <span title={f.ack_at}>{timeAgo(f.ack_at) || fmtDate(f.ack_at)}</span>
            </div>
          </section>
        )}

        {(f.status === 'resolved' || f.status === 'false_positive' || f.resolved_at) && (
          <section style={drawerCardStyle}>
            <div style={drawerSectionTitleStyle}>
              {f.status === 'false_positive' ? 'Marked false positive' : 'Resolved'}
            </div>
            <div style={{ fontSize: 'var(--gx-text-13)', color: 'var(--gx-text-2)' }}>
              {f.resolved_by && (
                <>
                  <span className="mono" style={{ fontSize: 'var(--gx-text-sm)' }} title={f.resolved_by}>{f.resolved_by.slice(0, 8)}</span>
                  <span> · </span>
                </>
              )}
              {f.resolved_at && <span title={f.resolved_at}>{timeAgo(f.resolved_at) || fmtDate(f.resolved_at)}</span>}
              {f.resolution && (
                <p style={{ marginTop: 'var(--gx-space-3)', marginBottom: 0, color: 'var(--gx-text-1)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                  {f.resolution}
                </p>
              )}
            </div>
          </section>
        )}
      </div>
    </Modal>
  )
}
