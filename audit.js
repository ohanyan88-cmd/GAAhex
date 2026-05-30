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
  const go = async (label) => { await ea(); await p.evaluate(l => { const el=[...document.querySelectorAll('.sb-item')].find(e=>e.innerText.trim()===l); if(el)el.click(); }, label); await p.waitForTimeout(2500); };
  const snap = async (n) => p.screenshot({ path: `C:/Users/Admin/Desktop/Portal/audit_${n}.png` });
  const esc = async () => { await p.keyboard.press('Escape'); await p.waitForTimeout(300); };

  // TOPBAR - detailed
  await snap('00_topbar_full');
  await p.screenshot({ path: 'C:/Users/Admin/Desktop/Portal/audit_00b_topbar_crop.png', clip: {x:0,y:0,width:1440,height:60} });

  // Show the topbar elements text
  const tbText = await p.evaluate(() => {
    const tb = document.querySelector('.tb');
    if (!tb) return 'NO TB';
    return [...tb.querySelectorAll('button, div, span, a')].filter(e=>e.childElementCount===0 && e.innerText.trim()).map(e=>e.innerText.trim()).filter(Boolean);
  });
  console.log('TOPBAR ELEMENTS:', JSON.stringify(tbText));

  // TOPBAR: tenant area - how many "Demo ISP" texts exist?
  const demoIspCount = await p.evaluate(() => {
    const all = [...document.querySelectorAll('*')];
    return all.filter(e => e.childElementCount === 0 && e.innerText?.trim() === 'Demo ISP').length;
  });
  console.log('Demo ISP occurrences:', demoIspCount);

  // HOME
  await go('Home');
  await snap('01_home');

  // CALENDAR - full check
  await go('Calendar');
  await snap('02_calendar');
  // Check cal-rail visibility
  const calInfo = await p.evaluate(() => {
    const rail = document.querySelector('.cal-rail');
    const grid = document.querySelector('.cal-grid');
    const cells = document.querySelectorAll('.cal-cell').length;
    const calHead = document.querySelector('.comms-head');
    const monthText = calHead ? calHead.innerText.slice(0,80) : 'NO HEAD';
    const railStyle = rail ? window.getComputedStyle(rail) : null;
    const railHidden = railStyle ? railStyle.display === 'none' : true;
    return { cells, monthText: monthText.replace(/\n/g,' '), railHidden, hasGrid: !!grid };
  });
  console.log('CALENDAR:', JSON.stringify(calInfo));

  // Calendar week view
  await p.evaluate(() => { const b=[...document.querySelectorAll('button')].find(e=>e.innerText.trim()==='Week'); if(b)b.click(); });
  await p.waitForTimeout(800);
  await snap('02b_calendar_week');

  // Calendar month back
  await p.evaluate(() => { const b=[...document.querySelectorAll('button')].find(e=>e.innerText.trim()==='Month'); if(b)b.click(); });
  await p.waitForTimeout(500);

  // MESSAGES
  await go('Service Communications');
  await snap('03_messages');

  // OUTBOUND (find it in nav)
  await ea();
  const outboundFound = await p.evaluate(() => {
    const el=[...document.querySelectorAll('.sb-item')].find(e=>e.innerText.trim()==='Outbound' || e.innerText.trim()==='Outbound Mail');
    if(el){el.click();return true;} return false;
  });
  console.log('Outbound in nav:', outboundFound);
  await p.waitForTimeout(2000);
  await snap('04_outbound');

  // LEADS
  await go('Leads');
  await snap('05_leads');
  // zoom into KPI strip
  const kpiRect = await p.evaluate(() => { const k=document.querySelector('.kpi-strip'); return k ? k.getBoundingClientRect() : null; });
  if(kpiRect) await p.screenshot({ path:'C:/Users/Admin/Desktop/Portal/audit_05b_leads_kpi.png', clip:{x:0,y:kpiRect.y,width:1440,height:kpiRect.height+20} });

  // HELPDESK
  await go('Helpdesk');
  await snap('06_helpdesk');

  // CUSTOMERS
  await go('Customers');
  await snap('07_customers');

  // INVOICES
  await go('Invoices');
  await snap('08_invoices');

  // SUBSCRIPTIONS
  await go('Subscriptions');
  await snap('09_subscriptions');

  // PAYMENTS
  await go('Payments');
  await snap('10_payments');

  // STUDIO
  await p.evaluate(() => { const el=document.querySelector('.sb-foot .sb-item'); if(el)el.click(); });
  await p.waitForTimeout(2000);
  await snap('11_studio');
  // Appearance pane
  await p.evaluate(() => { const el=[...document.querySelectorAll('.studio-nav-item')].find(e=>e.innerText.includes('Appearance')); if(el)el.click(); });
  await p.waitForTimeout(1500);
  await snap('11b_studio_appearance');

  // ORG
  await go('Organization');
  await snap('12_org');
  // org network view
  await p.evaluate(() => { const el=[...document.querySelectorAll('button')].find(e=>e.innerText.trim()==='Network'); if(el)el.click(); });
  await p.waitForTimeout(1000);
  await snap('12b_org_network');

  // SETTINGS
  await go('System Settings');
  await snap('13_settings');

  // AI COPILOT - check initial state (no messages)
  await go('AI Copilot');
  await snap('14_ask_initial');
  // Send one message
  const inp = await p.$('.chat-composer input');
  if (inp) { await inp.fill('How many customers?'); await p.keyboard.press('Enter'); await p.waitForTimeout(4000); }
  await snap('14b_ask_replied');

  // REPORTS
  await go('Reports');
  await snap('15_reports');

  // REPORT BUILDER
  await go('Report Builder');
  await snap('16_reportbuilder');

  // TOPBAR: Create menu open
  await go('Home');
  await p.click('button:has-text("Create")');
  await p.waitForTimeout(500);
  await snap('17_create_menu_open');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);

  // TOPBAR: User menu
  await p.click('#user-menu button');
  await p.waitForTimeout(500);
  await snap('18_user_menu');
  await p.keyboard.press('Escape');

  // TOPBAR: Notification bell
  await p.waitForTimeout(300);
  const bellBtns = await p.$$('.tb-icon');
  // Bell is 3rd from right before tenant
  for (let i = 0; i < bellBtns.length; i++) {
    const aria = await bellBtns[i].getAttribute('aria-label');
    if (aria && aria.toLowerCase().includes('notif')) {
      await bellBtns[i].click();
      await p.waitForTimeout(600);
      await snap('19_notifications');
      await p.keyboard.press('Escape');
      break;
    }
  }

  await b.close();
  console.log('\nAll audit screenshots saved. Check audit_*.png');
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
