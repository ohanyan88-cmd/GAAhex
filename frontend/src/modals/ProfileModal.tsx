import { Button } from '../primitives'
import { useRef, useState } from 'react'
import { Modal } from '../components/Modal'
import { toast } from '../components/Toast'
import { t } from '../lib/i18n'
import { BASE as API } from '../lib/billing'

// ProfileModal — "My Profile": view + edit the signed-in user's own name, show their email,
// and upload a profile picture (POST /api/me/avatar). On a successful upload the new avatar data
// URL is bubbled up via onAvatarChange so the header chip + sidebar tenant avatar update live.
// Boundary: this edits ONLY the current user's own personal info — nothing about other users,
// billing, or tenant config belongs here.
export default function ProfileModal({
  open,
  onClose,
  token,
  name,
  email,
  avatarUrl,
  onAvatarChange,
}: {
  open: boolean
  onClose: () => void
  token: string
  name: string
  email: string
  avatarUrl: string | null
  onAvatarChange: (avatarUrl: string) => void
}) {
  const [nameDraft, setNameDraft] = useState(name)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const initial = (nameDraft || name || email || 'U').slice(0, 1).toUpperCase()

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    setErr('')
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      setErr(t('profile.avatarTooLarge', 'Image must be 2 MB or smaller.'))
      return
    }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch(`${API}/api/me/avatar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        setErr(data.detail || t('profile.uploadFailed', 'Upload failed.'))
        return
      }
      if (data.avatar_url) {
        onAvatarChange(data.avatar_url)
        toast.success(t('profile.avatarUpdated', 'Profile picture updated'))
      }
    } catch (e2) {
      setErr((e2 as Error).message || t('profile.uploadFailed', 'Upload failed.'))
    } finally {
      setUploading(false)
    }
  }

  // Name editing: the backend exposes no profile-PATCH yet — keep this honest. We persist the
  // avatar live; the name field is editable locally and flagged as not-yet-wired.
  function onSaveName() {
    toast.info(t('profile.nameStub', 'Name editing will be saved once the profile API ships.'))
  }

  return (
    <Modal open={open} onClose={onClose} title={t('profile.title', 'My Profile')} size="sm">
      <div className="profile-modal">
        <div className="profile-avatar-row">
          <div className="profile-avatar">
            {avatarUrl
              ? <img src={avatarUrl} alt={t('profile.avatarAlt', 'Profile picture')} />
              : <span>{initial}</span>}
          </div>
          <div className="profile-avatar-actions">
            <Button variant="ghost" size="sm"
            type="button"
              
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? t('profile.uploading', 'Uploading…') : t('profile.upload', 'Upload picture')}
            </Button>
            <div className="hint">{t('profile.avatarHint', 'PNG or JPG, up to 2 MB.')}</div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={onPick}
              style={{ display: 'none' }}
              aria-label={t('profile.upload', 'Upload picture')}
            />
          </div>
        </div>

        {err && <p className="err" role="alert">{err}</p>}

        <label className="field-block">
          <span className="field-label">{t('profile.name', 'Name')}</span>
          <input
            className="inp inp-md"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            aria-label={t('profile.name', 'Name')}
          />
        </label>

        <label className="field-block">
          <span className="field-label">{t('profile.email', 'Email')}</span>
          <input className="inp inp-md" value={email} disabled aria-label={t('profile.email', 'Email')} />
        </label>

        <div className="profile-modal-foot">
          <Button variant="primary" size="md"
            type="button"  onClick={onSaveName} disabled={nameDraft === name}>
            {t('common.save', 'Save')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
