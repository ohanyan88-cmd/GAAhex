// GAAhex Studio — Permissions pane.
// Extracted from StudioRichPanes.tsx. Behavior unchanged.
// Wired to the RBAC kernel: GET /api/roles, GET /api/permissions, PATCH /api/roles/{id}.
// Rows = "scopes" derived from permission registry (entity prefix from `entity.action`
// keys, falling back to the permission's `group` field). Cells show None/View/Edit
// based on whether the role's permission list contains any read-type or write-type
// permission for that scope. Cell click cycles + PATCHes the full new permission list
// optimistically; failures revert + raise a toast.

import { useState, useEffect } from 'react'
import { Lock } from 'lucide-react'
import { bget, bpatch } from '../lib/billing'
import { Sec } from './_shared'

type PermLevel = 'none' | 'view' | 'edit'
type PermDef   = { key: string; label: string; group: string }
type RoleRow   = { id: string; key: string; label: string; permissions: string[] }

const READ_VERBS  = new Set(['view', 'read', 'list', 'get'])
const WRITE_VERBS = new Set(['edit', 'create', 'update', 'delete', 'manage', 'write', 'admin', 'configure'])

// A "scope" is one row of the matrix — derived from the permission registry.
type Scope = {
  key:  string         // canonical scope key (e.g. "customer" or group name)
  label: string        // human label
  read:  string[]      // permission keys classified as read for this scope
  write: string[]      // permission keys classified as write for this scope
  all:   string[]      // union — used when clearing a cell back to None
}

