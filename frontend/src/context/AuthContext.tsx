// AuthContext — SM-1 / SM-2 canonical auth state for the admin SPA.
//
// Owns: token, user (Me), capabilities, entities, orgNodes, plus login/logout.
//
// Why a context (not props):
//   * Pre-SM-1, `token` was prop-drilled to all 55+ views — every view's
//     signature started with `token: string`. Adding a 56th view required
//     threading the prop through App.tsx; replacing the storage strategy
//     (React state → cookie → context → ...) required touching every view.
//   * `capabilities` was redundantly fetched in 5 views (SM-2) because the
//     prop chain was easy to overlook. Same root cause.
//   * `useFetch<T>` (DF-1/DF-2) consumes the token via `useAuth()` so views
//     can fetch without knowing about auth at all.
//
// Why NOT prop persistence:
//   * Admin operators run one long session; we deliberately keep the token in
//     React state only — see `docs/standards/API_CLIENT_STANDARD.md` §4.
//   * The 401 listener (AC-3, in `App.tsx`) is the only state-clear path.
//
// Migration pattern for a view:
//   * Drop `token: string` from props.
//   * Replace `const { token } = ...` with `const { token } = useAuth()`.
//   * Replace `fetchCapabilities(token).then(setCaps)` with `const { capabilities } = useAuth()`.
//   * Replace `fetch(${BASE}/...)` / `bget(token, ...)` with `useFetch<T>(path)`.

import { createContext, useContext, useState, useCallback, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { type Capabilities, FULL_ACCESS } from '../lib/capabilities'

export type Me = {
  email: string
  name: string
  can_configure?: boolean
  avatar_url?: string | null
}

export type Entity = {
  key: string
  label: string
  label_plural: string
  route_slug: string
}

export type OrgNode = {
  id: string
  type: string
  name: string
  path: string
  code?: string
  parent_id?: string | null
}

export interface AuthState {
  token: string | null
  user: Me | null
  capabilities: Capabilities
  entities: Entity[]
  orgNodes: OrgNode[]
}

export interface AuthActions {
  // SetStateAction so callers can use the updater pattern (e.g.,
  // setUser(prev => prev ? { ...prev, avatar_url } : prev)) without losing
  // the dispatcher contract React's useState provides.
  setToken: Dispatch<SetStateAction<string | null>>
  setUser: Dispatch<SetStateAction<Me | null>>
  setCapabilities: Dispatch<SetStateAction<Capabilities>>
  setEntities: Dispatch<SetStateAction<Entity[]>>
  setOrgNodes: Dispatch<SetStateAction<OrgNode[]>>
  /** Convenience: clear every piece of auth state. Wired to `gaahex:auth-401`. */
  clearAuth: () => void
}

export type AuthContextValue = AuthState & AuthActions

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<Me | null>(null)
  const [capabilities, setCapabilities] = useState<Capabilities>(FULL_ACCESS)
  const [entities, setEntities] = useState<Entity[]>([])
  const [orgNodes, setOrgNodes] = useState<OrgNode[]>([])

  const clearAuth = useCallback(() => {
    setToken(null)
    setUser(null)
    setEntities([])
    setOrgNodes([])
    setCapabilities(FULL_ACCESS)
  }, [])

  const value: AuthContextValue = {
    token, user, capabilities, entities, orgNodes,
    setToken, setUser, setCapabilities, setEntities, setOrgNodes,
    clearAuth,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/**
 * Subscribe to the admin auth state.
 *
 * Throws if called outside `<AuthProvider>` — that's a developer error, not a
 * runtime fallback case. Every admin view renders inside the provider mounted
 * at the App root.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (ctx === null) {
    throw new Error('useAuth() called outside <AuthProvider>')
  }
  return ctx
}
