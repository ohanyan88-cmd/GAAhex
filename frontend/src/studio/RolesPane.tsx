import { useEffect, useState, useCallback } from 'react'
import { LoadingState, EmptyState, ErrorBanner, PermissionDenied } from '../components/States'
import {
  LockIcon, PlusIcon, CloseIcon, CheckIcon, EditIcon, TrashIcon, InfoIcon,
} from '../components/icons'

const BASE = 'http://127.0.0.1:8099'
const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Role = { id: number; key: string; label: string; permissions: string[] }
type Permission = { key: string; label: string; group: string }

class FetchError extends Error {
  status: number
  constructor(msg: string, status: number) { super(msg); this.status = status }
}

async function jreq(token: string, path: string, opts: RequestInit = {}) {
  const r = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...authH(token), ...(opts.headers ?? {}) },
  })
  if (r.status === 204) return null
  const body = await r.json().catch(() => ({ detail: 'Error' }))
  if (!r.ok) throw new FetchError(body.detail || `HTTP ${r.status}`, r.status)
  return body
}

// ---------------------------------------------------------------------------
// Group permissions by their `group` field
// ---------------------------------------------------------------------------
function groupPerms(perms: Permission[]): Record<string, Permission[]> {
  const out: Record<string, Permission[]> = {}
  for (const p of perms) {
    if (!out[p.group]) out[p.group] = []
    out[p.group].push(p)
  }
  return out
}

