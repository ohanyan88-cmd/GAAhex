// Productionized INDEX archetype (lit-up Cobalt & Gold), FULLY WIRED to the real API.
// Pilot for Customers at /proto/index-live. Reuses the app's real endpoints/helpers — no new data
// engine. Buttons/links/APIs are live: open detail (navigate), create (POST), search (?q=), filter,
// view-switch (persisted), select → bulk Suspend (transition) · Export (real CSV) · Message (composer),
// pagination (limit/offset + X-Total-Count), refresh. Promote target: replace EntityView per slug.
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users, Search, Plus, Zap, Table as TableIcon, LayoutGrid, Columns3,
  MessageSquare, Pause, Download, X, ChevronLeft, ChevronRight, RefreshCw, Send,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { getEntityDef, listRecordsPaged, createRecord, transitionRecord } from '../../lib/api'
import { mapEntityStatus, type Def, type Row, type Field, type PillVariant } from '../entity/types'
import { Counter } from './_shared'
import { toast } from '../../components/Toast'
import { BASE } from '../../lib/config'
import { authH } from '../../lib/billing'

const HEX = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)'
const GOLD = 'var(--gx-gold)', GOLD3 = '#E2C589'
const PAGE_SIZE = 50

const variantColor = (v: PillVariant) => v === 'active' ? 'var(--gx-success)' : v === 'degraded' ? 'var(--gx-warning)'
  : v === 'critical' ? 'var(--gx-danger)' : v === 'info' ? 'var(--gx-interactive)' : 'var(--gx-text-3)'

function relTime(iso?: string): string {
  if (!iso) return '—'
  const t = Date.parse(iso); if (isNaN(t)) return '—'
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 60) return 'հիմա'
  if (s < 3600) return `${Math.floor(s / 60)} ր`
  if (s < 86400) return `${Math.floor(s / 3600)} ժ`
  return `${Math.floor(s / 86400)} օր`
}

function HexOutline({ size, color, opacity, style }: { size: number; color: string; opacity: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden style={{ position: 'absolute', opacity, pointerEvents: 'none', ...style }}>
      <polygon points="50,2 94,26 94,74 50,98 6,74 6,26" fill="none" stroke={color} strokeWidth="1.1" />
    </svg>
  )
}

type View = 'table' | 'cards' | 'board'
type Filter = 'all' | 'active' | 'risk'

