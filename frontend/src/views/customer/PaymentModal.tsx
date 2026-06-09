import { useState } from 'react'
import { bpost } from '../../lib/billing'
import { toMinor } from '../../lib/money'
import { Modal } from '../../components/Modal'
import { toast } from '../../components/Toast'
import { Button } from '../../primitives'
import { useI18n } from '../../lib/i18n'

// Compact record-payment modal — mirrors the InvoicesView affordance against POST .../payments.
export function PaymentModal({ token, invoiceId, onClose, onDone }: {
  token: string
  invoiceId: string
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useI18n()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('card')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!amount || saving) return
    setSaving(true)
    try {
      await bpost(token, `/api/invoices/${invoiceId}/payments`, { amount: toMinor(amount), method, note: note || undefined })
      toast.success(t('cust.paymentRecorded', 'Payment recorded'))
      onDone()
    } catch (e) { toast.error((e as Error).message) }
    finally { setSaving(false) }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('cust.recordPayment', 'Record payment')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="primary" size="md" disabled={saving || !amount} onClick={submit}>{saving ? t('common.saving', 'Saving…') : t('cust.record', 'Record')}</Button>
        </>
      }
    >
      <div className="rec-form" style={{ boxShadow: 'none', border: 0, padding: 0, marginBottom: 0 }}>
        <label className="field"><span>{t('cust.amount', 'Amount (֏)')}</span><input className="inp inp-md inp-numeric" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={t('cust.amount', 'Amount (֏)')} autoFocus /></label>
        <label className="field"><span>{t('cust.method', 'Method')}</span>
          <select className="inp inp-md" value={method} onChange={(e) => setMethod(e.target.value)} aria-label={t('cust.method', 'Method')}>
            <option value="card">{t('cust.methodCard', 'Card')}</option>
            <option value="transfer">{t('cust.methodTransfer', 'Transfer')}</option>
            <option value="cash">{t('cust.methodCash', 'Cash')}</option>
          </select>
        </label>
        <label className="field"><span>{t('cust.note', 'Note')}</span><input className="inp inp-md" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('common.optional', 'optional')} aria-label={t('cust.note', 'Note')} /></label>
      </div>
    </Modal>
  )
}
