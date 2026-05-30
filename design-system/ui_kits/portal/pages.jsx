/* GAAex Portal — config-driven page renderers.
   Every nav item resolves here to a real page built from config — the same way the live
   GAAex platform renders ~190 pages from studio_config (no hardcoded screens). */

// ── status → pill class ───────────────────────────────────────────────
const STATUS_CLASS = (s) => {
  const x = String(s).toLowerCase();
  if (/(active|online|paid|resolved|complete|completed|won|approved|provisioned|delivered|success|met|live|healthy|sent|signed|closed)/.test(x)) return 'pill-success';
  if (/(in progress|provisioning|at.?risk|degraded|partial|pending review|processing|scheduled|review|warn|running)/.test(x)) return 'pill-warning';
  if (/(overdue|failed|blocked|breached|offline|suspended|churned|critical|rejected|error|expired|jeopardy|down|void)/.test(x)) return 'pill-danger';
  if (/(qualified|new|info|draft|negotiation|proposal|queued|trial)/.test(x)) return 'pill-info';
  return 'pill-neutral';
};
const PRIO_CLASS = (p) => ({ Critical:'pill-danger', High:'pill-warning', Normal:'pill-info', Low:'pill-neutral' }[p] || 'pill-neutral');

// ── tiny deterministic helpers ────────────────────────────────────────
const R = (arr, i) => arr[i % arr.length];
const money = (n) => '$' + n.toLocaleString('en-US');
const gen = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));
const pad4 = (n) => String(n).padStart(4, '0');