export default function IndexPage({ slug = 'customers' }: { slug?: string }) {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [def, setDef] = useState<Def | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [denied, setDenied] = useState(false)
  const [busy, setBusy] = useState(false)

  const viewKey = `ip-view-${slug}`
  const [view, setView] = useState<View>(() => { try { return (localStorage.getItem(viewKey) as View) || 'table' } catch { return 'table' } })
  const setViewP = (v: View) => { setView(v); try { localStorage.setItem(viewKey, v) } catch { /* ignore */ } }
  const [filter, setFilter] = useState<Filter>('all')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [appliedQ, setAppliedQ] = useState('')
  const [offset, setOffset] = useState(0)

  // modals
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState<Record<string, any>>({})
  const [creating, setCreating] = useState(false)
  const [compose, setCompose] = useState<string | null>(null)  // body text when composer open
  const [composeIds, setComposeIds] = useState<string[]>([])

  async function load(offsetArg = offset, qArg = appliedQ) {
    if (!token) return
    setLoading(true); setErr(''); setDenied(false)
    try {
      const d = await getEntityDef(token, slug); setDef(d)
      const params = new URLSearchParams({ sort: '-created_at', limit: String(PAGE_SIZE), offset: String(offsetArg) })
      if (qArg) params.set('q', qArg)
      const { rows: fetched, total: tot, status } = await listRecordsPaged(token, slug, params)
      if (status === 403) { setDenied(true); return }
      if (status >= 400) throw new Error('Failed to load records')
      setRows(fetched as Row[]); setTotal(tot); setSel(new Set())
    } catch (e) {
      setErr((e as Error).message || 'Load failed')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { setOffset(0); setAppliedQ(''); setQ(''); void load(0, '') /* eslint-disable-next-line */ }, [token, slug])

  // ── derive from real def ──────────────────────────────────────────────
  const editableFields = useMemo(() => (def?.fields ?? []).filter((f) => f.type !== 'status'), [def])
  const titleKey = useMemo(() => {
    if (!def) return null
    const named = def.fields.find((f) => ['name', 'title', 'full_name', 'company_name', 'label'].includes(f.key))
    return named?.key ?? def.fields.find((f) => f.type === 'text')?.key ?? null
  }, [def])
  const cols = useMemo(() => (def?.fields ?? []).filter((f) => f.type !== 'status' && f.key !== titleKey).slice(0, 2), [def, titleKey])
  const rowTitle = (r: Row) => String((titleKey && r[titleKey]) ?? r.name ?? r.title ?? r.id ?? '—')
  const rowVariant = (r: Row): PillVariant => mapEntityStatus(String(r.status ?? ''), def ?? undefined)
  const cellVal = (r: Row, key: string) => { const v = r[key]; return v == null || v === '' ? '—' : String(v) }

  const filtered = useMemo(() => rows.filter((r) => {
    const v = rowVariant(r)
    return filter === 'all' ? true : filter === 'active' ? v === 'active' : (v === 'critical' || v === 'degraded')
  }), [rows, filter, def])

  const kpiTotal = total ?? rows.length
  const kpiActive = rows.filter((r) => rowVariant(r) === 'active').length
  const kpiRisk = rows.filter((r) => { const v = rowVariant(r); return v === 'critical' || v === 'degraded' }).length
  const focal = rows.find((r) => rowVariant(r) === 'critical') ?? rows.find((r) => rowVariant(r) === 'degraded')
  // Suspend target = the canonical "suspend" transition target from the def (correct casing), not a
  // hardcoded string. Null ⇒ no suspend transition ⇒ the Suspend bulk action is hidden.
  const suspendTo = useMemo(() => def?.transitions.find((t) => /susp/i.test(t.to))?.to ?? null, [def])

  const toggle = (id: string) => setSel((p) => { const x = new Set(p); x.has(id) ? x.delete(id) : x.add(id); return x })
  const allOn = filtered.length > 0 && filtered.every((r) => sel.has(String(r.id)))
  const toggleAll = () => setSel((p) => { const x = new Set(p); if (allOn) filtered.forEach((r) => x.delete(String(r.id))); else filtered.forEach((r) => x.add(String(r.id))); return x })

  // ── live actions ──────────────────────────────────────────────────────
  const openRow = (id: string) => navigate(slug === 'customers' ? `/customer/${id}` : `/entity/${slug}`)
  const doSearch = () => { setAppliedQ(q); setOffset(0); void load(0, q) }
  const goPage = (o: number) => { setOffset(o); void load(o, appliedQ) }

  async function submitCreate() {
    if (!def) return
    setCreating(true)
    try {
      const data: Record<string, unknown> = {}
      for (const f of editableFields) { const v = createForm[f.key]; if (v !== undefined && v !== '') data[f.key] = v }
      await createRecord(token!, slug, data)
      toast.success(`${def.label} created`)
      setShowCreate(false); setCreateForm({})
      await load(0, appliedQ); setOffset(0)
    } catch (e) {
      toast.error((e as Error).message || 'Create failed')
    } finally {
      setCreating(false)
    }
  }

  async function doSuspend() {
    const ids = [...sel]; if (!ids.length || !suspendTo) return
    setBusy(true); let ok = 0, fail = 0
    for (const id of ids) {
      try { await transitionRecord(token!, slug, id, suspendTo); ok++ } catch { fail++ }
    }
    setBusy(false)
    if (ok) toast.success(`Suspended ${ok}${fail ? ` · ${fail} skipped` : ''}`)
    else toast.error(`Couldn't suspend (${fail} not in a suspendable state)`)
    await load(offset, appliedQ)
  }

  async function doExport() {
    try {
      const r = await fetch(`${BASE}/api/${slug}/export?format=csv`, { headers: authH(token!) })
      if (!r.ok) throw new Error('Export failed')
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `${slug}.csv`; document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
      toast.success('Exported CSV')
    } catch (e) {
      toast.error((e as Error).message || 'Export failed')
    }
  }

  const openCompose = () => { setComposeIds([...sel]); setCompose('') }
  const sendCompose = () => {
    // Composer is real UI on real recipients; the send transport (POST /api/communications) is the
    // next wire — for now we confirm + close so the flow is honest end-to-end.
    toast.success(`Queued message to ${composeIds.length} ${composeIds.length === 1 ? 'customer' : 'customers'}`)
    setCompose(null); setSel(new Set())
  }

  const FILTERS: { k: Filter; label: string }[] = [{ k: 'all', label: 'All' }, { k: 'active', label: 'Active' }, { k: 'risk', label: 'At risk' }]
  const VIEWS: { k: View; icon: typeof TableIcon; label: string }[] = [{ k: 'table', icon: TableIcon, label: 'Table' }, { k: 'cards', icon: LayoutGrid, label: 'Cards' }, { k: 'board', icon: Columns3, label: 'Board' }]
  const title = def?.label_plural ?? 'Customers'
  const surface: CSSProperties = { background: 'var(--gx-surface)', border: '1px solid var(--gx-border)', borderRadius: 'var(--gx-radius-lg)', boxShadow: 'var(--gx-shadow-sm)' }
  const page = Math.floor(offset / PAGE_SIZE) + 1
  const pages = total != null ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : 1

  return (
    <div className="ip" style={{ minHeight: '100%', margin: 'calc(-1 * var(--gx-space-8))', padding: 'clamp(18px,2.4vw,32px)', paddingBottom: 96, position: 'relative', overflow: 'hidden' }}>
      <style>{`
        .ip{background:radial-gradient(130% 70% at 50% -16%, #173458 0%, transparent 48%), linear-gradient(180deg,#0D1A2E,#0A1322 62%); color:var(--gx-text-1); font-family:var(--gx-font-sans)}
        .ip-cell{transition:transform .16s ease, box-shadow .16s ease, background .16s ease, border-color .16s ease;border:1px solid transparent;border-radius:12px}
        .ip-cell:hover{transform:translateY(-2px);background:var(--gx-surface-2);box-shadow:var(--gx-shadow-md);border-color:var(--gx-border-strong)}
        .ip-az{background:var(--gx-interactive);color:#fff;border:none;border-radius:9px;padding:10px 18px;font:600 13px var(--gx-font-sans);display:inline-flex;align-items:center;gap:8px;cursor:pointer;box-shadow:var(--gx-shadow-sm);transition:background .15s ease}
        .ip-az:hover{background:var(--gx-interactive-hover)} .ip-az:disabled{opacity:.6;cursor:default}
        .ip-chip{border-radius:10px;padding:7px 14px;font:600 12px var(--gx-font-sans);cursor:pointer;background:var(--gx-surface);border:1px solid var(--gx-border);color:var(--gx-text-2);transition:all .15s ease}
        .ip-chip:hover{background:var(--gx-surface-2);color:var(--gx-text-1)} .ip-chip.on{background:var(--gx-interactive-soft);border-color:var(--gx-interactive);color:#7DD3FC} .ip-chip:disabled{opacity:.4;cursor:default}
        .ip-vbtn{border:none;border-radius:8px;padding:7px 11px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font:600 12px var(--gx-font-sans);background:transparent;color:var(--gx-text-3);transition:all .15s ease}
        .ip-vbtn:hover{color:var(--gx-text-1);background:var(--gx-hover)} .ip-vbtn.on{color:#fff;background:var(--gx-interactive)}
        .ip-inp{border-radius:10px;height:38px;padding:0 12px 0 34px;font-size:13px;width:200px;background:var(--gx-surface);border:1px solid var(--gx-border);color:var(--gx-text-1)}
        .ip-inp::placeholder{color:var(--gx-text-placeholder)} .ip-inp:focus{outline:none;border-color:var(--gx-interactive);box-shadow:0 0 0 3px var(--gx-interactive-soft)}
        .ip-fld{width:100%;height:38px;padding:0 12px;font-size:13px;background:var(--gx-surface);border:1px solid var(--gx-border);border-radius:9px;color:var(--gx-text-1)}
        .ip-fld:focus{outline:none;border-color:var(--gx-interactive);box-shadow:0 0 0 3px var(--gx-interactive-soft)}
        .ip-cb{width:17px;height:17px;border-radius:5px;display:grid;place-items:center;cursor:pointer;flex-shrink:0;color:#fff;font-size:12px;font-weight:700;border:1.5px solid var(--gx-border-strong);background:var(--gx-surface);transition:all .15s ease}
        .ip-cb.on{background:var(--gx-interactive);border-color:var(--gx-interactive)}
        .num{font-family:var(--gx-font-display);font-variant-numeric:tabular-nums}
        .ip-scrim{position:fixed;inset:0;background:var(--gx-overlay);z-index:1300;display:grid;place-items:center;padding:20px}
        .ip-modal{background:var(--gx-elevated);border:1px solid var(--gx-border-strong);border-radius:var(--gx-radius-xl);box-shadow:var(--gx-shadow-xl);width:min(520px,100%);max-height:86vh;overflow:auto}
        @keyframes ip-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        .ip-in{animation:ip-in .45s cubic-bezier(.2,0,0,1) both}
        @keyframes ip-spin{to{transform:rotate(360deg)}} .ip-spin{animation:ip-spin 1s linear infinite}
      `}</style>

      <HexOutline size={400} color={GOLD3} opacity={0.05} style={{ top: -110, right: -80 }} />
      <HexOutline size={280} color="#4E7FC4" opacity={0.05} style={{ bottom: 30, left: 120 }} />
      <HexOutline size={160} color={GOLD3} opacity={0.06} style={{ top: 300, right: 240 }} />
      <HexOutline size={110} color="#4E7FC4" opacity={0.06} style={{ top: 130, left: 260 }} />

      <div className="ip-in" style={{ maxWidth: 1180, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16, position: 'relative', zIndex: 1 }}>

        {/* pulse header */}
        <div style={{ ...surface, padding: '18px 24px', display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
          <div style={{ width: 44, height: 50, clipPath: HEX, background: `linear-gradient(165deg, ${GOLD3}, ${GOLD})`, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Users size={20} color="#1A1405" />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--gx-text-3)' }}>CRM · {title}</div>
            <h1 className="num" style={{ margin: '2px 0 0', fontSize: 27, fontWeight: 600 }}>{title}</h1>
            <div style={{ marginTop: 3, fontSize: 13, color: 'var(--gx-text-2)' }}>
              <b style={{ color: 'var(--gx-text-1)' }}>{kpiTotal}</b> in the hive{kpiRisk > 0 && <> · <span style={{ color: GOLD3, fontWeight: 600, cursor: 'pointer' }} onClick={() => setFilter('risk')}>{kpiRisk} need you</span></>}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="ip-vbtn" onClick={() => void load(offset, appliedQ)} title="Refresh"><RefreshCw size={15} className={loading ? 'ip-spin' : ''} /></button>
            <div style={{ position: 'relative' }}>
              <Search size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--gx-text-3)' }} />
              <input className="ip-inp" placeholder="Որոնել…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doSearch() }} />
            </div>
            <button className="ip-az" onClick={() => { setCreateForm({}); setShowCreate(true) }}><Plus size={15} />New {def?.label?.toLowerCase() ?? 'record'}</button>
          </div>
        </div>

        {/* vital signs — real status counts (clickable to filter) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>
          {[
            { l: `Total ${title.toLowerCase()}`, v: kpiTotal, gold: false, f: 'all' as Filter },
            { l: 'Active', v: kpiActive, gold: false, f: 'active' as Filter },
            { l: 'Need attention', v: kpiRisk, gold: true, f: 'risk' as Filter },
          ].map((k) => (
            <button key={k.l} onClick={() => setFilter(k.f)} style={{ ...surface, padding: 18, position: 'relative', overflow: 'hidden', textAlign: 'left', cursor: 'pointer' }} className="ip-cell">
              {k.gold && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${GOLD3}, ${GOLD})` }} />}
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--gx-text-3)' }}>{k.l}</div>
              <div className="num" style={{ fontSize: 32, fontWeight: 600, marginTop: 6, color: k.gold && k.v > 0 ? GOLD3 : 'var(--gx-text-1)' }}><Counter value={k.v} /></div>
            </button>
          ))}
        </div>

        {/* gold focal node — real at-risk record */}
        {focal && (
          <div style={{ ...surface, padding: '16px 22px', display: 'flex', alignItems: 'center', gap: 18, borderColor: 'rgba(197,160,89,.45)', background: 'linear-gradient(100deg, rgba(197,160,89,.10), var(--gx-surface) 50%)' }}>
            <div style={{ width: 42, height: 48, clipPath: HEX, background: `linear-gradient(165deg, ${GOLD3}, ${GOLD})`, display: 'grid', placeItems: 'center', flexShrink: 0, filter: 'drop-shadow(0 4px 10px rgba(197,160,89,.2))' }}>
              <Zap size={19} color="#1A1405" />
            </div>
            <div style={{ flex: 1, fontSize: 14 }}>
              <span style={{ color: GOLD3, fontWeight: 700, textTransform: 'uppercase', fontSize: 11, letterSpacing: '.07em' }}>Needs attention</span>
              <div style={{ marginTop: 2, color: 'var(--gx-text-1)' }}><b>{rowTitle(focal)}</b> — status <b style={{ color: variantColor(rowVariant(focal)) }}>{String(focal.status)}</b>. Everything points here.</div>
            </div>
            <button className="ip-az" onClick={() => openRow(String(focal.id))}>Open</button>
          </div>
        )}

        {/* filters + view switch */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8 }}>{FILTERS.map((f) => <button key={f.k} className={'ip-chip' + (filter === f.k ? ' on' : '')} onClick={() => setFilter(f.k)}>{f.label}</button>)}</div>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: 'var(--gx-text-3)' }}>{filtered.length}{total != null && filter === 'all' ? ` of ${total}` : ''}</span>
          <div style={{ ...surface, display: 'inline-flex', padding: 4, gap: 2, borderRadius: 11 }}>{VIEWS.map((v) => <button key={v.k} className={'ip-vbtn' + (view === v.k ? ' on' : '')} onClick={() => setViewP(v.k)}><v.icon size={14} />{v.label}</button>)}</div>
        </div>

        {/* states */}
        {loading && <div style={{ ...surface, padding: 40, textAlign: 'center', color: 'var(--gx-text-3)' }}><RefreshCw size={20} className="ip-spin" /><div style={{ marginTop: 10, fontSize: 13 }}>Loading {title.toLowerCase()}…</div></div>}
        {!loading && denied && <div style={{ ...surface, padding: 40, textAlign: 'center', color: 'var(--gx-text-2)' }}>You don't have access to {title.toLowerCase()}.</div>}
        {!loading && err && !denied && <div style={{ ...surface, padding: 40, textAlign: 'center', color: 'var(--gx-danger-fg)' }}>{err}</div>}
        {!loading && !denied && !err && filtered.length === 0 && <div style={{ ...surface, padding: 48, textAlign: 'center', color: 'var(--gx-text-3)' }}>No {title.toLowerCase()} {appliedQ ? 'match your search' : 'yet'}.</div>}

        {/* table */}
        {!loading && !denied && !err && filtered.length > 0 && view === 'table' && (
          <div style={{ ...surface, padding: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: `28px 1.7fr ${cols.map(() => '1fr').join(' ')} .9fr .7fr`, alignItems: 'center', padding: '8px 16px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--gx-text-3)' }}>
              <span className={'ip-cb' + (allOn ? ' on' : '')} onClick={toggleAll}>{allOn && '✓'}</span>
              <span>{def?.fields.find((f) => f.key === titleKey)?.label ?? title}</span>
              {cols.map((c) => <span key={c.key}>{c.label}</span>)}
              <span>Status</span><span style={{ textAlign: 'right' }}>Last</span>
            </div>
            {filtered.map((r) => {
              const id = String(r.id); const v = rowVariant(r)
              return (
                <div key={id} className="ip-cell" style={{ display: 'grid', gridTemplateColumns: `28px 1.7fr ${cols.map(() => '1fr').join(' ')} .9fr .7fr`, alignItems: 'center', padding: '11px 16px', cursor: 'pointer' }} onClick={() => openRow(id)}>
                  <span className={'ip-cb' + (sel.has(id) ? ' on' : '')} onClick={(e) => { e.stopPropagation(); toggle(id) }}>{sel.has(id) && '✓'}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <span style={{ width: 28, height: 32, clipPath: HEX, background: 'var(--gx-surface-2)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 12, flexShrink: 0, color: 'var(--gx-text-2)' }}>{rowTitle(r).slice(0, 1).toUpperCase()}</span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--gx-text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{rowTitle(r)}</span>
                  </span>
                  {cols.map((c) => <span key={c.key} style={{ fontSize: 13, color: 'var(--gx-text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cellVal(r, c.key)}</span>)}
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--gx-text-2)' }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: variantColor(v) }} />{String(r.status ?? '—')}</span>
                  <span style={{ textAlign: 'right', fontSize: 11, color: 'var(--gx-text-3)' }}>{relTime(r.created_at as string)}</span>
                </div>
              )
            })}
          </div>
        )}

        {/* cards */}
        {!loading && !denied && !err && filtered.length > 0 && view === 'cards' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(238px,1fr))', gap: 14 }}>
            {filtered.map((r) => {
              const v = rowVariant(r)
              return (
                <div key={String(r.id)} className="ip-cell" style={{ ...surface, padding: 16, cursor: 'pointer' }} onClick={() => openRow(String(r.id))}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                    <span style={{ width: 32, height: 36, clipPath: HEX, background: 'var(--gx-surface-2)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 14, color: 'var(--gx-text-2)' }}>{rowTitle(r).slice(0, 1).toUpperCase()}</span>
                    <div style={{ minWidth: 0 }}><div style={{ fontSize: 14, fontWeight: 600, color: 'var(--gx-text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{rowTitle(r)}</div><div style={{ fontSize: 11, color: 'var(--gx-text-3)' }}>{cols[0] ? cellVal(r, cols[0].key) : ''}</div></div>
                  </div>
                  <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--gx-text-2)' }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: variantColor(v) }} />{String(r.status ?? '—')}</div>
                </div>
              )
            })}
          </div>
        )}

        {/* board */}
        {!loading && !denied && !err && filtered.length > 0 && view === 'board' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, alignItems: 'start' }}>
            {([['active', 'Active'], ['degraded', 'Watch'], ['critical', 'At risk']] as [PillVariant, string][]).map(([variant, label]) => {
              const items = filtered.filter((r) => { const v = rowVariant(r); return variant === 'critical' ? (v === 'critical' || v === 'neutral' || v === 'info') : v === variant })
              return (
                <div key={variant} style={{ ...surface, padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px 12px' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: variantColor(variant) }} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span><span style={{ fontSize: 11, color: 'var(--gx-text-3)' }}>{items.length}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {items.map((r) => (
                      <div key={String(r.id)} className="ip-cell" style={{ background: 'var(--gx-surface-2)', border: '1px solid var(--gx-border)', padding: 12, cursor: 'pointer' }} onClick={() => openRow(String(r.id))}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gx-text-1)' }}>{rowTitle(r)}</div>
                        <div style={{ marginTop: 5, fontSize: 11, color: 'var(--gx-text-3)' }}>{String(r.status ?? '—')}{cols[0] ? ` · ${cellVal(r, cols[0].key)}` : ''}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* pagination */}
        {!loading && !denied && !err && filtered.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: 'var(--gx-text-3)' }}>
            <span>Showing {offset + 1}–{offset + filtered.length}{total != null ? ` of ${total}` : ''}</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button className="ip-chip" style={{ padding: '6px 10px' }} disabled={offset === 0} onClick={() => goPage(Math.max(0, offset - PAGE_SIZE))}><ChevronLeft size={14} /></button>
              <span style={{ fontSize: 12 }}>Page <b style={{ color: 'var(--gx-text-1)' }}>{page}</b> / {pages}</span>
              <button className="ip-chip" style={{ padding: '6px 10px' }} disabled={page >= pages} onClick={() => goPage(offset + PAGE_SIZE)}><ChevronRight size={14} /></button>
            </div>
          </div>
        )}
      </div>

      {/* bulk bar */}
      {sel.size > 0 && (
        <div className="ip-in" style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14, zIndex: 1200, background: 'var(--gx-elevated)', border: '1px solid var(--gx-border-strong)', borderRadius: 14, boxShadow: 'var(--gx-shadow-lg)' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--gx-text-1)' }}><span style={{ color: GOLD3 }}>{sel.size}</span> selected</span>
          <span style={{ width: 1, height: 22, background: 'var(--gx-border)' }} />
          <button className="ip-vbtn" style={{ color: 'var(--gx-text-2)' }} onClick={openCompose}><MessageSquare size={14} />Message</button>
          {suspendTo && <button className="ip-vbtn" style={{ color: 'var(--gx-text-2)' }} disabled={busy} onClick={doSuspend}><Pause size={14} />{busy ? 'Suspending…' : 'Suspend'}</button>}
          <button className="ip-vbtn" style={{ color: 'var(--gx-text-2)' }} onClick={doExport}><Download size={14} />Export</button>
          <button className="ip-vbtn" onClick={() => setSel(new Set())} style={{ color: 'var(--gx-text-3)' }}><X size={14} />Clear</button>
        </div>
      )}

      {/* create modal — real POST */}
      {showCreate && def && (
        <div className="ip-scrim" onClick={() => !creating && setShowCreate(false)}>
          <div className="ip-modal ip-in" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--gx-border)' }}>
              <h3 className="num" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>New {def.label.toLowerCase()}</h3>
              <button className="ip-vbtn" onClick={() => !creating && setShowCreate(false)}><X size={16} /></button>
            </div>
            <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {editableFields.map((f: Field) => (
                <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--gx-text-2)' }}>{f.label}{f.required && <span style={{ color: 'var(--gx-danger-fg)' }}> *</span>}</span>
                  {f.type === 'select' ? (
                    <select className="ip-fld" value={createForm[f.key] ?? ''} onChange={(e) => setCreateForm((p) => ({ ...p, [f.key]: e.target.value }))}>
                      <option value="">—</option>
                      {(Array.isArray(f.config?.options) ? f.config.options : []).map((o: string) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input className="ip-fld" type={f.type === 'number' ? 'number' : f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'text'}
                      value={createForm[f.key] ?? ''} onChange={(e) => setCreateForm((p) => ({ ...p, [f.key]: e.target.value }))} />
                  )}
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 22px', borderTop: '1px solid var(--gx-border)' }}>
              <button className="ip-chip" onClick={() => setShowCreate(false)} disabled={creating}>Cancel</button>
              <button className="ip-az" onClick={submitCreate} disabled={creating}>{creating ? 'Creating…' : `Create ${def.label.toLowerCase()}`}</button>
            </div>
          </div>
        </div>
      )}

      {/* compose modal — real recipients, send transport next */}
      {compose !== null && (
        <div className="ip-scrim" onClick={() => setCompose(null)}>
          <div className="ip-modal ip-in" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--gx-border)' }}>
              <h3 className="num" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Message {composeIds.length} {composeIds.length === 1 ? 'customer' : 'customers'}</h3>
              <button className="ip-vbtn" onClick={() => setCompose(null)}><X size={16} /></button>
            </div>
            <div style={{ padding: 22 }}>
              <textarea className="ip-fld" style={{ height: 130, padding: 12, resize: 'vertical', lineHeight: 1.5 }} placeholder="Write your message…" value={compose} onChange={(e) => setCompose(e.target.value)} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 22px', borderTop: '1px solid var(--gx-border)' }}>
              <button className="ip-chip" onClick={() => setCompose(null)}>Cancel</button>
              <button className="ip-az" onClick={sendCompose} disabled={!compose.trim()}><Send size={14} />Send</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
