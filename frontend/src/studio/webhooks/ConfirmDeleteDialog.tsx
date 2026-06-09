// ConfirmDeleteDialog for webhooks.

import { ErrorBanner } from '../../components/States'
import { Modal } from '../../components/Modal'
import { Button } from '../../primitives'
import { TrashIcon } from '../../components/icons'

// MO-2 — `<Modal>` chrome. Custom footer (vs ModalFooterActions) because the
// primary action label needs both an icon and a busy state.
export function ConfirmDeleteDialog({
  hookName, onCancel, onConfirm, deleting, err,
}: {
  hookName: string
  onCancel: () => void
  onConfirm: () => void
  deleting: boolean
  err: string
}) {
  return (
    <Modal
      open
      onClose={onCancel}
      title="Delete webhook?"
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="md"
            type="button"  onClick={onCancel} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" size="md"
            type="button"  onClick={onConfirm} disabled={deleting}>
            <TrashIcon size={13} /> {deleting ? 'Deleting…' : 'Delete webhook'}
          </Button>
        </>
      }
    >
      <p className="hint" style={{ margin: '0 0 var(--gx-space-7)' }}>
        This will hard-delete <strong>{hookName}</strong>. Future events will no longer be
        delivered to this endpoint. Past delivery records are preserved.
      </p>
      {err && <ErrorBanner message={err} />}
    </Modal>
  )
}
