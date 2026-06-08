import { useState, useEffect, useRef } from 'react'
import { StatusPill } from '../../primitives'
import { CustomFieldChip } from '../../components/CustomCells'
import { EditIcon, PlusIcon, ArrowRightIcon, TrashIcon } from '../../components/icons'
import type { CustomFieldDef } from '../../lib/pageConfig'
import type { OrgNode, OrgTreeNode, CFApi, OrgEditAction } from './types'
import { statusVariant, toneClass, initials } from './utils'
import { useOrgEdit } from './context'

export function NodeStatusPill({ node, statusKey, cf }: { node: OrgNode; statusKey: string | null; cf: CFApi }) {
  if (statusKey) {
    const raw = cf.value(node.id, statusKey)
    const variant = statusVariant(raw)
    if (variant) return <StatusPill variant={variant} label={String(raw)} size="sm" />
  }
  return <StatusPill variant="neutral" label={node.type} size="sm" />
}

export function NodeKpiChips({ node, cf }: { node: OrgTreeNode; cf: CFApi }) {
  const span = node.children.length
  const rawHead = cf.value(node.id, 'headcount')
  const head = rawHead != null && rawHead !== '' ? Number(rawHead) : NaN
  const hasHead = Number.isFinite(head)
  return (
    <span className="org-kpi-chips">
      <span className="org-kpi-chip" title="Direct reports (span of control)">
        <span className="org-kpi-label">Span</span>
        <span className="org-kpi-value">{span}</span>
      </span>
      {hasHead && (
        <span className="org-kpi-chip" title="Headcount">
          <span className="org-kpi-label">Headcount</span>
          <span className="org-kpi-value">{head}</span>
        </span>
      )}
    </span>
  )
}

export function NodeAvatar({ node }: { node: OrgNode }) {
  return <span className={`org-avatar ${toneClass(node.type)}`} aria-hidden="true">{initials(node.name)}</span>
}

export function NodeKebab({ node }: { node: OrgNode }) {
  const edit = useOrgEdit()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!edit) return null

  const run = (fn: OrgEditAction) => (e: { stopPropagation(): void }) => {
    e.stopPropagation()
    setOpen(false)
    fn(node)
  }

  return (
    <span className="org-kebab-wrap" ref={wrapRef}>
      <button
        type="button"
        className={'org-node-kebab' + (open ? ' on' : '')}
        aria-label={`Actions for ${node.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
      >
        <svg width={15} height={15} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" />
        </svg>
      </button>
      {open && (
        <div className="org-kebab-menu" role="menu" aria-label={`Actions for ${node.name}`}>
          <button type="button" className="org-kebab-item" role="menuitem" onClick={run(edit.rename)}>
            <EditIcon size={15} /><span>Rename</span>
          </button>
          <button type="button" className="org-kebab-item" role="menuitem" onClick={run(edit.addChild)}>
            <PlusIcon size={15} /><span>Add child</span>
          </button>
          <button type="button" className="org-kebab-item" role="menuitem" onClick={run(edit.move)}>
            <ArrowRightIcon size={15} /><span>Move…</span>
          </button>
          <div className="org-kebab-divider" />
          <button type="button" className="org-kebab-item org-kebab-danger" role="menuitem" onClick={run(edit.remove)}>
            <TrashIcon size={15} /><span>Delete</span>
          </button>
        </div>
      )}
    </span>
  )
}

export function NodeCustomFields({ node, defs, cf }: { node: OrgNode; defs: CustomFieldDef[]; cf: CFApi }) {
  if (defs.length === 0) return null
  return (
    <div className="org-cf-list">
      {defs.map((f) => (
        <CustomFieldChip
          key={f.key}
          def={f}
          value={cf.value(node.id, f.key)}
          onSave={(v) => cf.setValue(node.id, f.key, v)}
        />
      ))}
    </div>
  )
}

export function NodeCustomFieldsReadonly({ node, defs, cf }: { node: OrgNode; defs: CustomFieldDef[]; cf: CFApi }) {
  if (defs.length === 0) return null
  const shown = defs
    .map((f) => ({ f, v: cf.value(node.id, f.key) }))
    .filter(({ v }) => v != null && v !== '')
  if (shown.length === 0) return null
  return (
    <span className="org-cf-inline">
      {shown.map(({ f, v }) => (
        <span key={f.key} className="org-cf-tag">
          <span className="org-cf-tag-label">{f.label}</span>
          <span className="org-cf-tag-value">{f.type === 'boolean' ? (v === true ? 'Yes' : 'No') : String(v)}</span>
        </span>
      ))}
    </span>
  )
}
