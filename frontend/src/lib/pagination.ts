// Pagination limits — single source of truth for all API fetch caps in the frontend.
// Every magic ?limit=N in a fetch URL should reference one of these constants.
// Grouped by rationale so the intent is clear when the value needs tuning.

/** Homepage/dashboard widget bands — small enough to render fast, big enough to show all
 *  of one user's active items without cursor pagination. */
export const WIDGET_ITEMS     = 100  // workitems, helpdesk tickets, schedule slots
export const WIDGET_APPROVALS =  50  // mandatory-approvals (PENDING only — much smaller set)

/** Board and operational views — need enough items to fill all columns without a next-page
 *  cursor, but are bounded by the team's daily workload, not the whole dataset. */
export const DISPATCH_BOARD    = 200  // DispatchBoardView workitem columns
export const NETWORK_SITES     = 200  // NMS "Network Topology" widget — site/POP nodes
export const COVERAGE_CHECKS   = 200  // CoverageView checks
export const CUSTOMER_TICKETS  = 200  // CustomerView SLA ticket band (client-filtered)

/** Calendar — fetches the full visible month window; all events in the date range. */
export const CALENDAR_EVENTS = 500

/** Customer entity tabs — contacts, sites, contracts per customer. Bounded per-customer. */
export const ENTITY_RECORDS  = 500

/** Analytics bulk fetch — leads/opportunities/deals/customers fetched in full for
 *  client-side chart aggregation (pipeline funnel, revenue breakdown, etc.). */
export const DASHBOARD_BULK = 1000

/** Pareto / ranked chart top-N result cap. */
export const PARETO_TOP_N = 8
