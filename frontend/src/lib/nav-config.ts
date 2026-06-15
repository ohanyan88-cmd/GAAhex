import type { ComponentType } from 'react'
import {
  HomeIcon,
  ChartIcon,
  UsersIcon,
  InboxIcon,
  ReceiptIcon,
  ServerIcon,
  TruckIcon,
  PackageIcon,
  BriefcaseIcon,
  SparkleIcon,
  LayersIcon,
  ShieldIcon,
  GearIcon,
  ActivityIcon,
  BuildingIcon,
  EditIcon,
  RowsIcon,
  CreditCardIcon,
  ArrowRightIcon,
  CheckIcon,
} from '../components/icons'

export type NavItemDef = {
  id: string
  label: string
  icon: ComponentType<{ size?: number; className?: string }>
  viewType?: string
  viewArgs?: Record<string, string>
}

export type NavSectionDef = {
  id: string
  label: string
  icon: ComponentType<{ size?: number; className?: string }>
  /** Direct leaf items rendered under this section. */
  items: NavItemDef[]
  /** Optional nested sub-sections rendered after `items` (one level of nesting supported). */
  subsections?: NavSectionDef[]
  /** Restrict visibility to users with `can_configure` (SuperAdmin gate). */
  adminOnly?: boolean
  /** Pre-expanded on first render. */
  defaultOpen?: boolean
  /** When true, renders as a direct top-level nav link instead of a collapsible group. */
  standalone?: boolean
  /** View type to navigate to when standalone=true. */
  viewType?: string
}

const i = (
  id: string,
  label: string,
  icon: NavItemDef['icon'],
  viewType?: string,
  viewArgs?: NavItemDef['viewArgs'],
): NavItemDef => ({
  id,
  label,
  icon,
  ...(viewType ? { viewType, ...(viewArgs ? { viewArgs } : {}) } : {}),
})

const s = (
  id: string,
  label: string,
  icon: NavSectionDef['icon'],
  items: NavItemDef[],
  opts?: Partial<NavSectionDef>,
): NavSectionDef => ({ id, label, icon, items, ...opts })

