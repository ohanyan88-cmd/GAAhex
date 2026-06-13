// OrgPage — the single "Organisation" page (one page, three facets).
//   1. Hierarchy   → editable DEPARTMENT chart (CEO → departments → sub-units). Icons on the apex +
//                    top departments only; bottom-right burger menu (add/lock/move/delete); editing is
//                    SuperAdmin-only. Default view is vertical (left→right); toggle to horizontal.
//   2. Branches    → the company's offices / service branches on a map (presentation only).
//   3. Departments → the "department corner" (scope shaped live by Gev).
//
// Fully language-aware: chrome via t(); node name + people names stored PER language (en/hy/ru).
// A department's `lead` references a person by id from the people directory (UI-first stand-in for the
// backend Users table). Reached at /org.
import { useState, useRef, useEffect } from 'react'
import { Lock, Unlock, Plus, Trash2, ChevronUp, ChevronDown, Menu, Building2, Crown, TrendingUp, Wrench, Headphones, Receipt, Briefcase } from 'lucide-react'
import { PageShell } from '../page-shell'
import { BuildingIcon } from '../components/icons'
import { useAuth } from '../context/AuthContext'
import { useI18n, type Lang } from '../lib/i18n'

// ── Data ─────────────────────────────────────────────────────────────────────────────────────────
type LangText = Partial<Record<Lang, string>>
type Unit = { id: string; name: LangText; lead?: string; locked?: boolean; children?: Unit[] }
type RawUnit = { name: LangText; lead?: string; locked?: boolean; children?: RawUnit[] }

// Active-language value with graceful fallback (current → en → any) so a card is never blank.
function pickText(lt: LangText | undefined, lang: Lang): string {
  if (!lt) return ''
  return lt[lang] || lt.en || Object.values(lt).find(Boolean) || ''
}

// People directory — UI-first stand-in for the backend Users table. A department's head references a
// person by id, so renaming once updates every card. Drives the Head dropdown on each card.
type Person = { id: string; name: LangText }
const PEOPLE: Person[] = [
  { id: 'p-gevorg',  name: { en: 'Gevorg Ohanyan',   hy: 'Գևորգ Օհանյան',    ru: 'Геворг Оганян' } },
  { id: 'p-aram',    name: { en: 'Aram Petrosyan',   hy: 'Արամ Պետրոսյան',   ru: 'Арам Петросян' } },
  { id: 'p-anna',    name: { en: 'Anna Sargsyan',    hy: 'Աննա Սարգսյան',    ru: 'Анна Саргсян' } },
  { id: 'p-davit',   name: { en: 'Davit Hakobyan',   hy: 'Դավիթ Հակոբյան',   ru: 'Давид Акопян' } },
  { id: 'p-mariam',  name: { en: 'Mariam Grigoryan', hy: 'Մարիամ Գրիգորյան', ru: 'Мариам Григорян' } },
  { id: 'p-tigran',  name: { en: 'Tigran Vardanyan', hy: 'Տիգրան Վարդանյան', ru: 'Тигран Варданян' } },
  { id: 'p-lilit',   name: { en: 'Lilit Avagyan',    hy: 'Լիլիթ Ավագյան',    ru: 'Лилит Авагян' } },
]
function nameOf(people: Person[], id: string | undefined, lang: Lang): string {
  if (!id) return ''
  const p = people.find((x) => x.id === id)
  return p ? pickText(p.name, lang) : ''
}