function humanize(s: string): string {
  if (!s) return s
  return s.replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function buildScopes(perms: PermDef[]): Scope[] {
  const byKey = new Map<string, Scope>()
  for (const p of perms) {
    // Prefer `entity.action` shape — split on the first dot.
    const dot = p.key.indexOf('.')
    let scopeKey: string
    let action: string
    if (dot > 0) {
      scopeKey = p.key.slice(0, dot)
      action = p.key.slice(dot + 1).toLowerCase()
    } else {
      scopeKey = p.group || p.key
      action = p.key.toLowerCase()
    }
    let s = byKey.get(scopeKey)
    if (!s) {
      s = { key: scopeKey, label: humanize(scopeKey), read: [], write: [], all: [] }
      byKey.set(scopeKey, s)
    }
    s.all.push(p.key)
    if (WRITE_VERBS.has(action)) s.write.push(p.key)
    else if (READ_VERBS.has(action)) s.read.push(p.key)
    else s.read.push(p.key)   // unknown action ⇒ treat as read-tier
  }
  return Array.from(byKey.values()).sort((a, b) => a.label.localeCompare(b.label))
}

function cellLevel(role: RoleRow, scope: Scope): PermLevel {
  const set = new Set(role.permissions)
  const hasWrite = scope.write.some(k => set.has(k))
  if (hasWrite) return 'edit'
  const hasRead = scope.read.some(k => set.has(k))
  if (hasRead) return 'view'
  return 'none'
}

function nextPerms(role: RoleRow, scope: Scope, level: PermLevel): string[] {
  // Strip every permission belonging to this scope, then re-add per target level.
  const stripped = role.permissions.filter(k => !scope.all.includes(k))
  if (level === 'none') return stripped
  if (level === 'view') return [...stripped, ...scope.read]
  return [...stripped, ...scope.read, ...scope.write]   // 'edit'
}

const LEVEL_CYCLE: Record<PermLevel, PermLevel> = { none: 'view', view: 'edit', edit: 'none' }

export function Permissions({ token }: { token?: string } = {}) {
  const [roles, setRoles] = useState<RoleRow[]>([])
  const [perms, setPerms] = useState<PermDef[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // Initial load.
  useEffect(() => {
    if (!token) return
    let alive = true
    setLoading(true); setError(null)
    Promise.all([
      bget<RoleRow[]>(token, '/api/roles'),
      bget<PermDef[]>(token, '/api/permissions'),
    ])
      .then(([rRes, pRes]) => {
        if (!alive) return
        if (!rRes.ok || !pRes.ok) {
          setError(rRes.status === 403 || pRes.status === 403
            ? 'You do not have permission to view roles.'
            : `Failed to load (roles ${rRes.status}, permissions ${pRes.status})`)
          return
        }
        setRoles(Array.isArray(rRes.data) ? rRes.data : [])
        setPerms(Array.isArray(pRes.data) ? pRes.data : [])
      })
      .catch((e: Error) => { if (alive) setError(e.message || 'Failed to load') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [token])

  // Cell click: cycle level + optimistic PATCH; revert on failure.
  const cycle = async (role: RoleRow, scope: Scope) => {
    if (!token) return
    const current = cellLevel(role, scope)
    const target  = LEVEL_CYCLE[current]
    const next    = nextPerms(role, scope, target)
    const prev    = role.permissions
    // optimistic
    setRoles(rs => rs.map(r => r.id === role.id ? { ...r, permissions: next } : r))
    try {
      await bpatch(token, `/api/roles/${role.id}`, { permissions: next })
    } catch (e) {
      // revert
      setRoles(rs => rs.map(r => r.id === role.id ? { ...r, permissions: prev } : r))
      const msg = (e as Error).message || 'Save failed'
      setToast(msg)
      setTimeout(() => setToast(null), 4000)
    }
  }

  const dot = (v: PermLevel): [string, string] =>
    v === 'edit'
      ? ['Edit', 'var(--gx-success)']
      : v === 'view'
      ? ['View', 'var(--gx-warning)']
      : ['—', 'var(--gx-text-3)']

  if (!token) {
    return (
      <div>
        <Sec icon={<Lock size={15} />} title="Permissions" hint="control who can view / edit each scope" />
        <div style={{ padding: 'var(--gx-space-9) 0', textAlign: 'center', color: 'var(--gx-text-3)', fontSize: 'var(--gx-text-13)' }}>
          Sign in to manage role permissions.
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div>
        <Sec icon={<Lock size={15} />} title="Permissions" hint="control who can view / edit each scope" />
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: 'var(--gx-space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-4)' }}>
            {[0, 1, 2, 3].map(i => (
              <div key={i} style={{ height: 22, background: 'var(--gx-surface-2)', borderRadius: 'var(--gx-radius-xs)', opacity: 0.6 }} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <Sec icon={<Lock size={15} />} title="Permissions" hint="control who can view / edit each scope" />
        <div className="banner" style={{ borderLeftColor: 'var(--gx-danger)', background: 'var(--gx-danger-soft)' }}>
          <div className="bm" style={{ color: 'var(--gx-danger-fg)' }}>{error}</div>
        </div>
      </div>
    )
  }

  const scopes = buildScopes(perms)

  if (roles.length === 0 || scopes.length === 0) {
    return (
      <div>
        <Sec icon={<Lock size={15} />} title="Permissions" hint="control who can view / edit each scope" />
        <div style={{ padding: 'var(--gx-space-9) 0', textAlign: 'center', color: 'var(--gx-text-3)', fontSize: 'var(--gx-text-13)' }}>
          {roles.length === 0
            ? 'No roles defined yet. Create roles under Security → Roles.'
            : 'No permissions registered yet — they are created automatically when entities are added.'}
        </div>
      </div>
    )
  }

  return (
    <div>
      <Sec icon={<Lock size={15} />} title="Permissions" hint="control who can view / edit each scope" />
      {toast && (
        <div className="banner" style={{ marginBottom: 'var(--gx-space-4)', borderLeftColor: 'var(--gx-danger)', background: 'var(--gx-danger-soft)' }}>
          <div className="bm" style={{ color: 'var(--gx-danger-fg)' }}>{toast}</div>
        </div>
      )}
      <div className="card" style={{ overflow: 'auto' }}>
        <table className="grid">
          <thead>
            <tr>
              <th>Scope</th>
              {roles.map(r => <th key={r.id} style={{ textAlign: 'center' }}>{r.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {scopes.map(sc => (
              <tr key={sc.key} style={{ cursor: 'default' }}>
                <td style={{ fontWeight: 'var(--gx-weight-semibold)' }}>{sc.label}</td>
                {roles.map(role => {
                  const level = cellLevel(role, sc)
                  const [label, color] = dot(level)
                  return (
                    <td key={role.id} style={{ textAlign: 'center' }}>
                      <button
                        className="perm-cell"
                        type="button"
                        onClick={() => cycle(role, sc)}
                        style={{ color }}
                        title="Click to cycle None → View → Edit"
                      >
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
                        {label}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ fontSize: 'var(--gx-text-11)', marginTop: 'var(--gx-space-5)' }}>
        Click a cell to cycle None → View → Edit. Saved per-click; enforced server-side by the auth kernel.
      </p>
    </div>
  )
}
