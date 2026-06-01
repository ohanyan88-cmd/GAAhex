// PaymentMethodsView — Phase B.1 vaulted-card admin surface. Lists PaymentMethod records vaulted
// against customers, lets admins vault new cards (raw PAN+CVC posted but never persisted; backend
// returns an opaque gateway_token plus brand/last4), promote a card to default, and soft-remove.
//
// Doctrine notes:
//  - Reads on this view are admin-gated by the backend (B.1 v1). Non-admin tenants can still see
//    the list IF capabilities grant `payment.view`, but they get no action buttons + no "+ Vault".
//  - Real data only — no kit fallbacks. Empty list = friendly empty-state with admin CTA.
//  - 404 ⇒ "endpoint not available yet" (so the view degrades gracefully if B.1 is rolled back).
//  - 403 ⇒ <PermissionDenied/>.
//  - Mutation errors (4xx) inside the vault modal surface the backend `detail` and DON'T close.
import { useEffect, useMemo, useState } from 'react'
import { bget, bpost, bpatch, loadCustomers } from '../lib/billing'
import { toast } from '../components/Toast'
import { Modal, confirmDialog } from '../components/Modal'
import { EmptyState, PermissionDenied, ErrorBanner } from '../components/States'
import { CreditCardIcon, PlusIcon, StarIcon } from '../components/icons'
import { StatusPill } from '../primitives'
import { PageShell, type KPISpec } from '../page-shell'
import { can, type Capabilities } from '../lib/capabilities'
import { timeAgo } from '../lib/time'
import RowActionsMenu from '../components/RowActionsMenu'

// PaymentMethod public shape (B.1 router serializer). Raw card_number / cvc / cardholder_name
// are never persisted nor echoed — they live only inside the create form's local state.
type PaymentMethod = {
  id: string
  tenant_id: string
  customer_id: string
  account_id: string | null
  gateway: string
  gateway_token: string
  last4: string
  brand: string                   // 'visa' | 'mastercard' | 'amex' | 'discover' | 'other'
  exp_month: number
  exp_year: number
  is_default: boolean
  status: 'active' | 'expired' | 'removed' | string
  created_at: string | null
  last_used_at: string | null
}

type StatusFilter = 'all' | 'active' | 'removed' | 'expired'

type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'
function statusVariant(s: string): PillVariant {
  switch (s) {
    case 'active': return 'active'
    case 'expired': return 'degraded'
    case 'removed': return 'neutral'
    default: return 'info'
  }
}

// Brand badge — small inline pill. Real brand comes from the backend (derived from PAN BIN). We
// label-case the brand and color-code visa/mc/amex/discover; everything else is neutral.
function brandLabel(b: string): string {
  const k = (b || '').toLowerCase()
  if (k === 'visa') return 'VISA'
  if (k === 'mastercard') return 'MC'
  if (k === 'amex') return 'AMEX'
  if (k === 'discover') return 'DISC'
  return (b || 'CARD').toUpperCase()
}
function brandTone(b: string): { bg: string; fg: string } {
  const k = (b || '').toLowerCase()
  if (k === 'visa') return { bg: 'rgba(31,90,209,0.14)', fg: 'var(--gx-primary, #1f5ad1)' }
  if (k === 'mastercard') return { bg: 'rgba(214,51,108,0.14)', fg: '#d6336c' }
  if (k === 'amex') return { bg: 'rgba(47,158,68,0.14)', fg: '#2f9e44' }
  if (k === 'discover') return { bg: 'rgba(214,140,51,0.14)', fg: '#d68c33' }
  return { bg: 'var(--gx-surface-2)', fg: 'var(--gx-text-3)' }
}

function pad2(n: number): string { return String(n).padStart(2, '0') }
function fmtExpiry(m: number, y: number): string {
  const yy = y >= 100 ? String(y).slice(-2) : pad2(y)
  return `${pad2(m)}/${yy}`
}

