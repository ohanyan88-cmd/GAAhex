// Single source of truth for the API base URL.
// Reads from VITE_API_BASE at build time; falls back to localhost for dev.
// `import.meta.env` is injected by Vite; cast through `any` to avoid requiring
// the vite/client ambient types in tsconfig.
const env = ((import.meta as any).env ?? {}) as Record<string, string | undefined>
export const BASE: string = env.VITE_API_BASE ?? 'http://127.0.0.1:8099'
