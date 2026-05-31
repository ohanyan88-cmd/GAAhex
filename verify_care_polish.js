// verify_care_polish.js — Customer Care section design-polish proof.
//
// Captures the 9 Customer Care pages (Interactions, Tickets, Helpdesk,
// Complaints, Escalations, SLA Management, Knowledge Base,
// Service Communications, Outbound) in both light and dark themes
// (18 PNGs).
//
// Validates the design-quality polish pass:
//   - section-page container (1320 max-width) on HelpdeskView
//   - page-header + breadcrumb chrome
//   - iconographic empty states
//   - shared KPITile / RecordDrawer reuse on EntityView (6 of 9 pages)
//   - tokenized colors (no raw hex), light + dark via --gx-* vars
//
// NOT a functional test — assertions are visual only.
//
// Run:
//   cd C:\Users\Admin\Desktop\Portal && node verify_care_polish.js
//
// Requires:
//   - Frontend dev server at http://localhost:5173
//   - Backend at http://127.0.0.1:8099 (admin@demo.isp / admin123)

const { chromium } = require('playwright');
const fs = require('fs');

const SHOT_DIR = 'C:/Users/Admin/Desktop/Portal/screenshots';
if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });

// Sidebar labels (from frontend/src/lib/nav-config.ts §Customer Care).
const PAGES = [
  { label: 'Interactions',            slug: 'interactions' },
  { label: 'Tickets',                 slug: 'tickets' },
  { label: 'Helpdesk',                slug: 'helpdesk' },
  { label: 'Complaints',              slug: 'complaints' },
  { label: 'Escalations',             slug: 'escalations' },
  { label: 'SLA Management',          slug: 'sla' },
  { label: 'Knowledge Base',          slug: 'kb' },
  { label: 'Service Communications',  slug: 'communications' },
  { label: 'Outbound',                slug: 'outbound' },
];

async function expandCare(page) {
  // Customer Care section is collapsed by default. Click the section header to open it.
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.sb-sec-btn')];
    const care = btns.find((b) => (b.textContent || '').includes('Customer Care'));
    if (care && !care.classList.contains('open')) care.click();
  });
  await page.waitForTimeout(400);
}

async function clickNav(page, label) {
  await page.evaluate((l) => {
    const btn = [...document.querySelectorAll('.sb-item')].find(
      (b) => (b.textContent || '').trim() === l,
    );
    if (btn) btn.click();
  }, label);
  await page.waitForTimeout(1600);
}

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    localStorage.setItem('gaaex-theme', t);
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
  await page.waitForTimeout(250);
  for (let i = 0; i < 3; i++) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await page.waitForTimeout(150);
  }
}

let idx = 0;
function shotName(slug, theme) {
  idx++;
  const seq = String(idx).padStart(2, '0');
  return `care_${seq}_${slug}_${theme}.png`;
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

  // Open the Customer Care section in the sidebar.
  await expandCare(page);

  // 2. Loop through each theme + page combination.
  for (const theme of ['light', 'dark']) {
    await setTheme(page, theme);
    await expandCare(page); // ensure still open after theme toggle

    for (const p of PAGES) {
      await clickNav(page, p.label);
      await setTheme(page, theme); // re-assert theme in case clicking re-applied
      await page.waitForTimeout(900); // wait for fetches to settle
      const file = shotName(p.slug, theme);
      await page.screenshot({ path: `${SHOT_DIR}/${file}`, fullPage: false });
      console.log(file);
    }
  }

  // Restore dark + close.
  await page.evaluate(() => {
    localStorage.setItem('gaaex-theme', 'dark');
    document.documentElement.setAttribute('data-theme', 'dark');
  });

  await browser.close();
  console.log(`\nCaptured ${idx} screenshots in ${SHOT_DIR}`);
})().catch((e) => {
  console.error('CRASH:', e.message);
  process.exit(1);
});
