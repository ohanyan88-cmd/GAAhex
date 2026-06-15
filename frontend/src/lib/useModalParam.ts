import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * URL-addressable modal state (§7). Binds an in-place detail modal's open target to a query param,
 * so the open modal is deep-linkable, shareable, and Back-button closable — without ever navigating
 * away from the page. Drop-in for `useState<string | null>(null)`:
 *
 *   const [detailId, setDetailId] = useModalParam('item')      // <-> ?item=<id>
 *   <Table onRowClick={(r) => setDetailId(r.id)} />
 *   {detailId && <DetailModal id={detailId} onClose={() => setDetailId(null)} />}
 *
 * The setter writes the URL IN PLACE (replace — no history spam); passing null/'' drops the param
 * (closes the modal). One source so every page gets URL-addressable modals the same way (Ph6 adopts).
 */
export function useModalParam(key: string): [string | null, (value: string | null) => void] {
  const [params, setParams] = useSearchParams()
  const value = params.get(key)
  const setValue = useCallback(
    (next: string | null) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          if (next == null || next === '') p.delete(key)
          else p.set(key, next)
          return p
        },
        { replace: true },
      )
    },
    [key, setParams],
  )
  return [value, setValue]
}
