// Zone 1 — Dynamic Page Header Bar (64px, slot-driven).
//
// Layout:
//   [back?] [Page Title] [ID tag?] [Status badge?]      [Action btn] [Action btn] ...
//
// Renders the content the page published via <PageHeaderSlot />. Falls back to a
// neutral placeholder when no page has published yet (rare — usually means router
// is mid-transition).
import { ChevronLeft } from 'lucide-react'
import { useSlot } from '../MasterLayoutContext'
import type { ReactNode } from 'react'

export type StatusBadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

export interface Zone1ActionButton {
  label:   string
  onClick: () => void
  variant?:'primary' | 'secondary' | 'ghost'
  icon?:   ReactNode
  disabled?:boolean
}

export interface Zone1Props {
  title:        string
  identityTag?: string
  statusBadge?: { label: string; variant: StatusBadgeVariant }
  actions?:     Zone1ActionButton[]
  back?:        () => void
}

export default function Zone1PageHeader() {
  const node = useSlot('pageHeader')
  if (!node) return <div className="zone-1 zone-1--empty" aria-hidden="true" />
  return <>{node}</>
}

// The actual renderer — used by PageHeaderSlot internally so the page declares props,
// the slot wraps them with this, and Zone1 just mounts the wrapped node.
export function Zone1PageHeaderRenderer(props: Zone1Props) {
  return (
    <header className="zone-1">
      <div className="zone-1-left">
        {props.back && (
          <button className="zone-1-back" onClick={props.back} aria-label="Back">
            <ChevronLeft size={16} />
          </button>
        )}
        <h1 className="zone-1-title">{props.title}</h1>
        {props.identityTag && (
          <span className="zone-1-idtag mono">{props.identityTag}</span>
        )}
        {props.statusBadge && (
          <span className={`zone-1-status zone-1-status--${props.statusBadge.variant}`}>
            {props.statusBadge.label}
          </span>
        )}
      </div>

      <div className="zone-1-right">
        {props.actions?.map((a, i) => (
          <button
            key={`${a.label}-${i}`}
            className={`zone-1-action zone-1-action--${a.variant ?? 'primary'}`}
            onClick={a.onClick}
            disabled={a.disabled}
          >
            {a.icon}
            {a.label}
          </button>
        ))}
      </div>
    </header>
  )
}
