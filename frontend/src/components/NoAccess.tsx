// NoAccess.tsx — "You don't have access to this" branded panel (B21).
// Reuses .state / .state-* classes from styles.css (same look as States.tsx).
// Uses LockIcon from icons.tsx. All strings via t(). No raw hex, no emoji.

import { LockIcon } from './icons'
import { useI18n } from '../lib/i18n'
import { Button } from '../primitives'  // T-P3-7

interface NoAccessProps {
  /** Optional resource label shown in the message, e.g. "this record" */
  what?: string
  /** Called when the user presses "Back to dashboard" */
  onBack?: () => void
}

export default function NoAccess({ what, onBack }: NoAccessProps) {
  const { t } = useI18n()

  return (
    <div
      className="state"
      role="alert"
      aria-live="polite"
      aria-label={t('noaccess.ariaLabel', 'No access')}
    >
      <div className="state-icon">
        <LockIcon size={48} />
      </div>
      <div className="state-title">
        {t('noaccess.title', "You don't have access to this")}
      </div>
      <p className="state-msg">
        {what
          ? t('noaccess.msgSpecific', `You don't have permission to view ${what}.`).replace('{what}', what)
          : t('noaccess.msg', "You don't have permission to view this resource. Contact your administrator if you need access.")}
      </p>
      {onBack && (
        <div className="state-action">
          <Button
            variant="primary"
            size="md"
            onClick={onBack}
            aria-label={t('noaccess.backAriaLabel', 'Back to dashboard')}
          >
            {t('noaccess.back', 'Back to dashboard')}
          </Button>
        </div>
      )}
    </div>
  )
}
