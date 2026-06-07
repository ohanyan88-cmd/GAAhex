// UserMenu (P5) — right-side user chip + popover. Slimmed to My profile + Sign out;
// "My profile" opens the full Profile page (settings land there). Width matches the bell.
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, LogOut, User } from 'lucide-react'
import type { Lang } from '../lib/i18n'
import { useI18n } from '../lib/i18n'

type Me = { email: string; name: string; can_configure?: boolean; avatar_url?: string | null }
type ModalKey = 'profile' | 'security' | 'shortcuts' | 'docs' | 'whatsnew'

// Same fallback the rest of App.tsx uses for users with empty names.
function initialsOf(name: string | null | undefined, fallback = 'U'): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return fallback
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
  return ((parts[0][0] || '') + (parts[1][0] || '')).toUpperCase()
}

export default function UserMenu({
  user,
  onSignOut,
  onProfile,
}: {
  user: Me
  theme?: 'dark' | 'light'
  onThemeChange?: (t: 'dark' | 'light') => void
  onSignOut: () => void
  onOpenModal?: (key: ModalKey) => void
  onProfile: () => void
  lang?: Lang
  onLangChange?: (l: Lang) => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

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
            <span className="avatar uc-av-lg">
              {user.avatar_url
                ? <img src={user.avatar_url} alt="" className="avatar-img" />
                : initialsOf(user.name)}
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="user-card-name">{user.name || t('common.you', 'You')}</div>
              <div className="user-card-email mono">{user.email}</div>
            </div>
          </div>

          <div className="menu-sep" />

          <button className="menu-item" role="menuitem" onClick={() => { close(); onProfile() }}>
            <User size={15} /><span>{t('profile.title', 'My profile')}</span>
          </button>

          <div className="menu-sep" />

          <button className="menu-item danger" role="menuitem" onClick={() => { close(); onSignOut() }}>
            <LogOut size={15} /><span>{t('common.signout', 'Sign out')}</span>
          </button>
        </div>
      )}
    </div>
  )
}
