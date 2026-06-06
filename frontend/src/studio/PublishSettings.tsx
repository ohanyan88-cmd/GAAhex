// GAAhex Studio — Publish Settings pane.
// Extracted from StudioRichPanes.tsx. Behavior unchanged.

import { Button } from '../primitives'
import { useState, useEffect } from 'react'
import { Plus, Rocket, Save } from 'lucide-react'
import { collectSnapshot } from './publishRegistry'
import { bget, bpost } from '../lib/billing'
import { timeAgo } from '../lib/time'
import { PermissionDenied, ErrorBanner, SkeletonRows } from '../components/States'
import { Sec, type StudioPage, type StudioVersion, type StudioPageDetail } from './_shared'

export function PublishSettings({ token }: { token?: string } = {}) {
  const [pages, setPages] = useState<StudioPage[]>([])
  const [loadingPages, setLoadingPages] = useState(false)
  const [pagesError, setPagesError] = useState<string | null>(null)
  const [pagesDenied, setPagesDenied] = useState(false)

  const [selectedId, setSelectedId] = useState<string>('')
  const [detail, setDetail] = useState<StudioPageDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Inline create-page form
  const [creating, setCreating] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [createSaving, setCreateSaving] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Draft save / publish
  const [savingDraft, setSavingDraft] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  const [actionErr, setActionErr] = useState<string | null>(null)

  // Load page list
  useEffect(() => {
    if (!token) return
    let alive = true
    setLoadingPages(true); setPagesError(null); setPagesDenied(false)
    bget<StudioPage[]>(token, '/api/studio/pages').then(res => {
      if (!alive) return
      if (res.status === 403) { setPagesDenied(true); setLoadingPages(false); return }
      if (!res.ok) { setPagesError(`Failed to load pages (${res.status})`); setLoadingPages(false); return }
      setPages(Array.isArray(res.data) ? res.data : [])
      setLoadingPages(false)
    }).catch((e: Error) => { if (alive) { setPagesError(e.message); setLoadingPages(false) } })
    return () => { alive = false }
  }, [token])

  // Load page detail when selection changes
  useEffect(() => {
    if (!token || !selectedId) { setDetail(null); return }
    let alive = true
    setLoadingDetail(true); setActionMsg(null); setActionErr(null)
    bget<StudioPageDetail>(token, `/api/studio/pages/${selectedId}`).then(res => {
      if (!alive) return
      setDetail(res.ok && res.data ? res.data : null)
      setLoadingDetail(false)
    }).catch(() => { if (alive) setLoadingDetail(false) })
    return () => { alive = false }
  }, [token, selectedId])

  const flash = (msg: string, isErr = false) => {
    if (isErr) { setActionErr(msg); setActionMsg(null) }
    else { setActionMsg(msg); setActionErr(null) }
    setTimeout(() => { setActionMsg(null); setActionErr(null) }, 4000)
  }

  const createPage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token || !newKey.trim() || !newLabel.trim()) return
    setCreateSaving(true); setCreateError(null)
    try {
      const created = await bpost<StudioPage>(token, '/api/studio/pages', { key: newKey.trim(), label: newLabel.trim() })
      setPages(prev => [...prev, created])
      setSelectedId(created.id)
      setCreating(false); setNewKey(''); setNewLabel('')
    } catch (e) {
      setCreateError((e as Error).message || 'Failed to create page')
    } finally {
      setCreateSaving(false)
    }
  }

  const saveDraft = async () => {
    if (!token || !selectedId || savingDraft) return
    setSavingDraft(true); setActionErr(null)
    try {
      const snapshot = collectSnapshot()
      const ver = await bpost<StudioVersion>(token, `/api/studio/pages/${selectedId}/versions`, {
        snapshot,
      })
      setDetail(prev => prev ? { ...prev, version: ver } : prev)
      flash(`Draft v${ver.version_no} saved.`)
    } catch (e) {
      flash((e as Error).message || 'Save failed', true)
    } finally {
      setSavingDraft(false)
    }
  }

  const publish = async () => {
    if (!token || !selectedId || !detail?.version || publishing) return
    setPublishing(true); setActionErr(null)
    try {
      const ver = await bpost<StudioVersion>(token, `/api/studio/pages/${selectedId}/versions/${detail.version.id}/publish`)
      setDetail(prev => prev ? { ...prev, version: ver } : prev)
      flash(`Published as v${ver.version_no}.`)
    } catch (e) {
      flash((e as Error).message || 'Publish failed', true)
    } finally {
      setPublishing(false)
    }
  }

  // "Publish now" is enabled when there's a draft version that isn't already published.
  const canPublish = !!detail?.version && detail.version.status !== 'published'

  const header = <Sec icon={<Rocket size={15} />} title="Publish Settings" hint="page picker, save draft, publish" />

  if (!token) {
    return (
      <div>
        {header}
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--gx-text-3)', fontSize: 13 }}>
          Sign in to manage page publishing.
        </div>
      </div>
    )
  }

  if (pagesDenied) {
    return (
      <div>
        {header}
        <PermissionDenied message="You need config.manage permission to access page publish settings." />
      </div>
    )
  }

  if (pagesError) {
    return (
      <div>
        {header}
        <ErrorBanner message={pagesError} />
      </div>
    )
  }

  return (
    <div>
      {header}

      {/* Page picker */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-5)', marginBottom: 'var(--gx-space-7)', flexWrap: 'wrap' }}>
        <label className="lbl" style={{ margin: 0, flexShrink: 0 }}>Page</label>
        {loadingPages ? (
          <span className="hint" style={{ fontSize: 12 }}>Loading pages…</span>
        ) : pages.length === 0 && !creating ? (
          <span className="hint" style={{ fontSize: 12 }}>No pages yet.</span>
        ) : !creating ? (
          <select
            className="inp inp-sm"
            style={{ minWidth: 220 }}
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
          >
            <option value="">— select a page —</option>
            {pages.map(p => (
              <option key={p.id} value={p.id}>{p.label} ({p.key})</option>
            ))}
          </select>
        ) : null}
        {!creating && (
          <Button variant="ghost" size="sm"
            type="button" onClick={() => setCreating(true)}>
            <Plus size={13} />Create page
          </Button>
        )}
      </div>

      {/* Inline create-page form */}
      {creating && (
        <form
          onSubmit={createPage}
          className="card"
          style={{ padding: 'var(--gx-space-6) var(--gx-space-7)', marginBottom: 'var(--gx-space-7)', display: 'flex', gap: 'var(--gx-space-5)', flexWrap: 'wrap', alignItems: 'flex-end' }}
        >
          <label className="field" style={{ flex: '1 1 140px', margin: 0 }}>
            <span style={{ fontSize: 11 }}>Key *</span>
            <input
              className="inp inp-sm mono"
              placeholder="my-page"
              value={newKey}
              onChange={e => setNewKey(e.target.value)}
              required
            />
          </label>
          <label className="field" style={{ flex: '1 1 180px', margin: 0 }}>
            <span style={{ fontSize: 11 }}>Label *</span>
            <input
              className="inp inp-sm"
              placeholder="My Page"
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              required
            />
          </label>
          {createError && (
            <span style={{ fontSize: 'var(--gx-text-sm)', color: 'var(--gx-danger-fg)' }}>{createError}</span>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <Button variant="primary" size="sm"
            type="submit" disabled={createSaving}>
              {createSaving ? 'Creating…' : 'Create'}
            </Button>
            <Button variant="ghost" size="sm"
            type="button"
              onClick={() => { setCreating(false); setNewKey(''); setNewLabel(''); setCreateError(null) }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {/* Page detail — only when a page is selected */}
      {selectedId && (
        loadingDetail ? (
          <SkeletonRows rows={3} />
        ) : (
          <div className="card card-pad" style={{ marginBottom: 14 }}>
            {detail?.version ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 'var(--gx-space-5)', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="lbl" style={{ margin: 0 }}>Current version</span>
                  <span className="mono" style={{ fontSize: 13 }}>v{detail.version.version_no}</span>
                  <span className={`pill ${detail.version.status === 'published' ? 'pill-success' : 'pill-neutral'}`}>
                    {detail.version.status}
                  </span>
                  {detail.version.author_user_id && (
                    <span className="hint" style={{ fontSize: 11.5 }}>
                      by {detail.version.author_user_id.slice(0, 8)}
                    </span>
                  )}
                  <span className="hint" style={{ fontSize: 11.5 }}>{timeAgo(detail.version.created_at)}</span>
                </div>
              </div>
            ) : (
              <p className="hint" style={{ margin: 0, fontSize: 13 }}>No versions yet — save a draft to get started.</p>
            )}
          </div>
        )
      )}

      {/* Feedback messages */}
      {actionErr && (
        <div className="banner" style={{ marginBottom: 'var(--gx-space-4)', borderLeftColor: 'var(--gx-danger)', background: 'var(--gx-danger-soft)' }}>
          <div className="bm" style={{ color: 'var(--gx-danger-fg)' }}>{actionErr}</div>
        </div>
      )}
      {actionMsg && (
        <div className="banner" style={{ marginBottom: 'var(--gx-space-4)', borderLeftColor: 'var(--gx-success)', background: 'var(--gx-success-soft)' }}>
          <div className="bm" style={{ color: 'var(--gx-success-fg)' }}>{actionMsg}</div>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 'var(--gx-space-5)', marginTop: 4 }}>
        <Button
          variant="secondary"
          type="button"
          disabled={!selectedId || savingDraft}
          onClick={saveDraft}
        >
          <Save size={14} />{savingDraft ? 'Saving…' : 'Save draft'}
        </Button>
        <Button
          variant="primary"
          type="button"
          disabled={!canPublish || publishing}
          onClick={publish}
          title={!canPublish ? 'No unpublished draft to promote' : 'Publish this draft'}
        >
          <Rocket size={14} />{publishing ? 'Publishing…' : 'Publish now'}
        </Button>
      </div>
    </div>
  )
}