const ORG_SEED: RawUnit = {
  name: { en: 'CEO', hy: 'Գլխավոր տնօրեն', ru: 'Ген. директор' },
  children: [
    {
      name: { en: 'COMMERCIAL', hy: 'Կոմերցիոն', ru: 'Коммерческий' },
      children: [
        {
          name: { en: 'SALES', hy: 'Վաճառք' },
          children: [
            { name: { en: 'RETAIL' } },
            { name: { en: 'TELE' } },
            { name: { en: 'D2D' } },
            { name: { en: 'B2B' } },
          ],
        },
        {
          name: { en: 'MARKETING', hy: 'Մարքեթինգ' },
          children: [
            { name: { en: 'Brand & PR' } },
            { name: { en: 'Content & SMM' } },
          ],
        },
      ],
    },
    {
      name: { en: 'TECHNICAL', hy: 'Տեխնիկական', ru: 'Технический' },
      children: [
        { name: { en: 'On-Site Support', hy: 'Ներտնային սպասարկում' } },
        { name: { en: 'Service Installation', hy: 'Ծառայության տեղադրում' } },
        {
          name: { en: 'Network Construction', hy: 'Ցանցի կառուցում' },
          children: [
            { name: { en: 'Cabling' } },
            { name: { en: 'Splicing' } },
          ],
        },
        {
          name: { en: 'NOC' },
          children: [
            { name: { en: 'Monitoring & Backup' } },
            { name: { en: 'L2 Troubleshooting' } },
          ],
        },
        {
          name: { en: 'Service Fulfillment', hy: 'Ծառայության ապահովում' },
          children: [
            { name: { en: 'Dispatching' } },
            { name: { en: 'Service Activation' } },
            { name: { en: 'Technical Inventory' } },
          ],
        },
      ],
    },
    {
      name: { en: 'CUSTOMER CARE', hy: 'Հաճախորդների սպասարկում', ru: 'Поддержка' },
      children: [
        { name: { en: 'Call Center & Customer Support', hy: 'Զանգերի կենտրոն և աջակցություն' } },
        { name: { en: 'Retention & Loyalty', hy: 'Պահպանում և հավատարմություն' } },
      ],
    },
    {
      name: { en: 'BILLING & REVENUE', hy: 'Վճարումներ և եկամուտ', ru: 'Биллинг' },
      children: [
        { name: { en: 'Billing Operations & Support', hy: 'Վճարման գործառնություններ' } },
        { name: { en: 'Activations', hy: 'Ակտիվացումներ' } },
      ],
    },
    {
      name: { en: 'ADMINISTRATIVE', hy: 'Վարչական', ru: 'Административный' },
      children: [
        { name: { en: 'Finance', hy: 'Ֆինանսներ' } },
        { name: { en: 'Procurement', hy: 'Գնումներ' } },
        { name: { en: 'HR', hy: 'Մարդկային ռեսուրսներ' } },
      ],
    },
  ],
}

const newId = () => crypto.randomUUID()
function withIds(n: RawUnit): Unit {
  return { id: newId(), name: { ...n.name }, lead: n.lead, locked: n.locked, children: n.children?.map(withIds) }
}
function updateNode(n: Unit, id: string, fn: (u: Unit) => Unit): Unit {
  if (n.id === id) return fn(n)
  return n.children ? { ...n, children: n.children.map((c) => updateNode(c, id, fn)) } : n
}
function removeNode(n: Unit, id: string): Unit {
  if (!n.children) return n
  return { ...n, children: n.children.filter((c) => c.id !== id).map((c) => removeNode(c, id)) }
}
function moveNode(n: Unit, id: string, dir: -1 | 1): Unit {
  if (!n.children) return n
  const idx = n.children.findIndex((c) => c.id === id)
  if (idx !== -1) {
    const j = idx + dir
    if (j < 0 || j >= n.children.length) return n
    const next = [...n.children]
    ;[next[idx], next[j]] = [next[j], next[idx]]
    return { ...n, children: next }
  }
  return { ...n, children: n.children.map((c) => moveNode(c, id, dir)) }
}

// One brand colour + unique icon per top-level department; descendants inherit their department's.
const DEPT_COLORS = ['oc-c-amber', 'oc-c-green', 'oc-c-cobalt', 'oc-c-violet', 'oc-c-azure']
const DEPT_ICONS = [TrendingUp, Wrench, Headphones, Receipt, Briefcase]
const ROOT_ICON = Crown