// ─────────────────────────────────────────────────────────────────────────────
// Left navigation — LOCKED SPEC 2026-06-15 per ARCHITECTURE_LOCKED.md.
// 5 Platform Laws enforced. This file is the nav SST.
// Do not reorder, rename, add, or remove items without owner sign-off.
//
// Hidden items preserved as dead constants below NAV_SECTIONS:
//   ERP_HIDDEN_SECTIONS  — Enterprise (HR · Procurement · Legal · Finance)
//   PROJECTS_SECTION     — Projects standalone link
// Routes + code for all hidden items are UNTOUCHED — nav only.
// ─────────────────────────────────────────────────────────────────────────────
export const NAV_SECTIONS: NavSectionDef[] = [
  // WORKSPACE — Rule #1: Login always opens Workspace.
  // Ask Me removed from nav → prominent header feature (Phase 1b).
  s('home', 'Home', HomeIcon, [i('home-workspace', 'Workspace', HomeIcon, 'home')], {
    defaultOpen: true,
  }),

  // ── CORE PLATFORM ──────────────────────────────────────────────────────────

  // CRM — Pipeline → Campaigns → Leads → Customers (Rule #4 chain)
  // Orders removed: born from Pipeline #6 transition (SYSTEM ACTION) → lives in Operations.
  s('crm', 'CRM', UsersIcon, [
    i('crm-pipeline', 'Pipeline', ArrowRightIcon, 'lead-pipeline'),
    i('crm-campaigns', 'Campaigns', SparkleIcon, 'coming-soon', {
      id: 'campaigns',
      title: 'Campaigns',
      parent: 'CRM',
    }),
    i('crm-leads', 'Leads', InboxIcon, 'entity', { slug: 'leads' }),
    i('crm-customers', 'Customers', UsersIcon, 'entity', { slug: 'customers' }),
  ]),

  // Operations — root entity = Order (SYSTEM-born, never manually created — Rule #4).
  // Orders moved in from CRM. Work Orders = field execution of an Order.
  s('operations', 'Operations', ActivityIcon, [
    i('ops-orders', 'Orders', ReceiptIcon, 'entity', { slug: 'orders' }),
    i('ops-work-orders', 'Work Orders', TruckIcon, 'coming-soon', {
      id: 'work-orders',
      title: 'Work Orders',
      parent: 'Operations',
    }),
  ]),

  // Billing (was "Billing & Revenue")
  s('billing', 'Billing', ReceiptIcon, [
    i('bil-invoices', 'Invoices', ReceiptIcon, 'invoices'),
    i('bil-payments', 'Payments', CreditCardIcon, 'payments'),
    i('bil-collections', 'Collections', InboxIcon, 'collections'),
    i('bil-adjustments', 'Adjustments', EditIcon, 'coming-soon', {
      id: 'adjustments',
      title: 'Adjustments',
      parent: 'Billing',
    }),
  ]),

  // Network Operations (was "Tech & NOC")
  // Rule #5 exception: NOC Dashboard = real-time monitoring → Left Nav ✅
  // Routes untouched but hidden from nav:
  //   /installation-board → Work Orders inner (Install type)
  //   /helpdesk           → Customer 360 + Pipeline (Ticket Lifecycle)
  //   /dispatch-board     → Orders → Dispatch View
  //   /network-inventory  → Equipment inner view
  s('network_ops', 'Network Operations', ServerIcon, [
    i('noc-dashboard', 'NOC Dashboard', ServerIcon, 'noc-dashboard'),
    i('noc-incidents', 'Incidents', ActivityIcon, 'coming-soon', {
      id: 'incidents',
      title: 'Incidents',
      parent: 'Network Operations',
    }),
    i('noc-monitoring', 'Monitoring', ChartIcon, 'coming-soon', {
      id: 'monitoring',
      title: 'Monitoring',
      parent: 'Network Operations',
    }),
    i('noc-radius', 'RADIUS Sessions', ServerIcon, 'coming-soon', {
      id: 'radius',
      title: 'RADIUS Sessions',
      parent: 'Network Operations',
    }),
    i('noc-ipam', 'IPAM', LayersIcon, 'coming-soon', {
      id: 'ipam',
      title: 'IPAM',
      parent: 'Network Operations',
    }),
    i('noc-fiber', 'Fiber Network', ActivityIcon, 'coming-soon', {
      id: 'fiber',
      title: 'Fiber Network',
      parent: 'Network Operations',
    }),
  ]),

  // Inventory (new section)
  // Equipment consolidates Customer/Network/Field/Spare gear (inner views).
  // Warehouses moved in from old Operations section.
  s('inventory', 'Inventory', PackageIcon, [
    i('inv-equipment', 'Equipment', PackageIcon, 'coming-soon', {
      id: 'equipment',
      title: 'Equipment',
      parent: 'Inventory',
    }),
    i('inv-warehouses', 'Warehouses', PackageIcon, 'coming-soon', {
      id: 'warehouse',
      title: 'Warehouses',
      parent: 'Inventory',
    }),
  ]),

  // ── GENERAL ────────────────────────────────────────────────────────────────

  // Reports (was "Analytics & AI")
  // Operational Dashboards hidden → Workspace (Rule #5: non-real-time → Workspace only).
  s('reports', 'Reports', ChartIcon, [
    i('rep-executive', 'Executive Reports', ChartIcon, 'coming-soon', {
      id: 'reports-executive',
      title: 'Executive Reports',
      parent: 'Reports',
    }),
    i('rep-sales', 'Sales Reports', ChartIcon, 'coming-soon', {
      id: 'reports-sales',
      title: 'Sales Reports',
      parent: 'Reports',
    }),
    i('rep-customer', 'Customer Reports', ChartIcon, 'coming-soon', {
      id: 'reports-customer',
      title: 'Customer Reports',
      parent: 'Reports',
    }),
    i('rep-technical', 'Technical Reports', ChartIcon, 'coming-soon', {
      id: 'reports-technical',
      title: 'Technical Reports',
      parent: 'Reports',
    }),
    i('rep-financial', 'Financial Reports', ChartIcon, 'coming-soon', {
      id: 'reports-financial',
      title: 'Financial Reports',
      parent: 'Reports',
    }),
  ]),

  // Organization (new section — owner directive 2026-06-15)
  // Users + Roles moved OUT of Admin Panel into Organization.
  // Departments maps to existing /org route (OrgPage: Hierarchy · Branches).
  s('organization', 'Organization', BuildingIcon, [
    i('org-departments', 'Departments', BuildingIcon, 'org'),
    i('org-employees', 'Employees', UsersIcon, 'entity', { slug: 'employees' }),
    i('org-roles', 'Roles', ShieldIcon, 'entity', { slug: 'roles' }),
    i('org-users', 'Users', UsersIcon, 'entity', { slug: 'users' }),
  ]),

  // Admin Panel — flattened to 7 items per locked spec (SuperAdmin only).
  // Subsections removed from nav: Records engine stays (Studio → Entity Builder).
  // System sub-items: Settings + Webhooks survive; Users/Roles moved to Organization.
  // Studio collapsed to single nav entry; internals live on the Studio page.
  s(
    'admin_panel',
    'Admin Panel',
    ShieldIcon,
    [
      i('adm-settings', 'Settings', GearIcon, 'settings'),
      i('adm-payment-gateways', 'Payment Gateways', CreditCardIcon, 'gateway'),
      i('adm-audit-logs', 'Audit Logs', RowsIcon, 'coming-soon', {
        id: 'audit-logs',
        title: 'Audit Logs',
        parent: 'Admin Panel',
      }),
      i('adm-system-health', 'System Health', ActivityIcon, 'coming-soon', {
        id: 'system-health',
        title: 'System Health',
        parent: 'Admin Panel',
      }),
      i('adm-webhooks', 'Webhooks', LayersIcon, 'webhooks'),
      i('adm-feature-flags', 'Feature Flags', CheckIcon, 'coming-soon', {
        id: 'feature-flags',
        title: 'Feature Flags',
        parent: 'Admin Panel',
      }),
      i('adm-studio', 'Studio', SparkleIcon, 'studio'),
    ],
    { adminOnly: true },
  ),
]

