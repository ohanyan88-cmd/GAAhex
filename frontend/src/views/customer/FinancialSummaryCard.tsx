import { moneyDecStr as moneyDecimal } from '../../lib/money'
import type { Account, BalanceSnapshot, ConsolidatedBalance } from './types'
import { balanceTone, decimalNum, relTime } from './utils'

// Phase A.2 Financial Summary card — read-only snapshot of balance / credit limit / available
// credit / last computed. Sign convention: NEGATIVE current_balance ⇒ customer owes us (red),
// POSITIVE ⇒ credit on account (green). When the customer has multiple accounts, an account picker
// lets the operator switch; a "Consolidated subtree" toggle flips to the root-account aggregate
// (via /api/accounts/{root}/balance/consolidated). Degrades muted on 403/404 / no accounts.
export function FinancialSummaryCard({
  accounts, balances, selectedAccountId, setSelectedAccountId,
  consolidated, showConsolidated, setShowConsolidated, balanceFatal, t,
}: {
  accounts: Account[] | null | undefined
  balances: Record<string, BalanceSnapshot | null>
  selectedAccountId: string | null
  setSelectedAccountId: (id: string) => void
  consolidated: ConsolidatedBalance | null
  showConsolidated: boolean
  setShowConsolidated: (v: boolean) => void
  balanceFatal: boolean
  t: (key: string, fallback?: string) => string
}) {
  // Skeleton while accounts is loading.
  if (accounts === undefined) {
    return (
      <div className="card" style={{ padding: 'var(--gx-space-7)' }} aria-busy="true" aria-label={t('common.loading', 'Loading…')}>
        <div className="kpi-tile-skeleton" style={{ height: 'var(--gx-space-6)', width: '40%', marginBottom: 'var(--gx-space-5)' }} />
        <div className="kpi-tile-skeleton" style={{ height: 'var(--gx-space-18)', width: '60%', marginBottom: 'var(--gx-space-4)' }} />
        <div className="kpi-tile-skeleton" style={{ height: 'var(--gx-space-6)', width: '80%' }} />
      </div>
    )
  }
  // No account linked → small muted note, no card chrome.
  if (accounts === null || accounts.length === 0) {
    return <p className="muted">{t('cust.noBillingAccount', 'No billing account linked.')}</p>
  }
  // Accounts loaded but every /balance call failed (403/404) → muted unavailable state.
  if (balanceFatal && !consolidated) {
    return <p className="muted">{t('cust.balanceUnavailable', 'Financial summary unavailable.')}</p>
  }

  const selected = accounts.find((a) => a.id === selectedAccountId) ?? accounts[0]
  const snap = balances[selected.id] ?? null

  // Consolidated mode: show subtree aggregate. available_credit is derived per the A.2 spec:
  // MIN(credit_limit, MAX(0, credit_limit + current_balance)).
  let current: string | null
  let limit: string | null
  let available: string | null
  let updatedAt: string | null
  let isConsolidated = false
  if (showConsolidated && consolidated) {
    current = consolidated.consolidated_balance
    limit = consolidated.consolidated_credit_limit
    const ln = decimalNum(limit); const cn = decimalNum(current)
    available = String(Math.min(ln, Math.max(0, ln + cn)))
    updatedAt = null
    isConsolidated = true
  } else if (snap) {
    current = snap.current_balance
    limit = snap.credit_limit
    available = snap.available_credit
    updatedAt = snap.balance_updated_at
  } else {
    // Selected account's snapshot specifically unavailable (other accounts may still have data).
    return <p className="muted">{t('cust.balanceUnavailable', 'Financial summary unavailable.')}</p>
  }

  // Pct-of-limit for the available-credit subtitle. Hide when limit is 0 / missing.
  const limitN = decimalNum(limit)
  const availN = decimalNum(available)
  const pct = limitN > 0 ? Math.round((availN / limitN) * 100) : null

  const accountLabel = (a: Account) => {
    const parts = [a.type ?? null, a.currency ?? null, a.billing_cycle ?? null].filter(Boolean).join(' · ')
    return parts || a.id.slice(0, 8)
  }

  return (
    <div className="card" style={{ padding: 'var(--gx-space-7)' }}>
      {/* Toolbar: account picker (when 2+) + consolidated toggle (when subtree data exists). */}
      {(accounts.length > 1 || consolidated) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-5)', flexWrap: 'wrap', marginBottom: 'var(--gx-space-6)' }}>
          {accounts.length > 1 && !showConsolidated && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--gx-space-3)', fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-2)' }}>
              <span>{t('cust.account', 'Account')}</span>
              <select
                className="inp inp-sm"
                value={selected.id}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                aria-label={t('cust.account', 'Account')}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{accountLabel(a)}</option>
                ))}
              </select>
            </label>
          )}
          {consolidated && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--gx-space-3)', fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-2)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showConsolidated}
                onChange={(e) => setShowConsolidated(e.target.checked)}
                aria-label={t('cust.consolidated', 'Consolidated subtree')}
              />
              <span>
                {t('cust.consolidated', 'Consolidated subtree')}
                {consolidated.subtree_size > 0 && (
                  <span className="muted" style={{ marginLeft: 'var(--gx-space-2)' }}>· {consolidated.subtree_size}</span>
                )}
              </span>
            </label>
          )}
        </div>
      )}

      {/* Three-up money summary. Grid auto-wraps on narrow viewports. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--gx-space-7)' }}>
        <div>
          <div className="muted" style={{ fontSize: 'var(--gx-text-11)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 'var(--gx-space-2)' }}>
            {isConsolidated ? t('cust.consolidatedBalance', 'Consolidated balance') : t('cust.balance', 'Balance')}
          </div>
          <div className="mono tnum" style={{ fontSize: 'var(--gx-text-xl)', fontWeight: 'var(--gx-weight-semibold)', color: balanceTone(current) }}>
            {moneyDecimal(current)}
          </div>
          {(() => {
            const n = decimalNum(current)
            if (n === 0) return null
            return (
              <div className="muted" style={{ fontSize: 'var(--gx-text-11)', marginTop: 'var(--gx-space-1)' }}>
                {n < 0 ? t('cust.owes', 'Owes') : t('cust.credit', 'Credit')}
              </div>
            )
          })()}
        </div>
        <div>
          <div className="muted" style={{ fontSize: 'var(--gx-text-11)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 'var(--gx-space-2)' }}>
            {t('cust.creditLimit', 'Credit limit')}
          </div>
          <div className="mono tnum" style={{ fontSize: 'var(--gx-text-lg)', color: 'var(--gx-text-2)' }}>
            {moneyDecimal(limit)}
          </div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 'var(--gx-text-11)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 'var(--gx-space-2)' }}>
            {t('cust.availableCredit', 'Available credit')}
          </div>
          <div className="mono tnum" style={{ fontSize: 'var(--gx-text-lg)' }}>
            {moneyDecimal(available)}
          </div>
          {pct !== null && (
            <div className="muted" style={{ fontSize: 'var(--gx-text-11)', marginTop: 'var(--gx-space-1)' }}>
              {pct}% {t('cust.ofLimit', 'of limit')}
            </div>
          )}
        </div>
      </div>

      {/* Last computed footer — muted, single line. Only shown for per-account snapshots; the
          consolidated endpoint doesn't carry a single updated_at. */}
      <div className="muted" style={{ fontSize: 'var(--gx-text-11)', marginTop: 'var(--gx-space-6)' }}>
        {isConsolidated
          ? t('cust.consolidatedNote', 'Aggregated across subtree accounts.')
          : updatedAt
            ? <>{t('cust.lastComputed', 'Last computed')} · {relTime(updatedAt)}</>
            : t('cust.neverComputed', 'Never computed')}
      </div>
    </div>
  )
}
