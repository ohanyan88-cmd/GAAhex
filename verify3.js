const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ headless: true, args: ['--window-size=1440,900'] });
  const p = await b.newPage();
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await p.fill('input:nth-of-type(1)', 'admin@demo.isp');
  await p.fill('input[type="password"]', 'admin123');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(3500);

  const snap = async (name) => p.screenshot({ path: `C:/Users/Admin/Desktop/Portal/v3_${name}.png` });
  const ea = async () => { await p.evaluate(() => document.querySelectorAll('.sb-sec-btn:not(.open)').forEach(b=>b.click())); await p.waitForTimeout(400); };
  const go = async (label) => { await ea(); await p.evaluate(l => { const el=[...document.querySelectorAll('.sb-item')].find(e=>e.innerText.trim()===l); if(el)el.click(); }, label); await p.waitForTimeout(2500); };

  // 1. Create menu
  await p.click('button:has-text("Create")');
  await p.waitForTimeout(600);
  await snap('01_create_menu');
  const menuItems = await p.evaluate(() => [...document.querySelectorAll('.menu .menu-item, .menu button')].map(e=>e.innerText.trim()).filter(Boolean));
  console.log('Create menu items:', menuItems.join(' | '));
  // Close via Escape
  await p.keyboard.press('Escape');
  await p.waitForTimeout(500);

  // 2. Tenant chip
  await p.click('.tenant');
  await p.waitForTimeout(1500);
  await snap('02_tenant_click');
  const h1 = await p.evaluate(() => document.querySelector('h1')?.innerText?.trim());
  console.log('Tenant click → view:', h1);

  // 3. AI Copilot brain text
  await go('AI Copilot');
  await p.waitForTimeout(500);
  const brainText = await p.evaluate(() => {
    const info = document.querySelector('.chat-info');
    return info ? info.innerText.replace(/\n/g,' ') : 'NOT FOUND';
  });
  console.log('Brain panel:', brainText.slice(0, 150));
  // Check bubble visibility
  await snap('03_ask_initial');

  // Send message
  const inp = await p.$('.chat-composer input, .chat-composer .inp');
  if (inp) { await inp.fill('How many active subscriptions?'); await p.keyboard.press('Enter'); await p.waitForTimeout(5000); }
  await snap('04_ask_after_send');
  const bubbleInfo = await p.evaluate(() => {
    const bubbles = [...document.querySelectorAll('.bubble')];
    return bubbles.map(b => ({ cls: b.className.split(' ').filter(c=>c!=='bubble').join(' '), h: b.getBoundingClientRect().height, text: b.innerText.slice(0,30) }));
  });
  console.log('Bubbles:', JSON.stringify(bubbleInfo));

  // 4. Home topbar full width
  await go('Home');
  await snap('05_full_topbar');

  // 5. Topbar zoomed in
  await p.screenshot({ path: 'C:/Users/Admin/Desktop/Portal/v3_06_topbar_zoom.png', clip: { x: 0, y: 0, width: 1440, height: 60 } });
  console.log('Topbar zoomed saved');

  await b.close();
  console.log('Done. Files at Desktop/Portal/v3_*.png');
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
