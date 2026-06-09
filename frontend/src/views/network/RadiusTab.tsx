// NetworkInventoryView — RADIUS Sessions tab.
import { Button, StatusPill, KPITile } from '../../primitives'
import type { LoadState } from '../../primitives'
import { RefreshIcon } from '../../components/icons'
import { timeAgo } from '../../lib/time'
import type { RadiusSession } from './types'
import { radiusStatusVariant, formatBytes } from './helpers'
import { FilterSelect, TabToolbar, LoadShell } from './shared'

export function RadiusTab({ state, status, onStatus, query, onQuery, canAdmin, onStop, onReload }: {
  state: LoadState<RadiusSession>
  status: 'active' | 'stopped' | 'all'
  onStatus: (s: 'active' | 'stopped' | 'all') => void
  query: string
  onQuery: (q: string) => void
  canAdmin: boolean
  onStop: (s: RadiusSession) => void
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
              onChange={(v) => onStatus(v as 'active' | 'stopped' | 'all')}
              options={[['active', 'Active'], ['stopped', 'Stopped'], ['all', 'All']]}
            />
            <input
              className="inp inp-sm"
              type="search"
              placeholder="Search by username…"
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

      {/* Tab-local KPI tiles — Zone B handles the page-level strip when the loader settles,
          but render an inline mini-strip too so admins see counts before they scroll. */}
      {state.state === 'ok' && (
        <div className="kpi-strip" style={{ marginBottom: 'var(--gx-space-8)' }}>
          <KPITile label="Active sessions" value={state.items.filter((s) => (s.status ?? '').toLowerCase() === 'active').length} size="sm" />
          <KPITile
            label="Started today"
            value={(() => {
              const today = new Date(); today.setHours(0, 0, 0, 0)
              return state.items.filter((s) => {
                if (!s.acct_start) return false
                const t = new Date(s.acct_start).getTime()
                return !isNaN(t) && t >= today.getTime()
              }).length
            })()}
            size="sm"
          />
        </div>
      )}

      <LoadShell
        state={state}
        emptyTitle="No RADIUS sessions match this filter"
        emptyMessage="No sessions are currently in this state. Try widening the filter or refresh."
        onRetry={onReload}
      >
        {(items) => (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="grid" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Session ID</th>
                    <th>NAS IP</th>
                    <th>Framed IP</th>
                    <th>Started</th>
                    <th>Status</th>
                    <th className="num">Octets In</th>
                    <th className="num">Octets Out</th>
                    <th className="actions-col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((s) => {
                    const isActive = (s.status ?? '').toLowerCase() === 'active'
                    return (
                      <tr key={s.id}>
                        <td style={{ fontWeight: 'var(--gx-weight-medium)' }}>{s.username ?? '—'}</td>
                        <td><span className="mono" style={{ fontSize: 'var(--gx-text-sm)' }}>{(s.session_id ?? s.id).slice(0, 12)}</span></td>
                        <td><span className="mono" style={{ fontSize: 'var(--gx-text-sm)' }}>{s.nas_ip ?? '—'}</span></td>
                        <td><span className="mono" style={{ fontSize: 'var(--gx-text-sm)' }}>{s.framed_ip ?? '—'}</span></td>
                        <td className="muted" style={{ fontSize: 'var(--gx-text-sm)' }}>
                          <span title={s.acct_start ?? undefined}>{timeAgo(s.acct_start ?? null) || '—'}</span>
                        </td>
                        <td>
                          <StatusPill variant={radiusStatusVariant(s.status)} label={s.status ?? '—'} size="sm" />
                        </td>
                        <td className="num"><span className="mono tnum">{formatBytes(s.octets_in)}</span></td>
                        <td className="num"><span className="mono tnum">{formatBytes(s.octets_out)}</span></td>
                        <td className="actions-col" onClick={(e) => e.stopPropagation()}>
                          <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                            {canAdmin && isActive && (
                              <Button variant="ghost" size="sm" onClick={() => onStop(s)}>Stop</Button>
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
