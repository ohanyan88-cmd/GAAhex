const BASE = import.meta.env.VITE_API_BASE ?? ''
const TOKEN_KEY = 'gaahex-portal-token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string>),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, { ...opts, headers })
  if (res.status === 401) {
    clearToken()
    window.location.href = '/login'
    throw new Error('Unauthenticated')
  }
  if (!res.ok) {
    const body = await res.text()
    throw new Error(body || res.statusText)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export interface PortalCustomer {
  id: string
  email: string
  name: string | null
  customer_id: string
  customer_name: string | null
  tenant_id: string
}

export interface LoginResult {
  access_token: string
  customer: {
    id: string
    email: string
    name: string | null
    customer_id: string
    tenant_id: string
  }
}

export interface PortalSummary {
  customer: { id: string; name: string | null; email: string }
  open_invoices_count: number
  open_tickets_count: number
  active_services_count: number
  balance_due_luma: number
}

// B35
export interface PortalInvoice {
  id: string
  number: string
  status: string
  total: number
  paid_total: number
  balance: number
  period_start: string | null
  period_end: string | null
  issued_at: string | null
  due_at: string | null
}

export interface PortalPayment {
  id: string
  invoice_id: string
  amount: number
  method: string
  paid_at: string
}

// B36
export interface PortalTicket {
  id: string
  subject: string
  status: string
  priority: string
  created_at: string
  body: string | null
}

export interface PortalReply {
  id: string
  body: string
  direction: string
  created_at: string
}

// B37
export interface PortalService {
  id: string
  name: string
  type: string
  status: string
  activated_at: string | null
}

export interface PortalSubscription {
  id: string
  plan_name: string
  amount: number
  cycle: string
  status: string
}

export interface PortalUsage {
  id: string
  metric: string
  quantity: number
  amount: number
  period_start: string | null
  period_end: string | null
}

// ── API calls ────────────────────────────────────────────────────────────────

export const api = {
  login: (email: string, password: string, tenantId?: string) =>
    req<LoginResult>('/portal/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, ...(tenantId ? { tenant_id: tenantId } : {}) }),
    }),

  me: () => req<PortalCustomer>('/portal/auth/me'),
  summary: () => req<PortalSummary>('/portal/me/summary'),

  // B35
  invoices: () => req<PortalInvoice[]>('/portal/me/invoices'),
  invoice: (id: string) => req<PortalInvoice>(`/portal/me/invoices/${id}`),
  payInvoice: (id: string) =>
    req<{ order_id: string; redirect_url: string; status: string }>(`/portal/me/invoices/${id}/pay`, { method: 'POST' }),
  payments: () => req<PortalPayment[]>('/portal/me/payments'),

  // B36
  tickets: () => req<PortalTicket[]>('/portal/me/tickets'),
  ticket: (id: string) => req<{ ticket: PortalTicket; replies: PortalReply[] }>(`/portal/me/tickets/${id}`),
  createTicket: (subject: string, body: string, priority?: string) =>
    req<PortalTicket>('/portal/me/tickets', {
      method: 'POST',
      body: JSON.stringify({ subject, body, priority }),
    }),
  replyTicket: (id: string, body: string) =>
    req<PortalReply>(`/portal/me/tickets/${id}/reply`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),

  // B37
  services: () => req<PortalService[]>('/portal/me/services'),
  subscriptions: () => req<PortalSubscription[]>('/portal/me/subscriptions'),
  usage: (from?: string, to?: string) => {
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    const qs = params.toString()
    return req<PortalUsage[]>(`/portal/me/usage${qs ? `?${qs}` : ''}`)
  },
  serviceRequest: (message: string, serviceId?: string) =>
    req<{ id: string }>('/portal/me/service-requests', {
      method: 'POST',
      body: JSON.stringify({ message, ...(serviceId ? { service_id: serviceId } : {}) }),
    }),
}
