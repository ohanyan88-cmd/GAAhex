import type { ReactNode } from 'react'
import { useEffect, useId, useState } from 'react'
import Overlay from './Overlay'
import { CloseIcon } from './icons'

export type ModalSize = 'sm' | 'md' | 'lg' | 'fullscreen'

// Modal — built on the Overlay primitive. Header (title + close), scrollable body, optional footer.
export function Modal({ open, onClose, title, size = 'md', children, footer }: {
  open: boolean
  onClose: () => void
  title: ReactNode
  size?: ModalSize
  children: ReactNode
  footer?: ReactNode
}) {
  const titleId = useId()
  if (!open) return null
  return (
    <Overlay onClose={onClose} className={`modal modal-${size}`} labelledBy={titleId}>
      <div className="modal-head">
        <h3 id={titleId} className="modal-title">{title}</h3>
        <button type="button" className="iconbtn" aria-label="Close" onClick={onClose}>
          <CloseIcon size={18} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-foot">{footer}</div>}
    </Overlay>
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
        <>
          <button className="btn btn-ghost btn-md" onClick={() => close(false)}>{opts.cancelLabel ?? 'Cancel'}</button>
          <button className={'btn btn-md ' + (opts.danger ? 'btn-danger' : 'btn-primary')} onClick={() => close(true)}>
            {opts.confirmLabel ?? 'Confirm'}
          </button>
        </>
      }
    >
      <p>{opts.message}</p>
    </Modal>
  )
}
