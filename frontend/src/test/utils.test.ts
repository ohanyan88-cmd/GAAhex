import { describe, it, expect } from 'vitest'
import { initialsOf } from '../lib/utils'

describe('initialsOf', () => {
  it('returns first two initials for two-word name', () => {
    expect(initialsOf('John Doe')).toBe('JD')
  })

  it('returns first initial only for single-word name', () => {
    expect(initialsOf('Alice')).toBe('A')
  })

  it('returns first two initials for three-word name (slice to 2)', () => {
    expect(initialsOf('John Michael Doe')).toBe('JM')
  })

  it('returns default U for null', () => {
    expect(initialsOf(null)).toBe('U')
  })

  it('returns default U for undefined', () => {
    expect(initialsOf(undefined)).toBe('U')
  })

  it('returns default U for empty string', () => {
    expect(initialsOf('')).toBe('U')
  })

  it('returns default U for whitespace-only string', () => {
    expect(initialsOf('   ')).toBe('U')
  })

  it('uses custom fallback when provided', () => {
    expect(initialsOf('', 'GX')).toBe('GX')
  })

  it('uppercases result', () => {
    expect(initialsOf('john doe')).toBe('JD')
  })

  it('handles extra whitespace between words', () => {
    expect(initialsOf('  John   Doe  ')).toBe('JD')
  })
})
