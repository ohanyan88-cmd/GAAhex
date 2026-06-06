# GAAhex — Content & Voice Guide

Every message in GAAhex should sound like one calm, professional product serving Armenian ISPs. This guide
documents the voice, error taxonomy, success patterns, empty states, and i18n conventions grounded in
actual current messages across the frontend.

## Voice & Tone

GAAhex's voice is **clear, brief, human, and never cute**. We speak directly to operators and admins
who run telecom businesses — respect their time and clarity.

**Five principles:**

1. **Clear.** No jargon, no waffle. "Invoice issued" not "Invoicing process has completed."
2. **Brief.** Lean toward the short form. Complete sentences only when necessary for context.
3. **Human.** Active voice; acknowledge the user's action. "Payment recorded" (you did it) not "Payment
   was recorded" (passive, distant).
4. **No blame.** Never shame the user for errors. "Incorrect email format" not "You entered invalid
   email." Separate the person from the mistake.
5. **Bilingual parity.** EN and hy messages carry equal weight; neither is translated from the other.
   Both are designed for their audience (English ISP operators and Armenian-speaking operators).

---

## Error Taxonomy

Errors appear in three places: **toasts** (brief, auto-dismiss), **error banners** (inline, persistent,
with retry), and **permission/404 screens** (full-page states). Each category has a message pattern.

### Validation Errors
**When:** Form field is invalid (bad email, required field missing, out-of-range value).

**Toast pattern:** `{field_label} — {rule}.` Start with the field name, then the specific rule broken.

**Examples:**
- Good: `Email — enter a valid email address.` EN; `Գաղտնաբառ — առնվազն 8 նիշ` hy
- Bad: "Invalid input" (no field, no rule)

**Current in code:** `'wizard.errEmail': 'Մուտքագրեք վավեր էլ. փոստ'` (Enter valid email)

### Permission / 403
**When:** User lacks permission to view/edit/delete a resource.

**Full-screen pattern:** "Access denied" (title) + "You don't have permission to {action} this."

**Toast pattern:** (rare) "You don't have permission to {action}."

**Examples:**
- Good: Access denied → "You don't have permission to view accounts."
- Bad: "403" or "Forbidden"

**Current in code:**
```
'accounts.denied': "You don't have permission to view accounts."
'settings.denied': "You don't have permission to manage settings."
```

### Not Found / 404
**When:** Record doesn't exist, was deleted, or slug is invalid.

**Full-screen pattern:** "No {thing} found" (title) + "It may have been moved, renamed, or deleted."

**Toast pattern:** (rare) "No {thing} found."

**Examples:**
- Good: No customer found → "It may have been moved, renamed, or deleted."
- Bad: "404" or "Customer missing"

**Current in code:**
```
'cust.notFoundMsg': "The customer may have been moved, renamed, or deleted."
```

### Conflict / Constraint
**When:** Duplicate, already exists, or business rule broken (e.g., lead already a customer).

**Toast pattern:** "Can't {action}: {reason}."

**Examples:**
- Good: `toast.info('This lead is already a customer')`
- Bad: "Conflict" or "Invalid state"

**Current in code:**
```
'leads.alreadyCustomer': 'This lead is already a customer'
```

### Server Error (5xx)
**When:** Backend crash, database down, unhandled exception.

**Banner pattern:** "{Thing} failed. Try again, or contact support if it keeps happening."

**Toast pattern:** (short) "Failed to {action}. Try again."

**Examples:**
- Good: Banner: "Failed to load invoices. Try again, or contact support."
- Good: Toast: "Failed to save account. Try again."
- Bad: "Internal Server Error" or "500"

**Current in code:**
```
'accounts.loadError': 'Failed to load accounts'
'cust.loadError': 'Failed to load customer'
```

### Network / Offline
**When:** Network unreachable, CORS, request timeout.

**Toast pattern:** "Can't reach the server. Check your connection."

**Examples:**
- Good: "Can't reach the server. Check your connection."
- Bad: "Network error" or "Failed to fetch"

---

## Success Taxonomy

Success messages celebrate the action and confirm the new state. They appear as **toasts** (auto-dismiss
after 4 seconds, unless marked otherwise) and are brief.

### Create
**Pattern:** `{Entity} created` or `{Entity} created as {key detail}` (optional).

