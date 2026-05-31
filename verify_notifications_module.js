// verify_notifications_module.js — Module 3 (Notifications) screenshot proof.
//
// Drives the Studio Notifications group via the shared NotificationsPane:
//   1. Email Templates  — list + create modal + filled form
//   2. New def's detail drawer — editable fields + Preview + Test send
//   3. Preview rendered output
//   4. SMS Templates, Push Notifications, In-App Notifications, Notification Rules
//   5. Dark-mode replay of a couple of scenes
//
// Run:
//   cd C:\Users\Admin\Desktop\Portal\frontend && node ../verify_notifications_module.js
//
// Requires:
//   - Frontend dev server at http://localhost:5173
//   - Backend at http://127.0.0.1:8099  (GAAEX_DEV_SEED=1 first boot)
//   - admin@demo.isp / admin123

const { chromium } = require('playwright');
const fs = require('fs');

const SHOT_DIR = 'C:/Users/Admin/Desktop/Portal/screenshots';
if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });

// Unique key so re-runs don't 409 — each run scrubs at the end too.
const VERIFY_KEY = 'm3_verify_email_' + Date.now().toString(36);

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

async function clickLeaf(page, label) {
  await page.evaluate((l) => {
    const btn = [...document.querySelectorAll('.tree-leaf')].find(
      (b) => (b.textContent || '').trim() === l,
    );
    if (btn) btn.click();
  }, label);
  await page.waitForTimeout(1800);
}

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    localStorage.setItem('gaaex-theme', t);
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
  await page.waitForTimeout(400);
  for (let i = 0; i < 3; i++) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await page.waitForTimeout(200);
  }
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

  // 2. Open Studio + expand Notifications.
  await openStudio(page);
  await expandGroup(page, 'Notifications');
  await page.waitForTimeout(400);

  // 3. Email Templates pane — list view.
  await clickLeaf(page, 'Email Templates');
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${SHOT_DIR}/notif_01_email_list_dark.png`, fullPage: true });
  console.log('notif_01_email_list_dark.png');

  // 4. Open create modal.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /New template/i.test(b.textContent || ''));
    if (btn) btn.click();
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOT_DIR}/notif_02_email_create_modal.png`, fullPage: true });
  console.log('notif_02_email_create_modal.png');

  // 5. Fill the modal.
  await page.evaluate((vkey) => {
    const form = document.querySelector('form');
    if (!form) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const taSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    const findInput = (spanText) => {
      const labels = [...form.querySelectorAll('label.field')];
      const lbl = labels.find((l) => {
        const span = l.querySelector('span');
        return span && span.textContent.trim().startsWith(spanText);
      });
      if (!lbl) return null;
      return lbl.querySelector('input, textarea');
    };
    const fill = (spanText, value) => {
      const inp = findInput(spanText);
      if (!inp) return;
      if (inp.tagName === 'TEXTAREA') {
        taSetter.call(inp, value);
      } else {
        setter.call(inp, value);
      }
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    };
    fill('Key (unique)', vkey);
    fill('Label *', 'Module 3 Verify Email');
    fill('Title template *', 'Welcome {customer_name}');
    fill('Body template *', 'Your account is now active. Plan: {plan}.');
  }, VERIFY_KEY);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOT_DIR}/notif_03_email_create_filled.png`, fullPage: true });
  console.log('notif_03_email_create_filled.png');

  // 6. Submit.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button[type="submit"]')].find((b) => /Create template/i.test(b.textContent || ''));
    if (btn) btn.click();
  });
  await page.waitForTimeout(2500);

  // 7. Detail drawer auto-opens.
  await page.screenshot({ path: `${SHOT_DIR}/notif_04_email_detail_drawer.png`, fullPage: true });
  console.log('notif_04_email_detail_drawer.png');

  // 8. Fill sample context + click Preview.
  await page.evaluate(() => {
    const drawer = document.querySelector('[aria-label="Close drawer"]')?.closest('div')?.parentElement?.parentElement;
    // Look for textarea after "Sample context (JSON)" label
    const labels = [...document.querySelectorAll('label.field')];
    const ctxLabel = labels.find((l) => /Sample context/i.test(l.querySelector('span')?.textContent || ''));
    if (!ctxLabel) return;
    const ta = ctxLabel.querySelector('textarea');
    if (!ta) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '{"customer_name":"Արամ Գրիգորյան","plan":"Home Fiber 500"}');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    // Scope to the drawer (fixed position, z-index 100) so we don't hit the top-bar
    // "Preview" button in the Studio shell.
    const drawers = [...document.querySelectorAll('div')].filter((d) => {
      const cs = getComputedStyle(d);
      return cs.position === 'fixed' && parseInt(cs.zIndex || '0', 10) >= 100;
    });
    for (const dr of drawers) {
      const btn = [...dr.querySelectorAll('button')].find((b) => /^Preview$|^Rendering/i.test((b.textContent || '').trim()));
      if (btn) { btn.click(); return; }
    }
  });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${SHOT_DIR}/notif_05_email_preview_rendered.png`, fullPage: true });
  console.log('notif_05_email_preview_rendered.png');

  // 9. Close drawer.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button[aria-label="Close drawer"]')].pop();
    if (btn) btn.click();
  });
  await page.waitForTimeout(600);

  // 10. SMS Templates (likely empty for the seeded tenant).
  await clickLeaf(page, 'SMS Templates');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOT_DIR}/notif_06_sms_list.png`, fullPage: true });
  console.log('notif_06_sms_list.png');

  // 11. Push Notifications.
  await clickLeaf(page, 'Push Notifications');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOT_DIR}/notif_07_push_list.png`, fullPage: true });
  console.log('notif_07_push_list.png');

  // 12. In-App Notifications (the seeded set lives here).
  await clickLeaf(page, 'In-App Notifications');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOT_DIR}/notif_08_inapp_list.png`, fullPage: true });
  console.log('notif_08_inapp_list.png');

  // 13. Notification Rules (filtered to defs with a gxl_condition).
  await clickLeaf(page, 'Notification Rules');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOT_DIR}/notif_09_rules_list.png`, fullPage: true });
  console.log('notif_09_rules_list.png');

  // 14. Light-mode replay — set light, screenshot Email Templates list + open detail.
  await setTheme(page, 'light');
  await clickLeaf(page, 'Email Templates');
  await page.waitForTimeout(1200);
  await setTheme(page, 'light');
  await page.screenshot({ path: `${SHOT_DIR}/notif_10_email_list_light.png`, fullPage: true });
  console.log('notif_10_email_list_light.png');

  // Open the verify row.
  await page.evaluate((vkey) => {
    const rows = [...document.querySelectorAll('table.grid tbody tr')];
    const row = rows.find((r) => (r.textContent || '').includes(vkey));
    if (row) row.click();
  }, VERIFY_KEY);
  await page.waitForTimeout(1500);
  await setTheme(page, 'light');
  await page.screenshot({ path: `${SHOT_DIR}/notif_11_email_detail_light.png`, fullPage: true });
  console.log('notif_11_email_detail_light.png');

  // Close drawer + restore dark.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button[aria-label="Close drawer"]')].pop();
    if (btn) btn.click();
  });
  await setTheme(page, 'dark');

  // 15. Cleanup the verify row via REST so re-runs are clean. Use the same token the SPA stored.
  await page.evaluate(async (vkey) => {
    const tok = (() => {
      try { return JSON.parse(localStorage.getItem('gaaex-auth') || '{}').token } catch { return null }
    })();
    if (!tok) return;
    await fetch(`http://127.0.0.1:8099/meta/notification-defs/${encodeURIComponent(vkey)}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + tok },
    });
  }, VERIFY_KEY);

  await browser.close();
})().catch((e) => {
  console.error('CRASH:', e.message);
  process.exit(1);
});