// ---------------------------------------------------------------------------
// Main pane
// ---------------------------------------------------------------------------
export default function RolesPane({ token }: { token: string }) {
  const [roles, setRoles] = useState<Role[]>([])
  const [allPerms, setAllPerms] = useState<Permission[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [denied, setDenied] = useState(false)

  // Selected role for permission editing
  const [selected, setSelected] = useState<Role | null>(null)
  const [editPerms, setEditPerms] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [saveErr, setSaveErr] = useState('')

  // Create-role form
  const [showCreate, setShowCreate] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState('')

  // Delete confirmation
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteErr, setDeleteErr] = useState('')

  const load = useCallback(() => {
    let alive = true
    setLoading(true); setError(''); setDenied(false)
    Promise.all([
      jreq(token, '/api/roles'),
      jreq(token, '/api/permissions'),
    ])
      .then(([r, p]) => {
        if (!alive) return
        setRoles(Array.isArray(r) ? r : [])
        setAllPerms(Array.isArray(p) ? p : [])
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

  // When a role is selected, seed editPerms from its current permissions
  function selectRole(role: Role) {
    setSelected(role)
    setEditPerms(new Set(role.permissions))
    setSaveMsg(''); setSaveErr('')
  }

  function togglePerm(key: string) {
    setEditPerms((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  async function savePerms() {
    if (!selected) return
    setSaving(true); setSaveErr(''); setSaveMsg('')
    try {
      await jreq(token, `/api/roles/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ permissions: Array.from(editPerms) }),
      })
      setRoles((prev) => prev.map((r) => r.id === selected.id
        ? { ...r, permissions: Array.from(editPerms) } : r))
      setSelected((prev) => prev ? { ...prev, permissions: Array.from(editPerms) } : prev)
      setSaveMsg('Permissions saved.')
    } catch (e) {
      setSaveErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function createRole(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true); setCreateErr('')
    try {
      const created = await jreq(token, '/api/roles', {
        method: 'POST',
        body: JSON.stringify({ key: newKey.trim(), label: newLabel.trim(), permissions: [] }),
      })
      setRoles((prev) => [...prev, created])
      setNewKey(''); setNewLabel(''); setShowCreate(false)
    } catch (e) {
      setCreateErr((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  async function deleteRole(id: number) {
    setDeleting(true); setDeleteErr('')
    try {
      await jreq(token, `/api/roles/${id}`, { method: 'DELETE' })
      setRoles((prev) => prev.filter((r) => r.id !== id))
      if (selected?.id === id) setSelected(null)
      setDeleteId(null)
    } catch (e) {
      setDeleteErr((e as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  if (loading) return <LoadingState />
  if (denied) return <PermissionDenied message="You don't have permission to manage roles." />
  if (error) return <ErrorBanner message={error} onRetry={load} />

  const grouped = groupPerms(allPerms)

  return (
    <div>
      {/* Header row */}
      <div className="row" style={{ marginBottom: 18 }}>
        <div>
          <h3 style={{ margin: '0 0 4px' }}>Roles and Permissions</h3>
          <p className="hint" style={{ margin: 0 }}>
            Define roles and configure which permissions each role carries.
          </p>
        </div>
        <span className="spacer" />
        <button
          className="btn btn-primary btn-sm"
          onClick={() => { setShowCreate(true); setCreateErr('') }}
        >
          <PlusIcon size={13} /> New role
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <form
          onSubmit={createRole}
          style={{ background: 'var(--gx-surface-2)', border: '1px solid var(--gx-border)', borderRadius: 6, padding: '14px 16px', marginBottom: 16 }}
        >
          <div className="section-head" style={{ marginTop: 0 }}>
            <PlusIcon size={14} className="section-icon" /> New role
          </div>
          {createErr && <ErrorBanner message={createErr} />}
          <div className="rec-form" style={{ marginBottom: 12 }}>
            <label className="field">
              <span>Key (snake_case)</span>
              <input className="inp inp-md" value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="billing_agent" required />
            </label>
            <label className="field">
              <span>Label</span>
              <input className="inp inp-md" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Billing Agent" required />
            </label>
          </div>
          <div className="row">
            <button type="submit" className="btn btn-accent btn-sm" disabled={creating}>
              <CheckIcon size={13} /> {creating ? 'Creating…' : 'Create role'}
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

      {/* Delete error banner */}
      {deleteErr && <ErrorBanner message={deleteErr} />}

      {/* Roles table */}
      {roles.length === 0 ? (
        <EmptyState
          icon={<LockIcon size={40} />}
          title="No roles defined yet."
          message="Create a role to start managing permissions."
        />
      ) : (
        <div className="grid-wrap" style={{ marginBottom: 24 }}>
          <table className="grid studio">
            <thead>
              <tr>
                <th scope="col">Key</th>
                <th scope="col">Label</th>
                <th scope="col">Permissions</th>
                <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr
                  key={role.id}
                  style={{ cursor: 'pointer', background: selected?.id === role.id ? 'var(--gx-primary-soft)' : undefined }}
                  onClick={() => selectRole(role)}
                >
                  <td><code className="mono">{role.key}</code></td>
                  <td>{role.label}</td>
                  <td>
                    <span style={{ color: 'var(--gx-text-3)', fontSize: 12 }}>
                      {role.permissions.length} permission{role.permissions.length !== 1 ? 's' : ''}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="btn btn-ghost btn-sm"
                        title="Edit permissions"
                        onClick={() => selectRole(role)}
                      >
                        <EditIcon size={13} />
                      </button>
                      {deleteId === role.id ? (
                        <>
                          <button
                            className="btn btn-sm"
                            style={{ color: 'var(--gx-danger)' }}
                            onClick={() => deleteRole(role.id)}
                            disabled={deleting}
                          >
                            {deleting ? 'Deleting…' : 'Confirm'}
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
                          title="Delete role"
                          onClick={() => setDeleteId(role.id)}
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

      {/* Permission matrix for selected role */}
      {selected && (
        <div>
          <div className="section-head">
            <LockIcon size={14} className="section-icon" />
            Permissions for <strong style={{ marginLeft: 4 }}>{selected.label}</strong>
            <span className="spacer" />
            <button
              className="btn btn-accent btn-sm"
              onClick={savePerms}
              disabled={saving}
            >
              <CheckIcon size={13} /> {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setSelected(null)}
            >
              <CloseIcon size={13} />
            </button>
          </div>

          {saveErr && <ErrorBanner message={saveErr} />}
          {saveMsg && (
            <div className="error-banner" style={{ marginBottom: 12, borderLeftColor: 'var(--gx-success)', background: 'var(--gx-success-soft)' }}>
              <CheckIcon size={14} style={{ color: 'var(--gx-success)', flexShrink: 0 }} />
              <span className="error-banner-msg">{saveMsg}</span>
            </div>
          )}

          {allPerms.length === 0 ? (
            <p className="hint">No permissions defined. They are created automatically when entities are added.</p>
          ) : (
            Object.entries(grouped).map(([group, perms]) => (
              <div key={group} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--gx-text-3)', marginBottom: 6 }}>
                  {group}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 24px' }}>
                  {perms.map((p) => (
                    <label key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={editPerms.has(p.key)}
                        onChange={() => togglePerm(p.key)}
                      />
                      <span>{p.label}</span>
                      <code className="mono" style={{ fontSize: 10, color: 'var(--gx-text-3)' }}>{p.key}</code>
                    </label>
                  ))}
                </div>
              </div>
            ))
          )}

          <div className="error-banner" style={{ marginTop: 8, marginBottom: 4, borderLeftColor: 'var(--gx-info)', background: 'var(--gx-info-soft)' }}>
            <InfoIcon size={14} style={{ color: 'var(--gx-info)', flexShrink: 0 }} />
            <span className="error-banner-msg">
              Changes take effect on next login. Users with this role will see updated capabilities immediately after re-authenticating.
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
