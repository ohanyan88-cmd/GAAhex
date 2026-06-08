import { useState, useMemo } from 'react'
import { Modal } from '../../components/Modal'
import { Button } from '../../primitives'
import { SearchIcon } from '../../components/icons'
import { toast } from '../../components/Toast'
import { createOrgNode, renameOrgNode, moveOrgNode, deleteOrgNode, OrgWriteError } from '../../lib/api'
import type { OrgNode } from './types'
import { toneClass } from './utils'

function selfAndDescendantIds(rootId: string, nodes: OrgNode[]): Set<string> {
  const childrenOf = new Map<string, string[]>()
  for (const n of nodes) {
    if (n.parent_id != null) {
      const arr = childrenOf.get(n.parent_id) ?? []
      arr.push(n.id)
      childrenOf.set(n.parent_id, arr)
    }
  }
  const out = new Set<string>([rootId])
  const stack = [rootId]
  while (stack.length) {
    const cur = stack.pop()!
    for (const child of childrenOf.get(cur) ?? []) {
      if (!out.has(child)) { out.add(child); stack.push(child) }
    }
  }
  return out
}

export function AddNodeModal({ token, parent, onClose, onDone }: {
  token: string; parent: OrgNode | null; onClose: () => void; onDone: () => Promise<void>
}) {
  const [type, setType] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!type.trim() || !name.trim()) { setErr('Type and name are required.'); return }
    setBusy(true); setErr('')
    try {
      await createOrgNode(token, {
        type: type.trim(),
        name: name.trim(),
        code: code.trim() || undefined,
        parent_id: parent ? parent.id : null,
      })
      toast.success(`Created "${name.trim()}"`)
      await onDone()
      onClose()
    } catch (e2) {
      setErr((e2 as Error).message || 'Failed to create node.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={parent ? `Add child to "${parent.name}"` : 'Add node'} size="sm">
      <form className="org-edit-form" onSubmit={submit}>
        {parent && (
          <label className="field-block">
            <span className="field-label">Parent</span>
            <input className="inp inp-md" value={parent.name} disabled aria-label="Parent" />
          </label>
        )}
        <label className="field-block">
          <span className="field-label">Type</span>
          <input
            className="inp inp-md" value={type} autoFocus
            onChange={(e) => setType(e.target.value)}
            placeholder="e.g. Region, Team, Department"
            aria-label="Type"
          />
        </label>
        <label className="field-block">
          <span className="field-label">Name</span>
          <input
            className="inp inp-md" value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Display name"
            aria-label="Name"
          />
        </label>
        <label className="field-block">
          <span className="field-label">Code <span className="muted">(optional)</span></span>
          <input
            className="inp inp-md" value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Defaults to a slug of the name"
            aria-label="Code"
          />
        </label>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="org-edit-foot">
          <Button variant="ghost" size="md" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" size="md"
            type="submit" disabled={busy || !type.trim() || !name.trim()}>
            {busy ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export function RenameNodeModal({ token, node, onClose, onDone }: {
  token: string; node: OrgNode; onClose: () => void; onDone: () => Promise<void>
}) {
  const [name, setName] = useState(node.name)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) { setErr('Name cannot be empty.'); return }
    setBusy(true); setErr('')
    try {
      await renameOrgNode(token, node.id, trimmed)
      toast.success('Renamed')
      await onDone()
      onClose()
    } catch (e2) {
      setErr((e2 as Error).message || 'Failed to rename node.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Rename node" size="sm">
      <form className="org-edit-form" onSubmit={submit}>
        <label className="field-block">
          <span className="field-label">Name</span>
          <input
            className="inp inp-md" value={name} autoFocus
            onChange={(e) => setName(e.target.value)}
            aria-label="Name"
          />
        </label>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="org-edit-foot">
          <Button variant="ghost" size="md" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" size="md"
            type="submit" disabled={busy || !name.trim() || name.trim() === node.name}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export function MoveNodeModal({ token, node, nodes, onClose, onDone }: {
  token: string; node: OrgNode; nodes: OrgNode[]; onClose: () => void; onDone: () => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const banned = useMemo(() => selfAndDescendantIds(node.id, nodes), [node.id, nodes])
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    return nodes
      .filter((n) => !banned.has(n.id) && n.id !== node.parent_id)
      .filter((n) => !q || n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q))
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }))
  }, [nodes, banned, node.parent_id, query])

  const rootAllowed = node.parent_id != null

  async function doMove() {
    if (target === null) return
    setBusy(true); setErr('')
    try {
      await moveOrgNode(token, node.id, target === '' ? null : target)
      toast.success(`Moved "${node.name}"`)
      await onDone()
      onClose()
    } catch (e2) {
      setErr((e2 as Error).message || 'Failed to move node.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Move "${node.name}"`} size="sm">
      <div className="org-edit-form">
        <div className="org-search org-move-search">
          <SearchIcon size={15} />
          <input
            type="text" className="org-search-input" value={query} autoFocus
            placeholder="Search a new parent…"
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search parent nodes"
          />
        </div>
        <div className="org-move-list" role="listbox" aria-label="Candidate parents">
          {rootAllowed && (!query.trim() || 'top level root'.includes(query.trim().toLowerCase())) && (
            <button
              type="button" role="option" aria-selected={target === ''}
              className={'org-move-opt' + (target === '' ? ' on' : '')}
              onClick={() => setTarget('')}
            >
              <span className="org-move-opt-name">Top level (root)</span>
              <span className="org-move-opt-path muted">no parent</span>
            </button>
          )}
          {candidates.length === 0 ? (
            <div className="org-move-empty muted">No eligible parent matches.</div>
          ) : candidates.map((n) => (
            <button
              key={n.id} type="button" role="option" aria-selected={target === n.id}
              className={'org-move-opt' + (target === n.id ? ' on' : '')}
              onClick={() => setTarget(n.id)}
            >
              <span className={`badge ${toneClass(n.type)}`}>{n.type}</span>
              <span className="org-move-opt-name">{n.name}</span>
              <span className="org-move-opt-path muted">/{n.path}/</span>
            </button>
          ))}
        </div>
        <p className="hint">A node can't move under itself or its own descendants — those are hidden.</p>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="org-edit-foot">
          <Button variant="ghost" size="md" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" size="md"
            type="button" onClick={doMove} disabled={busy || target === null}>
            {busy ? 'Moving…' : 'Move here'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export function DeleteNodeModal({ token, node, onClose, onDone }: {
  token: string; node: OrgNode; onClose: () => void; onDone: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function doDelete() {
    setBusy(true); setErr('')
    try {
      await deleteOrgNode(token, node.id)
      toast.success(`Deleted "${node.name}"`)
      await onDone()
      onClose()
    } catch (e2) {
      const msg = e2 instanceof OrgWriteError && e2.status === 409
        ? e2.message
        : (e2 as Error).message || 'Failed to delete node.'
      setErr(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Delete node" size="sm">
      <div className="org-edit-form">
        <p>Delete <strong>{node.name}</strong>? This can't be undone.</p>
        <p className="hint">A node that still has children can't be deleted — delete or move its children first.</p>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="org-edit-foot">
          <Button variant="ghost" size="md" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" size="md"
            type="button" onClick={doDelete} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
