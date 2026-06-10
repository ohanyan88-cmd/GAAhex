// MailView — Mail module orchestrator. PageShell (COMMUNICATION page type) + the
// `.gx-comms .mail*` 3-pane skeleton: folder sidebar | message list | thread reader.
// Owns the three fetches (accounts→folders→messages→selected message) via lib/mail.ts,
// the selection state, and the first-run "No mail account yet" EmptyState. Leaf bodies
// live in sibling files and build against views/mail/types.ts.
//
// HARD RULES: no raw fetch (all via lib/mail.ts), no inline hex/px (token classes only),
// the UI never sends tenant_id (JWT + RLS server-side).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { FULL_ACCESS, type Capabilities } from '../../lib/capabilities'
import { PageShell } from '../../page-shell'
import { EmptyState } from '../../components/States'
import { toast } from '../../components/Toast'
import { MailIcon, PlusIcon } from '../../components/icons'
import { Button } from '../../primitives'
import * as mail from '../../lib/mail'
import type {
  MailAccount,
  MailFolder,
  MailMessageSummary,
  MailMessageFull,
  MailAttachmentMeta,
  MailSendInput,
  MailAccountInput,
  ComposeInitial,
} from './types'
import FolderSidebar from './FolderSidebar'
import MessageList from './MessageList'
import ThreadReader from './ThreadReader'
import ComposeModal from './ComposeModal'
import MailAccountSettings from './MailAccountSettings'

export type MailViewProps = {
  capabilities?: Capabilities
  /** Deep-link selection (read off the URL by MailRouteAdapter). */
  initialAccountId?: string
  initialFolderId?: string
  initialMessageId?: string
  /** ?settings=1 → open the account settings modal on mount. */
  openSettings?: boolean
}

