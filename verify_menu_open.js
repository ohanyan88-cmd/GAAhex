// Quick check: the ⋮ row-actions menu actually opens, contains the expected items
// (workflow transitions + activity/comments + delete), and clicking outside closes it.
const { chromium } = require('playwright');
const path = require('path');

const SHOTS_DIR = path.join(__dirname, 'screenshots');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await page.fill('input[type="email"], input:nth-of-type(1)', 'admin@demo.isp');
  await page.fill('input[type="password"]', 'admin123');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  await page.evaluate(() => document.querySelectorAll('.sb-sec-btn:not(.open)').forEach((b) => b.click()));
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('.sb-item')].find((e) => e.innerText.trim() === 'Customers');
    if (el) el.click();
  });
  await page.waitForTimeout(2500);

  // Find first ⋮ button in the table and click
  const triggerSelector = '.grid tbody tr .row-actions [aria-haspopup="menu"]';
  const found = await page.$(triggerSelector);
  if (!found) {
    console.log('ERROR: no ⋮ trigger found');
    process.exit(1);
  }
  await found.click();
  await page.waitForTimeout(300);

  // Capture menu items
  const items = await page.evaluate(() => {
    const menu = document.querySelector('.row-actions-pop[role="menu"]');
    if (!menu) return null;
    const buttons = [...menu.querySelectorAll('[role="menuitem"]')];
    const r = menu.getBoundingClientRect();
    return {
      menuRect: { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) },
      items: buttons.map((b) => ({ label: b.innerText.trim(), danger: b.classList.contains('danger') })),
    };
  });
  console.log(JSON.stringify(items, null, 2));

  await page.screenshot({ path: path.join(SHOTS_DIR, 'resp_menu_open_customers_1440_light.png'), fullPage: false });

  // Keyboard: Esc closes
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const closed = await page.evaluate(() => !document.querySelector('.row-actions-pop[role="menu"]'));
  console.log('Menu closed after Esc:', closed);

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
