// GAAex navigation — 8 top-level sections per Gev's spec (2026-05-30).
// items with viewType render the matching view; items without show a module stub.
// Global Header items (search, notifications, quick actions, AI assistant, help, profile) are NOT in left nav.
import type { ComponentType } from 'react'
import {
  HomeIcon, ChartIcon, UsersIcon, ArchiveIcon, InboxIcon, ReceiptIcon,
  ServerIcon, TruckIcon, PackageIcon, DollarIcon, BriefcaseIcon,
  SparkleIcon, MessageIcon, FolderIcon, LayersIcon, ShieldIcon,
  GearIcon, MapIcon, ActivityIcon, BuildingIcon, CalendarIcon,
  ClockIcon, RowsIcon, EditIcon, BookmarkIcon, MailIcon,
  CreditCardIcon, LockIcon, PhoneIcon, ArrowRightIcon, CheckIcon,
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
  items: NavItemDef[]
  adminOnly?: boolean
  defaultOpen?: boolean
}

const i = (id: string, label: string, icon: NavItemDef['icon'], viewType?: string, viewArgs?: NavItemDef['viewArgs']): NavItemDef =>
  ({ id, label, icon, ...(viewType ? { viewType, ...(viewArgs ? { viewArgs } : {}) } : {}) })

const s = (id: string, label: string, icon: NavSectionDef['icon'], items: NavItemDef[], opts?: Partial<NavSectionDef>): NavSectionDef =>
  ({ id, label, icon, items, ...opts })

export const NAV_SECTIONS: NavSectionDef[] = [

  // 1. Workspace — personal work center
  s('workspace', 'Workspace', HomeIcon, [
    i('ws-home',        'Home',             HomeIcon,       'dashboards'),
    i('ws-my-tasks',    'My Tasks',         CheckIcon,      'workitems'),
    i('ws-approvals',   'My Approvals',     CheckIcon),
    i('ws-requests',    'My Requests',      InboxIcon,      'entity', { slug: 'requests' }),
    i('ws-calendar',    'Calendar',         CalendarIcon,   'calendar'),
    i('ws-activity',    'Activity Feed',    ActivityIcon,   'activity'),
    i('ws-saved',       'Saved Views',      BookmarkIcon),
    i('ws-recent',      'Recent Items',     ClockIcon),
    i('ws-team',        'Team Workspace',   UsersIcon),
  ], { defaultOpen: true }),

  // 2. CRM & Commercial — sales and customer acquisition
  s('crm', 'CRM & Commercial', UsersIcon, [
    i('crm-leads',       'Leads',           ArrowRightIcon, 'lead-pipeline'),
    i('crm-opps',        'Opportunities',   ArrowRightIcon),
    i('crm-customers',   'Customers',       UsersIcon,      'entity', { slug: 'customers' }),
    i('crm-accounts',    'Accounts',        BuildingIcon,   'accounts'),
    i('crm-contacts',    'Contacts',        UsersIcon,      'entity', { slug: 'contacts' }),
    i('crm-quotes',      'Quotes',          EditIcon),
    i('crm-contracts',   'Contracts',       FolderIcon),
    i('crm-catalog',     'Product Catalog', ArchiveIcon,    'products'),
    i('crm-campaigns',   'Campaigns',       MailIcon),
    i('crm-partners',    'Partners',        BuildingIcon),
    i('crm-cust360',     'Customer 360',    UsersIcon),
  ]),

  // 3. Orders & Revenue — qualification to cash collection
  s('revenue', 'Orders & Revenue', ArchiveIcon, [
    i('rev-qual',        'Qualification',     CheckIcon),
    i('rev-cpq',         'Cart & CPQ',        EditIcon),
    i('rev-orders',      'Orders',            ArchiveIcon),
    i('rev-fulfillment', 'Fulfillment',       TruckIcon),
    i('rev-activations', 'Activations',       ArrowRightIcon),
    i('rev-subs',        'Subscriptions',     ArchiveIcon,    'subscriptions'),
    i('rev-billing-acc', 'Billing Accounts',  BuildingIcon),
    i('rev-invoices',    'Invoices',          ReceiptIcon,    'invoices'),
    i('rev-payments',    'Payments',          CreditCardIcon, 'payments'),
    i('rev-collections', 'Collections',       ArchiveIcon),
    i('rev-credits',     'Credit Notes',      ReceiptIcon),
    i('rev-assurance',   'Revenue Assurance', ShieldIcon),
    i('rev-tax',         'Tax Management',    ShieldIcon),
  ]),

  // 4. Customer Care — support and service operations
  s('care', 'Customer Care', InboxIcon, [
    i('care-console',     'Agent Console',          PhoneIcon),
    i('care-interactions','Interactions',           ClockIcon,    'entity', { slug: 'interactions' }),
    i('care-tickets',     'Tickets',                ArchiveIcon,  'entity', { slug: 'tickets' }),
    i('care-tech',        'Technical Support',      ServerIcon),
    i('care-complaints',  'Complaints',             EditIcon),
    i('care-escalations', 'Escalations',            ArrowRightIcon),
    i('care-sla',         'SLA Management',         ClockIcon),
    i('care-retention',   'Retention',              UsersIcon),
    i('care-kb',          'Knowledge Base',         BookmarkIcon),
    i('care-comms',       'Service Communications', MessageIcon,  'messages'),
  ]),

  // 5. Network & Operations — network, provisioning, field
  s('netops', 'Network & Operations', ServerIcon, [
    i('net-noc',         'NOC Dashboard',          ActivityIcon),
    i('net-topology',    'Network Topology',       MapIcon),
    i('net-sites',       'Sites',                  ServerIcon),
    i('net-devices',     'Devices',                ServerIcon),
    i('net-provisioning','Provisioning',           ArrowRightIcon),
    i('net-svc-inv',     'Service Inventory',      ServerIcon,    'services'),
    i('net-res-inv',     'Resource Inventory',     PackageIcon,   'resource-pools'),
    i('net-ipam',        'IP Management',          LayersIcon),
    i('net-incidents',   'Incidents & Outages',    InboxIcon),
    i('net-field',       'Field Work',             TruckIcon),
    i('net-workorders',  'Work Orders',            RowsIcon),
    i('net-capacity',    'Capacity Planning',      ChartIcon),
    i('net-maintenance', 'Maintenance',            GearIcon),
  ]),

  // 6. Analytics & AI — reporting, intelligence, automation
  s('analytics', 'Analytics & AI', ChartIcon, [
    i('ana-exec',        'Executive Dashboard',  ChartIcon,    'dashboards'),
    i('ana-kpi',         'KPI Center',           ChartIcon),
    i('ana-reports',     'Reports',              BookmarkIcon, 'reports'),
    i('ana-builder',     'Report Builder',       EditIcon,     'report-builder'),
    i('ana-forecast',    'Forecasting',          ChartIcon),
    i('ana-copilot',     'AI Copilot',           SparkleIcon,  'ask'),
    i('ana-insights',    'AI Insights',          SparkleIcon),
    i('ana-agents',      'AI Agents',            SparkleIcon),
    i('ana-automations', 'AI Automations',       SparkleIcon),
    i('ana-governance',  'AI Governance',        ShieldIcon),
    i('ana-export',      'Export Center',        FolderIcon),
  ]),

  // 7. Enterprise — internal company operations
  s('enterprise', 'Enterprise', BriefcaseIcon, [
    i('ent-finance',     'Finance',              DollarIcon),
    i('ent-accounting',  'Accounting',           ReceiptIcon),
    i('ent-procurement', 'Procurement',          ArchiveIcon),
    i('ent-projects',    'Projects',             LayersIcon),
    i('ent-hr',          'HR',                   BriefcaseIcon),
    i('ent-payroll',     'Payroll',              DollarIcon),
    i('ent-training',    'Training',             BookmarkIcon),
    i('ent-assets',      'Assets',               PackageIcon),
    i('ent-legal',       'Legal',                ShieldIcon),
    i('ent-compliance',  'Compliance',           ShieldIcon),
    i('ent-docs',        'Document Management',  FolderIcon),
    i('ent-esign',       'E-Signatures',         EditIcon),
  ]),

  // 8. System — platform management and configuration (admin-only)
  s('system', 'System', GearIcon, [
    i('sys-org',         'Organization',         BuildingIcon,   'org'),
    i('sys-users',       'Users',                UsersIcon,      'entity', { slug: 'users' }),
    i('sys-roles',       'Roles & Permissions',  LockIcon),
    i('sys-teams',       'Teams',                UsersIcon),
    i('sys-workflows',   'Workflows',            ArrowRightIcon),
    i('sys-integrations','Integrations',         LayersIcon),
    i('sys-webhooks',    'API & Webhooks',       ArrowRightIcon, 'webhooks'),
    i('sys-notif',       'Notifications',        InboxIcon),
    i('sys-monitoring',  'Monitoring',           ActivityIcon),
    i('sys-audit',       'Audit Logs',           ClockIcon),
    i('sys-security',    'Security',             ShieldIcon),
    i('sys-flags',       'Feature Flags',        SparkleIcon),
    i('sys-data',        'Data Management',      FolderIcon),
    i('sys-backup',      'Backup & Recovery',    ArchiveIcon),
    i('sys-settings',    'System Settings',      GearIcon,       'settings'),
  ], { adminOnly: true }),
]

