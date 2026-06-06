// GAAhex Studio — Appearance pane.
// Extracted from StudioRichPanes.tsx. Behavior unchanged.
// Bound to GET/PUT /api/tenant/settings/theme. Names match the backend allow-list:
// accent ∈ {Azure, Cobalt, Gold, Emerald, Violet, Teal}.

import { Button } from '../primitives'
import React, { useState, useEffect, useRef } from 'react'
import { Check, Globe, Plus, Settings } from 'lucide-react'
import { registerSnapshot, unregisterSnapshot } from './publishRegistry'
import { bget, bput } from '../lib/billing'

interface Accent { name: string; val: string; hover: string; active: string; soft: string }

const ACCENTS: Accent[] = [
  { name: 'Azure',   val: '#3B7BE0', hover: '#5293F2', active: '#2C63BC', soft: 'rgba(59,123,224,.16)' },
  { name: 'Cobalt',  val: '#2A5187', hover: '#3A6299', active: '#1C3B68', soft: 'rgba(42,81,135,.20)' },
  { name: 'Gold',    val: '#C5A059', hover: '#D2B06E', active: '#AC8847', soft: 'rgba(197,160,89,.18)' },
  { name: 'Emerald', val: '#1F9D57', hover: '#34C77B', active: '#16804A', soft: 'rgba(31,157,87,.16)' },
  { name: 'Violet',  val: '#8B6FD6', hover: '#A78BE6', active: '#6F52BD', soft: 'rgba(139,111,214,.18)' },
  { name: 'Teal',    val: '#2A9DB5', hover: '#41B4CC', active: '#1F8398', soft: 'rgba(42,157,181,.18)' },
]

// radius ∈ {Sharp, Soft, Rounded, Pill}; value drives preview shapes + maps to --gx-radius-* cluster.
const RADII: [string, number][] = [['Sharp', 4], ['Soft', 8], ['Rounded', 13], ['Pill', 999]]

// density ∈ {Compact, Comfortable, Spacious}; maps to --gx-space-* cluster.
const DENSITY_NAMES = ['Compact', 'Comfortable', 'Spacious'] as const
type DensityName = (typeof DENSITY_NAMES)[number]

// mode ∈ {Dark, Light, Auto}; sets <html data-theme="…">.
const MODE_NAMES = ['Dark', 'Light', 'Auto'] as const
type ModeName = (typeof MODE_NAMES)[number]

// Named-token → CSS-variable bundles. Applying these to documentElement live-previews the
// theme across the whole app (every screen uses --gx-* tokens).
const RADIUS_VARS: Record<number, Record<string, string>> = {
  4:   { '--gx-radius-sm': '2px', '--gx-radius-md': '4px',  '--gx-radius-lg': '6px',  '--gx-radius-xl': '8px'  },
  8:   { '--gx-radius-sm': '5px', '--gx-radius-md': '8px',  '--gx-radius-lg': '12px', '--gx-radius-xl': '16px' },
  13:  { '--gx-radius-sm': '8px', '--gx-radius-md': '13px', '--gx-radius-lg': '18px', '--gx-radius-xl': '24px' },
  999: { '--gx-radius-sm': '999px', '--gx-radius-md': '999px', '--gx-radius-lg': '999px', '--gx-radius-xl': '999px' },
}

const DENSITY_VARS: Record<DensityName, Record<string, string>> = {
  Compact:     { '--gx-space-4': '6px',  '--gx-space-5': '8px',  '--gx-space-6': '10px', '--gx-space-7': '12px', '--gx-space-8': '14px', '--gx-input-height-md': '26px', '--gx-btn-height-md': '26px' },
  Comfortable: { '--gx-space-4': '8px',  '--gx-space-5': '10px', '--gx-space-6': '12px', '--gx-space-7': '14px', '--gx-space-8': '16px', '--gx-input-height-md': '28px', '--gx-btn-height-md': '28px' },
  Spacious:    { '--gx-space-4': '12px', '--gx-space-5': '14px', '--gx-space-6': '18px', '--gx-space-7': '22px', '--gx-space-8': '28px', '--gx-input-height-md': '34px', '--gx-btn-height-md': '34px' },
}

const accentVars = (a: Accent): Record<string, string> => ({
  '--gx-primary': a.val,
  '--gx-primary-hover': a.hover,
  '--gx-primary-active': a.active,
  '--gx-primary-soft': a.soft,
})