// ─────────────────────────────────────────────────────────────────────────────
// ERP EXPANSION — HIDDEN · NOT DELETED
// Routes + views + entity slugs are untouched. Phase N re-enables these.
// To re-enable: splice into NAV_SECTIONS at the correct position.
// ─────────────────────────────────────────────────────────────────────────────
export const ERP_HIDDEN_SECTIONS: NavSectionDef[] = [
  s('enterprise', 'Enterprise', BriefcaseIcon, [
    i('ent-finance', 'Back-Office Finance', ChartIcon, 'entity', { slug: 'expenses' }),
    i('ent-hr', 'Human Resources', UsersIcon, 'entity', { slug: 'employees' }),
    i('ent-procurement', 'Procurement & Vendors', PackageIcon, 'entity', {
      slug: 'purchase-orders',
    }),
    i('ent-legal', 'Legal & Contracts', ShieldIcon, 'entity', { slug: 'contracts' }),
  ]),
]

// ─────────────────────────────────────────────────────────────────────────────
// HIDDEN ITEMS — routes + views untouched; removed from nav per locked spec
// ─────────────────────────────────────────────────────────────────────────────

// Projects: not in locked Left Nav spec. Route /projects + view untouched.
export const PROJECTS_SECTION: NavSectionDef = s('projects', 'Projects', LayersIcon, [], {
  standalone: true,
  viewType: 'projects',
})

// Tariff Plans: not in locked Billing spec. Route /tariff-plans + view untouched.
// viewType: 'tariff-plans' — re-enable as Billing sub-item if needed in Phase N.
