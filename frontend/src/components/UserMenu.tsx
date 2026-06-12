// UserMenu (P5) — right-side user chip + popover (name/email/dept/position/role + sign out).
// Avatar editing: camera → pick a file → "position & size" cropper (ImageCropModal) → the framed
// square is uploaded (POST /api/me/avatar). ✕ removes it (DELETE /api/me/avatar). Both surface a
// toast on failure so nothing fails silently.
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, LogOut, Camera, X } from 'lucide-react'
import type { Lang } from '../lib/i18n'
import { useI18n } from '../lib/i18n'
import { useAuth } from '../context/AuthContext'
import { initialsOf } from '../lib/utils'
import { toast } from './Toast'
import { bupload, bdel } from '../lib/billing'
import ImageCropModal from './ImageCropModal'

type Me = {
  email: string
  name: string
  can_configure?: boolean
  avatar_url?: string | null
  department?: string | null
  position?: string | null
}

const MAX_PICK_BYTES = 10 * 1024 * 1024  // guard the in-browser load; the crop output itself is tiny

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
  const [removing, setRemoving] = useState(false)
  const [cropSrc, setCropSrc] = useState<string | null>(null)
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

  function clearCropSrc() {
    setCropSrc((prev) => { if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev); return null })
  }

  // Pick a file → open the cropper (no upload yet). The cropper bakes the framed square on "Set".
  function onFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!f.type.startsWith('image/')) { toast.error(t('profile.notImage', 'Please choose an image file.')); return }
    if (f.size > MAX_PICK_BYTES) { toast.error(t('profile.imageTooBig', 'Image is too large (max 10 MB).')); return }
    setCropSrc(URL.createObjectURL(f))
    setOpen(false)
  }

  // Upload the cropped square produced by the modal.
  async function onCropApply(blob: Blob) {
    if (!token) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', new File([blob], 'avatar.png', { type: 'image/png' }))
      const { avatar_url } = await bupload<{ avatar_url: string }>(token, '/api/me/avatar', form)
      setUser(prev => prev ? { ...prev, avatar_url } : prev)
      toast.success(t('profile.avatarUpdated', 'Profile picture updated'))
      clearCropSrc()
    } catch (e) {
      toast.error(`${t('profile.uploadFailed', 'Upload failed')}: ${(e as Error).message}`)
    } finally {
      setUploading(false)
    }
  }

  // Remove the current picture (DELETE /api/me/avatar). Visible toast on success/failure.
  async function onRemove() {
    if (!token) return
    setRemoving(true)
    try {
      await bdel(token, '/api/me/avatar')
      setUser(prev => prev ? { ...prev, avatar_url: null } : prev)
      toast.success(t('profile.avatarRemoved', 'Profile picture removed'))
    } catch (e) {
      toast.error(`${t('profile.removeFailed', 'Could not remove picture')}: ${(e as Error).message}`)
    } finally {
      setRemoving(false)
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
            <div className="uc-pic-col">
              <span className="avatar uc-av-lg">
                {user.avatar_url
                  ? <img src={user.avatar_url} alt="" className="avatar-img" />
                  : initialsOf(user.name)}
              </span>
              <div className="uc-pic-actions">
                <button
                  type="button"
                  className="uc-pic-btn"
                  onClick={() => !uploading && fileRef.current?.click()}
                  title={uploading ? t('profile.uploading', 'Uploading…') : t('profile.changePhoto', 'Change photo')}
                  aria-label={t('profile.changePhoto', 'Change photo')}
                  disabled={uploading}
                >
                  <Camera size={13} />
                </button>
                {user.avatar_url && (
                  <button
                    type="button"
                    className="uc-pic-btn danger"
                    onClick={onRemove}
                    title={removing ? t('profile.removing', 'Removing…') : t('profile.removePhoto', 'Remove photo')}
                    aria-label={t('profile.removePhoto', 'Remove photo')}
                    disabled={removing || uploading}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
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

      <ImageCropModal
        open={!!cropSrc}
        src={cropSrc}
        title={t('crop.avatarTitle', 'Position and size your picture')}
        applyLabel={uploading ? t('profile.uploading', 'Uploading…') : t('crop.setAvatar', 'Set profile picture')}
        busy={uploading}
        onCancel={clearCropSrc}
        onApply={onCropApply}
      />
    </div>
  )
}
