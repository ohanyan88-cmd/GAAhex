// UserMenu (P5) — right-side user chip + popover that match the kit's UserMenu in Shell.jsx.
// Wired to the real session. Hosts the theme toggle + language switcher inside the menu
// (no standalone theme button in the topbar, no inline language switcher next to it any more).
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, Sun, Moon, LogOut, SquarePen, User, Keyboard, Settings, SlidersHorizontal } from 'lucide-react'
import type { Lang } from '../lib/i18n'
import { useI18n } from '../lib/i18n'
import { Button } from '../primitives'  // T-P3-7

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
  theme,
  onThemeChange,
  onSignOut,
  onOpenModal,
  lang,
  onLangChange,
}: {
  user: Me
  theme: 'dark' | 'light'
  onThemeChange: (t: 'dark' | 'light') => void
  onSignOut: () => void
  onOpenModal: (key: ModalKey) => void
  lang: Lang
  onLangChange: (l: Lang) => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'menu' | 'profile'>('menu')
  const wrapRef = useRef<HTMLDivElement>(null)

  // Outside-click + Escape close. Always reset the popover to 'menu' on close so the next
  // open starts on the main menu, not the profile sub-view.
  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
        setView('menu')
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        setView('menu')
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function close() {
    setOpen(false)
    setView('menu')
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
        <span className="avatar" style={{ width: 28, height: 28, fontSize: 'var(--gx-text-11)' }}>
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
          {view === 'menu' ? (
            <>
              <div className="user-card">
                <span className="avatar" style={{ width: 42, height: 42, fontSize: 'var(--gx-text-md)' }}>
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

              <button className="menu-item" role="menuitem" onClick={() => setView('profile')}>
                <User size={15} /><span>{t('profile.title', 'My profile')}</span>
              </button>
              <button className="menu-item" role="menuitem" onClick={() => { close(); onOpenModal('security') }}>
                <Settings size={15} /><span>{t('security.title', 'Account settings')}</span>
              </button>
              <button className="menu-item" role="menuitem" disabled style={{ opacity: 0.55, cursor: 'not-allowed' }}>
                <SlidersHorizontal size={15} /><span>{t('prefs.comingSoon', 'Preferences (coming soon)')}</span>
              </button>

              <button
                className="menu-item"
                role="menuitem"
                onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}
              >
                {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
                <span>{theme === 'dark' ? t('common.themeLight', 'Light theme') : t('common.themeDark', 'Dark theme')}</span>
              </button>

              {/* Language — small 3-button row. Same `.lang-switch`/`.lang-opt` rules the topbar
                  used before. Tucked inside the menu now (locked decision #1). */}
              <div className="menu-lang-row" role="group" aria-label={t('common.language', 'Language')}>
                <span className="menu-lang-label">{t('common.language', 'Language')}</span>
                <div className="lang-switch">
                  {(['en', 'hy', 'ru'] as Lang[]).map((l) => (
                    <button
                      key={l}
                      className={'lang-opt' + (lang === l ? ' on' : '')}
                      onClick={() => onLangChange(l)}
                      aria-pressed={lang === l}
                    >
                      {l === 'en' ? 'EN' : l === 'hy' ? 'AM' : 'RU'}
                    </button>
                  ))}
                </div>
              </div>

              <button className="menu-item" role="menuitem" onClick={() => { close(); onOpenModal('shortcuts') }}>
                <Keyboard size={15} /><span>{t('shortcuts.title', 'Keyboard shortcuts')}</span>
              </button>

              <div className="menu-sep" />

              <button className="menu-item danger" role="menuitem" onClick={() => { close(); onSignOut() }}>
                <LogOut size={15} /><span>{t('common.signout', 'Sign out')}</span>
              </button>
            </>
          ) : (
            <>
              <div className="user-pop-head">
                <button
                  className="tb-icon"
                  style={{ width: 28, height: 28 }}
                  onClick={() => setView('menu')}
                  aria-label={t('common.back', 'Back')}
                >
                  <ChevronLeft size={16} />
                </button>
                <span style={{ fontWeight: 'var(--gx-weight-semibold)', fontSize: 'var(--gx-text-13)' }}>{t('profile.title', 'My profile')}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--gx-space-3)', padding: 'var(--gx-space-4) 0 var(--gx-space-7)' }}>
                <span className="avatar" style={{ width: 56, height: 56, fontSize: 'var(--gx-text-xl)' }}>
                  {user.avatar_url
                    ? <img src={user.avatar_url} alt="" className="avatar-img" />
                    : initialsOf(user.name)}
                </span>
                <div style={{ fontSize: 'var(--gx-text-md)', fontWeight: 'var(--gx-weight-semibold)' }}>{user.name || t('common.you', 'You')}</div>
                <span className="pill pill-gold">{role}</span>
              </div>
              <div className="kv" style={{ padding: '9px 0' }}>
                <span className="kv-k" style={{ width: 70 }}>{t('auth.email', 'Email')}</span>
                <span className="kv-v mono" style={{ fontSize: 'var(--gx-text-sm)' }}>{user.email}</span>
              </div>
              {/* "Team" is intentionally only rendered when the row has a value — Me has no team
                  field today, so the row stays hidden until backend wires one. */}
              <div className="kv" style={{ padding: '9px 0' }}>
                <span className="kv-k" style={{ width: 70 }}>{t('profile.status', 'Status')}</span>
                <span className="kv-v">
                  <span className="pill pill-success">
                    <span className="d" style={{ background: 'var(--gx-online)' }} />
                    {t('profile.active', 'Active')}
                  </span>
                </span>
              </div>
              <Button
                variant="secondary"
                size="sm"
                style={{ width: '100%', marginTop: 'var(--gx-space-6)' }}
                onClick={() => { close(); onOpenModal('profile') }}
              >
                <SquarePen size={13} />{t('profile.edit', 'Edit profile')}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
