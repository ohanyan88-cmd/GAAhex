// verify_crm_polish.js — CRM section design-polish proof.
//
// Captures the 13 CRM & Commercial pages (Leads, Opportunities, Customers,
// Accounts, Contacts, Quotes, Contracts, Product Catalog, Promotions,
// Segments, Loyalty, Campaigns, Partners) in both light and dark themes
// (26 PNGs minimum).
//
// Validates the design-quality polish pass: section-page container +
// page-header + iconographic empty states + shared KPITile / RecordDrawer
// reuse. NOT a functional test — assertions are visual only.
//
// Run:
//   cd C:\Users\Admin\Desktop\Portal && node verify_crm_polish.js
//
// Requires:
//   - Frontend dev server at http://localhost:5173
//   - Backend at http://127.0.0.1:8099 (admin@demo.isp / admin123)

const { chromium } = require('playwright');
const fs = require('fs');

const SHOT_DIR = 'C:/Users/Admin/Desktop/Portal/screenshots';
if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });

// Sidebar labels (from frontend/src/lib/nav-config.ts §CRM).
const PAGES = [
  { label: 'Leads',           slug: 'leads' },
  { label: 'Opportunities',   slug: 'opportunities' },
  { label: 'Customers',       slug: 'customers' },
  { label: 'Accounts',        slug: 'accounts' },
  { label: 'Contacts',        slug: 'contacts' },
  { label: 'Quotes',          slug: 'quotes' },
  { label: 'Contracts',       slug: 'contracts' },
  { label: 'Product Catalog', slug: 'products' },
  { label: 'Promotions',      slug: 'promotions' },
  { label: 'Segments',        slug: 'segments' },
  { label: 'Loyalty',         slug: 'loyalty' },
  { label: 'Campaigns',       slug: 'campaigns' },
  { label: 'Partners',        slug: 'partners' },
];

async function expandCrm(page) {
  // CRM section is collapsed by default. Click the section header to open it.
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.sb-sec-btn')];
    const crm = btns.find((b) => (b.textContent || '').includes('CRM'));
    if (crm && !crm.classList.contains('open')) crm.click();
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
  return `crm_${seq}_${slug}_${theme}.png`;
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

  // Open the CRM section in the sidebar.
  await expandCrm(page);

  // 2. Loop through each theme + page combination.
  for (const theme of ['light', 'dark']) {
    await setTheme(page, theme);
    await expandCrm(page); // ensure still open after theme toggle

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
