export const FIELD_TYPES = [
  'text', 'textarea', 'number', 'money', 'boolean', 'date', 'datetime',
  'email', 'phone', 'select', 'ref', 'status',
]

export class FetchError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

export type EntitySummary = {
  key: string; label: string; label_plural: string; route_slug: string;
  icon: string | null; status: string; order: number
}

export type FieldDef = {
  key: string; label: string; type: string; required: boolean;
  order: number; config: Record<string, any> | null
}

export type StatusDefT = { key: string; label: string; order: number; is_initial: boolean }

export type Transition = { from: string | null; to: string }

export type EntityDetail = {
  key: string; label: string; label_plural: string; route_slug: string; icon: string | null;
  fields: FieldDef[]; statuses: StatusDefT[]; transitions: Transition[]
}

export type DraftField = { key: string; label: string; type: string; required: boolean; extra: string }
export type DraftStatus = { key: string; label: string; is_initial: boolean }

export function configExtra(f: { type: string; config: Record<string, any> | null }): string {
  if (!f.config) return ''
  if (f.type === 'select' && Array.isArray(f.config.options)) return f.config.options.join(', ')
  if (f.type === 'ref' && f.config.target) return f.config.target
  return ''
}

export function buildConfig(type: string, extra: string): Record<string, any> | null {
  if (type === 'select' && extra.trim()) {
    return { options: extra.split(',').map((o) => o.trim()).filter(Boolean) }
  }
  if (type === 'ref' && extra.trim()) return { target: extra.trim() }
  return null
}