export default function PaymentMethodsView({
  token,
  canConfigure = false,
  capabilities,
}: {
  token: string
  canConfigure?: boolean
  capabilities: Capabilities
}) {
  const [list, setList] = useState<PaymentMethod[] | null>(null)
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [denied, setDenied] = useState(false)
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({})
  const [showNew, setShowNew] = useState(false)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  // Permission gates. Reads = capabilities.payment.view OR canConfigure (admin). Writes = admin only.
  const canView = can(capabilities, 'payment', 'view') || canConfigure
  const canWrite = canConfigure

  async function load() {
    setError(''); setUnavailable(false); setDenied(false); setList(null)
    const res = await bget<PaymentMethod[]>(token, '/api/payment-methods')
    if (res.status === 404) { setUnavailable(true); setList([]); return }
    if (res.status === 403) { setDenied(true); setList([]); return }
    if (!res.ok) {
      setError('Failed to load payment methods')
      setList([])
      return
    }
    setList(Array.isArray(res.data) ? res.data : [])
  }

  useEffect(() => {
    if (!canView) return
    load()
    loadCustomers(token).then(setCustomerNames).catch(() => setCustomerNames({}))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, canView])

  async function setDefault(pm: PaymentMethod) {
    try {
      await bpatch(token, `/api/payment-methods/${pm.id}`, { is_default: true })
      toast.success(`Default card set · •••• ${pm.last4}`)
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  async function remove(pm: PaymentMethod) {
    const ok = await confirmDialog({
      title: `Remove card •••• ${pm.last4}`,
      message: 'Soft-remove this vaulted card? The customer will need to re-vault to charge it again.',
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!ok) return
    try {
      await bpatch(token, `/api/payment-methods/${pm.id}`, { status: 'removed' })
      toast.success('Card removed')
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // ── Gates that exit before render of the registry body ─────────────────────────────────────
  if (!canView) {
    return <PermissionDenied message="You don't have permission to view payment methods." />
  }
  if (denied) {
    return <PermissionDenied message="You don't have permission to view payment methods." />
  }

  const all = list ?? []
  const total = all.length
  const activeCount = all.filter((p) => p.status === 'active').length
  const removedCount = all.filter((p) => p.status === 'removed').length
  const expiredCount = all.filter((p) => p.status === 'expired').length

  const kpis: KPISpec[] = total > 0 ? [
    { label: 'Total', value: total, subtitle: 'vaulted' },
    { label: 'Active', value: activeCount, subtitle: 'chargeable', premium: activeCount > 0 },
    { label: 'Removed', value: removedCount, subtitle: 'soft-deleted', muted: removedCount > 0 },
    { label: 'Expired', value: expiredCount, subtitle: 'past exp date', warning: expiredCount > 0 },
  ] : []

  // Client-side search + status filter.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false
      if (!q) return true
      const name = customerNames[p.customer_id] ?? ''
      const fields = [
        p.customer_id,
        name,
        p.last4,
        p.brand,
      ].join(' ').toLowerCase()
      return fields.includes(q)
    })
  }, [all, query, statusFilter, customerNames])

  function customerLabel(p: PaymentMethod): string {
    return customerNames[p.customer_id] ?? p.customer_id.slice(0, 8)
  }

  return (
    <PageShell
      type="registry"
      breadcrumb={['Billing & Revenue', 'Payment Methods']}
      icon={<CreditCardIcon size={18} />}
      title="Payment Methods"
      subtitle="Tokenized card vault for customer billing"
      kpis={kpis}
      primaryAction={canWrite && !unavailable ? {
        label: '+ Vault new card',
        icon: <PlusIcon size={14} />,
        onClick: () => setShowNew(true),
      } : undefined}
      filters={{
        search: {
          value: query,
          onChange: setQuery,
          placeholder: 'Search by customer or last4…',
        },
        quick: [{
          label: 'Status',
          value: statusFilter,
          options: [
            { label: 'All', value: 'all' },
            { label: 'Active', value: 'active' },
            { label: 'Removed', value: 'removed' },
            { label: 'Expired', value: 'expired' },
          ],
          onChange: (v) => setStatusFilter(v as StatusFilter),
        }],
      }}
    >
      {error && <ErrorBanner message={error} onRetry={load} />}
      {list === null && !error && <p className="muted">Loading…</p>}

      {unavailable && (
        <EmptyState
          icon={<CreditCardIcon size={40} />}
          title="Payment methods endpoint not yet available"
          message="The vaulted-card service will appear here once enabled."
        />
      )}

      {list !== null && !unavailable && list.length === 0 && !error && (
        <EmptyState
          icon={<CreditCardIcon size={40} />}
          title="No payment methods vaulted yet"
          message="Vault a customer's card to start billing it via the gateway."
          action={canWrite ? (
            <button className="btn btn-primary btn-md" onClick={() => setShowNew(true)}>
              <PlusIcon size={14} /> Vault first card
            </button>
          ) : undefined}
        />
      )}

      {list !== null && list.length > 0 && (
        <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
          <div className="grid-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th scope="col">Card</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Default</th>
                  <th scope="col">Expires</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last used</th>
                  {canWrite && <th scope="col" style={{ width: 40 }}></th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const tone = brandTone(p.brand)
                  return (
                    <tr key={p.id}>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <span
                            className="mono"
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              padding: '2px 6px',
                              borderRadius: 4,
                              background: tone.bg,
                              color: tone.fg,
                              letterSpacing: 0.5,
                            }}
                          >
                            {brandLabel(p.brand)}
                          </span>
                          <span className="mono" style={{ color: 'var(--gx-text-1)' }}>
                            •••• {p.last4}
                          </span>
                        </span>
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 1 }}>
                          <span>{customerLabel(p)}</span>
                          <span className="mono" style={{ fontSize: 10, color: 'var(--gx-text-3)' }}>
                            {p.customer_id.slice(0, 8)}
                          </span>
                        </span>
                      </td>
                      <td>
                        {p.is_default
                          ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--gx-warning, #d68c33)' }} title="Default card for this customer">
                              <StarIcon size={14} />
                              <span style={{ fontSize: 11 }}>Default</span>
                            </span>
                          )
                          : <span style={{ color: 'var(--gx-text-3)' }}>—</span>}
                      </td>
                      <td><span className="mono tnum">{fmtExpiry(p.exp_month, p.exp_year)}</span></td>
                      <td><StatusPill variant={statusVariant(p.status)} label={p.status} size="sm" /></td>
                      <td>
                        <span style={{ color: 'var(--gx-text-3)' }}>
                          {p.last_used_at ? timeAgo(p.last_used_at) : 'Never'}
                        </span>
                      </td>
                      {canWrite && (
                        <td onClick={(e) => e.stopPropagation()}>
                          <RowActionsMenu
                            actions={[
                              {
                                key: 'set-default',
                                label: 'Set default',
                                icon: <StarIcon size={13} />,
                                onClick: () => setDefault(p),
                                hidden: p.is_default || p.status !== 'active',
                              },
                              {
                                key: 'remove',
                                label: 'Remove',
                                danger: true,
                                onClick: () => remove(p),
                                hidden: p.status === 'removed',
                              },
                            ]}
                          />
                        </td>
                      )}
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={canWrite ? 7 : 6}
                      style={{ textAlign: 'center', padding: 40, color: 'var(--gx-text-3)' }}
                    >
                      No matching payment methods.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showNew && canWrite && (
        <VaultModal
          token={token}
          onClose={() => setShowNew(false)}
          onCreated={async (last4) => {
            setShowNew(false)
            toast.success(`Card vaulted · last4 ${last4}`)
            await load()
          }}
        />
      )}
    </PageShell>
  )
}

