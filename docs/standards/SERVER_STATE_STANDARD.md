# Server-State Standard

**Status**: LOCKED · Phase 6 deliverable
**Owner**: Architecture / Frontend
**Last updated**: 2026-06-04

How GAAhex view components fetch data from the backend.

---

## 1. The canonical hooks

| Hook | When | Returns |
|---|---|---|
| `useFetch<T>(path)` | Raw access — when the response shape doesn't fit the legacy `Fetched<T>` state machine or you need to transform the body | `{ data, loading, ok, status, error, refetch }` |
| `useFetched<T>(path, predicate?)` | Migration of existing `Fetched<T>`-style views — same discriminated-union return shape so component bodies don't have to change | `{ state: 'loading' } \| { state: 'ok'; value: T } \| { state: 'hide' } \| { state: 'error' }` |

Both live in `frontend/src/hooks/useFetch.ts`. Both consume the token from
`<AuthProvider>` via `useAuth()` — **do not pass a token prop to a hook
caller**.

## 2. Forbidden patterns (Phase 6 lint will enforce)

* **`let alive = true; ... return () => { alive = false }`** — the hooks own
  the alive guard now. Writing your own re-introduces the bug the canonical
  fixed.
* **`useEffect + fetch + setState`** — same pattern, different surface. Use
  `useFetch` / `useFetched`.
* **Raw `fetch(${BASE}/...)`** — goes through `lib/billing.ts` `bget`/`bpost`
  (see `docs/standards/API_CLIENT_STANDARD.md`). The hooks themselves go
  through `bget` internally so 401s land in the centralized intercept.
* **Per-view `fetchCapabilities(token)`** — capabilities flow through
  `AuthContext` (`useAuth().capabilities`).

## 3. Migration pattern

Before:

```tsx
type Fetched<T> = { state: 'loading' } | { state: 'ok'; value: T } | { state: 'hide' }

function MyView({ token }: { token: string }) {
  const [overview, setOverview] = useState<Fetched<MyData>>({ state: 'loading' })

  useEffect(() => {
    let alive = true
    fetch(`${BASE}/api/foo`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (alive) setOverview(d ? { state: 'ok', value: d } : { state: 'hide' }) })
      .catch(() => { if (alive) setOverview({ state: 'hide' }) })
    return () => { alive = false }
  }, [token])

  return <div>{overview.state === 'ok' ? overview.value.label : null}</div>
}
```

After:

```tsx
import { useAuth } from '../context/AuthContext'
import { useFetched } from '../hooks/useFetch'

function MyView() {
  // Auth from context; no token prop. Capabilities likewise.
  const overview = useFetched<MyData>('/api/foo')

  return <div>{overview.state === 'ok' ? overview.value.label : null}</div>
}
```

The component body (`overview.state === 'ok' ? ...`) does not change.

## 4. Custom predicates — when a 2xx response should still hide

Many endpoints return an empty array or zero-total object for "nothing to
show." `useFetched` accepts an optional predicate to collapse that into the
`hide` state at the hook layer instead of pushing the check into every JSX
branch:

```ts
const trend = useFetched<TrendBucket[]>(
  '/api/analytics/revenue-trend',
  (d) => Array.isArray(d) && d.length > 0,
)
// trend.state === 'hide' for an empty array too.
```

## 5. Composite fetches — fall back to `useFetch` + `useMemo`

When a widget needs to combine 2+ endpoints, or extract / reshape the
response, drop down to `useFetch` and use `useMemo` for the transform:

```ts
const weeklyRaw = useFetch<WeeklyBucket[]>(`/api/analytics/weekly-trend?weeks=${weeksN}`)
const customerData: Fetched<CustomerData> = useMemo(() => {
  if (weeklyRaw.loading) return { state: 'loading' }
  if (!weeklyRaw.ok || !Array.isArray(weeklyRaw.data) || weeklyRaw.data.length === 0) return { state: 'hide' }
  return {
    state: 'ok',
    value: {
      labels:  weeklyRaw.data.map((b) => String(b.week)),
      new_:    weeklyRaw.data.map((b) => Number(b.customers) || 0),
      churned: weeklyRaw.data.map((b) => Number(b.churns) || 0),
    },
  }
}, [weeklyRaw.loading, weeklyRaw.ok, weeklyRaw.data])
```

For **N parallel** fetches with shared `Promise.all`, a custom `useEffect` is
still acceptable today — `useFetches([path1, path2, ...])` may land later.

## 6. Conditional fetches — pass `null` to skip

```ts
const detail = useFetch<Detail>(selectedId ? `/api/items/${selectedId}` : null)
```

When `path` is `null`, the hook returns `{ data: null, loading: false, ... }`
without firing any network request. As soon as `path` becomes a string the
fetch triggers.

## 7. Refetching

`refetch()` is returned from both hooks. Call it after a mutation:

```ts
const orders = useFetched<Order[]>('/api/orders', (d) => Array.isArray(d))

async function deleteOrder(id: string) {
  await bdel(token, `/api/orders/${id}`)
  orders.refetch()  // tell the hook to re-issue its GET
}
```

(Note: `useFetched` doesn't expose `refetch` — drop to `useFetch` when you
need it. A future revision may expose it on both.)

## 8. The 401 path

When any hooked fetch encounters a 401, `lib/billing.ts`'s `intercept401`
dispatches `gaahex:auth-401`. `App.tsx`'s listener calls `clearAuth()` from
the context, which clears token / user / capabilities / entities / orgNodes.
The view re-renders with `token === null` → login screen. No per-view
handling required.

## 9. Adoption tracker

| View | Status | Alive guards killed | Raw fetches killed |
|---|---|---|---|
| `DashboardView.tsx` | ✅ Vertical slice (2026-06-04) | 22 of 23 (funnel keeps 1 for parallel fetches) | 21 of 25 |
| All others | ⬜ TODO — incremental migration | — | — |

**Remaining repo counts** (2026-06-04 after DashboardView migration):
* `let alive = true` patterns: 54 across `frontend/src/`
* Raw `fetch(\`${BASE}...)` calls: 96 across `frontend/src/`

Each view migration follows the pattern in §3 above. Phase 6 lint will block
any new `let alive` or raw `fetch(${BASE})` introduction so the remaining
tail shrinks monotonically.
