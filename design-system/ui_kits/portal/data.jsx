/* GAAhex UI kit — Icon · full 18-module navigation · domain data pools.
   Navigation is faithful to frontend/src/lib/nav-config.ts (18 sections, ~190 items).
   `kind` drives the config-driven renderer: dash · work · list · board · map · cal · settings · home. */

function Icon({ name, size = 16, style, className }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const el = ref.current;
    if (el && window.lucide) { el.innerHTML = `<i data-lucide="${name}"></i>`; window.lucide.createIcons(); }
  }, [name]);
  return <span ref={ref} className={'lic ' + (className || '')} style={{ width: size, height: size, display: 'inline-flex', flexShrink: 0, ...style }} />;
}

// icon shorthands matching the repo's set → Lucide
const IC = { home:'home', chart:'bar-chart-3', users:'users', archive:'archive', inbox:'inbox', receipt:'receipt',
  server:'server', truck:'truck', package:'package', dollar:'dollar-sign', briefcase:'briefcase', sparkle:'sparkles',
  msg:'message-square', folder:'folder', layers:'layers', shield:'shield', gear:'settings', map:'map', activity:'activity',
  building:'building-2', cal:'calendar', clock:'clock', rows:'rows-3', edit:'square-pen', book:'bookmark', mail:'mail',
  card:'credit-card', lock:'lock', phone:'phone', arrow:'arrow-right', router:'router', net:'network', wifi:'wifi', flag:'flag' };

// item: [id, label, icon, kind?]  (kind default 'list')
const SEC = (id, label, icon, items, open) => ({ id, label, icon, open: !!open,
  items: items.map(([iid, ilabel, iicon, kind]) => ({ id: iid, label: ilabel, icon: iicon, kind: kind || 'list' })) });

