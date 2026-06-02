/* GAAhex Portal — Communications: Messenger (chat) + Email client.
   Messages → Messenger · Outbound → Email */

// ───────────────────────── MESSENGER ─────────────────────────
const CONVOS = [
  { id:'c1', name:'Lilit Sargsyan', ch:'WhatsApp', last:'Thanks! The link light is green now 🙏', t:'2m', unread:2, on:true, av:'LS',
    msgs:[ ['in','Hi, my internet is down since morning','09:02'], ['out','Hi Lilit — checking your ONT now. One moment.','09:04'], ['in','Okay, thank you','09:04'], ['out','I re-provisioned the line. Can you check the link light?','09:21'], ['in','Thanks! The link light is green now 🙏','09:22'] ] },
  { id:'c2', name:'Hayk Grigoryan', ch:'Telegram', last:'When is the technician arriving?', t:'18m', unread:0, on:true, av:'HG',
    msgs:[ ['in','When is the technician arriving?','08:40'], ['out','Your install is booked for today 14:00–16:00.','08:42'] ] },
  { id:'c3', name:'Anna Hakobyan', ch:'WhatsApp', last:'I want to upgrade to Fiber 1G', t:'1h', unread:0, on:false, av:'AH',
    msgs:[ ['in','I want to upgrade to Fiber 1G','07:55'], ['out','Great choice! I can switch you today. Confirm?','07:58'], ['in','Yes please','08:01'] ] },
  { id:'c4', name:'Metro Gov — NOC', ch:'Internal', last:'Maintenance window confirmed 02:00', t:'3h', unread:0, on:true, av:'MG',
    msgs:[ ['in','Maintenance window confirmed 02:00','06:10'] ] },
  { id:'c5', name:'Tigran Avetisyan', ch:'SMS', last:'No service after the storm', t:'5h', unread:1, on:false, av:'TA',
    msgs:[ ['in','No service after the storm','04:20'], ['out','Sorry to hear — we logged an outage in your area, ETA 2h.','04:25'] ] },
];
const CH_TONE = { WhatsApp:'var(--gx-success)', Telegram:'var(--azure-400)', SMS:'var(--gx-warning)', Internal:'var(--gx-gold)' };
const EMOJIS = ['👍','🙏','✅','🔧','📶','📡','😊','🎉','👀','🚀','⚠️','💡','📞','🛠️','❤️','🔥'];
const QUICK = ['On my way 🚗','Issue resolved ✅','Technician dispatched 🔧','Please restart your router 🔌','Thanks for your patience 🙏'];
const AUTO_REPLIES = ['Thank you! 🙏','Okay, understood.','Great, that works for me.','When can I expect it?','Perfect, thanks for the quick help!'];

function nowTime() { const d = new Date(); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }

