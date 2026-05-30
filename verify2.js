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

  const snap = async (name) => p.screenshot({ path: `C:/Users/Admin/Desktop/Portal/v2_${name}.png` });
  const esc = async () => { await p.keyboard.press('Escape'); await p.waitForTimeout(400); };
  const ea = async () => { await p.evaluate(() => document.querySelectorAll('.sb-sec-btn:not(.open)').forEach(b=>b.click())); await p.waitForTimeout(400); };
  const go = async (label) => { await ea(); await p.evaluate(l => { const el=[...document.querySelectorAll('.sb-item')].find(e=>e.innerText.trim()===l); if(el)el.click(); }, label); await p.waitForTimeout(2500); };

  // 1. Create button menu
  await p.click('button:has-text("Create")');
  await p.waitForTimeout(600);
  await snap('01_create_menu');
  console.log('Create menu:', !!(await p.$('.menu')));
  await esc();

  // 2. Tenant chip → settings
  await p.click('.tenant');
  await p.waitForTimeout(1500);
  await snap('02_tenant_click');
  const h1 = await p.evaluate(() => document.querySelector('h1')?.innerText);
  console.log('Tenant click goes to:', h1);
  await esc();

  // 3. AI Copilot - brain section
  await go('AI Copilot');
  await p.waitForTimeout(500);
  await snap('03_ask_brain');
  const brainText = await p.evaluate(() => {
    const info = document.querySelector('.chat-info');
    return info ? info.innerText.slice(0, 200) : 'NOT FOUND';
  });
  console.log('AskGaaex info panel:', brainText.replace(/\n/g, ' | '));

  // 4. Ask a question
  const inp = await p.$('.chat-composer input, .chat-composer .inp');
  if (inp) { await inp.fill('How many subscriptions?'); await p.keyboard.press('Enter'); await p.waitForTimeout(4000); }
  await snap('04_ask_replied');
  const bubbles = await p.evaluate(() => [...document.querySelectorAll('.bubble')].map(b => ({ cls: b.className, text: b.innerText.slice(0,30) })));
  console.log('Bubbles:', JSON.stringify(bubbles));

  // 5. Topbar full view
  await go('Home');
  await snap('05_home_topbar');

  // 6. Subscriptions - Rate/Generate buttons
  await go('Subscriptions');
  await snap('06_subscriptions');

  // 7. Studio appearance - check Save button
  await p.evaluate(() => { const el=document.querySelector('.sb-foot .sb-item'); if(el)el.click(); });
  await p.waitForTimeout(2000);
  await p.evaluate(() => { const el=[...document.querySelectorAll('.studio-nav-item')].find(e=>e.innerText.includes('Appearance')); if(el)el.click(); });
  await p.waitForTimeout(1500);
  await snap('07_studio_appearance');
  const saveAppearance = await p.$('button:has-text("Save appearance")');
  if (saveAppearance) { await saveAppearance.click(); await p.waitForTimeout(1000); await snap('08_appearance_saved'); }
  console.log('Save appearance button:', !!saveAppearance);

  await b.close();
  console.log('Done. Files at Desktop/Portal/v2_*.png');
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
