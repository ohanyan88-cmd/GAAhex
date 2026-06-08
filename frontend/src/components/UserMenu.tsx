// UserMenu (P5) — right-side user chip + popover. Shows name/email/dept/position/role; Sign out only.
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, LogOut, Camera } from 'lucide-react'
import type { Lang } from '../lib/i18n'
import { useI18n } from '../lib/i18n'
import { useAuth } from '../context/AuthContext'
import { initialsOf } from '../lib/utils'
import { BASE } from '../lib/config'

type Me = {
  email: string
  name: string
  can_configure?: boolean
  avatar_url?: string | null
  department?: string | null
  position?: string | null
}

export default function UserMenu({
  user,
  onSignOut,
}: {
  user: Me
  theme?: 'dark' | 'light'
  onThemeChange?: (t: 'dark' | 'light') => void
  onSignOut: () => void
  lang?: Lang
  onLangChange?: (l: Lang) => void
}) {
  const { t } = useI18n()
  const { token, setUser } = useAuth()
  const [open, setOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

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

  function close() { setOpen(false) }

  async function onFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f || !token) return
    e.target.value = ''
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', f)
      const res = await fetch(`${BASE}/api/me/avatar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
      if (!res.ok) return
      const { avatar_url } = await res.json()
      setUser(prev => prev ? { ...prev, avatar_url } : prev)
    } finally {
      setUploading(false)
    }
  }

  const role = user.can_configure ? t('role.admin', 'Administrator') : t('role.member', 'Member')

  return (
    <div className="user-wrap" ref={wrapRef}>
      <button
        className={'userchip' + (open ? ' on' : '')}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={user.name}
      >
        <span className="avatar uc-av">
          {user.avatar_url
            ? <img src={user.avatar_url} alt="" className="avatar-img" />
            : initialsOf(user.name)}
        </span>
        <span className="userchip-meta">
          <span className="userchip-name">{user.name || t('common.you', 'You')}</span>
          <span className="userchip-role">{role}</span>
        </span>
        <ChevronDown size={14} style={{ color: 'var(--gx-text-3)' }} />
      </button>

      {open && (
        <div className="menu fade-fast user-pop" role="menu" onClick={(e) => e.stopPropagation()}>
          <div className="user-card">
            <div className="user-card-av-wrap">
              <span className="avatar uc-av-lg">
                {user.avatar_url
                  ? <img src={user.avatar_url} alt="" className="avatar-img" />
                  : initialsOf(user.name)}
              </span>
              <button
                type="button"
                className="user-card-av-edit"
                onClick={() => !uploading && fileRef.current?.click()}
                title={uploading ? 'Uploading…' : t('profile.changePhoto', 'Change photo')}
                aria-label={t('profile.changePhoto', 'Change photo')}
                disabled={uploading}
              >
                <Camera size={11} />
              </button>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFilePick} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="user-card-name">{user.name || t('common.you', 'You')}</div>
              <div className="user-card-email mono">{user.email}</div>
              <div className="user-card-meta">
                <span>{user.department || '—'}</span>
                <span className="user-card-dot" aria-hidden>·</span>
                <span>{user.position || role}</span>
              </div>
            </div>
            <button
              className="tb-icon user-card-signout"
              role="menuitem"
              onClick={() => { close(); onSignOut() }}
              title={t('common.signout', 'Sign out')}
              aria-label={t('common.signout', 'Sign out')}
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
