// verify_workspace_polish.js — Workspace section design-polish proof.
//
// Captures the six Workspace pages (Home, My Tasks, My Approvals, Calendar,
// Activity Feed, Saved Views) in both light and dark themes (12 PNGs minimum).
//
// Validates the design-quality polish pass: kit-standard containers + the
// redesigned Activity Feed (avatars + per-action-type badges + day grouping +
// humanized text). NOT a functional test — the assertions are visual only.
//
// Run:
//   cd C:\Users\Admin\Desktop\Portal\frontend && node ../verify_workspace_polish.js
//
// Requires:
//   - Frontend dev server at http://localhost:5173
//   - Backend at http://127.0.0.1:8099 (admin@demo.isp / admin123)

const { chromium } = require('playwright');
const fs = require('fs');

const SHOT_DIR = 'C:/Users/Admin/Desktop/Portal/screenshots';
if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });

const PAGES = [
  { label: 'Home',          slug: 'home',          nav: 'Home' },
  { label: 'My Tasks',      slug: 'mytasks',       nav: 'My Tasks' },
  { label: 'My Approvals',  slug: 'myapprovals',   nav: 'My Approvals' },
  { label: 'Calendar',      slug: 'calendar',      nav: 'Calendar' },
  { label: 'Activity Feed', slug: 'activityfeed',  nav: 'Activity Feed' },
  { label: 'Saved Views',   slug: 'savedviews',    nav: 'Saved Views' },
];

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
  // Toggle via the app's theme button if present, else set localStorage and
  // force the data-theme attr (React's useEffect will overwrite once on mount,
  // so we re-set just before screenshotting).
  await page.evaluate((t) => {
    localStorage.setItem('gaaex-theme', t);
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
  await page.waitForTimeout(250);
  // Set 3 more times across short delays — App.tsx's effect runs once on
  // render, then we win after that.
  for (let i = 0; i < 3; i++) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await page.waitForTimeout(150);
  }
}

let idx = 0;
function shotName(slug, theme) {
  idx++;
  const seq = String(idx).padStart(2, '0');
  return `ws_${seq}_${slug}_${theme}.png`;
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

  // Workspace section is defaultOpen, so the items are already visible in the sidebar.
  // Loop through each theme + page combination.
  for (const theme of ['light', 'dark']) {
    await setTheme(page, theme);

    for (const p of PAGES) {
      await clickNav(page, p.nav);
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
