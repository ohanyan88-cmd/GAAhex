// verify_rbac_enforcement.js — End-to-end RBAC enforcement proof.
//
// Walks the full enforcement loop in the real UI:
//   1. Login admin → Studio → Security → Permissions
//   2. Screenshot the matrix with sales_agent / Customer cell in its GRANTED ("View") state
//   3. Click that cell twice (View → Edit → None) to fully revoke customer.* for sales_agent,
//      verifying after each click that the optimistic PATCH actually persisted server-side
//      (GET /api/roles/{id} must reflect the new permissions[] array)
//   4. Screenshot the matrix in the REVOKED ("—") state
//   5. Out-of-band: login fresh as agent, GET /api/customers, EXPECT 403
//   6. Click the cell once (None → View) to restore the original sales_agent perm set,
//      verifying GET /api/roles/{id} matches the baseline customer perms
//   7. Screenshot the matrix in the RESTORED ("View") state
//   8. Out-of-band: login fresh as agent again, GET /api/customers, EXPECT 200
//
// All HTTP probes are emitted to stdout so the report can quote them.
//
// Run:
//   cd C:\Users\Admin\Desktop\Portal\frontend && node ../verify_rbac_enforcement.js
//
// Requires:
//   - Frontend dev server at http://localhost:5173
//   - Backend at http://127.0.0.1:8099
//   - admin@demo.isp / admin123 + agent@demo.isp / agent123 seeded

const { chromium, request } = require('playwright');
const fs = require('fs');

const SHOT_DIR = 'C:/Users/Admin/Desktop/Portal/screenshots';
if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });

const API = 'http://127.0.0.1:8099';
const SALES_AGENT_ROLE_ID = 'ca8ca380-78f4-4bad-81e9-06a13baca839';

// ---------- helpers ----------

