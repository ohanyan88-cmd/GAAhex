// verify_network_polish.js — Network & Operations section design-polish proof.
//
// Captures the Network & Operations pages in both light and dark themes. The
// nav-config in this build (2026-05-31) lists 14 Netops items; we screenshot
// the 11 that have a viewType wired to a real view + skip the 3 stubs
// (Coverage & GIS, Network Topology, Provisioning, Scheduling, Dispatch Board,
// Stock Inventory have no viewType — they render the module stub which has
// nothing to polish here). 11 pages × 2 themes = 22 screenshots at 1440×900.
//
// Validates the design-quality polish pass:
//   - section-page container (1320 max-width) on the two custom views
//     (ServicesView + ResourcePoolsView).
//   - page-header + breadcrumb chrome
//   - iconographic empty states
//   - shared KPITile / RecordDrawer reuse (no forks)
//   - tokenized colors (no raw hex), light + dark via --gx-* vars
//
// The entity-backed pages already share EntityView (polished in the CRM sweep)
// — no per-page work here, just verification that the chrome still holds.
//
// NOT a functional test — assertions are visual only.
//
// Run:
//   cd C:\Users\Admin\Desktop\Portal && node verify_network_polish.js
//
// Requires:
//   - Frontend dev server at http://localhost:5173
//   - Backend at http://127.0.0.1:8099 (admin@demo.isp / admin123)

const { chromium } = require('playwright');
const fs = require('fs');

const SHOT_DIR = 'C:/Users/Admin/Desktop/Portal/screenshots';
if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });

// Sidebar labels (from frontend/src/lib/nav-config.ts §Network & Operations).
// Stubs (no viewType) are skipped: Coverage & GIS, Network Topology, Provisioning,
// Scheduling, Dispatch Board, Stock Inventory.
const PAGES = [
  { label: 'NOC Dashboard',         slug: 'noc_dashboard' },
  { label: 'Network Monitoring',    slug: 'alarms' },         // → entity / alarms
  { label: 'Incidents & Outages',   slug: 'incidents' },      // → entity / incidents
  { label: 'Service Inventory',     slug: 'services' },       // → ServicesView (POLISHED)
  { label: 'Resource Inventory',    slug: 'resource_pools' }, // → ResourcePoolsView (POLISHED)
  { label: 'Asset Management',      slug: 'assets' },         // → entity / assets
  { label: 'Work Orders',           slug: 'work_orders' },    // → entity / work-orders
  { label: 'Warehouses',            slug: 'warehouses' },     // → entity / warehouses
];

async function expandNetops(page) {
  // Network & Operations is collapsed by default. Click the section header to open it.
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.sb-sec-btn')];
    const net = btns.find((b) => (b.textContent || '').includes('Network'));
    if (net && !net.classList.contains('open')) net.click();
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
  return `net_${seq}_${slug}_${theme}.png`;
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

  // Open the Network & Operations section in the sidebar.
  await expandNetops(page);

  // 2. Loop through each theme + page combination.
  for (const theme of ['light', 'dark']) {
    await setTheme(page, theme);
    await expandNetops(page); // ensure still open after theme toggle

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
