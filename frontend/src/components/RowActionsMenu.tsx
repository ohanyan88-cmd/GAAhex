// RowActionsMenu — shared overflow-menu for table rows. Collapses the per-row icon stack into
// a single ⋮ (MoreVertical) button + popover, with an optional single "primary" inline action.
//
// Why: six-plus always-visible icons per row crowd narrow viewports and collide with adjacent
// cells. Funnel them into one menu, keep one inline shortcut at most, and let the table breathe.
//
// Anchors below-right of the trigger; closes on outside-click and Esc. Keyboard: Enter/Space to
// open, Arrow Up/Down to move focus through menu items, Esc to close. Light + dark via --gx-* tokens.

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { MoreVerticalIcon } from './icons'

export type RowAction = {
  key: string
  label: string
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  hidden?: boolean
  onClick: () => void
}

type Props = {
  primary?: RowAction
  actions: RowAction[]
  ariaLabel?: string
  // visual size of the trigger icon, matches the old iconbtn used inline
  size?: number
}

export default function RowActionsMenu({ primary, actions, ariaLabel = 'Row actions', size = 14 }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const visible = actions.filter((a) => !a.hidden)

  // Outside-click / Escape close
  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      const wrap = wrapRef.current
      const pop = popRef.current
      const target = e.target as Node
      if (wrap && wrap.contains(target)) return
      if (pop && pop.contains(target)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Position the popover using fixed coords so it escapes any overflow:hidden parent
  // (the table cell, the grid-wrap horizontal-scroll container, etc.). Recompute on
  // open and on scroll/resize while open.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    function place() {
      const t = triggerRef.current
      if (!t) return
      const r = t.getBoundingClientRect()
      const POP_MIN_W = 200
      const GAP = 6
      // anchor below-right: right edge of trigger aligns with right edge of menu
      let left = r.right - POP_MIN_W
      if (left < 8) left = 8
      const top = r.bottom + GAP
      setPos({ top, left })
    }
    place()
    const onScroll = () => place()
    const onResize = () => place()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  // Roving focus inside the menu: Arrow Up/Down between items, Home/End to ends.
  function onMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const pop = popRef.current
    if (!pop) return
    const items = Array.from(pop.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])'))
    if (items.length === 0) return
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = items[(i + 1 + items.length) % items.length]
      next?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const next = items[(i - 1 + items.length) % items.length]
      next?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      items[0]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      items[items.length - 1]?.focus()
    }
  }

  function runAndClose(a: RowAction) {
    setOpen(false)
    // Defer the action one tick so the popover dismount doesn't race with whatever the action
    // triggers (e.g. opening a modal that owns focus).
    queueMicrotask(() => a.onClick())
  }

  function toggleOpen() {
    setOpen((o) => {
      const next = !o
      if (next) {
        // focus the first menu item on open (after layout)
        queueMicrotask(() => {
          const first = popRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')
          first?.focus()
        })
      }
      return next
    })
  }

  return (
    <div ref={wrapRef} className="row-actions-menu" style={{ display: 'inline-flex', gap: 'var(--gx-space-2)' }}>
      {primary && !primary.hidden && (
        <button
          type="button"
          className="iconbtn"
          aria-label={primary.label}
          title={primary.label}
          disabled={primary.disabled}
          onClick={(e) => { e.stopPropagation(); primary.onClick() }}
          style={primary.danger ? { color: 'var(--gx-danger)' } : undefined}
        >
          {primary.icon}
        </button>
      )}
      {visible.length > 0 && (
        <button
          ref={triggerRef}
          type="button"
          className={'iconbtn' + (open ? ' on' : '')}
          aria-label={ariaLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={(e) => { e.stopPropagation(); toggleOpen() }}
          title={ariaLabel}
        >
          <MoreVerticalIcon size={size} />
        </button>
      )}
      {open && pos && (
        <div
          ref={popRef}
          id={menuId}
          role="menu"
          aria-label={ariaLabel}
          className="menu fade-fast row-actions-pop"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={onMenuKeyDown}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            minWidth: 200,
          }}
        >
          {visible.map((a) => (
            <button
              key={a.key}
              type="button"
              role="menuitem"
              className={'menu-item' + (a.danger ? ' danger' : '')}
              disabled={a.disabled}
              onClick={() => runAndClose(a)}
            >
              {a.icon && <span className="lic" aria-hidden style={{ display: 'inline-flex' }}>{a.icon}</span>}
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
