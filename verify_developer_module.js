// verify_developer_module.js — Task 3 Module 4 (Developer) screenshot proof.
//
// Drives the Studio Developer group:
//   1. Webhooks    → list + KPI strip + create modal (Studio-shaped WebhooksPane)
//   2. API Docs    → live OpenAPI spec rendered as a tag-grouped browser
//   3. Custom Code → an unwired Developer leaf, "Not yet wired" empty state
//   4. Theme flip  → dark replay of Webhooks + API Docs
//
// Run:
//   cd C:\Users\Admin\Desktop\Portal\frontend && node ../verify_developer_module.js
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

  // 2. Open Studio + expand Developer.
  await openStudio(page);
  await expandGroup(page, 'Developer');
  await page.waitForTimeout(400);

  // 3. Webhooks pane — list view (dark theme = the app's default).
  await clickLeaf(page, 'Webhooks');
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${SHOT_DIR}/dev_01_webhooks_list_dark.png`, fullPage: true });
  console.log('dev_01_webhooks_list_dark.png');

  // 4. Open the "New webhook" create modal.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(
      (b) => /New webhook/i.test(b.textContent || ''),
    );
    if (btn) btn.click();
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOT_DIR}/dev_02_webhooks_create_modal_dark.png`, fullPage: true });
  console.log('dev_02_webhooks_create_modal_dark.png');

  // Close modal — click outside.
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const closeBtn = [...document.querySelectorAll('button[aria-label="Close"]')].pop();
    if (closeBtn) closeBtn.click();
  });
  await page.waitForTimeout(400);

  // 5. API Docs leaf — live OpenAPI spec viewer.
  await clickLeaf(page, 'API Docs');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOT_DIR}/dev_03_apidocs_overview_dark.png`, fullPage: true });
  console.log('dev_03_apidocs_overview_dark.png');

  // 6. Expand the first endpoint in the auth tag to show parameters / responses.
  await page.evaluate(() => {
    // Click the "auth" tag chip if present to focus the auth group.
    const chip = [...document.querySelectorAll('button')].find(
      (b) => /^auth \(/i.test((b.textContent || '').trim()),
    );
    if (chip) chip.click();
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    // Click the first endpoint row to expand it.
    const row = document.querySelector('button[aria-expanded="false"]');
    if (row) row.click();
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOT_DIR}/dev_04_apidocs_endpoint_expanded_dark.png`, fullPage: true });
  console.log('dev_04_apidocs_endpoint_expanded_dark.png');

  // Reset to "All" tag.
  await page.evaluate(() => {
    const all = [...document.querySelectorAll('button')].find(
      (b) => /^All \(\d+\)/i.test((b.textContent || '').trim()),
    );
    if (all) all.click();
  });
  await page.waitForTimeout(400);

  // 7. Custom Code leaf — confirm the "Not yet wired" empty state for an unwired leaf.
  await clickLeaf(page, 'Custom Code');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOT_DIR}/dev_05_customcode_not_wired_dark.png`, fullPage: true });
  console.log('dev_05_customcode_not_wired_dark.png');

  // 8. Light-mode replay — Webhooks list + API Docs.
  await setTheme(page, 'light');
  await clickLeaf(page, 'Webhooks');
  await page.waitForTimeout(1200);
  await setTheme(page, 'light');
  await page.screenshot({ path: `${SHOT_DIR}/dev_06_webhooks_list_light.png`, fullPage: true });
  console.log('dev_06_webhooks_list_light.png');

  await clickLeaf(page, 'API Docs');
  await page.waitForTimeout(2000);
  await setTheme(page, 'light');
  await page.screenshot({ path: `${SHOT_DIR}/dev_07_apidocs_overview_light.png`, fullPage: true });
  console.log('dev_07_apidocs_overview_light.png');

  // Restore dark.
  await setTheme(page, 'dark');

  await browser.close();
})().catch((e) => {
  console.error('CRASH:', e.message);
  process.exit(1);
});
