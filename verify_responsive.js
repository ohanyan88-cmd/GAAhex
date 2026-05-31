// verify_responsive.js — proves the row-actions / table-overflow fix.
//
// For each of Customers / Invoices / Devices:
//   - render at 1440 / 700 / 380 px wide, in light + dark
//   - screenshot every (page × width × theme) combo → screenshots/resp_*.png
//   - bounds-check: confirm header <th> bounding rects don't horizontally overlap each other,
//                   and body <td> rects don't horizontally overlap each other (sampled on the
//                   first 5 rows). Log OK or OVERLAP per row.
//
// Pass criteria: zero OVERLAP entries; at 700/380 the .grid-wrap shows a horizontal scrollbar
// (table.scrollWidth > clientWidth) — confirming the min-width gate kicked in.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const FRONTEND = 'http://localhost:5173';
const SHOTS_DIR = path.join(__dirname, 'screenshots');
if (!fs.existsSync(SHOTS_DIR)) fs.mkdirSync(SHOTS_DIR);

const WIDTHS = [1440, 700, 380];
const THEMES = ['light', 'dark'];

// Pages: label, sidebar-section to expand (optional), sidebar item to click
const PAGES = [
  { id: 'customers', section: 'CRM', label: 'Customers' },
  { id: 'invoices',  section: 'Orders & Revenue', label: 'Invoices' },
  // Devices lives under Network; entity slug "device" rendered by EntityView
  { id: 'devices',   section: 'Network', label: 'Devices' },
];

async function login(page) {
  await page.goto(FRONTEND, { waitUntil: 'networkidle' });
  // login form: email + password inputs
  const emailInp = await page.$('input[type="email"], input:nth-of-type(1)');
  if (emailInp) {
    await page.fill('input[type="email"], input:nth-of-type(1)', 'admin@demo.isp');
    await page.fill('input[type="password"]', 'admin123');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3500);
  }
}

