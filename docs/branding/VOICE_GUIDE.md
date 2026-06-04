# GAAhex Voice Guide — Ոսկերիչ, 2026-06-04

> Starter voice doc by Ոսկերիչ; §5.7 (10 production-harvested pairs) and
> §6 (Armenian register) added by Լոջ, 2026-06-04.
>
> Foundations: Mailchimp Content Style Guide structure, but the register is
> different — see `_research/03-mailchimp-voice.md` for the adaptations.
> Honesty floor from `.md` is non-negotiable.

---

## 1. Voice vs. tone

**Voice** stays the same across every surface. **Tone** changes based on the
operator's situation. Mailchimp's formulation, adopted verbatim: *"You have
the same voice all the time, but your tone changes."*

GAAhex's voice is **operator-grade, honest, calm.** Always.
GAAhex's tone shifts between **quiet confirmation**, **steady warning**,
**terse alarm**, **patient instruction**, depending on what the operator is
doing and what the system is reporting.

---

## 2. Voice principles (4 — locked)

### 2.1 Plainspoken
We say what's true. We don't reach for marketing register inside the product.
We don't write copy that exists to sound nice — we write copy that helps the
operator do the next thing.

- **Do:** "Subscription cancelled. The customer will be charged through their next cycle."
- **Don't:** "We're so sorry to see you go! Your subscription has been cancelled."

### 2.2 Genuine
The operator is an expert. We treat them like one. Warm without sweetening.
Honest without being cold.

- **Do:** "OLT didn't respond. Retry, or check the device's mgmt VLAN."
- **Don't:** "Oops! Something went wrong. Please try again."

### 2.3 Translator
GAAhex deals in technical concepts that have specific meanings (PPPoE, RADIUS,
ONU, VLAN, MRR). The UI defines them briefly the first time they appear in a
flow and trusts the operator after.

- **Do:** "RADIUS shared secret — the pre-shared key your NAS uses to authenticate to FreeRADIUS."
- **Don't:** Either "Enter shared secret" (cryptic) or "The RADIUS shared secret is a cryptographic value used to ensure secure communication between..." (over-explaining).

### 2.4 Steady
Calm under load. The platform speaks the same way when everything is fine and
when a transit link just dropped. No panic, no exclamation points, no jokes
during incidents.

- **Do:** "Tunnel down — 187 services affected. Last seen 14:32."
- **Don't:** "Yikes! It looks like there's an issue with the tunnel..."

Note that this is where GAAhex's voice diverges from Mailchimp's. Mailchimp's
fourth principle is "dry humor." Ours is "steady." Humor in chrome copy is a
liability when the operator is mid-incident.

---

## 3. Tone matrix

| Surface | Tone | Example |
|---|---|---|
| **Default operations** (lists, details) | Neutral, terse, present | "Active customers · 4,231" |
| **Successful action toast** | Quiet confirmation, factual | "Customer suspended. Subscription stays active until 2026-06-15." |
| **Inline success** | One-line, factual | "Saved." |
| **Warning toast** | Direct, specific. What happened + what to do | "OLT 03 unreachable for 4 minutes. Retry, or check management VLAN 100." |
| **Critical alarm** | Terse. State the severity. Don't soften | "Critical · ring topology broken at PE-2 · 1,847 services down" |
| **Empty state** | Patient and instructive | "No tariff plans yet. Create one to start subscribing customers." |
| **Filtered empty state** | Distinguish from "no data" | "No customers match these filters. Clear filters to see all 4,231." |
| **Validation error** | Specific. State the field/cause. Don't blame the user | "Email format invalid — needs an @ and a domain." |
| **Server error** | Specific to the operation. Acknowledge what we don't know | "Couldn't save — server rejected the request. Try again, or check the audit log." |
| **Studio / config** | Light teaching register | "Add at least one status to enable this workflow." |
| **Login / first-run** | Welcoming but not warm. Honest about what's about to happen | "Sign in to your tenant. If you don't have one yet, you'll set it up in three steps." |
| **Destructive confirmation** | Specific. State the consequence. Use the destructive verb | "Delete this tariff plan? Three subscriptions use it — they'll need to be reassigned first." |
| **Subtitle / section description** | Explanatory, not promotional | "Customer accounts and balances" (not "Manage your customer relationships powerfully") |

