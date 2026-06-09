// NotifDefTable — the list table for notification defs.

import { Button } from '../../primitives'
import { EditIcon, CheckIcon, ZapIcon } from '../../components/icons'
import { NotifDef } from './types'

export function NotifDefTable({
  defs,
  onOpen,
}: {
  defs: NotifDef[]
  onOpen: (key: string) => void
}) {
  return (
    <div className="grid-wrap">
      <table className="grid studio">
        <thead>
          <tr>
            <th scope="col">Key</th>
            <th scope="col">Label</th>
            <th scope="col">Channel</th>
            <th scope="col">Category</th>
            <th scope="col">Priority</th>
            <th scope="col">Enabled</th>
            <th scope="col">Rule</th>
            <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {defs.map((d) => (
            <tr
              key={d.key}
              style={{ cursor: 'pointer' }}
              onClick={() => onOpen(d.key)}
            >
              <td><code className="mono">{d.key}</code></td>
              <td>{d.label}</td>
              <td><span className="hint mono">{d.channel}</span></td>
              <td><span className="hint">{d.category}</span></td>
              <td><span className="hint">{d.priority}</span></td>
              <td>{d.enabled ? <CheckIcon size={13} /> : <span className="hint">—</span>}</td>
              <td>
                {d.gxl_condition ? (
                  <span
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 'var(--gx-space-2)',
                      padding: 'var(--gx-space-1) var(--gx-space-3)',
                      border: '1px solid var(--gx-border)',
                      borderRadius: 'var(--gx-radius-sm, 4px)',
                      background: 'var(--gx-surface-2)',
                      fontFamily: 'var(--gx-font-mono, monospace)', fontSize: 'var(--gx-text-11)',
                      color: 'var(--gx-text-2)',
                    }}
                    title={d.gxl_condition}
                  >
                    <ZapIcon size={11} /> rule
                  </span>
                ) : <span className="hint">—</span>}
              </td>
              <td className="actions-col">
                <Button variant="ghost" size="sm"
                  type="button"
                  onClick={(ev) => { ev.stopPropagation(); onOpen(d.key) }}
                  aria-label={`Open ${d.label}`}
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
