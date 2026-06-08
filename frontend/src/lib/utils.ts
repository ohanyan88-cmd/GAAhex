/** User-initials abbreviation: "John Doe" → "JD", "Alice" → "A". */
export function initialsOf(name: string | null | undefined, fallback = 'U'): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return fallback
  return parts.map(w => w[0]).join('').slice(0, 2).toUpperCase()
}
