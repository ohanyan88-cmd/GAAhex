// ConfirmDeleteDialog and ConfirmTestSendDialog for notification defs.

import { ErrorBanner } from '../../components/States'
import { Modal } from '../../components/Modal'
import { Button } from '../../primitives'
import { TrashIcon, SendHorizontalIcon } from '../../components/icons'

// MO-2 — canonical `<Modal>` chrome. Async error / loading state stays inline
// in the body (custom footer with disabled-while-busy) since `confirmDialog()`'s
// promise API doesn't expose those — a per-confirm Modal is the right primitive.
export function ConfirmDeleteDialog({
  defLabel, defKey, onCancel, onConfirm, deleting, err,
}: {
  defLabel: string; defKey: string
  onCancel: () => void; onConfirm: () => void
  deleting: boolean; err: string
}) {
  return (
    <Modal
      open
      onClose={onCancel}
      title="Delete notification def?"
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="md"
            type="button"  onClick={onCancel} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" size="md"
            type="button"  onClick={onConfirm} disabled={deleting}>
            <TrashIcon size={13} /> {deleting ? 'Deleting…' : 'Delete def'}
          </Button>
        </>
      }
    >
      <p className="hint" style={{ margin: '0 0 var(--gx-space-7)' }}>
        This will hard-delete <strong>{defLabel}</strong> (<code className="mono">{defKey}</code>).
        Existing inbox rows that were rendered FROM this def are preserved (they're
        immutable post-emit). Future emits of <code className="mono">{defKey}</code> become a
        no-op until the def is recreated. Use <em>Disable</em> instead if you want to
        temporarily stop emits without losing the def.
      </p>
      {err && <ErrorBanner message={err} />}
    </Modal>
  )
}

// MO-3 — canonical `<Modal>` chrome. Test-send confirm with loading state.
export function ConfirmTestSendDialog({
  defKey, channel, onCancel, onConfirm, sending,
}: {
  defKey: string; channel: string
  onCancel: () => void; onConfirm: () => void
  sending: boolean
}) {
  return (
    <Modal
      open
      onClose={onCancel}
      title="Send a test notification?"
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="md"
            type="button"  onClick={onCancel} disabled={sending}>
            Cancel
          </Button>
          <Button variant="primary" size="md"
            type="button"  onClick={onConfirm} disabled={sending}>
            <SendHorizontalIcon size={13} /> {sending ? 'Sending…' : 'Send test'}
          </Button>
        </>
      }
    >
      <p className="hint" style={{ margin: '0 0 var(--gx-space-7)' }}>
        This will emit one notification through <code className="mono">{defKey}</code> on the
        <strong> {channel}</strong> channel, addressed to you. If a real adapter is not
        configured for this channel, the inbox row is still created (dev adapter) and the
        response will say so honestly.
      </p>
    </Modal>
  )
}
