import type { ComponentType } from 'react'
import {
  HomeIcon, ChartIcon, UsersIcon, InboxIcon, ReceiptIcon,
  ServerIcon, TruckIcon, PackageIcon, BriefcaseIcon,
  SparkleIcon, MessageIcon, LayersIcon, ShieldIcon,
  GearIcon, ActivityIcon, BuildingIcon,
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

  // HOME — LOCKED 2026-06-13 (Gev). Left nav holds only Workspace + Ask Me.
  //   • Mail · Messenger · Calendar live in the GLOBAL TOP BAR (not the left nav).
  //   • My Requests · My Documents · My Benefits · Knowledge Base are MERGED into the
  //     Workspace page as the "Me" section (all four were the same `profile` view).
  s('home', 'Home', HomeIcon, [
    i('home-workspace',  'Workspace',      HomeIcon,      'home'),
    i('home-ask',        'Ask Me',         SparkleIcon,   'ask'),
  ], { defaultOpen: true }),


  // CRM — LOCKED 2026-06-13 (Gev). Order is the source of truth: Pipeline · Leads ·
  // Orders · Customers. Do not reorder, rename, add, or remove items.
  s('crm', 'CRM', UsersIcon, [
    i('crm-pipeline',       'Pipeline',       ArrowRightIcon, 'lead-pipeline'),
    i('crm-leads',          'Leads',          InboxIcon,      'entity', { slug: 'leads' }),
    i('crm-orders',         'Orders',         ReceiptIcon,    'entity', { slug: 'orders' }),
    i('crm-customers',      'Customers',      UsersIcon,      'entity', { slug: 'customers' }),
  ]),

  s('billing_revenue', 'Billing & Revenue', ReceiptIcon, [
    i('br-tariff-plans',        'Tariff Plans',        BookmarkIcon,   'tariff-plans'),
    i('br-invoices',            'Invoices',            ReceiptIcon,    'invoices'),
    i('br-payments',            'Payments',            CreditCardIcon, 'payments'),
    i('br-collections',         'Collections',         InboxIcon,      'collections'),
  ]),

  s('tech_noc', 'Tech & NOC', ServerIcon, [
    i('noc-dashboard',           'NMS',                       ServerIcon,   'noc-dashboard'),
    i('noc-installation-board',  'Installation Board',       TruckIcon,    'installation-board'),
    i('noc-support-tickets',     'Support Tickets',          InboxIcon,    'helpdesk'),
    i('noc-support-dispatch',    'Dispatch Board',           ActivityIcon, 'dispatch-board'),
    i('noc-inventory',           'Network & Stock Inventory',PackageIcon,  'network-inventory'),
  ]),

  // ─────────────────────────────────────────────────────────────────────────
  // Operations — top-level group. Houses the Organisation page (/org → OrgPage:
  // editable department chart + Branches + Departments tabs) and the platform-level
  // Warehouse module (built later). (Old 13-layout OrgView removed 2026-06-13.)
  // ─────────────────────────────────────────────────────────────────────────
  s('operations', 'Operations', ActivityIcon, [
    // ONE Organisation page (/org → OrgPage): Hierarchy (role/position) · Branches (geo) ·
    // Departments are tabs INSIDE it, not separate nav entries (Gev 2026-06-12).
    i('ops-organisation', 'Organisation', BuildingIcon, 'org'),
    i('ops-warehouse',    'Warehouse',    PackageIcon,  'coming-soon', { id: 'warehouse', title: 'Warehouse', parent: 'Operations' }),
  ], { defaultOpen: true }),

  // PROJECTS — the ONLY addition to the locked left nav (Gev 2026-06-13). Standalone
  // top-level link. Projects = project-type WorkItems (campaigns, infra builds, initiatives).
  // Tasks (My Tasks · Work Items) live INSIDE Workspace, NOT here. Placeholder until built.
  s('projects', 'Projects', LayersIcon, [], { standalone: true, viewType: 'projects' }),

  s('analytics_ai', 'Analytics & AI', ChartIcon, [
    i('aa-dashboards',        'Operational Dashboards', ChartIcon,   'dashboards'),
    i('aa-reports-ai',        'Reports & AI Insights',  SparkleIcon, 'reports'),
  ]),

  s('enterprise', 'Enterprise', BriefcaseIcon, [
    i('ent-finance',          'Back-Office Finance',     ChartIcon,   'entity', { slug: 'expenses' }),
    i('ent-hr',               'Human Resources',         UsersIcon,   'entity', { slug: 'employees' }),
    i('ent-procurement',      'Procurement & Vendors',   PackageIcon, 'entity', { slug: 'purchase-orders' }),
    i('ent-legal',            'Legal & Contracts',       ShieldIcon,  'entity', { slug: 'contracts' }),
  ]),
  // (Organisation sub-menu moved to Operations 2026-06-12 — see the Operations group above.)

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
        // Communication config (Gev IA directive 2026-06-10) — Mail accounts + messaging Channels
        // (SMS/Telegram/WhatsApp credentials) are configured HERE in Studio, not in the user nav.
        i('std-mail-config',     'Mail Accounts',   MailIcon,       'mail'),
        i('std-channels',        'Channels',        MessageIcon,    'channels'),
        i('std-payment-methods', 'Payment Methods', CreditCardIcon, 'payment-methods'),
        i('std-payment-gateway', 'Payment Gateway', CreditCardIcon, 'gateway'),
        i('std-revenue-assurance','Revenue Assurance', ShieldIcon, 'revenue-assurance'),
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
