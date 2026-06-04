// GAAhex Studio — Security → Users pane.
//
// Real RBAC management: list users in the tenant, create new users, edit
// fields, soft-delete, and bind/unbind role assignments (role + org node).
// 100% backend-wired — every control performs a real action. 403 from any
// endpoint surfaces PermissionDenied (the server is the authority; the
// frontend never gates on its own).
//
// Endpoints used:
//   GET    /api/users                    list users + their assignments
//   POST   /api/users                    create user            (config.manage)
//   PATCH  /api/users/{id}               update user            (config.manage)
//   DELETE /api/users/{id}               soft-delete            (config.manage)
//   GET    /api/roles                    list roles for picker  (config.manage)
//   GET    /org-tree                     list org nodes (public)
//   POST   /api/assignments              bind role+node         (config.manage)
//   DELETE /api/assignments/{id}         unbind                 (config.manage)
//
// NO emoji. NO raw hex. Inline lucide-react icons via ../components/icons.

import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  LoadingState, EmptyState, ErrorBanner, PermissionDenied,
} from '../components/States'
import {
  UsersIcon, PlusIcon, CloseIcon, CheckIcon, EditIcon, TrashIcon,
  MailIcon, BuildingIcon, ShieldIcon, UserIcon,
} from '../components/icons'

import { BASE } from '../lib/config'
import { authH } from '../lib/billing'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type OrgNode = { id: string; type: string; name: string; code: string | null; path: string; parent_id: string | null }
type Role = { id: string; key: string; label: string; permissions: string[] }
type Assignment = {
  id: string
  role_id: string
  role_key: string
  role_label: string
  node_id: string
  node_code: string | null
  node_name: string
  node_path: string
}
type User = {
  id: string
  name: string
  email: string
  primary_node_id: string | null
  status: string
  avatar_url: string | null
  assignments: Assignment[]
}

class FetchError extends Error {
  status: number
  constructor(msg: string, status: number) { super(msg); this.status = status }
}

async function jreq<T = unknown>(token: string, path: string, opts: RequestInit = {}): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...authH(token), ...(opts.headers ?? {}) },
  })
  if (r.status === 204) return null as T
  const body = await r.json().catch(() => ({ detail: 'Error' }))
  if (!r.ok) throw new FetchError((body as { detail?: string }).detail || `HTTP ${r.status}`, r.status)
  return body as T
}

