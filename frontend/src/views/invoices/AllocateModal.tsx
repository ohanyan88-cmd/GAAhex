// AllocateModal — admin-gated payment allocation dialog (Phase A.3).
import { useState } from 'react'
import { bpost } from '../../lib/billing'
import { money } from '../../lib/money'
import { Button } from '../../primitives'
import { Modal } from '../../components/Modal'
import { toast } from '../../components/Toast'
import { decStrToLuma } from './types'

// DF-6 — NOT the canonical (which is `moneyDecStr`). This wrapper does a
// decimal-string → luma conversion first, then formats as luma.
function moneyDecToLumaFmt(s: string | null | undefined): string {
  return money(decStrToLuma(s))
}

function validUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim())
}

export function AllocateModal({ token, invoiceId, outstanding, onClose, onDone }: {
  token: string
  invoiceId: string
  outstanding: string
  onClose: () => void
  onDone: () => void
}) {
  // v1: user pastes a Payment UUID + types an amount in major ֏. Backend (POST /payments/{id}/allocate)
  // rejects over-allocation with 409; we surface the message inline. Autocomplete is out of scope here.
  const [paymentId, setPaymentId] = useState('')
  const [amount, setAmount] = useState(outstanding) // pre-fill with the outstanding amount
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (saving) return
    setError('')
    const id = paymentId.trim()
    if (!validUuid(id)) { setError('Enter a valid Payment UUID.'); return }
    const amt = parseFloat(amount)
    if (!isFinite(amt) || amt <= 0) { setError('Enter a positive amount.'); return }
    setSaving(true)
    try {
      await bpost(token, `/api/payments/${id}/allocate`, {
        allocations: [{ invoice_id: invoiceId, amount: amt.toFixed(2) }],
      })
      toast.success('Payment allocated')
      onDone()
    } catch (e) {
      const err = e as Error & { status?: number }
      // 409 = over-allocation / state conflict; surface the backend message verbatim.
      // 403 = admin gate; same treatment. Otherwise generic.
      setError(err.message || 'Allocation failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Allocate payment"
      subtitle={`Outstanding ${moneyDecToLumaFmt(outstanding)}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md"
            disabled={saving || !paymentId || !amount} onClick={submit}>
            {saving ? 'Allocating…' : 'Allocate'}
          </Button>
        </>
      }
    >
      <div className="rec-form" style={{ boxShadow: 'none', border: 0, padding: 0, marginBottom: 0 }}>
        <label className="field">
          <span>Payment UUID</span>
          <input
            className="inp inp-md mono"
            value={paymentId}
            onChange={(e) => setPaymentId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            autoFocus
          />
        </label>
        <label className="field">
          <span>Amount (֏)</span>
          <input
            className="inp inp-md inp-numeric"
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        {error && (
          <div style={{ marginTop: 'var(--gx-space-3)', color: 'var(--gx-danger)', fontSize: 'var(--gx-text-13)' }}>
            {error}
          </div>
        )}
        <p className="muted" style={{ fontSize: 'var(--gx-text-sm)', marginTop: 'var(--gx-space-2)' }}>
          The backend will reject over-allocation; if amounts change while this dialog is open, the
          server response will explain — just retry after refreshing.
        </p>
      </div>
    </Modal>
  )
}
