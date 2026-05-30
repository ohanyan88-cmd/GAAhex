const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ headless: true, args: ['--window-size=1440,900'] });
  const p = await b.newPage();
  await p.setViewportSize({ width: 1440, height: 900 });
  p.on('pageerror', e => console.log('  JS_ERR:', e.message.slice(0,80)));
  await p.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await p.fill('input:nth-of-type(1)', 'admin@demo.isp');
  await p.fill('input[type="password"]', 'admin123');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(3500);

  const ea = async () => { await p.evaluate(() => document.querySelectorAll('.sb-sec-btn:not(.open)').forEach(b=>b.click())); await p.waitForTimeout(500); };
  const go = async (label) => { await ea(); await p.evaluate(l => { const el=[...document.querySelectorAll('.sb-item')].find(e=>e.innerText.trim()===l); if(el)el.click(); }, label); await p.waitForTimeout(2500); };
  const esc = async () => { await p.keyboard.press('Escape'); await p.waitForTimeout(400); };
  const snap = async (name) => p.screenshot({ path: `C:/Users/Admin/Desktop/Portal/dc_${name}.png` });
  const hasEl = async (sel) => !!(await p.$(sel));
  const cnt = async (sel) => (await p.$$(sel)).length;

  // TOPBAR
  console.log('\n=== TOPBAR ===');
  await p.click('.tenant');
  await p.waitForTimeout(800);
  await snap('01_tenant_click');
  console.log('Tenant dropdown:', (await cnt('[class*="tenant-menu"],[class*="switch"]')) > 0 ? 'OPENS' : 'NOTHING (BUG)');
  await esc();

  const userBtn = await p.$('#user-menu button');
  if (userBtn) { await userBtn.click(); await p.waitForTimeout(600); }
  await snap('02_user_menu');
  console.log('User menu opens:', await hasEl('.menu-label'));
  await esc();

  const createBtn = await p.$('button:has-text("Create")');
  if (createBtn) { await createBtn.click(); await p.waitForTimeout(800); }
  await snap('03_create');
  console.log('Create button action:', await hasEl('[role="dialog"],.modal') ? 'MODAL OPENS' : 'NOTHING (BUG)');
  await esc();

  // HOME
  console.log('\n=== HOME ===');
  await go('Home');
  await snap('04_home');
  const cfgPgBtn = await p.$('button:has-text("Configure page")');
  if (cfgPgBtn) { await cfgPgBtn.click(); await p.waitForTimeout(1000); await snap('05_home_cfg'); }
  console.log('Configure page:', await hasEl('.drawer,[class*="drawer"]') ? 'DRAWER OPENS' : 'NOTHING');
  await esc();

  // CUSTOMERS
  console.log('\n=== CUSTOMERS ===');
  await go('Customers');
  await snap('06_customers');
  const rows = await cnt('tbody tr');
  console.log('Customer rows visible:', rows);
  if (rows > 0) {
    await p.click('tbody tr');
    await p.waitForTimeout(1500);
    await snap('07_customer_drawer');
    console.log('Row click drawer:', await hasEl('.drawer,[class*="RecordDrawer"],[role="dialog"]') ? 'OPENS' : 'NOTHING (BUG)');
    await esc();
  }
  const newRecordBtn = await p.$('button:has-text("New Customer"), button:has-text("New")');
  if (newRecordBtn) { await newRecordBtn.click(); await p.waitForTimeout(800); await snap('07b_new_customer'); await esc(); }
  console.log('New customer button:', !!newRecordBtn ? 'EXISTS' : 'NOT FOUND');

  // CALENDAR
  console.log('\n=== CALENDAR ===');
  await go('Calendar');
  await p.click('button:has-text("New event")');
  await p.waitForTimeout(1200);
  await snap('08_calendar_newevent');
  console.log('New event modal:', await hasEl('[role="dialog"]') ? 'OPENS' : 'BROKEN');
  await esc();
  const cell = await p.$('.cal-cell.big:not(.off)');
  if (cell) { await cell.click(); await p.waitForTimeout(800); }
  console.log('Cell click modal:', await hasEl('[role="dialog"]') ? 'OPENS' : 'NOTHING');
  await esc();
  await p.evaluate(() => { const btn=[...document.querySelectorAll('button')].find(e=>e.innerText.trim()==='Week'); if(btn)btn.click(); });
  await p.waitForTimeout(800); await snap('09_calendar_week');
  console.log('Week tab: switched');

  // LEADS
  console.log('\n=== LEADS ===');
  await go('Leads');
  const newLeadBtn = await p.$('button:has-text("New lead")');
  if (newLeadBtn) { await newLeadBtn.click(); await p.waitForTimeout(800); await snap('10_leads_new'); }
  console.log('New lead form:', await hasEl('.rec-form') ? 'OPENS' : 'BROKEN');
  await p.keyboard.press('Escape');
  // Move button on a card
  const moveBtn = await p.$('.kcard button:has-text("Contacted"), .kcard button');
  if (moveBtn) { await moveBtn.click(); await p.waitForTimeout(1500); await snap('11_leads_move'); }
  console.log('Lead move button:', !!moveBtn);

  // HELPDESK
  console.log('\n=== HELPDESK ===');
  await go('Helpdesk');
  const newTktBtn = await p.$('button:has-text("New ticket")');
  if (newTktBtn) { await newTktBtn.click(); await p.waitForTimeout(1000); await snap('12_helpdesk_new'); }
  console.log('New ticket modal:', await hasEl('[role="dialog"]') ? 'OPENS' : 'BROKEN');
  await esc();
  const tktRow = await p.$('tbody tr');
  if (tktRow) { await tktRow.click(); await p.waitForTimeout(1200); await snap('13_helpdesk_detail'); }
  console.log('Ticket detail:', await hasEl('[role="dialog"],.modal') ? 'OPENS' : 'NOTHING (BUG)');
  await esc();

  // INVOICES
  console.log('\n=== INVOICES ===');
  await go('Invoices');
  await snap('14_invoices');
  const invRow = await p.$('tbody tr');
  if (invRow) { await invRow.click(); await p.waitForTimeout(1000); await snap('15_invoice_row'); }
  console.log('Invoice row drawer:', await hasEl('.drawer,[role="dialog"]') ? 'OPENS' : 'NOTHING');
  await esc();

  // SUBSCRIPTIONS
  console.log('\n=== SUBSCRIPTIONS ===');
  await go('Subscriptions');
  await snap('16_subs');
  const subRow = await p.$('tbody tr');
  if (subRow) { await subRow.click(); await p.waitForTimeout(1000); await snap('17_sub_row'); }
  console.log('Subscription row:', await hasEl('.drawer,[role="dialog"]') ? 'OPENS' : 'NOTHING');
  await esc();
  const rateBtn = await p.$('button:has-text("Rate")');
  const generateBtn = await p.$('button:has-text("Generate")');
  console.log('Rate button:', !!rateBtn, '| Generate button:', !!generateBtn);

  // STUDIO
  console.log('\n=== STUDIO ===');
  await p.evaluate(() => { const el=document.querySelector('.sb-foot .sb-item'); if(el)el.click(); });
  await p.waitForTimeout(2000); await snap('18_studio');
  console.log('Studio:', await hasEl('.studio') ? 'LOADS' : 'BROKEN');
  const studioNavs = await p.evaluate(() => [...document.querySelectorAll('.studio-nav-item')].map(e=>e.innerText.trim()));
  console.log('Studio sections:', studioNavs.join(' | '));
  // Click Fields
  await p.evaluate(() => { const el=[...document.querySelectorAll('.studio-nav-item')].find(e=>e.innerText.includes('Fields')); if(el)el.click(); });
  await p.waitForTimeout(1500); await snap('19_studio_fields');
  // Click Workflows
  await p.evaluate(() => { const el=[...document.querySelectorAll('.studio-nav-item')].find(e=>e.innerText.includes('Statuses')); if(el)el.click(); });
  await p.waitForTimeout(1500); await snap('20_studio_workflows');
  // Click Appearance
  await p.evaluate(() => { const el=[...document.querySelectorAll('.studio-nav-item')].find(e=>e.innerText.includes('Appearance')); if(el)el.click(); });
  await p.waitForTimeout(1500); await snap('21_studio_appearance');

  // ORG
  console.log('\n=== ORG ===');
  await go('Organization');
  await snap('22_org');
  const addNodeBtn = await p.$('button:has-text("Add node")');
  if (addNodeBtn) { await addNodeBtn.click(); await p.waitForTimeout(800); await snap('23_org_addnode'); }
  console.log('Add node modal:', await hasEl('[role="dialog"],.modal') ? 'OPENS' : 'NOTHING');
  await esc();
  await p.evaluate(() => { const el=[...document.querySelectorAll('button')].find(e=>e.innerText.trim()==='Cards'); if(el)el.click(); });
  await p.waitForTimeout(800); await snap('24_org_cards');
  await p.evaluate(() => { const el=[...document.querySelectorAll('button')].find(e=>e.innerText.trim()==='Network'); if(el)el.click(); });
  await p.waitForTimeout(1000); await snap('25_org_network');

  // SETTINGS
  console.log('\n=== SETTINGS ===');
  await go('System Settings');
  await snap('26_settings');
  console.log('Toggles:', await cnt('.gx-toggle'), '| Save btn:', await hasEl('button:has-text("Save")'));
  const saveBtn = await p.$('button:has-text("Save")');
  if (saveBtn) { await saveBtn.click(); await p.waitForTimeout(1500); await snap('27_settings_saved'); }

  // AI COPILOT
  console.log('\n=== AI COPILOT ===');
  await go('AI Copilot');
  await snap('28_ask');
  const aiInput = await p.$('.chat-composer input, .chat-composer .inp');
  if (aiInput) { await aiInput.fill('How many active subscriptions?'); await p.keyboard.press('Enter'); await p.waitForTimeout(4000); }
  await snap('29_ask_replied');
  console.log('AI bubbles:', await cnt('.bubble'));

  // REPORT BUILDER run
  console.log('\n=== REPORT BUILDER ===');
  await go('Report Builder');
  const runBtn = await p.$('button:has-text("count"), button:has-text("mine"), .card button');
  if (runBtn) { await runBtn.click(); await p.waitForTimeout(2500); await snap('30_report_run'); }
  console.log('Report run:', await cnt('.bubble, canvas, [class*="donut"], .kpi') > 0 ? 'HAS RESULTS' : 'EMPTY');

  // REPORTS page
  console.log('\n=== REPORTS ===');
  await go('Reports');
  await snap('31_reports');
  const kpiTile = await p.$('.kpi');
  if (kpiTile) { await kpiTile.click(); await p.waitForTimeout(1500); await snap('32_reports_drill'); }
  console.log('KPI drill-down:', await cnt('.cols .card') > 0 ? 'SHOWS' : 'NOTHING');

  await b.close();
  console.log('\nAll screenshots at Desktop/Portal/dc_*.png');
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
