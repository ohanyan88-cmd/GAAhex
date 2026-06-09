// CollectionsView — Phase B.2 Dunning UI. Two tabs: Active Cases + Policies.
//
// Wires GAAhex to the GAAhex Dunning backend:
//   GET    /api/dunning/policies?active=&page=
//   POST   /api/dunning/policies                                (admin)
//   GET    /api/dunning/policies/{id}
//   PATCH  /api/dunning/policies/{id}                           (admin)
//   DELETE /api/dunning/policies/{id}                           (admin; 409 if active cases)
//   GET    /api/dunning/cases?status=&account_id=&page=
//   GET    /api/dunning/cases/{id}
//   POST   /api/dunning/cases/{id}/advance                      (admin)
//   POST   /api/dunning/cases/{id}/close   body {closed_reason} (admin)
//   POST   /api/dunning/run                                     (admin)
//
// Real data only — no mocks. Hide-if-missing: 404 from any GET surfaces
// "Dunning endpoints not yet available". 403 surfaces PermissionDenied.
import { useEffect, useMemo, useState } from 'react'
import { bget } from '../lib/billing'
import { type Capabilities, FULL_ACCESS } from '../lib/capabilities'
import { InboxIcon } from '../components/icons'
import { PageShell } from '../page-shell'
import { DetailTab } from '../primitives'
import { useI18n } from '../lib/i18n'
import { useAuth } from '../context/AuthContext'
import { unwrapList, type DunningPolicy, type CollectionsTab } from './collections/types'
import { CasesTab } from './collections/CasesTab'
import { PoliciesTab } from './collections/PoliciesTab'

// TB-1 — local TabButton delegates to the canonical `DetailTab` primitive.
function TabButton({ active, onClick, label, sub }: { active: boolean; onClick: () => void; label: string; sub: string }) {
  return (
    <DetailTab active={active} onSelect={onClick} subtitle={sub}>
      {label}
    </DetailTab>
  )
}

export default function CollectionsView({
  canConfigure = false,
  capabilities = FULL_ACCESS,
}: {
  canConfigure?: boolean
  capabilities?: Capabilities
}) {
  const { token } = useAuth()
  const { t } = useI18n()
  const [tab, setTab] = useState<CollectionsTab>('cases')

  // Admin gate — the explicit canConfigure prop is the SuperAdmin flag (`user.can_configure`,
  // which maps to the config.manage capability the spec references). Capability map isn't
  // checked further because the `Verb` enum doesn't expose 'manage'; canConfigure is the
  // canonical write gate already wired through App.tsx.
  void capabilities  // kept on the prop surface for future per-resource gating
  const isAdmin = canConfigure

  // Shared state — policies loaded once, used by both tabs (cases tab needs policy.name lookup).
  const [policies, setPolicies] = useState<DunningPolicy[] | null>(null)
  const [policiesUnavailable, setPoliciesUnavailable] = useState(false)
  const [policiesDenied, setPoliciesDenied] = useState(false)
  const [policiesError, setPoliciesError] = useState('')

  async function loadPolicies() {
    setPoliciesError(''); setPoliciesUnavailable(false); setPoliciesDenied(false); setPolicies(null)
    const res = await bget<unknown>(token!, '/api/dunning/policies')
    if (res.status === 403) { setPoliciesDenied(true); setPolicies([]); return }
    if (res.status === 404) { setPoliciesUnavailable(true); setPolicies([]); return }
    if (!res.ok) { setPoliciesError('Failed to load policies'); setPolicies([]); return }
    setPolicies(unwrapList<DunningPolicy>(res.data).items)
  }

  useEffect(() => { loadPolicies() }, [token])

  const policyNameById = useMemo(() => {
    const map: Record<string, string> = {}
    for (const p of policies ?? []) map[p.id] = p.name
    return map
  }, [policies])

  return (
    <PageShell
      type="PIPELINE"
      breadcrumb={['Billing & Revenue', t('collections.title', 'Collections')]}
      icon={<InboxIcon size={18} />}
      title={t('collections.title', 'Collections')}
      subtitle={t('collections.sub', 'Overdue accounts under dunning · automated escalation ladder')}
    >
        {/* Tab bar — same pattern as PipelineView */}
        <div
          role="tablist"
          aria-label={t('collections.tablist.label', 'Collections views')}
          style={{
            display: 'flex',
            gap: 'var(--gx-space-2)',
            borderBottom: '1px solid var(--gx-border)',
            marginBottom: 'var(--gx-space-5)',
            marginTop: 'var(--gx-space-3)',
          }}
        >
          <TabButton
            active={tab === 'cases'}
            onClick={() => setTab('cases')}
            label={t('collections.tab.cases', 'Active Cases')}
            sub={t('collections.tab.cases.sub', 'Accounts under dunning')}
          />
          <TabButton
            active={tab === 'policies'}
            onClick={() => setTab('policies')}
            label={t('collections.tab.policies', 'Policies')}
            sub={t('collections.tab.policies.sub', 'Escalation ladders')}
          />
        </div>

        {tab === 'cases' && (
          <CasesTab
            token={token!}
            isAdmin={isAdmin}
            policyNameById={policyNameById}
            policyCount={(policies ?? []).length}
          />
        )}

        {tab === 'policies' && (
          <PoliciesTab
            token={token!}
            isAdmin={isAdmin}
            policies={policies}
            policiesUnavailable={policiesUnavailable}
            policiesDenied={policiesDenied}
            policiesError={policiesError}
            reload={loadPolicies}
          />
        )}
    </PageShell>
  )
}
