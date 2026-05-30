// Publish registry — collects canvas/pane state for PublishSettings "Save draft".
// Each stateful pane registers a snapshot function on mount and unregisters on unmount.
// PublishSettings calls collectSnapshot() which invokes every registered function and
// merges the results into a single JSONB object for POST /api/studio/pages/{id}/versions.

type SnapshotFn = () => Record<string, unknown>

const registry = new Map<string, SnapshotFn>()

export function registerSnapshot(key: string, fn: SnapshotFn): void {
  registry.set(key, fn)
}

export function unregisterSnapshot(key: string): void {
  registry.delete(key)
}

export function collectSnapshot(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  registry.forEach((fn, key) => {
    try {
      out[key] = fn()
    } catch {
      // ignore individual pane errors — partial snapshot is better than no snapshot
    }
  })
  return out
}
