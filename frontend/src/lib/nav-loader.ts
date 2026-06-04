// SPEC §1 dynamic nav loader — fetches the canonical Left-Navigation tree from
// GAAhex (`GET /api/nav`) and transforms it into the existing `NavSectionDef` shape
// the sidebar already consumes. On any error (endpoint missing, network failure,
// empty response) returns `null` so the caller can fall back to the static
// `NAV_SECTIONS` config bundled with the frontend.
//
// Why this exists: the SPEC zero-bespoke directive — the IA should be data, not
// code. This is the read side; the static config stays as a guaranteed fallback
// until every tenant is migrated. No NAV_SECTIONS deletion in this step.
import {
  HomeIcon, ChartIcon, UsersIcon, ArchiveIcon, InboxIcon, ReceiptIcon,
  ServerIcon, TruckIcon, PackageIcon, BriefcaseIcon,
  SparkleIcon, MessageIcon, FolderIcon, LayersIcon, ShieldIcon,
  GearIcon, ActivityIcon, BuildingIcon, CalendarIcon,
  ClockIcon, RowsIcon, EditIcon, BookmarkIcon, MailIcon,
  CreditCardIcon, ArrowRightIcon, CheckIcon,
} from '../components/icons'
import type { NavItemDef, NavSectionDef } from './nav-config'

// Wire-shape returned by GAAhex's GET /api/nav (see routers/nav_registry.py).
type ApiNavModule = {
  key: string
  name: string
  order: number
  icon: string | null
  placement: 'O' | 'V'
  owner_module: string
  owner_record_keys: string[] | null
  route: string | null
  status: string
}
type ApiNavGroup = {
  group_key: string
  group_name: string
  group_order: number
  icon: string | null
  modules: ApiNavModule[]
}

// Per-group default icon + defaultOpen flag, keyed by the SPEC §1 stable group key.
// adminOnly mirrors the static config: System + Studio are admin-only.
const GROUP_META: Record<string, {
  icon: NavSectionDef['icon']
  defaultOpen?: boolean
  adminOnly?: boolean
}> = {
  workspace:          { icon: HomeIcon,       defaultOpen: true },
  work_management:    { icon: CheckIcon },
  crm:                { icon: UsersIcon },
  billing_revenue:    { icon: ArchiveIcon },
  network_operations: { icon: ServerIcon },
  analytics_ai:       { icon: ChartIcon },
  enterprise:         { icon: BriefcaseIcon },
  system:             { icon: GearIcon,       adminOnly: true },
  studio:             { icon: SparkleIcon,    adminOnly: true },
}

// Per-module-key icon overrides. Anything not listed here falls back to the
// group's icon. Only includes keys we expect to see from the SPEC seeder
// (see backend/app/seed_nav_registry.py SPEC_NAV_STRUCTURE).
const MODULE_ICONS: Record<string, NavItemDef['icon']> = {
  // Workspace
  home: HomeIcon, my_work: CheckIcon, communications: MessageIcon,
  calendar: CalendarIcon, global_search: ArrowRightIcon, knowledge_base: BookmarkIcon,
  activity_feed: ActivityIcon, saved_views: BookmarkIcon, recent_items: ClockIcon,
  team_workspace: UsersIcon, announcements: MailIcon,
  // Work Management
  tasks: CheckIcon, tickets: ArchiveIcon, projects: LayersIcon,
  // CRM
  pipeline: ArrowRightIcon, contracts: FolderIcon, customers: UsersIcon,
  campaigns: MailIcon, sales_channels: ArrowRightIcon, product_catalog: ArchiveIcon,
  // Billing & Revenue
  tariff_plans: ReceiptIcon, billing_accounts: BuildingIcon,
  orders_validation: ArchiveIcon, invoices: ReceiptIcon, payments: CreditCardIcon,
  collections: ClockIcon, revenue_assurance: ShieldIcon,
  // Network & Operations
  noc_dashboard: ChartIcon, network_monitoring: ActivityIcon, incidents_outages: InboxIcon,
  coverage_gis: ServerIcon, network_topology: LayersIcon, provisioning: GearIcon,
  service_inventory: ServerIcon, resource_inventory: PackageIcon, asset_management: PackageIcon,
  scheduling: CalendarIcon, dispatch_board: RowsIcon, work_orders: RowsIcon,
  stock_inventory: PackageIcon, warehouses: BuildingIcon,
  // Analytics & AI
  dashboards: ChartIcon, reports: BookmarkIcon, executive_dashboard: ChartIcon,
  ai_insights: SparkleIcon,
  // Enterprise
  finance: ReceiptIcon, accounting: ReceiptIcon, hr: UsersIcon,
  procurement: TruckIcon, legal: ShieldIcon, audit_logs: ShieldIcon,
  // System
  users: UsersIcon, roles_permissions: ShieldIcon, settings: GearIcon,
  integrations: LayersIcon, notifications_config: InboxIcon,
  // Studio (all share the sparkle)
  experience: SparkleIcon, data: LayersIcon, logic: GearIcon, security: ShieldIcon,
  intelligence: SparkleIcon, quality: CheckIcon, release: ArrowRightIcon,
  governance: ShieldIcon, system_control: GearIcon, marketplace: BuildingIcon,
  developer: EditIcon, notifications: InboxIcon, search: ArrowRightIcon,
  import_export: ArrowRightIcon, documentation: BookmarkIcon,
}

// Map a SPEC nav group + module pair into the existing GAAhex NavSectionDef
// shape. Modules without a known viewType render as a module-stub (handled by
// App.tsx's navItemClick) — same fallback the static config uses today.
function transform(groups: ApiNavGroup[]): NavSectionDef[] {
  return groups.map((g) => {
    const meta = GROUP_META[g.group_key] ?? { icon: RowsIcon }
    const items: NavItemDef[] = g.modules.map((m) => ({
      id: `${g.group_key}-${m.key}`,
      label: m.name,
      icon: MODULE_ICONS[m.key] ?? meta.icon,
      // No viewType ⇒ click renders the existing module-stub view, which is the
      // correct behavior until every SPEC module has a dedicated GAAhex view.
    }))
    return {
      id: g.group_key,
      label: g.group_name,
      icon: meta.icon,
      items,
      ...(meta.defaultOpen ? { defaultOpen: true } : {}),
      ...(meta.adminOnly ? { adminOnly: true } : {}),
    }
  })
}

import { BASE } from './config'

/**
 * Attempt to load the nav tree from GAAhex `/api/nav`. Returns the transformed
 * `NavSectionDef[]` on success; returns `null` on any error so the caller can
 * fall back to the static `NAV_SECTIONS`. Never throws.
 */
export async function loadDynamicNav(token: string): Promise<NavSectionDef[] | null> {
  try {
    const r = await fetch(`${BASE}/api/nav`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!r.ok) return null
    const data = (await r.json()) as ApiNavGroup[]
    if (!Array.isArray(data) || data.length === 0) return null
    return transform(data)
  } catch {
    return null
  }
}
