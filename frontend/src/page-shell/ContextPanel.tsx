// ContextPanel — Zone F.
//
// Right-side drawer that shows selection context (e.g. the currently
// highlighted record's details) for the page. Width is fixed at 340px,
// collapsible via the header toggle. Same dimensions/treatment on every
// page so the user develops muscle memory.
import { useState } from 'react'
import { PanelRight, ChevronRight } from 'lucide-react'
import type { ContextPanelSpec } from './types'

interface ContextPanelProps {
  spec: ContextPanelSpec
}

export function ContextPanel({ spec }: ContextPanelProps) {
  const [open, setOpen] = useState(spec.defaultOpen ?? true)
  return (
    <aside className="ps-context" data-open={String(open)} aria-label="Context panel">
      <div className="ps-context-head">
        {open && <span className="ps-context-title">{spec.title ?? 'Details'}</span>}
        <button
          type="button"
          className="ps-context-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Collapse context panel' : 'Expand context panel'}
          aria-expanded={open}
        >
          {open ? <ChevronRight size={14} /> : <PanelRight size={14} />}
        </button>
      </div>
      <div className="ps-context-body">{spec.content}</div>
    </aside>
  )
}