type Ops = {
  canEdit: boolean
  people: Person[]
  add: (id: string) => void
  rename: (id: string, value: string) => void
  setLead: (id: string, value: string) => void
  del: (id: string) => void
  move: (id: string, dir: -1 | 1) => void
  toggleLock: (id: string) => void
}

// Bottom-right burger menu holding the card actions. Reuses the org module's `.org-kebab-*` styling.
function CardMenu({ node, isRoot, ops }: { node: Unit; isRoot: boolean; ops: Ops }) {
  const { t, lang } = useI18n()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  const run = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); setOpen(false); fn() }
  return (
    <div className="oc-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`oc-menu-btn${open ? ' on' : ''}`}
        title={t('org.actions', 'Actions')}
        aria-label={`${t('org.actions', 'Actions')}: ${pickText(node.name, lang) || t('org.deptPlaceholder', 'Department')}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
      ><Menu size={15} /></button>
      {open && (
        <div className="oc-menu" role="menu">
          <button type="button" className="org-kebab-item" role="menuitem" onClick={run(() => ops.add(node.id))}><Plus size={15} /><span>{t('org.addSub', 'Add sub-unit')}</span></button>
          <button type="button" className="org-kebab-item" role="menuitem" onClick={run(() => ops.toggleLock(node.id))}>{node.locked ? <Unlock size={15} /> : <Lock size={15} />}<span>{node.locked ? t('org.unlock', 'Unlock') : t('org.lock', 'Lock')}</span></button>
          <button type="button" className="org-kebab-item" role="menuitem" onClick={run(() => ops.move(node.id, -1))}><ChevronUp size={15} /><span>{t('org.moveUp', 'Move up')}</span></button>
          <button type="button" className="org-kebab-item" role="menuitem" onClick={run(() => ops.move(node.id, 1))}><ChevronDown size={15} /><span>{t('org.moveDown', 'Move down')}</span></button>
          {!isRoot && (
            <>
              <div className="org-kebab-divider" />
              <button type="button" className="org-kebab-item org-kebab-danger" role="menuitem" onClick={run(() => ops.del(node.id))}><Trash2 size={15} /><span>{t('common.delete', 'Delete')}</span></button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function OrgCard({ node, isRoot, colorClass, Icon, showIcon, ops }: { node: Unit; isRoot: boolean; colorClass: string; Icon: typeof Building2; showIcon: boolean; ops: Ops }) {
  const { t, lang } = useI18n()
  return (
    <div className={`oc-card ${colorClass}${isRoot ? ' is-root' : ''}`}>
      <div className="oc-card-top">
        {showIcon && <span className="oc-card-icon" aria-hidden="true"><Icon size={20} /></span>}
        <div className="oc-card-main">
          <div className="oc-name-row">
            {ops.canEdit ? (
              <input
                className="oc-name-edit"
                value={node.name[lang] ?? ''}
                placeholder={node.name.en || t('org.deptPlaceholder', 'Department')}
                onChange={(e) => ops.rename(node.id, e.target.value)}
                aria-label={t('org.nameAria', 'Department name')}
              />
            ) : (
              <span className="oc-name-read">{pickText(node.name, lang) || '—'}</span>
            )}
            {node.locked && <Lock size={12} className="oc-card-lock" aria-label={t('org.lockedAria', 'Locked')} />}
          </div>
          {ops.canEdit ? (
            <div className="oc-card-lead">
              <select
                className="oc-lead-edit"
                value={node.lead ?? ''}
                onChange={(e) => ops.setLead(node.id, e.target.value)}
                aria-label={t('org.headAria', 'Department head')}
              >
                <option value="">—</option>
                {ops.people.map((p) => (
                  <option key={p.id} value={p.id}>{pickText(p.name, lang)}</option>
                ))}
              </select>
            </div>
          ) : nameOf(ops.people, node.lead, lang) ? (
            <div className="oc-card-lead">
              <span className="oc-lead-read">{nameOf(ops.people, node.lead, lang)}</span>
            </div>
          ) : null}
        </div>
      </div>

      {ops.canEdit && <CardMenu node={node} isRoot={isRoot} ops={ops} />}
    </div>
  )
}

function OrgTreeNode({ node, level = 0, colorClass, Icon, ops }: { node: Unit; level?: number; colorClass?: string; Icon?: typeof Building2; ops: Ops }) {
  const isRoot = level === 0
  const cc = colorClass ?? 'oc-c-gold'
  const Ic = Icon ?? ROOT_ICON
  return (
    <li>
      {/* Icon only on the apex (CEO) + the top-level departments; sub-units carry none. */}
      <OrgCard node={node} isRoot={isRoot} colorClass={cc} Icon={Ic} showIcon={level <= 1} ops={ops} />
      {node.children && node.children.length > 0 && (
        <ul>{node.children.map((c, i) => (
          <OrgTreeNode
            key={c.id}
            node={c}
            level={level + 1}
            colorClass={isRoot ? DEPT_COLORS[i % DEPT_COLORS.length] : cc}
            Icon={isRoot ? DEPT_ICONS[i % DEPT_ICONS.length] : Ic}
            ops={ops}
          />
        ))}</ul>
      )}
    </li>
  )
}

// Zoom clamped to 0.4–1.6, snapped to 0.1 steps (shared by the +/- buttons and Ctrl+wheel).
const clampZoom = (z: number) => Math.min(1.6, Math.max(0.4, Math.round(z * 10) / 10))

function HierarchyTab() {
  // Editing the chart is SuperAdmin-only (same gate as the Admin Panel / Studio): user.can_configure.
  const { user } = useAuth()
  const { lang } = useI18n()
  const canEdit = !!user?.can_configure
  const [tree, setTree] = useState<Unit>(() => withIds(ORG_SEED))
  const [zoom, setZoom] = useState(1)
  const [vertical] = useState(true)  // vertical (left→right) layout
  const canvasRef = useRef<HTMLDivElement>(null)

  // Ctrl + mouse wheel zooms (also trackpad pinch). Native listener because React's onWheel is passive.
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setZoom((z) => clampZoom(z + (e.deltaY < 0 ? 0.1 : -0.1)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const ops: Ops = {
    canEdit,
    people: PEOPLE,
    add: (id) => setTree((tr) => updateNode(tr, id, (n) => ({ ...n, children: [...(n.children ?? []), { id: newId(), name: {} }] }))),
    rename: (id, value) => setTree((tr) => updateNode(tr, id, (n) => ({ ...n, name: { ...n.name, [lang]: value } }))),
    setLead: (id, value) => setTree((tr) => updateNode(tr, id, (n) => ({ ...n, lead: value || undefined }))),
    del: (id) => setTree((tr) => removeNode(tr, id)),
    move: (id, dir) => setTree((tr) => moveNode(tr, id, dir)),
    toggleLock: (id) => setTree((tr) => updateNode(tr, id, (n) => ({ ...n, locked: !n.locked }))),
  }

  return (
    <div className="oc-canvas" ref={canvasRef}>
      <div className="oc-scroll">
        <div className={`oc-tree${vertical ? ' is-vertical' : ''}`} style={{ zoom }}>
          <ul><OrgTreeNode node={tree} ops={ops} /></ul>
        </div>
      </div>
    </div>
  )
}

export default function OrgPage() {
  const { t } = useI18n()
  return (
    <PageShell
      type="CONFIGURATION"
      breadcrumb={[t('org.crumbOps', 'Operations'), t('org.title', 'Organisation')]}
      icon={<BuildingIcon size={18} />}
      title={t('org.title', 'Organisation')}
      subtitle={t('org.subtitle', 'People & structure — the company org chart')}
    >
      <div className="card oc-page-card">
        <HierarchyTab />
      </div>
    </PageShell>
  )
}
