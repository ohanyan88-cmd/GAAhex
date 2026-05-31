const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SHOT_DIR = 'C:/Users/Admin/Desktop/Portal/screenshots';
if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });

const PAGES = [
  { label: 'Incidents & Outages', file: 's5_01_incidents.png',     name: 'Incidents'   },
  { label: 'Sites',               file: 's5_02_sites.png',         name: 'Sites'       },
  { label: 'Devices',             file: 's5_03_devices.png',       name: 'Devices'     },
  { label: 'Warehouses',          file: 's5_04_warehouses.png',    name: 'Warehouses'  },
  { label: 'Fleet',               file: 's5_05_fleet.png',         name: 'Fleet'       },
  { label: 'Work Orders',         file: 's5_06_workorders.png',    name: 'WorkOrders'  },
  { label: 'Maintenance',         file: 's5_07_maintenance.png',   name: 'Maintenance' },
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

  // Open every closed sidebar section so all items become clickable
  const ea = async () => {
    await p.evaluate(() => document.querySelectorAll('.sb-sec-btn:not(.open)').forEach(b => b.click()));
    await p.waitForTimeout(500);
  };
  await ea();

  const go = async (label) => {
    await ea();
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

    const info = await p.evaluate(() => {
      const h1 = document.querySelector('h1')?.innerText?.trim() || '';
      // "main content area" heuristic: pick the largest plausible container and check non-whitespace text length
      const candidates = [
        document.querySelector('main'),
        document.querySelector('.app-main'),
        document.querySelector('.view'),
        document.querySelector('.page'),
        document.querySelector('[role="main"]'),
        document.body,
      ].filter(Boolean);
      let textLen = 0;
      for (const c of candidates) {
        const t = (c.innerText || '').replace(/\s+/g, ' ').trim();
        if (t.length > textLen) textLen = t.length;
      }
      return { h1, textLen };
    });

    const renders = info.textLen > 50 ? 'YES' : 'NO';
    console.log(`${pg.name}: h1="${info.h1}" renders=${renders}`);
  }

  await b.close();
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
