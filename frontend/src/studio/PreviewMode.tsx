// GAAhex Studio — Preview Mode pane.
// Extracted from StudioRichPanes.tsx. Behavior unchanged.

import React, { useState, useEffect } from 'react'
import { Eye, Monitor, Smartphone, Tablet } from 'lucide-react'
import { BASE } from '../lib/billing'
import { Sec, type Device } from './_shared'

export function PreviewMode({ token }: { token?: string } = {}) {
  const [device, setDevice] = useState<Device>('desktop')
  const [role, setRole] = useState('Admin')
  const [roles, setRoles] = useState<string[]>(['Admin', 'Manager', 'Agent', 'Field Tech', 'Guest'])

  useEffect(() => {
    if (!token) return
    fetch(`${BASE}/api/roles`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const names: string[] = Array.isArray(data) ? data.map((r: any) => r.name || r.key).filter(Boolean) : []
        if (names.length > 0) setRoles(names)
      })
      .catch(() => {/* keep defaults */})
  }, [token])

  const W = device === 'desktop' ? '100%' : device === 'tablet' ? 640 : 360

  return (
    <div>
      <Sec
        icon={<Eye size={15} />}
        title="Preview Mode"
        hint="preview as device & as different user roles"
        right={
          <div style={{ display: 'flex', gap: 'var(--gx-space-4)' }}>
            <select
              className="inp inp-sm"
              style={{ width: 130 }}
              value={role}
              onChange={e => setRole(e.target.value)}
            >
              {roles.map(r => <option key={r}>{r}</option>)}
            </select>
            <div className="seg">
              {([['desktop', <Monitor size={13} />], ['tablet', <Tablet size={13} />], ['mobile', <Smartphone size={13} />]] as [Device, React.ReactNode][]).map(
                ([d, ic]) => (
                  <button key={d} className={device === d ? 'on' : ''} type="button" onClick={() => setDevice(d)}>
                    {ic}
                  </button>
                ),
              )}
            </div>
          </div>
        }
      />
      <div className="card" style={{ padding: 'var(--gx-space-5)', background: 'var(--gx-bg-subtle)' }}>
        <div
          style={{
            width: W,
            margin: '0 auto',
            transition: 'width var(--gx-dur-base)',
            background: 'var(--gx-surface)',
            border: '1px solid var(--gx-border)',
            borderRadius: 'var(--gx-radius-lg)',
            overflow: 'hidden',
            boxShadow: 'var(--gx-shadow-md)',
          }}
        >
          {/* browser chrome */}
          <div style={{ height: 38, borderBottom: '1px solid var(--gx-border-subtle)', display: 'flex', alignItems: 'center', gap: 'var(--gx-space-3)', padding: '0 var(--gx-space-6)' }}>
            <span style={{ display: 'flex', gap: 5 }}>
              {['var(--gx-danger)', 'var(--gx-warning)', 'var(--gx-success)'].map((c, i) => (
                <span key={i} style={{ width: 'var(--gx-space-4)', height: 'var(--gx-space-4)', borderRadius: '50%', background: c }} />
              ))}
            </span>
            <span className="mono" style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)' }}>gaahex.app</span>
            <span className="pill pill-gold" style={{ marginLeft: 'auto', height: 'var(--gx-space-18)' }}>as {role}</span>
          </div>
          {/* empty preview body */}
          <div style={{ padding: 'var(--gx-space-7)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 200, color: 'var(--gx-text-3)', fontSize: 'var(--gx-text-13)', gap: 'var(--gx-space-4)' }}>
            <Eye size={28} style={{ opacity: 0.3 }} />
            <span>No preview available — publish first</span>
          </div>
        </div>
      </div>
    </div>
  )
}
