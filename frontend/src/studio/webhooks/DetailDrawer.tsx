// DetailDrawer — edit + secret rotation + deliveries log + test for a webhook.

import { useCallback, useEffect, useState } from 'react'
import { LoadingState, ErrorBanner, PermissionDenied } from '../../components/States'
import { Button, StatusPill, StudioDrawer } from '../../primitives'
import { useFetch } from '../../hooks/useFetch'
import { timeAgo } from '../../lib/time'
import {
  CheckIcon, EditIcon, TrashIcon,
  PlayIcon, RowsIcon, LockIcon, ActivityIcon,
} from '../../components/icons'
import { Webhook, Delivery, FetchError, apiFetch, EVENT_OPTIONS, mapDeliveryStatus } from './types'
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog'

// DR-4 — `DrawerShell` wraps the canonical `<StudioDrawer>` primitive.
function DrawerShell({
  onClose, title, children,
}: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <StudioDrawer open onClose={onClose} title={title} bodyPadding={20}>
      {children}
    </StudioDrawer>
  )
}

export function DetailDrawer({
  token, hookId, onClose, onChanged, onDeleted,
}: {
  token: string
  hookId: string
  onClose: () => void
  onChanged: () => void
  onDeleted: () => void
}) {
  const [hook, setHook] = useState<Webhook | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [denied, setDenied] = useState(false)

  // Editable buffers
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<string[]>([])
  const [active, setActive] = useState(true)
  const [newSecret, setNewSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState('')
  const [savedAt, setSavedAt] = useState<number | null>(null)

  // Test send
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<Delivery | null>(null)
  const [testErr, setTestErr] = useState('')

  // Deliveries
  const {
    data: deliveriesData,
    loading: deliveriesLoading,
    error: delErr,
    refetch: refetchDeliveries,
  } = useFetch<Delivery[]>(hookId ? `/api/webhooks/${hookId}/deliveries` : null)
  const deliveries = deliveriesLoading ? null : (Array.isArray(deliveriesData) ? deliveriesData : [])

  // Delete
  const [confirmDel, setConfirmDel] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteErr, setDeleteErr] = useState('')

  const load = useCallback(() => {
    let alive = true
    setLoadErr(''); setDenied(false)
    apiFetch<Webhook>(token, `/api/webhooks/${hookId}`)
      .then((w) => {
        if (!alive) return
        setHook(w)
        setName(w.name ?? '')
        setUrl(w.url ?? '')
        setEvents(w.events ?? [])
        setActive(w.active !== false)
      })
      .catch((ex) => {
        if (!alive) return
        if (ex instanceof FetchError && ex.status === 403) setDenied(true)
        else setLoadErr((ex as Error).message)
      })
    return () => { alive = false }
  }, [token, hookId])

  useEffect(() => { load() }, [load])

  function toggleEvent(ev: string) {
    setEvents(es => es.includes(ev) ? es.filter(x => x !== ev) : [...es, ev])
  }

  async function saveAll(opts: { rotate: boolean }) {
    if (!hook) return
    if (!name.trim() || !url.trim()) {
      setSaveErr('Name and URL cannot be empty.')
      return
    }
    setSaving(true); setSaveErr(''); setSavedAt(null)
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        url: url.trim(),
        events,
        active,
      }
      if (opts.rotate) {
        // Empty string clears the secret (unsigned); otherwise rotate to the new value.
        body.secret = newSecret.trim() || null
      }
      const updated = await apiFetch<Webhook>(token, `/api/webhooks/${hookId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      setHook(updated)
      setName(updated.name)
      setUrl(updated.url)
      setEvents(updated.events ?? [])
      setActive(updated.active !== false)
      if (opts.rotate) setNewSecret('')
      setSavedAt(Date.now())
      onChanged()
    } catch (ex) {
      setSaveErr((ex as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function runTest() {
    setTesting(true); setTestErr(''); setTestResult(null)
    try {
      const d = await apiFetch<Delivery>(token, `/api/webhooks/${hookId}/test`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
      setTestResult(d)
      // Refresh the delivery log so the new attempt shows up at the top.
      refetchDeliveries()
    } catch (ex) {
      setTestErr((ex as Error).message)
    } finally {
      setTesting(false)
    }
  }

  async function doDelete() {
    setDeleting(true); setDeleteErr('')
    try {
      await apiFetch(token, `/api/webhooks/${hookId}`, { method: 'DELETE' })
      onDeleted()
    } catch (ex) {
      setDeleteErr((ex as Error).message)
      setDeleting(false)
    }
  }

  return (
    <DrawerShell onClose={onClose} title={hook ? hook.name : 'Loading…'}>
      {denied && <PermissionDenied message="You don't have permission to view this webhook." />}
      {loadErr && <ErrorBanner message={loadErr} onRetry={load} />}
      {!hook && !loadErr && !denied && <LoadingState />}

      {hook && (
        <>
          <div className="section-head" style={{ marginTop: 'var(--gx-space-2)' }}>
            <RowsIcon size={15} className="section-icon" /> Endpoint
          </div>
          <label className="field">
            <span>Name *</span>
            <input
              className="inp inp-sm" value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="field" style={{ marginTop: 'var(--gx-space-4)' }}>
            <span>URL *</span>
            <input
              className="inp inp-sm mono" value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>

          <div className="section-head" style={{ marginTop: 'var(--gx-space-8)' }}>
            <ActivityIcon size={15} className="section-icon" /> Event subscriptions
          </div>
          <p className="hint" style={{ margin: '0 0 var(--gx-space-4)' }}>
            Empty = receive all events.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--gx-space-3)' }}>
            {EVENT_OPTIONS.map((ev) => {
              const on = events.includes(ev)
              return (
                <button
                  key={ev}
                  type="button"
                  className={'btn btn-sm ' + (on ? 'btn-primary' : 'btn-ghost')}
                  onClick={() => toggleEvent(ev)}
                  style={{ fontFamily: 'var(--gx-font-mono, monospace)', fontSize: 'var(--gx-text-11)' }}
                >
                  {ev}
                </button>
              )
            })}
          </div>

          <div className="section-head" style={{ marginTop: 'var(--gx-space-8)' }}>
            <CheckIcon size={15} className="section-icon" /> Status
          </div>
          <label className="row" style={{ gap: 'var(--gx-space-3)', alignItems: 'center' }}>
            <input
              type="checkbox" checked={active}
              onChange={(e) => setActive(e.target.checked)}
              id={`webhook-active-${hookId}`}
            />
            <span>Active — fires deliveries on subscribed events.</span>
          </label>

          {saveErr && <div style={{ marginTop: 'var(--gx-space-5)' }}><ErrorBanner message={saveErr} /></div>}
          {savedAt && (
            <div
              style={{
                marginTop: 'var(--gx-space-5)', padding: 'var(--gx-space-3)',
                border: '1px solid var(--gx-border)',
                borderRadius: 'var(--gx-radius-md)',
                background: 'var(--gx-success-soft, var(--gx-surface-2))',
                color: 'var(--gx-text-1)', fontSize: 'var(--gx-text-sm)',
              }}
            >
              Saved {timeAgo(new Date(savedAt).toISOString())}.
            </div>
          )}

          <div className="row" style={{ marginTop: 'var(--gx-space-4)', gap: 'var(--gx-space-4)' }}>
            <span className="spacer" />
            <Button variant="primary" size="md"
            type="button"
              onClick={() => saveAll({ rotate: false })}
              disabled={saving}
            >
              <CheckIcon size={13} /> {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>

          <div className="section-head" style={{ marginTop: 22 }}>
            <LockIcon size={15} className="section-icon" /> Signing secret
          </div>
          <div
            style={{
              padding: 'var(--gx-space-4)',
              border: '1px solid var(--gx-border)',
              borderRadius: 'var(--gx-radius-md)',
              background: 'var(--gx-surface-2)',
            }}
          >
            <div style={{ marginBottom: 'var(--gx-space-3)', display: 'flex', alignItems: 'center', gap: 'var(--gx-space-4)' }}>
              <strong>Current state</strong>
              {hook.has_secret
                ? <StatusPill variant="active" label="signed" size="sm" />
                : <span className="hint">unsigned</span>}
            </div>
            <p className="hint" style={{ margin: '0 0 var(--gx-space-5)' }}>
              The secret is never returned by the API. Set a new value to rotate it; clear and rotate
              to disable signing.
            </p>
            <label className="field">
              <span>New secret</span>
              <input
                className="inp inp-sm mono" value={newSecret}
                onChange={(e) => setNewSecret(e.target.value)}
                placeholder="(blank to clear)"
              />
            </label>
            <div className="row" style={{ marginTop: 'var(--gx-space-5)', gap: 'var(--gx-space-4)' }}>
              <span className="spacer" />
              <Button variant="secondary" size="md"
            type="button"
                onClick={() => saveAll({ rotate: true })}
                disabled={saving}
              >
                <LockIcon size={13} /> {saving ? 'Rotating…' : (newSecret.trim() ? 'Rotate secret' : 'Clear secret')}
              </Button>
            </div>
          </div>

          <div className="section-head" style={{ marginTop: 22 }}>
            <PlayIcon size={15} className="section-icon" /> Test delivery
          </div>
          <p className="hint" style={{ margin: '0 0 var(--gx-space-4)' }}>
            Sends a sample <code className="mono">test</code> event to this endpoint and records the
            attempt in the delivery log.
          </p>
          {testErr && <ErrorBanner message={testErr} />}
          {testResult && (
            <div
              style={{
                marginBottom: 'var(--gx-space-5)', padding: 'var(--gx-space-5)',
                border: '1px solid var(--gx-border)',
                borderRadius: 'var(--gx-radius-md)',
                background: 'var(--gx-surface-2)',
                fontSize: 'var(--gx-text-sm)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-3)', marginBottom: 'var(--gx-space-2)' }}>
                <strong>Test result</strong>
                <StatusPill {...mapDeliveryStatus(testResult.status)} size="sm" />
                {testResult.status_code != null && (
                  <span className="hint mono">HTTP {testResult.status_code}</span>
                )}
              </div>
              {testResult.error && (
                <div className="hint" style={{ wordBreak: 'break-word' }}>{testResult.error}</div>
              )}
            </div>
          )}
          <Button variant="secondary" size="sm"
            type="button"
            onClick={runTest} disabled={testing}>
            <PlayIcon size={13} /> {testing ? 'Sending…' : 'Send test event'}
          </Button>

          <div className="section-head" style={{ marginTop: 22 }}>
            <ActivityIcon size={15} className="section-icon" /> Delivery log
          </div>
          {delErr && <ErrorBanner message={delErr} onRetry={refetchDeliveries} />}
          {!deliveries && !delErr && <LoadingState />}
          {deliveries && deliveries.length === 0 && (
            <p className="hint" style={{ margin: 0 }}>No deliveries yet.</p>
          )}
          {deliveries && deliveries.length > 0 && (
            <div className="grid-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th scope="col">Event</th>
                    <th scope="col">Status</th>
                    <th scope="col">Code</th>
                    <th scope="col">Attempts</th>
                    <th scope="col">When</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((d) => {
                    const sp = mapDeliveryStatus(d.status)
                    return (
                      <tr key={d.id}>
                        <td><code className="mono">{d.event_type ?? '—'}</code></td>
                        <td>
                          <StatusPill variant={sp.variant} label={sp.label} size="sm" />
                          {d.error && (
                            <div
                              style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)', marginTop: 'var(--gx-space-1)' }}
                              title={d.error}
                            >
                              {d.error.length > 60 ? d.error.slice(0, 60) + '…' : d.error}
                            </div>
                          )}
                        </td>
                        <td className="mono">{d.status_code ?? '—'}</td>
                        <td className="tnum">{d.attempts ?? '—'}</td>
                        <td>{timeAgo(d.created_at ?? null)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="section-head" style={{ marginTop: 22 }}>
            <TrashIcon size={15} className="section-icon" /> Danger zone
          </div>
          <div
            style={{
              padding: 'var(--gx-space-7)',
              border: '1px solid var(--gx-border)',
              borderRadius: 'var(--gx-radius-md)',
              background: 'var(--gx-surface-2)',
            }}
          >
            <div style={{ marginBottom: 'var(--gx-space-4)' }}>
              <strong>Delete this webhook</strong>
            </div>
            <p className="hint" style={{ margin: '0 0 var(--gx-space-5)' }}>
              Hard-delete <strong>{hook.name}</strong>. Future events will no longer be delivered.
              To temporarily stop deliveries instead, uncheck <strong>Active</strong> above and Save.
            </p>
            <Button variant="danger" size="sm"
            type="button"
              onClick={() => setConfirmDel(true)}
            >
              <TrashIcon size={13} /> Delete webhook
            </Button>
          </div>
        </>
      )}

      {confirmDel && hook && (
        <ConfirmDeleteDialog
          hookName={hook.name}
          onCancel={() => setConfirmDel(false)}
          onConfirm={doDelete}
          deleting={deleting}
          err={deleteErr}
        />
      )}
    </DrawerShell>
  )
}
