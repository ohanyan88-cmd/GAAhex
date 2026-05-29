# B35 / B36 / B37 — Customer Portal Features — SELF-CONTAINED BUILD BRIEF

**For the same second Claude account, AFTER B34 is built.** These three build directly on the B34
foundation (`docs/specs/PORTAL-B34-BRIEF.md`). Build them in ORDER (B35 → B36 → B37) in the same repo
folder. When all done (incl. B34), the repo owner hands the folder to the coordinator for a
security-first review + merge into `main`.

## Prerequisite & the pattern you repeat (read once)

B34 must be built first and its security tests green. From B34 you have:
- `CustomerUser` model + `current_customer` dependency (decodes the portal token, rejects staff
  tokens, loads the CustomerUser, sets the tenant RLS GUC). **Every endpoint below depends on it.**
- The `/portal/*` namespace + the `frontend-portal/` app + brand tokens.
- The customer is a `record` row (`entity_key="customer"`); `current_customer.customer_id` is that
  record's id. Billing/helpdesk/service/usage rows link to it via their `customer_id` FK.

**THE INVARIANT, repeated in every feature (and tested every time):** a customer sees and touches
ONLY rows where `customer_id == current_customer.customer_id`. Every query is filtered by it; every
by-id fetch 404s if the row isn't theirs; every create forces `customer_id = current_customer.customer_id`
(never trust a client-supplied customer id). No portal endpoint may expose staff-only fields or actions.

**Reuse, don't reinvent:** the staff modules already hold the logic — read them and call/replicate the
read paths, scoped. Money is integer **luma** (AMD minor units; ÷100 for ֏). Zero emoji, inline SVG.
Keep changes additive; don't break staff routes/tests. No "Co-Authored-By" trailer.

Run `AI_PROVIDER=none AI_API_KEY= .venv/Scripts/python.exe -m pytest -q` from `backend/` after each
feature; keep it green. `frontend-portal` must `tsc`/build clean.

---

# B35 — Pay bills (portal billing self-service)

Customers view their invoices, balances, and pay online via the B33 gateway. Study
`backend/app/routers/billing.py` (invoice/payment read + `_invoice()` serializer with paid_total/
balance), `backend/app/routers/documents.py` (invoice HTML + receipt), and `backend/app/payment_gateway.py`
+ `backend/app/routers/payment_gateway.py` (initiate/settle — REUSE these).

### Backend — `backend/app/routers/portal_billing.py` (prefix `/portal`, dep `current_customer`)
- `GET /portal/me/invoices` → the customer's invoices (scoped), each with total/paid_total/balance/
  status — reuse billing's serializer logic.
- `GET /portal/me/invoices/{id}` → own invoice detail (404 if not theirs).
- `GET /portal/me/invoices/{id}/document` → own invoice branded HTML (reuse documents.py helpers,
  scoped ownership check).
- `POST /portal/me/invoices/{id}/pay` → verify the invoice is theirs + ISSUED/OVERDUE, then create a
  `PaymentOrder` and call `get_gateway().initiate(...)` exactly like the staff `/api/invoices/{id}/pay`
  does — return `{order_id, redirect_url, status}`. (The settle path — confirm-dev / provider
  callback — is already built in B33 and is shared; the customer just initiates.)
- `GET /portal/me/payments` and `GET /portal/me/payments/{id}/receipt` → own payment history +
  branded receipt HTML (reuse documents.py receipt, scoped).

### Frontend — `frontend-portal/` "Bills" view
List invoices (status pill, amount ֏, balance), a clear **Balance due** summary, **Pay now** on
ISSUED/OVERDUE (→ initiate → if dev redirect contains `/pay/dev/`, an in-portal confirm; else open the
provider URL), download invoice + receipt (authed-blob open). Wire "Bills" into the portal nav.

### Tests — `backend/tests/test_portal_billing.py`
Own-invoices list scoped; customer A cannot GET customer B's invoice/document (404/403); pay own
ISSUED invoice → order created; cannot pay another customer's invoice; receipt only for own payment.

---

# B36 — Open & track tickets (portal support self-service)

