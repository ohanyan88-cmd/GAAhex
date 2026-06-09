// CreateOrderModal — draft a new order with a single line item.
// Extracted from OrdersView.tsx; no logic changes.
import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { bpost } from '../../lib/billing'
import { toast } from '../../components/Toast'
import { Modal } from '../../components/Modal'
import { Button } from '../../primitives'

export function CreateOrderModal({
  customerOptions, onClose, onDone,
}: {
  customerOptions: { id: string; label: string }[]
  onClose: () => void
  onDone: () => void
}) {
  const { token } = useAuth()
  const [customerId, setCustomerId] = useState('')
  const [description, setDescription] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unitAmount, setUnitAmount] = useState('')   // major ֏
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!customerId || !description.trim() || busy) return
    setBusy(true)
    try {
      const qty = Math.max(1, parseInt(quantity, 10) || 1)
      const unitMinor = Math.round((parseFloat(unitAmount) || 0) * 100)
      await bpost(token!, '/api/orders', {
        customer_id: customerId,
        items: [{
          description: description.trim(),
          quantity: qty,
          unit_amount: unitMinor,
        }],
      })
      toast.success('Order drafted')
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
      title="New order"
      size="md"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md"
            disabled={busy || !customerId || !description.trim()}
            onClick={submit}>
            {busy ? 'Creating…' : 'Create draft'}
          </Button>
        </>
      }
    >
      <div className="rec-form" style={{ boxShadow: 'none', border: 0, padding: 0, marginBottom: 0 }}>
        <label className="field">
          <span>Customer <span style={{ color: 'var(--gx-danger-fg)' }}>*</span></span>
          <select className="inp inp-md" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">— select —</option>
            {customerOptions.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Line description <span style={{ color: 'var(--gx-danger-fg)' }}>*</span></span>
          <input
            className="inp inp-md"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Fiber 100 Mbps install"
            autoFocus
          />
        </label>
        <div style={{ display: 'flex', gap: 'var(--gx-space-4)', flexWrap: 'wrap' }}>
          <label className="field" style={{ flex: 1, minWidth: 100 }}>
            <span>Quantity</span>
            <input
              className="inp inp-md inp-numeric"
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
          <label className="field" style={{ flex: 1, minWidth: 140 }}>
            <span>Unit amount (֏)</span>
            <input
              className="inp inp-md inp-numeric"
              type="number"
              min={0}
              step="0.01"
              value={unitAmount}
              onChange={(e) => setUnitAmount(e.target.value)}
            />
          </label>
        </div>
        <p className="hint" style={{ fontSize: 'var(--gx-text-11)', margin: 0 }}>
          The order is created as a DRAFT. Use Submit, then Advance to provision it.
        </p>
      </div>
    </Modal>
  )
}