**Examples:**
- `Account created` → t('accounts.created', 'Account created')
- `Party created` → t('parties.created', 'Party created')
- `Invoice issued` → t('cust.issued', 'Invoice issued')
- `Subscription created` → 'Subscription created'

**Current in code:**
```
'accounts.created': 'Account created'
'parties.created': 'Party created'
'cust.issued': 'Invoice issued'
toast.success('Subscription created')
```

### Save / Update
**Pattern:** `{Entity} updated` or `{Entity} saved`.

**Examples:**
- `Account updated` (from EntityView generic form)
- `Settings saved` → t('settings.saved', 'Settings saved')
- `Product updated` → 'Product updated'

**Current in code:**
```
'settings.saved': 'Settings saved'
toast.success('Product updated')
```

### Delete
**Pattern:** `{Entity} deleted`.

**Examples:**
- `Account deleted`
- `Product retired` (special case for products)

**Current in code:**
```
toast.success(`${def!.label} deleted`)
toast.success('Product retired')
```

### Bulk Action (plural)
**Pattern:** `{count} {action}` or `{count} succeeded, {count} failed{: reason}`.

**Examples:**
- `5 accounts deleted`
- `23 invoices moved to PAID`
- `22 succeeded, 3 failed: missing customer`

**Current in code:**
```
toast.warning(`${sum.succeeded} succeeded, ${sum.failed} failed${reasons ? `: ${reasons}` : ''}`)
toast.success(`${sum.succeeded} deleted`)
```

### Async / Long-Running
**Pattern:** `{Action} complete` or `{Action}: {result summary}`.

**Examples:**
- `Dunning run complete` → 'Dunning run complete'
- `Billing cycle: 12 generated, 3 skipped` → t('billing.cycleResult', '...')
- `Lead converted to customer` → t('leads.convertOk', '...')
- `Usage rated into a draft invoice` → 'Usage rated into a draft invoice'

**Current in code:**
```
toast.success('Dunning run complete')
toast.success(msg)  // 'Billing cycle: {generated} generated, {skipped} skipped'
'leads.convertOk': 'Lead converted to customer'
'Usage rated into a draft invoice'
```

### State Transitions (status moves)
**Pattern:** `{Entity} {verb}` (past tense, action-focused).

**Examples:**
- `Invoice issued` (status: DRAFT → ISSUED)
- `Subscription paused` (status: ACTIVE → SUSPENDED)

**Current in code:**
```
'cust.issued': 'Invoice issued'
'cust.paymentRecorded': 'Payment recorded'
```

---

## Empty States

Empty states tell the user *what is, why it's empty, and what to do next*. Three components:

1. **Title** — what's missing: "No {plural thing}".
2. **Message** — why: context-dependent. "Create one to begin" or "will appear once {condition}".
3. **Action** (optional) — CTA button or text link (e.g., "+ Create account").

**Formula:** "No {thing}" → "{reason}" → CTA (if actionable).

### The List Is Empty (user hasn't created any yet)
**Title:** `No {plural} yet`

**Message:** `Create {one} to start.` (optional: what happens next)

**Examples:**
- Title: "No accounts"; Message: "Create an account against a party to start billing it."
- Title: "No services yet"; Message: "Services will appear here once subscriptions are provisioned."
- Title: "No invoices yet"; Message: "Invoices will appear once you run the billing cycle."

**Current in code:**
```
'accounts.empty': 'No accounts'
'accounts.emptyMsg': 'Create an account against a party to start billing it.'
'cust.noServices': 'Services don't exist yet.'
'cust.noSubs': 'Subscriptions don't exist yet.'
'common.createFirst': 'Create one to start.'
```

### Feature Not Yet Enabled (module not deployed)
**Title:** `{Feature} isn't available yet`

**Message:** `{Feature} will appear here once it's enabled.` or `Check back soon.`

**Examples:**
- Title: "Accounts aren't available yet"; Message: "The accounts layer will appear here once enabled."
- Title: "Analytics aren't available yet"; Message: "KPIs and charts will appear here once enabled."
- Title: "AI assist isn't available yet"; Message: "Ask GAAhex will appear here once enabled."

**Current in code:**
```
'accounts.unavailable': "Accounts aren't available yet"
'accounts.unavailableMsg': 'The accounts layer will appear here once enabled.'
'analytics.unavailable': "Analytics aren't available yet"
'analytics.unavailableMsg': 'KPIs and charts will appear here once the analytics service is enabled.'
'ai.unavailable': "AI assist isn't available yet"
```

