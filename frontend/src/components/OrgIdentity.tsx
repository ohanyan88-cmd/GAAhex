// OrgIdentity — left-side topbar chip that lets a tenant admin edit the company name + logo
// (single-tenant; this is NOT a tenant switcher). Backed by GET/PUT /api/tenant/settings,
// reading the same `name` field that powers the rest of the app and the new `logo_url` column
// (P3 migration f9ef47c3db77). Logo upload follows the avatar pattern in me.py — read the file
// with FileReader and PUT the resulting `data:image/<mime>;base64,...` URL.
//
// Mirrors the kit OrgIdentity in design-system/ui_kits/portal/Shell.jsx — same `.org`/`.org-pop`
// markup and behavior (chip → popover → save → toast). Outside-click + Escape close.
import { useEffect, useRef, useState } from 'react'
import { toast } from './Toast'
import { EditIcon, CheckIcon, CloseIcon } from './icons'
import { Upload } from 'lucide-react'
import { Button } from '../primitives'  // T-P3-7

import { BASE } from '../lib/config'

// "Yerevan Net" → "YN", "Tenant" → "T", "" → "GX". Matches the kit's ini() but keeps the GAAhex
// fallback the rest of the app uses for empty user names.
function initialsOf(name: string | null | undefined, fallback = 'GX'): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return fallback
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return ((parts[0][0] || '') + (parts[1][0] || '')).toUpperCase()
}

export default function OrgIdentity({ token }: { token: string }) {
  const [name, setName] = useState<string>('')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftLogo, setDraftLogo] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Initial fetch — also re-fetches after a save to confirm what the server committed.
  async function load() {
    try {
      const res = await fetch(`${BASE}/api/tenant/settings`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return
      const data = await res.json()
      setName(data.name || '')
      setLogoUrl(data.logo_url || null)
    } catch {
      // Network/auth failure → leave empty; the chip just shows initials.
    }
  }

  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [token])

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

  function pickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files && e.target.files[0]
    if (!f) return
    if (!f.type.startsWith('image/')) {
      toast.error('Logo must be an image')
      return
    }
    // 2MB cap — same as me.py MAX_AVATAR_BYTES, keeps the data URL reasonable.
    if (f.size > 2 * 1024 * 1024) {
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
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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
      await load()
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
          ? <img className="org-badge" src={logoUrl} alt="" />
          : <span className="org-badge">{initialsOf(name)}</span>}
        <span className="org-name">{name || 'Company'}</span>
        <EditIcon size={12} className="org-edit" style={{ color: 'var(--gx-text-3)' }} />
      </button>

      {open && (
        <div className="menu fade-fast org-pop" onClick={(e) => e.stopPropagation()}>
          <div className="lbl" style={{ fontSize: 'var(--gx-text-10)', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--gx-text-3)', padding: '2px 4px 10px' }}>
            Company identity
          </div>
          <div style={{ display: 'flex', gap: 'var(--gx-space-4)', alignItems: 'center', marginBottom: 14 }}>
            {draftLogo
              ? <img src={draftLogo} alt="" style={{ width: 46, height: 46, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />
              : <span style={{ width: 46, height: 46, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--gx-text-lg)', fontWeight: 700, color: 'var(--gx-text-on-gold)', background: 'linear-gradient(135deg,var(--gold-400),var(--gold-700))' }}>
                  {initialsOf(draftName)}
                </span>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload size={13} />Upload logo
              </Button>
              {draftLogo && (
                <Button variant="ghost" size="sm" onClick={() => setDraftLogo(null)} style={{ color: 'var(--gx-text-3)' }}>
                  <CloseIcon size={13} />Remove logo
                </Button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" onChange={pickLogo} style={{ display: 'none' }} />
          </div>
          <label className="field" style={{ marginBottom: 14 }}>
            <span>Company name</span>
            <input
              className="inp inp-sm"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Company name"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') void save() }}
            />
          </label>
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
