// verify_table_align.js — table header/body alignment proof.
//
// Walks 4 list pages (Customers, Invoices, Devices, Studio→Security→Users), screenshots
// each in BOTH light + dark themes. Pass `before` / `after` as argv[2] to name the files.
//
// Run:
//   cd C:\Users\Admin\Desktop\Portal\frontend && node ../verify_table_align.js before
//   cd C:\Users\Admin\Desktop\Portal\frontend && node ../verify_table_align.js after
//
// Requires the frontend dev server at http://localhost:5173 and the backend at port 8099.
const { chromium } = require('playwright');
const fs = require('fs');

const SHOT_DIR = 'C:/Users/Admin/Desktop/Portal/screenshots';
if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });

const phase = process.argv[2] || 'check';

const PAGES = [
  { label: 'Customers', file: 'customers' },
  { label: 'Invoices',  file: 'invoices'  },
  { label: 'Devices',   file: 'devices'   },
  // Studio→Security→Users handled separately below
];

async function expandAll(p) {
  await p.evaluate(() => document.querySelectorAll('.sb-sec-btn:not(.open)').forEach(b => b.click()));
  await p.waitForTimeout(400);
}

async function goSidebar(p, label) {
  await expandAll(p);
  await p.evaluate((l) => {
    const el = [...document.querySelectorAll('.sb-item')].find((e) => e.innerText.trim() === l);
    if (el) el.click();
  }, label);
  await p.waitForTimeout(2500);
}

async function openStudio(p) {
  await p.evaluate(() => {
    const btn = document.querySelector('.sb-foot .sb-item');
    if (btn) btn.click();
  });
  await p.waitForTimeout(2200);
}

async function expandStudioGroup(p, label) {
  await p.evaluate((g) => {
    const btn = [...document.querySelectorAll('.tree-g')].find(
      (b) => (b.textContent || '').trim().startsWith(g),
    );
    if (btn && !btn.classList.contains('open')) btn.click();
  }, label);
  await p.waitForTimeout(400);
}

async function clickStudioLeaf(p, label) {
  await p.evaluate((l) => {
    const btn = [...document.querySelectorAll('.tree-leaf')].find(
      (b) => (b.textContent || '').trim() === l,
    );
    if (btn) btn.click();
  }, label);
  await p.waitForTimeout(2200);
}

async function setTheme(p, theme) {
  // Theme toggle: html[data-theme] attribute. The app exposes window.__gxSetTheme in dev.
  // We set it directly via localStorage + reload-less attribute swap.
  await p.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('gx-theme', t); } catch {}
  }, theme);
  await p.waitForTimeout(300);
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--window-size=1440,900'] });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await page.fill('input:nth-of-type(1)', 'admin@demo.isp');
  await page.fill('input[type="password"]', 'admin123');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3500);

  for (const theme of ['light', 'dark']) {
    await setTheme(page, theme);

    for (const pg of PAGES) {
      await goSidebar(page, pg.label);
      await setTheme(page, theme);  // re-apply after nav in case it resets
      await page.waitForTimeout(600);
      const shot = `${SHOT_DIR}/align_${phase}_${pg.file}_${theme}.png`;
      await page.screenshot({ path: shot, fullPage: false });
      console.log(`${phase}/${theme}/${pg.label}: ${shot}`);
    }

    // Studio → Security → Users
    await openStudio(page);
    await setTheme(page, theme);
    await expandStudioGroup(page, 'Security');
    await clickStudioLeaf(page, 'Users');
    await setTheme(page, theme);
    await page.waitForTimeout(600);
    const shot = `${SHOT_DIR}/align_${phase}_studio_users_${theme}.png`;
    await page.screenshot({ path: shot, fullPage: false });
    console.log(`${phase}/${theme}/Studio Users: ${shot}`);

    // Close Studio so the next theme loop starts back at sidebar mode.
    await page.evaluate(() => {
      const closer = document.querySelector('.gx-studio-close, .studio-close, button[aria-label*="Close"]');
      if (closer) closer.click();
    });
    await page.waitForTimeout(500);
    // Fallback: press Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  await browser.close();
})().catch((e) => { console.error('CRASH:', e.message); process.exit(1); });