const NAV = [
  SEC('home','Home',IC.home,[
    ['home-dashboard','Dashboard',IC.chart,'home'],['home-calendar','Calendar',IC.cal,'cal'],
    ['home-tasks','My Tasks',IC.rows,'work'],['home-requests','My Requests',IC.inbox,'list'],
    ['home-approvals','My Approvals',IC.archive,'list'],['home-activity','Recent Activity',IC.clock,'list'],
    ['home-kpi','KPI Snapshot',IC.chart,'dash'],['home-feed','Team Feed',IC.msg,'list'],
    ['home-notifications','Notifications',IC.inbox,'list'],['home-quick','Quick Actions',IC.arrow,'list'],
    ['home-saved','Saved Searches',IC.book,'list'],
  ],true),
  SEC('crm','CRM',IC.users,[
    ['crm-dashboard','Dashboard',IC.chart,'dash'],['crm-leads','Leads',IC.arrow,'board'],
    ['crm-opportunities','Opportunities',IC.arrow,'board'],['crm-pipeline','Pipeline',IC.rows,'board'],
    ['crm-customers','Customers',IC.users,'list'],['crm-accounts','Accounts',IC.building,'list'],
    ['crm-contacts','Contacts',IC.users,'list'],['crm-parties','Parties',IC.users,'list'],
    ['crm-activities','Activities',IC.clock,'list'],['crm-quotes','Quotes',IC.edit,'list'],
    ['crm-contracts','Contracts',IC.folder,'list'],['crm-residential','Residential Sales',IC.users,'list'],
    ['crm-enterprise','Enterprise Sales',IC.building,'list'],['crm-wholesale','Wholesale',IC.package,'list'],
    ['crm-d2d','D2D Sales',IC.truck,'list'],['crm-catalog','Product Catalog',IC.archive,'list'],
    ['crm-campaigns','Campaigns',IC.mail,'list'],['crm-promotions','Promotions',IC.sparkle,'list'],
    ['crm-segments','Segments',IC.layers,'list'],['crm-loyalty','Loyalty',IC.arrow,'list'],
    ['crm-retention','Retention',IC.arrow,'list'],['crm-churn','Churn Management',IC.chart,'dash'],
    ['crm-partnerships','Partnerships',IC.building,'list'],['crm-analytics','Sales Analytics',IC.chart,'dash'],
  ]),
  SEC('orders','Orders',IC.archive,[
    ['ord-dashboard','Dashboard',IC.chart,'dash'],['ord-new','New Order',IC.arrow,'list'],
    ['ord-queue','Order Queue',IC.rows,'list'],['ord-cpq','CPQ',IC.edit,'list'],
    ['ord-fulfillment','Fulfillment Queue',IC.rows,'list'],['ord-install','Installation Queue',IC.truck,'board'],
    ['ord-activations','Activations',IC.arrow,'list'],['ord-change','Change Orders',IC.edit,'list'],
    ['ord-upgrades','Upgrades & Downgrades',IC.archive,'list'],['ord-suspend','Suspend / Resume',IC.archive,'list'],
    ['ord-disconnect','Disconnect Orders',IC.archive,'list'],['ord-failed','Failed Orders',IC.inbox,'list'],
    ['ord-jeopardy','Jeopardy Management',IC.inbox,'list'],['ord-analytics','Order Analytics',IC.chart,'dash'],
  ]),
  SEC('support','Support',IC.inbox,[
    ['sup-dashboard','Dashboard',IC.chart,'dash'],['sup-helpdesk','Helpdesk',IC.inbox,'work'],
    ['sup-workitems','Work Items',IC.rows,'work'],['sup-console','Agent Console',IC.phone,'list'],
    ['sup-omni','Omnichannel Inbox',IC.msg,'list'],['sup-tickets','Tickets',IC.archive,'list'],
    ['sup-technical','Technical Support',IC.server,'list'],['sup-complaints','Complaint Resolution',IC.edit,'list'],
    ['sup-sla','SLA Management',IC.clock,'list'],['sup-escalations','Escalations',IC.arrow,'list'],
    ['sup-callcenter','Call Center',IC.phone,'list'],['sup-livechat','Live Chat',IC.msg,'list'],
    ['sup-kb','Knowledge Base',IC.book,'list'],['sup-retention','Retention Desk',IC.users,'list'],
    ['sup-analytics','Support Analytics',IC.chart,'dash'],
  ],true),
  SEC('billing','Billing',IC.receipt,[
    ['bil-dashboard','Dashboard',IC.chart,'dash'],['bil-subscriptions','Subscriptions',IC.archive,'list'],
    ['bil-services','Services',IC.server,'list'],['bil-plans','Tariff Plans',IC.archive,'list'],
    ['bil-usage','Usage Rating',IC.chart,'list'],['bil-invoices','Invoices',IC.receipt,'list'],
    ['bil-payments','Payments',IC.card,'list'],['bil-gateway','Pay Gateway',IC.card,'list'],
    ['bil-discounts','Discounts',IC.dollar,'list'],['bil-collections','Collections',IC.archive,'list'],
    ['bil-dunning','Dunning',IC.mail,'list'],['bil-credits','Credit Notes',IC.receipt,'list'],
    ['bil-tax','Tax Rules',IC.shield,'list'],['bil-reconcile','Reconciliation',IC.chart,'list'],
    ['bil-prepaid','Prepaid',IC.card,'list'],['bil-postpaid','Postpaid',IC.card,'list'],
    ['bil-ar','AR Aging',IC.clock,'list'],['bil-mrr','MRR / ARR',IC.chart,'dash'],
    ['bil-reports','Billing Reports',IC.book,'list'],
  ]),
  SEC('network','Network',IC.server,[
    ['net-dashboard','Dashboard',IC.chart,'dash'],['net-topology','Topology Map',IC.net,'map'],
    ['net-coverage','Coverage Map',IC.map,'map'],['net-gis','GIS',IC.map,'map'],
    ['net-sites','Sites / POPs',IC.server,'list'],['net-olts','OLTs',IC.server,'list'],
    ['net-routers','Routers',IC.router,'list'],['net-switches','Switches',IC.server,'list'],
    ['net-bts','BTS / Towers',IC.wifi,'list'],['net-devices','Devices',IC.router,'list'],
    ['net-ippools','IP Pools',IC.server,'list'],['net-vlans','VLANs',IC.layers,'list'],
    ['net-provisioning','Provisioning',IC.arrow,'list'],['net-monitoring','Monitoring',IC.activity,'dash'],
    ['net-alarms','Alarms',IC.inbox,'list'],['net-incidents','Incidents',IC.inbox,'list'],
    ['net-outages','Outages',IC.inbox,'list'],['net-noc','NOC Console',IC.activity,'dash'],
    ['net-capacity','Capacity Planning',IC.chart,'dash'],['net-maintenance','Maintenance',IC.gear,'list'],
    ['net-analytics','Network Analytics',IC.chart,'dash'],
  ]),
  SEC('field','Field Operations',IC.truck,[
    ['fld-dashboard','Dashboard',IC.chart,'dash'],['fld-installs','Install Board',IC.truck,'board'],
    ['fld-dispatch','Technician Dispatch',IC.users,'list'],['fld-scheduling','Scheduling',IC.cal,'cal'],
    ['fld-routes','Routes',IC.map,'map'],['fld-workorders','Work Orders',IC.rows,'work'],
    ['fld-jobs','Maintenance Jobs',IC.gear,'list'],['fld-mobile','Mobile Workforce',IC.users,'list'],
    ['fld-gps','GPS Tracking',IC.map,'map'],['fld-photos','Photo Capture',IC.edit,'list'],
    ['fld-inventory','Field Inventory',IC.package,'list'],['fld-analytics','Field Analytics',IC.chart,'dash'],
  ]),
  SEC('inventory','Inventory',IC.package,[
    ['inv-dashboard','Dashboard',IC.chart,'dash'],['inv-warehouse','Warehouse',IC.package,'list'],
    ['inv-stock','Stock',IC.package,'list'],['inv-movements','Movements',IC.arrow,'list'],
    ['inv-procurement','Procurement',IC.archive,'list'],['inv-suppliers','Suppliers',IC.building,'list'],
    ['inv-po','Purchase Orders',IC.edit,'list'],['inv-receipts','Goods Receipts',IC.archive,'list'],
    ['inv-assets','Assets',IC.package,'list'],['inv-lifecycle','Asset Lifecycle',IC.clock,'list'],
    ['inv-vehicles','Fleet / Vehicles',IC.truck,'list'],['inv-analytics','Inventory Analytics',IC.chart,'dash'],
  ]),
  SEC('finance','Finance',IC.dollar,[
    ['fin-dashboard','Dashboard',IC.chart,'dash'],['fin-revenue','Revenue',IC.dollar,'dash'],
    ['fin-expenses','Expenses',IC.dollar,'list'],['fin-budgeting','Budgeting',IC.receipt,'list'],
    ['fin-forecasting','Forecasting',IC.chart,'dash'],['fin-procurement','Procurement',IC.archive,'list'],
    ['fin-vendors','Vendor Payments',IC.building,'list'],['fin-export','Accounting Export',IC.folder,'list'],
    ['fin-tax','Tax Management',IC.shield,'list'],['fin-reconcile','Reconciliation',IC.chart,'list'],
    ['fin-statements','Financial Statements',IC.book,'list'],['fin-audit','Audit Support',IC.shield,'list'],
    ['fin-analytics','Finance Analytics',IC.chart,'dash'],
  ]),
  SEC('hr','HR',IC.briefcase,[
    ['hr-dashboard','Dashboard',IC.chart,'dash'],['hr-employees','Employees',IC.users,'list'],
    ['hr-orgchart','Org Chart',IC.building,'list'],['hr-departments','Departments',IC.building,'list'],
    ['hr-attendance','Attendance',IC.clock,'list'],['hr-leave','Leave Management',IC.cal,'list'],
    ['hr-payroll','Payroll',IC.dollar,'list'],['hr-recruitment','Recruitment',IC.users,'list'],
    ['hr-onboarding','Onboarding',IC.arrow,'list'],['hr-performance','Performance Reviews',IC.chart,'list'],
    ['hr-training','Training',IC.book,'list'],['hr-time','Time Tracking',IC.clock,'list'],
    ['hr-analytics','HR Analytics',IC.chart,'dash'],
  ]),
  SEC('analytics','Analytics',IC.chart,[
    ['ana-exec','Executive Dashboard',IC.chart,'dash'],['ana-kpi','KPI Center',IC.chart,'dash'],
    ['ana-builder','Report Builder',IC.edit,'list'],['ana-reports','Reports',IC.book,'list'],
    ['ana-revenue','Revenue Analytics',IC.chart,'dash'],['ana-customer','Customer Analytics',IC.users,'dash'],
    ['ana-network','Network Analytics',IC.server,'dash'],['ana-sla','SLA Analytics',IC.clock,'dash'],
    ['ana-churn','Churn Analytics',IC.chart,'dash'],['ana-workforce','Workforce Analytics',IC.users,'dash'],
    ['ana-forecast','Forecasting',IC.chart,'dash'],['ana-export','Export Center',IC.folder,'list'],
  ],true),
  SEC('ai','AI',IC.sparkle,[
    ['ai-copilot','AI Copilot',IC.sparkle,'list'],['ai-dispatcher','AI Dispatcher',IC.sparkle,'list'],
    ['ai-routing','Smart Routing',IC.arrow,'list'],['ai-search','AI Search',IC.sparkle,'list'],
    ['ai-insights','AI Insights',IC.chart,'dash'],['ai-suggest','AI Suggestions',IC.sparkle,'list'],
    ['ai-churn','Churn Prediction',IC.chart,'dash'],['ai-fraud','Fraud Detection',IC.shield,'list'],
    ['ai-anomaly','Network Anomaly Detection',IC.server,'list'],['ai-predictive','Predictive Maintenance',IC.gear,'list'],
    ['ai-chatbot','AI Chatbot',IC.msg,'list'],['ai-voicebot','Voicebot',IC.phone,'list'],
    ['ai-assist','Agent Assist',IC.users,'list'],['ai-config','AI Configuration',IC.gear,'settings'],
  ]),
  SEC('comms','Communications',IC.msg,[
    ['com-messages','Messages',IC.msg,'msgr'],['com-outbound','Outbound',IC.mail,'email'],
    ['com-center','Notification Center',IC.inbox,'list'],['com-email-tpl','Email Templates',IC.mail,'list'],
    ['com-sms-tpl','SMS Templates',IC.msg,'list'],['com-whatsapp','WhatsApp',IC.msg,'list'],
    ['com-telegram','Telegram',IC.msg,'list'],['com-broadcast','Broadcast Campaigns',IC.mail,'list'],
    ['com-outage','Outage Notifications',IC.inbox,'list'],['com-dunning','Dunning Messages',IC.receipt,'list'],
    ['com-prefs','Communication Preferences',IC.gear,'settings'],['com-logs','Message Logs',IC.book,'list'],
  ]),
  SEC('docs','Documents',IC.folder,[
    ['doc-dashboard','Dashboard',IC.chart,'dash'],['doc-contracts','Contracts',IC.folder,'list'],
    ['doc-quotes','Quotes',IC.edit,'list'],['doc-invoices','Invoices',IC.receipt,'list'],
    ['doc-workorders','Work Orders',IC.rows,'list'],['doc-reports','Reports',IC.book,'list'],
    ['doc-templates','Templates',IC.edit,'list'],['doc-esign','E-Signatures',IC.edit,'list'],
    ['doc-storage','File Storage',IC.folder,'list'],['doc-archive','Archive',IC.archive,'list'],
    ['doc-search','Full-Text Search',IC.sparkle,'list'],
  ]),
  SEC('projects','Projects',IC.layers,[
    ['prj-dashboard','Dashboard',IC.chart,'dash'],['prj-projects','Projects',IC.layers,'list'],
    ['prj-tasks','Tasks',IC.rows,'work'],['prj-milestones','Milestones',IC.arrow,'list'],
    ['prj-resources','Resources',IC.users,'list'],['prj-risks','Risks',IC.inbox,'list'],
    ['prj-budgets','Budgets',IC.dollar,'list'],['prj-pmo','PMO',IC.building,'list'],
    ['prj-innovation','Innovation',IC.sparkle,'list'],['prj-analytics','Project Analytics',IC.chart,'dash'],
  ]),
  SEC('legal','Legal & Compliance',IC.shield,[
    ['leg-contracts','Contracts',IC.folder,'list'],['leg-cases','Legal Cases',IC.archive,'list'],
    ['leg-policies','Policies',IC.book,'list'],['leg-regulatory','Regulatory Reporting',IC.chart,'list'],
    ['leg-gdpr','GDPR / Privacy',IC.shield,'list'],['leg-consent','Consent Records',IC.shield,'list'],
    ['leg-holds','Legal Holds',IC.lock,'list'],['leg-compliance','Compliance Rules',IC.shield,'list'],
    ['leg-audit','Audit Trails',IC.clock,'list'],['leg-risk','Risk Registers',IC.inbox,'list'],
    ['leg-governance','Governance',IC.building,'list'],['leg-analytics','Compliance Analytics',IC.chart,'dash'],
  ]),
  SEC('admin','Administration',IC.gear,[
    ['adm-settings','Tenant Settings',IC.gear,'settings'],['adm-users','Users',IC.users,'list'],
    ['adm-roles','Roles',IC.lock,'settings'],['adm-permissions','Permissions',IC.shield,'settings'],
    ['adm-org','Org Structure',IC.building,'list'],['adm-sla','SLA Policies',IC.clock,'list'],
    ['adm-routing','Routing Rules',IC.arrow,'list'],['adm-notif-rules','Notification Rules',IC.mail,'list'],
    ['adm-dash-builder','Dashboard Builder',IC.chart,'settings'],['adm-integrations','Integrations',IC.layers,'list'],
    ['adm-webhooks','Webhooks',IC.arrow,'list'],['adm-outbound','Outbound',IC.mail,'list'],
    ['adm-pools','Resource Pools',IC.server,'list'],['adm-ai-settings','AI Settings',IC.sparkle,'settings'],
    ['adm-audit','Audit Logs',IC.clock,'list'],['adm-import','Import / Export',IC.folder,'list'],
  ]),
  SEC('platform','Platform Ops',IC.activity,[
    ['plt-eventbus','Event Bus',IC.arrow,'list'],['plt-queues','Queue Monitoring',IC.rows,'list'],
    ['plt-logs','Runtime Logs',IC.edit,'list'],['plt-metrics','Metrics',IC.chart,'dash'],
    ['plt-traces','Traces',IC.activity,'list'],['plt-adapters','Adapter Health',IC.server,'list'],
    ['plt-deploy','Deployment',IC.arrow,'list'],['plt-regions','Regions',IC.map,'map'],
    ['plt-secrets','Secrets Vault',IC.lock,'list'],['plt-api','API Explorer',IC.edit,'list'],
    ['plt-rollouts','Feature Rollouts',IC.sparkle,'list'],['plt-health','System Health',IC.activity,'dash'],
  ]),
];

