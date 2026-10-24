/* Google Desk. Google data and credentials are never put in browser storage. */
(() => {
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const API = 'http://127.0.0.1:8765';
  const params = new URLSearchParams(location.search);
  const fragment = new URLSearchParams(location.hash.slice(1));
  let session = fragment.get('session') || '';
  if (session) history.replaceState(null, '', location.pathname + location.search);
  let demo = params.get('demo') === '1';
  let status = {accounts: [], admin: false};
  let statusLoaded = false, helperOnline = false, connectionFailures = 0;
  let account = 'all', view = 'today', day = new Date(), unread = false, category = 'primary', source = 'local';
  let events = [], emails = [], notes = [], labels = {}, selectedMail = '', currentNote = null, dirty = false;
  let busy = false, generation = 0, messageGeneration = 0, lastRefresh = 0, reminderDismissed = '', reminderKey = '';
  let noteField = null, keyboardShift = false, keyboardSymbols = false;
  const colors = ['#a9e8cb','#b9bbef','#f1d79b','#9bcbe8','#edb1c1'];
  const storageKey = () => 'google-desk-display-' + (typeof uniqueId !== 'undefined' ? uniqueId : 'browser');
  let preferences = {accent:'#a9e8cb', theme:'dark', refresh:60, lead:10, textSize:150, order:['calendar','inbox','reader','notes']};
  try { preferences = {...preferences, ...JSON.parse(localStorage.getItem(storageKey()) || '{}')}; } catch (_) {}

  function property(name) {
    if (Object.prototype.hasOwnProperty.call(window, name) && window[name] !== undefined) return window[name];
    try { return Function('return typeof ' + name + ' !== "undefined" ? ' + name + ' : undefined')(); } catch (_) { return undefined; }
  }
  function pairedKey() { return String(property('pairingKey') || window.googleDeskPairingKey || ''); }
  function waitingForHelper() { return !statusLoaded && !!(session || pairedKey()) && !demo; }
  function savePreferences() { try { localStorage.setItem(storageKey(), JSON.stringify(preferences)); } catch (_) {} applyPreferences(); }
  function applyPreferences() {
    const root = document.documentElement.style;
    root.setProperty('--accent', property('accentColor') || preferences.accent);
    root.setProperty('--text', property('textColor') || '#edf3f7');
    root.setProperty('--text-scale', Math.max(100, Math.min(200, Number(property('textSize') || preferences.textSize))) / 100);
    const base = property('backgroundColor') || (preferences.theme === 'midnight' ? '#080d16' : '#101619');
    const alpha = 1 - Math.min(100, Math.max(0, Number(property('transparency') || 0))) / 100;
    if (/^#[0-9a-f]{6}$/i.test(base)) {
      root.setProperty('--bg', `rgba(${parseInt(base.slice(1,3),16)},${parseInt(base.slice(3,5),16)},${parseInt(base.slice(5,7),16)},${alpha})`);
    }
    preferences.order.forEach((name, index) => { if ($(name + '-panel')) $(name + '-panel').style.order = index; });
  }
  icueEvents = {onICUEInitialized: () => {applyPreferences(); refresh();}, onDataUpdated: () => {applyPreferences(); refresh();}};
  pluginLinkproviderEvents = {onInitialized: () => {}};
  let bootAttempts = 0;
  function bootCheck() {
    if (typeof iCUE_initialized !== 'undefined' && iCUE_initialized) applyPreferences();
    else if (++bootAttempts < 15) setTimeout(bootCheck, 100);
  }
  bootCheck();

  function openLink(url) {
    let parsed;
    try { parsed = new URL(url); } catch (_) { return; }
    const allowed = parsed.protocol === 'https:' && (parsed.hostname === 'accounts.google.com' || parsed.hostname === 'meet.google.com' || parsed.hostname === 'calendar.google.com' || parsed.hostname === 'mail.google.com' || parsed.hostname === 'keep.google.com' || parsed.hostname === 'console.cloud.google.com' || parsed.hostname === 'gkeepapi.readthedocs.io' || parsed.hostname === 'support.google.com');
    if (!allowed) return;
    try {
      if (window.plugins && window.plugins.Linkprovider && typeof pluginLinkprovider_initialized !== 'undefined' && pluginLinkprovider_initialized) window.plugins.Linkprovider.open(url);
      else window.open(url, '_blank', 'noopener,noreferrer');
    } catch (_) { notice('Could not open the link. Check the iCUE Link Provider.'); }
  }
  async function api(path, data) {
    const key = session || pairedKey();
    if (!key) throw new Error('Open the Google Desk tray menu and choose Install paired iCUE widget once. New instances of that widget reconnect automatically.');
    const response = await fetch(API + '/api/' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {'Authorization': 'Bearer ' + key, ...(data === undefined ? {} : {'Content-Type':'application/json'})},
      body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(60000)
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'The companion could not complete this request.');
    return value;
  }
  function notice(message) { $('notice').textContent = message; $('notice').hidden = !message; }
  function readableError(error) { return error.message === 'Failed to fetch' || error.name === 'TimeoutError' ? 'Companion offline or blocked. Start Google Desk and allow 127.0.0.1:8765 in iCUE permissions. Last loaded data stays visible.' : error.message; }
  const dateKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  function dateFrom(value) { return value.dateTime ? new Date(value.dateTime) : new Date(value.date + 'T00:00:00'); }
  const eventStart = event => dateFrom(event.start);
  const eventEnd = event => dateFrom(event.end);
  const timeLabel = date => date.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
  const longDate = date => date.toLocaleDateString([], {weekday:'long',month:'short',day:'numeric'});
  function sameDay(a,b) { return dateKey(a) === dateKey(b); }
  function addDays(date, count) { const value = new Date(date); value.setDate(value.getDate() + count); return value; }
  function empty(icon,title,text,action) { return `<div class="empty-state"><span class="empty-icon">${icon}</span><strong>${esc(title)}</strong><p>${esc(text)}</p>${action ? `<button class="primary-button" data-action="${esc(action[0])}">${esc(action[1])}</button>` : ''}</div>`; }

  function demoData() {
    const today = new Date(); today.setHours(0,0,0,0);
    const event = (id,title,offset,hour,minute,duration,calendar,color,link='') => {
      const start = addDays(today,offset); start.setHours(hour,minute);
      return {id,title,account:'you@example.com',calendarId:calendar,calendar,color,start:{dateTime:start.toISOString()},end:{dateTime:new Date(+start+duration*60000).toISOString()},link};
    };
    const next = new Date(Date.now()+8*60000); next.setSeconds(0,0);
    events = [event('d1','A little time to focus',0,9,0,60,'Personal','#b9bbef'),event('d2','Design catch-up',0,next.getHours(),next.getMinutes(),30,'Work','#a9e8cb','https://meet.google.com/'),event('d3','Lunch & a walk',0,12,30,60,'Personal','#f1d79b'),event('d4','Project check-in',1,10,0,30,'Work','#a9e8cb'),event('d5','Make something good',2,14,0,90,'Personal','#b9bbef'),event('d6','Weekly planning',4,11,0,45,'Work','#a9e8cb')];
    const samples = [
      ['maya@example.com','Maya Chen','A few ideas for next week','I put together a few thoughts for our next project. The direction is feeling good!','Hey,\n\nI put together a few thoughts for our next project.\n\nThe direction is feeling good — a little more breathing room, a simpler layout, and a stronger focus on what matters.\n\nLet’s walk through it at the catch-up. I’d love to hear what you think.\n\nSee you soon,\nMaya',['INBOX','UNREAD','STARRED','CATEGORY_PERSONAL','Label_1']],
      ['calendar@example.com','Google Calendar','Your day at a glance','A few things on the calendar today.','You have a few things on the calendar today.\n\nLeave a little room between meetings.',['INBOX','UNREAD','CATEGORY_UPDATES']],
      ['alex@example.com','Alex Morgan','The little things','That place you mentioned looks great.','That place you mentioned looks great. Shall we give it a try this weekend?',['INBOX','IMPORTANT','CATEGORY_PERSONAL']],
      ['studio@example.com','Studio Notes','Friday inspiration','A collection of things worth keeping.','A collection of things worth keeping.\n\nSome good ideas start with a small note.',['INBOX','CATEGORY_PROMOTIONS']],
      ['sam@example.com','Sam Taylor','Re: Weekend plans','Sounds like a plan. See you there!','Sounds like a plan. See you there!',['INBOX','STARRED','CATEGORY_PERSONAL']],
      ['updates@example.com','The team','Everything is ready','One less thing on your list.','Everything is ready for the next step.',['INBOX','CATEGORY_UPDATES']]
    ];
    emails = samples.map((s,i) => ({id:'mail'+i,account:'you@example.com',from:`${s[1]} <${s[0]}>`,subject:s[2],snippet:s[3],body:s[4],labels:s[5],date:String(Date.now()-i*37*60000)}));
    notes = [
      {id:'n1',title:'A few things for today',text:'Leave room for the good work.\nFinish the outline\nSend Maya the first draft\nTake a proper lunch break',pinned:true,source:'local'},
      {id:'n2',title:'An idea worth keeping',text:'What if the things you need were simply there, without another tab to open?',pinned:false,source:'local'},
      {id:'n3',title:'For the weekend',text:'Coffee. A long walk.\nSomething with no notifications.',pinned:false,source:'local'}
    ];
    labels = {'you@example.com|Label_1':'Project'};
    status = {accounts:['you@example.com'],admin:false,keepConfigured:false};
  }

  function renderAccounts() {
    const accounts = status.accounts || [];
    $('accounts').innerHTML = accounts.length ? (accounts.length > 1 ? `<button class="account-chip ${account==='all'?'selected':''}" data-account="all">All accounts</button>` : '') + accounts.map((email,i) => `<button class="account-chip ${account===email||accounts.length===1?'selected':''}" data-account="${esc(email)}" title="${esc(email)}"><i class="dot" style="--account-color:${colors[i%colors.length]}"></i>${esc(email)}</button>`).join('') : '<button class="account-chip" data-action="settings">+ Connect Google</button>';
    $('connection').textContent = demo ? 'Sample data' : accounts.length ? 'Connected' : session || pairedKey() ? 'Ready' : 'Not connected';
    $('connection').classList.toggle('live',!!accounts.length && !demo);
  }
  function eventsForDay(date) {
    const end = addDays(date,1); end.setHours(0,0,0,0);
    const begin = new Date(date); begin.setHours(0,0,0,0);
    return events.filter(e=>eventStart(e)<end && eventEnd(e)>begin).sort((a,b)=>+eventStart(a)-+eventStart(b));
  }
  function renderCalendar() {
    document.querySelectorAll('[data-view]').forEach(button=>button.classList.toggle('active',button.dataset.view===view));
    $('calendar-range').textContent = view==='month' ? day.toLocaleDateString([], {month:'long',year:'numeric'}) : view==='week' ? `${day.toLocaleDateString([], {month:'short',day:'numeric'})} – ${addDays(day,6).toLocaleDateString([], {month:'short',day:'numeric'})}` : longDate(day);
    if (waitingForHelper()) { $('calendar-content').innerHTML = empty('…','Reconnecting automatically','Waiting for Google Desk to start. Your saved account connection will be restored.'); return; }
    if (!status.accounts.length) { $('calendar-content').innerHTML = empty('▦','A little clarity for your day','Connect Google to see your schedule and meeting reminders.',['settings','Connect Google']); return; }
    if (view==='month') {
      const first = new Date(day.getFullYear(),day.getMonth(),1);
      const start = addDays(first,-((first.getDay()+6)%7));
      let html = '<div class="month-grid">' + ['M','T','W','T','F','S','S'].map(x=>`<span class="month-weekday">${x}</span>`).join('');
      for(let i=0;i<42;i++) {
        const date=addDays(start,i), entries=eventsForDay(date);
        html+=`<button class="month-day ${date.getMonth()!==day.getMonth()?'outside':''} ${sameDay(date,new Date())?'today':''}" data-day="${dateKey(date)}" aria-label="${esc(longDate(date))}, ${entries.length} events">${date.getDate()}<span class="month-dots">${entries.slice(0,3).map(e=>`<i style="background:${safeColor(e.color)}"></i>`).join('')}</span></button>`;
      }
      $('calendar-content').innerHTML=html+'</div>';
    } else {
      const days = Array.from({length:view==='week'?7:1},(_,i)=>addDays(day,i));
      $('calendar-content').innerHTML = days.map(date=>{
        const entries=eventsForDay(date);
        return `<div class="schedule-day"><div class="schedule-label">${esc(sameDay(date,new Date())?'TODAY':date.toLocaleDateString([], {weekday:'short',month:'short',day:'numeric'}).toUpperCase())}</div>${entries.length ? entries.map(e=>`<button class="event" data-event="${esc(e.id)}" data-event-account="${esc(e.account)}"><span class="event-time">${e.start.date?'All day':esc(timeLabel(eventStart(e)))}</span><span class="event-card" style="--event-color:${safeColor(e.color)}"><strong>${esc(e.title)}</strong><small>${esc(e.calendar)}${e.start.date?'':` · ${esc(timeLabel(eventStart(e)))} – ${esc(timeLabel(eventEnd(e)))}`}${e.link?' · Meet ↗':''}</small></span></button>`).join('') : '<p class="subtle">Nothing scheduled. A little breathing room.</p>'}</div>`;
      }).join('');
    }
    const calendars = [...new Map(events.map(e=>[e.calendarId+'|'+e.account,e])).values()];
    $('calendar-legend').innerHTML = calendars.length ? calendars.map(e=>`<span><i class="status-dot" style="background:${safeColor(e.color)}"></i> ${esc(e.calendar)}</span>`).join(' ') : 'All connected calendars · Shared calendars included';
  }
  function safeColor(color) { return /^#[0-9a-f]{6}$/i.test(color||'') ? color : '#a9e8cb'; }
  function renderMeeting() {
    if (waitingForHelper()) { $('meeting').innerHTML='<div class="meeting-copy"><span class="meeting-label">GOOGLE DESK</span><strong>Restoring your saved connection…</strong><small>No pairing or sign-in is needed for a routine restart.</small></div>'; return; }
    const now=new Date();
    const future=events.filter(e=>!e.start.date && eventStart(e)>now && (e.link || !/holiday|birthday/i.test(e.calendar))).sort((a,b)=>+eventStart(a)-+eventStart(b));
    const next=future[0];
    const lead=Number(property('reminderMinutes') ?? preferences.lead);
    const due=lead>0 && next && +eventStart(next)-now<=lead*60000;
    const key=next?next.account+next.id+eventStart(next).toISOString():'';
    reminderKey=key;
    $('meeting').classList.toggle('is-due',!!due && reminderDismissed!==key);
    $('meeting').innerHTML=next ? `<span class="meeting-time">${esc(timeLabel(eventStart(next)))}</span><div class="meeting-copy"><span class="meeting-label">${due && reminderDismissed!==key?'MEETING REMINDER':'NEXT ON YOUR CALENDAR'}</span><strong>${esc(next.title)}</strong><small>${esc(sameDay(eventStart(next),now)?'Today':longDate(eventStart(next)))} · ${esc(next.calendar)}</small></div>${due && reminderDismissed!==key?'<button class="quiet-button" data-action="dismiss-reminder">Dismiss</button>':''}${next.link?'<button class="primary-button" data-action="join">Open Meet ↗</button>':''}` : `<div class="meeting-copy"><span class="meeting-label">A LITTLE SPACE TO FOCUS</span><strong>${status.accounts.length?'You’re all clear for now.':'Your day, together in one place.'}</strong><small>${status.accounts.length?'No upcoming events in the loaded calendar range.':'Calendar, inbox and notes. Just a touch away.'}</small></div>`;
    $('meeting').dataset.link=next?.link||'';
  }
  function filteredEmails() {
    return emails.filter(e=>(account==='all'||e.account===account) && (!unread||e.labels.includes('UNREAD')) && (category!=='primary'||e.labels.includes('CATEGORY_PERSONAL')) && (category!=='no-promotions'||!e.labels.includes('CATEGORY_PROMOTIONS')));
  }
  function sender(from) { return from.replace(/\s*<.*>\s*$/,'').replace(/^"|"$/g,'') || from; }
  function setInboxFilterMenu(open, restoreFocus=false) {
    $('inbox-panel').classList.toggle('filter-open',open);
    if(open){
      const panel=$('inbox-panel').getBoundingClientRect(),trigger=$('inbox-filter').getBoundingClientRect();
      $('inbox-filter-menu').querySelector('.inbox-filters').style.maxHeight=Math.min(178,Math.max(0,Math.floor(panel.bottom-trigger.bottom-24)))+'px';
    }
    $('inbox-filter').setAttribute('aria-expanded',String(open));
    $('inbox-filter-menu').classList.toggle('open',open);
    $('inbox-filter-menu').setAttribute('aria-hidden',String(!open));
    $('inbox-filter-menu').inert=!open;
    if(restoreFocus)$('inbox-filter').focus();
  }
  function renderInbox() {
    $('unread').setAttribute('aria-pressed',String(unread));
    const categoryLabel={primary:'Primary',all:'All inbox','no-promotions':'No Promotions'}[category];
    $('inbox-filter-label').textContent=categoryLabel;
    $('inbox-filter').setAttribute('aria-label','Inbox category: '+categoryLabel);
    document.querySelectorAll('[data-inbox-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.inboxFilter===category)));
    const list=demo?filteredEmails():emails;
    $('inbox-count').textContent=list.length;
    if (waitingForHelper()) { $('inbox-content').innerHTML=empty('…','Your inbox will be here shortly','The widget reconnects when the local helper is ready.'); return; }
    if (!status.accounts.length) { $('inbox-content').innerHTML=empty('✉','Your inbox, within reach','Read your email here without leaving what you’re doing.',['settings','Connect Google']); return; }
    $('inbox-content').innerHTML=list.length ? list.map((e,i)=>{
      const name=sender(e.from), initials=name.split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
      const badges=e.labels.filter(l=>l.startsWith('Label_')).map(l=>`<span class="mail-label">${esc(labels[e.account+'|'+l]||'Label')}</span>`).join('');
      return `<button class="email ${e.labels.includes('UNREAD')?'unread':''} ${selectedMail===e.account+e.id?'selected':''}" data-message="${esc(e.id)}" data-message-account="${esc(e.account)}"><span class="avatar" style="--avatar-bg:${['#2e4540','#3d3b50','#4a412e','#2b4050'][i%4]};--avatar-fg:${colors[i%4]}">${esc(initials)}</span><span class="email-copy"><span class="email-first"><span class="email-sender">${esc(name)}</span><span class="email-time">${esc(timeLabel(new Date(Number(e.date))))}</span></span><span class="email-subject">${esc(e.subject)}</span><span class="email-markers">${e.labels.includes('UNREAD')?'<i class="unread-dot" title="Unread"></i>':''}${e.labels.includes('STARRED')?'<span class="marker-star" title="Starred">★</span>':''}${e.labels.includes('IMPORTANT')?'<span class="marker-star" title="Important">››</span>':''}${badges}</span></span></button>`;
    }).join('') : empty('✓','All caught up','No messages match this inbox filter.');
  }
  async function readMessage(id,email) {
    const request=++messageGeneration;
    selectedMail=email+id; renderInbox(); setPanel('reader'); $('panels').classList.add('reading');
    $('reader-content').innerHTML=empty('…','Opening your email','Loading a safe text view.');
    try {
      const mail=demo?emails.find(e=>e.id===id):await api('message?'+new URLSearchParams({id,account:email}));
      if(request!==messageGeneration)return;
      $('reader-content').innerHTML=`<h2 class="reader-subject">${esc(mail.subject)}</h2><div class="reader-meta"><div class="reader-from">${esc(mail.from)}</div><div>${esc(new Date(Number(mail.date)).toLocaleString())}</div><div>${esc(mail.account)}</div></div><p class="message-body">${esc(mail.body)}</p><button class="quiet-button reader-open" data-gmail-id="${esc(id)}" data-gmail-account="${esc(email)}">Open in Gmail ↗</button>`;
    }catch(error){if(request===messageGeneration)$('reader-content').innerHTML=empty('!','Couldn’t load this email',readableError(error));}
  }
  function renderNotes() {
    document.querySelectorAll('[data-source]').forEach(b=>b.classList.toggle('active',b.dataset.source===source));
    $('notes-footer').textContent=demo?'Sample notes · Changes last for this preview':source==='keep'?'Google Keep · Experimental sync':'Local notes · Encrypted on this PC';
    if(source==='keep'&&!demo&&!status.keepConfigured){$('notes-content').innerHTML=empty('✎','Bring your Keep notes closer','The optional Keep adapter supports text notes and checklist edits. It needs a separate connection.',['settings','Keep connection options']);return;}
    $('notes-content').innerHTML=notes.length?notes.slice().sort((a,b)=>Number(b.pinned)-Number(a.pinned)).map(n=>`<button class="note-card" data-note="${esc(n.id)}"><strong>${esc(n.title||'Untitled')}</strong><p>${esc(n.isList?n.items.map(x=>(x.checked?'☑ ':'☐ ')+x.text).join('\n'):n.text)}</p><span class="note-meta">${n.pinned?'⌁ PINNED · ':''}${source==='keep'?'GOOGLE KEEP':'LOCAL NOTE'}</span></button>`).join(''):empty('✎','A place for your next idea','Create a note, make a plan, keep a thought.',['new-note','Write a note']);
  }
  function openNote(note) {
    if(source==='keep'&&!demo&&!status.keepConfigured){openSettings();return;}
    currentNote=note?structuredClone(note):{title:'',text:'',source,pinned:false};
    dirty=false;
    noteField=$('note-text');$('touch-keyboard').hidden=true;$('toggle-keyboard').setAttribute('aria-expanded','false');
    $('note-origin').textContent=demo?'SAMPLE NOTE':source==='keep'?'GOOGLE KEEP · EXPERIMENTAL':'LOCAL NOTE · ENCRYPTED ON THIS PC';
    $('note-title').value=currentNote.title;
    $('note-text').value=currentNote.text;
    $('note-pinned').checked=!!currentNote.pinned;
    $('note-text').hidden=!!currentNote.isList;
    $('note-items').hidden=!currentNote.isList;
    $('note-items').innerHTML=currentNote.isList?currentNote.items.map((item,i)=>`<label><input type="checkbox" data-item-check="${i}" ${item.checked?'checked':''} /><input type="text" data-item-text="${i}" value="${esc(item.text)}" aria-label="Checklist item ${i+1}" /></label>`).join(''):'';
    $('save-status').textContent=''; $('note-dialog').showModal(); $('note-title').focus();
  }
  function closeNote() {
    if(dirty){$('save-status').textContent='Save changes, or tap Discard.';if(!$('discard-note')){const b=document.createElement('button');b.type='button';b.id='discard-note';b.textContent='Discard';b.className='quiet-button';b.onclick=()=>{dirty=false;b.remove();$('note-dialog').close();};$('save-status').append(' ',b);}return;}
    $('note-dialog').close();
  }
  function drawKeyboard() {
    const rows=keyboardSymbols?['1234567890','@#$%&*()-+','.,?!:;/_="']:['qwertyuiop','asdfghjkl','zxcvbnm.,'];
    $('touch-keyboard').innerHTML=rows.map(row=>'<div class="key-row">'+[...row].map(key=>`<button type="button" data-key="${esc(keyboardShift?key.toUpperCase():key)}">${esc(keyboardShift?key.toUpperCase():key)}</button>`).join('')+'</div>').join('')+'<div class="key-row"><button type="button" data-key="SHIFT">Shift</button><button type="button" data-key="SYMBOLS">'+(keyboardSymbols?'ABC':'123')+'</button><button type="button" data-key="SPACE" class="space-key">Space</button><button type="button" data-key="ENTER">Enter</button><button type="button" data-key="BACKSPACE">⌫</button></div>';
  }
  function typeKey(key) {
    if(key==='SHIFT'){keyboardShift=!keyboardShift;drawKeyboard();return;}
    if(key==='SYMBOLS'){keyboardSymbols=!keyboardSymbols;drawKeyboard();return;}
    const field=noteField||$('note-text');if(field.hidden)return;
    let start=field.selectionStart??field.value.length,end=field.selectionEnd??field.value.length;
    if(key==='BACKSPACE'&&start===end)start=Math.max(0,start-1);
    const value=key==='BACKSPACE'?'':key==='SPACE'?' ':key==='ENTER'?(field.tagName==='TEXTAREA'?'\n':' '):key;
    field.setRangeText(value,start,end,'end');field.focus();dirty=true;$('save-status').textContent='Unsaved changes';
  }
  async function saveNote(event) {
    event.preventDefault();
    if(!currentNote)return;
    const data={...currentNote,title:$('note-title').value,text:$('note-text').value,pinned:$('note-pinned').checked,source};
    if(data.isList)data.items=data.items.map((item,i)=>({...item,checked:document.querySelector(`[data-item-check="${i}"]`).checked,text:document.querySelector(`[data-item-text="${i}"]`).value}));
    $('save-note').disabled=true; $('save-status').textContent='Saving…';
    try{
      const saved=demo?{...data,id:data.id||'demo-'+Date.now()}:await api('notes',data);
      notes=notes.filter(n=>n.id!==saved.id).concat(saved);dirty=false;$('note-dialog').close();renderNotes();notice('');
    }catch(error){$('save-status').textContent=readableError(error);}finally{$('save-note').disabled=false;}
  }

  function renderAll() {renderAccounts();renderCalendar();renderMeeting();renderInbox();renderNotes();}
  async function refresh() {
    if(demo){renderAll();return;}
    if(!session&&!pairedKey())return;
    if(busy)return;
    const request=generation;
    lastRefresh=Date.now();
    busy=true; $('refresh').disabled=true;
    try{
      status=await api('status');statusLoaded=true;helperOnline=true;connectionFailures=0;renderAccounts();
      if(account!=='all'&&!status.accounts.includes(account))account='all';
      const start=new Date(day.getFullYear(),day.getMonth(),1);start.setDate(start.getDate()-7);
      const end=new Date(day.getFullYear(),day.getMonth()+1,8);
      const query=new URLSearchParams({account,start:start.toISOString(),end:end.toISOString()});
      const mailQuery=new URLSearchParams({account,filter:category,unread:String(unread)});
      const nowStart=new Date();nowStart.setHours(0,0,0,0);
      const upcomingQuery=new URLSearchParams({account,start:nowStart.toISOString(),end:addDays(nowStart,8).toISOString()});
      const scheduleTask=status.accounts.length?Promise.all([api('events?'+query),api('events?'+upcomingQuery)]).then(([visible,upcoming])=>({items:[...new Map([...visible.items,...upcoming.items].map(e=>[e.account+'|'+e.calendarId+'|'+e.id,e])).values()],errors:[...visible.errors,...upcoming.errors]})):Promise.resolve({items:[],errors:[]});
      const tasks=[scheduleTask,status.accounts.length?api('inbox?'+mailQuery):Promise.resolve({items:[],errors:[]}),source==='keep'&&!status.keepConfigured?Promise.resolve({items:[]}):api('notes?source='+source)];
      const results=await Promise.allSettled(tasks);
      if(request!==generation)return;
      const warnings=[];
      results.forEach((result,index)=>{
        if(result.status==='fulfilled'){
          const failed=new Set((result.value.errors||[]).map(x=>x.account));
          if(index===0)events=result.value.items.concat(events.filter(x=>failed.has(x.account)));
          if(index===1)emails=result.value.items.concat(emails.filter(x=>failed.has(x.account)));
          if(index===2)notes=result.value.items;
          (result.value.errors||[]).forEach(x=>warnings.push(x.message));
        }else warnings.push(readableError(result.reason));
      });
      const labelAccounts=account==='all'?status.accounts:[account];
      const labelResults=await Promise.allSettled(labelAccounts.map(a=>api('labels?account='+encodeURIComponent(a))));
      if(request!==generation)return;
      labels={};labelResults.forEach((r,i)=>{if(r.status==='fulfilled')r.value.items.forEach(l=>labels[labelAccounts[i]+'|'+l.id]=l.name);});
      lastRefresh=Date.now();notice([...new Set(warnings)].join(' '));renderAll();
      $('sync-status').textContent=warnings.length?'Some data unavailable · Last loaded items remain visible':'Updated '+timeLabel(new Date())+' · Refreshes every '+(property('refreshSeconds')||preferences.refresh)+'s';
    }catch(error){helperOnline=false;connectionFailures++;notice(readableError(error));$('connection').textContent='Reconnecting…';$('sync-status').textContent='Waiting for the local helper · Retrying automatically';}
    finally{busy=false;$('refresh').disabled=false;if(request!==generation)refresh();}
  }
  function invalidate() {generation++;refresh();}
  function setPanel(name) {
    setInboxFilterMenu(false);
    $('panels').dataset.active=name;
    document.querySelectorAll('[data-panel]').forEach(b=>b.classList.toggle('active',b.dataset.panel===name));
    if(name!=='reader')$('panels').classList.remove('reading');
  }

  function settingsContent() {
    const admin=status.admin&&!demo;
    return `<div class="settings-section"><h3>${demo?'You’re exploring a preview':status.accounts.length?'Your Google accounts':'Connect your Google account'}</h3>${demo?'<p>These are sample emails, events and notes. Exit preview to connect your real account.</p>':admin?`<p>Import a Google OAuth client JSON for a <strong>Desktop app</strong>. Enable Gmail API and Google Calendar API in the same Cloud project. Your Google password is entered only on Google’s website.</p><input id="client-file" type="file" accept=".json,application/json" aria-label="Import Google Desktop OAuth JSON" /><p id="client-status">${status.clientConfigured?'OAuth client is configured.':'No OAuth client configured yet.'}</p><button class="primary-button" id="connect-google">${status.accounts.length?'Add Google account':'Connect Google'}</button>${status.accounts.map(a=>`<div class="settings-account"><span>${esc(a)}</span><button data-disconnect="${esc(a)}">Disconnect locally</button></div>`).join('')}<p><button class="quiet-button" data-link="https://console.cloud.google.com/">Open Google Cloud Console ↗</button></p>`:`<p>Start <strong>Google Desk.exe</strong> to open the companion setup. Enter its pairing key below or in iCUE widget settings.</p><input id="pair-key" class="pairing-input" type="password" autocomplete="off" placeholder="Companion pairing key" aria-label="Companion pairing key" /><button class="primary-button" id="pair-connect">Connect panel</button>${session||pairedKey()?'<button class="quiet-button" id="open-setup">Open companion settings ↗</button>':''}`}</div>
    ${admin?`<div class="settings-section"><h3>Connect the iCUE widget</h3><p>Paste this local pairing key into Google Desk’s <strong>Companion pairing key</strong> setting in iCUE. It allows the widget to read your inbox and edit notes. Keep it private.</p><div class="pairing-output">${esc(status.widgetKey)}</div><p>Keep this companion running while using the panel.</p></div>`:''}
    <div class="settings-section"><h3>Google Keep</h3><p>${status.keepConfigured?'Experimental adapter configured for '+esc(status.keepEmail)+'.':'Personal Keep does not offer a supported full editing API. An optional unofficial adapter supports reading, creating and editing text notes, pinning, and editing existing checklist items.'}</p><p>Run <strong>Connect Keep.cmd</strong> from the downloaded folder. It installs the optional library in a local virtual environment and asks for an existing Keep master token with hidden input. This token has broad account access and is stored with Windows encryption. No password or token should be pasted into this chat.</p><p>Images, drawings, audio, reminders and new checklist items are outside this first version. The unofficial connection can break when Google changes Keep.</p><button class="quiet-button" data-link="https://gkeepapi.readthedocs.io/en/latest/#authenticating">Keep authentication documentation ↗</button><button class="quiet-button" data-link="https://keep.google.com/">Open Google Keep ↗</button></div>
    <div class="settings-section"><h3>Appearance & reminders</h3><div class="settings-row"><label for="accent-picker">Accent color</label><input type="color" id="accent-picker" value="${safeColor(preferences.accent)}" /></div><div class="settings-row"><label for="theme-picker">Background</label><select id="theme-picker"><option value="dark" ${preferences.theme==='dark'?'selected':''}>Charcoal</option><option value="midnight" ${preferences.theme==='midnight'?'selected':''}>Midnight</option></select></div><div class="settings-row"><label for="lead-picker">Meeting reminder</label><select id="lead-picker">${[0,5,10,15,30].map(n=>`<option value="${n}" ${preferences.lead===n?'selected':''}>${n===0?'Off':n+' minutes before'}</option>`).join('')}</select></div><div class="settings-row"><label for="refresh-picker">Refresh interval</label><select id="refresh-picker">${[30,60,120,300].map(n=>`<option value="${n}" ${preferences.refresh===n?'selected':''}>${n} seconds</option>`).join('')}</select></div><p>iCUE personalization settings take precedence when running on your XENEON EDGE.</p></div>
    <div class="settings-section"><h3>Panel order</h3>${preferences.order.map((name,i)=>`<div class="order-row"><span>${esc(name[0].toUpperCase()+name.slice(1))}</span><button data-order="${i}" data-direction="-1" aria-label="Move ${name} earlier" ${i===0?'disabled':''}>↑</button><button data-order="${i}" data-direction="1" aria-label="Move ${name} later" ${i===preferences.order.length-1?'disabled':''}>↓</button></div>`).join('')}<p>Smaller slots use panel tabs. The email reader replaces the inbox when space is limited.</p></div>`;
  }
  function openSettings() {
    $('settings-content').innerHTML=settingsContent();
    const pairingSection=$('settings-content').querySelector('.pairing-output')?.closest('.settings-section');
    if(pairingSection){pairingSection.innerHTML='<h3>Automatic iCUE pairing</h3><p>Create a private widget package using this PC’s saved pairing key. Import it into iCUE once. Additional instances connect automatically, including after a restart.</p><button class="primary-button" id="install-paired-widget">Install paired widget</button><p id="paired-widget-status">The package stays on this PC. It contains a local access key, so keep it private.</p>';}
    const appearance=$('accent-picker')?.closest('.settings-section');
    if(appearance){
      const row=document.createElement('div');row.className='settings-row';
      row.innerHTML='<label for="text-size-picker">Text size</label><select id="text-size-picker">'+[100,125,150,175,200].map(n=>`<option value="${n}" ${Number(preferences.textSize)===n?'selected':''}>${n}%${n===150?' (recommended)':''}</option>`).join('')+'</select>';
      appearance.prepend(row);
    }
    if(status.admin&&!demo){
      const connection=document.createElement('div');connection.className='settings-section';
      connection.innerHTML='<h3>Stay connected</h3><p>Your Google connection is saved, and access tokens renew automatically. You do not need to sign in every time Google Desk or Windows restarts.</p><p>If Google asks you to reconnect every seven days, open Google Cloud → Google Auth Platform → Audience and change your personal project from <strong>Testing</strong> to <strong>In production</strong>, then reconnect once. Google can still require sign-in if access is revoked.</p><p>Open <strong>Google Desk.exe</strong> instead of the CMD file. Its tray menu has <strong>Start with Windows</strong> and <strong>Quit Google Desk</strong>. A small local helper keeps running while the widget syncs.</p>';
      $('settings-content').prepend(connection);
      const section=document.createElement('div');section.className='settings-section';
      section.innerHTML='<h3>Import existing Keep notes</h3><p>Export Google Keep using Google Takeout, extract the ZIP, then select the note JSON files. This copies their text and checklists into encrypted local notes. It is a one-time import, not ongoing Keep sync.</p><input id="takeout-files" type="file" accept=".json,application/json" multiple aria-label="Import Google Keep Takeout notes" /><p id="takeout-status"></p><button class="quiet-button" data-link="https://support.google.com/keep/answer/10017039">Google Keep export help ↗</button>';
      if(status.keepConfigured){const disconnect=document.createElement('button');disconnect.className='quiet-button';disconnect.textContent='Disconnect Keep locally';disconnect.onclick=async()=>{try{await api('keep/disconnect',{});status=await api('status');notes=[];renderNotes();openSettings();}catch(error){notice(readableError(error));}};section.append(disconnect);}
      $('settings-content').append(section);
    }
    if(!$('settings-dialog').open)$('settings-dialog').showModal();
  }
  async function importTakeout(files) {
    try{
      if(files.length>500)throw new Error('Select up to 500 note JSON files at a time.');
      const imported=await Promise.all([...files].map(async file=>JSON.parse(await file.text())));
      const result=await api('notes/import',{notes:imported});
      $('takeout-status').textContent=`Imported ${result.imported} notes into Local notes. Existing copies were skipped.`;
      source='local';invalidate();
    }catch(error){$('takeout-status').textContent=readableError(error);}
  }
  async function loadClient(file) {
    if(!file)return;
    try{const data=JSON.parse(await file.text());await api('client',data);status=await api('status');$('client-status').textContent='OAuth client imported. Connect Google when ready.';notice('');}catch(error){$('client-status').textContent=readableError(error);}
  }
  async function connectGoogle() {
    try{const result=await api('auth/start',{});openLink(result.url);$('client-status').textContent='Complete sign-in in your browser, then tap Refresh here.';}catch(error){$('client-status').textContent=readableError(error);}
  }
  function changeDate(direction) {
    if(view==='month')day=new Date(day.getFullYear(),day.getMonth()+direction,1);
    else day=addDays(day,direction*(view==='week'?7:1));
    renderCalendar();invalidate();
  }
  document.addEventListener('click',async event=>{
    if(!event.target.closest('#inbox-filter-control'))setInboxFilterMenu(false);
    const button=event.target.closest('button');if(!button)return;
    const d=button.dataset;
    if(button.id==='inbox-filter'){
      setInboxFilterMenu(button.getAttribute('aria-expanded')!=='true');return;
    }
    if(d.inboxFilter){
      if(!['primary','all','no-promotions'].includes(d.inboxFilter))return;
      setInboxFilterMenu(false,true);
      if(category===d.inboxFilter)return;
      category=d.inboxFilter;emails=demo?emails:[];renderInbox();invalidate();return;
    }
    if(d.key){typeKey(d.key);return;}
    if(d.close){$(d.close).close();return;}
    if(d.panel){setPanel(d.panel);return;}
    if(d.view){view=d.view;renderCalendar();invalidate();return;}
    if(d.day){day=new Date(d.day+'T00:00:00');view='today';renderCalendar();return;}
    if(d.account){account=d.account;events=[];emails=[];labels={};renderAll();invalidate();return;}
    if(d.message){readMessage(d.message,d.messageAccount);return;}
    if(d.event){const item=events.find(e=>e.id===d.event&&e.account===d.eventAccount);if(item?.link)openLink(item.link);return;}
    if(d.gmailId){openLink('https://mail.google.com/mail/u/?authuser='+encodeURIComponent(d.gmailAccount)+'#all/'+encodeURIComponent(d.gmailId));return;}
    if(d.note){openNote(notes.find(n=>n.id===d.note));return;}
    if(d.source){source=d.source;notes=demo?notes:[];renderNotes();invalidate();return;}
    if(d.link){openLink(d.link);return;}
    if(d.order){const i=Number(d.order),j=i+Number(d.direction);[preferences.order[i],preferences.order[j]]=[preferences.order[j],preferences.order[i]];savePreferences();openSettings();return;}
    if(d.disconnect){try{await api('disconnect',{email:d.disconnect});status=await api('status');emails=[];events=[];selectedMail='';$('reader-content').innerHTML=empty('✉','Pick a message','Tap an email to read it here.');renderAll();openSettings();invalidate();}catch(error){notice(readableError(error));}return;}
    if(d.action==='settings')openSettings();
    if(d.action==='new-note')openNote();
    if(d.action==='join')openLink($('meeting').dataset.link);
    if(d.action==='dismiss-reminder'){reminderDismissed=reminderKey;renderMeeting();}
    if(button.id==='connect-google')connectGoogle();
    if(button.id==='install-paired-widget'){
      button.disabled=true;
      try{const result=await api('widget/install',{});$('paired-widget-status').textContent=(result.opened?'iCUE import opened. ':'')+result.message;}catch(error){$('paired-widget-status').textContent=readableError(error);}finally{button.disabled=false;}
    }
    if(button.id==='pair-connect'){session=$('pair-key').value.trim();$('pair-key').value='';$('settings-dialog').close();invalidate();}
    if(button.id==='open-setup'){try{await api('open-setup',{});}catch(error){notice(readableError(error));}}
  });
  $('inbox-filter-control').addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();setInboxFilterMenu(false,true);return;}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    event.preventDefault();setInboxFilterMenu(true);
    const options=[...document.querySelectorAll('[data-inbox-filter]')];
    const current=options.indexOf(document.activeElement);
    const index=event.key==='Home'?0:event.key==='End'?options.length-1:current<0?(event.key==='ArrowUp'?options.length-1:0):(current+(event.key==='ArrowUp'?-1:1)+options.length)%options.length;
    options[index].focus();
  });
  document.addEventListener('focusin',event=>{if(!event.target.closest('#inbox-filter-control'))setInboxFilterMenu(false);});
  window.addEventListener('resize',()=>{if($('inbox-filter').getAttribute('aria-expanded')==='true')setInboxFilterMenu(true);});
  document.addEventListener('change',event=>{
    const input=event.target;
    if(input.id==='client-file')loadClient(input.files[0]);
    if(input.id==='takeout-files')importTakeout(input.files);
    if(input.id==='accent-picker'){preferences.accent=input.value;savePreferences();}
    if(input.id==='theme-picker'){preferences.theme=input.value;savePreferences();}
    if(input.id==='lead-picker'){preferences.lead=Number(input.value);savePreferences();renderMeeting();}
    if(input.id==='refresh-picker'){preferences.refresh=Number(input.value);savePreferences();}
    if(input.id==='text-size-picker'){preferences.textSize=Number(input.value);savePreferences();}
  });
  $('settings').onclick=openSettings;$('reorder').onclick=openSettings;
  $('refresh').onclick=()=>{notice('');invalidate();};
  $('unread').onclick=()=>{unread=!unread;renderInbox();invalidate();};
  $('calendar-today').onclick=()=>{day=new Date();renderCalendar();invalidate();};
  $('prev-date').onclick=()=>changeDate(-1);$('next-date').onclick=()=>changeDate(1);
  $('new-note').onclick=()=>openNote();$('open-keep').onclick=()=>openLink('https://keep.google.com/');
  $('note-close').onclick=closeNote;$('note-dialog').addEventListener('cancel',e=>{if(dirty){e.preventDefault();closeNote();}});
  $('note-form').addEventListener('input',()=>{dirty=true;$('save-status').textContent='Unsaved changes';});
  $('note-form').onsubmit=saveNote;
  $('note-form').addEventListener('focusin',event=>{if(event.target.matches('textarea,input[type=text],#note-title'))noteField=event.target;});
  $('toggle-keyboard').onclick=()=>{const show=$('touch-keyboard').hidden;$('touch-keyboard').hidden=!show;$('toggle-keyboard').setAttribute('aria-expanded',String(show));if(show){drawKeyboard();$('touch-keyboard').scrollIntoView({block:'nearest'});}};
  $('reader-close').onclick=()=>{messageGeneration++;$('panels').classList.remove('reading');setPanel('inbox');};
  $('demo-toggle').onclick=()=>{location.href=location.pathname+'?demo=1';};
  $('leave-demo').onclick=()=>{location.href=location.pathname;};
  function clockTick() {
    const now=new Date();$('clock').textContent=timeLabel(now);$('day-number').textContent=now.getDate();$('weekday').textContent=now.toLocaleDateString([], {weekday:'long'});$('month-year').textContent=now.toLocaleDateString([], {month:'long',year:'numeric'});renderMeeting();
  }
  applyPreferences();
  if(demo){demoData();$('demo-banner').hidden=false;$('demo-toggle').hidden=true;$('sync-status').textContent='Preview mode · Sample data';}
  renderAll();clockTick();
  $('reader-content').innerHTML=empty('✉','A little focus for your inbox','Tap a message to read it here. No extra windows, no lost place.');
  if(demo)readMessage(emails[0].id,emails[0].account);else if(session||pairedKey())refresh();
  setInterval(clockTick,15000);
  setInterval(()=>{const delay=helperOnline?Math.max(30,Number(property('refreshSeconds')||preferences.refresh))*1000:Math.min(30000,2000*Math.pow(2,Math.min(connectionFailures,4)));if(!demo&&Date.now()-lastRefresh>delay)refresh();},2000);
  window.addEventListener('focus',()=>{if(!demo)invalidate();});
})();
