const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage();
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await p.fill('input:nth-of-type(1)', 'admin@demo.isp');
  await p.fill('input[type="password"]', 'admin123');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(3500);

  // open sidebar Orders & Revenue, click Invoices
  await p.evaluate(() => document.querySelectorAll('.sb-sec-btn:not(.open)').forEach(b=>b.click()));
  await p.waitForTimeout(400);
  await p.evaluate(() => { const el=[...document.querySelectorAll('.sb-item')].find(e=>e.innerText.trim()==='Invoices'); if(el)el.click(); });
  await p.waitForTimeout(3000);

  // Bounds check
  const out = await p.evaluate(() => {
    const ths = [...document.querySelectorAll('.grid > thead > tr > th, .grid thead tr th')];
    const tds = [...document.querySelectorAll('.grid > tbody > tr:first-child > td, .grid tbody tr:first-child td')];
    return ths.map((th, i) => {
      const td = tds[i];
      if (!td) return { idx: i, header: th.innerText.trim() || '(empty)', err: 'no td' };
      const a = th.getBoundingClientRect();
      const b = td.getBoundingClientRect();
      const dL = Math.abs(a.left - b.left);
      const dR = Math.abs(a.right - b.right);
      return { idx: i, header: th.innerText.trim() || '(empty)', th_left: Math.round(a.left), th_right: Math.round(a.right), td_left: Math.round(b.left), td_right: Math.round(b.right), dL: Math.round(dL), dR: Math.round(dR), aligned: dL < 2 && dR < 2 };
    });
  });
  console.log(JSON.stringify(out, null, 2));

  await p.screenshot({ path: 'C:/Users/Admin/Desktop/Portal/screenshots/align_now_full.png', fullPage: false });

  // Crop AMOUNT column
  const amountIdx = out.findIndex(r => r.header && r.header.toUpperCase().includes('AMOUNT'));
  if (amountIdx >= 0) {
    const c = out[amountIdx];
    await p.screenshot({ path: 'C:/Users/Admin/Desktop/Portal/screenshots/align_now_amount_crop.png', clip: { x: c.th_left - 8, y: 240, width: (c.th_right - c.th_left) + 16, height: 500 } });
    console.log('Cropped AMOUNT col:', c.th_left, '->', c.th_right);
  }

  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
