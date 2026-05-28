// -----------------------------------------------------------------------------
// CustomCells — REUSABLE rendering + inline editing of superadmin-added custom fields on any
// bespoke page. Pairs with pageConfig.ts (defs in the descriptor) and the page_field_value store.
//
// ADOPT ON ANOTHER BESPOKE PAGE (~5-10 lines) — see ServicesView.tsx for the live example:
//   const cf = useCustomFields(token, 'yourKey', page.customFields, rows.map(r => r.id))
//   ...in <thead>:  {cf.headers()}
//   ...in each <tr>: {cf.cells(row.id)}
// `page.customFields` comes from usePageConfig(...).customFields. `rows` is whatever the page
// already lists (each must have a stable string id). Nothing else in the page changes — the
// page's own data fetch, actions and detail panes are untouched.
// -----------------------------------------------------------------------------
import { useEffect, useRef, useState } from 'react'
import { toast } from './Toast'
import { fetchPageValues, savePageValue, type CustomFieldDef, type PageValueMap } from './pageConfig'

// Hook: batch-fetch values for the given row ids, expose <th> headers + per-row <td> cells (each
// editable inline), and persist edits optimistically. Re-fetches when ids or defs change.
export function useCustomFields(token: string, pageKey: string, defs: CustomFieldDef[], ids: string[]) {
  const [values, setValues] = useState<PageValueMap>({})
  const idKey = ids.join(',')          // stable dep — re-fetch when the visible row set changes
  const hasFields = defs.length > 0

  useEffect(() => {
    let alive = true
    if (!hasFields || ids.length === 0) { setValues({}); return }
    fetchPageValues(token, pageKey, ids).then((m) => { if (alive) setValues(m) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, pageKey, idKey, defs.length])

  async function setValue(rowId: string, fieldKey: string, value: any) {
    const prev = values[rowId] ?? {}
    const nextRow = { ...prev, [fieldKey]: value }
    setValues((v) => ({ ...v, [rowId]: nextRow }))   // optimistic
    try {
      const saved = await savePageValue(token, pageKey, rowId, nextRow)
      setValues((v) => ({ ...v, [rowId]: saved }))
    } catch (e) {
      setValues((v) => ({ ...v, [rowId]: prev }))    // rollback
      toast.error((e as Error).message)
    }
  }

  return {
    hasFields,
    // Extra <th> cells to append after the page's built-in headers.
    headers: () => defs.map((f) => <th key={`cf-${f.key}`} scope="col">{f.label}</th>),
    // Extra <td> cells for one row, appended after the page's built-in cells.
    cells: (rowId: string) =>
      defs.map((f) => (
        <CustomCell
          key={`cf-${f.key}-${rowId}`}
          def={f}
          value={(values[rowId] ?? {})[f.key]}
          onSave={(v) => setValue(rowId, f.key, v)}
        />
      )),
  }
}

// One editable cell: click to edit, input matched to the field type; commit on blur/Enter.
function CustomCell({ def, value, onSave }: { def: CustomFieldDef; value: any; onSave: (v: any) => void }) {
  const [editing, setEditing] = useState(false)

  // boolean is a direct toggle (no edit mode).
  if (def.type === 'boolean') {
    return (
      <td>
        <input
          type="checkbox"
          checked={value === true}
          aria-label={def.label}
          onChange={(e) => onSave(e.target.checked)}
        />
      </td>
    )
  }

  if (editing) {
    return <td><CustomCellInput def={def} value={value} onCommit={(v) => { setEditing(false); if (v !== value) onSave(v) }} onCancel={() => setEditing(false)} /></td>
  }

  return (
    <td
      onClick={() => setEditing(true)}
      tabIndex={0}
      role="button"
      aria-label={`Edit ${def.label}`}
      onKeyDown={(e) => { if (e.key === 'Enter') setEditing(true) }}
      style={{ cursor: 'pointer' }}
    >
      {displayValue(def, value)}
    </td>
  )
}

function CustomCellInput({ def, value, onCommit, onCancel }: { def: CustomFieldDef; value: any; onCommit: (v: any) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(value == null ? '' : String(value))
  const ref = useRef<HTMLInputElement | HTMLSelectElement | null>(null)
  useEffect(() => { ref.current?.focus() }, [])

  function parse(): any {
    if (def.type === 'number') {
      if (draft.trim() === '') return null
      const n = Number(draft)
      return Number.isFinite(n) ? n : value
    }
    return draft.trim() === '' ? null : draft
  }

  if (def.type === 'select') {
    return (
      <select
        ref={ref as any}
        className="inp inp-sm"
        value={draft}
        onChange={(e) => { setDraft(e.target.value); onCommit(e.target.value === '' ? null : e.target.value) }}
        onBlur={() => onCommit(draft === '' ? null : draft)}
      >
        <option value="">—</option>
        {(def.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }

  return (
    <input
      ref={ref as any}
      className="inp inp-sm"
      type={def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : 'text'}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(parse())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); onCommit(parse()) }
        if (e.key === 'Escape') { e.preventDefault(); onCancel() }
      }}
    />
  )
}

function displayValue(def: CustomFieldDef, value: any) {
  if (value == null || value === '') return <span className="muted">—</span>
  if (def.type === 'date') {
    const d = new Date(value); return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString()
  }
  return String(value)
}
