// GAAex full enterprise navigation — 18 top-level sections.
// items with viewType are built; items without show a module stub.
import type { ComponentType } from 'react'
import {
  HomeIcon, ChartIcon, UsersIcon, ArchiveIcon, InboxIcon, ReceiptIcon,
  ServerIcon, TruckIcon, PackageIcon, DollarIcon, BriefcaseIcon,
  SparkleIcon, MessageIcon, FolderIcon, LayersIcon, ShieldIcon,
  GearIcon, MapIcon, ActivityIcon, BuildingIcon, CalendarIcon,
  ClockIcon, RowsIcon, EditIcon, BookmarkIcon, MailIcon,
  CreditCardIcon, LockIcon, PhoneIcon, ArrowRightIcon,
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

  s('home', 'Home', HomeIcon, [
    i('home-dashboard',    'Dashboard',       ChartIcon,    'dashboards'),
    i('home-calendar',     'Calendar',        CalendarIcon, 'calendar'),
    i('home-tasks',        'My Tasks',        RowsIcon,     'workitems'),
    i('home-requests',     'My Requests',     InboxIcon,    'entity', { slug: 'requests' }),
    i('home-approvals',    'My Approvals',    ArchiveIcon),
    i('home-activity',     'Recent Activity', ClockIcon,    'activity'),
    i('home-kpi',          'KPI Snapshot',    ChartIcon),
    i('home-feed',         'Team Feed',       MessageIcon),
    i('home-notifications','Notifications',   InboxIcon),
    i('home-quick',        'Quick Actions',   ArrowRightIcon),
    i('home-saved',        'Saved Searches',  BookmarkIcon),
  ], { defaultOpen: true }),

  s('crm', 'CRM', UsersIcon, [
    i('crm-dashboard',     'Dashboard',          ChartIcon),
    i('crm-leads',         'Leads',              ArrowRightIcon, 'lead-pipeline'),
    i('crm-opportunities', 'Opportunities',      ArrowRightIcon),
    i('crm-pipeline',      'Pipeline',           RowsIcon),
    i('crm-customers',     'Customers',          UsersIcon,    'entity', { slug: 'customers' }),
    i('crm-accounts',      'Accounts',           BuildingIcon, 'accounts'),
    i('crm-contacts',      'Contacts',           UsersIcon,    'entity', { slug: 'contacts' }),
    i('crm-parties',       'Parties',            UsersIcon,    'parties'),
    i('crm-activities',    'Activities',         ClockIcon,    'entity', { slug: 'interactions' }),
    i('crm-quotes',        'Quotes',             EditIcon),
    i('crm-contracts',     'Contracts',          FolderIcon),
    i('crm-residential',   'Residential Sales',  UsersIcon),
    i('crm-enterprise',    'Enterprise Sales',   BuildingIcon),
    i('crm-wholesale',     'Wholesale',          PackageIcon),
    i('crm-d2d',           'D2D Sales',          TruckIcon),
    i('crm-catalog',       'Product Catalog',    ArchiveIcon,  'products'),
    i('crm-campaigns',     'Campaigns',          MailIcon),
    i('crm-promotions',    'Promotions',         SparkleIcon),
    i('crm-segments',      'Segments',           LayersIcon),
    i('crm-loyalty',       'Loyalty',            ArrowRightIcon),
    i('crm-retention',     'Retention',          ArrowRightIcon),
    i('crm-churn',         'Churn Management',   ChartIcon),
    i('crm-partnerships',  'Partnerships',       BuildingIcon),
    i('crm-analytics',     'Sales Analytics',    ChartIcon),
  ], { defaultOpen: true }),

  s('orders', 'Orders', ArchiveIcon, [
    i('ord-dashboard',   'Dashboard',              ChartIcon),
    i('ord-new',         'New Order',              ArrowRightIcon),
    i('ord-queue',       'Order Queue',            RowsIcon),
    i('ord-cpq',         'CPQ',                    EditIcon),
    i('ord-fulfillment', 'Fulfillment Queue',      RowsIcon),
    i('ord-install',     'Installation Queue',     TruckIcon),
    i('ord-activations', 'Activations',            ArrowRightIcon),
    i('ord-change',      'Change Orders',          EditIcon),
    i('ord-upgrades',    'Upgrades & Downgrades',  ArchiveIcon),
    i('ord-suspend',     'Suspend / Resume',       ArchiveIcon),
    i('ord-disconnect',  'Disconnect Orders',      ArchiveIcon),
    i('ord-failed',      'Failed Orders',          InboxIcon),
    i('ord-jeopardy',    'Jeopardy Management',    InboxIcon),
    i('ord-analytics',   'Order Analytics',        ChartIcon),
  ]),

  s('support', 'Support', InboxIcon, [
    i('sup-dashboard',   'Dashboard',              ChartIcon),
    i('sup-helpdesk',    'Helpdesk',               InboxIcon,    'helpdesk'),
    i('sup-workitems',   'Work Items',             RowsIcon,     'workitems'),
    i('sup-console',     'Agent Console',          PhoneIcon),
    i('sup-omni',        'Omnichannel Inbox',      MessageIcon),
    i('sup-tickets',     'Tickets',                ArchiveIcon,  'entity', { slug: 'tickets' }),
    i('sup-technical',   'Technical Support',      ServerIcon),
    i('sup-complaints',  'Complaint Resolution',   EditIcon),
    i('sup-sla',         'SLA Management',         ClockIcon),
    i('sup-escalations', 'Escalations',            ArrowRightIcon),
    i('sup-callcenter',  'Call Center',            PhoneIcon),
    i('sup-livechat',    'Live Chat',              MessageIcon),
    i('sup-kb',          'Knowledge Base',         BookmarkIcon),
    i('sup-retention',   'Retention Desk',         UsersIcon),
    i('sup-analytics',   'Support Analytics',      ChartIcon),
  ], { defaultOpen: true }),

  s('billing', 'Billing', ReceiptIcon, [
    i('bil-dashboard',    'Dashboard',             ChartIcon),
    i('bil-subscriptions','Subscriptions',         ArchiveIcon,    'subscriptions'),
    i('bil-services',     'Services',              ServerIcon,     'services'),
    i('bil-plans',        'Tariff Plans',          ArchiveIcon,    'products'),
    i('bil-usage',        'Usage Rating',          ChartIcon,      'usage'),
    i('bil-invoices',     'Invoices',              ReceiptIcon,    'invoices'),
    i('bil-payments',     'Payments',              CreditCardIcon, 'payments'),
    i('bil-gateway',      'Pay Gateway',           CreditCardIcon, 'gateway'),
    i('bil-discounts',    'Discounts',             DollarIcon),
    i('bil-collections',  'Collections',           ArchiveIcon),
    i('bil-dunning',      'Dunning',               MailIcon),
    i('bil-credits',      'Credit Notes',          ReceiptIcon),
    i('bil-tax',          'Tax Rules',             ShieldIcon),
    i('bil-reconcile',    'Reconciliation',        ChartIcon),
    i('bil-prepaid',      'Prepaid',               CreditCardIcon),
    i('bil-postpaid',     'Postpaid',              CreditCardIcon),
    i('bil-ar',           'AR Aging',              ClockIcon),
    i('bil-mrr',          'MRR / ARR',             ChartIcon),
    i('bil-reports',      'Billing Reports',       BookmarkIcon),
  ], { defaultOpen: true }),

  s('network', 'Network', ServerIcon, [
    i('net-dashboard',   'Dashboard',              ChartIcon),
    i('net-topology',    'Topology Map',           MapIcon),
    i('net-coverage',    'Coverage Map',           MapIcon),
    i('net-gis',         'GIS',                    MapIcon),
    i('net-sites',       'Sites / POPs',           ServerIcon),
    i('net-olts',        'OLTs',                   ServerIcon),
    i('net-routers',     'Routers',                ServerIcon),
    i('net-switches',    'Switches',               ServerIcon),
    i('net-bts',         'BTS / Towers',           ServerIcon),
    i('net-devices',     'Devices',                ServerIcon),
    i('net-ippools',     'IP Pools',               ServerIcon,   'resource-pools'),
    i('net-vlans',       'VLANs',                  LayersIcon),
    i('net-provisioning','Provisioning',           ArrowRightIcon),
    i('net-monitoring',  'Monitoring',             ActivityIcon),
    i('net-alarms',      'Alarms',                 InboxIcon),
    i('net-incidents',   'Incidents',              InboxIcon),
    i('net-outages',     'Outages',                InboxIcon),
    i('net-noc',         'NOC Console',            ActivityIcon),
    i('net-capacity',    'Capacity Planning',      ChartIcon),
    i('net-maintenance', 'Maintenance',            GearIcon),
    i('net-analytics',   'Network Analytics',      ChartIcon),
  ]),

  s('field', 'Field Operations', TruckIcon, [
    i('fld-dashboard',   'Dashboard',              ChartIcon),
    i('fld-installs',    'Install Board',          TruckIcon),
    i('fld-dispatch',    'Technician Dispatch',    UsersIcon),
    i('fld-scheduling',  'Scheduling',             CalendarIcon),
    i('fld-routes',      'Routes',                 MapIcon),
    i('fld-workorders',  'Work Orders',            RowsIcon),
    i('fld-jobs',        'Maintenance Jobs',       GearIcon),
    i('fld-mobile',      'Mobile Workforce',       UsersIcon),
    i('fld-gps',         'GPS Tracking',           MapIcon),
    i('fld-photos',      'Photo Capture',          EditIcon),
    i('fld-inventory',   'Field Inventory',        PackageIcon),
    i('fld-analytics',   'Field Analytics',        ChartIcon),
  ]),

  s('inventory', 'Inventory', PackageIcon, [
    i('inv-dashboard',   'Dashboard',              ChartIcon),
    i('inv-warehouse',   'Warehouse',              PackageIcon),
    i('inv-stock',       'Stock',                  PackageIcon),
    i('inv-movements',   'Movements',              ArrowRightIcon),
    i('inv-procurement', 'Procurement',            ArchiveIcon),
    i('inv-suppliers',   'Suppliers',              BuildingIcon),
    i('inv-po',          'Purchase Orders',        EditIcon),
    i('inv-receipts',    'Goods Receipts',         ArchiveIcon),
    i('inv-assets',      'Assets',                 PackageIcon),
    i('inv-lifecycle',   'Asset Lifecycle',        ClockIcon),
    i('inv-vehicles',    'Fleet / Vehicles',       TruckIcon),
    i('inv-analytics',   'Inventory Analytics',    ChartIcon),
  ]),

  s('finance', 'Finance', DollarIcon, [
    i('fin-dashboard',   'Dashboard',              ChartIcon),
    i('fin-revenue',     'Revenue',                DollarIcon),
    i('fin-expenses',    'Expenses',               DollarIcon),
    i('fin-budgeting',   'Budgeting',              ReceiptIcon),
    i('fin-forecasting', 'Forecasting',            ChartIcon),
    i('fin-procurement', 'Procurement',            ArchiveIcon),
    i('fin-vendors',     'Vendor Payments',        BuildingIcon),
    i('fin-export',      'Accounting Export',      FolderIcon),
    i('fin-tax',         'Tax Management',         ShieldIcon),
    i('fin-reconcile',   'Reconciliation',         ChartIcon),
    i('fin-statements',  'Financial Statements',   BookmarkIcon),
    i('fin-audit',       'Audit Support',          ShieldIcon),
    i('fin-analytics',   'Finance Analytics',      ChartIcon),
  ]),

  s('hr', 'HR', BriefcaseIcon, [
    i('hr-dashboard',    'Dashboard',              ChartIcon),
    i('hr-employees',    'Employees',              UsersIcon),
    i('hr-orgchart',     'Org Chart',              BuildingIcon),
    i('hr-departments',  'Departments',            BuildingIcon),
    i('hr-attendance',   'Attendance',             ClockIcon),
    i('hr-leave',        'Leave Management',       CalendarIcon),
    i('hr-payroll',      'Payroll',                DollarIcon),
    i('hr-recruitment',  'Recruitment',            UsersIcon),
    i('hr-onboarding',   'Onboarding',             ArrowRightIcon),
    i('hr-performance',  'Performance Reviews',    ChartIcon),
    i('hr-training',     'Training',               BookmarkIcon),
    i('hr-time',         'Time Tracking',          ClockIcon),
    i('hr-analytics',    'HR Analytics',           ChartIcon),
  ]),

  s('analytics', 'Analytics', ChartIcon, [
    i('ana-exec',        'Executive Dashboard',    ChartIcon,    'dashboards'),
    i('ana-kpi',         'KPI Center',             ChartIcon),
    i('ana-builder',     'Report Builder',         EditIcon,     'report-builder'),
    i('ana-reports',     'Reports',                BookmarkIcon, 'reports'),
    i('ana-revenue',     'Revenue Analytics',      ChartIcon,    'analytics'),
    i('ana-customer',    'Customer Analytics',     UsersIcon),
    i('ana-network',     'Network Analytics',      ServerIcon),
    i('ana-sla',         'SLA Analytics',          ClockIcon),
    i('ana-churn',       'Churn Analytics',        ChartIcon),
    i('ana-workforce',   'Workforce Analytics',    UsersIcon),
    i('ana-forecast',    'Forecasting',            ChartIcon),
    i('ana-export',      'Export Center',          FolderIcon),
  ], { defaultOpen: true }),

  s('ai', 'AI', SparkleIcon, [
    i('ai-copilot',      'AI Copilot',                 SparkleIcon,  'ask'),
    i('ai-dispatcher',   'AI Dispatcher',              SparkleIcon),
    i('ai-routing',      'Smart Routing',              ArrowRightIcon),
    i('ai-search',       'AI Search',                  SparkleIcon),
    i('ai-insights',     'AI Insights',                ChartIcon),
    i('ai-suggest',      'AI Suggestions',             SparkleIcon),
    i('ai-churn',        'Churn Prediction',           ChartIcon),
    i('ai-fraud',        'Fraud Detection',            ShieldIcon),
    i('ai-anomaly',      'Network Anomaly Detection',  ServerIcon),
    i('ai-predictive',   'Predictive Maintenance',     GearIcon),
    i('ai-chatbot',      'AI Chatbot',                 MessageIcon),
    i('ai-voicebot',     'Voicebot',                   PhoneIcon),
    i('ai-assist',       'Agent Assist',               UsersIcon),
    i('ai-config',       'AI Configuration',           GearIcon),
  ], { defaultOpen: true }),

  s('comms', 'Communications', MessageIcon, [
    i('com-messages',    'Messages',               MessageIcon,  'messages'),
    i('com-outbound',    'Outbound',               MailIcon,     'outbound'),
    i('com-center',      'Notification Center',    InboxIcon),
    i('com-email-tpl',   'Email Templates',        MailIcon),
    i('com-sms-tpl',     'SMS Templates',          MessageIcon),
    i('com-whatsapp',    'WhatsApp',               MessageIcon),
    i('com-telegram',    'Telegram',               MessageIcon),
    i('com-broadcast',   'Broadcast Campaigns',    MailIcon),
    i('com-outage',      'Outage Notifications',   InboxIcon),
    i('com-dunning',     'Dunning Messages',       ReceiptIcon),
    i('com-prefs',       'Communication Preferences', GearIcon),
    i('com-logs',        'Message Logs',           BookmarkIcon),
  ], { defaultOpen: true }),

  s('docs', 'Documents', FolderIcon, [
    i('doc-dashboard',   'Dashboard',              ChartIcon),
    i('doc-contracts',   'Contracts',              FolderIcon),
    i('doc-quotes',      'Quotes',                 EditIcon),
    i('doc-invoices',    'Invoices',               ReceiptIcon,  'invoices'),
    i('doc-workorders',  'Work Orders',            RowsIcon),
    i('doc-reports',     'Reports',                BookmarkIcon, 'reports'),
    i('doc-templates',   'Templates',              EditIcon),
    i('doc-esign',       'E-Signatures',           EditIcon),
    i('doc-storage',     'File Storage',           FolderIcon),
    i('doc-archive',     'Archive',                ArchiveIcon),
    i('doc-search',      'Full-Text Search',       SparkleIcon),
  ]),

  s('projects', 'Projects', LayersIcon, [
    i('prj-dashboard',   'Dashboard',              ChartIcon),
    i('prj-projects',    'Projects',               LayersIcon),
    i('prj-tasks',       'Tasks',                  RowsIcon,    'workitems'),
    i('prj-milestones',  'Milestones',             ArrowRightIcon),
    i('prj-resources',   'Resources',              UsersIcon),
    i('prj-risks',       'Risks',                  InboxIcon),
    i('prj-budgets',     'Budgets',                DollarIcon),
    i('prj-pmo',         'PMO',                    BuildingIcon),
    i('prj-innovation',  'Innovation',             SparkleIcon),
    i('prj-analytics',   'Project Analytics',      ChartIcon),
  ]),

  s('legal', 'Legal & Compliance', ShieldIcon, [
    i('leg-contracts',   'Contracts',              FolderIcon),
    i('leg-cases',       'Legal Cases',            ArchiveIcon),
    i('leg-policies',    'Policies',               BookmarkIcon),
    i('leg-regulatory',  'Regulatory Reporting',   ChartIcon),
    i('leg-gdpr',        'GDPR / Privacy',         ShieldIcon),
    i('leg-consent',     'Consent Records',        ShieldIcon),
    i('leg-holds',       'Legal Holds',            LockIcon),
    i('leg-compliance',  'Compliance Rules',       ShieldIcon),
    i('leg-audit',       'Audit Trails',           ClockIcon),
    i('leg-risk',        'Risk Registers',         InboxIcon),
    i('leg-governance',  'Governance',             BuildingIcon),
    i('leg-analytics',   'Compliance Analytics',   ChartIcon),
  ]),

  s('admin', 'Administration', GearIcon, [
    i('adm-settings',    'Tenant Settings',        GearIcon,       'settings'),
    i('adm-users',       'Users',                  UsersIcon,      'entity', { slug: 'users' }),
    i('adm-roles',       'Roles',                  LockIcon),
    i('adm-permissions', 'Permissions',            ShieldIcon),
    i('adm-org',         'Org Structure',          BuildingIcon,   'org'),
    i('adm-sla',         'SLA Policies',           ClockIcon),
    i('adm-routing',     'Routing Rules',          ArrowRightIcon),
    i('adm-notif-rules', 'Notification Rules',     MailIcon),
    i('adm-dash-builder','Dashboard Builder',      ChartIcon),
    i('adm-integrations','Integrations',           LayersIcon),
    i('adm-webhooks',    'Webhooks',               ArrowRightIcon, 'webhooks'),
    i('adm-outbound',    'Outbound',               MailIcon,       'outbound'),
    i('adm-pools',       'Resource Pools',         ServerIcon,     'resource-pools'),
    i('adm-ai-settings', 'AI Settings',            SparkleIcon),
    i('adm-audit',       'Audit Logs',             ClockIcon),
    i('adm-import',      'Import / Export',        FolderIcon),
  ], { adminOnly: true }),

  s('platform', 'Platform Ops', ActivityIcon, [
    i('plt-eventbus',    'Event Bus',              ArrowRightIcon),
    i('plt-queues',      'Queue Monitoring',       RowsIcon),
    i('plt-logs',        'Runtime Logs',           EditIcon),
    i('plt-metrics',     'Metrics',                ChartIcon),
    i('plt-traces',      'Traces',                 ActivityIcon),
    i('plt-adapters',    'Adapter Health',         ServerIcon),
    i('plt-deploy',      'Deployment',             ArrowRightIcon),
    i('plt-regions',     'Regions',                MapIcon),
    i('plt-secrets',     'Secrets Vault',          LockIcon),
    i('plt-api',         'API Explorer',           EditIcon),
    i('plt-rollouts',    'Feature Rollouts',       SparkleIcon),
    i('plt-health',      'System Health',          ActivityIcon),
  ], { adminOnly: true }),
]

