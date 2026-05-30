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

  // Topbar
  await p.screenshot({ path: 'C:/Users/Admin/Desktop/Portal/fix_topbar.png', clip: {x:0,y:0,width:1440,height:60} });
  const tbText = await p.evaluate(() => [...document.querySelector('.tenant').childNodes].filter(n=>n.nodeType===3||n.nodeName!=='svg').map(n=>n.textContent?.trim()).filter(Boolean));
  console.log('Tenant chip text:', tbText);

  // Calendar - check seg buttons
  await go('Calendar');
  await p.screenshot({ path: 'C:/Users/Admin/Desktop/Portal/fix_calendar.png' });
  await p.screenshot({ path: 'C:/Users/Admin/Desktop/Portal/fix_calendar_head.png', clip: {x:260,y:55,width:1180,height:80} });
  const segInfo = await p.evaluate(() => {
    const seg = document.querySelector('.seg');
    if (!seg) return 'NO SEG';
    const s = window.getComputedStyle(seg);
    const btns = [...seg.querySelectorAll('button')].map(b => ({ text: b.innerText, bg: window.getComputedStyle(b).background.slice(0,30) }));
    return { display: s.display, bg: s.background.slice(0,30), buttons: btns };
  });
  console.log('SEG:', JSON.stringify(segInfo));

  // Settings - check toggles
  await go('System Settings');
  await p.screenshot({ path: 'C:/Users/Admin/Desktop/Portal/fix_settings.png' });
  const toggleInfo = await p.evaluate(() => {
    const toggles = [...document.querySelectorAll('.gx-toggle')];
    return toggles.map(t => {
      const s = window.getComputedStyle(t);
      const knob = t.querySelector('.knob');
      return { w: s.width, h: s.height, bg: s.background.slice(0,30), hasKnob: !!knob };
    });
  });
  console.log('TOGGLES:', JSON.stringify(toggleInfo));

  // Check Outbound in nav
  const outboundInNav = await p.evaluate(() => {
    return !!([...document.querySelectorAll('.sb-item')].find(e=>e.innerText.trim()==='Outbound'));
  });
  console.log('Outbound in nav (need expand):', outboundInNav);
  await ea(); // expand all
  const outboundExpanded = await p.evaluate(() => {
    return !!([...document.querySelectorAll('.sb-item')].find(e=>e.innerText.trim()==='Outbound'));
  });
  console.log('Outbound in nav (expanded):', outboundExpanded);

  // Navigate to Outbound
  const clicked = await p.evaluate(() => {
    const el = [...document.querySelectorAll('.sb-item')].find(e=>e.innerText.trim()==='Outbound');
    if (el) { el.click(); return true; } return false;
  });
  await p.waitForTimeout(2000);
  await p.screenshot({ path: 'C:/Users/Admin/Desktop/Portal/fix_outbound.png' });
  console.log('Outbound navigated:', clicked);

  await b.close();
  console.log('Done');
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