// Stub items promoted to real config-driven entities (seeded by backend app/seed_catalog.py).
// Mutates NAV_SECTIONS once at module load so these items route to their entity page, not a stub.
const ENTITY_SLUGS: Record<string, string> = {
  // CRM & Commercial
  'crm-opps': 'opportunities', 'crm-quotes': 'quotes', 'crm-contracts': 'contracts',
  'crm-campaigns': 'campaigns', 'crm-partners': 'partnerships',
  // Orders & Revenue
  'rev-orders': 'orders', 'rev-credits': 'credit-notes', 'rev-tax': 'tax-rules',
  // Customer Care
  'care-complaints': 'complaints', 'care-escalations': 'escalations',
  'care-sla': 'sla-policies', 'care-kb': 'kb-articles',
  // Network & Operations
  'net-sites': 'sites', 'net-devices': 'devices', 'net-incidents': 'incidents',
  'net-workorders': 'work-orders', 'net-maintenance': 'maintenance-jobs',
  // Enterprise
  'ent-projects': 'projects', 'ent-payroll': 'payroll-runs',
  'ent-training': 'training-courses', 'ent-assets': 'assets',
  'ent-compliance': 'compliance-rules', 'ent-docs': 'documents',
  // System
  'sys-integrations': 'integrations',
}

for (const sec of NAV_SECTIONS) {
  for (const it of sec.items) {
    if (!it.viewType && ENTITY_SLUGS[it.id]) {
      it.viewType = 'entity'
      it.viewArgs = { slug: ENTITY_SLUGS[it.id] }
    }
  }
}
