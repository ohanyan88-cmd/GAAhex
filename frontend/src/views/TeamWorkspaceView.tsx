// TeamWorkspaceView — Workspace → Team Workspace.
// Shows org nodes (departments/teams) with member counts pulled from /api/org/nodes
// and /api/users. No mock fallbacks: missing data → empty state per section.
import { useEffect, useState } from 'react'
import { PageShell } from '../page-shell'
import type { KPISpec } from '../page-shell'
import { EmptyState, ErrorBanner, SkeletonRows } from '../components/States'
import { UsersIcon, BuildingIcon } from '../components/icons'
import { BASE, authH } from '../lib/billing'


type OrgNode = { id: string; name: string; kind: string; path: string; parent_id: string | null }
type Member = { id: string; name: string; email: string; role: string; owner_node_id: string | null }

export default function TeamWorkspaceView({ token }: { token: string }) {
  const [nodes, setNodes] = useState<OrgNode[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    Promise.all([
      fetch(`${BASE}/api/org/nodes`, { headers: authH(token) }).then(r => r.ok ? r.json() : []),
      fetch(`${BASE}/api/users`, { headers: authH(token) }).then(r => r.ok ? r.json() : []),
    ])
      .then(([n, m]) => { if (alive) { setNodes(Array.isArray(n) ? n : n.nodes ?? []); setMembers(Array.isArray(m) ? m : m.users ?? []); setLoading(false) } })
      .catch(e => { if (alive) { setError(String(e)); setLoading(false) } })
    return () => { alive = false }
  }, [token])

  const membersFor = (nodeId: string) => members.filter(m => m.owner_node_id === nodeId)
  const unassigned = members.filter(m => !m.owner_node_id)

  const kpis: KPISpec[] = [
    { label: 'Teams', value: loading ? '—' : nodes.length, loading },
    { label: 'Members', value: loading ? '—' : members.length, loading },
    { label: 'Unassigned', value: loading ? '—' : unassigned.length, loading, warning: !loading && unassigned.length > 0 },
  ]

  const body = (
    <div style={{ padding: '0 var(--sp-4) var(--sp-4)' }}>
      {loading && <SkeletonRows rows={6} />}
      {error && <ErrorBanner message={error} />}
      {!loading && !error && nodes.length === 0 && members.length === 0 && (
        <EmptyState icon={<UsersIcon size={36} />} title="No teams yet" message="Org nodes and team members will appear here once your org structure is configured." />
      )}
      {!loading && nodes.map(node => {
        const nodeMembers = membersFor(node.id)
        return (
          <div key={node.id} className="card" style={{ padding: 'var(--sp-4)', marginBottom: 'var(--sp-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
              <BuildingIcon size={16} className="muted" />
              <span style={{ fontWeight: 600 }}>{node.name}</span>
              <span className="badge badge-neutral" style={{ fontSize: 'var(--gx-text-11)' }}>{node.kind}</span>
              <span className="muted" style={{ fontSize: 'var(--gx-text-sm)', marginLeft: 'auto' }}>{nodeMembers.length} member{nodeMembers.length === 1 ? '' : 's'}</span>
            </div>
            {nodeMembers.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-2)' }}>
                {nodeMembers.map(m => (
                  <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderTop: '1px solid var(--gx-border)' }}>
                    <span style={{ fontSize: 'var(--gx-text-md)' }}>{m.name || m.email}</span>
                    <span className="badge badge-neutral" style={{ fontSize: 'var(--gx-text-11)' }}>{m.role}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted" style={{ fontSize: 'var(--gx-text-13)' }}>No members assigned to this team.</p>
            )}
          </div>
        )
      })}
      {!loading && unassigned.length > 0 && (
        <div className="card" style={{ padding: 'var(--sp-4)', marginBottom: 'var(--sp-3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
            <UsersIcon size={16} className="muted" />
            <span style={{ fontWeight: 600 }}>Unassigned</span>
            <span className="muted" style={{ fontSize: 'var(--gx-text-sm)', marginLeft: 'auto' }}>{unassigned.length} member{unassigned.length === 1 ? '' : 's'}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-2)' }}>
            {unassigned.map(m => (
              <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderTop: '1px solid var(--gx-border)' }}>
                <span style={{ fontSize: 'var(--gx-text-md)' }}>{m.name || m.email}</span>
                <span className="badge badge-neutral" style={{ fontSize: 'var(--gx-text-11)' }}>{m.role}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )

  return (
    <PageShell
      type="WORKSPACE"
      breadcrumb={['Workspace', 'Team Workspace']}
      icon={<UsersIcon size={18} />}
      title="Team Workspace"
      subtitle="Department shared queues & load balancing"
      kpis={kpis}
    >
      {body}
    </PageShell>
  )
}
