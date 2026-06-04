// VA-4 — canonical mutation-error renderer.
//
// FastAPI 422 responses come in two shapes:
//   * Validation error: `detail: [{ loc: [...], msg: '...', type: '...' }, ...]`
//   * Domain error:     `detail: '<string>'` or `detail: { code: '...', message: '...' }`
//
// Every form view used to try/catch and `setError(err.message)` directly,
// which loses the field-level structure and surfaces an unfriendly raw string.
// This helper:
//   * extracts the human message from any of the shapes,
//   * optionally calls a `toast.error` if a Toast surface is passed,
//   * returns the message so the caller can also set it inline if it wants.
//
// Usage:
//   try {
//     await bpost(token, '/api/foo', body)
//   } catch (err) {
//     handleMutationError(err, 'Create failed', toast.error)
//   }

export interface FieldError {
  field: string         // dotted path like "lines.0.amount"
  message: string
}

export interface MutationError {
  message: string
  fields: FieldError[]
}

type ToastFn = (message: string) => void

/**
 * Parse a thrown error from `bget`/`bpost`/`bpatch`/`bput`/`bdel` (or raw
 * fetch) into a structured shape. If `toast` is provided, also display the
 * top-level message via that callback (typically `toast.error`).
 *
 * Returns the parsed error so the caller can set inline field-level state.
 */
export function handleMutationError(
  err: unknown,
  fallback = 'Request failed',
  toast?: ToastFn,
): MutationError {
  const parsed = parseError(err, fallback)
  if (toast) toast(parsed.message)
  return parsed
}

function parseError(err: unknown, fallback: string): MutationError {
  // Errors thrown by `lib/billing.ts:send` carry a `.status` property and a
  // message that's already extracted from `detail` (string or stringified
  // dict). For the basic case, that's enough.
  if (err instanceof Error) {
    const message = err.message || fallback
    // Try to parse a stringified detail array back into field errors.
    const fields = tryParseFieldErrors(message)
    return { message: fieldSummary(fields, message), fields }
  }
  if (typeof err === 'string') return { message: err || fallback, fields: [] }
  return { message: fallback, fields: [] }
}

function tryParseFieldErrors(message: string): FieldError[] {
  // FastAPI 422 detail looks like `[{"loc":["body","amount"],"msg":"...","type":"..."}, ...]`
  // when stringified. If the message starts with `[{` and parses as JSON, extract.
  if (!message.startsWith('[{') && !message.startsWith('[')) return []
  try {
    const arr = JSON.parse(message)
    if (!Array.isArray(arr)) return []
    return arr
      .map((item): FieldError | null => {
        if (!item || typeof item !== 'object') return null
        const loc = Array.isArray(item.loc) ? item.loc : []
        const field = loc.filter((p: unknown) => p !== 'body').join('.')
        const msg = typeof item.msg === 'string' ? item.msg : ''
        if (!field || !msg) return null
        return { field, message: msg }
      })
      .filter((x): x is FieldError => x !== null)
  } catch {
    return []
  }
}

function fieldSummary(fields: FieldError[], original: string): string {
  if (fields.length === 0) return original
  if (fields.length === 1) return `${fields[0].field}: ${fields[0].message}`
  return `${fields.length} field errors — see the form for details`
}
