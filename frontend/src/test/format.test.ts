import { describe, it, expect } from 'vitest'
import { number, phone, normalizePhone, money, toMinor } from '../lib/format'

// Default language is 'en' in tests (no localStorage), so locale-aware output is en-US.

describe('format.number', () => {
  it('groups thousands and returns dash for nullish/NaN', () => {
    expect(number(1234567)).toBe('1,234,567')
    expect(number('2500.5')).toBe('2,500.5')
    expect(number(null)).toBe('—')
    expect(number(undefined)).toBe('—')
    expect(number('not-a-number')).toBe('—')
  })
})

describe('format.normalizePhone', () => {
  it('strips every non-digit', () => {
    expect(normalizePhone('+374 77 74 74 74')).toBe('37477747474')
    expect(normalizePhone('077 74 74 74')).toBe('077747474')
    expect(normalizePhone('(077) 74-74-74')).toBe('077747474')
    expect(normalizePhone(null)).toBe('')
  })
})

describe('format.phone', () => {
  it('formats the common Armenian shapes and passes unknown through', () => {
    expect(phone('37477747474')).toBe('+374 77 747 474')
    expect(phone('077747474')).toBe('077 74 74 74')
    expect(phone('74747474')).toBe('74 74 74 74')
    expect(phone('')).toBe('')
    expect(phone('12345')).toBe('12345')
  })
})

describe('format.money', () => {
  it('divides luma by 100, appends the dram sign, dashes nullish', () => {
    expect(money(123400)).toBe('1,234 ֏')
    expect(money(0)).toBe('0 ֏')
    expect(money(null)).toBe('—')
    expect(toMinor('12.5')).toBe(1250)
    expect(toMinor(7)).toBe(700)
  })
})
