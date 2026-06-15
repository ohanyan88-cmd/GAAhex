import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchCapabilities, FULL_ACCESS, can } from '../lib/capabilities'

// E21 returns a NESTED object { role, can_configure, read_only, entities: {...} }, not a flat
// caps map. These tests pin the adapter that turns it into what can() reads — and the admin
// allow-all that fixes the "admin gets no access" default-deny lockout.

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
    }),
  )
}

describe('fetchCapabilities (E21 adapter)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('grants admins the allow-all wildcard so default-deny never locks them out', async () => {
    // entities deliberately sparse (mirrors live: first-class tables like invoice are absent)
    mockFetch(200, {
      role: ['super_admin'],
      can_configure: true,
      read_only: false,
      entities: { lead: { view: true } },
    })
    const caps = await fetchCapabilities('tok')
    expect(caps).toEqual(FULL_ACCESS)
    // can() allows even an entity ABSENT from the backend map (first-class invoice/subscription)
    expect(can(caps, 'invoice', 'view')).toBe(true)
    expect(can(caps, 'subscription', 'delete')).toBe(true)
  })

  it('flattens the nested response to the per-entity map for non-admins', async () => {
    mockFetch(200, {
      role: ['sales_agent'],
      can_configure: false,
      read_only: false,
      entities: { lead: { view: true, create: true }, customer: { view: true } },
    })
    const caps = await fetchCapabilities('tok')
    expect(can(caps, 'lead', 'view')).toBe(true)
    expect(can(caps, 'lead', 'create')).toBe(true)
    expect(can(caps, 'lead', 'delete')).toBe(false) // ungranted verb → deny
    expect(can(caps, 'customer', 'view')).toBe(true)
    expect(can(caps, 'order', 'view')).toBe(false) // entity absent → default-deny
  })

  it('degrades to FULL_ACCESS on 404 and non-ok responses', async () => {
    mockFetch(404, {})
    expect(await fetchCapabilities('tok')).toEqual(FULL_ACCESS)
    mockFetch(500, {})
    expect(await fetchCapabilities('tok')).toEqual(FULL_ACCESS)
  })
})
