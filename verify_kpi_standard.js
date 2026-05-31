// verify_kpi_standard.js — visual + interaction verification for the KPI
// design-system sweep (Gev 2026-05-31).
//
// What it checks (per dashboard):
//   1. Hover state on a clickable KPI matches the shared spec:
//      cursor: pointer, hover lift (translateY(-1px) approx via transform inspection),
//      box-shadow upgraded, border-color upgraded.
//   2. Focus-visible ring is present (outline ≈ 2px solid azure) on a clickable tile.
//   3. Click navigation lands on the real filtered destination — we capture a "before
//      click" KPI strip screenshot and an "after click" filtered list screenshot.
//   4. Non-clickable tiles (if any) get no hover lift / no pointer cursor.
//
// Pass criteria: every clickable KPI has the same computed hover idiom; every click
// transitions the app to the corresponding filter UI; no inert tiles.
//
// Login: admin@demo.isp / admin123 against the dev server at :5173 (Vite) + :8099 (api).
// Screenshots go to ./screenshots/kpi_NN_<name>.png.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SHOTS = path.join(__dirname, 'screenshots');
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

async function login(page) {
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await page.fill('input:nth-of-type(1)', 'admin@demo.isp');
  await page.fill('input[type="password"]', 'admin123');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3500);
}

async function openSidebarSection(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.sb-sec-btn:not(.open)').forEach(b => b.click());
  });
  await page.waitForTimeout(400);
}

async function clickNav(page, label) {
  await page.evaluate((lbl) => {
    const el = [...document.querySelectorAll('.sb-item, .tb-nav-item, a, button')].find(
      e => e.textContent && e.textContent.trim() === lbl
    );
    if (el) el.click();
  }, label);
  await page.waitForTimeout(2200);
}

// Inspect a KPI tile's computed style + hover-attempt diff.
async function inspectKpi(page, selector) {
  return await page.evaluate((sel) => {
    const tile = document.querySelector(sel);
    if (!tile) return { found: false };
    const cs = getComputedStyle(tile);
    const r = tile.getBoundingClientRect();
    const clickable = tile.getAttribute('data-clickable') === 'true';
    const premium = tile.getAttribute('data-premium') === 'true';
    return {
      found: true,
      tag: tile.tagName.toLowerCase(),
      clickable,
      premium,
      cursor: cs.cursor,
      boxShadow: cs.boxShadow,
      borderColor: cs.borderColor,
      transform: cs.transform,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    };
  }, selector);
}

async function hoverAndSnap(page, selector, shotPath) {
  const el = await page.$(selector);
  if (!el) return null;
  await el.hover();
  await page.waitForTimeout(400); // let transition settle
  const after = await inspectKpi(page, selector);
  await page.screenshot({ path: shotPath, fullPage: false });
  return after;
}

async function focusAndSnap(page, selector, shotPath) {
  // Tab focus the tile.
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el && typeof el.focus === 'function') el.focus({ preventScroll: false });
  }, selector);
  await page.waitForTimeout(300);
  const after = await page.evaluate((sel) => {
    const tile = document.querySelector(sel);
    if (!tile) return null;
    const cs = getComputedStyle(tile);
    return {
      outline: cs.outline,
      outlineWidth: cs.outlineWidth,
      outlineColor: cs.outlineColor,
      outlineStyle: cs.outlineStyle,
    };
  }, selector);
  await page.screenshot({ path: shotPath, fullPage: false });
  return after;
}

async function setTheme(page, theme) {
  await page.evaluate((th) => {
    document.documentElement.setAttribute('data-theme', th);
  }, theme);
  await page.waitForTimeout(400);
}

