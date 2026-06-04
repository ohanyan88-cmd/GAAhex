# Auth Context Standard

**Status**: LOCKED · Phase 6 deliverable
**Owner**: Architecture / Frontend
**Last updated**: 2026-06-04

How GAAhex view components access the admin authentication session.

---

## 1. The single source of truth

`frontend/src/context/AuthContext.tsx` owns:

* `token: string | null` — the current bearer token (null = logged out)
* `user: Me | null` — the authenticated operator's profile
* `capabilities: Capabilities` — the role's permission map
* `entities: Entity[]` — the tenant's entity registry
* `orgNodes: OrgNode[]` — the tenant's org tree

…plus setters and a `clearAuth()` convenience for the 401 listener.

`<AuthProvider>` is mounted in `main.tsx` around `<App />`. `App.tsx` is the
only component that calls login / logout flows on it; every other view that
needs auth state calls `useAuth()` and reads what it needs.

## 2. Forbidden patterns (Phase 6 lint will enforce)

* **`token: string` in a view's props** — the admin SPA used to prop-drill
  token to 55+ views; that pattern is dead. Use `useAuth()`.
* **`useState<string | null>(null)` for a session token** — there's exactly
  one piece of session state, and it lives in the provider.
* **Direct `localStorage.getItem('...token...')`** — the admin SPA
  deliberately does not persist; see `API_CLIENT_STANDARD.md` §4.
* **`fetchCapabilities(token).then(setCaps)`** in a view body — capabilities
  come from `useAuth().capabilities` (or, during the migration window, from
  a `capabilities?: Capabilities` prop App.tsx still threads). Never fetch
  again per-view.

## 3. Migration pattern

Before:

```tsx
function MyView({ token, capabilities }: { token: string; capabilities?: Capabilities }) {
  const caps = capabilities ?? FULL_ACCESS
  // ...
}

// in App.tsx:
<MyView token={token} capabilities={capabilities} />
```

After:

```tsx
import { useAuth } from '../context/AuthContext'

function MyView() {
  const { token, capabilities } = useAuth()
  // token: string | null  — handle the null case if the view can render pre-login;
  //                          most app-shell views can't, so a check at the top is fine.
  // capabilities: Capabilities  — never null, defaults to FULL_ACCESS until populated.
  // ...
}

// in App.tsx:
<MyView />
```

## 4. The 401 wiring

`lib/billing.ts:intercept401` dispatches `gaahex:auth-401` on any 401
response from `bget` / `send`. `App.tsx` mounts a listener:

```ts
useEffect(() => {
  const onAuth401 = () => { clearAuth(); setView({ type: 'home' }) }
  window.addEventListener('gaahex:auth-401', onAuth401)
  return () => window.removeEventListener('gaahex:auth-401', onAuth401)
}, [clearAuth])
```

`clearAuth()` (from the context) zeros out `token` / `user` / `entities` /
`orgNodes` and resets `capabilities` to `FULL_ACCESS`. The `if (!token)`
gate at the top of `App.tsx`'s render flips back to the login screen.

## 5. Why not `Dispatch<SetStateAction<T>>` (or why yes)

The context exposes the `Dispatch<SetStateAction<...>>` shape from React's
`useState` so callers can still use updater functions:

```ts
const { setUser } = useAuth()
setUser((prev) => prev ? { ...prev, avatar_url } : prev)
```

This is the same contract a local `useState` would give. The only thing
that changes is the storage location.

## 6. Adoption tracker

| View | Status |
|---|---|
| `App.tsx` | ✅ migrated (2026-06-04) — reads via `useAuth()`, login/logout call setters |
| `DashboardView.tsx` | ✅ migrated (2026-06-04) — vertical slice |
| All others | ⬜ TODO — incremental |

Each view migration:
1. Drop `token` from props.
2. Add `const { token, capabilities } = useAuth()`.
3. Remove `token={token}` from the call site in `App.tsx`.
4. If the view was also passing `token` to children, repeat 1-3 there.

The migration is **monotonic** — each step removes a prop, never adds one.