// Stub items promoted to real config-driven entities (seeded by backend app/seed_catalog.py).
// Mutates NAV_SECTIONS once at module load so these items route to their entity page, not a stub.
const ENTITY_SLUGS: Record<string, string> = {
  // CRM
  'crm-opportunities': 'opportunities', 'crm-quotes': 'quotes', 'crm-contracts': 'contracts',
  'crm-campaigns': 'campaigns', 'crm-promotions': 'promotions', 'crm-segments': 'segments',
  'crm-partnerships': 'partnerships', 'crm-loyalty': 'loyalty-members',
  // Orders
  'ord-queue': 'orders', 'ord-change': 'change-orders',
  // Support
  'sup-complaints': 'complaints', 'sup-escalations': 'escalations', 'sup-kb': 'kb-articles',
  // Billing
  'bil-discounts': 'discounts', 'bil-credits': 'credit-notes', 'bil-tax': 'tax-rules',
  // Network
  'net-sites': 'sites', 'net-olts': 'olts', 'net-routers': 'routers', 'net-switches': 'switches',
  'net-bts': 'towers', 'net-devices': 'devices', 'net-vlans': 'vlans', 'net-alarms': 'alarms',
  'net-incidents': 'incidents', 'net-outages': 'outages',
  // Field Operations
  'fld-workorders': 'work-orders', 'fld-jobs': 'maintenance-jobs',
  // Inventory
  'inv-warehouse': 'warehouses', 'inv-stock': 'stock-items', 'inv-movements': 'stock-movements',
  'inv-suppliers': 'suppliers', 'inv-po': 'purchase-orders', 'inv-receipts': 'goods-receipts',
  'inv-assets': 'assets', 'inv-vehicles': 'vehicles',
  // Finance
  'fin-expenses': 'expenses', 'fin-budgeting': 'budgets', 'fin-vendors': 'vendor-payments',
  // HR
  'hr-employees': 'employees', 'hr-departments': 'departments', 'hr-leave': 'leave-requests',
  'hr-payroll': 'payroll-runs', 'hr-recruitment': 'candidates', 'hr-performance': 'performance-reviews',
  'hr-training': 'training-courses',
  // Communications
  'com-email-tpl': 'email-templates', 'com-sms-tpl': 'sms-templates', 'com-broadcast': 'broadcast-campaigns',
  // Documents
  'doc-templates': 'document-templates', 'doc-storage': 'documents',
  'doc-contracts': 'contracts', 'doc-quotes': 'quotes', 'doc-workorders': 'work-orders',
  // Projects
  'prj-projects': 'projects', 'prj-milestones': 'milestones', 'prj-risks': 'risks', 'prj-budgets': 'budgets',
  // Legal & Compliance
  'leg-cases': 'legal-cases', 'leg-policies': 'policies', 'leg-consent': 'consent-records',
  'leg-holds': 'legal-holds', 'leg-compliance': 'compliance-rules', 'leg-risk': 'risk-registers',
  'leg-contracts': 'contracts',
  // Administration
  'adm-sla': 'sla-policies', 'adm-routing': 'routing-rules', 'adm-notif-rules': 'notification-rules',
  'adm-integrations': 'integrations',
}

for (const sec of NAV_SECTIONS) {
  for (const it of sec.items) {
    if (!it.viewType && ENTITY_SLUGS[it.id]) {
      it.viewType = 'entity'
      it.viewArgs = { slug: ENTITY_SLUGS[it.id] }
    }
  }
}