// ── ENTITY ARCHETYPE FAMILIES ─────────────────────────────────────────
// each returns { kpis, columns, rows, board? }
const FAM = {
  people: (label, prefix) => ({
    kpis: [ [label, '14,208', '+3.1%', true], ['New this month', '512', '+8%', true], ['Active', '92%', '', true, true] ],
    columns: [ {k:'name',l:label.replace(/s$/,''),t:'avatar'},{k:'email',l:'Email',t:'sub'},{k:'phone',l:'Phone',t:'mono'},{k:'city',l:'City',t:'text'},{k:'plan',l:'Plan',t:'text'},{k:'status',l:'Status',t:'status'} ],
    rows: gen(11, i => ({ name:R(PEOPLE,i), email:R(PEOPLE,i).toLowerCase().replace(' ','.')+'@mail.am', phone:'+374 '+(40+i)+' '+(100000+i*731).toString().slice(0,6), city:R(CITIES,i), plan:R(['Fiber 100','Fiber 500','Fiber 1G','Mobile 20GB'],i), status:R(['Active','Active','Active','Suspended','Trial'],i) })),
  }),
  org: (label) => ({
    kpis: [ [label, '1,284', '+2%', true], ['Enterprise', '186', '', true, true], ['Active contracts', '94%', '', true] ],
    columns: [ {k:'name',l:'Name',t:'strong'},{k:'type',l:'Type',t:'text'},{k:'city',l:'City',t:'text'},{k:'owner',l:'Owner',t:'avatar'},{k:'mrr',l:'MRR',t:'money'},{k:'status',l:'Status',t:'status'} ],
    rows: gen(10, i => ({ name:R(COMPANIES,i), type:R(['Enterprise','SMB','Wholesale','Government'],i), city:R(CITIES,i), owner:R(PEOPLE,i+3), mrr:money((4+i)*1240), status:R(['Active','Active','Negotiation','Active','Suspended'],i) })),
  }),
  doc: (label, pfx) => ({
    kpis: [ ['Total', '$2.41M', '+6%', true, true], ['Outstanding', '$184K', '-4%', false], ['This month', '1,204', '+9%', true] ],
    columns: [ {k:'id',l:'Number',t:'id'},{k:'party',l:'Customer',t:'text'},{k:'amount',l:'Amount',t:'money'},{k:'date',l:'Date',t:'date'},{k:'status',l:'Status',t:'status'} ],
    rows: gen(11, i => ({ id:(pfx||'INV')+'-'+pad4(2240+i), party:R([...COMPANIES,...PEOPLE],i), amount:money(((i*37)%90+12)*100+90), date:`2026-05-${pad4(2+i).slice(2)}`, status:R(['Paid','Paid','Pending','Overdue','Paid','Void'],i) })),
  }),
  ticket: (label, pfx) => ({
    kpis: [ ['Open', '347', '-8%', false], ['Breaching SLA', '12', '+3', false], ['Resolved 30d', '4,182', '+11%', true, true] ],
    columns: [ {k:'id',l:'ID',t:'id'},{k:'subject',l:'Subject',t:'strong'},{k:'owner',l:'Owner',t:'avatar'},{k:'prio',l:'Priority',t:'prio'},{k:'sla',l:'SLA',t:'mono'},{k:'status',l:'Status',t:'status'} ],
    rows: gen(11, i => ({ id:(pfx||'WI')+'-'+pad4(4821+i), subject:R(['Fiber drop — no link light','Billing dispute','Upgrade request','Latency spikes','Relocation','ONT replacement','Static IP request','Speed not as advertised','Modem reboot loop','New install survey'],i), owner:R(PEOPLE,i), prio:R(['Critical','High','Normal','Low','High','Normal'],i), sla:R(['02:14','05:48','—','01:02','12:30','00:18'],i), status:R(['Open','In progress','Resolved','Blocked','Open','In progress'],i) })),
    board: { statusKey:'status', cols:['Open','In progress','Blocked','Resolved'] },
  }),
  device: (label) => ({
    kpis: [ [label, '3,842', '', true], ['Online', '99.2%', '', true, true], ['Degraded', '21', '+4', false] ],
    columns: [ {k:'name',l:'Name',t:'strong'},{k:'ip',l:'Mgmt IP',t:'mono'},{k:'model',l:'Model',t:'sub'},{k:'site',l:'Site',t:'text'},{k:'uptime',l:'Uptime',t:'mono'},{k:'status',l:'Health',t:'status'} ],
    rows: gen(11, i => ({ name:R(['olt','rtr','sw','bts','ont'],i)+'-yvn-'+pad4(12+i), ip:'10.'+(20+i)+'.'+(i*7%250)+'.1', model:R(['Huawei MA5800','MikroTik CCR2116','Cisco C9300','Nokia 7360','ZTE C620'],i), site:R(['Yerevan POP-'+(1+i%4),'Gyumri Core','Vanadzor Edge'],i), uptime:R(['142d','38d','7d','311d','2d'],i), status:R(['Online','Online','Online','Degraded','Offline'],i) })),
  }),
  netres: (label) => ({
    kpis: [ ['Pools', '64', '', true], ['Utilization', '78%', '+2%', true, true], ['Exhausted soon', '3', '', false] ],
    columns: [ {k:'name',l:'Name',t:'strong'},{k:'cidr',l:'Range / VLAN',t:'mono'},{k:'site',l:'Site',t:'text'},{k:'usage',l:'Utilization',t:'progress'},{k:'status',l:'Status',t:'status'} ],
    rows: gen(10, i => ({ name:R(['Pool','VLAN','Subnet'],i)+'-'+(100+i*4), cidr:R(['10.42.'+i+'.0/24','VLAN '+(200+i),'185.12.'+i+'.0/22'],i), site:R(['Yerevan POP-1','Gyumri Core','Vanadzor Edge'],i), usage:(40+i*5)%100, status:R(['Active','Active','At-risk','Active'],i) })),
  }),
  catalog: (label) => ({
    kpis: [ ['Plans', '38', '', true], ['Best seller', 'Fiber 500', '', true, true], ['Avg ARPU', '$28.40', '+1.2%', true] ],
    columns: [ {k:'name',l:'Plan',t:'strong'},{k:'speed',l:'Speed',t:'mono'},{k:'price',l:'Price / mo',t:'money'},{k:'subs',l:'Subscribers',t:'num'},{k:'status',l:'Status',t:'status'} ],
    rows: gen(9, i => ({ name:R(['Fiber 100','Fiber 300','Fiber 500','Fiber 1G','Mobile 20GB','IPTV Premium','Static IP','Business 2G'],i), speed:R(['100/50','300/150','500/250','1000/500','—'],i)+' Mbps', price:money(R([14,22,28,40,9,12,5,120],i)), subs:R([42000,31000,38500,12400,28000,9400,2100,860],i), status:R(['Active','Active','Active','Active','Active','Draft'],i) })),
  }),
  asset: (label) => ({
    kpis: [ ['SKUs', '1,942', '', true], ['Low stock', '34', '+6', false], ['Value', '$1.2M', '+3%', true, true] ],
    columns: [ {k:'sku',l:'SKU',t:'mono'},{k:'name',l:'Item',t:'strong'},{k:'cat',l:'Category',t:'text'},{k:'loc',l:'Location',t:'text'},{k:'qty',l:'Qty',t:'num'},{k:'status',l:'Status',t:'status'} ],
    rows: gen(10, i => ({ sku:'SKU-'+pad4(100+i*3), name:R(['ONT Nokia G-140W','Fiber patch 2m','SFP+ 10G','CPE Router','Drop cable 100m','Splitter 1:8','Set-top box','UPS 1kVA'],i), cat:R(['CPE','Cabling','Optics','Power'],i), loc:R(['WH Yerevan','WH Gyumri','Van A1'],i), qty:R([1240,84,12,420,33,210,56,9],i), status:R(['In stock','In stock','Low stock','In stock','Low stock'],i) })),
  }),
  content: (label) => ({
    kpis: [ [label, '482', '+12', true], ['Published', '410', '', true, true], ['Drafts', '72', '', false] ],
    columns: [ {k:'name',l:'Name',t:'strong'},{k:'type',l:'Type',t:'text'},{k:'owner',l:'Owner',t:'avatar'},{k:'updated',l:'Updated',t:'date'},{k:'status',l:'Status',t:'status'} ],
    rows: gen(10, i => ({ name:label.replace(/s$/,'')+' '+(i+1)+' — '+R(['Onboarding','Win-back','Outage notice','Renewal','Promo','Welcome'],i), type:R(['Email','SMS','PDF','Policy','Segment'],i), owner:R(PEOPLE,i+2), updated:`2026-05-${pad4(10+i).slice(2)}`, status:R(['Published','Published','Draft','Published','Review'],i) })),
  }),
  sysrow: (label, pfx) => ({
    kpis: [ ['Total', '1,204', '', true], ['Active', '1,180', '', true, true], ['Errors 24h', '3', '', false] ],
    columns: [ {k:'name',l:'Name',t:'strong'},{k:'detail',l:'Detail',t:'mono'},{k:'owner',l:'Actor',t:'sub'},{k:'time',l:'When',t:'date'},{k:'status',l:'Status',t:'status'} ],
    rows: gen(11, i => ({ name:label.replace(/s$/,'')+' '+pad4(1+i), detail:R(['POST /api/org','evt.invoice.paid','GET /health','PATCH /nodes','job#'+(900+i)],i), owner:R(PEOPLE,i), time:R(['2m ago','14m ago','1h ago','3h ago','yesterday'],i), status:R(['Active','Active','Success','Active','Failed'],i) })),
  }),
};