// Resolve Auto → user system preference; otherwise lowercase the name.
const themeAttr = (mode: ModeName): 'dark' | 'light' => {
  if (mode === 'Auto') {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches
      ? 'light' : 'dark'
  }
  return mode.toLowerCase() as 'dark' | 'light'
}

// Apply a full theme (accent+radius+density+mode) to <html>. Returns the keys it touched so the
// unmount path can restore them.
function applyTheme(accent: Accent, radius: number, density: DensityName, mode: ModeName): string[] {
  const root = document.documentElement
  const bundle: Record<string, string> = {
    ...accentVars(accent),
    ...(RADIUS_VARS[radius] ?? RADIUS_VARS[8]),
    ...DENSITY_VARS[density],
  }
  for (const [k, v] of Object.entries(bundle)) root.style.setProperty(k, v)
  root.setAttribute('data-theme', themeAttr(mode))
  return Object.keys(bundle)
}

// Server payload (all keys nullable until first save).
type ThemeDoc = {
  accent: string | null
  radius: string | null
  density: string | null
  mode: string | null
}
type ThemeWorking = { accent: Accent; radius: number; density: DensityName; mode: ModeName }

const radiusByName = (name: string | null): number =>
  RADII.find(([n]) => n === name)?.[1] ?? RADII[0][1]
const radiusNameByVal = (v: number): string =>
  RADII.find(([, r]) => r === v)?.[0] ?? RADII[0][0]

const seedFromDoc = (doc: ThemeDoc | null): ThemeWorking => ({
  accent:  ACCENTS.find(a => a.name === doc?.accent) ?? ACCENTS[0],
  radius:  doc?.radius ? radiusByName(doc.radius) : RADII[0][1],
  density: (DENSITY_NAMES.find(d => d === doc?.density) ?? DENSITY_NAMES[0]) as DensityName,
  mode:    (MODE_NAMES.find(m => m === doc?.mode) ?? MODE_NAMES[0]) as ModeName,
})

const isDirty = (a: ThemeWorking, b: ThemeWorking) =>
  a.accent.name !== b.accent.name || a.radius !== b.radius || a.density !== b.density || a.mode !== b.mode

