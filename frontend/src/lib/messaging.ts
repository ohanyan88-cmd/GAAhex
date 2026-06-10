// Messaging channels API client — /api/messaging/* (per-tenant SMS/Telegram/WhatsApp).
// Mirrors lib/mail.ts / lib/billing.ts: bget for never-throw reads, bpost/bpatch/bdel for actions.
// Secrets are write-only — create/patch send a token only when newly typed; reads expose has_token.
import { bget, bpost, bpatch, bdel, type Fetched } from './billing'

export type ChannelKind = 'SMS' | 'TELEGRAM' | 'WHATSAPP'

export type ChannelAccount = {
  id: string
  channel: ChannelKind
  provider: string
  display_name: string
  sender_id?: string | null
  is_default: boolean
  is_active: boolean
  status: string
  last_error?: string | null
  config?: Record<string, any>
  has_token: boolean
  has_extra: boolean
}

export type ChannelAccountInput = {
  channel: ChannelKind
  display_name: string
  provider?: string
  sender_id?: string
  secret_token?: string          // write-only; sent only when newly typed
  secret_extra?: string
  config?: Record<string, any>
  is_default?: boolean
  is_active?: boolean
}

export type ChannelTestResult = { ok: boolean; status: string; detail?: string | null }

export function listAccounts(token: string): Promise<Fetched<ChannelAccount[]>> {
  return bget<ChannelAccount[]>(token, '/api/messaging/accounts')
}
export function createAccount(token: string, data: ChannelAccountInput): Promise<ChannelAccount> {
  return bpost<ChannelAccount>(token, '/api/messaging/accounts', data)
}
export function updateAccount(token: string, id: string, data: Partial<ChannelAccountInput>): Promise<ChannelAccount> {
  return bpatch<ChannelAccount>(token, `/api/messaging/accounts/${id}`, data)
}
export function deleteAccount(token: string, id: string): Promise<void> {
  return bdel(token, `/api/messaging/accounts/${id}`)
}
export function testAccount(token: string, id: string): Promise<ChannelTestResult> {
  return bpost<ChannelTestResult>(token, `/api/messaging/accounts/${id}/test`)
}
export function sendMessage(token: string, data: { channel: string; to: string; text: string; subject?: string }) {
  return bpost(token, '/api/messaging/send', data)
}
