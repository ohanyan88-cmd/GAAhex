// Users API helper — E32 contract: GET /api/users
// Uses bget/bpost from billing for consistent error handling.
import { bget, type Fetched } from './billing'

export type User = {
  id: string
  name?: string | null
  email?: string | null
  primary_node_id?: string | null
  [k: string]: any
}

/** List all users, optionally filtered by name/email query. */
export async function listUsers(token: string, q?: string): Promise<Fetched<User[]>> {
  const qs = q ? `?q=${encodeURIComponent(q)}` : ''
  return bget<User[]>(token, `/api/users${qs}`)
}

/** Resolve a user_id to a display name. Falls back to email, then short id. */
export function resolveUserName(user: User): string {
  if (user.name?.trim()) return user.name.trim()
  if (user.email?.trim()) return user.email.trim()
  return user.id.slice(0, 8)
}
