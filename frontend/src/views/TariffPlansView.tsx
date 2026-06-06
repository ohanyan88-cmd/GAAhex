// TariffPlansView — real CRUD over /api/tariff-plans (Phase A.1 backend).
//
// Reads are open to any authenticated tenant user. Writes (create / edit / retire)
// require config.manage on the backend; we additionally gate the UI affordances on
// `capabilities.canConfigure || can(capabilities, 'tariff_plan', 'edit')` so admins
// see the actions even if the per-entity capability map doesn't ship a `tariff_plan`
// entry yet.
//
// Money: the backend returns Decimal as a string ("29.99"); we display it via a
// local `decimalString()` helper (the shared `money()` helper deals in luma — wrong
// unit for this catalog).
//
// Soft-delete: POST is via DELETE /api/tariff-plans/{id} which flips active=false.
import { useEffect, useMemo, useState } from 'react'
import { bget, bpost, bpatch, bdel } from '../lib/billing'
import { can, type Capabilities } from '../lib/capabilities'
import { toast } from '../components/Toast'
import { confirmDialog } from '../components/Modal'
import { EmptyState, ErrorBanner, PermissionDenied } from '../components/States'
import {
  BookmarkIcon,
} from '../components/icons'
import {
  Plus, ChevronsUpDown, ArrowUp, ArrowDown,
} from 'lucide-react'
import { PageShell, type KPISpec } from '../page-shell'
import { Button, Pagination, StatusPill } from '../primitives'

interface TariffPlan {
  id: string
  key: string
  name: string
  description: string | null
  base_recurring_price: string    // Decimal returned as string
  included_units: number | null
  overage_rate: string | null     // Decimal returned as string
  tiers_json: Array<{ from: number; to: number; rate: string }>
  cycle: 'monthly' | 'quarterly' | 'yearly'
  active: boolean
  created_at: string
}

type Cycle = 'monthly' | 'quarterly' | 'yearly'

type Draft = {
  id?: string
  key: string                     // immutable once set — only used on create
  name: string
  description: string
  base_recurring_price: string
  included_units: string          // form-bound string; '' = null on submit
  overage_rate: string            // form-bound string; '' = null on submit
  tiers_text: string              // JSON text the user edits
  cycle: Cycle
  active: boolean
}

const EMPTY: Draft = {
  key: '',
  name: '',
  description: '',
  base_recurring_price: '',
  included_units: '',
  overage_rate: '',
  tiers_text: '[]',
  cycle: 'monthly',
  active: true,
}

const PAGE_SIZE = 25

// Decimal-string formatter. The backend returns "29.99" / "0.0500" — render with
// 2 fractional digits and grouping. Pass-through "—" for null / undefined / NaN.
function decimalString(v: string | null | undefined, fractionDigits = 2): string {
  if (v == null) return '—'
  const n = Number(v)
  if (isNaN(n)) return '—'
  return n.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
}

// Validate that the tiers text parses to an array of {from:int, to:int, rate:string}.
// Returns the parsed array on success, or an error message on failure.
function parseTiers(text: string): { ok: true; tiers: Array<{ from: number; to: number; rate: string }> } | { ok: false; error: string } {
  const trimmed = text.trim()
  if (trimmed === '' || trimmed === '[]') return { ok: true, tiers: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { ok: false, error: 'Tiers must be valid JSON.' }
  }
  if (!Array.isArray(parsed)) return { ok: false, error: 'Tiers must be a JSON array.' }
  for (let i = 0; i < parsed.length; i++) {
    const t = parsed[i] as Record<string, unknown> | null
    if (!t || typeof t !== 'object') return { ok: false, error: `Tier ${i + 1} must be an object.` }
    const from = (t as { from?: unknown }).from
    const to = (t as { to?: unknown }).to
    const rate = (t as { rate?: unknown }).rate
    if (typeof from !== 'number' || !Number.isInteger(from)) return { ok: false, error: `Tier ${i + 1}: "from" must be an integer.` }
    if (typeof to !== 'number' || !Number.isInteger(to)) return { ok: false, error: `Tier ${i + 1}: "to" must be an integer.` }
    if (typeof rate !== 'string' && typeof rate !== 'number') return { ok: false, error: `Tier ${i + 1}: "rate" must be a string.` }
  }
  return {
    ok: true,
    tiers: (parsed as Array<{ from: number; to: number; rate: string | number }>).map((t) => ({
      from: t.from,
      to: t.to,
      rate: String(t.rate),
    })),
  }
}

