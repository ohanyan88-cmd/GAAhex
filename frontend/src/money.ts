// AMD money formatter. Backend stores amounts as integer MINOR units (luma; 100 = 1 ֏), matching
// the A9 contract — so we divide by 100 for display. Dram symbol ֏ is written after the amount.
export function money(minor: number | null | undefined): string {
  if (minor === null || minor === undefined || isNaN(Number(minor))) return '—'
  const v = Number(minor) / 100
  const s = v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  return `${s} ֏`
}

// Major ֏ (what a user types) → integer minor units for the API.
export function toMinor(major: number | string): number {
  const n = typeof major === 'string' ? parseFloat(major) : major
  return Math.round((isNaN(n) ? 0 : n) * 100)
}
