// format.ts — the ONE place for display formatting (standard §9). Locale-aware
// across AM / EN / RU via the active language (lib/i18n localeTag). Money + dates
// already live in money.ts / time.ts (kept for their many import sites + now
// locale-aware); this module re-exports them as the single surface and adds the
// missing number / phone formatters. New code imports everything from here.
import { localeTag } from './i18n'

export { money, moneyDecStr, toMinor } from './money'
export { fmtDate, fmtDateTime, timeAgo } from './time'

/** Locale-aware number (thousands grouping + optional fraction digits). '—' for nullish/NaN. */
export function number(
  n: number | string | null | undefined,
  opts?: Intl.NumberFormatOptions,
): string {
  if (n === null || n === undefined || n === '') return '—'
  const v = typeof n === 'string' ? parseFloat(n) : n
  if (typeof v !== 'number' || isNaN(v)) return '—'
  return v.toLocaleString(localeTag(), opts)
}

/** Digits-only phone — the normalized form for matching/storage. Aligns with the
 *  §5 normalized-phone search column (so "74 74 74" matches "077 74 74 74"). */
export function normalizePhone(raw: string | null | undefined): string {
  return String(raw ?? '').replace(/\D/g, '')
}

/** Human display phone — Armenian-aware (+374 / 0xx groupings). Unknown shapes pass
 *  through trimmed. Never invents digits; purely presentational over normalizePhone(). */
export function phone(raw: string | null | undefined): string {
  const d = normalizePhone(raw)
  if (!d) return ''
  if (d.length === 11 && d.startsWith('374')) {
    const n = d.slice(3)
    return `+374 ${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`
  }
  if (d.length === 9 && d.startsWith('0')) {
    return `${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 7)} ${d.slice(7)}`
  }
  if (d.length === 8) {
    return `${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 6)} ${d.slice(6)}`
  }
  return String(raw ?? '').trim()
}