async function login(ctx, email, password) {
  const r = await ctx.post(`${API}/auth/login`, {
    data: { email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!r.ok()) throw new Error(`login ${email} → HTTP ${r.status()}`);
  const j = await r.json();
  return j.access_token;
}

async function getRole(ctx, token, id) {
  const r = await ctx.get(`${API}/api/roles`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok()) throw new Error(`GET /api/roles → HTTP ${r.status()}`);
  const list = await r.json();
  return list.find(x => x.id === id);
}

async function probeCustomers(ctx, token) {
  const r = await ctx.get(`${API}/api/customers`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const status = r.status();
  let shape = '';
  try {
    const body = await r.json();
    if (Array.isArray(body)) shape = `array len=${body.length}`;
    else if (body && body.detail) shape = `detail="${body.detail}"`;
    else shape = JSON.stringify(body).slice(0, 120);
  } catch { shape = '<non-json>'; }
  return { status, shape };
}

async function openStudio(page) {
  await page.evaluate(() => {
    const btn = document.querySelector('.sb-foot .sb-item');
    if (btn) btn.click();
  });
  await page.waitForTimeout(2500);
}

async function expandGroup(page, label) {
  await page.evaluate((g) => {
    const btn = [...document.querySelectorAll('.tree-g')].find(
      (b) => (b.textContent || '').trim().startsWith(g),
    );
    if (btn && !btn.classList.contains('open')) btn.click();
  }, label);
  await page.waitForTimeout(400);
}

async function clickLeaf(page, label) {
  await page.evaluate((l) => {
    const btn = [...document.querySelectorAll('.tree-leaf')].find(
      (b) => (b.textContent || '').trim() === l,
    );
    if (btn) btn.click();
  }, label);
  await page.waitForTimeout(2200);
}

// Locate the Customer/Sales Agent cell button and read its label.
async function readCustomerSalesAgentCell(page) {
  return await page.evaluate(() => {
    // Find the header row to map column index → role label.
    const table = document.querySelector('table.grid');
    if (!table) return { error: 'no table.grid' };
    const headers = [...table.querySelectorAll('thead th')].map(th => (th.textContent || '').trim());
    const salesCol = headers.findIndex(h => h === 'Sales Agent');
    if (salesCol < 1) return { error: `Sales Agent column not found in ${JSON.stringify(headers)}` };

    const rows = [...table.querySelectorAll('tbody tr')];
    const custRow = rows.find(tr => {
      const first = tr.querySelector('td');
      return first && (first.textContent || '').trim() === 'Customer';
    });
    if (!custRow) return { error: 'Customer row not found' };

    const cells = [...custRow.querySelectorAll('td')];
    const cell = cells[salesCol];
    if (!cell) return { error: `cell at col ${salesCol} missing` };
    const btn = cell.querySelector('button.perm-cell');
    if (!btn) return { error: 'perm-cell button not found' };
    return { label: (btn.textContent || '').trim() };
  });
}

async function clickCustomerSalesAgentCell(page) {
  const result = await page.evaluate(() => {
    const table = document.querySelector('table.grid');
    const headers = [...table.querySelectorAll('thead th')].map(th => (th.textContent || '').trim());
    const salesCol = headers.findIndex(h => h === 'Sales Agent');
    const rows = [...table.querySelectorAll('tbody tr')];
    const custRow = rows.find(tr => {
      const first = tr.querySelector('td');
      return first && (first.textContent || '').trim() === 'Customer';
    });
    const cells = [...custRow.querySelectorAll('td')];
    const btn = cells[salesCol].querySelector('button.perm-cell');
    btn.click();
    return true;
  });
  // give optimistic PATCH room to land
  await page.waitForTimeout(900);
  return result;
}

// ---------- main ----------

(async () => {
  const apiCtx = await request.newContext();

  // Reconnaissance: admin token + role baseline
  const adminToken = await login(apiCtx, 'admin@demo.isp', 'admin123');
  const baselineRole = await getRole(apiCtx, adminToken, SALES_AGENT_ROLE_ID);
  const baselinePerms = baselineRole.permissions.slice();
  console.log(`[recon] sales_agent baseline perms: ${JSON.stringify(baselinePerms)}`);

  // Agent baseline probe
  let agentToken = await login(apiCtx, 'agent@demo.isp', 'agent123');
  const probeBefore = await probeCustomers(apiCtx, agentToken);
  console.log(`[probe BEFORE] GET /api/customers as agent → HTTP ${probeBefore.status}, ${probeBefore.shape}`);

  // Browser session
  const browser = await chromium.launch({ headless: true, args: ['--window-size=1440,900'] });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  // Login UI as admin
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await page.fill('input:nth-of-type(1)', 'admin@demo.isp');
  await page.fill('input[type="password"]', 'admin123');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3500);

  // Navigate Studio → Security → Permissions
  await openStudio(page);
  await expandGroup(page, 'Security');
  await clickLeaf(page, 'Permissions');

  // --- BEFORE screenshot (cell should be "View") ---
  let cell = await readCustomerSalesAgentCell(page);
  console.log(`[ui BEFORE] Customer / Sales Agent cell label: ${JSON.stringify(cell)}`);
  if (cell.label !== 'View') {
    console.error(`!! expected 'View' baseline, got '${cell.label}'. Aborting; sales_agent has unexpected perms.`);
    process.exit(2);
  }
  await page.screenshot({ path: `${SHOT_DIR}/rbac_01_before.png`, fullPage: true });
  console.log('rbac_01_before.png');

  // --- Click 1: View → Edit (adds create/edit/delete) ---
  await clickCustomerSalesAgentCell(page);
  const afterClick1 = await getRole(apiCtx, adminToken, SALES_AGENT_ROLE_ID);
  console.log(`[persist click 1 → "Edit"] role perms now: ${JSON.stringify(afterClick1.permissions)}`);
  cell = await readCustomerSalesAgentCell(page);
  console.log(`[ui after click 1] cell label: ${JSON.stringify(cell)}`);

  // --- Click 2: Edit → None (strips ALL customer.*) ---
  await clickCustomerSalesAgentCell(page);
  const afterClick2 = await getRole(apiCtx, adminToken, SALES_AGENT_ROLE_ID);
  console.log(`[persist click 2 → "None"] role perms now: ${JSON.stringify(afterClick2.permissions)}`);
  cell = await readCustomerSalesAgentCell(page);
  console.log(`[ui after click 2] cell label: ${JSON.stringify(cell)}`);

  const stillHasView = afterClick2.permissions.includes('customer.view');
  if (stillHasView) {
    console.error(`!! customer.view still present in role after revocation: ${JSON.stringify(afterClick2.permissions)}`);
    await browser.close();
    process.exit(3);
  }
  await page.screenshot({ path: `${SHOT_DIR}/rbac_02_after_toggle.png`, fullPage: true });
  console.log('rbac_02_after_toggle.png');

  // --- Enforcement test: fresh agent token, hit /api/customers, expect 403 ---
  agentToken = await login(apiCtx, 'agent@demo.isp', 'agent123');
  const probeRevoked = await probeCustomers(apiCtx, agentToken);
  console.log(`[probe REVOKED] GET /api/customers as agent (fresh token) → HTTP ${probeRevoked.status}, ${probeRevoked.shape}`);

  // --- Click 3: None → View (restores baseline read-only) ---
  await clickCustomerSalesAgentCell(page);
  const afterClick3 = await getRole(apiCtx, adminToken, SALES_AGENT_ROLE_ID);
  console.log(`[persist click 3 → "View"] role perms now: ${JSON.stringify(afterClick3.permissions)}`);
  cell = await readCustomerSalesAgentCell(page);
  console.log(`[ui after click 3] cell label: ${JSON.stringify(cell)}`);

  await page.screenshot({ path: `${SHOT_DIR}/rbac_03_restored.png`, fullPage: true });
  console.log('rbac_03_restored.png');

  // --- Restored enforcement probe ---
  agentToken = await login(apiCtx, 'agent@demo.isp', 'agent123');
  const probeRestored = await probeCustomers(apiCtx, agentToken);
  console.log(`[probe RESTORED] GET /api/customers as agent (fresh token) → HTTP ${probeRestored.status}, ${probeRestored.shape}`);

  // --- Final reconciliation: compare back to baseline perm set (set equality) ---
  const sortedBaseline = [...baselinePerms].sort();
  const sortedFinal = [...afterClick3.permissions].sort();
  const same = JSON.stringify(sortedBaseline) === JSON.stringify(sortedFinal);
  console.log(`[reconcile] perm set equals baseline? ${same}`);
  if (!same) {
    console.log(`  baseline: ${JSON.stringify(sortedBaseline)}`);
    console.log(`  final:    ${JSON.stringify(sortedFinal)}`);
  }

  await browser.close();
  await apiCtx.dispose();

  // --- Verdict ---
  const pass = probeBefore.status === 200
    && probeRevoked.status === 403
    && probeRestored.status === 200
    && same;
  console.log(`\n=== VERDICT: ${pass ? 'PASS' : 'FAIL'} ===`);
  console.log(`  BEFORE   : HTTP ${probeBefore.status} (expected 200)`);
  console.log(`  REVOKED  : HTTP ${probeRevoked.status} (expected 403)`);
  console.log(`  RESTORED : HTTP ${probeRestored.status} (expected 200)`);
  console.log(`  perm set restored to baseline: ${same}`);
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error('CRASH:', e.stack || e.message);
  process.exit(99);
});
