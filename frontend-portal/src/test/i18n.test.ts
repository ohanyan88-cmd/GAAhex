// L-14 — unit tests for the portal i18n helper (lib/i18n.ts / T-P4-2)
import { describe, it, expect, beforeEach } from 'vitest'
import { t, getLang, setLang } from '../lib/i18n'

// Reset to English before each test to avoid cross-test bleed
beforeEach(() => {
  setLang('en')
})

describe('t() — translation lookup', () => {
  it('returns the key itself when no translation exists in English', () => {
    expect(t('some.missing.key')).toBe('some.missing.key')
  })

  it('returns the supplied fallback when key is absent', () => {
    expect(t('some.missing.key', 'My fallback')).toBe('My fallback')
  })

  it('returns the fallback for a known English key (English bundle is empty, falls back)', () => {
    // English bundle is intentionally empty — t() falls back to the fallback arg
    expect(t('login.submit', 'Sign in')).toBe('Sign in')
  })

  it('resolves a Russian translation after switching to ru', () => {
    setLang('ru')
    expect(t('login.submit', 'Sign in')).toBe('Войти')
  })

  it('resolves an Armenian translation after switching to hy', () => {
    setLang('hy')
    expect(t('login.submit', 'Sign in')).toBe('Մուտք')
  })

  it('falls back to key when lang is ru but key is absent', () => {
    setLang('ru')
    expect(t('nonexistent.key')).toBe('nonexistent.key')
  })
})

describe('getLang() / setLang()', () => {
  it('defaults to English', () => {
    expect(getLang()).toBe('en')
  })

  it('returns the new lang after setLang', () => {
    setLang('hy')
    expect(getLang()).toBe('hy')
  })

  it('setLang to same lang is a no-op (does not throw)', () => {
    setLang('en')
    expect(() => setLang('en')).not.toThrow()
    expect(getLang()).toBe('en')
  })

  it('cycles through all three supported languages', () => {
    for (const lang of ['en', 'ru', 'hy'] as const) {
      setLang(lang)
      expect(getLang()).toBe(lang)
    }
  })
})
