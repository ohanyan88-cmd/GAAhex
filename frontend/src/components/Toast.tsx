import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckIcon, WarningIcon, InfoIcon, CloseIcon } from './icons'

export type ToastKind = 'success' | 'warning' | 'error' | 'info'
type ToastItem = { id: number; kind: ToastKind; message: string; duration: number }

// Module-level queue so toast() can be called from anywhere (incl. non-component async handlers),
// not just inside a React subtree. A single <ToastHost/> (mounted in main.tsx) renders the queue.
let items: ToastItem[] = []
let listeners: Array<(items: ToastItem[]) => void> = []
let seq = 1

function emit() { listeners.forEach((l) => l(items)) }

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id)
  emit()
}

function push(kind: ToastKind, message: string, duration = 4000): number {
  const id = seq++
  items = [...items, { id, kind, message, duration }]
  emit()
  if (duration > 0) setTimeout(() => dismiss(id), duration)
  return id
}

// Imperative API — import { toast } and call toast.success('…') etc.
export const toast = {
  success: (message: string, duration?: number) => push('success', message, duration),
  error: (message: string, duration?: number) => push('error', message, duration),
  warning: (message: string, duration?: number) => push('warning', message, duration),
  info: (message: string, duration?: number) => push('info', message, duration),
  dismiss,
}

// Hook flavor for ergonomics inside components.
export function useToast() { return toast }

const ICONS = { success: CheckIcon, error: WarningIcon, warning: WarningIcon, info: InfoIcon }

// Mount ONCE. Renders the live toast queue into a body portal (aria-live for screen readers).
export function ToastHost() {
  const [list, setList] = useState<ToastItem[]>(items)

  useEffect(() => {
    const l = (next: ToastItem[]) => setList(next)
    listeners.push(l)
    setList(items)
    return () => { listeners = listeners.filter((x) => x !== l) }
  }, [])

  return createPortal(
    <div className="toast-region" role="region" aria-live="polite" aria-label="Notifications">
      {list.map((t) => {
        const Icon = ICONS[t.kind]
        return (
          <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <span className="toast-icon"><Icon size={17} /></span>
            <span className="toast-msg">{t.message}</span>
            <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <CloseIcon size={14} />
            </button>
          </div>
        )
      })}
    </div>,
    document.body,
  )
}
