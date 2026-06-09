import { useState, useMemo } from 'react'
import { ArrowUpIcon, ArrowDownIcon, SearchIcon } from '../../../components/icons'
import type { OrgNode, CFApi } from '../types'
import { toneClass } from '../utils'
import { useI18n } from '../../../lib/i18n'

type SortCol = 'name' | 'type' | 'path' | 'parent'
type SortDir = 'asc' | 'desc'
type ListRow = { node: OrgNode; parentName: string }

export function ListLayout({ nodes, cf }: { nodes: OrgNode[]; cf: CFApi }) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [sortCol, setSortCol] = useState<SortCol>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const rows = useMemo<ListRow[]>(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]))
    return nodes.map((n) => ({
      node: n,
      parentName: n.parent_id != null ? (byId.get(n.parent_id)?.name ?? '') : '',
    }))
  }, [nodes])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = q
      ? rows.filter((r) => r.node.name.toLowerCase().includes(q) || r.node.path.toLowerCase().includes(q))
      : rows
    const val = (r: ListRow): string => {
      switch (sortCol) {
        case 'name': return r.node.name
        case 'type': return r.node.type
        case 'path': return r.node.path
        case 'parent': return r.parentName
      }
    }
    const dir = sortDir === 'asc' ? 1 : -1
    return [...base].sort((a, b) => val(a).localeCompare(val(b), undefined, { numeric: true, sensitivity: 'base' }) * dir)
  }, [rows, query, sortCol, sortDir])

  const sortBy = (col: SortCol) => {
    if (col === sortCol) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortCol(col); setSortDir('asc') }
  }

  const SortHead = ({ col, label }: { col: SortCol; label: string }) => {
    const active = sortCol === col
    return (
      <th>
        <button type="button" className={`org-th-sort${active ? ' on' : ''}`} onClick={() => sortBy(col)} aria-label={`Sort by ${label}`}>
          <span>{label}</span>
          {active && (sortDir === 'asc' ? <ArrowUpIcon size={12} /> : <ArrowDownIcon size={12} />)}
        </button>
      </th>
    )
  }

  return (
    <div className="org-list">
      <div className="org-list-toolbar">
        <div className="org-search">
          <SearchIcon size={15} />
          <input
            type="text"
            className="org-search-input"
            placeholder={t('org.filterByNameOrPath', 'Filter by name or path…')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter nodes"
          />
        </div>
        <span className="org-list-count muted">{filtered.length} node{filtered.length === 1 ? '' : 's'}</span>
      </div>
      <div className="grid-wrap">
        <table className="grid org-list-table">
          <thead>
            <tr>
              <SortHead col="name" label={t('common.name', 'Name')} />
              <SortHead col="type" label={t('common.type', 'Type')} />
              <SortHead col="path" label={t('org.pathCode', 'Path / Code')} />
              <SortHead col="parent" label={t('org.parent', 'Parent')} />
              {cf.headers()}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={4 + cf.defs.length} className="org-list-empty muted">{t('org.noNodesMatch', 'No nodes match')} "{query}".</td></tr>
            ) : filtered.map((r) => (
              <tr key={r.node.id}>
                <td className="org-list-name">{r.node.name}</td>
                <td><span className={`badge ${toneClass(r.node.type)}`}>{r.node.type}</span></td>
                <td className="org-list-path">{r.node.code ? r.node.code : `/${r.node.path}/`}</td>
                <td className="org-list-parent">{r.parentName || <span className="muted">—</span>}</td>
                {cf.cells(r.node.id)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
