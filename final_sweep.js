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

  const ea = async () => { await p.evaluate(() => document.querySelectorAll('.sb-sec-btn:not(.open)').forEach(b=>b.click())); await p.waitForTimeout(400); };
  const go = async (label) => { await ea(); await p.evaluate(l => { const el=[...document.querySelectorAll('.sb-item')].find(e=>e.innerText.trim()===l); if(el)el.click(); }, label); await p.waitForTimeout(2000); };
  const s = async (name) => p.screenshot({ path: `C:/Users/Admin/Desktop/Portal/sweep_${name}.png` });

  // Topbar zoom
  await p.screenshot({ path: 'C:/Users/Admin/Desktop/Portal/sweep_topbar.png', clip: {x:0,y:0,width:1440,height:60} });

  await go('Home'); await s('home');
  await go('Calendar'); await s('cal');
  await p.evaluate(() => { const b=[...document.querySelectorAll('.seg button')].find(e=>e.innerText.trim()==='Week'); if(b)b.click(); });
  await p.waitForTimeout(600); await s('cal_week');
  await p.evaluate(() => { const b=[...document.querySelectorAll('.seg button')].find(e=>e.innerText.trim()==='Month'); if(b)b.click(); });
  await p.waitForTimeout(400);
  await go('Service Communications'); await s('messages');
  await go('Outbound'); await s('outbound');
  await go('Leads'); await s('leads');
  await go('Customers'); await s('customers');
  await go('Invoices'); await s('invoices');
  await go('Subscriptions'); await s('subs');
  await go('Helpdesk'); await s('helpdesk');
  await go('System Settings'); await s('settings');
  await go('Organization'); await s('org');
  await go('AI Copilot');
  const inp = await p.$('.chat-composer input');
  if (inp) { await inp.fill('What is MRR?'); await p.keyboard.press('Enter'); await p.waitForTimeout(4000); }
  await s('ask');
  await go('Reports'); await s('reports');

  // Studio
  await p.evaluate(() => { const el=document.querySelector('.sb-foot .sb-item'); if(el)el.click(); });
  await p.waitForTimeout(1800); await s('studio');
  await p.evaluate(() => { const el=[...document.querySelectorAll('.studio-nav-item')].find(e=>e.innerText.includes('Appearance')); if(el)el.click(); });
  await p.waitForTimeout(1000); await s('studio_appearance');

  await b.close();
  console.log('Final sweep complete. Files at Desktop/Portal/sweep_*.png');
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
