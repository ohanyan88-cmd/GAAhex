// Mail API helpers + types — matches the Phase A/B contract (backend/app/routers/mail.py).
// Mirrors lib/billing.ts / lib/helpdesk.ts: bget for never-throw reads (404-degrade split),
// bpost/bpatch/bdel for action handlers that Toast on failure, bupload for multipart
// attachment pre-upload, and BASE/authH for the auth'd attachment-download blob URL.
//
// HARD RULES honored:
//   * No raw fetch in views — every Mail network call funnels through this module.
//   * The UI NEVER sends tenant_id — JWT + RLS scope server-side.
//   * Secrets are write-only — GET never returns a password; create/patch transmit only a
//     newly typed value (`secret_password?: string`); reads expose `has_password: boolean`.
import { bget, bpost, bpatch, bdel, authH, BASE, type Fetched } from './billing'
import type {
  MailAccount,
  MailAccountInput,
  MailAccountTestResult,
  MailFolder,
  MailMessageSummary,
  MailMessageFull,
  MailMessageListFilters,
  MailMessageListResult,
  MailFlagPatch,
  MailSendInput,
  MailSendResult,
  MailSyncTriggerResult,
} from '../views/mail/types'

// ── Accounts (mail.account.manage to write; mail.account.view to read) ─────────

export async function listAccounts(token: string): Promise<Fetched<MailAccount[]>> {
  return bget<MailAccount[]>(token, '/api/mail/accounts')
}

export async function getAccount(token: string, id: string): Promise<Fetched<MailAccount>> {
  return bget<MailAccount>(token, `/api/mail/accounts/${id}`)
}

export async function createAccount(token: string, data: MailAccountInput): Promise<MailAccount> {
  return bpost<MailAccount>(token, '/api/mail/accounts', data)
}

// PATCH — only the provided fields are written; `secret_password` is sent only when the
// operator typed a new value (otherwise omit to keep the stored credential untouched).
export async function updateAccount(
  token: string,
  id: string,
  data: Partial<MailAccountInput>,
): Promise<MailAccount> {
  return bpatch<MailAccount>(token, `/api/mail/accounts/${id}`, data)
}

export async function deleteAccount(token: string, id: string): Promise<void> {
  return bdel(token, `/api/mail/accounts/${id}`)
}

// Connect SMTP + IMAP and report reachability without persisting a body.
export async function testAccount(token: string, id: string): Promise<MailAccountTestResult> {
  return bpost<MailAccountTestResult>(token, `/api/mail/accounts/${id}/test`)
}

// mail.sync.trigger — enqueue an IMAP poll for this account.
export async function triggerSync(token: string, id: string): Promise<MailSyncTriggerResult> {
  return bpost<MailSyncTriggerResult>(token, `/api/mail/accounts/${id}/sync`)
}

// ── Folders / messages (mail.view + per-user owner check; mail.read opens a body) ──

export async function listFolders(token: string, accountId: string): Promise<Fetched<MailFolder[]>> {
  return bget<MailFolder[]>(token, `/api/mail/accounts/${accountId}/folders`)
}

export async function listMessages(
  token: string,
  filters: MailMessageListFilters,
): Promise<Fetched<MailMessageListResult>> {
  const p = new URLSearchParams()
  if (filters.account_id) p.set('account_id', filters.account_id)
  if (filters.folder_id) p.set('folder_id', filters.folder_id)
  if (filters.q) p.set('q', filters.q)
  if (filters.unseen) p.set('unseen', 'true')
  if (filters.limit != null) p.set('limit', String(filters.limit))
  if (filters.offset != null) p.set('offset', String(filters.offset))
  const qs = p.toString()
  // Backend returns the page array in the body + X-Total-Count in the header; we surface
  // both as a single MailMessageListResult so the list can paginate without a second call.
  const res = await bget<MailMessageSummary[]>(token, `/api/mail/messages${qs ? `?${qs}` : ''}`)
  const items = Array.isArray(res.data) ? res.data : []
  return {
    status: res.status,
    ok: res.ok,
    data: res.ok ? { items, total: items.length } : null,
  }
}

// mail.read — opening a message marks it seen server-side; returns the full body.
export async function getMessage(token: string, id: string): Promise<Fetched<MailMessageFull>> {
  return bget<MailMessageFull>(token, `/api/mail/messages/${id}`)
}

// Flags / move: { seen?, flagged?, answered?, folder_id? } (mail.flag / mail.move).
export async function patchMessageFlags(
  token: string,
  id: string,
  patch: MailFlagPatch,
): Promise<MailMessageSummary> {
  return bpatch<MailMessageSummary>(token, `/api/mail/messages/${id}`, patch)
}

export async function deleteMessage(token: string, id: string): Promise<void> {
  return bdel(token, `/api/mail/messages/${id}`)
}

// Auth'd attachment endpoint URL helper. A plain <a href> can't carry the Bearer header,
// so the caller fetches→blob→object-URL (the billing.openDocument pattern); this returns the
// absolute endpoint path the caller fetches with authH(token). mail.attachment.download (audited).
export function downloadAttachmentUrl(messageId: string, attachmentId: string): string {
  return `${BASE}/api/mail/messages/${messageId}/attachments/${attachmentId}`
}

export { authH }

// ── Compose (mail.send / mail.reply) ───────────────────────────────────────────

// Pre-upload a large attachment; returns the id the send payload references so a
// multi-MB file never bloats the JSON send body.
export async function uploadAttachment(
  token: string,
  file: File,
): Promise<{ attachment_id: string; filename: string; size_bytes: number; content_type: string }> {
  const { bupload } = await import('./billing')
  const form = new FormData()
  form.append('file', file)
  return bupload(token, '/api/mail/attachments', form)
}

export async function sendMessage(token: string, data: MailSendInput): Promise<MailSendResult> {
  return bpost<MailSendResult>(token, '/api/mail/messages/send', data)
}