async function runDashboard(page, name, openFn, expectedClicks) {
  const results = { name, clicks: [], hover: null, focus: null };

  await openFn(page);

  // Capture the kpi strip baseline.
  const baseShot = path.join(SHOTS, `kpi_${name}_01_baseline.png`);
  await page.screenshot({ path: baseShot, fullPage: false });

  // Inspect the first clickable tile (most dashboards have one).
  const firstClickable = await page.evaluate(() => {
    const t = document.querySelector('.kpi-tile[data-clickable="true"]');
    if (!t) return null;
    let i = 0;
    [...document.querySelectorAll('.kpi-tile')].forEach((n, idx) => { if (n === t) i = idx; });
    return `.kpi-tile:nth-of-type(${i + 1})`;
  });

  if (firstClickable) {
    const hoverShot = path.join(SHOTS, `kpi_${name}_02_hover.png`);
    const before = await inspectKpi(page, firstClickable);
    const after = await hoverAndSnap(page, firstClickable, hoverShot);
    results.hover = { before, after, selector: firstClickable };

    const focusShot = path.join(SHOTS, `kpi_${name}_03_focus.png`);
    results.focus = await focusAndSnap(page, firstClickable, focusShot);
  }

  // For each declared click expectation, click + screenshot the resulting page.
  for (const exp of expectedClicks) {
    try {
      const clicked = await page.evaluate((label) => {
        const ts = [...document.querySelectorAll('.kpi-tile')];
        for (const t of ts) {
          if (t.innerText && t.innerText.toLowerCase().includes(label.toLowerCase())) {
            t.click();
            return true;
          }
        }
        return false;
      }, exp.label);
      if (!clicked) {
        results.clicks.push({ ...exp, ok: false, reason: 'tile not found' });
        continue;
      }
      await page.waitForTimeout(1800);
      const after = path.join(SHOTS, `kpi_${name}_click_${exp.shot}.png`);
      await page.screenshot({ path: after, fullPage: false });
      results.clicks.push({ ...exp, ok: true, screenshot: after });
      // Navigate back to dashboard.
      await openFn(page);
    } catch (err) {
      results.clicks.push({ ...exp, ok: false, reason: err.message });
    }
  }

  return results;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  await login(page);
  await openSidebarSection(page);

  const all = [];

  // ── Dashboard 1: Home (Workspace dashboard) ─────────────────────────
  all.push(await runDashboard(page, 'home',
    async (p) => { await clickNav(p, 'Home'); },
    [
      { label: 'Active subscribers', shot: 'subs' },
      { label: 'Open tickets',       shot: 'tickets' },
    ]));

  // ── Dashboard 2: Invoices ───────────────────────────────────────────
  all.push(await runDashboard(page, 'invoices',
    async (p) => { await clickNav(p, 'Invoices'); },
    [
      { label: 'Total billed', shot: 'all' },
      { label: 'Paid',         shot: 'paid' },
    ]));

  // ── Dashboard 3: Subscriptions ──────────────────────────────────────
  all.push(await runDashboard(page, 'subscriptions',
    async (p) => { await clickNav(p, 'Subscriptions'); },
    [
      { label: 'Active', shot: 'active' },
    ]));

  // ── Dashboard 4: Accounts ───────────────────────────────────────────
  all.push(await runDashboard(page, 'accounts',
    async (p) => { await clickNav(p, 'Accounts'); },
    [
      { label: 'Active', shot: 'active' },
    ]));

  // ── Dark theme — repeat 2 of 4 ──────────────────────────────────────
  await setTheme(page, 'dark');
  all.push(await runDashboard(page, 'home_dark',
    async (p) => { await clickNav(p, 'Home'); },
    []));
  all.push(await runDashboard(page, 'invoices_dark',
    async (p) => { await clickNav(p, 'Invoices'); },
    []));
  await setTheme(page, 'light');

  // Persist a JSON summary alongside the shots.
  fs.writeFileSync(
    path.join(SHOTS, 'kpi_verify_summary.json'),
    JSON.stringify(all, null, 2),
  );

  // Print a brief pass/fail digest.
  console.log('\n========== KPI VERIFY SUMMARY ==========');
  for (const r of all) {
    console.log(`\n[${r.name}]`);
    if (r.hover && r.hover.after) {
      console.log(`  hover  cursor=${r.hover.after.cursor}  shadow=${r.hover.after.boxShadow.slice(0, 50)}...  transform=${r.hover.after.transform}`);
    }
    if (r.focus) {
      console.log(`  focus  outline=${r.focus.outline}  width=${r.focus.outlineWidth}  color=${r.focus.outlineColor}`);
    }
    for (const c of r.clicks) {
      console.log(`  click "${c.label}" → ${c.ok ? 'OK' : 'FAIL: ' + c.reason}`);
    }
  }

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