// /org-tree is public — no auth header needed (the endpoint sits outside /api).
async function jget_public<T = unknown>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`)
  const body = await r.json().catch(() => ({ detail: 'Error' }))
  if (!r.ok) throw new FetchError((body as { detail?: string }).detail || `HTTP ${r.status}`, r.status)
  return body as T
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function UsersPane({ token }: { token: string }) {
  const [users, setUsers] = useState<User[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [nodes, setNodes] = useState<OrgNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [denied, setDenied] = useState(false)

  // Selected user → drawer.
  const [selected, setSelected] = useState<User | null>(null)

  // Create-user form.
  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createEmail, setCreateEmail] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  const [createNodeId, setCreateNodeId] = useState('')
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState('')

  // Edit-user form (inside drawer).
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editNodeId, setEditNodeId] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [editErr, setEditErr] = useState('')
  const [editMsg, setEditMsg] = useState('')

  // Delete confirmation.
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteErr, setDeleteErr] = useState('')

  // Add-assignment form (inside drawer).
  const [showAddRole, setShowAddRole] = useState(false)
  const [addRoleId, setAddRoleId] = useState('')
  const [addNodeId, setAddNodeId] = useState('')
  const [addingRole, setAddingRole] = useState(false)
  const [addRoleErr, setAddRoleErr] = useState('')

  // Remove-assignment confirmation (per-chip).
  const [removeAssignId, setRemoveAssignId] = useState<string | null>(null)
  const [removingAssign, setRemovingAssign] = useState(false)
  const [removeAssignErr, setRemoveAssignErr] = useState('')

  // ---------- data load ----------
  const load = useCallback(() => {
    let alive = true
    setLoading(true); setError(''); setDenied(false)
    Promise.all([
      jreq<User[]>(token, '/api/users'),
      jreq<Role[]>(token, '/api/roles'),
      jget_public<{ nodes: OrgNode[] }>('/org-tree'),
    ])
      .then(([u, r, t]) => {
        if (!alive) return
        setUsers(Array.isArray(u) ? u : [])
        setRoles(Array.isArray(r) ? r : [])
        setNodes(t.nodes ?? [])
      })
      .catch((e) => {
        if (!alive) return
        if (e instanceof FetchError && e.status === 403) setDenied(true)
        else setError((e as Error).message)
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [token])

  useEffect(() => { return load() }, [load])

  // Node lookup (id → label).
  const nodeById = useMemo(() => {
    const m: Record<string, OrgNode> = {}
    for (const n of nodes) m[n.id] = n
    return m
  }, [nodes])

  const nodeLabel = (id: string | null): string => {
    if (!id) return '—'
    const n = nodeById[id]
    return n ? `${n.name}` : '—'
  }

  // ---------- selection / drawer ----------
  function selectUser(u: User) {
    setSelected(u)
    setEditing(false)
    setEditErr(''); setEditMsg('')
    setEditName(u.name); setEditEmail(u.email)
    setEditNodeId(u.primary_node_id ?? '')
    setEditPassword('')
    setShowAddRole(false)
    setAddRoleErr(''); setRemoveAssignErr('')
  }

  // After any user write, refresh the row and the selection.
  function applyUserUpdate(updated: User) {
    setUsers((prev) => prev.map((u) => u.id === updated.id ? updated : u))
    setSelected((prev) => (prev && prev.id === updated.id) ? updated : prev)
  }

  // ---------- create ----------
  async function createUser(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true); setCreateErr('')
    try {
      const created = await jreq<User>(token, '/api/users', {
        method: 'POST',
        body: JSON.stringify({
          name: createName.trim(),
          email: createEmail.trim(),
          password: createPassword,
          primary_node_id: createNodeId || null,
        }),
      })
      setUsers((prev) => [...prev, created].sort((a, b) =>
        (a.name || '').localeCompare(b.name || '') || a.email.localeCompare(b.email)))
      setCreateName(''); setCreateEmail(''); setCreatePassword(''); setCreateNodeId('')
      setShowCreate(false)
    } catch (e) {
      setCreateErr((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  // ---------- edit ----------
  async function saveEdit() {
    if (!selected) return
    setSavingEdit(true); setEditErr(''); setEditMsg('')
    const body: Record<string, string | null> = {}
    if (editName.trim() !== selected.name) body.name = editName.trim()
    if (editEmail.trim() !== selected.email) body.email = editEmail.trim()
    if ((editNodeId || null) !== (selected.primary_node_id || null)) body.primary_node_id = editNodeId || null
    if (editPassword) body.password = editPassword
    if (Object.keys(body).length === 0) {
      setEditMsg('No changes.')
      setSavingEdit(false)
      return
    }
    try {
      const updated = await jreq<User>(token, `/api/users/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      applyUserUpdate(updated)
      setEditPassword('')
      setEditing(false)
      setEditMsg('Saved.')
    } catch (e) {
      setEditErr((e as Error).message)
    } finally {
      setSavingEdit(false)
    }
  }

  // ---------- delete ----------
  async function deleteUser(id: string) {
    setDeleting(true); setDeleteErr('')
    try {
      const result = await jreq<{ status: string }>(token, `/api/users/${id}`, { method: 'DELETE' })
      // Soft-delete: status flips to inactive. Reflect locally; keep row in list so
      // operator sees the state, but the drawer drops back to closed for clarity.
      setUsers((prev) => prev.map((u) => u.id === id ? { ...u, status: result.status } : u))
      if (selected?.id === id) setSelected(null)
      setDeleteId(null)
    } catch (e) {
      setDeleteErr((e as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  // ---------- assignment add / remove ----------
  async function addAssignment(e: React.FormEvent) {
    e.preventDefault()
    if (!selected) return
    setAddingRole(true); setAddRoleErr('')
    try {
      await jreq(token, '/api/assignments', {
        method: 'POST',
        body: JSON.stringify({
          user_id: selected.id,
          role_id: addRoleId,
          node_id: addNodeId,
        }),
      })
      // Re-fetch the user so chips reflect the new assignment row + id.
      const fresh = await jreq<User>(token, `/api/users/${selected.id}`)
      applyUserUpdate(fresh)
      setAddRoleId(''); setAddNodeId('')
      setShowAddRole(false)
    } catch (e) {
      setAddRoleErr((e as Error).message)
    } finally {
      setAddingRole(false)
    }
  }

  async function removeAssignment(assignmentId: string) {
    if (!selected) return
    setRemovingAssign(true); setRemoveAssignErr('')
    try {
      await jreq(token, `/api/assignments/${assignmentId}`, { method: 'DELETE' })
      const fresh = await jreq<User>(token, `/api/users/${selected.id}`)
      applyUserUpdate(fresh)
      setRemoveAssignId(null)
    } catch (e) {
      setRemoveAssignErr((e as Error).message)
    } finally {
      setRemovingAssign(false)
    }
  }

  // ---------- render ----------
  if (loading) return <LoadingState />
  if (denied) return <PermissionDenied message="You don't have permission to manage users." />
  if (error) return <ErrorBanner message={error} onRetry={load} />

  return (
    <div>
      {/* Header row */}
      <div className="row" style={{ marginBottom: 18 }}>
        <div>
          <h3 style={{ margin: '0 0 4px' }}>Users</h3>
          <p className="hint" style={{ margin: 0 }}>
            Manage tenant users and bind roles at specific org nodes.
          </p>
        </div>
        <span className="spacer" />
        <button
          className="btn btn-primary btn-sm"
          onClick={() => { setShowCreate(true); setCreateErr('') }}
        >
          <PlusIcon size={13} /> Add user
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <form
          onSubmit={createUser}
          style={{
            background: 'var(--gx-surface-2)',
            border: '1px solid var(--gx-border)',
            borderRadius: 6,
            padding: '14px 16px',
            marginBottom: 16,
          }}
        >
          <div className="section-head" style={{ marginTop: 0 }}>
            <PlusIcon size={14} className="section-icon" /> New user
          </div>
          {createErr && <ErrorBanner message={createErr} />}
          <div className="rec-form" style={{ marginBottom: 12 }}>
            <label className="field">
              <span>Name</span>
              <input
                className="inp inp-md"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="Anna Sargsyan"
                required
              />
            </label>
            <label className="field">
              <span>Email</span>
              <input
                className="inp inp-md"
                type="email"
                value={createEmail}
                onChange={(e) => setCreateEmail(e.target.value)}
                placeholder="anna@demo.isp"
                required
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                className="inp inp-md"
                type="password"
                value={createPassword}
                onChange={(e) => setCreatePassword(e.target.value)}
                placeholder="Initial password"
                required
                minLength={8}
              />
            </label>
            <label className="field">
              <span>Primary node (optional)</span>
              <select
                className="inp inp-md"
                value={createNodeId}
                onChange={(e) => setCreateNodeId(e.target.value)}
              >
                <option value="">— none —</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name} ({n.type})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="row">
            <button type="submit" className="btn btn-accent btn-sm" disabled={creating}>
              <CheckIcon size={13} /> {creating ? 'Creating…' : 'Create user'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => { setShowCreate(false); setCreateErr('') }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {deleteErr && <ErrorBanner message={deleteErr} />}

      {/* Users table */}
      {users.length === 0 ? (
        <EmptyState
          icon={<UsersIcon size={40} />}
          title="No users yet."
          message="Create a user to get started."
        />
      ) : (
        <div className="grid-wrap" style={{ marginBottom: 24 }}>
          <table className="grid studio">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Primary node</th>
                <th scope="col">Roles</th>
                <th scope="col">Status</th>
                <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  style={{
                    cursor: 'pointer',
                    // D18: selected user row = azure-soft (interactive family, active selected state)
                    background: selected?.id === u.id ? 'var(--gx-interactive-soft)' : undefined,
                    opacity: u.status === 'inactive' ? 0.6 : 1,
                  }}
                  onClick={() => selectUser(u)}
                >
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <UserIcon size={13} style={{ color: 'var(--gx-text-3)' }} />
                      {u.name}
                    </span>
                  </td>
                  <td><code className="mono">{u.email}</code></td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--gx-text-2)', fontSize: 13 }}>
                      <BuildingIcon size={12} />
                      {nodeLabel(u.primary_node_id)}
                    </span>
                  </td>
                  <td>
                    {u.assignments.length === 0 ? (
                      <span style={{ color: 'var(--gx-text-3)', fontSize: 12 }}>—</span>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {u.assignments.map((a) => (
                          <span
                            key={a.id}
                            style={{
                              background: 'var(--gx-surface-2)',
                              border: '1px solid var(--gx-border)',
                              borderRadius: 4,
                              padding: '1px 6px',
                              fontSize: 11,
                              color: 'var(--gx-text-2)',
                            }}
                            title={`${a.role_label} @ ${a.node_path}`}
                          >
                            {a.role_label}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>
                    <span style={{
                      fontSize: 11,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: u.status === 'active' ? 'var(--gx-success)' : 'var(--gx-text-3)',
                    }}>
                      {u.status}
                    </span>
                  </td>
                  <td className="actions-col">
                    <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="btn btn-ghost btn-sm"
                        title="View / edit"
                        onClick={() => selectUser(u)}
                      >
                        <EditIcon size={13} />
                      </button>
                      {deleteId === u.id ? (
                        <>
                          <button
                            className="btn btn-sm"
                            style={{ color: 'var(--gx-danger)' }}
                            onClick={() => deleteUser(u.id)}
                            disabled={deleting}
                          >
                            {deleting ? 'Deactivating…' : 'Confirm'}
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => setDeleteId(null)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          className="btn btn-ghost btn-sm"
                          title="Deactivate user"
                          onClick={() => setDeleteId(u.id)}
                          disabled={u.status === 'inactive'}
                        >
                          <TrashIcon size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail drawer */}
      {selected && (
        <div
          style={{
            background: 'var(--gx-surface-1)',
            border: '1px solid var(--gx-border)',
            borderRadius: 6,
            padding: '16px 18px',
            marginTop: 8,
          }}
        >
          <div className="section-head">
            <UserIcon size={14} className="section-icon" />
            User detail — <strong style={{ marginLeft: 4 }}>{selected.name}</strong>
            <span className="spacer" />
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setSelected(null)}
              title="Close"
            >
              <CloseIcon size={13} />
            </button>
          </div>

          {/* Identity card */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div style={{ fontSize: 13 }}>
              <div style={{ color: 'var(--gx-text-3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Email</div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <MailIcon size={13} style={{ color: 'var(--gx-text-3)' }} />
                <code className="mono">{selected.email}</code>
              </div>
            </div>
            <div style={{ fontSize: 13 }}>
              <div style={{ color: 'var(--gx-text-3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Primary node</div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <BuildingIcon size={13} style={{ color: 'var(--gx-text-3)' }} />
                {nodeLabel(selected.primary_node_id)}
              </div>
            </div>
          </div>

          {/* Edit user */}
          {editing ? (
            <div
              style={{
                background: 'var(--gx-surface-2)',
                border: '1px solid var(--gx-border)',
                borderRadius: 6,
                padding: '12px 14px',
                marginBottom: 16,
              }}
            >
              {editErr && <ErrorBanner message={editErr} />}
              <div className="rec-form" style={{ marginBottom: 10 }}>
                <label className="field">
                  <span>Name</span>
                  <input
                    className="inp inp-md"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Email</span>
                  <input
                    className="inp inp-md"
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Primary node</span>
                  <select
                    className="inp inp-md"
                    value={editNodeId}
                    onChange={(e) => setEditNodeId(e.target.value)}
                  >
                    <option value="">— none —</option>
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name} ({n.type})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>New password (leave blank to keep)</span>
                  <input
                    className="inp inp-md"
                    type="password"
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    minLength={8}
                  />
                </label>
              </div>
              <div className="row">
                <button className="btn btn-accent btn-sm" onClick={saveEdit} disabled={savingEdit}>
                  <CheckIcon size={13} /> {savingEdit ? 'Saving…' : 'Save'}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => { setEditing(false); setEditErr('') }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="row" style={{ marginBottom: 16 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
                <EditIcon size={13} /> Edit user
              </button>
              {editMsg && <span style={{ marginLeft: 8, color: 'var(--gx-success)', fontSize: 12 }}>{editMsg}</span>}
            </div>
          )}

          {/* Assignments */}
          <div className="section-head" style={{ marginTop: 4 }}>
            <ShieldIcon size={14} className="section-icon" />
            Roles
            <span className="spacer" />
            {!showAddRole && (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  setShowAddRole(true); setAddRoleErr('')
                  setAddRoleId(roles[0]?.id ?? '')
                  setAddNodeId(selected.primary_node_id ?? nodes[0]?.id ?? '')
                }}
                disabled={roles.length === 0 || nodes.length === 0}
              >
                <PlusIcon size={13} /> Add role
              </button>
            )}
          </div>

          {removeAssignErr && <ErrorBanner message={removeAssignErr} />}

          {showAddRole && (
            <form
              onSubmit={addAssignment}
              style={{
                background: 'var(--gx-surface-2)',
                border: '1px solid var(--gx-border)',
                borderRadius: 6,
                padding: '12px 14px',
                marginBottom: 12,
              }}
            >
              {addRoleErr && <ErrorBanner message={addRoleErr} />}
              <div className="rec-form" style={{ marginBottom: 10 }}>
                <label className="field">
                  <span>Role</span>
                  <select
                    className="inp inp-md"
                    value={addRoleId}
                    onChange={(e) => setAddRoleId(e.target.value)}
                    required
                  >
                    <option value="">— select —</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>{r.label} ({r.key})</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Scope (org node)</span>
                  <select
                    className="inp inp-md"
                    value={addNodeId}
                    onChange={(e) => setAddNodeId(e.target.value)}
                    required
                  >
                    <option value="">— select —</option>
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name} ({n.type})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="row">
                <button type="submit" className="btn btn-accent btn-sm" disabled={addingRole}>
                  <CheckIcon size={13} /> {addingRole ? 'Adding…' : 'Add role'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => { setShowAddRole(false); setAddRoleErr('') }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {selected.assignments.length === 0 ? (
            <p className="hint" style={{ marginTop: 0 }}>
              No roles assigned. This user has no effective permissions until a role is bound.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {selected.assignments.map((a) => (
                <div
                  key={a.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    border: '1px solid var(--gx-border)',
                    background: 'var(--gx-surface-2)',
                    borderRadius: 6,
                    padding: '6px 10px',
                  }}
                >
                  <ShieldIcon size={13} style={{ color: 'var(--gx-text-3)' }} />
                  <strong style={{ fontSize: 13 }}>{a.role_label}</strong>
                  <code className="mono" style={{ fontSize: 11, color: 'var(--gx-text-3)' }}>{a.role_key}</code>
                  <span style={{ color: 'var(--gx-text-3)', fontSize: 12 }}>at</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                    <BuildingIcon size={12} style={{ color: 'var(--gx-text-3)' }} />
                    {a.node_name}
                    <code className="mono" style={{ fontSize: 10, color: 'var(--gx-text-3)' }}>{a.node_path}</code>
                  </span>
                  <span className="spacer" />
                  {removeAssignId === a.id ? (
                    <>
                      <button
                        className="btn btn-sm"
                        style={{ color: 'var(--gx-danger)' }}
                        onClick={() => removeAssignment(a.id)}
                        disabled={removingAssign}
                      >
                        {removingAssign ? 'Removing…' : 'Confirm'}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setRemoveAssignId(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setRemoveAssignId(a.id)}
                      title="Remove role assignment"
                    >
                      <TrashIcon size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