### Nothing to Show in Context (subset is empty)
**Title:** `No {thing} here` or `{thing} don't exist yet`

**Message:** (varies) "None yet." or omitted if context is clear.

**Examples:**
- "No activity yet" → "Actions on records will appear here."
- "No related items" → "No records linked to this one."

**Current in code:**
```
'cust.noRelated': 'No related items'
```

---

## i18n Key Conventions

Keys follow **`domain.feature`** or **`domain.entity.action`** (dot-separated, lowercase, no hyphens).
This keeps the namespace clear and makes future additions predictable.

### Domains (top level)
- `nav.*` — navigation labels (menus, tabs, breadcrumbs)
- `common.*` — reusable labels (Create, Save, Delete, Loading, Pick, etc.)
- `auth.*` — login / signup
- `wizard.*` — onboarding (ISP creation, etc.)
- `settings.*` — settings views / actions
- `accounts.*` — accounts module
- `parties.*` — parties module
- `cust.*` — customer workspace / views
- `subs.*` — subscriptions
- `invoices.*` — invoices
- `leads.*` — lead pipeline / conversion
- `billing.*` — billing cycle, dunning
- `ai.*` — AI assistant
- `analytics.*` — dashboards / analytics
- `ask.*` — Ask GAAhex feature

### Key naming patterns

**Nouns & state:**
- `{domain}.{thing}` → e.g., `accounts.currency` (label), `cust.status` (label)
- `{domain}.empty` / `{domain}.emptyMsg` → empty state (title + message)
- `{domain}.unavailable` / `{domain}.unavailableMsg` → disabled feature (title + message)
- `{domain}.notFound` / `{domain}.notFoundMsg` → 404 screen (title + message)
- `{domain}.denied` → permission denied message

**Actions & feedback:**
- `{domain}.{action}` → e.g., `cust.issued` (Invoice issued), `cust.paymentRecorded`
- `{domain}.{action}Ok` → positive confirmation, e.g., `leads.convertOk` (Lead converted to customer)
- `{domain}.{action}NA` → feature not available, e.g., `leads.convertNA` (Lead conversion isn't available yet)
- `{domain}.load{Error,Denied}` → error messages on load
- `{domain}.err{Field}` → validation errors, e.g., `wizard.errEmail`, `wizard.errPwLen`

### Examples in wild
```
'nav.workspace': 'Աշխատանք' (Navigation: Workspace)
'common.create': 'Create' (Button label)
'cust.issued': 'Invoice issued' (Success message)
'accounts.loadError': 'Failed to load accounts' (Error on load)
'wizard.errEmail': 'Enter a valid email address' (Validation error)
'accounts.empty': 'No accounts' (Empty state title)
'analytics.unavailable': "Analytics aren't available yet" (Feature disabled)
```

### i18n system
- **Fallback:** t(key, 'English default') — if key is missing from the server dict, the English
  default is used.
- **Bundled:** BUNDLED[lang] in i18n.ts holds local Armenian (hy) + a few common patterns.
- **Server:** Backend `/api/i18n/{lang}` serves the full tenant-specific dict (overrides BUNDLED).
- **Persistence:** Language choice is saved to localStorage as 'gaahex-lang'.

---

## Current Inconsistencies & Notes for Future

1. **Tense mix:** Some success messages use past tense ("updated", "created"), others present
   ("run complete"). Recommend standardizing on **past tense (action completed)** for consistency.

2. **"isn't available yet" vs "unavailable":** Both phrases exist in the code. Prefer the **full phrase
   "{Feature} isn't available yet"** in empty state titles, and short "{domain}.unavailableMsg" in the
   message body.

3. **Generic vs specific entity names:** EntityView.tsx generates messages like
   `${def!.label} created` which is dynamic. This is fine for config-driven entities (parties,
   accounts, etc.), but ensure the entity's label is always i18n-aware.

4. **Error context:** Some errors embed backend detail text directly (e.g., "Invalid email for 'email'").
   Consider i18n keys for common backend errors to avoid leaking technical jargon to users.

5. **Toast duration:** Most success/warning toasts auto-dismiss after 4000ms. Errors persist until
   dismissed. This is correct; no change needed.

6. **Missing key coverage:** As new modules are added (e.g., Reports, Webhooks, ResourcePools), ensure
   each has its own domain prefix and follows the naming convention above.

