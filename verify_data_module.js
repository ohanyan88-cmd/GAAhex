// verify_data_module.js — Module 2 (Data → Models) screenshot proof.
//
// Drives the Studio: Data → Models → Entities (list + create modal + detail drawer),
// then Fields (existing entity), then an unwired Data leaf (e.g. Relationships).
// Also flips into dark mode and re-captures a couple of scenes.
//
// Run:
//   cd C:\Users\Admin\Desktop\Portal\frontend && node ../verify_data_module.js
//
// Requires:
//   - Frontend dev server at http://localhost:5173
//   - Backend at http://127.0.0.1:8099  (GAAEX_DEV_SEED=1 first boot)
//   - admin@demo.isp / admin123

const { chromium } = require('playwright');
const fs = require('fs');

const SHOT_DIR = 'C:/Users/Admin/Desktop/Portal/screenshots';
if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });

async function openStudio(page) {
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

async function expandModule(page, label) {
  await page.evaluate((m) => {
    const btn = [...document.querySelectorAll('.tree-m')].find(
      (b) => (b.textContent || '').trim().startsWith(m),
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
  await page.waitForTimeout(1800);
}

async function setTheme(page, theme /* 'dark' | 'light' */) {
  // App.tsx persists theme to localStorage and re-applies on render. Set both
  // localStorage and the html attr; the React state will catch up on next effect.
  await page.evaluate((t) => {
    localStorage.setItem('gaaex-theme', t);
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
  await page.waitForTimeout(400);
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

  // 2. Open Studio + expand Data → Models.
  await openStudio(page);
  await page.screenshot({ path: `${SHOT_DIR}/data_00_studio_landing.png`, fullPage: false });
  console.log('data_00_studio_landing.png');

  await expandGroup(page, 'Data');
  await expandModule(page, 'Models');
  await page.waitForTimeout(400);

  // 3. Entities pane — list view, before create.
  await clickLeaf(page, 'Entities');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SHOT_DIR}/data_01_entities_list_light.png`, fullPage: true });
  console.log('data_01_entities_list_light.png');

  // 4. Open create modal.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /New entity/i.test(b.textContent || ''));
    if (btn) btn.click();
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOT_DIR}/data_02_entities_create_modal.png`, fullPage: true });
  console.log('data_02_entities_create_modal.png');

  // 5. Fill in form: ServiceLevelAgreement (slug=slas).
  //    Use the form (modal) scope only — find inputs by adjacent <span> label
  //    so we're robust to the underlying list's search input.
  await page.evaluate(() => {
    const form = document.querySelector('form'); // the modal is the only <form> on screen
    if (!form) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const fill = (spanText, value) => {
      const labels = [...form.querySelectorAll('label.field')];
      const lbl = labels.find((l) => {
        const span = l.querySelector('span');
        return span && span.textContent.trim().startsWith(spanText);
      });
      if (!lbl) return;
      const inp = lbl.querySelector('input');
      if (!inp) return;
      setter.call(inp, value);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    };
    fill('Label *', 'ServiceLevelAgreement');
    fill('Label plural', 'SLAs');
    fill('Key (snake_case)', 'slas');
    fill('Route slug (kebab)', 'slas');
    fill('Icon', 'clock');
  });
  await page.waitForTimeout(300);

  // Add a field.
  await page.evaluate(() => {
    const form = document.querySelector('form');
    if (!form) return;
    const btn = [...form.querySelectorAll('button')].find((b) => /Add field/i.test(b.textContent || ''));
    if (btn) btn.click();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const form = document.querySelector('form');
    if (!form) return;
    const rows = [...form.querySelectorAll('table.grid tbody tr input.inp')];
    if (rows.length >= 2) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(rows[0], 'name'); rows[0].dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(rows[1], 'Name'); rows[1].dispatchEvent(new Event('input', { bubbles: true }));
    }
    // Check the required checkbox for the first row
    const checks = [...form.querySelectorAll('table.grid tbody tr input[type="checkbox"]')];
    if (checks[0]) checks[0].click();
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOT_DIR}/data_03_entities_create_filled.png`, fullPage: true });
  console.log('data_03_entities_create_filled.png');

  // Submit
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button[type="submit"]')].find((b) => /Create entity/i.test(b.textContent || ''));
    if (btn) btn.click();
  });
  await page.waitForTimeout(2500);

  // 6. List should now include the new entity; drawer auto-opens.
  await page.screenshot({ path: `${SHOT_DIR}/data_04_entities_detail_drawer.png`, fullPage: true });
  console.log('data_04_entities_detail_drawer.png');

  // Close drawer
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button[aria-label="Close drawer"]')].pop();
    if (btn) btn.click();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOT_DIR}/data_05_entities_list_after_create.png`, fullPage: true });
  console.log('data_05_entities_list_after_create.png');

  // 7. Fields pane (existing entity).
  await clickLeaf(page, 'Fields');
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${SHOT_DIR}/data_06_fields_pane.png`, fullPage: true });
  console.log('data_06_fields_pane.png');

  // 8. An unwired leaf (Relationships).
  await clickLeaf(page, 'Relationships');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOT_DIR}/data_07_relationships_unwired.png`, fullPage: true });
  console.log('data_07_relationships_unwired.png');

  // 9. Light-mode replay — flip theme without reloading; the App.tsx useEffect
  //    re-applies after our setter races, so we toggle via the user-menu button
  //    when present. As a fallback, override via React state by clicking the
  //    bottom sidebar gear and dispatching a click on the Light/Dark seg.
  await page.evaluate(() => {
    // Trigger the App-level setTheme: look for any element with data-theme-toggle,
    // otherwise force-set localStorage and re-fire by reload of just the studio area
    // (cheaper than a full reload that drops auth).
    localStorage.setItem('gaaex-theme', 'light');
    document.documentElement.setAttribute('data-theme', 'light');
    // App.tsx's useEffect rewrites data-theme based on its React state. We dispatch
    // a storage event so any listeners re-read the value (no-op if none — the
    // explicit attr set above is the actual visual change).
    window.dispatchEvent(new StorageEvent('storage', { key: 'gaaex-theme', newValue: 'light' }));
  });
  await page.waitForTimeout(400);
  // Re-fire after the effect runs — the effect is synchronous, the attr will be
  // overwritten back to whatever React state holds. Force the attr with a delay:
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await page.waitForTimeout(200);
  }

  await clickLeaf(page, 'Entities');
  await page.waitForTimeout(1500);
  // Final attr override right before the shot
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOT_DIR}/data_08_entities_list_light.png`, fullPage: true });
  console.log('data_08_entities_list_light.png');

  await page.evaluate(() => {
    const row = [...document.querySelectorAll('table.grid tbody tr')]
      .find((r) => /slas/i.test(r.textContent || ''));
    if (row) row.click();
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOT_DIR}/data_09_entities_detail_drawer_light.png`, fullPage: true });
  console.log('data_09_entities_detail_drawer_light.png');

  // Close drawer + restore dark
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button[aria-label="Close drawer"]')].pop();
    if (btn) btn.click();
  });
  await page.evaluate(() => {
    localStorage.setItem('gaaex-theme', 'dark');
    document.documentElement.setAttribute('data-theme', 'dark');
  });

  await browser.close();
})().catch((e) => {
  console.error('CRASH:', e.message);
  process.exit(1);
});