export default function MailView({
  capabilities: _capabilities = FULL_ACCESS,
  initialAccountId,
  initialFolderId,
  initialMessageId,
  openSettings = false,
}: MailViewProps) {
  const { token } = useAuth()

  // ── State ────────────────────────────────────────────────────────────────
  const [accounts, setAccounts] = useState<MailAccount[] | null>(null)
  const [accountsError, setAccountsError] = useState<string | null>(null)
  const [accountId, setAccountId] = useState<string | null>(initialAccountId ?? null)

  const [folders, setFolders] = useState<MailFolder[] | null>(null)
  const [foldersLoading, setFoldersLoading] = useState(false)
  const [folderId, setFolderId] = useState<string | null>(initialFolderId ?? null)

  const [messages, setMessages] = useState<MailMessageSummary[] | null>(null)
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [messagesError, setMessagesError] = useState<string | null>(null)
  const [messageTotal, setMessageTotal] = useState(0)

  const [messageId, setMessageId] = useState<string | null>(initialMessageId ?? null)
  const [message, setMessage] = useState<MailMessageFull | null>(null)
  const [messageLoading, setMessageLoading] = useState(false)
  const [messageError, setMessageError] = useState<string | null>(null)

  const [settingsOpen, setSettingsOpen] = useState(openSettings)
  const [composeOpen, setComposeOpen] = useState(false)
  const [composeInitial, setComposeInitial] = useState<ComposeInitial | undefined>(undefined)

  const account = useMemo(
    () => accounts?.find((a) => a.id === accountId) ?? null,
    [accounts, accountId],
  )
  const folderName = useMemo(
    () => folders?.find((f) => f.id === folderId)?.display_name ?? null,
    [folders, folderId],
  )

  // ── Fetch 1: accounts ──────────────────────────────────────────────────────
  const loadAccounts = useCallback(async () => {
    if (!token) return
    setAccountsError(null)
    const res = await mail.listAccounts(token)
    if (!res.ok) {
      setAccounts([])
      setAccountsError(res.status >= 500 ? 'Could not load mail accounts.' : null)
      return
    }
    const list = res.data ?? []
    setAccounts(list)
    setAccountId((prev) => prev ?? list.find((a) => a.is_default)?.id ?? list[0]?.id ?? null)
  }, [token])

  useEffect(() => { void loadAccounts() }, [loadAccounts])

  // ── Fetch 2: folders (on account change) ────────────────────────────────────
  const loadFolders = useCallback(async (accId: string) => {
    if (!token) return
    setFoldersLoading(true)
    const res = await mail.listFolders(token, accId)
    setFoldersLoading(false)
    const list = res.ok ? res.data ?? [] : []
    setFolders(list)
    setFolderId((prev) =>
      prev && list.some((f) => f.id === prev)
        ? prev
        : list.find((f) => f.role === 'INBOX')?.id ?? list[0]?.id ?? null,
    )
  }, [token])

  useEffect(() => {
    if (accountId) void loadFolders(accountId)
    else { setFolders(null); setFolderId(null) }
  }, [accountId, loadFolders])

  // ── Fetch 3: messages (on account/folder change) ────────────────────────────
  const loadMessages = useCallback(async () => {
    if (!token || !accountId) { setMessages(null); return }
    setMessagesLoading(true)
    setMessagesError(null)
    const res = await mail.listMessages(token, {
      account_id: accountId,
      folder_id: folderId ?? undefined,
    })
    setMessagesLoading(false)
    if (!res.ok) {
      setMessages([])
      setMessageTotal(0)
      setMessagesError(res.status >= 500 ? 'Could not load messages.' : null)
      return
    }
    setMessages(res.data?.items ?? [])
    setMessageTotal(res.data?.total ?? 0)
  }, [token, accountId, folderId])

  useEffect(() => { void loadMessages() }, [loadMessages])

  // ── Fetch 4: selected message body ──────────────────────────────────────────
  const loadMessage = useCallback(async () => {
    if (!token || !messageId) { setMessage(null); return }
    setMessageLoading(true)
    setMessageError(null)
    const res = await mail.getMessage(token, messageId)
    setMessageLoading(false)
    if (!res.ok || !res.data) {
      setMessage(null)
      setMessageError(res.status >= 500 ? 'Could not open this message.' : 'Message not found.')
      return
    }
    setMessage(res.data)
    // Opening marks seen server-side — reflect it in the list row without a refetch.
    setMessages((prev) =>
      prev?.map((m) => (m.id === messageId ? { ...m, flag_seen: true } : m)) ?? prev,
    )
  }, [token, messageId])

  useEffect(() => { void loadMessage() }, [loadMessage])

  // ── Selection handlers ──────────────────────────────────────────────────────
  function selectAccount(id: string) {
    setAccountId(id); setFolderId(null); setMessageId(null); setMessage(null)
  }
  function selectFolder(id: string) {
    setFolderId(id); setMessageId(null); setMessage(null)
  }
  function selectMessage(id: string) { setMessageId(id) }

  // ── Message actions ─────────────────────────────────────────────────────────
  async function toggleFlag(flag: 'seen' | 'flagged' | 'answered', value: boolean) {
    if (!token || !messageId) return
    try {
      await mail.patchMessageFlags(token, messageId, { [flag]: value })
      setMessage((prev) => (prev ? { ...prev, [`flag_${flag}`]: value } : prev))
      setMessages((prev) =>
        prev?.map((m) => (m.id === messageId ? { ...m, [`flag_${flag}`]: value } : m)) ?? prev,
      )
    } catch (e) {
      toast.error((e as Error).message || 'Could not update message.')
    }
  }

  async function deleteMessage(id: string) {
    if (!token) return
    try {
      await mail.deleteMessage(token, id)
      setMessages((prev) => prev?.filter((m) => m.id !== id) ?? prev)
      if (messageId === id) { setMessageId(null); setMessage(null) }
    } catch (e) {
      toast.error((e as Error).message || 'Could not delete message.')
    }
  }

  async function downloadAttachment(att: MailAttachmentMeta) {
    if (!token) return
    const url = mail.downloadAttachmentUrl(att.message_id, att.id)
    const err = await openAttachment(token, url)
    if (err) toast.error(err)
  }

  function openCompose(initial?: ComposeInitial) {
    setComposeInitial(initial); setComposeOpen(true)
  }
  function replyTo(m: MailMessageFull) {
    openCompose({
      to: m.from_addr ? [{ name: m.from_name ?? undefined, email: m.from_addr }] : [],
      subject: m.subject ? `Re: ${m.subject}` : 'Re:',
      in_reply_to: m.message_id ?? undefined,
      references: m.message_id ? [m.message_id] : undefined,
    })
  }
  function forward(m: MailMessageFull) {
    openCompose({
      subject: m.subject ? `Fwd: ${m.subject}` : 'Fwd:',
      html: m.body_html ?? undefined,
      text: m.body_text ?? undefined,
    })
  }

  async function sendMessage(payload: MailSendInput) {
    if (!token) throw new Error('Not authenticated')
    await mail.sendMessage(token, payload)
    setComposeOpen(false)
    toast.success('Message sent.')
    void loadMessages()
  }

  // ── Account settings actions ────────────────────────────────────────────────
  async function saveAccount(id: string | null, data: MailAccountInput | Partial<MailAccountInput>) {
    if (!token) throw new Error('Not authenticated')
    if (id) await mail.updateAccount(token, id, data)
    else await mail.createAccount(token, data as MailAccountInput)
    await loadAccounts()
    toast.success('Account saved.')
  }
  async function setDefaultAccount(id: string) {
    if (!token) return
    await mail.updateAccount(token, id, { is_default: true })
    await loadAccounts()
  }
  async function syncNow(id: string) {
    if (!token) return
    await mail.triggerSync(token, id)
    toast.success('Sync queued.')
  }
  async function deleteAccount(id: string) {
    if (!token) return
    await mail.deleteAccount(token, id)
    if (accountId === id) { setAccountId(null); setFolderId(null); setMessageId(null) }
    await loadAccounts()
    setSettingsOpen(false)
  }

  // ── First-run: no mail account yet ──────────────────────────────────────────
  const firstRun = accounts !== null && accounts.length === 0

  const body = firstRun ? (
    <div className="mail" style={{ display: 'block' }}>
      <EmptyState
        icon={<MailIcon size={40} />}
        title="No mail account yet"
        message="Connect your IMAP/SMTP mailbox to send and receive email inside GAAhex."
        action={
          <Button variant="primary" onClick={() => setSettingsOpen(true)}>
            <PlusIcon size={15} /> Add a mail account
          </Button>
        }
      />
    </div>
  ) : (
    <div className="mail">
      <FolderSidebar
        account={account}
        accounts={accounts ?? []}
        folders={folders}
        loading={foldersLoading}
        selectedFolderId={folderId}
        onSelectFolder={selectFolder}
        onSelectAccount={selectAccount}
        onOpenSettings={() => setSettingsOpen(true)}
        onCompose={() => openCompose()}
      />
      <MessageList
        messages={messages}
        loading={messagesLoading}
        error={messagesError}
        selectedMessageId={messageId}
        folderName={folderName}
        onSelectMessage={selectMessage}
        onRetry={() => void loadMessages()}
        total={messageTotal}
      />
      <ThreadReader
        message={message}
        loading={messageLoading}
        error={messageError}
        onToggleFlag={toggleFlag}
        onReply={replyTo}
        onForward={forward}
        onDelete={deleteMessage}
        onRetry={() => void loadMessage()}
        onDownloadAttachment={downloadAttachment}
      />
    </div>
  )

  return (
    <PageShell
      type="COMMUNICATION"
      breadcrumb={['Workspace', 'Mail']}
      icon={<MailIcon size={20} />}
      title="Mail"
      subtitle="Per-tenant email — inbox, compose, threads, and attachments through your own mail server"
      workspaceClassName="gx-comms"
    >
      <div className="comms-shell">
        {accountsError && (
          <div className="error-banner" role="alert">{accountsError}</div>
        )}
        {body}
      </div>

      <MailAccountSettings
        open={settingsOpen}
        account={settingsOpen ? account : null}
        onClose={() => setSettingsOpen(false)}
        onSave={saveAccount}
        onTest={(id) => mail.testAccount(token!, id)}
        onSyncNow={syncNow}
        onSetDefault={setDefaultAccount}
        onDelete={deleteAccount}
      />
      <ComposeModal
        open={composeOpen}
        accounts={accounts ?? []}
        defaultAccountId={accountId}
        initial={composeInitial}
        onClose={() => setComposeOpen(false)}
        onSend={sendMessage}
        uploadAttachment={(file) => mail.uploadAttachment(token!, file)}
      />
    </PageShell>
  )
}

// Auth'd attachment download: a plain link can't carry the Bearer header, so
// fetch→blob→object-URL (the billing.openDocument pattern). Returns an error string or null.
async function openAttachment(token: string, url: string): Promise<string | null> {
  const win = window.open('', '_blank')
  try {
    const r = await fetch(url, { headers: mail.authH(token) })
    if (!r.ok) throw new Error(r.status === 404 ? 'Attachment not available' : `Failed (${r.status})`)
    const blob = await r.blob()
    const objUrl = URL.createObjectURL(blob)
    if (win) win.location.href = objUrl
    else { const a = document.createElement('a'); a.href = objUrl; a.target = '_blank'; a.click() }
    setTimeout(() => URL.revokeObjectURL(objUrl), 60000)
    return null
  } catch (e) {
    if (win) win.close()
    return (e as Error).message
  }
}