// quick lookup id → section id (module accent + crumbs)
const ITEM_MODULE = {};
NAV.forEach(s => s.items.forEach(it => { ITEM_MODULE[it.id] = { sec: s.id, secLabel: s.label }; }));

// shared name pools (Armenian — Yerevan Net tenant)
const PEOPLE = ['Lilit Sargsyan','Hayk Grigoryan','Anna Hakobyan','Davit Margaryan','Mariam Petrosyan','Tigran Avetisyan','Sona Khachatryan','Narek Manukyan','Gevorg Vardanyan','Ani Harutyunyan','Armen Karapetyan','Nare Stepanyan'];
const COMPANIES = ['Acme Corp','Metro Gov','ArmTel Wholesale','Yerevan Mall','Cascade Hotels','Ararat Logistics','Sevan Resorts','TechPark LLC','GoldenGrain Co','Vega Media'];
const CITIES = ['Yerevan','Gyumri','Vanadzor','Abovyan','Kapan','Hrazdan','Armavir','Ashtarak'];
const initials = (n) => n.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();

const KPIS = [
  { lbl:'Active subscribers', val:'128,402', delta:'+2.4%', up:true, icon:'users', accent:false },
  { lbl:'MRR', val:'$1.84M', delta:'+5.1%', up:true, icon:'banknote', accent:true },
  { lbl:'Open tickets', val:'347', delta:'-8.0%', up:false, icon:'inbox', accent:false },
  { lbl:'Network uptime', val:'99.98%', delta:'30d', up:true, icon:'activity', accent:false },
];

