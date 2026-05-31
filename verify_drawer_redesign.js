// verify_drawer_redesign.js — screenshot proof for the unified RecordDrawer +
// constrained-Modal redesign.
//
// Adapted from verify_security.js. Captures four modal classes:
//   A) HelpdeskView ticket detail   (RecordDrawer slide-over, Gev's example)
//   B) OrdersView order detail       (RecordDrawer slide-over)
//   C) Helpdesk "+ New ticket" modal (constrained centered Modal)
//   D) confirmDialog from Orders cancel — confirm-style centered Modal
//
// Each captured in light + dark = 8 PNGs.
//
// Run:
//   cd C:\Users\Admin\Desktop\Portal\frontend && node ../verify_drawer_redesign.js
//
// Requires:
//   - Frontend dev server at http://localhost:5173
//   - Backend at http://127.0.0.1:8099
//   - admin@demo.isp / admin123 seeded

const { chromium } = require('playwright');
const fs = require('fs');

const SHOT_DIR = 'C:/Users/Admin/Desktop/Portal/screenshots';
if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });

async function setTheme(page, theme) {
  // The app stores theme in localStorage as 'gx-theme' and applies it via the
  // data-theme attribute on <html>. Toggle directly so we don't depend on the
  // UI control's location.
  await page.evaluate((t) => {
    try { localStorage.setItem('gx-theme', t); } catch {}
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
  await page.waitForTimeout(300);
}

async function expandSection(page, sectionLabel) {
  await page.evaluate((l) => {
    const btn = [...document.querySelectorAll('.sb-sec-btn')].find(
      (b) => (b.textContent || '').trim().startsWith(l),
    );
    if (btn && !btn.classList.contains('open')) btn.click();
  }, sectionLabel);
  await page.waitForTimeout(300);
}

async function clickSidebar(page, label) {
  await page.evaluate((l) => {
    // Prefer .sb-item leaf rows (the actual nav items).
    const items = [...document.querySelectorAll('.sb-item')];
    const btn = items.find((b) => (b.textContent || '').trim() === l)
            || [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === l);
    if (btn) btn.click();
  }, label);
  await page.waitForTimeout(1800);
}

async function shotModal(page, name) {
  // Try to crop to the visible modal/drawer if one is open; otherwise full-page.
  const target = await page.$('.gx-drawer, .gx-dialog');
  if (target) {
    const box = await target.boundingBox();
    if (box) {
      // Include some scrim margin so the screenshot shows the constraint.
      await page.screenshot({
        path: `${SHOT_DIR}/${name}.png`,
        clip: {
          x: Math.max(0, box.x - 40),
          y: Math.max(0, box.y - 20),
          width: Math.min(1440 - Math.max(0, box.x - 40), box.width + 80),
          height: Math.min(900 - Math.max(0, box.y - 20), box.height + 40),
        },
      });
      console.log(`${name}.png (cropped)`);
      return;
    }
  }
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: false });
  console.log(`${name}.png`);
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

  // ── A · Helpdesk ticket detail ────────────────────────────────────────────
  await expandSection(page, 'Customer Care');
  await clickSidebar(page, 'Helpdesk');
  await page.waitForTimeout(1500);

  // Open the first ticket row to trigger the detail drawer.
  await page.evaluate(() => {
    const firstRow = document.querySelector('table.grid tbody tr.row-link');
    if (firstRow) firstRow.click();
  });
  await page.waitForTimeout(1500);

  for (const theme of ['light', 'dark']) {
    await setTheme(page, theme);
    await shotModal(page, `drawer_01_helpdesk_ticket_${theme}`);
  }

  // Close the drawer.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // ── B · Orders order detail ──────────────────────────────────────────────
  await expandSection(page, 'Orders & Revenue');
  await clickSidebar(page, 'Orders');
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const firstRow = document.querySelector('table.grid tbody tr');
    if (firstRow) firstRow.click();
    // also try a button/cell that opens detail in orders (it uses iconbtn 'Open')
    const openBtn = document.querySelector('button[title="Open"]');
    if (openBtn) openBtn.click();
  });
  await page.waitForTimeout(1500);

  for (const theme of ['light', 'dark']) {
    await setTheme(page, theme);
    await shotModal(page, `drawer_02_order_${theme}`);
  }

  // Close.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // ── C · Helpdesk + New ticket (create modal) ─────────────────────────────
  await expandSection(page, 'Customer Care');
  await clickSidebar(page, 'Helpdesk');
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    // Find the "New ticket" button (lucide Plus + text).
    const btn = [...document.querySelectorAll('button')].find(
      (b) => (b.textContent || '').trim() === 'New ticket',
    );
    if (btn) btn.click();
  });
  await page.waitForTimeout(900);

  for (const theme of ['light', 'dark']) {
    await setTheme(page, theme);
    await shotModal(page, `drawer_03_helpdesk_create_${theme}`);
  }

  // Close.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // ── D · confirmDialog — use the built-in confirm via window.__confirmDialog
  // We trigger one by calling confirmDialog() programmatically from the page if
  // available, OR by navigating to a flow that opens it. The simplest neutral
  // path: open the dev payment confirm modal in Invoices? That requires data.
  // Instead, programmatically render a stub Modal via the app store. Fallback:
  // just snapshot the Helpdesk create modal in `sm` view via the create-queue
  // affordance (if visible).
  //
  // Try: navigate to Invoices, click first invoice row, then Pay online (dev) → confirm.
  // If that fails, fall back to capturing the Modal we already have.
  // Navigate to Products and trigger a confirmDialog via the Retire action.
  // ProductsView.retire() calls confirmDialog({ title, message, danger:true })
  // which renders through the shared ConfirmHost — same Modal primitive,
  // size="sm". This proves the confirm dialog inherits the constrained-Modal
  // fix from Step 1 (no separate plumbing).
  await expandSection(page, 'CRM & Commercial');
  await page.waitForTimeout(300);
  await clickSidebar(page, 'Product Catalog');
  await page.waitForTimeout(1800);

  // ProductsView has an inline "Retire" button on each row — click it to
  // trigger confirmDialog({ title:'Retire ...', confirmLabel:'Retire', danger:true }).
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('table.grid tbody tr button')].find(
      (b) => (b.textContent || '').trim() === 'Retire',
    );
    if (btn) btn.click();
  });
  await page.waitForTimeout(900);

  for (const theme of ['light', 'dark']) {
    await setTheme(page, theme);
    await shotModal(page, `drawer_04_confirm_${theme}`);
  }

  await browser.close();
})().catch((e) => {
  console.error('CRASH:', e.message);
  process.exit(1);
});