function Messenger({ item }) {
  const [active, setActive] = React.useState('c1');
  const [convos, setConvos] = React.useState(() => CONVOS.map(c => ({ ...c, msgs: c.msgs.map(m => [...m]), pinned:false, muted:false })));
  const [draft, setDraft] = React.useState('');
  const [q, setQ] = React.useState('');
  const [chFilter, setChFilter] = React.useState('All');
  const [emoji, setEmoji] = React.useState(false);
  const [attach, setAttach] = React.useState(false);
  const [quick, setQuick] = React.useState(false);
  const [info, setInfo] = React.useState(false);
  const [typing, setTyping] = React.useState(false);
  const [menu, setMenu] = React.useState(null);
  const bodyRef = React.useRef(null);
  const inRef = React.useRef(null);
  const cur = convos.find(c => c.id === active);

  React.useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [active, cur && cur.msgs.length, typing]);

  const pushMsg = (id, m) => setConvos(cs => cs.map(c => c.id === id ? { ...c, msgs: [...c.msgs, m], last: typeof m[1]==='string'?m[1]:'📎 Attachment', t: 'now', unread: 0 } : c));
  const send = (text) => {
    const v = (text ?? draft).trim(); if (!v) return;
    pushMsg(active, ['out', v, nowTime(), { status:'sent' }]);
    setDraft(''); setEmoji(false); setQuick(false);
    setTimeout(() => setConvos(cs => cs.map(c => c.id===active ? {...c, msgs:c.msgs.map((m,i)=> i===c.msgs.length-1 && m[0]==='out' ? [m[0],m[1],m[2],{status:'read'}] : m)} : c)), 900);
    // simulated reply + typing indicator
    setTimeout(() => setTyping(true), 1100);
    setTimeout(() => { setTyping(false); const r = AUTO_REPLIES[Math.floor(Math.random()*AUTO_REPLIES.length)]; pushMsg(active, ['in', r, nowTime()]); }, 2400);
  };
  const sendAttach = (kind) => { setAttach(false); pushMsg(active, ['out', { attach: kind }, nowTime(), { status:'sent' }]); gxToast(kind + ' sent'); };
  const react = (mi, em) => setConvos(cs => cs.map(c => c.id===active ? {...c, msgs:c.msgs.map((m,i)=> i===mi ? [m[0],m[1],m[2],{...(m[3]||{}), reaction: (m[3]&&m[3].reaction)===em?null:em}] : m)} : c));
  const togglePin = (id) => setConvos(cs => cs.map(c => c.id===id?{...c,pinned:!c.pinned}:c));
  const toggleMute = (id) => setConvos(cs => cs.map(c => c.id===id?{...c,muted:!c.muted}:c));
  const markUnread = (id) => setConvos(cs => cs.map(c => c.id===id?{...c,unread:1}:c));

  let list = convos.filter(c => (chFilter==='All' || c.ch===chFilter) && (!q || c.name.toLowerCase().includes(q.toLowerCase()) || c.last.toLowerCase().includes(q.toLowerCase())));
  list = [...list].sort((a,b)=> (b.pinned?1:0)-(a.pinned?1:0));
  const totalUnread = convos.reduce((s,c)=>s+c.unread,0);

  return (
    <div className="comms-shell fade">
      <div className="comms-head">
        <div className="vh-ic"><Icon name="message-square" size={20} /></div>
        <div><h1 style={{ fontFamily:'var(--gx-font-display)', fontSize:21, fontWeight:600, margin:0, letterSpacing:'-.02em' }}>Messages</h1><div className="sub" style={{ color:'var(--gx-text-3)', fontSize:12.5 }}>Omnichannel inbox{totalUnread>0?` · ${totalUnread} unread`:''} · WhatsApp · Telegram · SMS</div></div>
        <span className="spacer" />
        <button className="btn btn-secondary btn-sm hide-sm" onClick={()=>gxToast('Filtering — configure routing in Studio','info')}><Icon name="filter" size={14} />Filters</button>
        <button className="btn btn-primary btn-sm" onClick={()=>gxToast('New chat — pick a contact')}><Icon name="pen-square" size={14} />New chat</button>
      </div>
      <div className="msgr">
        <div className="msgr-list">
          <div className="msgr-search"><Icon name="search" size={14} /><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search conversations" style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--gx-text-1)', fontSize:13, fontFamily:'var(--gx-font-sans)' }} />{q && <button className="tb-icon" style={{width:22,height:22}} onClick={()=>setQ('')}><Icon name="x" size={13} /></button>}</div>
          <div className="msgr-tabs">
            {['All','WhatsApp','Telegram','SMS','Internal'].map(t => <button key={t} className={'msgr-tab'+(chFilter===t?' on':'')} onClick={()=>setChFilter(t)}>{t!=='All' && <span style={{width:6,height:6,borderRadius:'50%',background:CH_TONE[t]}} />}{t}</button>)}
          </div>
          <div style={{ overflowY:'auto', flex:1 }}>
            {list.map(c => (
              <div key={c.id} className={'convo' + (active === c.id ? ' on' : '')} onClick={() => { setActive(c.id); setInfo(false); setConvos(cs => cs.map(x => x.id === c.id ? { ...x, unread: 0 } : x)); }}>
                <span style={{ position:'relative', flexShrink:0 }}>
                  <span className="avatar" style={{ width:38, height:38, fontSize:13 }}>{c.av}</span>
                  {c.on && <span style={{ position:'absolute', right:0, bottom:0, width:10, height:10, borderRadius:'50%', background:'var(--gx-online)', border:'2px solid var(--gx-surface)' }} />}
                </span>
                <span style={{ flex:1, minWidth:0, textAlign:'left' }}>
                  <span style={{ display:'flex', alignItems:'center', gap:6 }}>{c.pinned && <Icon name="pin" size={11} style={{color:'var(--gx-gold)'}} />}<span style={{ fontWeight:600, fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.name}</span><span style={{ width:6, height:6, borderRadius:'50%', background:CH_TONE[c.ch], flexShrink:0 }} title={c.ch} /><span className="hint" style={{ marginLeft:'auto', fontSize:11, flexShrink:0 }}>{c.t}</span></span>
                  <span style={{ display:'flex', alignItems:'center', gap:6, marginTop:2 }}><span style={{ fontSize:12, color:'var(--gx-text-2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{c.last}</span>{c.muted && <Icon name="bell-off" size={12} style={{color:'var(--gx-text-3)'}} />}{c.unread > 0 && <span className="badge">{c.unread}</span>}</span>
                </span>
                <button className="convo-menu tb-icon" style={{width:26,height:26}} onClick={(e)=>{ e.stopPropagation(); setMenu(menu===c.id?null:c.id); }}><Icon name="ellipsis-vertical" size={15} /></button>
                {menu===c.id && (
                  <div className="menu fade-fast" style={{ position:'absolute', right:8, top:44, zIndex:20 }} onClick={e=>e.stopPropagation()}>
                    <button className="menu-item" onClick={()=>{togglePin(c.id); setMenu(null);}}><Icon name="pin" size={15} />{c.pinned?'Unpin':'Pin'}</button>
                    <button className="menu-item" onClick={()=>{toggleMute(c.id); setMenu(null);}}><Icon name={c.muted?'bell':'bell-off'} size={15} />{c.muted?'Unmute':'Mute'}</button>
                    <button className="menu-item" onClick={()=>{markUnread(c.id); setMenu(null);}}><Icon name="mail" size={15} />Mark unread</button>
                    <div className="menu-sep" />
                    <button className="menu-item" onClick={()=>{gxToast('Converted to work item');setMenu(null);}}><Icon name="rows-3" size={15} />Create work item</button>
                  </div>
                )}
              </div>
            ))}
            {list.length===0 && <div className="hint" style={{textAlign:'center', padding:'30px 16px'}}>No conversations match.</div>}
          </div>
        </div>
        <div className="chat">
          <div className="chat-head">
            <span style={{position:'relative'}}><span className="avatar" style={{ width:34, height:34, fontSize:12 }}>{cur.av}</span>{cur.on && <span style={{ position:'absolute', right:0, bottom:0, width:9, height:9, borderRadius:'50%', background:'var(--gx-online)', border:'2px solid var(--gx-surface)' }} />}</span>
            <div><div style={{ fontWeight:600, fontSize:13.5 }}>{cur.name}</div><div className="hint" style={{ fontSize:11, display:'flex', alignItems:'center', gap:5 }}><span style={{ width:6, height:6, borderRadius:'50%', background:CH_TONE[cur.ch] }} />{cur.ch} · {typing ? <span style={{color:'var(--gx-success)'}}>typing…</span> : (cur.on ? 'online' : 'last seen 1h ago')}</div></div>
            <span className="spacer" />
            <button className="tb-icon" onClick={()=>gxToast('Calling '+cur.name+'…')}><Icon name="phone" size={17} /></button>
            <button className="tb-icon" onClick={()=>gxToast('Search in conversation','info')}><Icon name="search" size={17} /></button>
            <button className={'tb-icon'+(info?' on':'')} onClick={()=>setInfo(v=>!v)}><Icon name="panel-right" size={17} /></button>
          </div>
          <div className="chat-wrap">
            <div className="chat-body" ref={bodyRef}>
              <div className="chat-day">Today</div>
              {cur.msgs.map((m, i) => {
                const meta = m[3] || {};
                const isAttach = m[1] && typeof m[1] === 'object';
                return (
                  <div key={i} className={'bubble-row ' + m[0]}>
                    <div className="bubble-wrap">
                      <div className={'bubble ' + m[0]} onDoubleClick={()=>react(i, '👍')}>
                        {isAttach
                          ? <span style={{display:'flex',alignItems:'center',gap:8}}><Icon name={m[1].attach==='Photo'?'image':m[1].attach==='Location'?'map-pin':'file'} size={16} />{m[1].attach}</span>
                          : m[1]}
                        <span className="bt">{m[2]}{m[0] === 'out' && <Icon name={meta.status==='read'?'check-check':'check'} size={13} style={{ marginLeft:4, verticalAlign:'-2px', color: meta.status==='read'?'var(--azure-300)':'currentColor' }} />}</span>
                        <div className="bubble-react"><button onClick={()=>react(i,'👍')}>👍</button><button onClick={()=>react(i,'❤️')}>❤️</button><button onClick={()=>react(i,'🙏')}>🙏</button></div>
                      </div>
                      {meta.reaction && <span className="reaction-chip">{meta.reaction}</span>}
                    </div>
                  </div>
                );
              })}
              {typing && <div className="bubble-row in"><div className="bubble in typing"><span /><span /><span /></div></div>}
            </div>
            {info && (
              <div className="chat-info">
                <div style={{textAlign:'center', padding:'18px 0 12px'}}>
                  <span className="avatar" style={{width:64,height:64,fontSize:22,margin:'0 auto'}}>{cur.av}</span>
                  <div style={{fontWeight:600, fontSize:15, marginTop:10}}>{cur.name}</div>
                  <div className="hint" style={{fontSize:11.5, display:'flex',alignItems:'center',gap:5,justifyContent:'center',marginTop:3}}><span style={{width:6,height:6,borderRadius:'50%',background:CH_TONE[cur.ch]}} />{cur.ch}</div>
                </div>
                <div style={{display:'flex',gap:8,justifyContent:'center',padding:'0 0 14px'}}>
                  <button className="info-act" onClick={()=>gxToast('Calling…')}><Icon name="phone" size={16} /><span>Call</span></button>
                  <button className="info-act" onClick={()=>toggleMute(cur.id)}><Icon name={cur.muted?'bell':'bell-off'} size={16} /><span>{cur.muted?'Unmute':'Mute'}</span></button>
                  <button className="info-act" onClick={()=>togglePin(cur.id)}><Icon name="pin" size={16} /><span>{cur.pinned?'Unpin':'Pin'}</span></button>
                </div>
                <div className="lbl" style={{fontSize:10, letterSpacing:'.12em', textTransform:'uppercase', color:'var(--gx-text-3)', padding:'0 0 8px'}}>Customer</div>
                <div className="kv" style={{padding:'8px 0'}}><span className="kv-k" style={{width:80}}>Plan</span><span className="kv-v">Fiber 500</span></div>
                <div className="kv" style={{padding:'8px 0'}}><span className="kv-k" style={{width:80}}>Status</span><span className="kv-v"><span className="pill pill-success">Active</span></span></div>
                <div className="kv" style={{padding:'8px 0'}}><span className="kv-k" style={{width:80}}>Open WI</span><span className="kv-v"><span className="mono" style={{color:'var(--gx-link)'}}>TK-4821</span></span></div>
                <button className="btn btn-secondary btn-sm" style={{width:'100%',marginTop:14}} onClick={()=>gxToast('Opening customer record')}><Icon name="user" size={14} />Open customer</button>
              </div>
            )}
          </div>
          {(emoji || attach || quick) && <div className="pop-scrim" onClick={()=>{setEmoji(false);setAttach(false);setQuick(false);}} />}
          <div className="chat-composer">
            <div style={{position:'relative'}}>
              <button className={'tb-icon'+(attach?' on':'')} onClick={()=>{setAttach(v=>!v);setEmoji(false);setQuick(false);}}><Icon name="paperclip" size={18} /></button>
              {attach && <div className="menu fade-fast" style={{position:'absolute',bottom:42,left:0}}>
                <button className="menu-item" onClick={()=>sendAttach('Photo')}><Icon name="image" size={15} />Photo</button>
                <button className="menu-item" onClick={()=>sendAttach('Document')}><Icon name="file" size={15} />Document</button>
                <button className="menu-item" onClick={()=>sendAttach('Location')}><Icon name="map-pin" size={15} />Location</button>
              </div>}
            </div>
            <div style={{position:'relative'}}>
              <button className={'tb-icon'+(emoji?' on':'')} onClick={()=>{setEmoji(v=>!v);setAttach(false);setQuick(false);}}><Icon name="smile" size={18} /></button>
              {emoji && <div className="emoji-pop fade-fast">{EMOJIS.map(e => <button key={e} onClick={()=>{setDraft(d=>d+e); inRef.current&&inRef.current.focus();}}>{e}</button>)}</div>}
            </div>
            <div style={{position:'relative'}}>
              <button className={'tb-icon'+(quick?' on':'')} title="Quick replies" onClick={()=>{setQuick(v=>!v);setEmoji(false);setAttach(false);}}><Icon name="zap" size={17} /></button>
              {quick && <div className="menu fade-fast" style={{position:'absolute',bottom:42,left:0,minWidth:240}}>{QUICK.map(qr => <button key={qr} className="menu-item" onClick={()=>send(qr)}>{qr}</button>)}</div>}
            </div>
            <input ref={inRef} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send(); }} placeholder="Type a message…" className="inp" style={{ flex:1 }} />
            <button className="btn btn-primary btn-icon" onClick={()=>send()} aria-label="Send"><Icon name="send-horizontal" size={16} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── EMAIL ─────────────────────────
const FOLDERS = [ ['inbox','Inbox','inbox',6],['sent','Sent','send',0],['drafts','Drafts','file-text',2],['outbox','Outbox','clock',1],['scheduled','Scheduled','calendar-clock',4],['campaigns','Campaigns','megaphone',0],['archive','Archive','archive',0] ];
const EMAILS = [
  { id:'e1', who:'Lilit Sargsyan', addr:'lilit.s@mail.am', subj:'Re: Your Fiber 500 invoice', snip:'Thank you, payment is done. Could you send a receipt?', t:'09:24', unread:true, star:true, attach:false, tag:'Billing',
    body:'Hi,\n\nThank you, payment is done. Could you send a receipt for my records?\n\nBest,\nLilit' },
  { id:'e2', who:'Hayk Grigoryan', addr:'hayk.g@mail.am', subj:'Installation confirmation — today 14:00', snip:'Confirming the technician visit window for today.', t:'08:51', unread:true, star:false, attach:true, tag:'Field Ops',
    body:'Hello,\n\nConfirming the technician visit window for today, 14:00–16:00. The address is correct.\n\nThanks!' },
  { id:'e3', who:'Acme Corp — Procurement', addr:'proc@acme.am', subj:'Enterprise contract renewal Q3', snip:'Please find attached the renewal terms for review.', t:'Yesterday', unread:false, star:true, attach:true, tag:'Enterprise',
    body:'Dear GAAhex team,\n\nPlease find attached the renewal terms for Q3. We would like to add 12 new sites.\n\nRegards,\nProcurement' },
  { id:'e4', who:'Anna Hakobyan', addr:'anna.h@mail.am', subj:'Upgrade to Fiber 1G', snip:'Yes please proceed with the upgrade today.', t:'Yesterday', unread:false, star:false, attach:false, tag:'Sales',
    body:'Yes please proceed with the upgrade today. What is the new monthly price?' },
  { id:'e5', who:'Outage Notifications', addr:'noc@gaahex.am', subj:'Planned maintenance — Yerevan POP-3', snip:'Scheduled 02:00–04:00. Estimated 8,400 customers affected.', t:'Mon', unread:false, star:false, attach:false, tag:'NOC',
    body:'Planned maintenance for Yerevan POP-3 is scheduled 02:00–04:00 tonight. Estimated 8,400 customers affected. Notifications queued.' },
];

function EmailView({ item }) {
  const [folder, setFolder] = React.useState('inbox');
  const [sel, setSel] = React.useState('e1');
  const [compose, setCompose] = React.useState(false);
  const cur = EMAILS.find(e => e.id === sel);
  return (
    <div className="comms-shell fade">
      <div className="comms-head">
        <div className="vh-ic"><Icon name="mail" size={20} /></div>
        <div><h1 style={{ fontFamily:'var(--gx-font-display)', fontSize:21, fontWeight:600, margin:0, letterSpacing:'-.02em' }}>Outbound</h1><div className="sub" style={{ color:'var(--gx-text-3)', fontSize:12.5 }}>Email · campaigns · transactional</div></div>
        <span className="spacer" />
        <button className="btn btn-secondary btn-sm hide-sm"><Icon name="refresh-cw" size={14} />Sync</button>
        <button className="btn btn-primary btn-sm" onClick={() => setCompose(true)}><Icon name="pen-square" size={14} />Compose</button>
      </div>
      <div className="mail">
        <div className="mail-folders">
          <button className="btn btn-gold btn-sm" style={{ width:'100%', marginBottom:10 }} onClick={() => setCompose(true)}><Icon name="pen-square" size={14} />Compose</button>
          {FOLDERS.map(f => (
            <button key={f[0]} className={'mail-folder' + (folder === f[0] ? ' on' : '')} onClick={() => setFolder(f[0])}>
              <Icon name={f[2]} size={15} /><span>{f[1]}</span>{f[3] > 0 && <span className="badge" style={{ marginLeft:'auto', background: folder===f[0]?'var(--gx-primary)':'var(--gx-surface-2)', color: folder===f[0]?'#fff':'var(--gx-text-3)' }}>{f[3]}</span>}
            </button>
          ))}
          <div style={{ borderTop:'1px solid var(--gx-border-subtle)', margin:'12px 4px', paddingTop:12 }}>
            <div className="lbl" style={{ fontSize:10, letterSpacing:'.12em', textTransform:'uppercase', color:'var(--gx-text-3)', padding:'0 6px 8px' }}>Labels</div>
            {[['Billing','var(--azure-400)'],['Enterprise','var(--gx-gold)'],['NOC','var(--gx-danger)']].map(l => <div key={l[0]} className="mail-folder" style={{ cursor:'default' }}><span style={{ width:9, height:9, borderRadius:3, background:l[1] }} /><span>{l[0]}</span></div>)}
          </div>
        </div>
        <div className="mail-list">
          <div className="msgr-search" style={{ margin:10 }}><Icon name="search" size={14} /><input placeholder="Search mail" style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--gx-text-1)', fontSize:13, fontFamily:'var(--gx-font-sans)' }} /></div>
          <div style={{ overflowY:'auto', flex:1 }}>
            {EMAILS.map(e => (
              <button key={e.id} className={'mail-row' + (sel === e.id ? ' on' : '') + (e.unread ? ' unread' : '')} onClick={() => setSel(e.id)}>
                <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                  <Icon name={e.star ? 'star' : 'star'} size={13} style={{ color: e.star ? 'var(--gx-gold)' : 'var(--gx-text-3)', fill: e.star ? 'var(--gx-gold)' : 'none' }} />
                  <span style={{ fontWeight: e.unread ? 700 : 600, fontSize:13 }}>{e.who}</span>
                  <span className="hint" style={{ marginLeft:'auto', fontSize:11 }}>{e.t}</span>
                </div>
                <div style={{ fontSize:12.5, fontWeight: e.unread ? 600 : 400, marginTop:3 }}>{e.subj}</div>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:3 }}><span style={{ fontSize:11.5, color:'var(--gx-text-3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{e.snip}</span>{e.attach && <Icon name="paperclip" size={12} style={{ color:'var(--gx-text-3)' }} />}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="mail-read">
          <div style={{ padding:'18px 22px', borderBottom:'1px solid var(--gx-border-subtle)' }}>
            <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
              <h2 style={{ fontFamily:'var(--gx-font-display)', fontSize:19, fontWeight:600, margin:0, flex:1, letterSpacing:'-.01em' }}>{cur.subj}</h2>
              <span className="pill pill-info">{cur.tag}</span>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:14 }}>
              <span className="avatar" style={{ width:36, height:36 }}>{initials(cur.who)}</span>
              <div style={{ flex:1 }}><div style={{ fontSize:13, fontWeight:600 }}>{cur.who} <span className="mono" style={{ color:'var(--gx-text-3)', fontWeight:400, fontSize:12 }}>&lt;{cur.addr}&gt;</span></div><div className="hint" style={{ fontSize:11.5 }}>to me · {cur.t}</div></div>
              <button className="tb-icon"><Icon name="reply" size={17} /></button>
              <button className="tb-icon"><Icon name="forward" size={17} /></button>
              <button className="tb-icon"><Icon name="ellipsis-vertical" size={17} /></button>
            </div>
          </div>
          <div style={{ flex:1, overflowY:'auto', padding:'20px 22px', fontSize:13.5, lineHeight:1.7, color:'var(--gx-text-1)', whiteSpace:'pre-wrap' }}>{cur.body}</div>
          <div style={{ padding:'14px 22px', borderTop:'1px solid var(--gx-border-subtle)', display:'flex', gap:10 }}>
            <button className="btn btn-primary btn-sm"><Icon name="reply" size={14} />Reply</button>
            <button className="btn btn-secondary btn-sm"><Icon name="forward" size={14} />Forward</button>
            <span className="spacer" />
            <button className="btn btn-ghost btn-sm"><Icon name="archive" size={14} />Archive</button>
          </div>
        </div>
      </div>
      {compose && <Compose onClose={() => setCompose(false)} />}
    </div>
  );
}

function Compose({ onClose }) {
  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'var(--gx-overlay)', backdropFilter:'blur(4px)', zIndex:'var(--gx-z-modal)', display:'flex', alignItems:'flex-end', justifyContent:'flex-end', padding:24 }}>
      <div className="fade" onClick={e => e.stopPropagation()} style={{ width:560, maxWidth:'92vw', background:'var(--gx-elevated)', border:'1px solid var(--gx-border-strong)', borderRadius:'var(--gx-radius-xl)', boxShadow:'var(--gx-shadow-xl)', overflow:'hidden' }}>
        <div style={{ display:'flex', alignItems:'center', padding:'13px 16px', borderBottom:'1px solid var(--gx-border-subtle)', background:'var(--gx-surface-2)' }}><span style={{ fontWeight:600, fontSize:13.5 }}>New message</span><span className="spacer" /><button className="tb-icon" onClick={onClose}><Icon name="x" size={16} /></button></div>
        <div style={{ padding:16, display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, borderBottom:'1px solid var(--gx-border-subtle)', paddingBottom:8 }}><span className="hint" style={{ width:48, fontSize:12 }}>To</span><input className="inp" style={{ border:'none', background:'none', padding:0 }} placeholder="customer@mail.am" /></div>
          <div style={{ display:'flex', alignItems:'center', gap:8, borderBottom:'1px solid var(--gx-border-subtle)', paddingBottom:8 }}><span className="hint" style={{ width:48, fontSize:12 }}>Subject</span><input className="inp" style={{ border:'none', background:'none', padding:0 }} placeholder="Subject" defaultValue="Your GAAhex service" /></div>
          <textarea className="inp" rows={7} style={{ resize:'vertical', height:'auto', padding:'10px 11px', lineHeight:1.6 }} placeholder="Write your message…" defaultValue={"Hi,\n\n"} />
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 16px', borderTop:'1px solid var(--gx-border-subtle)' }}>
          <button className="btn btn-primary btn-sm"><Icon name="send-horizontal" size={14} />Send</button>
          <button className="tb-icon"><Icon name="paperclip" size={17} /></button>
          <button className="tb-icon"><Icon name="image" size={17} /></button>
          <span className="spacer" />
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Discard</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Messenger, EmailView });
