# Voice Sweep Flag List — 2026-06-04

> Compiled by **Լոջ**, 2026-06-04.
> Source: prior-session content audit against `VOICE_GUIDE.md` §3 (tone matrix),
> §4 (vocabulary), and §6 (Armenian register).
>
> **Status: QUEUE — do NOT fix surfaces from this file.** This is the backlog
> Կյաժ / Ոսկերիչ will work from in a future content-fix sweep. Each entry
> includes a suggested rewrite so the rewrite pass is a one-shot, not a debate.
>
> Cross-reference: VOICE_GUIDE §4.4 (words we avoid), §3 (tone matrix),
> §6.1 (three Armenian registers), §6.5 (Armenian words we avoid).

---

## How to read this file

Each entry has:

- **File:line** — exact path, current line number at time of audit.
- **Current text** — verbatim copy from the production source.
- **Surface kind** — *operator chrome* (read by every operator) vs.
  *subscriber portal* (read by ISP end-customers — slightly warmer register
  per VOICE_GUIDE §6.1, but the four voice principles still hold).
- **Why off-voice** — which VOICE_GUIDE clause it violates.
- **Suggested rewrite** — locked candidate the fix pass can drop in directly.
- **Armenian native check?** — flagged when an Armenian-script edit is the
  actual change (the rest are English edits).

---

## Summary

**Total flagged: 7 spots across 5 files. 1 sample noted as a positive teach-pattern (not flagged for fix).**

