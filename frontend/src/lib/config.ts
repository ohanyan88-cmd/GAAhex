// Single source of truth for the API base URL.
// Reads from VITE_API_BASE at build time; falls back to localhost for dev.
// `import.meta.env` is injected by Vite; cast through `any` to avoid requiring
// the vite/client ambient types in tsconfig.
const env = ((import.meta as any).env ?? {}) as Record<string, string | undefined>
export const BASE: string = env.VITE_API_BASE ?? 'http://127.0.0.1:8099'

// Resolve a server asset reference for an <img src>. A served upload path (e.g.
// "/uploads/logos/x.png") is relative to the API origin, NOT the page origin — in dev the
// frontend runs on a different port (:5173) than the backend (:8099), so a bare relative path
// would 404 against the dev server. Prefix those with BASE. Absolute references — data: URLs,
// blob: object URLs, and http(s): URLs — are already self-resolving and pass through unchanged.
export function assetUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  return url.startsWith('/') ? `${BASE}${url}` : url
}
