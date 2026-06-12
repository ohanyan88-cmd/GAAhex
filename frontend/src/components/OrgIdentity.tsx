// OrgIdentity — left-side topbar chip + popover for the tenant's company identity (single-tenant;
// NOT a tenant switcher). Backed by GET/PUT /api/tenant/settings + POST /api/tenant/logo.
//
// The popover mirrors the UserMenu card (same `.user-card` markup): the company logo with inline
// camera-change / ✕-remove, plus the company name as an inline-editable field. Everything applies
// IMMEDIATELY (no Save button) — the name persists on Enter/blur, the logo on pick/remove.
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useFetch } from '../hooks/useFetch'
import { toast } from './Toast'
import { EditIcon, CloseIcon } from './icons'
import { Camera } from 'lucide-react'

import { bupload, bput } from '../lib/billing'
import { assetUrl } from '../lib/config'

interface TenantSettings {
  name: string
  currency: string | null
  logo_url: string | null
  logo_pos: string | null
}

// "Yerevan Net" → "YN", "Tenant" → "T", "" → "GX".
function initialsOf(name: string | null | undefined, fallback = 'GX'): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return fallback
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return ((parts[0][0] || '') + (parts[1][0] || '')).toUpperCase()
}

const ALLOWED_LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const MAX_LOGO_BYTES = 2 * 1024 * 1024

export default function OrgIdentity() {
  const { token } = useAuth()
  const { data: settings, refetch: reloadSettings } = useFetch<TenantSettings>('/api/tenant/settings')
  const name = settings?.name ?? ''
  const logoUrl = settings?.logo_url ?? null
  const logoPos = settings?.logo_pos ?? null
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Seed the editable name each time the card opens.
  useEffect(() => { if (open) setDraftName(name) }, [open])  // eslint-disable-line react-hooks/exhaustive-deps

  // Outside-click + Escape — same UX as the user menu.
  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Pick a logo → upload immediately (no staging, no Save), then re-fetch so the chip updates live.
  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!f || !token) return
    if (!ALLOWED_LOGO_TYPES.has(f.type)) { toast.error('Logo must be a PNG, JPEG, GIF, or WebP image'); return }
    if (f.size > MAX_LOGO_BYTES) { toast.error('Logo too large (max 2MB)'); return }
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', f)
      await bupload<{ logo_url: string }>(token, '/api/tenant/logo', form)
      reloadSettings()
      toast.success('Logo updated')
    } catch (err) {
      toast.error(`Could not upload: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  // Save the company name inline — auto-persists on Enter/blur when changed (no Save button).
  async function saveName() {
    const next = draftName.trim()
    if (!token || !next || next === name) return
    setSavingName(true)
    try {
      await bput(token, '/api/tenant/settings', { name: next })
      reloadSettings()
      toast.success('Company name updated')
    } catch (err) {
      toast.error(`Could not save name: ${(err as Error).message}`)
      setDraftName(name)  // revert on failure
    } finally {
      setSavingName(false)
    }
  }

  // Remove the logo immediately (clears logo_url + its focal point server-side).
  async function onRemove() {
    if (!token) return
    setBusy(true)
    try {
      await bput(token, '/api/tenant/settings', { logo_url: null })
      reloadSettings()
      toast.success('Logo removed')
    } catch (err) {
      toast.error(`Could not remove: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="org-wrap" ref={wrapRef}>
      <button className={'org' + (open ? ' on' : '')} onClick={() => setOpen((o) => !o)} title={name || 'Company'}>
        {logoUrl
          ? <img className="org-badge org-badge-img" src={assetUrl(logoUrl)} alt="" style={{ objectPosition: logoPos || undefined }} />
          : <span className="org-badge">{initialsOf(name)}</span>}
        <span className="org-name">{name || 'Company'}</span>
        <EditIcon size={12} className="org-edit" style={{ color: 'var(--gx-text-3)' }} />
      </button>

      {open && (
        <div className="menu fade-fast org-pop" onClick={(e) => e.stopPropagation()}>
          <div className="user-card">
            <div className="uc-pic-col">
              {logoUrl
                ? <img src={assetUrl(logoUrl)} alt="" className="uc-logo" />
                : <span className="uc-logo-ph">{initialsOf(name)}</span>}
              <div className="uc-pic-actions">
                <button type="button" className="uc-pic-btn" onClick={() => !busy && fileRef.current?.click()} title="Change logo" aria-label="Change logo" disabled={busy}>
                  <Camera size={13} />
                </button>
                {logoUrl && (
                  <button type="button" className="uc-pic-btn danger" onClick={onRemove} title="Remove logo" aria-label="Remove logo" disabled={busy}>
                    <CloseIcon size={13} />
                  </button>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*" onChange={onPick} style={{ display: 'none' }} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <input
                className="user-card-name oi-name-input"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') { setDraftName(name); e.currentTarget.blur() }
                }}
                onBlur={saveName}
                disabled={savingName}
                placeholder="Company name"
                aria-label="Company name"
                spellCheck={false}
              />
              <div className="user-card-email mono">{settings?.currency || '—'}</div>
              <div className="user-card-meta"><span>Company workspace</span></div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