- **Operator chrome:** 3 (`InvoicesView.tsx`, `i18n.ts`, `AccountsView.tsx` sample)
- **Subscriber portal:** 3 (`BillsView.tsx`, `DashboardView.tsx` × 2, `SupportView.tsx`)
- **Localization gap (whole-surface):** 1 (`frontend-portal/` has no Armenian bundle)
- **Needs Armenian native check:** 1 (entry #6 — `ադմինի` loanword)

---

## Flagged spots

### 1. `frontend-portal/src/views/BillsView.tsx:76` — "please pay" + vague consequence

| Field | Value |
|---|---|
| Surface kind | **Subscriber portal** |
| Current text | `{fmt(totalBalance)} outstanding — please pay to avoid service interruption` |
| Context | Inline warning toast inside the bills page when `totalBalance > 0` |
| Why off-voice | (1) "please" → VOICE_GUIDE §4.4 vocabulary-avoid ("noise in chrome copy"). (2) "to avoid service interruption" is a moralizing threat without a deadline — §3 destructive-confirmation tone calls for *state the consequence in concrete numbers*, not a vague warning. (3) §6.8 Armenian pair #4 already locks the right pattern in Armenian ("Մնացորդ՝ 12,400 ֏ — վճարման ենթակա է ամսվա վերջին"); the English copy hasn't been brought to parity. |
| Suggested rewrite | `{fmt(totalBalance)} outstanding — due by {dueDate}.` (drop "please"; state the deadline; let the threat be implicit. If `dueDate` isn't in scope, fall back to: `{fmt(totalBalance)} outstanding.` and let the bills table below it show per-invoice due dates.) |
| Armenian native check? | No (English string; Armenian portal localization is a separate gap — see entry #7) |

---

### 2a. `frontend-portal/src/views/DashboardView.tsx:55` — "Welcome back" warmer register

| Field | Value |
|---|---|
| Surface kind | **Subscriber portal** |
| Current text | `Welcome back, {summary.customer.name ?? summary.customer.email}` |
| Context | Sub-heading directly below the page H2 "Dashboard" on first paint |
| Why off-voice | "Welcome back" is the marketing-warmth register (Mailchimp playbook), not GAAhex's *plainspoken/steady*. §3 login/first-run row sets the bar: "Welcoming but not warm. Honest about what's about to happen." This is the post-login dashboard, so it's even further from a place where warm greeting earns its keep — the operator (subscriber) is here to **do** something, not be greeted. **Subscriber portal nuance (§6.1):** slightly warmer than operator chrome is allowed, but "Welcome back" specifically is on the §4.4 *marketing register* boundary; the rewrite preserves the greeting affordance without the marketing tone. |
| Suggested rewrite | `Signed in as {summary.customer.name ?? summary.customer.email}` (factual, names the actor, no marketing warmth). Alternative if Gev wants more warmth retained: `{summary.customer.name ?? summary.customer.email}` rendered as a plain subtitle (no verb). |
| Armenian native check? | No |

---

### 2b. `frontend-portal/src/views/DashboardView.tsx:65` — "All clear" cobalt-positive

| Field | Value |
|---|---|
| Surface kind | **Subscriber portal** |
| Current text | `subLabel={summary.balance_due_luma > 0 ? 'Payment required' : 'All clear'}` |
| Context | KPI sub-label under "Balance due"; rendered when `balance_due_luma === 0` |
| Why off-voice | "All clear" is performed positivity for an *operational* state (no debt). §3 default-operations row says: "Neutral, terse, present." §7 honesty-floor rule 1 says: "No performed feelings." Per D17 / D18 (Color Families), "ok" states are **slate**, never gold/celebratory — and the copy should match: a balance of zero is a fact, not a victory. |
| Suggested rewrite | `subLabel={summary.balance_due_luma > 0 ? 'Payment required' : 'No balance due'}` (parallel-structure with the warning branch; both branches are factual labels). |
| Armenian native check? | No |

---

### 3. `frontend-portal/src/views/SupportView.tsx:243` — "we'll" + "shortly"

| Field | Value |
|---|---|
| Surface kind | **Subscriber portal** |
| Current text | `Open a support ticket and we'll get back to you shortly.` |
| Context | Empty-state message inside the support tickets table when the subscriber has no tickets |
| Why off-voice | (1) "we'll" → VOICE_GUIDE §4.2 ("Avoid 'we' in chrome copy — there is no 'we' speaking"). (2) "shortly" → vague-promise vocabulary, fuzzy SLA commitment with no number behind it. §3 empty-state row sets the tone: "Patient and instructive." This copy is neither patient (it's promissory) nor instructive (it doesn't tell the subscriber what to do or what happens after). |
| Suggested rewrite | `Open a ticket and our support team will respond within {sla} business hours.` (names the responder, names the response window). If SLA isn't known at this layer: `Open a ticket to start a support conversation. Replies arrive in the same view.` (instructive, no "we", no "shortly"). |
| Armenian native check? | No |

---

### 4. `frontend/src/views/InvoicesView.tsx:84` — passive past-tense success toast

| Field | Value |
|---|---|
| Surface kind | **Operator chrome** |
| Current text | `toast.success('Payment page opened in a new tab.')` |
| Context | Toast fired after `initiatePayment` returns a non-dev `redirect_url` and `window.open` is called |
| Why off-voice | This isn't *wrong* — it's slightly off-register. §3 success-toast row: "Quiet confirmation, factual." §5.2 pairs are all imperative-past ("Customer created.", "Saved.") or future-tense state changes ("Subscription suspended."). "Payment page opened in a new tab." is grammatically a passive-construction success that names the side effect (the *tab opening*) rather than the *operator's action* (initiating the payment). Compare to the locked production-harvested pair #8: "Sweep complete — 14 advanced, 2 cured, 0 errors." → states the operator-meaningful outcome, not the system side-effect. |
| Suggested rewrite | `toast.success('Payment initiated — continue in the new tab.')` (names the operator action + the next step in one line). Alternative if the literal "new tab" hint must stay: `toast.success('Payment opened in a new tab.')` (drops "page", reads cleaner). |
| Armenian native check? | No |

---

### 5. `frontend/src/views/AccountsView.tsx:149` — POSITIVE SAMPLE (not flagged)

| Field | Value |
|---|---|
| Surface kind | **Operator chrome** |
| Current text | `toast.info(t('accounts.balanceUnavailable', 'Account balance API unavailable — falling back to basic listing'))` |
| Why this is locked-in | This is a *teach pattern* — keep as the reference exemplar for "feature degraded" toasts. (1) Names the failed dependency ("Account balance API"). (2) States what the system did about it ("falling back to basic listing"). (3) No "we", no "please", no apology, no "oops". (4) Em-dash pattern matches §6.7 punctuation rule ("used the same way as in English to separate clauses or attach a cause to a consequence"). Future error/degradation toasts should be patterned after this exact shape. |
| Action | **None.** Cite this in §5.7 of VOICE_GUIDE on the next sweep as a 11th production-harvested DO pair. |

---

### 6. `frontend/src/lib/i18n.ts:158` — `ադմինի` loanword, needs native check

| Field | Value |
|---|---|
| Surface kind | **Operator chrome** (`hy` bundle, no-access page) |
| Current text | `'noaccess.msg': 'Դուք թույլտվություն չունեք դիտելու այս ռեսուրսը։ Կապվեք ձեր ադմինի հետ, եթե անհրաժեշտ է մուտք։'` |
| Why off-voice | "Ադմինի" is the genitive of "ադմին" — a romanized loanword (admin → ադմին) embedded in an Armenian sentence. VOICE_GUIDE §6.5 forbids *"Latin-script transliterations of native Armenian words"* — but here the situation is the inverse: an English admin-jargon term has been *Armenian-script transliterated* rather than translated. There are two acceptable native paths: (a) translate to a real Armenian word ("ադմինիստրատոր" — full borrowing; or "կազմակերպության պատասխանատու" — descriptive). (b) keep the English in Latin script with an Armenian suffix per §6.7 hyphen rule ("Կապվեք ձեր admin-ի հետ"). The current spelling is a half-translation — exactly the failure mode §6.5 calls out as forbidden in customer-facing surfaces. **However:** this is the *operator* chrome bundle, and operator-Armenian explicitly permits code-switching for technical terms (§6.2). The question is whether "admin" is technical-enough to stay Latin. Native speaker call needed. |
| Suggested rewrite (provisional) | Option A (technical-term Latin, §6.2 path): `'Դուք թույլտվություն չունեք դիտելու այս ռեսուրսը։ Կապվեք ձեր admin-ի հետ, եթե անհրաժեշտ է մուտք։'` (Latin "admin" + locative suffix `-ի` via hyphen per §6.7 mandatory rule). Option B (full Armenian, §6.5 path): `'Դուք թույլտվություն չունեք դիտելու այս ռեսուրսը։ Կապվեք ձեր ադմինիստրատորի հետ, եթե անհրաժեշտ է մուտք։'` (uses the established Armenian loan-cognate). |
| **Armenian native check?** | **Yes — required.** Gev (Yerevan-native, daily-Armenian) picks A vs B. Default if no input: **Option A** (consistent with how `i18n.ts` already handles OLT/PE/RADIUS — Latin term, Armenian hyphenated suffix). |

---

### 7. `frontend-portal/` — subscriber portal has no Armenian localization at all

| Field | Value |
|---|---|
| Surface kind | **Subscriber portal** (whole-surface gap) |
| Current state | `frontend/src/lib/i18n.ts` exists with a full `hy` bundle for the operator UI. `frontend-portal/src/lib/i18n*` **does not exist** — confirmed by glob. Every visible string in BillsView, DashboardView, SupportView, etc., is hardcoded English. |
| Why this is a voice problem | GAAhex M1 ships to an Armenian ISP (locked per `portal-m1-strategy.md`). The subscriber portal *is* the surface end-customers see — and that audience is overwhelmingly Armenian-monolingual or Armenian-preferred. VOICE_GUIDE §6.1 explicitly classifies the subscriber portal as the **Դուք register** surface ("Polite, impersonal-passive when blame is involved, no exclamation marks, no apologies"). Right now there is no register at all — there's only English. |
| Suggested rewrite | **Not a single-line fix.** This is a structural follow-up — *create* `frontend-portal/src/lib/i18n.ts` with the same `t()` shape as the operator one, populate the `hy` bundle (subscriber-Դուք register, per §6.1 row 2), and wire each portal view through it. Probably its own multi-pass sweep. **Recommend:** Կյաժ + Ոսկերիչ joint pass, blocked on Gev native-check sign-off on entry #6 first (so the loanword discipline is settled before a whole new bundle is authored under it). |
| Armenian native check? | Eventually yes — the *entire* portal bundle will need a native review pass once drafted. |

---

## Notes for the future fix-sweep agent

1. **Order of operations:** Do entry #6 (native check) first — once that's locked, it sets the loanword precedent that #7 (whole portal bundle) inherits.
2. **Cite #5** (`AccountsView.tsx:149`) as a 11th DO pair in VOICE_GUIDE §5.7 during this sweep — it earns a teaching slot.
3. **Don't touch `DashboardView.tsx`** on the operator side (the brief locked Կյաժ as owner of `frontend/src/views/DashboardView.tsx`); entry #2 is the **portal** dashboard (`frontend-portal/src/views/DashboardView.tsx`) which is in scope.
4. **None of these are alarms** — all 7 are content/voice issues, not bugs. The product behaves correctly; only the language is off.

---

End of flag list. Compiled by Լոջ.
