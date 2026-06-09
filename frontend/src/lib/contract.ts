// Contract generation (client-side, placeholder template).
//
// The owner will supply the real contract form to store in the DB; until then this
// builds a standalone HTML contract from the lead modal's current values so the
// Generate → Download flow works end-to-end. Swap `renderTemplate` for the stored
// template once it's provided. Inline styles here are intentional: the output is a
// self-contained document file, not app DOM (so D20 tokens don't apply).

export type FieldLike = { key: string; label: string; type?: string }

// Email template color palette (mirrors --gx-* brand tokens; hardcoded because
// email clients don't support CSS custom properties).
const E = {
  text:    '#15233b',  // --gx-text-1 (cobalt dark)
  muted:   '#5b6b85',  // --gx-text-3
  heading: '#1f3a63',  // --gx-cobalt-800
  border:  '#c9d4e5',  // --gx-border
  row:     '#eef2f7',  // --gx-surface-1
  caption: '#8a98ad',  // --gx-text-4
} as const

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Pull a value by key, blanking out non-text field types (files etc.).
function val(values: Record<string, any>, key: string): string {
  const v = values[key]
  if (v == null || v === '' || Array.isArray(v)) return '—'
  return String(v)
}

function renderTemplate(values: Record<string, any>, fields: FieldLike[], dateStr: string): string {
  const fullName = val(values, 'name')
  // Every filled field, as a details table (skips files / empties).
  const rows = fields
    .filter((f) => f.type !== 'file' && f.type !== 'status' && f.key !== 'attachments')
    .map((f) => ({ label: f.label, value: val(values, f.key) }))
    .filter((r) => r.value && r.value !== '—')
    .map((r) => `<tr><td class="k">${esc(r.label)}</td><td class="v">${esc(r.value)}</td></tr>`)
    .join('')

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Service Contract — ${esc(fullName)}</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; color: ${E.text}; max-width: 800px; margin: 40px auto; padding: 0 32px; line-height: 1.6; }
  h1 { font-size: 22px; text-align: center; margin: 0 0 4px; }
  .sub { text-align: center; color: ${E.muted}; font-size: 13px; margin-bottom: 28px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .06em; color: ${E.heading}; border-bottom: 1px solid ${E.border}; padding-bottom: 4px; margin: 26px 0 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td { padding: 6px 8px; vertical-align: top; border-bottom: 1px solid ${E.row}; }
  td.k { width: 38%; color: ${E.muted}; }
  td.v { font-weight: 600; }
  .sign { display: flex; justify-content: space-between; margin-top: 48px; font-size: 13px; }
  .sign div { width: 45%; border-top: 1px solid ${E.text}; padding-top: 6px; text-align: center; color: ${E.muted}; }
  .note { margin-top: 36px; font-size: 11px; color: ${E.caption}; text-align: center; }
</style></head><body>
  <h1>Service Contract</h1>
  <div class="sub">HouseNet ISP · ${esc(dateStr)}</div>

  <h2>Subscriber</h2>
  <table>
    <tr><td class="k">Full name</td><td class="v">${esc(fullName)}</td></tr>
    <tr><td class="k">Phone</td><td class="v">${esc(val(values, 'phone'))}</td></tr>
    <tr><td class="k">Email</td><td class="v">${esc(val(values, 'email'))}</td></tr>
  </table>

  <h2>Service & address</h2>
  <table>
    <tr><td class="k">Region</td><td class="v">${esc(val(values, 'region'))}</td></tr>
    <tr><td class="k">City</td><td class="v">${esc(val(values, 'city'))}</td></tr>
    <tr><td class="k">Village</td><td class="v">${esc(val(values, 'village'))}</td></tr>
    <tr><td class="k">Address</td><td class="v">${esc(val(values, 'address'))}</td></tr>
    <tr><td class="k">GPS</td><td class="v">${esc(val(values, 'gps'))}</td></tr>
    <tr><td class="k">Service type</td><td class="v">${esc(val(values, 'service_type'))}</td></tr>
    <tr><td class="k">Package</td><td class="v">${esc(val(values, 'package'))}</td></tr>
    <tr><td class="k">Contract term</td><td class="v">${esc(val(values, 'contract_term'))}</td></tr>
  </table>

  <h2>All details</h2>
  <table>${rows || '<tr><td class="k">—</td><td class="v">—</td></tr>'}</table>

  <div class="sign"><div>Subscriber</div><div>HouseNet ISP</div></div>
  <div class="note">Auto-generated draft from the lead form — placeholder template, pending the official contract.</div>
</body></html>`
}

export function buildContractHtml(values: Record<string, any>, fields: FieldLike[]): string {
  const now = new Date()
  const dateStr = now.toLocaleDateString()
  return renderTemplate(values, fields, dateStr)
}

export function contractFileName(values: Record<string, any>): string {
  const base = [values.name, values.surname].filter(Boolean).join('-') || 'lead'
  const safe = String(base).replace(/[^\p{L}\p{N}_-]+/gu, '_')
  return `contract-${safe}.html`
}
