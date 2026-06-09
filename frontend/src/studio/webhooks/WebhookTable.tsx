// WebhookTable — the list table for webhooks.

import { Button, StatusPill } from '../../primitives'
import { EditIcon } from '../../components/icons'
import { Webhook } from './types'

export function WebhookTable({
  hooks,
  onOpen,
}: {
  hooks: Webhook[]
  onOpen: (id: string) => void
}) {
  return (
    <div className="grid-wrap">
      <table className="grid studio">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">URL</th>
            <th scope="col">Events</th>
            <th scope="col">Secret</th>
            <th scope="col">Status</th>
            <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {hooks.map((w) => (
            <tr
              key={w.id}
              style={{ cursor: 'pointer' }}
              onClick={() => onOpen(w.id)}
            >
              <td><strong>{w.name}</strong></td>
              <td>
                <span
                  className="mono"
                  title={w.url}
                  style={{ color: 'var(--gx-text-3)', fontSize: 'var(--gx-text-sm)' }}
                >
                  {w.url}
                </span>
              </td>
              <td>
                <span style={{ fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-2)' }}>
                  {w.events && w.events.length
                    ? w.events.join(', ')
                    : <span style={{ color: 'var(--gx-text-3)' }}>all</span>}
                </span>
              </td>
              <td>
                {w.has_secret
                  ? <StatusPill variant="active" label="signed" size="sm" />
                  : <span style={{ color: 'var(--gx-text-3)', fontSize: 'var(--gx-text-sm)' }}>none</span>}
              </td>
              <td>
                {w.active !== false
                  ? <StatusPill variant="active" label="enabled" size="sm" />
                  : <StatusPill variant="neutral" label="disabled" size="sm" />}
              </td>
              <td className="actions-col">
                <Button variant="ghost" size="sm"
                  type="button"
                  onClick={(ev) => { ev.stopPropagation(); onOpen(w.id) }}
                  aria-label={`Open ${w.name}`}
                >
                  <EditIcon size={13} />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