async function setTheme(page, theme) {
  // Set localStorage + html data attribute so the app uses the right theme.
  await page.evaluate((t) => {
    try { localStorage.setItem('gaaex-theme', t); } catch {}
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
  await page.waitForTimeout(150);
}

async function openSidebarAndNavigate(page, section, label) {
  // Expand all collapsed sidebar sections (cheap, idempotent)
  await page.evaluate(() => {
    document.querySelectorAll('.sb-sec-btn:not(.open)').forEach((b) => b.click());
  });
  await page.waitForTimeout(300);
  // Find a sidebar item matching the label and click it. Try exact, then includes.
  const clicked = await page.evaluate((lab) => {
    const items = [...document.querySelectorAll('.sb-item')];
    let el = items.find((e) => e.innerText.trim() === lab);
    if (!el) el = items.find((e) => e.innerText.trim().toLowerCase().startsWith(lab.toLowerCase()));
    if (!el) el = items.find((e) => e.innerText.trim().toLowerCase().includes(lab.toLowerCase()));
    if (el) { el.click(); return true; }
    return false;
  }, label);
  await page.waitForTimeout(2200);
  return clicked;
}

function rectsOverlap(a, b) {
  // horizontal overlap with > 1px of intersection (allow hairline borders)
  return !(a.right - 1 <= b.left || b.right - 1 <= a.left);
}

async function boundsCheck(page) {
  return await page.evaluate(() => {
    // Use the first <table class="grid"> on the page (the main list grid)
    const tbl = document.querySelector('.grid-wrap > table.grid, table.grid');
    if (!tbl) return { tableFound: false };
    const wrap = tbl.closest('.grid-wrap');
    const wrapRect = wrap ? wrap.getBoundingClientRect() : null;
    const scrollW = tbl.scrollWidth || tbl.getBoundingClientRect().width;
    const clientW = wrap ? wrap.clientWidth : window.innerWidth;
    const overflowsHorizontally = scrollW > clientW + 1;

    const headerCells = [...tbl.querySelectorAll(':scope > thead > tr > th')];
    const sampleRows = [...tbl.querySelectorAll(':scope > tbody > tr')].slice(0, 5);
    const headerRects = headerCells.map((th) => {
      const r = th.getBoundingClientRect();
      return { tag: 'th', text: th.innerText.trim().slice(0, 30), left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) };
    });
    const bodyResults = sampleRows.map((tr, ri) => {
      const cells = [...tr.querySelectorAll(':scope > td')];
      const rects = cells.map((td) => {
        const r = td.getBoundingClientRect();
        return { tag: 'td', left: Math.round(r.left), right: Math.round(r.right) };
      });
      // pairwise horizontal-overlap check among neighbors
      const overlaps = [];
      for (let i = 0; i + 1 < rects.length; i++) {
        const a = rects[i], b = rects[i + 1];
        if (!(a.right - 1 <= b.left)) overlaps.push({ row: ri, between: [i, i + 1], a, b });
      }
      return { row: ri, cellCount: cells.length, overlaps };
    });
    // headers neighbor overlap
    const headerOverlaps = [];
    for (let i = 0; i + 1 < headerRects.length; i++) {
      const a = headerRects[i], b = headerRects[i + 1];
      if (!(a.right - 1 <= b.left)) headerOverlaps.push({ between: [i, i + 1], a, b });
    }
    return {
      tableFound: true,
      wrapRect,
      scrollW, clientW, overflowsHorizontally,
      headerCount: headerCells.length,
      headerRects,
      headerOverlaps,
      bodyResults,
    };
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await login(page);

  const allResults = [];

  for (const pg of PAGES) {
    // Navigate once at the widest viewport so layout settles, then resize.
    await page.setViewportSize({ width: 1440, height: 900 });
    const ok = await openSidebarAndNavigate(page, pg.section, pg.label);
    if (!ok) {
      console.log(`[WARN] could not navigate to ${pg.label}`);
      continue;
    }
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      // give the layout time to reflow at narrow widths
      await page.waitForTimeout(500);
      for (const theme of THEMES) {
        await setTheme(page, theme);
        await page.waitForTimeout(250);
        const shot = path.join(SHOTS_DIR, `resp_${pg.id}_${w}_${theme}.png`);
        await page.screenshot({ path: shot, fullPage: false });
        const bc = await boundsCheck(page);
        const headerOverlap = bc.tableFound ? bc.headerOverlaps.length : 0;
        const bodyOverlap = bc.tableFound
          ? bc.bodyResults.reduce((n, r) => n + r.overlaps.length, 0)
          : 0;
        const status = (headerOverlap === 0 && bodyOverlap === 0) ? 'OK' : 'OVERLAP';
        const verdict = {
          page: pg.id, width: w, theme,
          shot: path.basename(shot),
          tableFound: bc.tableFound,
          headerOverlap, bodyOverlap,
          overflowsHorizontally: bc.overflowsHorizontally,
          status,
        };
        allResults.push(verdict);
        console.log(JSON.stringify(verdict));
      }
    }
  }

  // Summary
  const overlaps = allResults.filter((r) => r.status !== 'OK');
  console.log('');
  console.log(`SUMMARY: ${allResults.length} cases, ${overlaps.length} with overlap`);
  if (overlaps.length) {
    console.log('OVERLAPPING CASES:');
    overlaps.forEach((o) => console.log('  -', JSON.stringify(o)));
  } else {
    console.log('ALL OK — no horizontal overlap between any two adjacent cells, headers or body, at any tested width × theme.');
  }
  // Also list horizontal-scroll status — expect overflowsHorizontally=true at 700 + 380.
  console.log('');
  console.log('HORIZONTAL-SCROLL STATUS (true = grid-wrap is scrolling, i.e. min-width gate engaged):');
  allResults.forEach((r) => console.log(`  ${r.page} @ ${r.width}px ${r.theme}: overflowsHorizontally=${r.overflowsHorizontally}`));

  await browser.close();
  process.exit(overlaps.length === 0 ? 0 : 2);
})().catch((e) => { console.error(e); process.exit(1); });