const WORKITEMS = [
  { id:'TK-4821', subject:'Fiber drop — no link light', cust:'Lilit Sargsyan', status:'In progress', sk:'pill-warning', sla:'02:14', prio:'Critical', pk:'pill-danger', assignee:'AH' },
  { id:'TK-4822', subject:'Billing dispute — double charge', cust:'Hayk Grigoryan', status:'Resolved', sk:'pill-success', sla:'—', prio:'Normal', pk:'pill-info', assignee:'NM' },
  { id:'TK-4823', subject:'Upgrade to Fiber 1G', cust:'Anna Hakobyan', status:'Open', sk:'pill-neutral', sla:'05:48', prio:'High', pk:'pill-warning', assignee:'GV' },
  { id:'TK-4824', subject:'Intermittent latency spikes', cust:'Davit Margaryan', status:'In progress', sk:'pill-warning', sla:'01:02', prio:'High', pk:'pill-warning', assignee:'AH' },
  { id:'TK-4825', subject:'Relocation — transfer service', cust:'Mariam Petrosyan', status:'Open', sk:'pill-neutral', sla:'12:30', prio:'Normal', pk:'pill-info', assignee:'SK' },
  { id:'TK-4826', subject:'ONT replacement after outage', cust:'Tigran Avetisyan', status:'Blocked', sk:'pill-danger', sla:'00:18', prio:'Critical', pk:'pill-danger', assignee:'NM' },
  { id:'TK-4827', subject:'Static IP provisioning', cust:'Sona Khachatryan', status:'Resolved', sk:'pill-success', sla:'—', prio:'Low', pk:'pill-neutral', assignee:'GV' },
];

const ACTIVITY = [
  { who:'Narek M.', act:'resolved', obj:'TK-4822', t:'2m ago', icon:'check', tone:'var(--gx-success)' },
  { who:'System', act:'escalated', obj:'TK-4826 to Tier 2', t:'14m ago', icon:'alert-triangle', tone:'var(--gx-danger)' },
  { who:'Gevorg V.', act:'created entity', obj:'Opportunities', t:'1h ago', icon:'wand-2', tone:'var(--gx-gold)' },
  { who:'Ani H.', act:'provisioned', obj:'10.42.7.193', t:'2h ago', icon:'server', tone:'var(--gx-info)' },
  { who:'Billing', act:'generated', obj:'1,204 invoices', t:'3h ago', icon:'receipt', tone:'var(--gx-text-2)' },
];

const FIELD_TYPES = ['text','textarea','number','money','boolean','date','datetime','email','phone','select','ref','status'];

Object.assign(window, { Icon, NAV, ITEM_MODULE, KPIS, WORKITEMS, ACTIVITY, FIELD_TYPES, PEOPLE, COMPANIES, CITIES, initials });
