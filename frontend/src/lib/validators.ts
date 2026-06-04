// VA-1 — shared frontend validators.
//
// Before this module every form re-implemented email/phone/date/amount
// checks inline. Now form code calls these helpers, returns the message
// string to its field state, and ships consistent error text across views.
//
// Design notes:
// * Each helper returns `null` on valid input, or a short user-facing message
//   on invalid input — no exceptions, no Promises.
// * Validators are intentionally permissive at the input edge (the backend
//   does the authoritative validation; this is the UX nudge). Phone validation
//   in particular is region-aware and only catches obvious typos.
// * When `react-hook-form` is adopted (see migration tracker in
//   docs/standards/SERVER_STATE_STANDARD.md), these become the registered
//   validators on each field — no API change.

export function validateRequired(value: string | number | null | undefined, label = 'Value'): string | null {
  if (value === null || value === undefined) return `${label} is required`
  if (typeof value === 'string' && value.trim() === '') return `${label} is required`
  return null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateEmail(value: string | null | undefined): string | null {
  if (!value) return null  // use validateRequired separately if needed
  return EMAIL_RE.test(value) ? null : 'Enter a valid email address'
}

// Permissive phone validation — accepts +country, spaces, dashes, parens; just
// counts the digits to catch typos. Backend / SMS gateway is the authority.
export function validatePhone(value: string | null | undefined): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  if (digits.length < 7) return 'Phone number looks too short'
  if (digits.length > 15) return 'Phone number looks too long'
  return null
}

// Major-AMD entered by a user; backend stores integer luma. Reject negatives,
// non-numeric input, and obviously-wrong magnitudes.
export function validateAmount(value: string | number | null | undefined, label = 'Amount'): string | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(n)) return `${label} must be a number`
  if (n < 0) return `${label} cannot be negative`
  if (!isFinite(n)) return `${label} is invalid`
  return null
}

// ISO-8601 date string (`YYYY-MM-DD`) or full datetime. Returns null if empty
// — pair with validateRequired for "required date" fields.
export function validateDate(value: string | null | undefined, label = 'Date'): string | null {
  if (!value) return null
  const t = new Date(value).getTime()
  if (isNaN(t)) return `${label} must be a valid date`
  return null
}

// Pair of dates where end must be >= start. Either may be empty — only checks
// when both are populated.
export function validateDateRange(start: string | null | undefined, end: string | null | undefined): string | null {
  if (!start || !end) return null
  const s = new Date(start).getTime()
  const e = new Date(end).getTime()
  if (isNaN(s) || isNaN(e)) return null  // let validateDate flag individual fields
  if (e < s) return 'End date cannot be before start date'
  return null
}

// Enum-style validator: pass the allowed values; helper checks membership.
export function validateOneOf<T extends string>(
  value: string | null | undefined,
  allowed: readonly T[],
  label = 'Value',
): string | null {
  if (!value) return null
  return (allowed as readonly string[]).includes(value)
    ? null
    : `${label} must be one of: ${allowed.join(', ')}`
}

// Compose: run multiple validators, return the FIRST error (consistent with
// react-hook-form's resolver semantics).
export function firstError(...errors: (string | null)[]): string | null {
  for (const e of errors) if (e !== null) return e
  return null
}