// id keyword → family
function famFor(id, label) {
  const k = id.replace(/^[a-z]+-/, '');
  const map = [
    [/(customer|contact|lead|candidate|employee|partie|residential|mobile|loyalty|retention)/, ['people', null]],
    [/(account|supplier|vendor|partnership|department|enterprise|wholesale|warehouse)/, ['org', null]],
    [/(invoice|quote|payment|credit|expense|payroll|budget|^po$|purchase|receipt|collection|dunning|reconcile|ar$|revenue)/, ['doc', label.includes('Quote')?'QT':label.includes('Payment')?'PMT':label.includes('Credit')?'CN':label.includes('Purchase')?'PO':'INV']],
    [/(ticket|complaint|escalation|order|workorder|jobs|change|fulfillment|activation|disconnect|suspend|upgrade|failed|jeopardy|incident|risk|case|hold)/, ['ticket', label.includes('Order')?'ORD':label.includes('Work')?'WO':label.includes('Case')?'LC':'WI']],
    [/(device|router|switch|olt|tower|bts|site|sites|pop|noc|adapter)/, ['device', null]],
    [/(vlan|ippool|pool|subnet)/, ['netres', null]],
    [/(plan|product|catalog|service|subscription|tariff)/, ['catalog', null]],
    [/(stock|asset|vehicle|movement|fleet|inventory|procurement)/, ['asset', null]],
    [/(template|policy|policie|campaign|broadcast|report|contract|document|segment|promotion|kb|article|saved|feed|message|log|consent|governance|regulatory)/, ['content', null]],
    [/(user|role|permission|integration|webhook|audit|api|queue|trace|secret|eventbus|deploy|rollout|notification|routing|sla)/, ['sysrow', null]],
  ];
  for (const [re, fam] of map) if (re.test(k)) return fam;
  return ['content', null];
}

function entityConfig(item) {
  const [fam, pfx] = famFor(item.id, item.label);
  return FAM[fam](item.label, pfx);
}

window.GXPages = { STATUS_CLASS, PRIO_CLASS, entityConfig, R, money, gen };
