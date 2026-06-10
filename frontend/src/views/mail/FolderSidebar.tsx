// FolderSidebar — Mail module LEFT pane (200px column of the `.gx-comms .mail` grid).
// Lists the selected account's folders with unread badges, highlights the active folder,
// switches accounts, and exposes Compose + the settings gear. Implemented VERBATIM against
// FolderSidebarProps (see ./types.ts) — no extra props invented.
//
// HARD RULES honored:
//   * No raw fetch — pure presentational leaf; MailView owns the lib/mail.ts calls.
//   * D20 token discipline — no inline hex/px; only `.gx-comms .mail*` + shared token classes
//     (.row/.muted/.pill/.tabular/.btn*). Sidebar chrome classes live in styles/_comms.css.
//   * The UI never sends tenant_id — nothing here touches the network.
//
// CONTRACT NOTE (flagged to the orchestrator): the spec prose mentions a "Sync now" button,
// but FolderSidebarProps exposes NO `triggerSync`/`onSyncNow` callback. Per "implement the
// contract VERBATIM", Sync now is NOT added here — it lives in MailAccountSettings, reached
// via the gear → onOpenSettings (matching MailView, which wires syncNow through settings).
import { Select } from '../../components/Select'
import {
  GearIcon, PlusIcon, InboxIcon, SendHorizontalIcon, EditIcon,
  TrashIcon, ArchiveIcon, WarningIcon, FolderIcon, MailIcon,
} from '../../components/icons'
import { SkeletonRows } from '../../components/States'
import { Button } from '../../primitives'
import type { FolderSidebarProps, MailAccount, MailFolder, MailFolderRole } from './types'

// Role → glyph. CUSTOM / unknown roles fall back to a plain folder.
function roleIcon(role?: MailFolderRole | null) {
  switch (role) {
    case 'INBOX': return <InboxIcon size={15} />
    case 'SENT': return <SendHorizontalIcon size={15} />
    case 'DRAFTS': return <EditIcon size={15} />
    case 'TRASH': return <TrashIcon size={15} />
    case 'SPAM': return <WarningIcon size={15} />
    case 'ARCHIVE': return <ArchiveIcon size={15} />
    default: return <FolderIcon size={15} />
  }
}

const labelFor = (a: MailAccount) => a.display_name || a.email_address || a.id

export default function FolderSidebar({
  account,
  accounts,
  folders,
  loading,
  selectedFolderId,
  onSelectFolder,
  onSelectAccount,
  onOpenSettings,
  onCompose,
}: FolderSidebarProps) {
  // Account switcher options. Labels are the display_name (→ address → id); we map the picked
  // label back to its id so the contract's id-based onSelectAccount stays satisfied.
  const accountOptions = accounts.map(labelFor)
  const activeLabel = account ? labelFor(account) : ''
  const showAddr = !!account?.email_address && account.email_address !== activeLabel

  function pickAccountByLabel(label: string) {
    const hit = accounts.find((a) => labelFor(a) === label)
    if (hit && hit.id !== account?.id) onSelectAccount(hit.id)
  }

  return (
    <aside className="mail-folders">
      {/* Header: active mailbox identity + settings gear. */}
      <div className="mail-folders-head">
        <span className="mail-acct-ic" aria-hidden>
          <MailIcon size={15} />
        </span>
        <span className="mail-acct-meta">
          <span className="mail-acct-name">{account ? activeLabel : 'Mail'}</span>
          {showAddr && <span className="mail-acct-addr">{account!.email_address}</span>}
        </span>
        <button
          type="button"
          className="tb-icon"
          onClick={onOpenSettings}
          aria-label="Mail account settings"
          title="Account settings"
        >
          <GearIcon size={16} />
        </button>
      </div>

      {/* Account switcher — only when there is more than one mailbox to choose from. */}
      {accounts.length > 1 && (
        <div className="mail-folders-switch">
          <Select
            value={activeLabel}
            options={accountOptions}
            onChange={pickAccountByLabel}
            placeholder="Select mailbox…"
          />
        </div>
      )}

      {/* Compose CTA. */}
      <Button variant="primary" className="mail-compose" onClick={onCompose}>
        <PlusIcon size={15} /> Compose
      </Button>

      {/* Folder list. */}
      {loading && folders == null ? (
        <SkeletonRows rows={5} />
      ) : folders && folders.length > 0 ? (
        <nav aria-label="Mail folders">
          {folders.map((f) => (
            <FolderRow
              key={f.id}
              folder={f}
              selected={f.id === selectedFolderId}
              onSelect={() => onSelectFolder(f.id)}
            />
          ))}
        </nav>
      ) : (
        <p className="mail-folders-empty">
          {loading ? 'Loading folders…' : 'No folders yet. Sync the account to fetch its mailbox.'}
        </p>
      )}
    </aside>
  )
}

function FolderRow({ folder, selected, onSelect }: {
  folder: MailFolder
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className={'mail-folder' + (selected ? ' on' : '')}
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      title={folder.display_name}
    >
      <span className="mail-folder-ic" aria-hidden>{roleIcon(folder.role)}</span>
      <span className="mail-folder-name">{folder.display_name}</span>
      {folder.unseen_count > 0 && (
        <span
          className="pill pill-accent tabular mail-folder-count"
          aria-label={`${folder.unseen_count} unread`}
        >
          {folder.unseen_count}
        </span>
      )}
    </button>
  )
}