export function AppearancePane({ token }: { token?: string } = {}) {
  // Saved baseline (last server-confirmed state) + working state (what the user is editing).
  const [baseline, setBaseline] = useState<ThemeWorking>(() => seedFromDoc(null))
  const [accent, setAccent] = useState<Accent>(baseline.accent)
  const [radius, setRadius] = useState<number>(baseline.radius)
  const [density, setDensity] = useState<DensityName>(baseline.density)
  const [mode, setMode] = useState<ModeName>(baseline.mode)

  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // We track the original <html> theme attribute so unmount can restore it cleanly.
  const initialHtmlTheme = useRef<string | null>(null)
  // Latest baseline kept in a ref so the unmount cleanup sees the freshest one.
  const baselineRef = useRef(baseline)
  useEffect(() => { baselineRef.current = baseline }, [baseline])

  // Mount: seed from /api/tenant/settings/theme.
  useEffect(() => {
    if (typeof document !== 'undefined') {
      initialHtmlTheme.current = document.documentElement.getAttribute('data-theme')
    }
    if (!token) { setLoaded(true); return }
    let alive = true
    bget<ThemeDoc>(token, '/api/tenant/settings/theme')
      .then(res => {
        if (!alive) return
        const seeded = res.ok && res.data ? seedFromDoc(res.data) : seedFromDoc(null)
        setBaseline(seeded)
        setAccent(seeded.accent); setRadius(seeded.radius); setDensity(seeded.density); setMode(seeded.mode)
        if (!res.ok && res.status !== 404) {
          setError(res.status === 403
            ? 'Requires tenant.settings permission to load theme.'
            : `Failed to load theme (${res.status})`)
        }
      })
      .catch((e: Error) => { if (alive) setError(e.message || 'Failed to load theme') })
      .finally(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [token])

  // Live-preview side effect: any change to working state pushes new CSS vars to :root + sets
  // data-theme on <html>, so the WHOLE APP previews the new theme immediately.
  useEffect(() => {
    if (!loaded) return
    applyTheme(accent, radius, density, mode)
  }, [accent, radius, density, mode, loaded])

  // Unmount: if dirty, revert the live CSS vars back to the saved baseline so an accidental
  // nav-away doesn't strand the user with an unsaved theme. If the user saved, baseline ≡ working
  // and this is a no-op (correct).
  useEffect(() => {
    return () => {
      const b = baselineRef.current
      applyTheme(b.accent, b.radius, b.density, b.mode)
      if (initialHtmlTheme.current === null) document.documentElement.removeAttribute('data-theme')
    }
  }, [])

  const working: ThemeWorking = { accent, radius, density, mode }
  const dirty = isDirty(working, baseline)

  // Register snapshot so PublishSettings can capture the working (unsaved) theme state.
  useEffect(() => {
    registerSnapshot('appearance.theme', () => ({
      theme: { accent: accent.name, radius: radiusNameByVal(radius), density, mode },
    }))
    return () => unregisterSnapshot('appearance.theme')
  }, [accent, radius, density, mode])

  // Save flow — PUT the full 4-key payload. 422 (allow-list miss) → inline error w/ backend
  // detail; 403 → "Requires tenant.settings permission" toast; success → adopt as new baseline.
  const save = async () => {
    if (!token || !dirty || saving) return
    setSaving(true); setError(null)
    try {
      await bput(token, '/api/tenant/settings/theme', {
        accent: accent.name,
        radius: radiusNameByVal(radius),
        density,
        mode,
      })
      setBaseline(working)
      setToast('Appearance saved.')
      setTimeout(() => setToast(null), 3000)
    } catch (e) {
      const err = e as Error & { status?: number }
      if (err.status === 403) {
        setToast('Requires tenant.settings permission')
        setTimeout(() => setToast(null), 4000)
      } else if (err.status === 422) {
        setError(err.message || 'Invalid theme value')
      } else {
        setError(err.message || 'Save failed')
      }
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    setAccent(baseline.accent); setRadius(baseline.radius); setDensity(baseline.density); setMode(baseline.mode)
    setError(null)
  }

  const pad = density === 'Compact' ? '0 12px' : density === 'Spacious' ? '0 22px' : '0 16px'
  const ht = density === 'Compact' ? 28 : density === 'Spacious' ? 42 : 34

  const live: React.CSSProperties & Record<string, string> = accentVars(accent)

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h3 style={{ margin: '0 0 4px', fontFamily: 'var(--gx-font-sans)', fontSize: 16, fontWeight: 600 }}>Appearance</h3>
        <p className="hint" style={{ margin: 0 }}>
          Tenant branding. Set it once here — every rendered screen across all 18 modules updates. No code.
        </p>
      </div>

      {error && (
        <div className="banner" style={{ marginBottom: 'var(--gx-space-7)', borderLeftColor: 'var(--gx-danger)', background: 'var(--gx-danger-soft)' }}>
          <div className="bm" style={{ color: 'var(--gx-danger-fg)' }}>{error}</div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20 }}>
        {/* controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Accent */}
          <div>
            <div className="lbl" style={{ marginBottom: 9 }}>Button / accent color</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
              {ACCENTS.map(a => (
                <button
                  key={a.name}
                  type="button"
                  onClick={() => setAccent(a)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--gx-space-3)', padding: '8px 10px',
                    borderRadius: 'var(--gx-radius-md)',
                    border: '1px solid ' + (accent.name === a.name ? a.val : 'var(--gx-border)'),
                    background: accent.name === a.name ? 'var(--gx-surface-2)' : 'transparent',
                    cursor: 'pointer',
                    boxShadow: accent.name === a.name ? '0 0 0 2px ' + a.soft : 'none',
                  }}
                >
                  <span style={{ width: 18, height: 18, borderRadius: '50%', background: a.val, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--gx-text-1)', fontWeight: accent.name === a.name ? 600 : 400 }}>{a.name}</span>
                </button>
              ))}
            </div>
            <div style={{ marginTop: 'var(--gx-space-5)', fontFamily: 'var(--gx-font-mono)', fontSize: 12, background: 'var(--gx-bg-subtle)', border: '1px solid var(--gx-border)', borderRadius: 'var(--gx-radius-sm)', padding: '4px 9px', display: 'inline-flex', gap: 'var(--gx-space-3)', alignItems: 'center', color: 'var(--gx-text-1)' }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: accent.val }} />
              {accent.val.toUpperCase()}
            </div>
          </div>

          {/* Radius */}
          <div>
            <div className="lbl" style={{ marginBottom: 9 }}>Corner radius</div>
            <div className="seg" style={{ width: '100%' }}>
              {RADII.map(([name, r]) => (
                <button key={name} className={radius === r ? 'on' : ''} type="button" onClick={() => setRadius(r)} style={{ flex: 1 }}>
                  {name}
                </button>
              ))}
            </div>
          </div>

          {/* Density */}
          <div>
            <div className="lbl" style={{ marginBottom: 9 }}>Density</div>
            <div className="seg" style={{ width: '100%' }}>
              {DENSITY_NAMES.map(d => (
                <button key={d} className={density === d ? 'on' : ''} type="button" onClick={() => setDensity(d)} style={{ flex: 1 }}>
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* Theme */}
          <div>
            <div className="lbl" style={{ marginBottom: 9 }}>Default theme</div>
            <div className="seg" style={{ width: '100%' }}>
              {MODE_NAMES.map(t => (
                <button key={t} className={mode === t ? 'on' : ''} type="button" onClick={() => setMode(t)} style={{ flex: 1 }}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* live preview */}
        <div
          className="card card-pad"
          style={{ ...live, background: 'var(--gx-surface)', display: 'flex', flexDirection: 'column', gap: 18 } as React.CSSProperties}
        >
          <div className="lbl">Live preview · applies everywhere</div>

          <div style={{ display: 'flex', gap: 'var(--gx-space-5)', flexWrap: 'wrap', alignItems: 'center' }}>
            <button style={{ height: ht, padding: pad, borderRadius: radius, border: 'none', background: 'var(--gx-primary)', color: 'var(--gx-on-primary)', fontFamily: 'var(--gx-font-sans)', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7 }} type="button">
              <Plus size={14} />Primary
            </button>
            <button style={{ height: ht, padding: pad, borderRadius: radius, border: '1px solid var(--gx-border-strong)', background: 'var(--gx-surface-2)', color: 'var(--gx-text-1)', fontFamily: 'var(--gx-font-sans)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }} type="button">
              Secondary
            </button>
            <button style={{ height: ht, padding: pad, borderRadius: radius, border: '1px solid var(--gx-primary)', background: 'transparent', color: 'var(--gx-primary)', fontFamily: 'var(--gx-font-sans)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }} type="button">
              Outline
            </button>
            <button style={{ height: ht, width: ht, padding: 0, borderRadius: radius, border: 'none', background: 'var(--gx-primary-soft)', color: 'var(--gx-primary)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} type="button">
              <Settings size={15} />
            </button>
          </div>

          <div style={{ display: 'flex', gap: 'var(--gx-space-3)', flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--gx-space-3)', height: 22, padding: '0 9px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: 'var(--gx-primary-soft)', color: 'var(--gx-primary)' }}>Active</span>
            <span className="pill pill-success">Online</span>
            <span className="pill pill-warning">Degraded</span>
            <span className="pill pill-danger">SLA breached</span>
          </div>

          <label className="field">
            <span>Input field</span>
            <input
              className="inp inp-sm"
              placeholder="Sample value"
              style={{ borderRadius: radius, height: ht }}
            />
          </label>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-4)', padding: '12px 14px', borderRadius: radius, background: 'var(--gx-bg-subtle)', border: '1px solid var(--gx-border)' }}>
            <span style={{ width: 34, height: 34, borderRadius: radius > 20 ? '50%' : radius, background: 'var(--gx-primary-soft)', color: 'var(--gx-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Globe size={17} />
            </span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Active subscribers</div>
              <div className="hint" style={{ fontSize: 11 }}>—</div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--gx-space-5)', marginTop: 'var(--gx-space-6)', alignItems: 'center' }}>
        <Button variant="primary" size="md"
            type="button"
          style={{ background: accent.val }}
          onClick={save}
          disabled={!token || !dirty || saving}>
          <Check size={14} />{saving ? 'Saving…' : 'Save appearance'}
        </Button>
        <Button variant="ghost" size="md"
            type="button"
          onClick={reset}
          disabled={!dirty || saving}>
          Reset
        </Button>
        {dirty && (
          <span className="hint" style={{ fontSize: 12, color: 'var(--gx-warning)' }}>Unsaved changes</span>
        )}
        {toast && (
          <span className="hint" style={{ fontSize: 12, color: 'var(--gx-text-2)' }}>{toast}</span>
        )}
      </div>
    </div>
  )
}
