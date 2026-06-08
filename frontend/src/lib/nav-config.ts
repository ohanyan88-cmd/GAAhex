import type { ComponentType } from 'react'
import {
  HomeIcon, ChartIcon, UsersIcon, ArchiveIcon, InboxIcon, ReceiptIcon,
  ServerIcon, TruckIcon, PackageIcon, BriefcaseIcon,
  SparkleIcon, MessageIcon, LayersIcon, ShieldIcon,
  GearIcon, ActivityIcon, BuildingIcon, CalendarIcon,
  EditIcon, BookmarkIcon, MailIcon, RowsIcon,
  CreditCardIcon, ArrowRightIcon, CheckIcon,
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
  /** Restrict visibility to users with `can_configure` (i.e. the existing config.manage permission — our SuperAdmin gate). */
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
): NavItemDef =>
  ({ id, label, icon, ...(viewType ? { viewType, ...(viewArgs ? { viewArgs } : {}) } : {}) })

const s = (id: string, label: string, icon: NavSectionDef['icon'], items: NavItemDef[], opts?: Partial<NavSectionDef>): NavSectionDef =>
  ({ id, label, icon, items, ...opts })

// ─────────────────────────────────────────────────────────────────────────────
// Left navigation — locked spec rewritten 2026-06-01 per Gev's directive.
// Hierarchy is the source of truth. Do not reorder, rename, or split items.
//
// Admin grouping (2026-06-01 refinement): System + Dev Internals + Studio +
// Records are no longer top-level. They live as sub-sections inside ADMIN PANEL,
// which is gated by user.can_configure (the existing SuperAdmin permission).
// ─────────────────────────────────────────────────────────────────────────────
export const NAV_SECTIONS: NavSectionDef[] = [

  s('workspace', 'Home', HomeIcon, [], { standalone: true, viewType: 'home' }),

  s('crm', 'CRM', UsersIcon, [
    i('crm-leads',          'Leads',          InboxIcon,      'entity', { slug: 'leads' }),
    i('crm-pipeline',       'Pipeline',       ArrowRightIcon, 'lead-pipeline'),
    i('crm-customers',      'Customers',      UsersIcon,      'entity', { slug: 'customers' }),
    i('crm-customer-tasks', 'Customer Tasks', CheckIcon,      'customer-tasks'),
    i('crm-campaigns',      'Campaigns',      MailIcon,       'entity', { slug: 'campaigns' }),
  ]),

  s('billing_revenue', 'Billing & Revenue', ReceiptIcon, [
    i('br-product-catalog',     'Product Catalog',     PackageIcon,    'products'),
    i('br-tariff-plans',        'Tariff Plans',        BookmarkIcon,   'tariff-plans'),
    i('br-orders-validation',   'Orders & Validation', ArchiveIcon,    'orders'),
    i('br-billing-accounts',    'Billing Accounts',    BuildingIcon,   'accounts'),
    i('br-invoices',            'Invoices',            ReceiptIcon,    'invoices'),
    i('br-payments',            'Payments',            CreditCardIcon, 'payments'),
    i('br-payment-methods',     'Payment Methods',     CreditCardIcon, 'payment-methods'),
    i('br-collections',         'Collections',         InboxIcon,      'collections'),
    i('br-revenue-assurance',   'Revenue Assurance',   ShieldIcon,     'revenue-assurance'),
  ]),

  s('tech_noc', 'Tech & NOC', ServerIcon, [
    i('noc-dashboard',           'NMS',                       ServerIcon,   'noc-dashboard'),
    i('noc-service-qualification','Service Qualification',   CheckIcon,    'coverage-gis'),
    i('noc-installation-board',  'Installation Board',       TruckIcon,    'installation-board'),
    i('noc-support-tickets',     'Support Tickets',          InboxIcon,    'helpdesk'),
    i('noc-support-dispatch',    'Support Dispatch Board',   ActivityIcon, 'dispatch-board'),
    i('noc-provisioning',        'Provisioning',             GearIcon,     'provisioning'),
    i('noc-incidents',           'Incidents & Outages',      ShieldIcon,   'entity', { slug: 'incidents' }),
    i('noc-infra-projects',      'Infrastructure Projects',  LayersIcon,   'coming-soon', { id: 'infrastructure-projects', title: 'Infrastructure Projects', parent: 'Tech & NOC' }),
    i('noc-inventory',           'Network & Stock Inventory',PackageIcon,  'network-inventory'),
    i('noc-topology',            'Network Topology',         ServerIcon,   'network-topology'),
  ]),

  // ─────────────────────────────────────────────────────────────────────────
  // Operations — top-level group introduced 2026-06-04 (nav-backlog item 1).
  // Currently houses the platform-level Warehouse module (distinct from the
  // NOC "Network & Stock Inventory" sub-block above, which is the OLT-side
  // hardware section). Module itself ships later; this is the nav entry only,
  // wired to a coming-soon stub view per the existing pattern.
  // ─────────────────────────────────────────────────────────────────────────
  s('operations', 'Operations', ActivityIcon, [
    i('ops-warehouse', 'Warehouse', PackageIcon, 'coming-soon', { id: 'warehouse', title: 'Warehouse', parent: 'Operations' }),
  ]),

  s('analytics_ai', 'Analytics & AI', ChartIcon, [
    i('aa-dashboards', 'Operational Dashboards', ChartIcon,    'dashboards'),
    i('aa-reports-ai', 'Reports & AI Insights',  SparkleIcon,  'reports'),
  ]),

  s('enterprise', 'Enterprise', BriefcaseIcon, [
    i('ent-finance',          'Back-Office Finance',     ChartIcon,   'entity', { slug: 'expenses' }),
    i('ent-hr',               'Human Resources',         UsersIcon,   'entity', { slug: 'employees' }),
    i('ent-procurement',      'Procurement & Vendors',   PackageIcon, 'entity', { slug: 'purchase-orders' }),
    i('ent-legal-audit',      'Legal & Security Audit',  ShieldIcon,  'entity', { slug: 'contracts' }),
  ], {
    // Organisation — nested menu added 2026-06-04 (nav-backlog item 2). Scope
    // intentionally left as a 3-child scaffold (org chart / departments / legal
    // entity tree); Gev will redirect once he sees it in place. All three are
    // coming-soon stubs; no module work in this pass.
    subsections: [
      s('ent-organisation', 'Organisation', BuildingIcon, [
        i('ent-org-chart',    'Organisation Chart', UsersIcon,  'coming-soon', { id: 'organisation-chart',    title: 'Organisation Chart',    parent: 'Enterprise · Organisation' }),
        i('ent-org-depts',    'Departments',        LayersIcon, 'coming-soon', { id: 'organisation-depts',    title: 'Departments',           parent: 'Enterprise · Organisation' }),
        i('ent-org-legal',    'Legal Entities',     ShieldIcon, 'coming-soon', { id: 'organisation-legal',    title: 'Legal Entities',        parent: 'Enterprise · Organisation' }),
      ]),
    ],
  }),

  // ADMIN PANEL — SuperAdmin (user.can_configure) only. Houses Records (auto-injected
  // dynamic entities) + System + Dev Internals + Studio as sub-sections.
  s('admin_panel', 'Admin Panel', ShieldIcon, [], {
    adminOnly: true,
    subsections: [
      // Records — placeholder. App.tsx injects the dynamic extra-entity items into this
      // subsection's `items` at render time.
      s('admin_records', 'Records', RowsIcon, []),

      s('system', 'System', GearIcon, [
        i('sys-users',                'Users',                 UsersIcon,  'entity', { slug: 'users' }),
        i('sys-roles-permissions',    'Roles & Permissions',   ShieldIcon, 'entity', { slug: 'roles' }),
        i('sys-settings',             'Settings',              GearIcon,   'settings'),
        i('sys-integrations',         'Integrations',          LayersIcon, 'webhooks'),
        i('sys-notifications-config', 'Notifications Config',  MailIcon,   'entity', { slug: 'notification-rules' }),
      ]),

      s('studio', 'Studio', SparkleIcon, [
        i('std-experience',     'Experience',     SparkleIcon, 'studio'),
        i('std-data',           'Data',           LayersIcon,  'studio'),
        i('std-logic',          'Logic',          EditIcon,    'studio'),
        i('std-security',       'Security',       ShieldIcon,  'studio'),
        i('std-intelligence',   'Intelligence',   SparkleIcon, 'studio'),
        i('std-quality',        'Quality',        CheckIcon,   'studio'),
        i('std-release',        'Release',        PackageIcon, 'studio'),
        i('std-governance',     'Governance',     ShieldIcon,  'studio'),
        i('std-system-control', 'System Control', GearIcon,    'studio'),
      ]),
    ],
  }),
]
