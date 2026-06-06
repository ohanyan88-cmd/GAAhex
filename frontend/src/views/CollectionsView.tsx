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
import { bget, bpost, bpatch, bdel } from '../lib/billing'
import { type Capabilities, FULL_ACCESS } from '../lib/capabilities'
import { toast } from '../components/Toast'
import { confirmDialog } from '../components/Modal'
import { EmptyState, ErrorBanner, PermissionDenied } from '../components/States'
import { InboxIcon, SearchIcon } from '../components/icons'
import { Plus, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react'
import { PageShell } from '../page-shell'
import { Button, DetailTab, KPITile, StatusPill } from '../primitives'
import { useI18n } from '../lib/i18n'
import { timeAgo } from '../lib/time'

// ─── Types ──────────────────────────────────────────────────────────────────
type DunningStep = { day_offset: number; action: string; params: Record<string, unknown> }

type DunningPolicy = {
  id: string
  tenant_id?: string
  name: string
  description?: string | null
  is_default: boolean
  active: boolean
  steps_json: DunningStep[]
  applies_to_tariff_plan_ids?: string[] | null
  created_at?: string | null
  updated_at?: string | null
}

type DunningCaseStatus = 'active' | 'cured' | 'escalated' | 'closed'

type DunningCase = {
  id: string
  account_id: string
  triggering_invoice_id: string
  policy_id: string
  current_step_index: number
  step_entered_at: string | null
  next_action_at: string | null
  status: DunningCaseStatus
  opened_at: string | null
  cured_at: string | null
  closed_at: string | null
  closed_reason: string | null
}

// Backend may return either a bare array or {items,total,page} envelope. Normalize.
function unwrapList<T>(payload: unknown): { items: T[]; total: number; page: number } {
  if (Array.isArray(payload)) return { items: payload as T[], total: payload.length, page: 1 }
  if (payload && typeof payload === 'object') {
    const p = payload as { items?: unknown; total?: unknown; page?: unknown }
    if (Array.isArray(p.items)) {
      return {
        items: p.items as T[],
        total: typeof p.total === 'number' ? p.total : (p.items as T[]).length,
        page: typeof p.page === 'number' ? p.page : 1,
      }
    }
  }
  return { items: [], total: 0, page: 1 }
}

// Canonical 5-step ladder used as the default seed when admin creates a new policy.
const DEFAULT_STEPS_JSON = JSON.stringify(
  [
    { day_offset: 3, action: 'notice', params: { template: 'dunning_notice_1' } },
    { day_offset: 7, action: 'notice', params: { template: 'dunning_notice_2' } },
    { day_offset: 14, action: 'throttle', params: { kbps: 256 } },
    { day_offset: 21, action: 'walled_garden', params: { redirect_url: 'https://payment.example.com' } },
    { day_offset: 45, action: 'terminate', params: {} },
  ],
  null,
  4,
)

// Validate user-edited steps_json text. Returns parsed array on success, error string on failure.
function validateStepsJson(text: string): { ok: true; steps: DunningStep[] } | { ok: false; err: string } {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch (e) { return { ok: false, err: 'Invalid JSON: ' + (e as Error).message } }
  if (!Array.isArray(parsed)) return { ok: false, err: 'Steps must be a JSON array' }
  const steps: DunningStep[] = []
  for (let i = 0; i < parsed.length; i++) {
    const s = parsed[i] as Record<string, unknown> | undefined
    if (!s || typeof s !== 'object') return { ok: false, err: `Step #${i + 1} must be an object` }
    if (!Number.isInteger(s.day_offset)) return { ok: false, err: `Step #${i + 1}: day_offset must be an integer` }
    if (typeof s.action !== 'string' || !s.action.trim()) return { ok: false, err: `Step #${i + 1}: action must be a non-empty string` }
    if (!s.params || typeof s.params !== 'object' || Array.isArray(s.params)) return { ok: false, err: `Step #${i + 1}: params must be an object` }
    steps.push({ day_offset: s.day_offset as number, action: s.action, params: s.params as Record<string, unknown> })
  }
  return { ok: true, steps }
}

// Case status → pill variant.
function caseStatusVariant(s: DunningCaseStatus): 'active' | 'degraded' | 'critical' | 'neutral' {
  switch (s) {
    case 'active': return 'critical'   // an active dunning case is bad news
    case 'escalated': return 'degraded'
    case 'cured': return 'active'
    case 'closed': return 'neutral'
    default: return 'neutral'
  }
}

const PAGE_SIZE = 25

// ─── Component ──────────────────────────────────────────────────────────────
type CollectionsTab = 'cases' | 'policies'

export default function CollectionsView({
  token,
  canConfigure = false,
  capabilities = FULL_ACCESS,
}: {
  token: string
  canConfigure?: boolean
  capabilities?: Capabilities
}) {
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
    const res = await bget<unknown>(token, '/api/dunning/policies')
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
          aria-label="Collections views"
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
            token={token}
            isAdmin={isAdmin}
            policyNameById={policyNameById}
            policyCount={(policies ?? []).length}
          />
        )}

        {tab === 'policies' && (
          <PoliciesTab
            token={token}
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

// ─── Tab: Active Cases ──────────────────────────────────────────────────────
function CasesTab({
  token,
  isAdmin,
  policyNameById,
  policyCount,
}: {
  token: string
  isAdmin: boolean
  policyNameById: Record<string, string>
  policyCount: number
}) {
  const { t } = useI18n()
  // Filter state.
  const [statusFilter, setStatusFilter] = useState<DunningCaseStatus | 'all'>('all')
  const [accountQuery, setAccountQuery] = useState('')
  const [page, setPage] = useState(1)

  // Data state — full list (no server-side status filter) so KPIs are computable client-side.
  const [cases, setCases] = useState<DunningCase[] | null>(null)
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [denied, setDenied] = useState(false)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [sweeping, setSweeping] = useState(false)

  async function loadCases() {
    setError(''); setUnavailable(false); setDenied(false); setCases(null)
    const res = await bget<unknown>(token, '/api/dunning/cases')
    if (res.status === 403) { setDenied(true); setCases([]); return }
    if (res.status === 404) { setUnavailable(true); setCases([]); return }
    if (!res.ok) { setError('Failed to load cases'); setCases([]); return }
    setCases(unwrapList<DunningCase>(res.data).items)
  }

  useEffect(() => { loadCases() }, [token])
  useEffect(() => { setPage(1) }, [statusFilter, accountQuery])

  // KPI counts — derived from the full list.
  const counts = useMemo(() => {
    const all = cases ?? []
    return {
      active: all.filter((c) => c.status === 'active').length,
      cured: all.filter((c) => c.status === 'cured').length,
      escalated: all.filter((c) => c.status === 'escalated').length,
      closed: all.filter((c) => c.status === 'closed').length,
      total: all.length,
    }
  }, [cases])

  const filtered = useMemo(() => {
    const q = accountQuery.trim().toLowerCase()
    return (cases ?? []).filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false
      if (!q) return true
      return c.account_id.toLowerCase().includes(q)
    })
  }, [cases, statusFilter, accountQuery])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  async function runSweep() {
    setSweeping(true)
    try {
      const result = await bpost<Record<string, unknown>>(token, '/api/dunning/run')
      // Best-effort summary — accept advanced/cured/closed/processed counters if backend returns them.
      const summary = summarizeSweep(result)
      toast.success(t('collections.sweep.done', 'Sweep complete') + (summary ? ' — ' + summary : ''))
      await loadCases()
    } catch (e) {
      const err = e as Error & { status?: number }
      if (err.status === 403) toast.error(t('collections.sweep.denied', 'Admin permission required to run sweep'))
      else toast.error(err.message || t('collections.sweep.failed', 'Sweep failed'))
    } finally {
      setSweeping(false)
    }
  }

  async function advanceCase(c: DunningCase) {
    setBusy((b) => ({ ...b, [c.id]: true }))
    try {
      await bpost(token, `/api/dunning/cases/${c.id}/advance`)
      toast.success(t('collections.case.advanced', 'Case advanced one step'))
      await loadCases()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[c.id]; return n })
    }
  }

  async function closeCase(c: DunningCase) {
    // Tiny browser-prompt for reason. Modal pattern would be richer but the spec asks for "tiny prompt".
    const reason = window.prompt(t('collections.case.closePrompt', 'Reason for closing this case?'), 'manual')
    if (reason === null) return
    const trimmed = reason.trim()
    if (!trimmed) { toast.warning(t('collections.case.closeNeedReason', 'A reason is required to close a case')); return }
    setBusy((b) => ({ ...b, [c.id]: true }))
    try {
      await bpost(token, `/api/dunning/cases/${c.id}/close`, { closed_reason: trimmed })
      toast.success(t('collections.case.closed', 'Case closed'))
      await loadCases()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[c.id]; return n })
    }
  }

  if (denied) return <PermissionDenied />
  if (unavailable) {
    return (
      <EmptyState
        icon={<InboxIcon size={40} />}
        title={t('collections.unavailable.title', 'Dunning endpoints not yet available')}
        message={t('collections.unavailable.msg', 'The collections API will appear here once Phase B.2 ships in this tenant.')}
      />
    )
  }

  return (
    <div>
      {/* Top action row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-3)', marginBottom: 'var(--gx-space-4)', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-3)' }}>
          {policyCount > 0 ? `${policyCount} policy${policyCount === 1 ? '' : ' set'} configured` : ''}
        </div>
        <span style={{ flex: 1 }} />
        {isAdmin && (
          <Button variant="primary" size="sm"
            onClick={runSweep}
            disabled={sweeping}
            title={t('collections.sweep.tip', 'Process all due dunning cases now')}>
            <RefreshCw size={14} />
            {sweeping ? t('collections.sweep.running', 'Running…') : t('collections.sweep.btn', 'Run Sweep')}
          </Button>
        )}
      </div>

      {/* KPI strip */}
      {cases !== null && counts.total > 0 && (
        <div className="kpi-strip">
          <KPITile
            label={t('collections.kpi.active', 'Active')}
            value={counts.active}
            size="sm"
            danger
            onClick={() => setStatusFilter('active')}
            ariaLabel={`Active dunning cases — ${counts.active}. Click to filter.`}
          />
          <KPITile
            label={t('collections.kpi.escalated', 'Escalated')}
            value={counts.escalated}
            size="sm"
            warning
            onClick={() => setStatusFilter('escalated')}
            ariaLabel={`Escalated cases — ${counts.escalated}. Click to filter.`}
          />
          <KPITile
            label={t('collections.kpi.cured', 'Cured')}
            value={counts.cured}
            size="sm"
            onClick={() => setStatusFilter('cured')}
            ariaLabel={`Cured cases — ${counts.cured}. Click to filter.`}
          />
          <KPITile
            label={t('collections.kpi.closed', 'Closed')}
            value={counts.closed}
            size="sm"
            muted
            onClick={() => setStatusFilter('closed')}
            ariaLabel={`Closed cases — ${counts.closed}. Click to filter.`}
          />
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 'var(--gx-space-5)', alignItems: 'center', margin: 'var(--gx-space-6) 0', flexWrap: 'wrap' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--gx-space-3)', fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-3)' }}>
          {t('collections.filter.status', 'Status')}
          <select
            className="inp inp-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as DunningCaseStatus | 'all')}
          >
            <option value="all">{t('collections.filter.all', 'All')}</option>
            <option value="active">{t('collections.status.active', 'Active')}</option>
            <option value="escalated">{t('collections.status.escalated', 'Escalated')}</option>
            <option value="cured">{t('collections.status.cured', 'Cured')}</option>
            <option value="closed">{t('collections.status.closed', 'Closed')}</option>
          </select>
        </label>
        <div className="tb-search" style={{ width: 280 }}>
          <SearchIcon size={14} />
          <input
            value={accountQuery}
            onChange={(e) => setAccountQuery(e.target.value)}
            placeholder={t('collections.filter.search', 'Search account ID (UUID prefix)')}
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--gx-text-1)', fontSize: 'var(--gx-text-13)' }}
          />
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={loadCases} />}
      {cases === null && !error && <p className="muted">{t('common.loading', 'Loading…')}</p>}

      {cases && cases.length === 0 && !error && (
        <EmptyState
          icon={<InboxIcon size={40} />}
          title={t('collections.empty.title', 'No accounts under dunning')}
          message={t('collections.empty.msg', 'No accounts are currently under dunning. The sweep runs nightly; manual sweep available above.')}
        />
      )}

      {cases && cases.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="grid-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th scope="col">{t('collections.col.account', 'Account')}</th>
                  <th scope="col">{t('collections.col.invoice', 'Triggering Invoice')}</th>
                  <th scope="col">{t('collections.col.policy', 'Policy')}</th>
                  <th scope="col">{t('collections.col.step', 'Step')}</th>
                  <th scope="col">{t('collections.col.status', 'Status')}</th>
                  <th scope="col">{t('collections.col.next', 'Next Action')}</th>
                  <th scope="col">{t('collections.col.opened', 'Opened')}</th>
                  <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((c) => {
                  const policyName = policyNameById[c.policy_id] ?? '—'
                  const totalSteps = policyTotalSteps(c.policy_id, policyNameById)
                  return (
                    <tr key={c.id}>
                      <td><span className="mono" title={c.account_id}>{shortId(c.account_id)}</span></td>
                      <td><span className="mono" title={c.triggering_invoice_id}>{shortId(c.triggering_invoice_id)}</span></td>
                      <td title={c.policy_id}>{policyName}</td>
                      <td className="mono tnum">
                        {c.current_step_index + 1}{totalSteps != null ? ` / ${totalSteps}` : ''}
                      </td>
                      <td><StatusPill variant={caseStatusVariant(c.status)} label={c.status} size="sm" /></td>
                      <td style={{ color: 'var(--gx-text-2)' }}>{c.next_action_at ? timeAgo(c.next_action_at) : '—'}</td>
                      <td style={{ color: 'var(--gx-text-2)' }}>{c.opened_at ? timeAgo(c.opened_at) : '—'}</td>
                      <td className="actions-col">
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          {isAdmin && c.status !== 'closed' && c.status !== 'cured' && (
                            <>
                              <Button variant="ghost" size="sm"
            onClick={() => advanceCase(c)}
                                disabled={!!busy[c.id]}
                                title={t('collections.case.advanceTip', 'Advance this case to the next step')}
                              >
                                {t('collections.case.advance', 'Advance')}
                              </Button>
                              <Button variant="ghost" size="sm"
            onClick={() => closeCase(c)}
                                disabled={!!busy[c.id]}
                              >
                                {t('collections.case.close', 'Close')}
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: 'var(--gx-space-9)', color: 'var(--gx-text-3)' }}>
                      {t('collections.empty.filtered', 'No cases match the current filters.')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="table-foot">
            <span className="hint">
              {filtered.length === 0
                ? '0 records'
                : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, filtered.length)} of ${filtered.length}`}
            </span>
            <span className="spacer" />
            <div style={{ display: 'flex', gap: 'var(--gx-space-2)' }}>
              <Button variant="ghost" size="sm" iconOnly
            disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                <ChevronLeft size={15} />
              </Button>
              {Array.from({ length: pageCount }, (_, i) => i + 1).slice(0, 5).map((p) => (
                <button key={p} className={'btn btn-sm btn-icon ' + (p === page ? 'btn-secondary' : 'btn-ghost')} onClick={() => setPage(p)}>{p}</button>
              ))}
              <Button variant="ghost" size="sm" iconOnly
            disabled={page>= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
                <ChevronRight size={15} />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  // policy step total — uses the policies prop indirectly via names map; if a policy isn't in
  // the cached map yet we hide the total. Callers pass policy_id → look up via parent's policies.
  function policyTotalSteps(_policyId: string, _names: Record<string, string>): number | null {
    // We don't have access to steps_json here without threading the full policies list through.
    // Step total is best-effort. Keep null so the cell renders just `n` rather than `n / ?`.
    return null
  }
}

// ─── Tab: Policies ──────────────────────────────────────────────────────────
type PolicyDraft = {
  id?: string
  name: string
  description: string
  is_default: boolean
  active: boolean
  steps_text: string         // raw JSON textarea content
}

const EMPTY_POLICY_DRAFT: PolicyDraft = {
  name: '',
  description: '',
  is_default: false,
  active: true,
  steps_text: DEFAULT_STEPS_JSON,
}

function PoliciesTab({
  token,
  isAdmin,
  policies,
  policiesUnavailable,
  policiesDenied,
  policiesError,
  reload,
}: {
  token: string
  isAdmin: boolean
  policies: DunningPolicy[] | null
  policiesUnavailable: boolean
  policiesDenied: boolean
  policiesError: string
  reload: () => Promise<void> | void
}) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<PolicyDraft | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [stepsError, setStepsError] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Non-admin: muted state.
  if (!isAdmin) {
    return (
      <EmptyState
        icon={<InboxIcon size={40} />}
        title={t('collections.policies.adminOnly', 'Admin only')}
        message={t('collections.policies.adminOnlyMsg', 'Dunning policies are managed by administrators. Switch to the Active Cases tab to view in-flight cases.')}
      />
    )
  }

  if (policiesDenied) return <PermissionDenied />
  if (policiesUnavailable) {
    return (
      <EmptyState
        icon={<InboxIcon size={40} />}
        title={t('collections.unavailable.title', 'Dunning endpoints not yet available')}
        message={t('collections.unavailable.msg', 'The collections API will appear here once Phase B.2 ships in this tenant.')}
      />
    )
  }
  if (policiesError) return <ErrorBanner message={policiesError} onRetry={() => void reload()} />
  if (policies === null) return <p className="muted">{t('common.loading', 'Loading…')}</p>

  function openCreate() {
    setSelectedId(null)
    setStepsError('')
    setDraft({ ...EMPTY_POLICY_DRAFT })
  }

  function openEdit(p: DunningPolicy) {
    setSelectedId(p.id)
    setStepsError('')
    setDraft({
      id: p.id,
      name: p.name,
      description: p.description ?? '',
      is_default: p.is_default,
      active: p.active,
      steps_text: JSON.stringify(p.steps_json ?? [], null, 4),
    })
  }

  function closeDraft() { setDraft(null); setSelectedId(null); setStepsError('') }

  async function save() {
    if (!draft) return
    const v = validateStepsJson(draft.steps_text)
    if (!v.ok) { setStepsError(v.err); return }
    setStepsError('')

    if (draft.id) {
      // PATCH — name is locked when editing, omit it.
      const body = {
        description: draft.description || null,
        is_default: draft.is_default,
        active: draft.active,
        steps_json: v.steps,
      }
      setSaving(true)
      try {
        await bpatch(token, `/api/dunning/policies/${draft.id}`, body)
        toast.success(t('collections.policy.saved', 'Policy updated'))
        closeDraft()
        await reload()
      } catch (e) {
        toast.error((e as Error).message)
      } finally {
        setSaving(false)
      }
    } else {
      const name = draft.name.trim()
      if (!name) { toast.warning(t('collections.policy.nameRequired', 'Policy name is required')); return }
      const body = {
        name,
        description: draft.description || null,
        is_default: draft.is_default,
        active: draft.active,
        steps_json: v.steps,
      }
      setSaving(true)
      try {
        await bpost(token, '/api/dunning/policies', body)
        toast.success(t('collections.policy.created', 'Policy created'))
        closeDraft()
        await reload()
      } catch (e) {
        toast.error((e as Error).message)
      } finally {
        setSaving(false)
      }
    }
  }

  async function removePolicy(p: DunningPolicy) {
    const ok = await confirmDialog({
      title: `Delete ${p.name}`,
      message: t('collections.policy.deleteConfirm', 'Delete this policy? Active cases referencing it will block deletion.'),
      confirmLabel: t('common.delete', 'Delete'),
      danger: true,
    })
    if (!ok) return
    setDeletingId(p.id)
    try {
      await bdel(token, `/api/dunning/policies/${p.id}`)
      toast.success(t('collections.policy.deleted', 'Policy deleted'))
      if (selectedId === p.id) closeDraft()
      await reload()
    } catch (e) {
      const err = e as Error & { status?: number }
      if (err.status === 409) {
        toast.error(err.message || t('collections.policy.deleteBlocked', 'Cannot delete: active cases reference this policy'))
      } else {
        toast.error(err.message)
      }
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-3)', marginBottom: 'var(--gx-space-6)' }}>
        <div style={{ fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-3)' }}>
          {policies.length} {policies.length === 1 ? t('collections.policy.one', 'policy') : t('collections.policy.many', 'policies')}
        </div>
        <span style={{ flex: 1 }} />
        <Button variant="primary" size="sm"
            onClick={openCreate} disabled={!!draft && !draft.id}>
          <Plus size={14} /> {t('collections.policy.new', 'New Policy')}
        </Button>
      </div>

      {policies.length === 0 && !draft && (
        <EmptyState
          icon={<InboxIcon size={40} />}
          title={t('collections.policy.empty.title', 'No policies configured')}
          message={t('collections.policy.empty.msg', 'No policies configured. Create one to start the dunning sequence.')}
          action={
            <Button variant="primary" size="md"
            onClick={openCreate}>
              <Plus size={14} /> {t('collections.policy.new', 'New Policy')}
            </Button>
          }
        />
      )}

      {/* Two-column layout: list + inline edit panel on the right when a policy is selected/new */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: draft ? 'minmax(260px, 1fr) minmax(360px, 1.4fr)' : '1fr',
          gap: 'var(--gx-space-5)',
          alignItems: 'flex-start',
        }}
      >
        {/* Card grid */}
        {policies.length > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: draft ? '1fr' : 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 'var(--gx-space-4)',
            }}
          >
            {policies.map((p) => {
              const isSelected = selectedId === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => openEdit(p)}
                  style={{
                    textAlign: 'left',
                    background: isSelected ? 'var(--gx-bg-subtle)' : 'var(--gx-surface)',
                    // D18: active selection outline = azure (interactive)
                    border: '1px solid ' + (isSelected ? 'var(--gx-interactive)' : 'var(--gx-border)'),
                    borderRadius: 10,
                    padding: 'var(--gx-space-7)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--gx-space-3)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-4)' }}>
                    <div style={{ fontSize: 'var(--gx-text-md)', fontWeight: 600, color: 'var(--gx-text-1)', flex: 1 }}>{p.name}</div>
                    {p.is_default && (
                      <span style={{
                        fontSize: 'var(--gx-text-10)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                        padding: '2px 7px', borderRadius: 999,
                        background: 'var(--gx-bg-subtle)', color: 'var(--gx-text-2)',
                        border: '1px solid var(--gx-border)',
                      }}>
                        {t('collections.policy.default', 'Default')}
                      </span>
                    )}
                  </div>
                  {p.description && (
                    <div style={{ fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-3)', lineHeight: 1.5 }}>{p.description}</div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-3)', marginTop: 'auto' }}>
                    <StatusPill variant={p.active ? 'active' : 'neutral'} label={p.active ? 'active' : 'inactive'} size="sm" />
                    <span style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)' }}>
                      {(p.steps_json?.length ?? 0)} {(p.steps_json?.length ?? 0) === 1 ? 'step' : 'steps'}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* Inline edit / create panel */}
        {draft && (
          <div
            style={{
              background: 'var(--gx-surface)',
              border: '1px solid var(--gx-border)',
              borderRadius: 'var(--gx-radius-lg)',
              padding: 'var(--gx-space-5)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--gx-space-4)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-4)' }}>
              <div style={{ fontSize: 'var(--gx-text-md)', fontWeight: 600, color: 'var(--gx-text-1)' }}>
                {draft.id ? t('collections.policy.edit', 'Edit policy') : t('collections.policy.create', 'Create policy')}
              </div>
              <span style={{ flex: 1 }} />
              <Button variant="ghost" size="sm" onClick={closeDraft}>{t('common.close', 'Close')}</Button>
            </div>

            <label className="field">
              <span>{t('collections.policy.name', 'Name')} {draft.id && <em style={{ color: 'var(--gx-text-3)', fontStyle: 'normal', fontSize: 'var(--gx-text-11)' }}>· {t('collections.policy.nameLocked', 'locked')}</em>}</span>
              <input
                className="inp inp-md"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="standard_dunning"
                disabled={!!draft.id}
              />
            </label>

            <label className="field">
              <span>{t('collections.policy.description', 'Description')}</span>
              <input
                className="inp inp-md"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder={t('collections.policy.descPlaceholder', 'Optional human-readable description')}
              />
            </label>

            <div style={{ display: 'flex', gap: 'var(--gx-space-5)', flexWrap: 'wrap' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--gx-space-3)', fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-2)' }}>
                <input
                  type="checkbox"
                  checked={draft.is_default}
                  onChange={(e) => setDraft({ ...draft, is_default: e.target.checked })}
                />
                {t('collections.policy.isDefault', 'Default policy')}
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--gx-space-3)', fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-2)' }}>
                <input
                  type="checkbox"
                  checked={draft.active}
                  onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                />
                {t('collections.policy.activeFlag', 'Active')}
              </label>
            </div>

            <label className="field">
              <span>{t('collections.policy.steps', 'Steps (JSON)')}</span>
              <textarea
                className="inp"
                value={draft.steps_text}
                onChange={(e) => setDraft({ ...draft, steps_text: e.target.value })}
                rows={14}
                spellCheck={false}
                style={{
                  fontFamily: 'ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace',
                  fontSize: 'var(--gx-text-sm)',
                  lineHeight: 1.5,
                  padding: 'var(--gx-space-5)',
                  resize: 'vertical',
                }}
              />
              {stepsError && (
                <div style={{ fontSize: 'var(--gx-text-sm)', color: 'var(--gx-danger)', marginTop: 'var(--gx-space-2)' }}>
                  {stepsError}
                </div>
              )}
              <div style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)', marginTop: 'var(--gx-space-2)' }}>
                {t('collections.policy.stepsHint', 'Each step: integer day_offset, string action, object params.')}
              </div>
            </label>

            <div style={{ display: 'flex', gap: 'var(--gx-space-3)', justifyContent: 'flex-end', alignItems: 'center' }}>
              {draft.id && (
                <Button variant="danger" size="md"
            onClick={() => {
                    const p = policies.find((x) => x.id === draft.id)
                    if (p) void removePolicy(p)
                  }}
                  disabled={saving || deletingId === draft.id}
                  style={{ marginRight: 'auto' }}
                >
                  {deletingId === draft.id ? t('common.deleting', 'Deleting…') : t('common.delete', 'Delete')}
                </Button>
              )}
              <Button variant="ghost" size="md"
            onClick={closeDraft} disabled={saving}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button variant="primary" size="md"
            onClick={save}
                disabled={saving || (!draft.id && !draft.name.trim())}>
                {saving ? t('common.saving', 'Saving…') : draft.id ? t('common.save', 'Save') : t('common.create', 'Create')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// TB-1 — local TabButton delegates to the canonical `DetailTab` primitive.
function TabButton({ active, onClick, label, sub }: { active: boolean; onClick: () => void; label: string; sub: string }) {
  return (
    <DetailTab active={active} onSelect={onClick} subtitle={sub}>
      {label}
    </DetailTab>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function shortId(id: string | null | undefined): string {
  if (!id) return '—'
  return id.slice(0, 8)
}

// Best-effort sweep-result summary. The backend's `/api/dunning/run` response shape isn't strictly
// pinned at the UI layer — accept common counter keys (advanced/cured/closed/processed) if present.
function summarizeSweep(result: unknown): string {
  if (!result || typeof result !== 'object') return ''
  const r = result as Record<string, unknown>
  const parts: string[] = []
  const tryCount = (key: string, label: string) => {
    const v = r[key]
    if (typeof v === 'number') parts.push(`${v} ${label}`)
  }
  tryCount('processed', 'processed')
  tryCount('advanced', 'advanced')
  tryCount('cured', 'cured')
  tryCount('closed', 'closed')
  tryCount('escalated', 'escalated')
  return parts.join(' · ')
}
