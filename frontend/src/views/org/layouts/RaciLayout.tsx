import { useMemo } from 'react'
import type { CustomFieldDef } from '../../../lib/pageConfig'
import type { OrgTreeNode, CFApi } from '../types'
import { toneClass, flattenTree } from '../utils'

const RACI_COLS: { key: 'R' | 'A' | 'C' | 'I'; label: string; full: string }[] = [
  { key: 'R', label: 'R', full: 'Responsible' },
  { key: 'A', label: 'A', full: 'Accountable' },
  { key: 'C', label: 'C', full: 'Consulted' },
  { key: 'I', label: 'I', full: 'Informed' },
]

function raciFieldKey(defs: CustomFieldDef[]): string | null {
  const byKey = defs.find((d) => d.key.toLowerCase() === 'raci')
  if (byKey) return byKey.key
  const byLabel = defs.find((d) => d.label.trim().toLowerCase() === 'raci')
  return byLabel ? byLabel.key : null
}

function parseRaci(raw: unknown): Set<'R' | 'A' | 'C' | 'I'> {
  const out = new Set<'R' | 'A' | 'C' | 'I'>()
  if (raw == null) return out
  const s = String(raw).toUpperCase()
  for (const ch of ['R', 'A', 'C', 'I'] as const) if (s.includes(ch)) out.add(ch)
  return out
}

export function RaciLayout({ roots, defs, cf }: { roots: OrgTreeNode[]; defs: CustomFieldDef[]; cf: CFApi }) {
  const raciKey = useMemo(() => raciFieldKey(defs), [defs])
  const flat = useMemo(() => flattenTree(roots), [roots])

  if (flat.length === 0) {
    return <div className="org-empty muted">No organization nodes for the RACI matrix.</div>
  }

  return (
    <div className="org-raci">
      {!raciKey && (
        <div className="org-raci-empty" role="status">
          No RACI assignments configured yet — add a <strong>RACI</strong> custom field (a text field
          keyed/labelled "RACI") via Configure → Custom fields, then set each node's value to the
          letters that apply (e.g. <code>R, A</code>). The matrix scaffold below shows the structure;
          cells stay empty until that field exists.
        </div>
      )}
      <div className="grid-wrap">
        <table className="grid org-raci-table">
          <thead>
            <tr>
              <th scope="col">Node</th>
              <th scope="col">Type</th>
              {RACI_COLS.map((c) => (
                <th key={c.key} scope="col" className="org-raci-col" title={c.full}>
                  <span className="org-raci-colcode">{c.label}</span>
                  <span className="org-raci-colname">{c.full}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {flat.map((f) => {
              const lit = raciKey ? parseRaci(cf.value(f.node.id, raciKey)) : new Set<'R' | 'A' | 'C' | 'I'>()
              return (
                <tr key={f.node.id}>
                  <td className="org-raci-node" style={{ paddingLeft: 8 + f.depth * 16 }}>{f.node.name}</td>
                  <td><span className={`badge ${toneClass(f.node.type)}`}>{f.node.type}</span></td>
                  {RACI_COLS.map((c) => (
                    <td key={c.key} className="org-raci-cell">
                      {lit.has(c.key)
                        ? <span className={`org-raci-mark org-raci-${c.key}`} title={`${c.full} — ${f.node.name}`}>{c.label}</span>
                        : <span className="org-raci-dot" aria-hidden="true" />}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="org-raci-legend">
        {RACI_COLS.map((c) => (
          <span key={c.key} className="org-raci-legend-item">
            <span className={`org-raci-mark org-raci-${c.key}`}>{c.label}</span>
            <span className="muted">{c.full}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
