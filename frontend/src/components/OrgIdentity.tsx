// OrgIdentity — left-side topbar chip that lets a tenant admin edit the company name + logo
// (single-tenant; this is NOT a tenant switcher). Backed by GET/PUT /api/tenant/settings,
// reading the same `name` field that powers the rest of the app and the new `logo_url` column
// (P3 migration f9ef47c3db77). Logo upload follows the avatar pattern in me.py — read the file
// with FileReader and PUT the resulting `data:image/<mime>;base64,...` URL.
//
// Mirrors the kit OrgIdentity in design-system/ui_kits/portal/Shell.jsx — same `.org`/`.org-pop`
// markup and behavior (chip → popover → save → toast). Outside-click + Escape close.
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useFetch } from '../hooks/useFetch'
import { toast } from './Toast'
import { EditIcon, CheckIcon, CloseIcon } from './icons'
import { Camera } from 'lucide-react'
import { Button } from '../primitives'  // T-P3-7

import { BASE } from '../lib/config'

interface TenantSettings {
  name: string
  logo_url: string | null
}

// "Yerevan Net" → "YN", "Tenant" → "T", "" → "GX". Matches the kit's ini() but keeps the GAAhex
// fallback the rest of the app uses for empty user names.
function initialsOf(name: string | null | undefined, fallback = 'GX'): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return fallback
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return ((parts[0][0] || '') + (parts[1][0] || '')).toUpperCase()
}

export default function OrgIdentity() {
  const { token } = useAuth()
  const { data: settings, refetch: reloadSettings } = useFetch<TenantSettings>('/api/tenant/settings')
  const name = settings?.name ?? ''
  const logoUrl = settings?.logo_url ?? null
  const [open, setOpen] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftLogo, setDraftLogo] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Outside-click + Escape — same UX as user-menu / create-menu.
  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function openEditor() {
    setDraftName(name)
    setDraftLogo(logoUrl)
    setOpen(true)
  }

  // Mirrors ALLOWED_LOGO_TYPES in backend/app/routers/tenant_settings.py.
  const ALLOWED_LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
  const MAX_LOGO_BYTES = 2 * 1024 * 1024

  function pickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files && e.target.files[0]
    if (!f) return
    if (!ALLOWED_LOGO_TYPES.has(f.type)) {
      toast.error('Logo must be a PNG, JPEG, GIF, or WebP image')
      return
    }
    if (f.size > MAX_LOGO_BYTES) {
      toast.error('Logo too large (max 2MB)')
      return
    }
    const r = new FileReader()
    r.onload = () => setDraftLogo(typeof r.result === 'string' ? r.result : null)
    r.readAsDataURL(f)
  }

  async function save() {
    const next = draftName.trim() || 'Company'
    setSaving(true)
    try {
      const res = await fetch(`${BASE}/api/tenant/settings`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token!}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: next, logo_url: draftLogo }),
      })
      if (!res.ok) {
        const msg = await res.text().catch(() => '')
        throw new Error(msg || `HTTP ${res.status}`)
      }
      toast.success('Company identity updated')
      setOpen(false)
      // Re-fetch so the chip reflects what the server committed (and to surface server-side
      // normalization, e.g. trimmed name).
      reloadSettings()
    } catch (err) {
      toast.error(`Could not save: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="org-wrap" ref={wrapRef}>
      <button className="org" onClick={openEditor} title="Edit company name & logo">
        {logoUrl
          ? <img className="org-badge org-badge-img" src={logoUrl} alt="" />
          : <span className="org-badge">{initialsOf(name)}</span>}
        <span className="org-name">{name || 'Company'}</span>
        <EditIcon size={12} className="org-edit" style={{ color: 'var(--gx-text-3)' }} />
      </button>

      {open && (
        <div className="menu fade-fast org-pop" onClick={(e) => e.stopPropagation()}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-5)', marginTop: 'var(--gx-space-6)', marginBottom: 'var(--gx-space-7)' }}>
            <div className="org-pop-logo-wrap">
              {draftLogo
                ? <img src={draftLogo} alt="" className="org-pop-logo-preview" />
                : <span className="org-badge" style={{ width: 46, height: 46, fontSize: 'var(--gx-text-lg)', fontWeight: 'var(--gx-weight-bold)' }}>{initialsOf(draftName)}</span>}
              <button type="button" className="user-card-av-edit" onClick={() => fileRef.current?.click()} title="Change logo" aria-label="Change logo">
                <Camera size={11} />
              </button>
              {draftLogo && (
                <button type="button" className="user-card-av-remove" onClick={() => setDraftLogo(null)} title="Remove logo" aria-label="Remove logo">
                  <CloseIcon size={10} />
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" onChange={pickLogo} style={{ display: 'none' }} />
            </div>
            <input
              className="inp inp-sm"
              style={{ flex: 1 }}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Company name"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') void save() }}
            />
          </div>
          <div style={{ display: 'flex', gap: 'var(--gx-space-3)', justifyContent: 'flex-end' }}>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={save} disabled={saving}>
              <CheckIcon size={13} />{saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
