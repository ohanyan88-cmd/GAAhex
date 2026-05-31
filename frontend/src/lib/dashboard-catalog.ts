// Dashboard Chart Catalog — every chart the analytics dashboard can show.
//
// Each entry: { id, category, title, description, implemented }
// Charts with implemented=false render a placeholder; users can still add them
// to their layout, so when we build them later they appear automatically.

export type ChartCategory =
  | 'Executive Overview'
  | 'Progress Tracking'
  | 'Schedule & Delivery'
  | 'Task Execution'
  | 'Resource & Workforce'
  | 'Financial Execution'
  | 'Risk Management'
  | 'Issue Management'
  | 'Quality & Compliance'
  | 'Strategic / OKR'
  | 'Portfolio / Program'
  | 'Operational Execution'
  | 'Engineering / DevOps'
  | 'Sales / Commercial'
  | 'Customer Execution'
  | 'ISP-Specific'

export type ChartDef = {
  id: string
  category: ChartCategory
  title: string
  description: string
  implemented: boolean
}

export const CHART_CATALOG: ChartDef[] = [
  // ── Executive Overview ────────────────────────────────────────────────────
  { id: 'kpi-strip',          category: 'Executive Overview', title: 'KPI Scorecards',           description: 'MRR · AR · Collected · New leads', implemented: true },
  { id: 'rag-health',         category: 'Executive Overview', title: 'RAG Health Distribution',  description: 'Projects/workitems by Red/Amber/Green health', implemented: true },
  { id: 'health-gauge',       category: 'Executive Overview', title: 'Overall Health Gauge',     description: 'Speedometer of system health', implemented: false },
  { id: 'exec-summary',       category: 'Executive Overview', title: 'Executive Summary Cards',  description: 'Top-line numbers for leadership', implemented: false },

  // ── Progress Tracking ─────────────────────────────────────────────────────
  { id: 'planned-vs-actual',  category: 'Progress Tracking',  title: 'Planned vs Actual',        description: 'Project progress: planned vs actual %', implemented: false },
  { id: 'cumulative-curve',   category: 'Progress Tracking',  title: 'Cumulative Progress Curve',description: 'S-curve of cumulative completion', implemented: false },
  { id: 'milestone-trend',    category: 'Progress Tracking',  title: 'Milestone Completion Trend',description: 'Milestones completed per month', implemented: false },
  { id: 'workstream-pct',     category: 'Progress Tracking',  title: 'Percent Complete by Workstream',description: 'Per-workstream progress bars', implemented: false },
  { id: 'burnup',             category: 'Progress Tracking',  title: 'Progress Burn-up',         description: 'Scope vs done over time', implemented: false },

  // ── Schedule & Delivery ───────────────────────────────────────────────────
  { id: 'gantt',              category: 'Schedule & Delivery',title: 'Gantt Chart',              description: 'Projects + milestones + dependencies', implemented: false },
  { id: 'milestone-timeline', category: 'Schedule & Delivery',title: 'Milestone Timeline',       description: 'Horizontal milestone timeline', implemented: false },
  { id: 'delivery-roadmap',   category: 'Schedule & Delivery',title: 'Delivery Roadmap',         description: 'Quarterly delivery roadmap', implemented: false },
  { id: 'schedule-variance',  category: 'Schedule & Delivery',title: 'Schedule Variance Trend',  description: 'Days early/late per project', implemented: false },
  { id: 'on-time-delivery',   category: 'Schedule & Delivery',title: 'On-Time vs Late Deliverables',description: 'Stacked bar per month', implemented: false },

  // ── Task Execution ────────────────────────────────────────────────────────
  { id: 'status-workitems',   category: 'Task Execution',     title: 'Workitems by Status',      description: 'Current breakdown across statuses', implemented: true },
  { id: 'task-aging',         category: 'Task Execution',     title: 'Task Aging Distribution',  description: 'Open tasks bucketed by age', implemented: true },
  { id: 'task-completion',    category: 'Task Execution',     title: 'Task Completion Trend',    description: 'Weekly completed task count', implemented: false },
  { id: 'throughput',         category: 'Task Execution',     title: 'Throughput Trend',         description: 'Completed tasks per week', implemented: false },
  { id: 'backlog-growth',     category: 'Task Execution',     title: 'Backlog Growth Trend',     description: 'Open tasks over time', implemented: false },
  { id: 'cfd',                category: 'Task Execution',     title: 'Cumulative Flow Diagram', description: 'Stacked area of task states', implemented: false },

  // ── Resource & Workforce ──────────────────────────────────────────────────
  { id: 'resource-util',      category: 'Resource & Workforce',title: 'Resource Utilization',    description: '% allocated per person', implemented: false },
  { id: 'capacity-demand',    category: 'Resource & Workforce',title: 'Team Capacity vs Demand', description: 'Bar by team', implemented: false },
  { id: 'fte-allocation',     category: 'Resource & Workforce',title: 'FTE Allocation by Project',description: 'Stacked bar per project', implemented: false },
  { id: 'workload-heatmap',   category: 'Resource & Workforce',title: 'Workload Heatmap',        description: 'People × projects intensity grid', implemented: false },
  { id: 'salesperson-rank',   category: 'Resource & Workforce',title: 'Salesperson Ranking',     description: 'Sales by assigned user', implemented: true },

  // ── Financial Execution ───────────────────────────────────────────────────
  { id: 'monthly-revenue',    category: 'Financial Execution',title: 'Monthly Revenue vs Prior', description: 'Bar chart of paid revenue per month', implemented: true },
  { id: 'revenue-bar',        category: 'Financial Execution',title: 'Revenue vs Churn (bars)',  description: 'Revenue bars with churn band', implemented: true },
  { id: 'payment-area',       category: 'Financial Execution',title: 'Payment Trend (area)',     description: 'Area chart of cumulative payments', implemented: true },
  { id: 'ar-aging',           category: 'Financial Execution',title: 'AR Aging',                 description: 'Current / 30d / 60d / 90d+ buckets', implemented: true },
  { id: 'budget-vs-actual',   category: 'Financial Execution',title: 'Budget vs Actual',         description: 'Per-budget bar comparison', implemented: false },
  { id: 'cost-burn',          category: 'Financial Execution',title: 'Cost Burn Rate',           description: 'Monthly spend trend', implemented: false },
  { id: 'revenue-waterfall',  category: 'Financial Execution',title: 'Revenue Waterfall',        description: 'Opening + new + upsell - churn = closing', implemented: false },
  { id: 'evm',                category: 'Financial Execution',title: 'Earned Value (EV/PV/AC)',  description: 'EVM lines + CPI/SPI', implemented: false },

  // ── Risk Management ───────────────────────────────────────────────────────
  { id: 'risk-heatmap',       category: 'Risk Management',    title: 'Risk Heat Map',            description: 'Likelihood × Impact 3×3 grid', implemented: true },
  { id: 'risk-exposure',      category: 'Risk Management',    title: 'Risk Exposure Trend',      description: 'Total exposure score over time', implemented: false },
  { id: 'risks-severity',     category: 'Risk Management',    title: 'Risks by Severity',        description: 'Donut of risk severity buckets', implemented: false },
  { id: 'risks-category',     category: 'Risk Management',    title: 'Risks by Category',        description: 'Bar per risk category', implemented: false },

  // ── Issue Management ──────────────────────────────────────────────────────
  { id: 'status-tickets',     category: 'Issue Management',   title: 'Tickets by Status',        description: 'Current breakdown', implemented: true },
  { id: 'issue-aging',        category: 'Issue Management',   title: 'Issue Aging',              description: 'Open tickets bucketed by age', implemented: true },
  { id: 'issue-resolution',   category: 'Issue Management',   title: 'Issue Resolution Trend',   description: 'Resolved vs opened per week', implemented: false },
  { id: 'escalation-trend',   category: 'Issue Management',   title: 'Escalation Trend',         description: 'Escalations per month', implemented: false },

  // ── Quality & Compliance ──────────────────────────────────────────────────
  { id: 'defect-trend',       category: 'Quality & Compliance',title: 'Defect Trend',            description: 'Defects per release', implemented: false },
  { id: 'sla-compliance',     category: 'Quality & Compliance',title: 'SLA Compliance',          description: 'Met vs breached per period', implemented: false },
  { id: 'audit-findings',     category: 'Quality & Compliance',title: 'Audit Findings Trend',    description: 'Findings per audit', implemented: false },

  // ── Strategic / OKR ───────────────────────────────────────────────────────
  { id: 'okr-progress',       category: 'Strategic / OKR',    title: 'Objective Progress (OKR)', description: 'Per-objective bar', implemented: false },
  { id: 'kr-achievement',     category: 'Strategic / OKR',    title: 'Key Result Achievement',   description: 'KR % achieved', implemented: false },

  // ── Portfolio / Program ───────────────────────────────────────────────────
  { id: 'project-bubble',     category: 'Portfolio / Program',title: 'Portfolio Bubble Chart',   description: 'Progress × variance × budget', implemented: false },
  { id: 'project-matrix',     category: 'Portfolio / Program',title: 'Project Health Matrix',    description: 'Projects × dimensions', implemented: false },
  { id: 'priority-matrix',    category: 'Portfolio / Program',title: 'Prioritization Matrix',    description: 'Value vs effort 2×2', implemented: false },

  // ── Operational Execution ─────────────────────────────────────────────────
  { id: 'sla-perf',           category: 'Operational Execution',title: 'SLA Performance',        description: 'SLA compliance trend', implemented: false },
  { id: 'incident-trend',     category: 'Operational Execution',title: 'Incident Trend',         description: 'Incidents per month by severity', implemented: false },
  { id: 'mttr',               category: 'Operational Execution',title: 'MTTR Trend',             description: 'Mean Time To Recovery', implemented: false },
  { id: 'service-availability',category:'Operational Execution',title: 'Service Availability',  description: '% uptime per service', implemented: false },

  // ── Engineering / DevOps ──────────────────────────────────────────────────
  { id: 'deploy-freq',        category: 'Engineering / DevOps',title: 'Deployment Frequency',    description: 'Deployments per week', implemented: false },
  { id: 'lead-time',          category: 'Engineering / DevOps',title: 'Lead Time for Changes',   description: 'Commit → production time', implemented: false },
  { id: 'change-fail-rate',   category: 'Engineering / DevOps',title: 'Change Failure Rate',     description: '% of deploys that fail', implemented: false },
  { id: 'sprint-velocity',    category: 'Engineering / DevOps',title: 'Sprint Velocity',         description: 'Story points per sprint', implemented: false },

  // ── Sales / Commercial ────────────────────────────────────────────────────
  { id: 'funnel',             category: 'Sales / Commercial', title: 'Sales Funnel',             description: 'Lead → opportunity → deal → customer', implemented: true },
  { id: 'pipeline-progress',  category: 'Sales / Commercial', title: 'Pipeline Progress',        description: 'Deal stages cumulative', implemented: false },
  { id: 'win-rate',           category: 'Sales / Commercial', title: 'Win Rate Trend',           description: '% deals won per month', implemented: false },
  { id: 'territory-perf',     category: 'Sales / Commercial', title: 'Territory Performance',    description: 'Sales per region', implemented: false },
  { id: 'lead-source-donut',  category: 'Sales / Commercial', title: 'Lead Source Distribution', description: 'Leads grouped by source', implemented: true },

  // ── Customer Execution ────────────────────────────────────────────────────
  { id: 'sub-donut',          category: 'Customer Execution', title: 'Subscription Mix (donut)', description: 'Active subs by plan', implemented: true },
  { id: 'customer-line',      category: 'Customer Execution', title: 'New vs Churned Subs',      description: '2-series line chart', implemented: true },
  { id: 'status-subs',        category: 'Customer Execution', title: 'Subscriptions by Status',  description: 'Active / suspended / cancelled', implemented: true },
  { id: 'churn-trend',        category: 'Customer Execution', title: 'Churn Trend',              description: 'Monthly churn events', implemented: false },
  { id: 'csat',               category: 'Customer Execution', title: 'CSAT Score',               description: 'Customer satisfaction trend', implemented: false },
  { id: 'nps',                category: 'Customer Execution', title: 'NPS Trend',                description: 'Net Promoter Score', implemented: false },

  // ── ISP-Specific ──────────────────────────────────────────────────────────
  { id: 'wow-cards',          category: 'ISP-Specific',       title: 'Week vs Last Week Cards',  description: '8 metrics this vs last week', implemented: true },
  { id: 'mom-cards',          category: 'ISP-Specific',       title: 'Month vs Last Month',      description: '8 metrics this vs last month', implemented: true },
  { id: 'qoq-bars',           category: 'ISP-Specific',       title: 'Quarter vs Last Quarter',  description: 'Grouped bars', implemented: true },
  { id: 'yoy-bars',           category: 'ISP-Specific',       title: 'Year vs Last Year (YoY)',  description: 'Grouped bars', implemented: true },
  { id: 'weekly-trend',       category: 'ISP-Specific',       title: 'Weekly Multi-Line Trend',  description: 'Revenue · customers · churn', implemented: true },
  { id: 'heatmap',            category: 'ISP-Specific',       title: 'Daily Payment Heatmap',    description: 'Calendar grid', implemented: true },
  { id: 'status-invoices',    category: 'ISP-Specific',       title: 'Invoices by Status',       description: 'Draft / Issued / Paid / Overdue', implemented: true },
  { id: 'install-progress',   category: 'ISP-Specific',       title: 'Installations Planned vs Done',description: 'Per-month install delivery', implemented: false },
  { id: 'coverage-progress',  category: 'ISP-Specific',       title: 'Coverage Expansion %',     description: 'Fiber deployment progress', implemented: false },
  { id: 'arpu-trend',         category: 'ISP-Specific',       title: 'ARPU Trend',               description: 'Average revenue per user', implemented: false },
]