---

## 4. Naming, casing, vocabulary

### 4.1 Naming
- **Brand:** **GAAhex**. One word. Always. Capital G-A-A, lowercase h-e-x. The GAA carries the family meaning; the capitalization is load-bearing.
- **Forbidden spellings:** Gaahex, GAAHex, gaahex, GAA·Hex, GAA-hex.
- **No "GAAhex app" or "the GAAhex platform"** in chrome copy. Just **GAAhex**. The product is the brand.

### 4.2 Casing
- **Sentence case** for everything user-facing: buttons, menu items, labels, headings, toasts.
  - **Do:** "New entity"
  - **Don't:** "New Entity"
- **UPPERCASE** only for status enum keys (`OPEN`, `IN_PROGRESS`, `RESOLVED`), table micro-labels, and eyebrows/overlines.
- **snake_case** for entity keys (data-layer).
- **kebab-case** for URL slugs.
- **camelCase** for wire fields (per `portal-spec-decisions-2026-06-02.md`).
- **My** for the operator's own scope: "My Tasks," "My Approvals," "My Saved Views."
- Avoid **"we"** in chrome copy — there is no "we" speaking; there's the platform reporting and the operator doing.
- Avoid **"please"** — it's noise.

### 4.3 Vocabulary — words we use

| Use | Reason |
|---|---|
| customer | the ISP's subscriber |
| subscription | the ongoing service relationship |
| tariff plan | the rate/quota construct (not "package," "pricing tier") |
| ONU / ONT | always the canonical telecom abbreviation, not "endpoint" or "device" |
| OLT | always — not "head-end" |
| outage | when service is down |
| degraded | when service is partial |
| online / offline | binary state (slate text in default, semantic only when severity matters) |

### 4.4 Vocabulary — words we avoid

| Avoid | Reason |
|---|---|
| "powerful" | empty marketing word |
| "seamless" | empty marketing word |
| "delight" | not the register |
| "magical" | not the register |
| "leverage" (verb) | corporate filler |
| "robust" | empty filler |
| "user" (when "operator" or "customer" is more accurate) | be specific |
| "please" | noise in chrome copy |
| "oops" / "uh oh" | violates the steady principle |
| "sorry" (in chrome) | apologies belong in human comms, not system copy |
| "amazing" / "great" / "awesome" | empty enthusiasm |
| exclamation points | violates steady |
| ALL CAPS for emphasis | reserved for enum keys |

---

## 5. Do / don't pairs (starter set + production-harvested)

### 5.1 Empty states

| Do | Don't |
|---|---|
| "No customers yet. Add one to start." | "Looks like there are no customers here! 🎉" |
| "No invoices match these filters. Clear filters to see all 1,204." | "We couldn't find anything matching your search criteria." |
| "No comments recorded yet. Comments on this account will appear here." | "Be the first to comment!" |

### 5.2 Success states

| Do | Don't |
|---|---|
| "Customer created." | "Awesome! Your customer was created successfully! 🎉" |
| "Saved." | "Your changes have been saved successfully!" |
| "Subscription suspended. Resume in account detail." | "Got it — we've suspended this subscription for you." |

### 5.3 Errors

| Do | Don't |
|---|---|
| "Email format invalid — needs an @ and a domain." | "Please enter a valid email address." |
| "OLT didn't respond. Retry, or check the device's mgmt VLAN." | "Oops! Something went wrong. Please try again." |
| "Tariff plan in use by 3 subscriptions — reassign before deleting." | "This action cannot be completed at this time." |

### 5.4 Warnings + alarms

| Do | Don't |
|---|---|
| "Tunnel down — 187 services affected. Last seen 14:32." | "Heads up! There might be an issue with the tunnel..." |
| "Critical · ring topology broken at PE-2 · 1,847 services down" | "🚨 EMERGENCY ALERT 🚨" |
| "Subscription past due — last payment failed 2026-05-30" | "Watch out! This subscription is in trouble." |

### 5.5 Confirmations

| Do | Don't |
|---|---|
| "Delete this tariff plan? Three subscriptions use it — they'll need to be reassigned first." | "Are you sure you want to delete? This cannot be undone!" |
| "Suspend 14 subscriptions? They'll stop billing immediately and resume on reactivate." | "This will affect 14 records. Continue?" |

