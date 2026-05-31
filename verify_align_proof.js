// verify_align_proof.js — machine-readable proof that header cells sit directly over body cells.
//
// For each target page:
//   1. Navigates there
//   2. Captures a screenshot of the table area
//   3. Uses page.evaluate to measure getBoundingClientRect of every <th> and the corresponding
//      first-row <td>, and prints a table with header_text | th_left | th_right | td_left | td_right | aligned
//   4. Captures a second "overlay" screenshot with red rectangles drawn where alignment differs > 2px.
//
// Usage:
//   node verify_align_proof.js before
//   node verify_align_proof.js after
//
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SHOT_DIR = 'C:/Users/Admin/Desktop/Portal/screenshots';
if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });

const phase = process.argv[2] || 'check';

async function setTheme(p, theme) {
  await p.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('gx-theme', t); } catch {}
  }, theme);
  await p.waitForTimeout(300);
}

async function expandAll(p) {
  await p.evaluate(() =>
    document.querySelectorAll('.sb-sec-btn:not(.open)').forEach((b) => b.click()),
  );
  await p.waitForTimeout(300);
}

async function clickSidebar(p, label) {
  await expandAll(p);
  await p.evaluate((l) => {
    const el = [...document.querySelectorAll('.sb-item')].find(
      (e) => e.innerText.trim() === l,
    );
    if (el) el.click();
  }, label);
  await p.waitForTimeout(2200);
}

async function measure(p, label) {
  return p.evaluate((lbl) => {
    const grids = document.querySelectorAll('.grid-wrap table.grid');
    if (!grids.length) return { label: lbl, error: 'no .grid found' };
    const tbl = grids[0];
    const ths = [...tbl.querySelectorAll('thead tr:first-child th')];
    const firstRow = tbl.querySelector('tbody tr');
    if (!firstRow) return { label: lbl, error: 'no body row' };
    const tds = [...firstRow.querySelectorAll('td')];

    const pairs = [];
    const maxLen = Math.max(ths.length, tds.length);
    for (let i = 0; i < maxLen; i++) {
      const th = ths[i];
      const td = tds[i];
      const thRect = th ? th.getBoundingClientRect() : null;
      const tdRect = td ? td.getBoundingClientRect() : null;
      const text = (th && th.innerText.trim()) || (th && th.getAttribute('aria-label')) || '(blank)';
      const aligned =
        thRect && tdRect &&
        Math.abs(thRect.left - tdRect.left) < 2 &&
        Math.abs(thRect.right - tdRect.right) < 2;
      pairs.push({
        idx: i,
        header_text: text,
        th_left: thRect ? Math.round(thRect.left) : null,
        th_right: thRect ? Math.round(thRect.right) : null,
        td_left: tdRect ? Math.round(tdRect.left) : null,
        td_right: tdRect ? Math.round(tdRect.right) : null,
        aligned: !!aligned,
      });
    }
    return { label: lbl, th_count: ths.length, td_count: tds.length, pairs };
  }, label);
}

function printTable(result) {
  console.log('\n=== ' + result.label + ' ===');
  if (result.error) {
    console.log('  ERROR: ' + result.error);
    return false;
  }
  console.log(`  th_count=${result.th_count} td_count=${result.td_count}`);
  console.log(
    'idx | header                          | th_l | th_r | td_l | td_r | aligned',
  );
  console.log(
    '----+----------------------------------+------+------+------+------+--------',
  );
  let allOk = true;
  for (const p of result.pairs) {
    const txt = (p.header_text || '').padEnd(32).slice(0, 32);
    const al = p.aligned ? 'YES' : 'NO ';
    if (!p.aligned) allOk = false;
    console.log(
      ` ${String(p.idx).padStart(2)} | ${txt} | ${String(p.th_left).padStart(4)} | ${String(p.th_right).padStart(4)} | ${String(p.td_left).padStart(4)} | ${String(p.td_right).padStart(4)} | ${al}`,
    );
  }
  console.log(`  RESULT: ${allOk ? 'ALL ALIGNED' : 'DRIFT DETECTED'}`);
  return allOk;
}

async function overlayScreenshot(p, outFile) {
  // Mark headers + first-row cells with absolute-positioned outlines
  await p.evaluate(() => {
    const old = document.querySelectorAll('._overlay_mark');
    old.forEach((n) => n.remove());
    const grids = document.querySelectorAll('.grid-wrap table.grid');
    if (!grids.length) return;
    const tbl = grids[0];
    const ths = [...tbl.querySelectorAll('thead tr:first-child th')];
    const firstRow = tbl.querySelector('tbody tr');
    if (!firstRow) return;
    const tds = [...firstRow.querySelectorAll('td')];
    const maxLen = Math.max(ths.length, tds.length);
    for (let i = 0; i < maxLen; i++) {
      const th = ths[i];
      const td = tds[i];
      if (th) {
        const r = th.getBoundingClientRect();
        const m = document.createElement('div');
        m.className = '_overlay_mark';
        m.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;outline:2px solid rgba(0,140,255,0.85);outline-offset:-2px;pointer-events:none;z-index:99998;`;
        document.body.appendChild(m);
      }
      if (td) {
        const r = td.getBoundingClientRect();
        const m = document.createElement('div');
        m.className = '_overlay_mark';
        const aligned = th && Math.abs(th.getBoundingClientRect().left - r.left) < 2 && Math.abs(th.getBoundingClientRect().right - r.right) < 2;
        const color = aligned ? 'rgba(20,180,80,0.85)' : 'rgba(255,40,40,0.95)';
        m.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;outline:2px dashed ${color};outline-offset:-2px;pointer-events:none;z-index:99999;`;
        document.body.appendChild(m);
      }
    }
  });
  await p.waitForTimeout(150);
  await p.screenshot({ path: outFile, fullPage: false });
  await p.evaluate(() => document.querySelectorAll('._overlay_mark').forEach((n) => n.remove()));
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

  const summary = [];
  const targets = [
    { label: 'Invoices', file: 'invoices' },
    { label: 'Customers', file: 'customers' },
    { label: 'Orders', file: 'orders' },
    { label: 'Subscriptions', file: 'subs' },
    { label: 'Helpdesk', file: 'helpdesk' },
  ];

  for (const t of targets) {
    for (const theme of ['light', 'dark']) {
      await clickSidebar(page, t.label);
      await setTheme(page, theme);
      await page.waitForTimeout(800);
      // Capture plain screenshot
      const plain = `${SHOT_DIR}/align_real_${phase}_${t.file}_${theme}.png`;
      await page.screenshot({ path: plain, fullPage: false });
      // Overlay screenshot
      const overlay = `${SHOT_DIR}/align_real_${phase}_${t.file}_${theme}_overlay.png`;
      await overlayScreenshot(page, overlay);
      // Measure
      const result = await measure(page, `${t.label} (${theme}) — ${phase}`);
      const ok = printTable(result);
      summary.push({ page: t.label, theme, ok, plain, overlay });
    }
  }

  console.log('\n\n========== SUMMARY ==========');
  for (const s of summary) {
    console.log(`${s.ok ? 'PASS' : 'FAIL'}  ${s.page.padEnd(10)} ${s.theme}   ${s.plain}`);
  }
  const allOk = summary.every((s) => s.ok);
  console.log(`\nOVERALL: ${allOk ? 'PASS' : 'FAIL'}`);

  await browser.close();
  process.exit(allOk ? 0 : 1);
})().catch((e) => {
  console.error('CRASH:', e.message);
  console.error(e.stack);
  process.exit(1);
});
