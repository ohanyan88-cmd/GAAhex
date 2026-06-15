import { describe, it, expect } from 'vitest'
import { camelKeys } from '../lib/billing'

describe('camelKeys (data-seam mapper)', () => {
  it('deep-converts snake_case object keys', () => {
    expect(camelKeys({ customer_id: '1', created_at: 'x' })).toEqual({
      customerId: '1',
      createdAt: 'x',
    })
    expect(camelKeys({ a: { nested_key: 1 } })).toEqual({ a: { nestedKey: 1 } })
  })
  it('maps through arrays', () => {
    expect(camelKeys([{ plan_name: 'a' }, { plan_name: 'b' }])).toEqual([
      { planName: 'a' },
      { planName: 'b' },
    ])
  })
  it('leaves primitives + already-camel keys untouched', () => {
    expect(camelKeys('str')).toBe('str')
    expect(camelKeys(5)).toBe(5)
    expect(camelKeys({ planName: 'a' })).toEqual({ planName: 'a' })
  })
})
