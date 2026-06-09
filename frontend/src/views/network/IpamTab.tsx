// NetworkInventoryView — IPAM Assignments tab.
import { Button, StatusPill } from '../../primitives'
import type { LoadState } from '../../primitives'
import { RefreshIcon } from '../../components/icons'
import { timeAgo, fmtDate } from '../../lib/time'
import type { IpamAssignment } from './types'
import { ipamStatusVariant } from './helpers'
import { FilterSelect, TabToolbar, LoadShell } from './shared'

export function IpamTab({ state, status, onStatus, query, onQuery, canAdmin, onRelease, onReload }: {
  state: LoadState<IpamAssignment>
  status: 'active' | 'all'
  onStatus: (s: 'active' | 'all') => void
  query: string
  onQuery: (q: string) => void
  canAdmin: boolean
  onRelease: (a: IpamAssignment) => void
  onReload: () => void
}) {
  return (
    <div>
      <TabToolbar
        left={
          <>
            <FilterSelect
              label="Status"
              value={status}
              onChange={(v) => onStatus(v as 'active' | 'all')}
              options={[['active', 'Active'], ['all', 'All']]}
            />
            <input
              className="inp inp-sm"
              type="search"
              placeholder="Search by address…"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              style={{ minWidth: 240 }}
            />
          </>
        }
        right={
          <Button variant="ghost" size="sm"
            onClick={onReload}>
            <RefreshIcon size={13} /> Refresh
          </Button>
        }
      />

      <LoadShell
        state={state}
        emptyTitle="No IP assignments to show"
        emptyMessage="IP assignment happens during service provisioning. Empty here means no active leases match the current filter."
        onRetry={onReload}
      >
        {(items) => (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="grid" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Address</th>
                    <th>Family</th>
                    <th>Status</th>
                    <th>Service</th>
                    <th>MAC</th>
                    <th>Assigned</th>
                    <th>Lease expires</th>
                    <th className="actions-col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((a) => {
                    const isActive = (a.status ?? '').toLowerCase() === 'active'
                    return (
                      <tr key={a.id}>
                        <td><span className="mono" style={{ fontSize: 'var(--gx-text-sm)' }}>{a.address ?? '—'}</span></td>
                        <td>{a.family ?? '—'}</td>
                        <td>
                          <StatusPill variant={ipamStatusVariant(a.status)} label={a.status ?? '—'} size="sm" />
                        </td>
                        <td><span className="mono" style={{ fontSize: 'var(--gx-text-sm)' }}>{a.service_id ? a.service_id.slice(0, 8) : '—'}</span></td>
                        <td><span className="mono" style={{ fontSize: 'var(--gx-text-sm)' }}>{a.mac ?? '—'}</span></td>
                        <td className="muted" style={{ fontSize: 'var(--gx-text-sm)' }}>
                          <span title={a.assigned_at ?? undefined}>{timeAgo(a.assigned_at ?? null) || '—'}</span>
                        </td>
                        <td className="muted" style={{ fontSize: 'var(--gx-text-sm)' }}>
                          <span title={a.lease_expires_at ?? undefined}>{fmtDate(a.lease_expires_at)}</span>
                        </td>
                        <td className="actions-col" onClick={(e) => e.stopPropagation()}>
                          <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                            {canAdmin && isActive && (
                              <Button variant="ghost" size="sm" onClick={() => onRelease(a)}>Release</Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </LoadShell>
    </div>
  )
}