// Default selection — what shows on first visit (no localStorage saved layout)
export const DEFAULT_SELECTION = [
  'kpi-strip', 'revenue-bar', 'sub-donut',
  'payment-area', 'customer-line',
  'ar-aging', 'monthly-revenue', 'funnel',
  'wow-cards', 'mom-cards',
  'qoq-bars', 'yoy-bars',
  'weekly-trend', 'heatmap',
  'status-workitems', 'status-tickets', 'status-invoices', 'status-subs',
]

const LS_KEY = 'gaaex.dashboard.selected.v1'

export function loadSelected(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return new Set(DEFAULT_SELECTION)
    const arr = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? arr : DEFAULT_SELECTION)
  } catch {
    return new Set(DEFAULT_SELECTION)
  }
}

export function saveSelected(ids: Set<string>): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(Array.from(ids)))
  } catch { /* swallow */ }
}

export const CATEGORIES: ChartCategory[] = [
  'Executive Overview', 'Progress Tracking', 'Schedule & Delivery',
  'Task Execution', 'Resource & Workforce', 'Financial Execution',
  'Risk Management', 'Issue Management', 'Quality & Compliance',
  'Strategic / OKR', 'Portfolio / Program', 'Operational Execution',
  'Engineering / DevOps', 'Sales / Commercial', 'Customer Execution',
  'ISP-Specific',
]