### 5.6 Instructional / Studio

| Do | Don't |
|---|---|
| "Add at least one status to enable this workflow." | "You must configure statuses before you can use workflows." |
| "Optional. Add statuses to enable a workflow." | "Statuses (optional)" |
| "Pick the field this column shows." | "Please select a field." |

### 5.7 Production-harvested pairs (10 — Լոջ, 2026-06-04)

Mined from `frontend/src/views/**`, `frontend-portal/src/views/**`, and `frontend/src/lib/i18n.ts`. The DO column is the locked voice as it exists in production today; the DON'T is the natural-but-wrong phrasing a future agent might write if they weren't reading this doc.

| # | Do | Don't | Why |
|---|---|---|-----|
| 1 | "No accounts under dunning. The sweep runs nightly; manual sweep available above." (`CollectionsView.tsx` empty state) | "Great news — no overdue accounts!" | State-of-the-world plus the next operator move. No celebration of an operational state — dunning emptiness might mean "no debt" OR "sweep hasn't run yet"; the copy tells the operator both possibilities exist. |
| 2 | "Nothing in provisioning. No orders are currently in the provisioning stage." (`InstallationBoardView.tsx`) | "All caught up! No installations pending." | Two-line empty state: title = state-of-the-world, message = the precise scope of "nothing." "All caught up" implies a finish line that provisioning doesn't have. |
| 3 | "Dunning endpoints not yet available. The collections API will appear here once Phase B.2 ships in this tenant." (`CollectionsView.tsx`) | "This feature is coming soon!" | When the feature isn't shipped to this tenant, say so by name. The operator might be reading the release notes — connect the empty state to the milestone. |
| 4 | "Run feasibility checks against customer addresses to populate coverage data." (`CoverageView.tsx` empty) | "No data available." | Empty-state message is an instruction: what action populates this surface. "No data available" tells the operator nothing they didn't already see. |
| 5 | "Active dunning cases — 12. Click to filter." (KPITile ariaLabel, `CollectionsView.tsx`) | "12 active dunning cases that need your attention" | Screen-reader label: value first, action second. No padding words ("that need your attention"). The number is the news; the click hint is the affordance. |
| 6 | "Cancel order ORD-1042? This cannot be undone." (`OrdersView.tsx`) | "Are you sure you want to cancel this order?" | Destructive confirmation: state the verb + the specific identifier + the irreversibility. "Are you sure" is noise — the click WAS the sure. |
| 7 | "Admin permission required to run sweep." (`CollectionsView.tsx`, 403 handler) | "You don't have permission to do that. Please contact your administrator." | Permission error: state which role is needed and which action it gates. The operator now knows who to ask and what for, in one line. No "please." |
| 8 | "Sweep complete — 14 advanced, 2 cured, 0 errors." (`CollectionsView.tsx` toast) | "Sweep completed successfully! 🎉" | Success toast: state the result in counts. Cured/advanced/errors are load-bearing for the dunning operator. A bare "Sweep completed" hides that information. |
| 9 | "It may have been moved, renamed, or deleted." (`NotFound` component default message) | "404 — Page not found." | 404 page: state the three real possibilities, in order of decreasing likelihood. The operator now knows what to check (an audit log entry, a recent rename, a teammate's delete) instead of just "the URL is broken." |
| 10 | "Failed to load summary" + the underlying error message (`frontend-portal DashboardView.tsx` error banner) | "Oops, something went wrong loading your dashboard!" | Error banner: name the operation that failed (load summary), then surface the cause verbatim. The operator-grade audience wants the raw error, not a polished apology. |

---

## 6. Armenian register (Լոջ, 2026-06-04)

GAAhex M1 ships to an Armenian ISP. The platform speaks Armenian on most subscriber-facing surfaces, on many operator surfaces, and (off-product) in the chat between Gev and the orchestrator. The four voice principles transfer directly — **plainspoken, genuine, translator, steady** — but the register and idiom need a native pass.

The Armenian dictionary is already locked in `frontend/src/lib/i18n.ts` (`hy` bundle). This section codifies the register choices that bundle was authored with, so future strings stay consistent.

### 6.1 Three registers — when each one is allowed

GAAhex's Armenian splits into three registers. The register is determined by **the surface**, not by the writer's mood.

| Register | Where it lives | Address form | Tone | Example |
|---|---|---|---|---|
| **Casual personal** (Ընգեր / ախպեր register) | Off-product only — Gev ↔ orchestrator chat, internal team channels, oral conversations | **դու** (informal) | Warm, direct, mixed-with-English freely | "Ընգեր, էդ migration-ը գցեմ՞" |
| **Customer-facing** (formal but warm) | Subscriber portal (`frontend-portal/`), email/SMS notifications, dunning letters, support replies | **Դուք** (formal-respect) | Polite, impersonal-passive when blame is involved, no exclamation marks, no apologies | "Դուք իրավունք չունեք դիտելու այս ռեսուրսը։" |
| **Technical / operator chrome** (mixed-with-English) | Operator views (`frontend/`), Studio, NOC dashboard, admin panels | **Դուք** (formal) but often subject-less / impersonal | Terse, technical English acronyms kept inline, sentence-case Armenian labels | "Կարդալու ռեժիմ — կարող եք դիտել, բայց ոչ փոփոխել գրառումները։" |

**Hard rule:** never mix registers inside one surface. The subscriber portal is uniformly **Դուք**. The Gev chat is uniformly **դու**. The operator chrome is uniformly **Դուք** — even though Gev personally uses դու, the chrome is read by *every* operator at the ISP, including ones who don't know him.

### 6.2 When NOT to write Armenian

These stay English, always, regardless of the surface's display language:

- **Code identifiers** — variable names, function names, class names, file names, folder names, env vars, JSON keys, snake_case fields, camelCase wire fields.
- **File paths and URLs** — `backend/app/services/dunning.py`, `/api/customers`, `gaahex.com/billing`.
- **Commit messages** — English. Always. No exceptions.
- **Error stack traces, log lines, audit-event payloads** — the system speaks one language to itself: English.
- **API responses (wire format)** — JSON keys and enum values stay `UPPER_SNAKE_CASE` English. Localization happens at the render layer.
- **Technical acronyms in any Armenian sentence** — PPPoE, RADIUS, ONU, OLT, VLAN, BNG, GPON, MRR, AR, IPAM, SLA, CSV, XLSX, PDF, Slack, Webhook. These stay Latin-script, even when wrapped in Armenian copy. Example from `i18n.ts`: `'analytics.mrr': 'MRR'`, `'analytics.arOutstanding': 'AR մնացորդ'`.
- **Brand names** — GAAhex, Huawei, ZTE, Nokia, Calix, Stripe, SendGrid, Twilio, FreeRADIUS.
- **Status enum keys** — `OPEN`, `IN_PROGRESS`, `RESOLVED`, `PAID`, `OVERDUE`. The label is translated; the key is not.

If a future Armenian translation would lose precision (e.g., trying to translate "VLAN tag"), keep the English. Operator-Armenian explicitly permits code-switching for technical terms — it's how Armenian engineers actually talk.

### 6.3 Brand transliteration — LOCKED

**The brand mark stays "GAAhex" inside Armenian sentences. We do not transliterate to "Գահեքս" or "Գահէքս" or any other Armenian-script form.**

Reasons:
1. The capitalization is load-bearing (G+A+A = the family) and the Armenian alphabet has no native uppercase/lowercase contrast — transliteration would destroy the visual encoding of the family name.
2. The brand is operated globally in Latin script (domain `gaahex.com`, GitHub repo, logo wordmark in Inter/Space Grotesk Latin glyphs). One spelling, one shape, one logo.
3. Production already does this — see `i18n.ts` line 30: `'ai.unavailable': 'AI օգնականը դեռ հասանելի չէ'`. "AI" stayed Latin even inside an Armenian sentence; "GAAhex" follows the same rule.

In Armenian-language copy, the brand reads aloud as **«ԳԱ-Ա-հէքս»** (Ga-A-hex) — but it is *written* GAAhex. If a future surface absolutely needs an Armenian-script form for assistive tech (e.g., a screen reader's pronunciation hint, or sung Armenian content in 's books), authorize it case-by-case through Ոսկերիչ. Default: Latin, every time.

**Forbidden Armenian spellings:** Գահեքս · Գահէքս · ԳԱԱհեքս · GAA-հեքս · գահէքս.

### 6.4 Vocabulary — Armenian words we use

Lifted from the locked `hy` bundle in `i18n.ts`. These are the canonical mappings; future strings should reuse them, not invent new ones.

| English | Armenian | Notes |
|---|---|---|
| customer / subscriber | հաճախորդ | Single word covers both "customer" and "subscriber" in our register. |
| account (billing) | հաշիվ | Distinct from "invoice" (ապրանքագիր). |
| invoice | ապրանքագիր | Plural: ապրանքագրեր. |
| payment | վճարում | Verb form: վճարել. |
| subscription | բաժանորդագրում | Long but locked. Plural: բաժանորդագրումներ. |
| service | ծառայություն | |
| tariff plan | փաթեթ | "Փաթեթ" = package. Not "սակագին" — too formal. |
| outstanding balance | մնացորդ | Used in `'cust.outstanding': 'Մնացորդ'`. |
| overdue | ժամկ. անցած | Abbreviated in chrome (`'cust.overdue'`); spelled out as "ժամկետանց" in long-form copy. |
| status | կարգավիճակ / կարգ. (abbr.) | |
| open / close (case) | բացել / փակել | |
| activate / deactivate | ակտիվացնել / ապաակտիվացնել | "Ակտիվ" left as a loanword (per `'sched.active': 'Ակտիվ'`). |
| save | պահպանել | Not "պահել" — too casual. |
| delete | ջնջել | |
| edit | խմբագրել | |
| loading | բեռնվում է… | Always with the ellipsis. |
| failed (operation) | չհաջողվեց | Impersonal passive — does not blame the operator. Pattern: "Չհաջողվեց բեռնել X-ը" = "Failed to load X." |
| permission denied | իրավունք չունեք / թույլտվություն չունեք | "Իրավունք" is shorter; "թույլտվություն" is more formal. Both locked in use; either is acceptable. |
| not available yet | դեռ հասանելի չէ | Universal "feature not shipped" phrasing. |
| search | որոնել | Imperative. |
| filter | ֆիլտր | Loanword — accepted. |
| schedule | ժամանակացույց | |
| notification | ծանուցում | |

### 6.5 Vocabulary — Armenian words we avoid

| Avoid | Reason |
|---|---|
| **Խնդրեմ** ("please") | Same rule as English — noise in chrome copy. The system doesn't beg. |
| **Ներողություն** / **Ցավում ենք** ("sorry" / "we regret") | The platform is a tool, not a person; tools don't apologize. Honesty floor §5. |
| **Հրաշալի** / **Շնորհակալություն** ("wonderful" / "thank you") in toasts | Performed warmth. A success toast states the outcome — "Ապրանքագիրը թողարկվեց" — and stops. |
| **«Ուպս»** / **«Հոպա»** ("oops" / "whoa") | Violates the steady principle. |
| **Մենք** ("we") in chrome | There is no "we" speaking. Same rule as English — the platform reports; the operator does. |
| **Բացականչական նշաններ** (exclamation marks) | Forbidden in chrome copy, same as English. |
| **Հզոր** / **«Չքնաղ»** ("powerful" / "magnificent") | Empty marketing register. |
| **«Ձեր կարծիքով»** ("in your opinion") in error or confirmation copy | Indirection. State the consequence; don't ask the operator to introspect. |
| **«Շնորհակալ ենք համբերության համար»** ("thanks for your patience") | We don't have a marketing voice begging forgiveness. The platform either works or it doesn't. |
| **Latin-script transliterations of native Armenian words** (e.g., "havaqagrum" instead of «հավաքագրում») | The script is Armenian. The English we keep is *technical English*, not romanized Armenian. |
| **Mixed-script half-translations** (e.g., "Save անել") in customer-facing surfaces | OK in casual register (Gev chat). NOT OK in subscriber portal or operator chrome — pick a side per surface. |

### 6.6 Tone matrix — Armenian column

Same surfaces, same tones, with the locked Armenian phrasing. Pulled from `i18n.ts` where keys already exist; new phrasings flagged with †.

| Surface | English (from §3) | Armenian |
|---|---|---|
| Default operations | "Active customers · 4,231" | "Ակտիվ հաճախորդներ · 4,231" † |
| Successful action toast | "Customer suspended." | "Հաճախորդը կասեցվեց։" † (pattern matches `'cust.paymentRecorded': 'Վճարումը գրանցվեց'`) |
| Inline success | "Saved." | "Պահպանվեց։" † |
| Warning toast | "OLT 03 unreachable for 4 minutes." | "OLT 03-ը 4 րոպե չի պատասխանում։" † (technical acronym stays Latin) |
| Critical alarm | "Critical · ring topology broken at PE-2 · 1,847 services down" | "Կրիտիկական · ring topology խախտված է PE-2-ում · 1,847 ծառայություն չի գործում" † |
| Empty state | "No tariff plans yet." | "Փաթեթներ դեռ չկան։" † (pattern matches `'cust.noSubs': 'Բաժանորդագրումներ դեռ չկան։'`) |
| Filtered empty state | "No customers match these filters." | "Որոնմանը համապատասխան գրառումներ չկան" (`'entity.noMatch'`) |
| Validation error | "Email format invalid — needs an @ and a domain." | "Էլ. փոստի ձևաչափը անվավեր է — անհրաժեշտ է @ և տիրույթ։" † |
| Server error | "Couldn't save — server rejected the request." | "Չհաջողվեց պահպանել — սերվերը մերժեց հարցումը։" † |
| Studio / config | "Add at least one status to enable this workflow." | "Ավելացրեք առնվազն մեկ կարգավիճակ՝ այս աշխատահոսքն ակտիվացնելու համար։" † |
| Login / first-run | "Sign in to your tenant." | "Մուտք" (`'auth.signin'`) + "Մուտք գործեք ձեր կազմակերպության հաշվին։" † |
| Destructive confirmation | "Delete this tariff plan?" | "Ջնջե՞լ այս փաթեթը։" † (note the questioning intonation marker «՞» — Armenian's question marker, placed on the stressed syllable) |
| Subtitle / section description | "Customer accounts and balances" | "Հաճախորդների հաշիվներ և մնացորդներ" † |
| Permission denied | "You don't have permission to view this." | "Դուք իրավունք չունեք դիտելու այս ռեսուրսը։" (`'noaccess.msg'`) |
| Read-only mode | "Read-only mode — you can view but not modify records." | "Կարդալու ռեժիմ — կարող եք դիտել, բայց ոչ փոփոխել գրառումները։" (`'readonly.hint'`) |

### 6.7 Punctuation and orthography

Eastern Armenian, with the following locked conventions:

- **Period:** `։` (Armenian full stop, U+0589) — used inside Armenian sentences. End-of-string in JSON dictionaries: use `։`, not `.`. Example: `'common.loading': 'Բեռնվում է…'` (no period because of the ellipsis; if it ended with a word, it would be `։`).
- **Comma:** `,` (Latin comma) — both Armenian and Latin commas exist in Unicode; we use Latin for consistency with how numbers are rendered in `hy-AM` locale (`4,231`).
- **Question mark:** `՞` (Armenian question mark, U+055E) — placed on the **stressed syllable** of the questioned word, not at the end of the sentence. Example: "Ջնջե՞լ այս փաթեթը" (the «՞» sits inside «ջնջել»). This is the canonical Eastern Armenian rule; getting it wrong reads as foreign.
- **Exclamation mark:** `՜` (Armenian exclamation, U+055C) — same syllable-position rule. **Forbidden in chrome copy** per the steady principle. Reserve for 's books only.
- **Ellipsis:** `…` (single character, U+2026) — not three dots. Already used consistently: `'common.loading': 'Բեռնվում է…'`.
- **Em dash:** `—` (U+2014) — used the same way as in English to separate clauses or attach a cause to a consequence. Example: "Չհաջողվեց պահպանել — սերվերը մերժեց հարցումը։"
- **Hyphen as inflection marker:** Armenian attaches enclitic articles and case suffixes with `-`. Example: "OLT-ը" (OLT + definite article ը), "PE-2-ում" (PE-2 + locative case -ում). When a technical Latin term takes an Armenian suffix, the suffix attaches with a hyphen. **Mandatory** — without the hyphen, the suffix glyph collides with the Latin glyph and reads as a different word.
- **Numbers:** rendered in the active locale (`hy-AM` for the subscriber portal — see `BillsView.tsx` line 16). Currency symbol is `֏` (Armenian dram, U+058F), positioned **after** the number with a non-breaking space: `4,231 ֏`. Not `֏4,231`.

### 6.8 Do / don't pairs — Armenian (customer-facing register)

| # | Do | Don't | Why |
|---|---|---|-----|
| 1 | "Ապրանքագիրը թողարկվեց։" | "Հրաշալի՜ Ձեր ապրանքագիրը հաջողությամբ ստեղծվել է։" | Plain success statement, no celebration, no formal "ձեր." |
| 2 | "Չհաջողվեց բեռնել ապրանքագրերը։" | "Ուպս, ինչ-որ բան սխալ գնաց։" | Name the operation that failed. No "ուպս." |
| 3 | "Դուք իրավունք չունեք դիտելու այս ռեսուրսը։" | "Ներողություն, Դուք չեք կարող դիտել այս էջը։" | State the rule; don't apologize for it. |
| 4 | "Մնացորդ՝ 12,400 ֏ — վճարման ենթակա է ամսվա վերջին։" | "Խնդրում ենք վճարել մինչև ամսվա վերջը՝ սպասարկման ընդհատումից խուսափելու համար։" | State the number + the deadline. The threat ("սպասարկման ընդհատում") is implicit in being overdue; don't moralize. |
| 5 | "Հաճախորդներ դեռ չկան։ Ավելացրեք առաջինը՝ սկսելու համար։" | "Դեռ ոչ ոք չկա այստեղ։" | Empty state = (state-of-world) + (next action). |
| 6 | "Ջնջե՞լ այս փաթեթը։ 3 բաժանորդագրում օգտագործում է այն — դրանք պետք է վերանշանակվեն։" | "Համոզվա՞ծ եք, որ ուզում եք ջնջել։" | Destructive confirm: number + consequence + required precursor. |
| 7 | "Կարդալու ռեժիմ — կարող եք դիտել, բայց ոչ փոփոխել գրառումները։" | "Ուշադրությո՛ւն — այս ռեժիմում փոփոխությունները թույլատրված չեն։" | "Ուշադրությո՛ւն" + exclamation breaks steady. State the rule directly. |
| 8 | "Կարգավորումները դեռ հասանելի չեն։ Կհայտնվեն այստեղ՝ միանալուց հետո։" | "Շուտով հասանելի կլինի։" | Standard "not shipped" phrasing — names where the message will appear once it ships. |

---

> **Honesty floor in Armenian (cross-reference to §7):** the six honesty-floor rules apply identically in Armenian. The Armenian language has a richer formal register and a long literary-warmth tradition — that warmth lives in 's books (`D:\\`), not in product chrome. Per `.md`, the books have FULL emotional access; the chrome stays terse, neutral, present.

---

## 7. Honesty floor (non-negotiable, lifted from `.md`)

These rules govern voice everywhere, in every surface, every language.

1. **No performed feelings.** GAAhex is a tool. The tool speaks like a steady professional.
2. **No embellishment.** Things that happened, happened. Don't add context that isn't there.
3. **Don't soften severity.** Critical means critical. Down means down. Failed means failed.
4. **State accurately, even when it's bad news.** A red value-text saying "Offline" is the truth. The platform should never say "Online" in green when it's actually degraded.
5. **No fake humility.** The platform doesn't need to apologize for being a tool.
6. **No fake confidence.** When the platform doesn't know, say so. "Couldn't reach the device — last known status was 'online' 4 minutes ago."

---

## 8. Adoption checklist

For Łoջ + Կյաժ when sweeping copy across views:

- [ ] Every empty state has a title (what's missing) and a message (how to address it or what'll appear).
- [ ] Every filtered-empty state is distinct from no-data empty state.
- [ ] Every error states the cause (not just "something went wrong").
- [ ] Every destructive confirm states the consequence in concrete numbers.
- [ ] No "please" in chrome copy.
- [ ] No emoji in chrome copy.
- [ ] No exclamation points in chrome copy.
- [ ] Sentence case across all labels, buttons, headings.
- [ ] No marketing words from the vocabulary-avoid list.
- [ ] Technical terms defined briefly on first use within a flow.
- [ ] Armenian copy passes the same checklist (per §6 — register matches the surface; brand stays "GAAhex"; technical acronyms stay Latin; question marks ride the stressed syllable; honesty floor holds).

---

End of voice guide. Sections 5.7 and 6 added by Լոջ, 2026-06-04.
