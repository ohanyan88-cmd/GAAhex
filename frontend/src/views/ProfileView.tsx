// ProfileView — Workspace → My Profile. Placeholder page where account settings
// will live. Shows the signed-in user's basics; settings sections land here next.
import { PageShell } from '../page-shell'
import { UserIcon } from '../components/icons'
import { useI18n } from '../lib/i18n'
import { useAuth } from '../context/AuthContext'

function initials(name: string | null | undefined): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'U'
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
  return ((parts[0][0] || '') + (parts[1][0] || '')).toUpperCase()
}

export default function ProfileView() {
  const { t } = useI18n()
  const { user } = useAuth()
  const name = user?.name || t('common.you', 'You')
  const role = user?.can_configure ? t('role.admin', 'Administrator') : t('role.member', 'Member')

  return (
    <PageShell
      type="WORKSPACE"
      breadcrumb={['Workspace', 'My Profile']}
      icon={<UserIcon size={18} />}
      title={t('profile.title', 'My profile')}
      subtitle={t('profile.subtitle', 'Your account')}
    >
      <div className="card pv-card">
        <div className="pv-id">
          <span className="pv-avatar">{initials(user?.name)}</span>
          <div>
            <div className="pv-name">{name}</div>
            <div className="pv-email mono">{user?.email}</div>
            <span className="pill pill-gold pv-role">{role}</span>
          </div>
        </div>
      </div>

      <div className="card pv-soon">
        <UserIcon size={22} />
        <div className="pv-soon-title">{t('profile.settingsSoon', 'Account settings — coming soon')}</div>
        <div className="pv-soon-sub">{t('profile.settingsSoonSub', 'Profile, security, preferences and notifications will live here.')}</div>
      </div>
    </PageShell>
  )
}
