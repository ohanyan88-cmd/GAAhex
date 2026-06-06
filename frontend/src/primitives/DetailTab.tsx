// DetailTab — TB-1 / TB-2 / TB-3 canonical detail-tab primitive.
//
// Replaces 7+ hand-rolled tab-button reimplementations across god views
// (InvoiceTabButton, AccountTabButton, CustomerTabButton, RaTabButton,
// NiTab, CollectionsView TabButton, PipelineView TabButton). All of them
// rendered the same azure-underline-when-active recipe with subtly
// different inline styles, and NONE of them supported keyboard navigation
// (WCAG 2.1.1 violation).
//
// `<DetailTabList>` is the optional container that wires Arrow / Home /
// End keyboard navigation across siblings. Use it when more than one tab
// is present in the same row (every real call site).
//
// Usage:
//
//   <DetailTabList ariaLabel="Invoice sections">
//     <DetailTab active={tab === 'overview'} onSelect={() => setTab('overview')} icon={<FileText />}>
//       Overview
//     </DetailTab>
//     <DetailTab active={tab === 'timeline'} onSelect={() => setTab('timeline')} count={5}>
//       Timeline
//     </DetailTab>
//   </DetailTabList>

import { Children, cloneElement, isValidElement, useRef, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'

export interface DetailTabProps {
  active: boolean
  onSelect: () => void
  children: ReactNode
  icon?: ReactNode
  /** Optional count badge (e.g. number of open items in this tab). */
  count?: number
  /** Optional subtitle rendered under the label. */
  subtitle?: ReactNode
  /** Allow disabling a tab (greyed + no select / no focus). */
  disabled?: boolean
}

// Internal: bound by DetailTabList so the list can manage focus across siblings.
interface InternalProps extends DetailTabProps {
  /** Set by DetailTabList; do not pass directly. */
  _tabIndex?: number
}

export function DetailTab({
  active, onSelect, children, icon, count, subtitle, disabled,
  _tabIndex,
}: InternalProps) {
  // Active tab is the keyboard tab-stop (roving tabindex per WAI-ARIA APG).
  // Without the list manager, fall back to 0/-1 based on `active` alone.
  const tabIndex = _tabIndex !== undefined ? _tabIndex : (active ? 0 : -1)
  return (
    <button
      role="tab"
      type="button"
      aria-selected={active}
      aria-disabled={disabled || undefined}
      tabIndex={tabIndex}
      onClick={disabled ? undefined : onSelect}
      style={{
        display: 'inline-flex',
        alignItems: subtitle ? 'flex-start' : 'center',
        gap: 'var(--gx-space-3)',
        padding: 'var(--gx-space-5) var(--gx-space-7)',
        background: 'transparent',
        border: 'none',
        // D18: active tab underline = azure (interactive selection).
        borderBottom: active
          ? '2px solid var(--gx-interactive)'
          : '2px solid transparent',
        color: active ? 'var(--gx-text-1)' : 'var(--gx-text-3)',
        fontSize: 'var(--gx-text-13)',
        fontWeight: active ? 600 : 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        marginBottom: -1,
        whiteSpace: 'nowrap',
      }}
    >
      {icon}
      <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start' }}>
        <span>{children}</span>
        {subtitle && (
          <span style={{ fontSize: 'var(--gx-text-11)', fontWeight: 'var(--gx-weight-regular)', color: 'var(--gx-text-3)' }}>
            {subtitle}
          </span>
        )}
      </span>
      {typeof count === 'number' && count > 0 && (
        <span
          style={{
            marginLeft: 'var(--gx-space-2)',
            padding: '1px 7px',
            borderRadius: 'var(--gx-radius-full)',
            background: active ? 'var(--gx-interactive)' : 'var(--gx-surface-2)',
            color: active ? 'var(--gx-text-on-primary)' : 'var(--gx-text-2)',
            fontSize: 'var(--gx-text-11)',
            fontWeight: 'var(--gx-weight-semibold)',
            lineHeight: '16px',
          }}
        >
          {count}
        </span>
      )}
    </button>
  )
}

// TB-3 — keyboard navigation per WAI-ARIA Authoring Practices for tabs.
//
//   ArrowLeft  → previous tab (wraps)
//   ArrowRight → next tab (wraps)
//   Home       → first tab
//   End        → last tab
//   Enter/Space → select focused tab (native button behavior; no extra work)
//
// Wraps children with `role="tablist"` + the provided `aria-label`. Roving
// tabindex is computed automatically — only the active tab is tab-stop,
// arrow keys move focus among siblings without changing the URL/state.
export function DetailTabList({
  children,
  ariaLabel,
  vertical = false,
}: {
  children: ReactNode
  ariaLabel: string
  /** Set true for an aria-orientation="vertical" list (rare). */
  vertical?: boolean
}) {
  const listRef = useRef<HTMLDivElement>(null)

  const tabChildren = Children.toArray(children).filter(isValidElement)

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const key = e.key
    const horizontalNavKeys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
    const verticalNavKeys = ['ArrowUp', 'ArrowDown', 'Home', 'End']
    const navKeys = vertical ? verticalNavKeys : horizontalNavKeys
    if (!navKeys.includes(key)) return

    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([aria-disabled="true"])') ?? [],
    )
    if (buttons.length === 0) return

    const activeIdx = buttons.findIndex((b) => b === document.activeElement)
    let nextIdx = activeIdx

    const prev = vertical ? 'ArrowUp' : 'ArrowLeft'
    const next = vertical ? 'ArrowDown' : 'ArrowRight'

    if (key === prev) nextIdx = (activeIdx <= 0 ? buttons.length : activeIdx) - 1
    else if (key === next) nextIdx = (activeIdx + 1) % buttons.length
    else if (key === 'Home') nextIdx = 0
    else if (key === 'End') nextIdx = buttons.length - 1

    if (nextIdx !== activeIdx && nextIdx >= 0) {
      e.preventDefault()
      buttons[nextIdx].focus()
    }
  }

  // Inject roving tabindex into each child: active = 0, others = -1.
  // We assume children have an `active` prop (the canonical DetailTab does).
  const wrapped = tabChildren.map((child, i) => {
    if (!isValidElement(child)) return child
    const props = (child as ReactElement<DetailTabProps>).props
    const tabIdx = props.active ? 0 : -1
    return cloneElement(child as ReactElement<InternalProps>, { _tabIndex: tabIdx, key: i })
  })

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      onKeyDown={onKeyDown}
      style={{
        display: 'inline-flex',
        flexDirection: vertical ? 'column' : 'row',
        gap: 0,
        borderBottom: vertical ? 'none' : '1px solid var(--gx-border-subtle)',
        borderRight: vertical ? '1px solid var(--gx-border-subtle)' : 'none',
      }}
    >
      {wrapped}
    </div>
  )
}
