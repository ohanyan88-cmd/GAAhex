import type { ReactNode } from 'react'
// D20 — static chrome classes live in _overlays.css (.gx-dialog-panel, .gx-dialog-title-col, etc.)
import { useEffect, useId, useState } from 'react'
import Overlay from './Overlay'
import { CloseIcon } from './icons'
import { Button } from '../primitives'  // T-P3-7

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'fullscreen'

// Modal — built on the Overlay primitive. Kit chrome: scrim backdrop, .gx-dialog panel,
// .gx-dialog-head title row, scrollable body, optional footer row with border-top.
//
// API contract (Modal owns the close affordance — callers must NOT add another):
//   - The HEADER renders the ONE ✕ close button. Callers MUST NOT pass a "Close"
//     button in `footer` — that was the source of the "3 redundant close buttons"
//     bug. The footer is for ACTIONS (Cancel + Save, Resolve, Confirm, etc.).
//   - `subtitle` adds a secondary line under the title (e.g. record id, customer).
//   - `hero` is an optional richer header block rendered below the title row —
//     for status pills + meta inline with the title.
export function Modal({ open, onClose, title, subtitle, size = 'md', children, footer, hero }: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  size?: ModalSize
  children: ReactNode
  footer?: ReactNode
  hero?: ReactNode
}) {
  const titleId = useId()
  if (!open) return null
  // D20 — size constraint via CSS modifier classes (.gx-dialog--sm/md/lg/xl/fullscreen)
  // defined in _overlays.css. No inline styles needed.
  const dialogClass = `gx-dialog gx-dialog--${size}`
  const panelClass = size === 'fullscreen'
    ? 'gx-dialog-panel gx-dialog-panel--fullscreen'
    : 'gx-dialog-panel'
  return (
    <Overlay
      onClose={onClose}
      backdropClassName="gx-scrim"
      className={dialogClass}
      labelledBy={titleId}
      bare
    >
      <div className={panelClass}>
        <div className="gx-dialog-head">
          <div className="gx-dialog-title-col">
            <h3 id={titleId} className="gx-dialog-title">{title}</h3>
            {subtitle && (
              <div className="gx-dialog-subtitle">
                {subtitle}
              </div>
            )}
          </div>
          <button type="button" className="tb-icon" aria-label="Close" onClick={onClose}>
            <CloseIcon size={16} />
          </button>
        </div>
        {hero && (
          <div className="gx-dialog-hero">
            {hero}
          </div>
        )}
        <div className="gx-dialog-body">
          {children}
        </div>
        {footer && (
          <div className="gx-dialog-footer">
            {footer}
          </div>
        )}
      </div>
    </Overlay>
  )
}

// MO-6 — ModalFooterActions. Every Modal caller used to copy-paste the same
// "Cancel + primary action" button pair. This helper standardizes the
// footer-row markup so a future style change (Cancel goes from `btn-ghost`
// to `btn-secondary`, primary becomes loading-spinner-aware, etc.) lands in
// one place. Pass into Modal's `footer` prop.
export function ModalFooterActions({
  onCancel,
  onConfirm,
  cancelLabel = 'Cancel',
  confirmLabel = 'Confirm',
  confirmDisabled = false,
  danger = false,
}: {
  onCancel: () => void
  onConfirm: () => void | Promise<void>
  cancelLabel?: string
  confirmLabel?: string
  confirmDisabled?: boolean
  /** Use the danger variant on the primary button (red — for destructive flows). */
  danger?: boolean
}) {
  return (
    <>
      <Button variant="ghost" size="md" onClick={onCancel}>
        {cancelLabel}
      </Button>
      <Button
        variant={danger ? 'danger' : 'primary'}
        size="md"
        disabled={confirmDisabled}
        onClick={() => { void onConfirm() }}
      >
        {confirmLabel}
      </Button>
    </>
  )
}


// ── confirmDialog: a promise-based confirm that replaces window.confirm ──────────────────────────
export type ConfirmOptions = {
  title?: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}
type ConfirmRequest = { opts: ConfirmOptions; resolve: (ok: boolean) => void }

let confirmListener: ((req: ConfirmRequest) => void) | null = null

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!confirmListener) {
      // host not mounted — degrade to the native confirm rather than hang
      resolve(window.confirm(typeof opts.message === 'string' ? opts.message : 'Are you sure?'))
      return
    }
    confirmListener({ opts, resolve })
  })
}

// Mount ONCE (e.g. in main.tsx). Renders the active confirm request as a Modal.
// Picks up the PROMPT 9 kit chrome automatically via the refactored <Modal/>.
export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmRequest | null>(null)

  useEffect(() => {
    confirmListener = (r) => setReq(r)
    return () => { confirmListener = null }
  }, [])

  if (!req) return null
  const close = (ok: boolean) => { req.resolve(ok); setReq(null) }
  const { opts } = req

  return (
    <Modal
      open
      onClose={() => close(false)}
      title={opts.title ?? 'Confirm'}
      size="sm"
      footer={
        <ModalFooterActions
          onCancel={() => close(false)}
          onConfirm={() => close(true)}
          cancelLabel={opts.cancelLabel}
          confirmLabel={opts.confirmLabel ?? 'Confirm'}
          danger={!!opts.danger}
        />
      }
    >
      <p className="gx-confirm-message">{opts.message}</p>
    </Modal>
  )
}
