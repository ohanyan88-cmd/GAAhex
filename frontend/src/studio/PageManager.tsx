// GAAhex Studio — Page Manager pane.
// Extracted from StudioRichPanes.tsx. Behavior unchanged.
// All panes start in EMPTY / MINIMAL state — no hardcoded mock content.

import { Button } from '../primitives'
import { useState } from 'react'
import { Copy, File, FilePen, Files, Plus, Trash2 } from 'lucide-react'
import { Sec } from './_shared'

// Page archetype list — static until /api/studio/page-types is built.
const PAGE_TYPES = ['home', 'dashboard', 'list', 'form', 'detail', 'landing', 'checkout', 'profile', 'report']

interface PageRow {
  id: string
  name: string
  type: string
  status: 'Published' | 'Draft' | 'In review'
  updated: string
}

export function PageManager() {
  const [pages, setPages] = useState<PageRow[]>([])
  let _id = { current: 1 }

  const add = () => {
    setPages(p => [
      { id: 'p' + (_id.current++), name: 'Untitled page', type: 'list', status: 'Draft', updated: 'now' },
      ...p,
    ])
  }
  const dup = (pg: PageRow) =>
    setPages(p => [{ ...pg, id: 'p' + (_id.current++), name: pg.name + ' copy', status: 'Draft', updated: 'now' }, ...p])
  const rename = (pg: PageRow) => {
    const n = window.prompt('Rename page', pg.name)
    if (n) setPages(p => p.map(x => x.id === pg.id ? { ...x, name: n, updated: 'now' } : x))
  }
  const del = (pg: PageRow) => setPages(p => p.filter(x => x.id !== pg.id))
  const setType = (pg: PageRow, t: string) =>
    setPages(p => p.map(x => x.id === pg.id ? { ...x, type: t } : x))

  const statusCls = (s: string) =>
    s === 'Published' ? 'pill pill-success' : s === 'Draft' ? 'pill pill-neutral' : 'pill pill-warning'

  return (
    <div>
      <Sec
        icon={<Files size={15} />}
        title="Page Manager"
        hint="create, duplicate, rename, delete pages"
        right={
          <Button variant="primary" size="sm"
            type="button" onClick={add}>
            <Plus size={13} />New page
          </Button>
        }
      />
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="grid">
          <thead>
            <tr>
              <th>Page</th><th>Type</th><th>Status</th><th>Updated</th>
              <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {pages.map(pg => (
              <tr key={pg.id} style={{ cursor: 'default' }}>
                <td style={{ fontWeight: 600 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <File size={14} style={{ color: 'var(--gx-text-3)' }} />{pg.name}
                  </span>
                </td>
                <td>
                  <select
                    className="inp inp-sm"
                    style={{ width: 130 }}
                    value={pg.type}
                    onChange={e => setType(pg, e.target.value)}
                  >
                    {PAGE_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </td>
                <td><span className={statusCls(pg.status)}>{pg.status}</span></td>
                <td className="hint" style={{ fontSize: 11.5 }}>{pg.updated}</td>
                <td className="actions-col">
                  <div style={{ display: 'flex', gap: 'var(--gx-space-1)', justifyContent: 'flex-end' }}>
                    <Button variant="ghost" size="sm" iconOnly
            title="Rename" type="button" onClick={() => rename(pg)}>
                      <FilePen size={14} />
                    </Button>
                    <Button variant="ghost" size="sm" iconOnly
            title="Duplicate" type="button" onClick={() => dup(pg)}>
                      <Copy size={14} />
                    </Button>
                    <Button variant="ghost" size="sm" iconOnly
            title="Delete"
                      type="button"
                      onClick={() => del(pg)}
                      style={{ color: 'var(--gx-danger-fg)' }}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {pages.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: 'var(--gx-space-9)', color: 'var(--gx-text-3)' }}>
                  No pages yet — click <strong>New page</strong> to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
