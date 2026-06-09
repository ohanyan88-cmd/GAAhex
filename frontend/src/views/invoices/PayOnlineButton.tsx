// ── Pay online button ─────────────────────────────────────────────────────────
// Recording a gateway payment effectively creates a Payment row on success, so we gate the
// affordance on payment.create just like Record-payment does.
import { useState } from 'react'
import { Button } from '../../primitives'
import { CreditCardIcon } from '../../components/icons'
import { Modal } from '../../components/Modal'
import { toast } from '../../components/Toast'
import { initiatePayment, confirmDevPayment, isDevFlow } from '../../lib/paymentgw'

export function PayOnlineButton({ token, invoiceId, onDone }: {
  token: string
  invoiceId: string
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [devConfirm, setDevConfirm] = useState<{ orderId: string } | null>(null)

  async function handlePay() {
    if (busy) return
    setBusy(true)
    try {
      const result = await initiatePayment(token, invoiceId)
      if (isDevFlow(result.redirect_url)) {
        setDevConfirm({ orderId: result.order_id })
      } else {
        window.open(result.redirect_url, '_blank', 'noopener,noreferrer')
        toast.success('Payment page opened in a new tab.')
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function handleConfirmDev() {
    if (!devConfirm) return
    setBusy(true)
    try {
      await confirmDevPayment(token, devConfirm.orderId)
      setDevConfirm(null)
      toast.success('Payment confirmed — invoice is now PAID.')
      onDone()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="primary" size="sm"
            onClick={handlePay} disabled={busy}>
        <CreditCardIcon size={13} /> {busy ? 'Initiating…' : 'Pay online'}
      </Button>

      {devConfirm && (
        <Modal
          open
          onClose={() => { setDevConfirm(null); setBusy(false) }}
          title="Simulate gateway payment?"
          size="sm"
          footer={
            <>
              <Button variant="ghost" size="md"
            onClick={() => { setDevConfirm(null); setBusy(false) }}>Cancel</Button>
              <Button variant="primary" size="md"
            onClick={handleConfirmDev} disabled={busy}>
                {busy ? 'Confirming…' : 'Confirm payment'}
              </Button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            This is the <strong>dev payment flow</strong>. Clicking Confirm will call{' '}
            <code>confirm-dev</code> and immediately settle the payment order, marking the invoice
            as <strong>PAID</strong>.
          </p>
        </Modal>
      )}
    </>
  )
}
