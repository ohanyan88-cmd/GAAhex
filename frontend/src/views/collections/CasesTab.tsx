// ─── Tab: Active Cases ──────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import { bget, bpost } from '../../lib/billing'
import { Button, KPITile, StatusPill } from '../../primitives'
import { EmptyState, ErrorBanner, PermissionDenied } from '../../components/States'
import { InboxIcon, SearchIcon } from '../../components/icons'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { toast } from '../../components/Toast'
import { useI18n } from '../../lib/i18n'
import { timeAgo } from '../../lib/time'
import {
  PAGE_SIZE, unwrapList, caseStatusVariant, shortId, summarizeSweep,
  type DunningCase, type DunningCaseStatus,
} from './types'

export function CasesTab({
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
                  return (
                    <tr key={c.id}>
                      <td><span className="mono" title={c.account_id}>{shortId(c.account_id)}</span></td>
                      <td><span className="mono" title={c.triggering_invoice_id}>{shortId(c.triggering_invoice_id)}</span></td>
                      <td title={c.policy_id}>{policyName}</td>
                      <td className="mono tnum">
                        {c.current_step_index + 1}
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
            disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
                <ChevronRight size={15} />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