Customers open support tickets, track status, and reply. They CANNOT assign, set SLA, change queue,
or resolve (staff-only). Study `backend/app/routers/helpdesk.py` + `models/helpdesk.py` (HelpdeskTicket;
note `customer_id`) and `models/interaction.py` / `routers/interactions.py` (ticket replies are
Interactions linked to the ticket).

### Backend — `backend/app/routers/portal_support.py` (prefix `/portal`, dep `current_customer`)
- `GET /portal/me/tickets` → own tickets (scoped by customer_id), with status/priority/subject/created.
- `POST /portal/me/tickets` {subject, body, priority?} → create a HelpdeskTicket with
  `customer_id = current_customer.customer_id` (FORCED), status OPEN. (No queue/assignee from the
  customer.) Emit workflow + notify staff (reuse helpdesk's notify path).
- `GET /portal/me/tickets/{id}` → own ticket detail + its reply thread (404 if not theirs). Expose
  only customer-safe fields (subject, body, status, priority, created, replies) — NOT internal
  assignee/SLA internals unless you choose to show status only.
- `POST /portal/me/tickets/{id}/reply` {body} → add a customer-side Interaction/message on the ticket
  (direction "inbound"), notify staff. Only on own ticket.

### Frontend — `frontend-portal/` "Support" view
List own tickets + status, "New ticket" form, ticket detail with the reply thread + a reply box.
No staff controls. Wire "Support" into the portal nav.

### Tests — `backend/tests/test_portal_support.py`
Create ticket → forced customer_id, appears in own list; cannot see another customer's ticket;
reply on own ticket works; a customer CANNOT call staff helpdesk actions (assign/resolve) — those
require a staff token (portal token → 401/403).

---

# B37 — See service & usage (portal service self-service)

Customers view their active services/subscriptions and usage, and can request a change. Study
`backend/app/routers/services.py` + `models/service.py` (Service, customer_id), `models/billing.py`
(Subscription), `routers/usage.py` + `models/usage.py` (UsageRecord), and `models/workitem.py` /
`routers/workitems.py` (a "request change" can file a WorkItem for staff).

### Backend — `backend/app/routers/portal_service.py` (prefix `/portal`, dep `current_customer`)
- `GET /portal/me/services` → own services (scoped), with status + plan/product name.
- `GET /portal/me/subscriptions` → own subscriptions (scoped) with plan + status + price ֏.
- `GET /portal/me/usage?from=&to=` → own usage records / metered totals (scoped). Read-only.
- `POST /portal/me/service-requests` {service_id?, message} → file a **WorkItem** (kind "task" or a
  "service_request" kind) assigned to no one, `customer_id` set, titled from the message — so staff
  pick it up in the WorkItems board. (Reuse the WorkItem create path; customer cannot self-provision.)

### Frontend — `frontend-portal/` "Service" view
Cards for active services/subscriptions (status, plan, price), a usage summary (numbers or a simple
SVG bar — reuse the staff chart style), and a "Request a change" form (→ service-requests). Wire
"Service" into the portal nav. With this, the portal nav is complete: Dashboard · Bills · Support · Service.

### Tests — `backend/tests/test_portal_service.py`
Own services/subscriptions/usage scoped; cross-customer denial on each; `service-requests` creates a
WorkItem with the right customer_id that a staff token can then see in `/api/workitems`.

---

## Deliverables to the coordinator (for the whole B34-B37 bundle)

- Folder path + a list of every file created/edited (backend routers/tests + the `frontend-portal/` app).
- Migration revision(s) and that they chain cleanly (B34's chains from `b4f2c9d3e1a7`).
- Demo portal creds; how tenant is resolved at login.
- `pytest -q` green (all new portal tests + no staff regressions); `frontend-portal` tsc/build clean.
- A SECURITY summary confirming, for EACH of B34-B37, that: (1) cross-customer access is denied,
  (2) the portal/staff token boundary holds both ways, (3) creates force the authenticated customer_id,
  (4) customers cannot invoke staff-only actions. These are the things the coordinator reviews first.
