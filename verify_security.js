// verify_security.js — Module 1 (Security) screenshot proof.
//
// Walks the Studio Security group → Roles, Permissions, Users — screenshots each
// pane. For Users, also opens the detail drawer of the first user so the role
// chips are captured.
//
// Run:
//   cd C:\Users\Admin\Desktop\Portal\frontend && node ../verify_security.js
//
// Requires:
//   - Frontend dev server at http://localhost:5173
//   - Backend at http://127.0.0.1:8099
//   - admin@demo.isp / admin123 seeded (default dev seed)

const { chromium } = require('playwright');
const fs = require('fs');

const SHOT_DIR = 'C:/Users/Admin/Desktop/Portal/screenshots';
if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });

async function openStudio(page) {
  // The Studio entry button lives in .sb-foot (the bottom of the left sidebar) — it
  // is the gear/wand that opens the Studio shell. App.tsx line 380-391.
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
  await page.screenshot({ path: `${SHOT_DIR}/sec_00_studio_landing.png`, fullPage: false });
  console.log('sec_00_studio_landing.png');

  // 3. Expand Security and visit each leaf.
  await expandGroup(page, 'Security');

  // Roles.
  await clickLeaf(page, 'Roles');
  await page.screenshot({ path: `${SHOT_DIR}/sec_01_roles.png`, fullPage: false });
  console.log('sec_01_roles.png');

  // Permissions (rich pane: full matrix).
  await clickLeaf(page, 'Permissions');
  await page.screenshot({ path: `${SHOT_DIR}/sec_02_permissions.png`, fullPage: true });
  console.log('sec_02_permissions.png (fullPage)');

  // Users (list).
  await clickLeaf(page, 'Users');
  await page.screenshot({ path: `${SHOT_DIR}/sec_03_users_list.png`, fullPage: false });
  console.log('sec_03_users_list.png');

  // Users — open detail drawer of first row.
  await page.evaluate(() => {
    const firstRow = document.querySelector('table.grid tbody tr');
    if (firstRow) firstRow.click();
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOT_DIR}/sec_04_users_detail.png`, fullPage: true });
  console.log('sec_04_users_detail.png (fullPage)');

  await browser.close();
})().catch((e) => {
  console.error('CRASH:', e.message);
  process.exit(1);
});
