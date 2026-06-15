// HomeView — the role-personalized workspace ("My Work" landing). Phase 2.
// EN: ONE fetch (GET /api/workspace) → gx-WorkspaceGrid renders the whole role-driven
//     composition (§11 one-layer). The personalization key is the backend-resolved workspace
//     role; the role switcher PATCHes the saved override and the grid refetches. Comms
//     (Ask · Messages · Mail · Calendar · Notifications) live in the locked header — there are
//     NO duplicate tabs here (removed Phase 2 per the zero-duplicate-nav decision).
// HY: ՄԵԿ fetch (GET /api/workspace) → gx-WorkspaceGrid-ը render է անում ամբողջ role-driven
//     composition-ը (§11)։ Personalization key-ը backend-ի resolved workspace role-ն է; role
//     switcher-ը PATCH է անում override-ը, grid-ը refetch։ Comms-ը (Ask · Messages · Mail ·
//     Calendar · Notifications) header-ում են — այստեղ ՉԿԱՆ duplicate tab-եր (հանված Phase 2)։
import { useMemo, useState } from 'react'
import { type Capabilities, can } from '../lib/capabilities'
import { PageShell } from '../page-shell'
import { useAuth } from '../context/AuthContext'
import { initialsOf } from '../lib/utils'
import { useFetch } from '../hooks/useFetch'
import { t } from '../lib/i18n'
import { BASE } from '../lib/config'
import { ALL_WORKSPACE_ROLES, type WorkspaceRole } from '../lib/workspace/registry'
import type { WorkspaceData } from '../lib/workspace/contract'
import { GxWorkspaceGrid } from '../components/WorkspaceGrid/gx-WorkspaceGrid'

type Me = { id: string; name: string; email: string }

export default function HomeView({
  onNavigate,
  capabilities,
}: {
  onNavigate?: (type: string, id?: string) => void
  capabilities?: Capabilities
}) {
  const { user: authUser, token } = useAuth()
  const caps: Capabilities = capabilities ?? {}

  // Local override drives the query param + refetch; null = the backend-resolved default.
  const [roleOverride, setRoleOverride] = useState<WorkspaceRole | null>(null)

  const { data: me } = useFetch<Me>('/auth/me')
  const wsUrl = roleOverride ? `/api/workspace?role=${roleOverride}` : '/api/workspace'
  const { data, loading, error, refetch } = useFetch<WorkspaceData>(wsUrl)

  const role: WorkspaceRole = data?.role ?? roleOverride ?? 'general'

  const roles = useMemo(
    () => ALL_WORKSPACE_ROLES.map((r) => ({ value: r, label: t(`ws.role.${r}`, r) })),
    [],
  )

  // Permission-gated handlers — pass a handler ONLY when allowed, so the widget never renders a
  // dead button (§4). Leads view-permission covers the queue, calls, deals, and stage drill-down.
  const canViewLeads = can(caps, 'lead', 'view')
  const onSelectLead = canViewLeads ? (id: string) => onNavigate?.('leads', id) : undefined
  const onSelectCall = canViewLeads ? (id: string) => onNavigate?.('leads', id) : undefined
  const onOpenDeal = canViewLeads ? (id: string) => onNavigate?.('leads', id) : undefined
  const onStageClick = canViewLeads ? () => onNavigate?.('leads') : undefined
  const onSelectAlert = (id: string) => onNavigate?.('notifications', id)
  const onAsk = () => onNavigate?.('ask')

  function handleRoleChange(next: WorkspaceRole) {
    setRoleOverride(next) // drives the query-param refetch immediately
    // Persist the saved override so the choice sticks across reloads (mirrors the backend's
    // workspace_role_override). Fire-and-forget — the local override already drives the view.
    if (token) {
      void fetch(`${BASE}/api/me/workspace-role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ override: next }),
      }).catch(() => {
        /* non-blocking: the local override keeps the view correct even if persistence fails */
      })
    }
  }

  return (
    <PageShell
      type="WORKSPACE"
      breadcrumb={[t('nav.workspace', 'Workspace')]}
      icon={
        authUser?.avatar_url ? (
          <img src={authUser.avatar_url} alt="" />
        ) : (
          <span className="ps-header-icon-initials">{initialsOf(authUser?.name ?? me?.name)}</span>
        )
      }
      title={me?.name ?? t('nav.workspace', 'Workspace')}
      subtitle={data?.label || undefined}
    >
      <GxWorkspaceGrid
        data={data}
        loading={loading}
        error={error}
        onRetry={refetch}
        onAsk={onAsk}
        onStageClick={onStageClick}
        onSelectLead={onSelectLead}
        onSelectCall={onSelectCall}
        onOpenDeal={onOpenDeal}
        onSelectAlert={onSelectAlert}
        roles={roles}
        currentRole={role}
        onRoleChange={handleRoleChange}
      />
    </PageShell>
  )
}
