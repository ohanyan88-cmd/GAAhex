import { describe, it, expect } from 'vitest'
import { BUNDLED } from '../lib/i18n'

// Standard §8 — the three locale bundles must carry an IDENTICAL key set (no key missing
// from hy / en / ru). This test is the enforcement; the per-view string sweep is the Phase-6 tracer.
describe('i18n locale parity (§8)', () => {
  it('en / hy / ru share an identical key set', () => {
    const en = Object.keys(BUNDLED.en).sort()
    const hy = Object.keys(BUNDLED.hy).sort()
    const ru = Object.keys(BUNDLED.ru).sort()
    expect(en.length).toBeGreaterThan(0)
    expect(hy).toEqual(en)
    expect(ru).toEqual(en)
  })
})
