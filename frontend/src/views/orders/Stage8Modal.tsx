// Stage8Modal — Stage 8 control-gate panel + CollectDepositModal.
// Extracted from OrdersView.tsx; no logic changes.
import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { bpost } from '../../lib/billing'
import { toast } from '../../components/Toast'
import { Modal } from '../../components/Modal'
import { ErrorBanner } from '../../components/States'
import { humanizeStatus } from '../../lib/humanize'
import { ArrowRightIcon } from '../../components/icons'
import { Button, StatusPill } from '../../primitives'
import {
  type OrderRow, type Stage8Status, type Stage8CheckKey, type Stage8CheckStatus,
  stage8CheckVariant, toAmd,
} from './types'

// ── Stage 8 modal ─────────────────────────────────────────────────────────────
// Renders the Stage 8 Control Gate panel for one order:
//   * 4 check rows (Credit Check / Deposit / Payment Method / Approvals)
//   * blockers list
//   * Re-run check, Apply verdict, Release to Provisioning, Collect deposit
// On mount fetches POST /api/orders/{id}/stage8-check. Re-run reuses the same
// route. Apply / Release / Collect-deposit hit their own routes and refetch.
export function Stage8Modal({
  order, orderId, canEdit, onClose, onChanged,
}: {
  order: OrderRow | null            // snapshot from the list (for deposit_required/status); null if list missed
  orderId: string
  canEdit: boolean
  onClose: () => void
  onChanged: () => void             // tell parent to refetch /api/orders
}) {
  const { token } = useAuth()
  const [check, setCheck] = useState<Stage8Status | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [denied, setDenied] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [depositOpen, setDepositOpen] = useState(false)

  async function runCheck() {
    setError(''); setDenied(false); setUnavailable(false); setLoading(true)
    try {
      // /stage8-check is a POST predicate (read-only) — call via bpost so the
      // helper raises on non-2xx, then catch + classify here.
      const data = await bpost<Stage8Status>(token!, `/api/orders/${orderId}/stage8-check`)
      setCheck(data)
    } catch (e) {
      const err = e as Error & { status?: number }
      if (err.status === 403) { setDenied(true) }
      else if (err.status === 404) { setUnavailable(true) }
      else { setError(err.message || 'Failed to run Stage 8 check') }
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { runCheck() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orderId])

  async function doApply() {
    if (busy) return
    setBusy(true)
    try {
      const updated = await bpost<{ stage8?: Stage8Status }>(token!, `/api/orders/${orderId}/stage8-apply`)
      toast.success('Stage 8 verdict applied')
      if (updated?.stage8) setCheck(updated.stage8)
      onChanged()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function doRelease() {
    if (busy) return
    setBusy(true)
    try {
      // The release move (order_validated → scheduling) goes through the unified transition route; the
      // control_gate:stage8 named guard fires inside it and returns the same 409 + block reason if unmet.
      await bpost(token!, `/api/orders/${orderId}/transition`, { to: 'scheduling' })
      toast.success(`Order released to provisioning`)
      onChanged()
      onClose()
    } catch (e) {
      // 409 → backend includes the block reason in detail; surface verbatim.
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Deposit gating uses the snapshot order; if the snapshot is missing or the
  // backend hasn't extended /api/orders to include the deposit fields yet, we
  // show the button conservatively (only when we can prove a shortfall).
  const depositReq = toAmd(order?.deposit_required)
  const depositColl = toAmd(order?.deposit_collected)
  const depositShortfall = depositReq > 0 && depositColl < depositReq

  // Release button: only meaningful when the live check says pass AND the order
  // is currently SUBMITTED. Apply must run first if control_pass is still stale.
  const canRelease = !!check?.pass && order?.status === 'order_validated'

  // 4 fixed check rows — render in a stable order regardless of what the
  // backend returns (missing key → render as Pending so the user sees the slot).
  const checkRows: { key: Stage8CheckKey; label: string }[] = [
    { key: 'credit_check',       label: 'Credit check' },
    { key: 'deposit',            label: 'Deposit' },
    { key: 'payment_method',     label: 'Payment method' },
    { key: 'mandatory_approvals', label: 'Mandatory approvals' },
  ]

  return (
    <Modal
      open
      onClose={onClose}
      title={order ? `Stage 8 — Order ${order.number}` : 'Stage 8 control gate'}
      subtitle={order ? humanizeStatus(order.status) : undefined}
      size="md"
      footer={
        <>
          <Button variant="ghost" size="sm"
            disabled={loading || busy} onClick={runCheck}>
            Re-run check
          </Button>
          {canEdit && (
            <Button variant="secondary" size="sm"
            disabled={loading || busy || denied || unavailable} onClick={doApply}>
              Apply verdict
            </Button>
          )}
          {canEdit && depositShortfall && (
            <Button variant="secondary" size="sm"
            disabled={busy} onClick={() => setDepositOpen(true)}>
              Collect deposit
            </Button>
          )}
          {canEdit && canRelease && (
            <Button variant="primary" size="sm"
            disabled={busy} onClick={doRelease}>
              <ArrowRightIcon size={13} /> Release to Provisioning
            </Button>
          )}
        </>
      }
    >
      {denied && (
        <p className="muted" style={{ margin: 0 }}>
          Permission denied — Stage 8 checks require admin.
        </p>
      )}
      {unavailable && (
        <p className="muted" style={{ margin: 0 }}>
          Stage 8 endpoint not yet available.
        </p>
      )}
      {error && !denied && !unavailable && (
        <ErrorBanner message={error} onRetry={runCheck} />
      )}
      {!denied && !unavailable && !error && (
        <>
          {/* Overall verdict band */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 'var(--gx-space-5)', padding: 'var(--gx-space-5) var(--gx-space-6)',
            borderRadius: 'var(--gx-radius-md)', border: '1px solid var(--gx-border-subtle)',
            background: 'var(--gx-surface-2)', marginBottom: 'var(--gx-space-4)',
          }}>
            <span style={{ fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-3)' }}>Verdict</span>
            {loading
              ? <span className="muted" style={{ fontSize: 'var(--gx-text-sm)' }}>Running…</span>
              : check
                ? <StatusPill
                    variant={check.pass ? 'active' : 'critical'}
                    label={check.pass ? 'Pass' : 'Fail'}
                    size="sm"
                  />
                : <span className="muted" style={{ fontSize: 'var(--gx-text-sm)' }}>—</span>}
          </div>

          {/* 4 check rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-4)' }}>
            {checkRows.map((row) => {
              const v: Stage8CheckStatus = (check?.checks?.[row.key] ?? 'PENDING') as Stage8CheckStatus
              return (
                <div key={row.key} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: 'var(--gx-space-4) var(--gx-space-6)', border: '1px solid var(--gx-border-subtle)', borderRadius: 'var(--gx-radius-sm)',
                }}>
                  <span style={{ fontSize: 'var(--gx-text-13)', color: 'var(--gx-text-1)' }}>{row.label}</span>
                  {loading && !check
                    ? <span className="muted" style={{ fontSize: 'var(--gx-text-sm)' }}>…</span>
                    : <StatusPill variant={stage8CheckVariant(v)} label={humanizeStatus(v)} size="sm" />}
                </div>
              )
            })}
          </div>

          {/* Blockers */}
          {check && check.blockers && check.blockers.length > 0 && (
            <div style={{ marginTop: 'var(--gx-space-7)' }}>
              <div style={{ fontSize: 'var(--gx-text-11)', textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--gx-text-3)', marginBottom: 'var(--gx-space-3)' }}>
                Blockers
              </div>
              <ul style={{ margin: 0, paddingLeft: 'var(--gx-space-18)', fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-2)', lineHeight: 1.6 }}>
                {check.blockers.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            </div>
          )}

          {/* Deposit snapshot (only when the row has deposit data) */}
          {order && depositReq > 0 && (
            <div style={{
              marginTop: 'var(--gx-space-7)', padding: 'var(--gx-space-5) var(--gx-space-6)', borderRadius: 'var(--gx-radius-md)',
              border: '1px solid var(--gx-border-subtle)', background: 'var(--gx-surface-2)',
            }}>
              <div style={{ fontSize: 'var(--gx-text-11)', textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--gx-text-3)', marginBottom: 'var(--gx-space-3)' }}>
                Deposit
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--gx-text-13)' }}>
                <span>Collected</span>
                <span className="mono tnum">{depositColl.toLocaleString()} ֏</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--gx-text-13)' }}>
                <span>Required</span>
                <span className="mono tnum">{depositReq.toLocaleString()} ֏</span>
              </div>
              {depositShortfall && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--gx-text-sm)', color: 'var(--gx-warning-fg)', marginTop: 'var(--gx-space-2)' }}>
                  <span>Shortfall</span>
                  <span className="mono tnum">{(depositReq - depositColl).toLocaleString()} ֏</span>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Collect-deposit nested modal */}
      {depositOpen && (
        <CollectDepositModal
          orderId={orderId}
          suggested={depositShortfall ? (depositReq - depositColl) : 0}
          onClose={() => setDepositOpen(false)}
          onDone={() => { setDepositOpen(false); onChanged(); runCheck() }}
        />
      )}
    </Modal>
  )
}

// ── Collect-deposit nested modal ─────────────────────────────────────────────
function CollectDepositModal({
  orderId, suggested, onClose, onDone,
}: {
  orderId: string
  suggested: number                  // AMD shortfall to pre-fill
  onClose: () => void
  onDone: () => void
}) {
  const { token } = useAuth()
  const [amount, setAmount] = useState<string>(suggested > 0 ? String(suggested) : '')
  const [paymentMethodId, setPaymentMethodId] = useState<string>('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    const amt = parseFloat(amount)
    if (!isFinite(amt) || amt <= 0 || busy) return
    setBusy(true)
    try {
      const body: { amount: number; payment_method_id?: string } = { amount: amt }
      const pm = paymentMethodId.trim()
      if (pm) body.payment_method_id = pm
      await bpost(token!, `/api/orders/${orderId}/collect-deposit`, body)
      toast.success(`Deposit collected: ${amt.toLocaleString()} ֏`)
      onDone()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Collect deposit"
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" size="md"
            disabled={busy || !isFinite(parseFloat(amount)) || parseFloat(amount) <= 0}
            onClick={submit}>
            {busy ? 'Collecting…' : 'Collect'}
          </Button>
        </>
      }
    >
      <div className="rec-form" style={{ boxShadow: 'none', border: 0, padding: 0, marginBottom: 0 }}>
        <label className="field">
          <span>Amount (֏) <span style={{ color: 'var(--gx-danger-fg)' }}>*</span></span>
          <input
            className="inp inp-md inp-numeric"
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
        </label>
        <label className="field">
          <span>Payment method ID <span className="muted" style={{ fontSize: 'var(--gx-text-11)' }}>(optional)</span></span>
          <input
            className="inp inp-md"
            value={paymentMethodId}
            onChange={(e) => setPaymentMethodId(e.target.value)}
            placeholder="UUID — leave blank for cash/transfer"
          />
        </label>
        <p className="hint" style={{ fontSize: 'var(--gx-text-11)', margin: 0 }}>
          When a payment method ID is provided the backend simulates a card charge.
          Otherwise the deposit is recorded without gateway activity.
        </p>
      </div>
    </Modal>
  )
}
