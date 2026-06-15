// AMD money formatter. Backend stores amounts as integer MINOR units (luma; 100 = 1 ֏), matching
// the A9 contract — so we divide by 100 for display. Dram symbol ֏ is written after the amount.
import { localeTag } from './i18n'

export function money(minor: number | null | undefined): string {
  if (minor === null || minor === undefined || isNaN(Number(minor))) return '—'
  const v = Number(minor) / 100
  const s = v.toLocaleString(localeTag(), { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  return `${s} ֏`
}

// Major ֏ (what a user types) → integer minor units for the API.
export function toMinor(major: number | string): number {
  const n = typeof major === 'string' ? parseFloat(major) : major
  return Math.round((isNaN(n) ? 0 : n) * 100)
}

// DF-6 — canonical Decimal-string AMD formatter. The backend returns some
// money fields as Decimal strings ("1234.50") rather than integer luma — this
// helper handles those. Was redefined privately in 3 view files
// (AccountsView, CustomerView, InvoicesView). Returns "—" for null/blank/NaN
// so callers don't need to guard.
export function moneyDecStr(s: string | null | undefined): string {
  if (s === null || s === undefined || s === '') return '—'
  const n = parseFloat(s)
  if (isNaN(n)) return '—'
  const formatted = n.toLocaleString(localeTag(), {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
  return `${formatted} ֏`
}
