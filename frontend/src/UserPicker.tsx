// UserPicker — reusable assignee <select> backed by GET /api/users.
// Loads once per mount; maps id → display name; emits chosen user_id.
// Used by WorkItemsView (and later by coordinator in HelpdeskView).
import { useEffect, useState } from 'react'
import { listUsers, resolveUserName, type User } from './users'

export interface UserPickerProps {
  token: string
  value: string           // user_id or '' for Unassigned
  onChange: (userId: string) => void
  className?: string
  disabled?: boolean
  'aria-label'?: string
}

// A cache shared across all mounted pickers in the same session.
// Avoids redundant fetches when multiple pickers appear (e.g. in modal + table).
let userCache: User[] | null = null
let userCacheToken: string = ''

export default function UserPicker({
  token,
  value,
  onChange,
  className = 'inp inp-md',
  disabled = false,
  'aria-label': ariaLabel = 'Assignee',
}: UserPickerProps) {
  const [users, setUsers] = useState<User[]>(
    token === userCacheToken && userCache ? userCache : [],
  )
  const [loading, setLoading] = useState(users.length === 0)

  useEffect(() => {
    if (token === userCacheToken && userCache) {
      setUsers(userCache)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    listUsers(token).then((res) => {
      if (cancelled) return
      const list = res.ok && Array.isArray(res.data) ? res.data : []
      userCache = list
      userCacheToken = token
      setUsers(list)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [token])

  return (
    <select
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled || loading}
      aria-label={ariaLabel}
    >
      <option value="">{loading ? 'Loading users…' : 'Unassigned'}</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>{resolveUserName(u)}</option>
      ))}
    </select>
  )
}

/** Resolve a user_id to a display name given a loaded user list. */
export function resolveUserDisplay(userId: string | null | undefined, users: User[]): string {
  if (!userId) return '—'
  const u = users.find((x) => x.id === userId)
  if (!u) return userId.slice(0, 8)
  return resolveUserName(u)
}
