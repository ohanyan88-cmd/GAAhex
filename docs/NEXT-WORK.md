# GAAhex — Next-work queue

Parked items to pick up later (logged 2026-06-06, Gev's call).

## 1. Richer demo data
Fill the graceful-but-empty pages so the demo is fully alive:
- Move a few orders into the **provisioning** stage → Installation Board + Provisioning populate.
- Run the **dunning sweep** on the 4 overdue invoices → Collections shows active cases.
- Assign a few **tickets / work-orders to Demo Admin** → My Day "My Open Tickets" + "Open Work Orders" widgets show data (or make the owner widgets show ALL, not just assigned).
- (Optional) seed Campaigns, Customer Tasks if those pages are demo-targets.

## 2. Deploy prep — HouseNet on-prem
The big milestone. Server `gevorg@ghex` (Ubuntu 22.04, Docker installed).
- Clean export / clone the repo on the server (git creds already there).
- `backend/.env` provisioned with REAL strong secrets (NOT admin123; GAAHEX_FIELD_KEY set once + backed up — irrecoverable if lost).
- `ENVIRONMENT=production` (prod deploy contract: distinct `gaahex` / `gaahex_app` roles enforces RLS).
- `docker compose up`, `alembic upgrade head`, verify health.
- Demo-first: keep it private until ready to show HouseNet.

## 3. Token long-tail (low value)
The remaining D20 debt the deep audit flagged — deliberate, not rushed:
- Chart-height tokens (`--gx-chart-h-*`) + a chart/heatmap palette token set (DashboardView).
- `letterSpacing` / `lineHeight` inline literals → `--gx-tracking-*` / `--gx-leading-*` (imprecise mapping — needs an eye, changes typography subtly).
- Centralize duration/debounce/poll/dismiss magic numbers into a config constant.
- Auth/login brand-gradient hexes → minted gradient tokens.
Full inventory: `docs/audit/GAAhex-CODEBASE-DEEP-AUDIT-2026-06-06.md`.

## Lead form — full ISP field set (Gev's spec, 2026-06-07)
The lead entity currently has 18 config fields (segment/Type, name, patronymic, DOB, phone,
secondary_phone, whatsapp, telegram, email, region, city, address, document_type/number,
source, priority, notes, status). Gev's full 10-section ISP capture form still to add — all
config-driven (add to `seed.py build_crm_entities` lead fields + re-provision; no custom
component). Approach: extract a `_LEAD_FIELDS` module constant (single source of truth) so the
re-provision script can import it, and make `test_export` header-robust (assert trailing
Status/ID/Created At/Created By + key columns, not the full exact list — it changes too often).

Sections / fields to add (those NOT already present):
1. Identity: company_name, tax_id/reg-number. (Kept single `name`=Full Name rather than
   splitting First/Last — table + seed use it; revisit if Gev wants the split.)
2. Contact: preferred_communication (Call/SMS/WhatsApp/Email), preferred_language (Armenian/
   Russian/English).
3. Service Address: settlement, street, building, apartment, gps_coordinates, landmark,
   coverage_status (Covered / Expansion Required / Not Serviceable).
4. Service Info: service_type (Internet/TV/VoIP/Bundle), package (50/100/300 Mbps),
   contract_term (Monthly/12/24), monthly_fee, installation_fee, equipment_deposit (money).
5. Sales: update `source` options → D2D/Facebook/Website/Referral/Call Center/Shop/Corporate;
   add sales_channel, sales_representative, campaign, referral_customer.
6. Installation: installation_status (Not Scheduled/Scheduled/Completed/Failed),
   preferred_installation_date, dispatcher, assigned_team, installation_notes.
7. Technical: olt, pon_port, splitter, onu_serial, router_mac, ip_assignment, vlan,
   activation_date.
8. Billing: billing_account_number, billing_start_date, payment_method (Cash/Card/Bank/Auto
   Pay), billing_cycle, invoice_delivery_method.
9. Retention/Risk: competitor_previously_used, cancellation_risk, customer_segment
   (Residential/SME/Enterprise), vip_flag (boolean).
10. Internal Notes: special_instructions, access_instructions (general notes = existing `notes`).

⚠️ Honest note for Gev: sections 6–8 (Installation / Technical / Billing) are POST-conversion
service/customer data per Standard 11 (lead → customer after activation), so they'll sit empty
at lead-capture. Added on the lead form as requested — but they may belong on the Customer /
Service / Installation records. Confirm before/after wiring.

## Nice calendar (custom DatePicker)
`date` fields currently render the browser-native `<input type="date">` picker (looks different
per browser, not on-brand). Build a custom token-styled DatePicker component (cf. the reference
LeadsPage `DatePicker`) and route `f.type === 'date'` / `'datetime'` through it in FieldInput.