// ── Vault-new-card modal ────────────────────────────────────────────────────────────────────
// Raw PAN + CVC + cardholder_name are LOCAL state only; once the POST succeeds (or fails) we
// drop them by closing the modal. The backend never echoes them back. On 4xx, we surface the
// backend `detail` message inside the modal and keep it open.
function VaultModal({
  token,
  onClose,
  onCreated,
}: {
  token: string
  onClose: () => void
  onCreated: (last4: string) => Promise<void> | void
}) {
  const [customerId, setCustomerId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [cardNumber, setCardNumber] = useState('')
  const [expMonth, setExpMonth] = useState<number>(1)
  const [expYear, setExpYear] = useState('')
  const [cvc, setCvc] = useState('')
  const [cardholderName, setCardholderName] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')

  const valid =
    customerId.trim().length > 0 &&
    cardNumber.trim().length >= 4 &&
    expMonth >= 1 && expMonth <= 12 &&
    /^\d{4}$/.test(expYear.trim()) &&
    cvc.trim().length >= 3

  async function submit() {
    if (!valid || busy) return
    setBusy(true); setFormError('')
    try {
      const body: Record<string, unknown> = {
        customer_id: customerId.trim(),
        card_number: cardNumber.trim(),
        exp_month: expMonth,
        exp_year: Number(expYear.trim()),
        cvc: cvc.trim(),
        is_default: isDefault,
      }
      if (accountId.trim()) body.account_id = accountId.trim()
      if (cardholderName.trim()) body.cardholder_name = cardholderName.trim()
      const created = await bpost<{ last4: string }>(token, '/api/payment-methods', body)
      await onCreated(created.last4 ?? cardNumber.trim().slice(-4))
    } catch (e) {
      setFormError((e as Error).message || 'Failed to vault card')
    } finally {
      setBusy(false)
    }
  }

  const months = Array.from({ length: 12 }, (_, i) => i + 1)

  return (
    <Modal
      open
      onClose={onClose}
      title="Vault new card"
      subtitle="Raw card data is sent to the gateway, not stored locally"
      size="md"
      footer={
        <>
          <button className="btn btn-ghost btn-md" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className="btn btn-primary btn-md"
            onClick={submit}
            disabled={!valid || busy}
          >
            {busy ? 'Vaulting…' : 'Vault card'}
          </button>
        </>
      }
    >
      <div className="rec-form" style={{ boxShadow: 'none', border: 0, padding: 0, marginBottom: 0 }}>
        <label className="field">
          <span>Customer ID <span style={{ color: 'var(--gx-danger-fg)' }}>*</span></span>
          <input
            className="inp inp-md mono"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            placeholder="Paste UUID from CRM"
            autoFocus
          />
        </label>
        <label className="field">
          <span>Account ID (optional)</span>
          <input
            className="inp inp-md mono"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder="Optional billing account UUID"
          />
        </label>
        <label className="field">
          <span>Card number <span style={{ color: 'var(--gx-danger-fg)' }}>*</span></span>
          <input
            className="inp inp-md mono"
            value={cardNumber}
            onChange={(e) => setCardNumber(e.target.value.replace(/\s+/g, ''))}
            placeholder="•••• •••• •••• ••••"
            inputMode="numeric"
            autoComplete="off"
          />
          <span className="hint" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
            Raw card data not stored; opaque vault token returned.
          </span>
        </label>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label className="field" style={{ flex: 1, minWidth: 100 }}>
            <span>Exp month <span style={{ color: 'var(--gx-danger-fg)' }}>*</span></span>
            <select
              className="inp inp-md"
              value={expMonth}
              onChange={(e) => setExpMonth(Number(e.target.value))}
            >
              {months.map((m) => <option key={m} value={m}>{pad2(m)}</option>)}
            </select>
          </label>
          <label className="field" style={{ flex: 1, minWidth: 100 }}>
            <span>Exp year <span style={{ color: 'var(--gx-danger-fg)' }}>*</span></span>
            <input
              className="inp inp-md mono"
              value={expYear}
              onChange={(e) => setExpYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="YYYY"
              inputMode="numeric"
              maxLength={4}
            />
          </label>
          <label className="field" style={{ flex: 1, minWidth: 100 }}>
            <span>CVC <span style={{ color: 'var(--gx-danger-fg)' }}>*</span></span>
            <input
              className="inp inp-md mono"
              value={cvc}
              onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="•••"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
            />
          </label>
        </div>
        <label className="field">
          <span>Cardholder name (optional)</span>
          <input
            className="inp inp-md"
            value={cardholderName}
            onChange={(e) => setCardholderName(e.target.value)}
            placeholder="As printed on the card"
            autoComplete="off"
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--gx-text-2)' }}>
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          Set as default card for this customer
        </label>
        {formError && (
          <p
            className="err"
            role="alert"
            style={{ margin: 0, color: 'var(--gx-danger-fg)', fontSize: 12.5, lineHeight: 1.4 }}
          >
            {formError}
          </p>
        )}
      </div>
    </Modal>
  )
}
