// GAAhex Studio — Feature Flags pane.
// Extracted from StudioRichPanes.tsx. Behavior unchanged.
// Wired to GET/POST/PATCH/DELETE /api/feature-flags.
// Every toggle fires a PATCH which the backend audits to the Event log.

import React, { useState, useEffect, useCallback } from 'react'
import { Plus, ToggleLeft, Trash2 } from 'lucide-react'
import { BASE } from '../lib/billing'
import { ErrorBanner, EmptyState, SkeletonRows } from '../components/States'
import { Sec } from './_shared'

interface FlagRow {
  id: string
  key: string
  label: string
  enabled: boolean
  role_scope: string | null
}

export function FeatureFlagsPane({ token }: { token?: string } = {}) {
  const [flags, setFlags]       = useState<FlagRow[]>([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [adding, setAdding]     = useState(false)
  const [newKey, setNewKey]     = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newScope, setNewScope] = useState('')
  const [saving, setSaving]     = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true); setError(null)
    try {
      const r = await fetch(`${BASE}/api/feature-flags`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setFlags(await r.json())
    } catch (e) {
      setError((e as Error).message || 'Failed to load flags')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const toggle = async (flag: FlagRow) => {
    if (!token) return
    const optimistic = flags.map(f => f.id === flag.id ? { ...f, enabled: !f.enabled } : f)
    setFlags(optimistic)
    try {
      const r = await fetch(`${BASE}/api/feature-flags/${flag.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !flag.enabled }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const updated: FlagRow = await r.json()
      setFlags(prev => prev.map(f => f.id === updated.id ? updated : f))
    } catch {
      setFlags(flags)  // revert
    }
  }

  const submitNew = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token || !newKey.trim() || !newLabel.trim()) return
    setSaving(true)
    try {
      const r = await fetch(`${BASE}/api/feature-flags`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: newKey.trim(),
          label: newLabel.trim(),
          role_scope: newScope.trim() || null,
        }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const created: FlagRow = await r.json()
      setFlags(prev => [...prev, created].sort((a, b) => a.key.localeCompare(b.key)))
      setNewKey(''); setNewLabel(''); setNewScope(''); setAdding(false)
    } catch (e) {
      setError((e as Error).message || 'Failed to create flag')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (flag: FlagRow) => {
    if (!token) return
    if (!window.confirm(`Delete feature flag "${flag.key}"? This cannot be undone.`)) return
    const prev = flags
    setFlags(prev.filter(f => f.id !== flag.id))
    try {
      const r = await fetch(`${BASE}/api/feature-flags/${flag.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!r.ok && r.status !== 204) throw new Error(`HTTP ${r.status}`)
    } catch (e) {
      setFlags(prev)
      setError((e as Error).message || 'Failed to delete flag')
    }
  }

  const header = (
    <Sec
      icon={<ToggleLeft size={15} />}
      title="Feature Flags"
      hint="toggle features per tenant without a deploy"
      right={
        !adding ? (
          <button className="btn btn-primary btn-sm" type="button" onClick={() => setAdding(true)}>
            <Plus size={13} />New flag
          </button>
        ) : undefined
      }
    />
  )

  if (!token) {
    return (
      <div>
        {header}
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--gx-text-3)', fontSize: 13 }}>
          Sign in to manage feature flags.
        </div>
      </div>
    )
  }

  if (loading && flags.length === 0) {
    return (
      <div>
        {header}
        <SkeletonRows rows={4} />
      </div>
    )
  }

  if (error) {
    return (
      <div>
        {header}
        <ErrorBanner message={error} onRetry={load} />
      </div>
    )
  }

  return (
    <div>
      {header}

      {adding && (
        <form
          onSubmit={submitNew}
          className="card"
          style={{ padding: '14px 16px', marginBottom: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}
        >
          <label className="field" style={{ flex: '1 1 160px', minWidth: 140, margin: 0 }}>
            <span style={{ fontSize: 11 }}>Key *</span>
            <input
              className="inp inp-sm mono"
              placeholder="new-dashboard"
              value={newKey}
              onChange={e => setNewKey(e.target.value)}
              required
            />
          </label>
          <label className="field" style={{ flex: '1 1 200px', minWidth: 160, margin: 0 }}>
            <span style={{ fontSize: 11 }}>Label *</span>
            <input
              className="inp inp-sm"
              placeholder="New Dashboard"
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              required
            />
          </label>
          <label className="field" style={{ flex: '1 1 140px', minWidth: 120, margin: 0 }}>
            <span style={{ fontSize: 11 }}>Role scope</span>
            <input
              className="inp inp-sm mono"
              placeholder="super_admin"
              value={newScope}
              onChange={e => setNewScope(e.target.value)}
            />
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Create'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => { setAdding(false); setNewKey(''); setNewLabel(''); setNewScope('') }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {flags.length === 0 ? (
        <EmptyState
          title="No feature flags"
          message="Click New flag to create your first feature flag."
        />
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="grid">
            <thead>
              <tr>
                <th>Key</th>
                <th>Label</th>
                <th style={{ textAlign: 'center' }}>Enabled</th>
                <th>Role scope</th>
                <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {flags.map(flag => (
                <tr key={flag.id} style={{ cursor: 'default' }}>
                  <td className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{flag.key}</td>
                  <td style={{ fontSize: 13 }}>{flag.label}</td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      onClick={() => toggle(flag)}
                      className={'gx-toggle' + (flag.enabled ? ' on' : '')}
                      type="button"
                      aria-label={flag.enabled ? 'Disable flag' : 'Enable flag'}
                      title={flag.enabled ? 'Click to disable' : 'Click to enable'}
                    >
                      <span className="knob" />
                    </button>
                  </td>
                  <td>
                    {flag.role_scope ? (
                      <span className="pill pill-info" style={{ fontSize: 11 }}>{flag.role_scope}</span>
                    ) : (
                      <span className="hint" style={{ fontSize: 12 }}>—</span>
                    )}
                  </td>
                  <td className="actions-col">
                    <button
                      className="btn btn-ghost btn-sm btn-icon"
                      type="button"
                      title="Delete flag"
                      aria-label={`Delete flag ${flag.key}`}
                      onClick={() => remove(flag)}
                      style={{ color: 'var(--gx-danger-fg)' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
