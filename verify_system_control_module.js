// verify_system_control_module.js — Task 3 Module 5 (System Control) screenshot proof.
//
// Drives the Studio System Control / Release / Governance group leaves wired in
// Module 5:
//   1. Feature Flags (Release group)   → list + create form + delete row + toggle
//   2. Audit Logs    (Governance group) → table + filters
//   3. System Health (System Control)   → three probe panels + KPI strip
//   4. Unwired leaf  (System Control)   → "Not yet wired" empty state
//   5. Theme flip   → dark replay of 3+ panes
//
// Run:
//   cd C:\Users\Admin\Desktop\Portal\frontend && node ../verify_system_control_module.js
//
// Requires:
//   - Frontend dev server at http://localhost:5173
//   - Backend at http://127.0.0.1:8099 (GAAEX_DEV_SEED=1 first boot)
//   - admin@demo.isp / admin123

const { chromium } = require('playwright');
const fs = require('fs');

const SHOT_DIR = 'C:/Users/Admin/Desktop/Portal/screenshots';
if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });

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
  await page.waitForTimeout(1800);
}

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    localStorage.setItem('gaaex-theme', t);
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
  await page.waitForTimeout(300);
  for (let i = 0; i < 3; i++) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await page.waitForTimeout(150);
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--window-size=1440,900'] });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  // 1. Log in.
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await page.fill('input:nth-of-type(1)', 'admin@demo.isp');
  await page.fill('input[type="password"]', 'admin123');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3500);

  // 2. Open Studio.
  await openStudio(page);

  // 3. ── Feature Flags (Release group) ─────────────────────────────────────
  await expandGroup(page, 'Release');
  await clickLeaf(page, 'Feature Flags');
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${SHOT_DIR}/sc_01_feature_flags_list_dark.png`, fullPage: true });
  console.log('sc_01_feature_flags_list_dark.png');

  // 3b. Open the "New flag" create form.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(
      (b) => /^\s*New flag\s*$/i.test((b.textContent || '').trim()),
    );
    if (btn) btn.click();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOT_DIR}/sc_02_feature_flags_create_modal_dark.png`, fullPage: true });
  console.log('sc_02_feature_flags_create_modal_dark.png');

  // 3c. Cancel create form (don't actually mutate state).
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(
      (b) => (b.textContent || '').trim() === 'Cancel',
    );
    if (btn) btn.click();
  });
  await page.waitForTimeout(400);

  // 3d. Click a toggle to demonstrate the PATCH wire (no real change committed if first row is read-only).
  await page.evaluate(() => {
    const t = document.querySelector('.gx-toggle');
    if (t) t.click();
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOT_DIR}/sc_03_feature_flags_toggle_dark.png`, fullPage: true });
  console.log('sc_03_feature_flags_toggle_dark.png');
  // Revert toggle so we leave state unchanged.
  await page.evaluate(() => {
    const t = document.querySelector('.gx-toggle');
    if (t) t.click();
  });
  await page.waitForTimeout(500);

  // 4. ── Audit Logs (Governance group) ─────────────────────────────────────
  await expandGroup(page, 'Governance');
  await clickLeaf(page, 'Audit Logs');
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${SHOT_DIR}/sc_04_audit_logs_table_dark.png`, fullPage: true });
  console.log('sc_04_audit_logs_table_dark.png');

  // 4b. Expand the first audit row to show the payload diff.
  await page.evaluate(() => {
    const row = document.querySelector('table.grid tbody tr[aria-expanded="false"]');
    if (row) row.click();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOT_DIR}/sc_05_audit_logs_payload_expanded_dark.png`, fullPage: true });
  console.log('sc_05_audit_logs_payload_expanded_dark.png');

  // 4c. Apply a filter ("create" event type) to demonstrate the filter wire.
  await page.evaluate(() => {
    const sel = document.querySelector('.card select.inp');
    if (sel) {
      sel.value = 'create';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const apply = [...document.querySelectorAll('button')].find(
      (b) => (b.textContent || '').trim() === 'Apply',
    );
    if (apply) apply.click();
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOT_DIR}/sc_06_audit_logs_filtered_dark.png`, fullPage: true });
  console.log('sc_06_audit_logs_filtered_dark.png');

  // 5. ── System Health (System Control group) ─────────────────────────────
  await expandGroup(page, 'System Control');
  await clickLeaf(page, 'System Health');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOT_DIR}/sc_07_system_health_dashboard_dark.png`, fullPage: true });
  console.log('sc_07_system_health_dashboard_dark.png');

  // 5b. Click "Refresh all" to re-trigger probes.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(
      (b) => /Refresh all/i.test((b.textContent || '').trim()),
    );
    if (btn) btn.click();
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOT_DIR}/sc_08_system_health_refreshed_dark.png`, fullPage: true });
  console.log('sc_08_system_health_refreshed_dark.png');

  // 6. ── Unwired System Control leaf — "Not yet wired" empty state ────────
  await clickLeaf(page, 'Maintenance Mode');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOT_DIR}/sc_09_unwired_not_wired_dark.png`, fullPage: true });
  console.log('sc_09_unwired_not_wired_dark.png');

  // 7. ── Light-mode replay — 3 panes ────────────────────────────────────
  await setTheme(page, 'light');

  await clickLeaf(page, 'Feature Flags');
  await page.waitForTimeout(1500);
  await setTheme(page, 'light');
  await page.screenshot({ path: `${SHOT_DIR}/sc_10_feature_flags_list_light.png`, fullPage: true });
  console.log('sc_10_feature_flags_list_light.png');

  await clickLeaf(page, 'Audit Logs');
  await page.waitForTimeout(2000);
  await setTheme(page, 'light');
  await page.screenshot({ path: `${SHOT_DIR}/sc_11_audit_logs_table_light.png`, fullPage: true });
  console.log('sc_11_audit_logs_table_light.png');

  await clickLeaf(page, 'System Health');
  await page.waitForTimeout(2200);
  await setTheme(page, 'light');
  await page.screenshot({ path: `${SHOT_DIR}/sc_12_system_health_dashboard_light.png`, fullPage: true });
  console.log('sc_12_system_health_dashboard_light.png');

  // Restore dark.
  await setTheme(page, 'dark');

  await browser.close();
})().catch((e) => {
  console.error('CRASH:', e.message);
  process.exit(1);
});