export default function TariffPlansView({
  token,
  canConfigure = false,
  capabilities = {},
}: {
  token: string
  canConfigure?: boolean
  capabilities?: Capabilities
}) {
  const [list, setList] = useState<TariffPlan[] | null>(null)
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [denied, setDenied] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [tiersError, setTiersError] = useState('')

  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<1 | -1>(1)
  const [page, setPage] = useState(1)

  // Writes are admin-only. Tolerant: prefer canConfigure (the superadmin flag we
  // already have) and fall back to the per-entity capability if it's seeded.
  const canWrite = canConfigure || can(capabilities, 'tariff_plan', 'edit')

  async function load() {
    setError(''); setUnavailable(false); setDenied(false); setList(null)
    const res = await bget<TariffPlan[]>(token, '/api/tariff-plans')
    if (res.status === 404) { setUnavailable(true); setList([]); return }
    if (res.status === 403) { setDenied(true); setList([]); return }
    if (!res.ok) { setError('Failed to load tariff plans'); setList([]); return }
    setList(Array.isArray(res.data) ? res.data : [])
  }

  useEffect(() => { load() }, [token])
  useEffect(() => { setPage(1) }, [query, sortKey, sortDir])

  function openCreate() {
    setTiersError('')
    setDraft({ ...EMPTY })
  }

  function openEdit(p: TariffPlan) {
    setTiersError('')
    setDraft({
      id: p.id,
      key: p.key,
      name: p.name,
      description: p.description ?? '',
      base_recurring_price: p.base_recurring_price ?? '',
      included_units: p.included_units != null ? String(p.included_units) : '',
      overage_rate: p.overage_rate ?? '',
      tiers_text: JSON.stringify(p.tiers_json ?? [], null, 2),
      cycle: p.cycle,
      active: p.active,
    })
  }

  async function save() {
    if (!draft) return
    if (!draft.name.trim()) return
    if (!draft.id && !draft.key.trim()) return
    if (!draft.base_recurring_price.trim()) return

    const tiers = parseTiers(draft.tiers_text)
    if (!tiers.ok) {
      setTiersError(tiers.error)
      return
    }
    setTiersError('')

    // Coerce form strings into the payload shape the backend expects. Decimal
    // values are sent as strings (the router parses through Decimal(str(value))).
    const includedUnits = draft.included_units.trim() === ''
      ? null
      : Number.parseInt(draft.included_units.trim(), 10)
    if (includedUnits !== null && (isNaN(includedUnits) || includedUnits < 0)) {
      toast.error('Included units must be a non-negative integer')
      return
    }
    const overageRate = draft.overage_rate.trim() === '' ? null : draft.overage_rate.trim()

    const payload: Record<string, unknown> = {
      name: draft.name.trim(),
      description: draft.description.trim() === '' ? null : draft.description.trim(),
      base_recurring_price: draft.base_recurring_price.trim(),
      included_units: includedUnits,
      overage_rate: overageRate,
      tiers_json: tiers.tiers,
      cycle: draft.cycle,
      active: draft.active,
    }

    try {
      if (draft.id) {
        // key is immutable on PATCH — don't send it.
        await bpatch(token, `/api/tariff-plans/${draft.id}`, payload)
        toast.success('Tariff plan updated')
      } else {
        payload.key = draft.key.trim()
        await bpost(token, '/api/tariff-plans', payload)
        toast.success('Tariff plan created')
      }
      setDraft(null)
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  async function retire(p: TariffPlan) {
    const ok = await confirmDialog({
      title: `Retire ${p.name}`,
      message: 'Retire this tariff plan? Existing subscriptions are unaffected; the plan will no longer be selectable on new orders.',
      confirmLabel: 'Retire',
      danger: true,
    })
    if (!ok) return
    try {
      // Backend soft-deletes via DELETE (sets active=false).
      await bdel(token, `/api/tariff-plans/${p.id}`)
      toast.success('Tariff plan retired')
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const all = list ?? []
  const activeCount = all.filter((p) => p.active).length
  const retiredCount = all.filter((p) => !p.active).length

  const kpis: KPISpec[] = all.length > 0 ? [
    { label: 'Total', value: all.length, subtitle: `${activeCount} active`, onClick: () => setQuery('') },
    { label: 'Active', value: activeCount, subtitle: 'offerable' },
    ...(retiredCount > 0 ? [{ label: 'Retired', value: retiredCount, subtitle: 'read-only', muted: true }] : []),
  ] : []

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter((p) => {
      const fields = [
        p.name ?? '',
        p.key ?? '',
        p.description ?? '',
        p.cycle ?? '',
      ].join(' ').toLowerCase()
      return fields.includes(q)
    })
  }, [all, query])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const k = sortKey
    const dir = sortDir
    const get = (p: TariffPlan): string | number => {
      switch (k) {
        case 'name': return p.name ?? ''
        case 'key': return p.key ?? ''
        case 'cycle': return p.cycle ?? ''
        case 'base': return Number(p.base_recurring_price ?? 0)
        case 'units': return p.included_units ?? -1
        case 'overage': return p.overage_rate != null ? Number(p.overage_rate) : -1
        case 'tiers': return (p.tiers_json ?? []).length
        case 'active': return p.active ? 1 : 0
        default: return ''
      }
    }
    return [...filtered].sort((a, b) => {
      const x = get(a), y = get(b)
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
      return String(x).localeCompare(String(y)) * dir
    })
  }, [filtered, sortKey, sortDir])

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function toggleSort(k: string) {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1))
    else { setSortKey(k); setSortDir(1) }
  }

  function thButton(label: string, k: string, align: 'left' | 'right' = 'left') {
    const isOn = sortKey === k
    return (
      <th
        key={k}
        scope="col"
        className={align === 'right' ? 'num' : ''}
        onClick={() => toggleSort(k)}
        style={{ cursor: 'pointer', userSelect: 'none' }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {label}
          {isOn
            // D18: active sort indicator = azure (interactive cue)
            ? (sortDir === 1 ? <ArrowUp size={12} style={{ color: 'var(--gx-interactive)' }} /> : <ArrowDown size={12} style={{ color: 'var(--gx-interactive)' }} />)
            : <ChevronsUpDown size={12} style={{ opacity: 0.35 }} />}
        </span>
      </th>
    )
  }

  return (
    <PageShell
      type="REGISTRY"
      breadcrumb={['Billing & Revenue', 'Tariff Plans']}
      icon={<BookmarkIcon size={18} />}
      title="Tariff Plans"
      subtitle="Configurable pricing tiers for ISP services"
      kpis={kpis}
      primaryAction={!unavailable && !denied && canWrite ? {
        label: draft ? 'Close' : 'New tariff plan',
        icon: <Plus size={14} />,
        onClick: () => (draft ? setDraft(null) : openCreate()),
      } : undefined}
      filters={{ search: { value: query, onChange: setQuery, placeholder: 'Search tariff plans…' } }}
    >
        {draft && canWrite && (
          <div className="rec-form">
            {!draft.id && (
              <label className="field">
                <span>Key (snake) *</span>
                <input
                  className="inp inp-md"
                  value={draft.key}
                  onChange={(e) => setDraft({ ...draft, key: e.target.value })}
                  placeholder="fiber_100_basic"
                />
              </label>
            )}
            <label className="field">
              <span>Name *</span>
              <input
                className="inp inp-md"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Fiber 100 Basic"
              />
            </label>
            <label className="field">
              <span>Cycle</span>
              <select
                className="inp inp-md"
                value={draft.cycle}
                onChange={(e) => setDraft({ ...draft, cycle: e.target.value as Cycle })}
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </label>
            <label className="field">
              <span>Base MRC *</span>
              <input
                className="inp inp-md inp-numeric"
                type="number"
                step="0.01"
                value={draft.base_recurring_price}
                onChange={(e) => setDraft({ ...draft, base_recurring_price: e.target.value })}
                placeholder="29.99"
              />
            </label>
            <label className="field">
              <span>Included Units</span>
              <input
                className="inp inp-md inp-numeric"
                type="number"
                value={draft.included_units}
                onChange={(e) => setDraft({ ...draft, included_units: e.target.value })}
                placeholder="(optional)"
              />
            </label>
            <label className="field">
              <span>Overage Rate</span>
              <input
                className="inp inp-md inp-numeric"
                type="number"
                step="0.0001"
                value={draft.overage_rate}
                onChange={(e) => setDraft({ ...draft, overage_rate: e.target.value })}
                placeholder="(optional)"
              />
            </label>
            <label className="field" style={{ gridColumn: '1 / -1' }}>
              <span>Description</span>
              <input
                className="inp inp-md"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="(optional)"
              />
            </label>
            <label className="field" style={{ gridColumn: '1 / -1' }}>
              <span>Tiers (JSON)</span>
              <textarea
                className="inp inp-md"
                rows={4}
                value={draft.tiers_text}
                onChange={(e) => { setDraft({ ...draft, tiers_text: e.target.value }); if (tiersError) setTiersError('') }}
                placeholder='[{"from":0,"to":100,"rate":"0.05"}]'
                style={{ fontFamily: 'var(--gx-font-mono, monospace)', fontSize: 12 }}
              />
              {tiersError && (
                <span style={{ color: 'var(--gx-danger-fg)', fontSize: 'var(--gx-text-sm)', marginTop: 4 }}>
                  {tiersError}
                </span>
              )}
            </label>
            <label className="field">
              <span>Active</span>
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
              />
            </label>
            <div className="rec-form-actions">
              <Button variant="gold" size="md"
            onClick={save}
                disabled={
                  !draft.name.trim()
                  || (!draft.id && !draft.key.trim())
                  || !draft.base_recurring_price.trim()
                }>
                {draft.id ? 'Save' : 'Create'}
              </Button>
            </div>
          </div>
        )}

        {error && <ErrorBanner message={error} onRetry={load} />}
        {list === null && !error && <p className="muted">Loading…</p>}
        {denied && <PermissionDenied />}
        {unavailable && (
          <EmptyState
            icon={<BookmarkIcon size={40} />}
            title="Catalog endpoint unavailable"
            message="Tariff plans will appear once the catalog service is enabled."
          />
        )}
        {list && !unavailable && !denied && list.length === 0 && !error && (
          <EmptyState
            icon={<BookmarkIcon size={40} />}
            title="No tariff plans yet"
            message="Tariff plans define base recurring price, included units, overage and tiered rates."
            action={canWrite ? (
              <Button variant="primary" size="sm"
            onClick={openCreate}>
                <Plus size={14} /> Create your first tariff plan
              </Button>
            ) : undefined}
          />
        )}

        {list && list.length > 0 && (
          <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
            <div className="grid-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    {thButton('Name', 'name')}
                    {thButton('Key', 'key')}
                    {thButton('Cycle', 'cycle')}
                    {thButton('Base MRC', 'base', 'right')}
                    {thButton('Included Units', 'units', 'right')}
                    {thButton('Overage Rate', 'overage', 'right')}
                    {thButton('Tiers', 'tiers', 'right')}
                    {thButton('Status', 'active')}
                    <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>
                        <span className="mono" style={{ color: 'var(--gx-text-3)' }}>{p.key}</span>
                      </td>
                      <td style={{ color: 'var(--gx-text-2)', textTransform: 'capitalize' }}>{p.cycle}</td>
                      <td className="num">
                        <span className="mono tnum">{decimalString(p.base_recurring_price)}</span>
                      </td>
                      <td className="num">
                        <span className="mono tnum">
                          {p.included_units != null ? p.included_units.toLocaleString('en-US') : '—'}
                        </span>
                      </td>
                      <td className="num">
                        <span className="mono tnum">{decimalString(p.overage_rate, 4)}</span>
                      </td>
                      <td className="num">
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 7px',
                            borderRadius: 999,
                            background: 'var(--gx-bg-subtle)',
                            color: 'var(--gx-text-2)',
                            fontSize: 'var(--gx-text-11)',
                            fontWeight: 600,
                          }}
                          title={(p.tiers_json ?? []).length === 0 ? 'No tiers' : `${(p.tiers_json ?? []).length} tier(s)`}
                        >
                          {(p.tiers_json ?? []).length}
                        </span>
                      </td>
                      <td>
                        <StatusPill
                          variant={p.active ? 'active' : 'neutral'}
                          label={p.active ? 'active' : 'retired'}
                          size="sm"
                        />
                      </td>
                      <td className="actions-col" onClick={(e) => e.stopPropagation()}>
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          {canWrite && (
                            <Button variant="ghost" size="sm"
            onClick={() => openEdit(p)}>
                              Edit
                            </Button>
                          )}
                          {canWrite && p.active && (
                            <Button variant="ghost" size="sm"
            onClick={() => retire(p)}>
                              Retire
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', padding: 'var(--gx-space-9)', color: 'var(--gx-text-3)' }}>
                        No matching tariff plans.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <Pagination
              page={page}
              pageCount={pageCount}
              pageSize={PAGE_SIZE}
              total={sorted.length}
              onChange={setPage}
            />
          </div>
        )}
    </PageShell>
  )
}
