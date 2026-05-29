import { Modal } from '../components/Modal'
import { t } from '../lib/i18n'

// SUPPORT modals for the profile dropdown. All three are modest-but-real and self-contained — no
// invented external URLs. Documentation is an in-app placeholder pointing at the (future) docs
// route; "What's new" lists a short real changelog. Flagged stub level inline.

// Keyboard shortcuts — lists the shortcuts that actually exist in the app today.
export function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rows: Array<[string, string]> = [
    ['Esc', t('shortcuts.escClose', 'Close the open dialog or menu')],
    ['Tab / Shift+Tab', t('shortcuts.tab', 'Move focus within a dialog')],
  ]
  return (
    <Modal open={open} onClose={onClose} title={t('shortcuts.title', 'Keyboard shortcuts')} size="sm">
      <table className="shortcuts-table">
        <tbody>
          {rows.map(([key, desc]) => (
            <tr key={key}>
              <td><kbd className="shortcut-kbd">{key}</kbd></td>
              <td>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  )
}

// Documentation — no external docs site exists yet, so this is an honest in-app placeholder
// (STUB: replace the body with a real docs route/link once one ships).
export function DocsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={t('docs.title', 'Documentation')} size="sm">
      <p className="muted">
        {t('docs.body', 'In-app documentation is on the way. For now, reach out to your administrator for help getting set up.')}
      </p>
    </Modal>
  )
}

// What's new — short real changelog of recent platform changes.
export function WhatsNewModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const items: Array<[string, string]> = [
    [
      t('whatsnew.profileTitle', 'Profile & security'),
      t('whatsnew.profileBody', 'Edit your name, upload a profile picture, and change your password from the account menu.'),
    ],
    [
      t('whatsnew.langTitle', 'Languages'),
      t('whatsnew.langBody', 'Switch the interface between English, Armenian, and Russian from the top bar.'),
    ],
    [
      t('whatsnew.themeTitle', 'Quick theme switch'),
      t('whatsnew.themeBody', 'Toggle light and dark mode straight from the top bar.'),
    ],
  ]
  return (
    <Modal open={open} onClose={onClose} title={t('whatsnew.title', "What's new")} size="sm">
      <ul className="whatsnew-list">
        {items.map(([title, body]) => (
          <li key={title}>
            <div className="whatsnew-item-title">{title}</div>
            <div className="whatsnew-item-body muted">{body}</div>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
