// verify_dev_seed.js — adapted from verify_s5.js.
//
// Walks 10 previously-sparse pages, screenshots each, and prints an approximate row count
// (from the rendered table or list) for the dev-bulk seed verification.
//
// Run:
//   cd C:\Users\Admin\Desktop\Portal\frontend && node ../verify_dev_seed.js
//
// Requires the frontend dev server at http://localhost:5173 and the backend at port 8099.
const { chromium } = require('playwright');
const fs = require('fs');

const SHOT_DIR = 'C:/Users/Admin/Desktop/Portal/screenshots';
if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });

// Sidebar label → screenshot file → friendly key for the printed line.
const PAGES = [
  { label: 'Customers',     file: 'seed_01_customers.png',     name: 'Customers'     },
  { label: 'Contacts',      file: 'seed_02_contacts.png',      name: 'Contacts'      },
  { label: 'Accounts',      file: 'seed_03_accounts.png',      name: 'Accounts'      },
  { label: 'Subscriptions', file: 'seed_04_subscriptions.png', name: 'Subscriptions' },
  { label: 'Invoices',      file: 'seed_05_invoices.png',      name: 'Invoices'      },
  { label: 'Payments',      file: 'seed_06_payments.png',      name: 'Payments'      },
  { label: 'Helpdesk',      file: 'seed_07_helpdesk.png',      name: 'Helpdesk'      },
  { label: 'Work Orders',   file: 'seed_08_workorders.png',    name: 'WorkOrders'    },
  { label: 'Sites',         file: 'seed_09_sites.png',         name: 'Sites'         },
  { label: 'Devices',       file: 'seed_10_devices.png',       name: 'Devices'       },
];

(async () => {
  const b = await chromium.launch({ headless: true, args: ['--window-size=1440,900'] });
  const p = await b.newPage();
  await p.setViewportSize({ width: 1440, height: 900 });

  await p.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await p.fill('input:nth-of-type(1)', 'admin@demo.isp');
  await p.fill('input[type="password"]', 'admin123');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(3500);

  // Open every closed sidebar section so all items become clickable.
  const expandAll = async () => {
    await p.evaluate(() => document.querySelectorAll('.sb-sec-btn:not(.open)').forEach(b => b.click()));
    await p.waitForTimeout(500);
  };
  await expandAll();

  const go = async (label) => {
    await expandAll();
    await p.evaluate(l => {
      const el = [...document.querySelectorAll('.sb-item')].find(e => e.innerText.trim() === l);
      if (el) el.click();
    }, label);
    await p.waitForTimeout(2500);
  };

  for (const pg of PAGES) {
    await go(pg.label);
    const shotPath = `${SHOT_DIR}/${pg.file}`;
    await p.screenshot({ path: shotPath, fullPage: false });

    // Best-effort row count — count <tr>s (minus header) in the largest visible table.
    const info = await p.evaluate(() => {
      const h1 = document.querySelector('h1')?.innerText?.trim() || '';
      const tables = [...document.querySelectorAll('table')];
      let maxRows = 0;
      for (const t of tables) {
        const trs = t.querySelectorAll('tbody tr');
        if (trs.length > maxRows) maxRows = trs.length;
      }
      // Some pages use card lists rather than tables. Fall back to common card/list selectors.
      let cards = 0;
      const cardSelectors = ['.list-row', '.card', '[role="row"]', '.grid-row'];
      for (const sel of cardSelectors) {
        const n = document.querySelectorAll(sel).length;
        if (n > cards) cards = n;
      }
      return { h1, rows: maxRows, cards };
    });

    const approx = info.rows || info.cards || 0;
    console.log(`${pg.name}: rows=${approx} h1="${info.h1}"`);
  }

  await b.close();
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
