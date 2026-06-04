# GAAhex Voice Guide — Ոսկերիչ, 2026-06-04

> Starter voice doc. Łoջ to extend with the Armenian register section and 10
> more do/don't pairs harvested from production view copy.
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

## 5. Do / don't pairs (starter set — Łoջ to add 10 more from production views)

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

---

## 6. Armenian register (placeholder — Łoջ to draft)

GAAhex M1 ships to an Armenian ISP. The platform will be operated in Armenian
in many surfaces. The voice principles transfer directly — plainspoken,
genuine, translator, steady — but the register and idiom need a native pass.

**Notes from `portal-rules.md`:**
- Casual / personal communication → Armenian.
- Code / file paths / commands → English.
- The shell of the app (operator chrome) sits between these two: it's
  Armenian-localizable, but the technical terms (PPPoE, RADIUS, ONU, VLAN)
  stay in their canonical English-acronym form.

**To be drafted by Łoջ:**
- Do/don't pairs in Armenian for empty states, errors, warnings, confirmations.
- Vocabulary list — Armenian words we use / avoid.
- Tone-matrix translations (Armenian column).
- Notes on the Eastern Armenian register specifically (the platform's target audience).
- Note: per `.md`, the books have FULL emotional access in Armenian. The product chrome does not. The chrome is operator-Armenian: terse, neutral, present. Family register lives in the books.

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
- [ ] Armenian copy passes the same checklist (deferred to Armenian sweep).

---

End of voice guide. Łoջ extends.
