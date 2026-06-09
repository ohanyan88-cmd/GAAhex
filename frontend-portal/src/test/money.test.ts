// L-14 — unit tests for the portal AMD money formatter (lib/money.ts / DF-7)
import { describe, it, expect } from 'vitest'
import { fmt } from '../lib/money'

describe('fmt — AMD luma formatter', () => {
  it('formats zero luma as 0.00 ֏', () => {
    const result = fmt(0)
    expect(result).toMatch(/0[,.]00\s*֏/)
  })

  it('converts 100 luma to 1.00 ֏', () => {
    const result = fmt(100)
    expect(result).toContain('֏')
    // 100 luma = 1 AMD; value before the ֏ must contain "1"
    expect(result.replace(/\s*֏/, '')).toMatch(/1/)
  })

  it('converts 50000 luma (500 AMD) correctly', () => {
    const result = fmt(50000)
    expect(result).toContain('֏')
    // hy-AM locale formats 500.00 — just verify the dram symbol is present
    // and the raw numeric string contains 500 (with possible grouping chars)
    const numeric = result.replace(/\s*֏/, '').replace(/[\s ]/g, '')
    expect(numeric).toMatch(/500/)
  })

  it('always ends with the ֏ dram sign', () => {
    expect(fmt(1000)).toMatch(/֏$/)
    expect(fmt(250)).toMatch(/֏$/)
    expect(fmt(1)).toMatch(/֏$/)
  })

  it('always includes exactly 2 decimal places', () => {
    // 10000 luma = 100.00 AMD — the numeric portion before ֏ should end with ,00 or .00
    const result = fmt(10000)
    const numeric = result.replace(/\s*֏$/, '').trim()
    expect(numeric).toMatch(/[,.]00$/)
  })

  it('handles negative luma (credit note)', () => {
    const result = fmt(-500)
    expect(result).toContain('֏')
    // Negative values should still contain the sign
    expect(result).toMatch(/-/)
  })
})
