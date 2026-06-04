// useFetch<T> — DF-1 / DF-2 / AC-2 canonical data-fetching hook.
//
// Replaces the `useEffect + fetch + setState + alive guard` pattern that
// historically appeared 78 times across ~20 view files. One hook owns:
//
//   * the alive guard (no setState-after-unmount warnings)
//   * loading / error / data state machine
//   * automatic re-fetch when path changes
//   * manual refetch() escape hatch
//   * automatic 401 handling (the canonical fetch wrappers already dispatch
//     `gaahex:auth-401` — see `lib/billing.ts`)
//
// Use:
//   const { data, loading, ok, status, error, refetch } = useFetch<MyShape>('/api/foo')
//
// Conditional fetching (skip until ready):
//   const { data } = useFetch<MyShape>(id ? `/api/foo/${id}` : null)
//
// Migration: see `docs/standards/SERVER_STATE_STANDARD.md` and the
// vertical-slice example in `views/DashboardView.tsx`.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { bget } from '../lib/billing'

export interface FetchResult<T> {
  /** Parsed response body. `null` while loading, on non-2xx, or when path was null. */
  data: T | null
  /** True until the first response (or skip) resolves. */
  loading: boolean
  /** HTTP status. 0 before the first response; 0 again on a network error. */
  status: number
  /** `true` if `status` is 2xx. */
  ok: boolean
  /** Network or parse error message. `null` on success or while loading. */
  error: string | null
  /** Trigger an immediate re-fetch using the current path. No-op when path is null. */
  refetch: () => void
}

const INITIAL: Omit<FetchResult<unknown>, 'refetch'> = {
  data: null,
  loading: true,
  status: 0,
  ok: false,
  error: null,
}

/**
 * Fetch JSON from a path on the backend.
 *
 * `path` can be `null` to skip fetching (useful for fetches that depend on
 * an id or other gating state). When `path` changes the hook re-fetches; the
 * previous request's response is discarded via the internal alive guard.
 *
 * Auth is consumed from `<AuthProvider>` via `useAuth()` — callers do NOT
 * pass a token prop.
 */
export function useFetch<T = unknown>(path: string | null): FetchResult<T> {
  const { token } = useAuth()
  const [state, setState] = useState<Omit<FetchResult<T>, 'refetch'>>(INITIAL as Omit<FetchResult<T>, 'refetch'>)
  const [tick, setTick] = useState(0)
  const aliveRef = useRef(true)

  const refetch = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    aliveRef.current = true

    if (path === null || !token) {
      // Skip: no path, or pre-login. Settle into a non-loading "empty" state.
      setState({ data: null, loading: false, status: 0, ok: false, error: null })
      return () => { aliveRef.current = false }
    }

    setState((s) => ({ ...s, loading: true, error: null }))

    bget<T>(token, path).then((res) => {
      if (!aliveRef.current) return
      setState({
        data: res.data,
        loading: false,
        status: res.status,
        ok: res.ok,
        error: res.ok ? null : `Request failed (${res.status})`,
      })
    }).catch((err) => {
      if (!aliveRef.current) return
      setState({
        data: null,
        loading: false,
        status: 0,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    })

    return () => { aliveRef.current = false }
  }, [path, token, tick])

  return { ...state, refetch }
}


// ── useFetched: adapter for the legacy Fetched<T> state machine ──────────────
//
// Many existing views model fetched data as a discriminated union:
//   type Fetched<T> = { state: 'loading' } | { state: 'ok'; value: T } | { state: 'hide' } | { state: 'error' }
// and gate UI on `if (x.state === 'ok')`. This adapter lets those views adopt
// useFetch without rewriting hundreds of `.state === 'ok'` checks.
//
// `predicate` is an optional "show only if" filter — e.g., pass
// `(d) => Array.isArray(d) && d.length > 0` to collapse "empty array" into
// `hide`. When predicate returns false the result is `hide`.

export type Fetched<T> =
  | { state: 'loading' }
  | { state: 'ok'; value: T }
  | { state: 'hide' }
  | { state: 'error'; message?: string }

export function useFetched<T = unknown>(
  path: string | null,
  predicate?: (data: T) => boolean,
): Fetched<T> {
  const { data, loading, ok, error } = useFetch<T>(path)
  if (loading) return { state: 'loading' }
  if (error || !ok) return { state: 'hide' }
  if (data === null || data === undefined) return { state: 'hide' }
  if (predicate && !predicate(data)) return { state: 'hide' }
  return { state: 'ok', value: data }
}
