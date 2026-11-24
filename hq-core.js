// Okasan HQ, Joel's phone app (15 Nov 2026). Spec: data/launch/HQ-APP-SPEC.md; data shapes: ui/hq-app/DATA.md.
// Reads five collections once each, live: ops, team, numbers, asks, answers. Writes only answers/<askId>, and only
// on Joel's tap (Yes, No, Reply, Done, a note on his own answer, or Undo before the sync has carried it).
// Nothing here fetches over HTTP; the Launches tab draws through window.LaunchRoom (lr-core.js).
(function () {
  'use strict';
  const TZ = 'Asia/Singapore', MIN = 60000, HOUR = 3600000, DAY = 86400000;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;
  const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private window */ } } };

  // ---- time: Singapore time with the weekday; a year-less label is never turned into a date
  const t = s => { if (!s) return null; s = String(s); if (!/\d{4}/.test(s)) return null;
    if (/^\d{4}-\d\d-\d\d$/.test(s)) s += 'T23:59:00+08:00'; else if (/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?$/.test(s)) s += '+08:00';
    const v = Date.parse(s); return isNaN(v) ? null : v; };
  const partsF = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  function parts(ms) { const o = {}; partsF.formatToParts(new Date(ms)).forEach(p => { o[p.type] = p.value; }); return o; }
  function when(iso, opt) {
    const ms = t(iso); if (ms == null) return '';
    const p = parts(ms); const d = `${p.weekday} ${p.day} ${p.month}`; const hm = `${p.hour}:${p.minute}`;
    if (opt === 'day' || hm === '00:00') return d; if (opt === 'time') return hm;
    return hm === '23:59' ? `${d}, end of day` : `${d}, ${hm}`;
  }
  const dayOrLabel = v => { if (!v) return ''; const s = String(v).trim(); if (/^\d{4}-\d\d-\d\d$/.test(s)) return when(s, 'day'); return t(s) != null ? when(s) : s; };
  function span(ms) {
    ms = Math.abs(ms);
    if (ms < MIN) return 'under a minute';
    if (ms < HOUR) return `${Math.round(ms / MIN)} min`;
    if (ms < 2 * DAY) return `${Math.round(ms / HOUR)} h`;
    return `${Math.round(ms / DAY)} days`;
  }
  const ago = (iso, now) => { const ms = t(iso); return ms == null ? '' : (now - ms < MIN ? 'just now' : `${span(now - ms)} ago`); };
  const until = (iso, now) => { const ms = t(iso); if (ms == null) return ''; const d = ms - now; return Math.abs(d) < MIN ? 'now' : d > 0 ? `in ${span(d)}` : `${span(d)} ago`; };

  // ---- icons (24 px grid, drawn with currentColor)
  const ICONS = {
    today: '<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4M8.5 14.5l2.5 2.5 4.5-4.5"/>',
    approve: '<path d="M3 13l2.5-8h13L21 13v6a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19z"/><path d="M3 13h5l1.5 2.5h5L16 13h5"/>',
    launches: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    team: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.7 3 2.4 3.5 5.2"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    yes: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', no: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    reply: '<path d="M4 5.5h16v11H9l-5 4z"/>', done: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
    link: '<path d="M8 16L16 8M9.5 8H16v6.5"/>', undo: '<path d="M9 7L4.5 11.5 9 16"/><path d="M5 11.5h9.5a5 5 0 0 1 0 10H12"/>',
    alert: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5v.01"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    blocked: '<circle cx="12" cy="12" r="9"/><path d="M7.5 12h9"/>', chev: '<path d="M6.5 9.5L12 15l5.5-5.5"/>', arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/>', send: '<path d="M4 12l16-8-6 16-2.5-6.5z"/>', off: '<path d="M12 3v8"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/>',
    wait: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>', people: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.9-3.8 3.6-5.5 7-5.5s6.1 1.7 7 5.5"/>', plus: '<path d="M12 5v14M5 12h14"/>', key: '<circle cx="8" cy="15" r="3.5"/><path d="M10.5 12.5L19 4M15.5 7.5l2.5 2.5"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>', out: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h9"/>', smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8M9 9.5v.01M15 9.5v.01"/>', fail: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  };
  const ico = n => `<span class="ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ''}</svg></span>`;
  document.querySelectorAll('[data-i]').forEach(el => { el.outerHTML = ico(el.dataset.i); });

  // ---- state
  const S = {
    db: null, user: null, uid: null, canWrite: null, noDb: false, err: null, timedOut: false,
    got: {}, fresh: {}, data: { ops: {}, team: {}, numbers: {}, asks: {}, answers: {} },
    pending: {}, busy: {}, errs: {}, reply: {}, note: {}, drafts: {}, open: {}, tab: 'today', badge: null, lrSet: '',
  };
  const COLS = ['ops', 'team', 'numbers', 'asks', 'answers'];
  const CH = { yes: 'Yes', no: 'No', reply: 'Reply', done: 'Done' };
  const CH_ICON = { yes: 'yes', no: 'no', reply: 'reply', done: 'done' };
  const WKIND = { person: 'Person', session: 'Session', helper: 'Helper', scheduled: 'Runs by itself', valve: 'Valve' };

  // ---- data helpers
  const main = () => S.data.ops._main || {};
  const anyData = () => COLS.some(c => Object.keys(S.data[c]).length);
  const allFresh = () => ['ops', 'asks', 'answers'].every(c => S.fresh[c]);
  function launches() {
    const docs = S.data.ops; const out = [];
    Object.keys(docs).forEach(k => { if (k !== '_main' && docs[k] && docs[k].game && docs[k].game.id) out.push(docs[k].game); });
    if (!out.length && Array.isArray(main().games)) return main().games.slice();
    return out;
  }
  function games() {
    const g = Array.isArray(main().games) && main().games.length ? main().games.slice() : launches();
    return g.filter(x => x && x.id).sort((a, b) => (t(a.at) ?? 9e15) - (t(b.at) ?? 9e15));
  }
  function gameAt(id) {
    if (!id || id === 'all') return -1;
    const g = games().find(x => x.id === id); return g && t(g.at) != null ? t(g.at) : null;
  }
  function gameName(id, fallback) {
    if (!id || id === 'all') return 'Every game';
    const g = games().find(x => x.id === id) || launches().find(x => x.id === id); if (g && g.name) return g.name;
    const n = S.data.numbers[id]; if (n && n.name) return n.name;
    return fallback || String(id).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  const answerOf = id => Object.prototype.hasOwnProperty.call(S.pending, id) ? S.pending[id] : (S.data.answers[id] || null);
  const isLate = (a, now) => a.overdue === true || (t(a.due) != null && t(a.due) < now);
  function bucket(a, now) {
    if (isLate(a, now)) return 'now';
    const d = t(a.due); if (d == null) return 'later';
    if (d - now <= 48 * HOUR) return 'now';
    if (d - now <= 7 * DAY) return 'week';
    return 'later';
  }
  function classify(now) {
    const G = { now: [], week: [], later: [], parked: [], way: [], recent: [] };
    Object.keys(S.data.asks).forEach(id => {
      const src = S.data.asks[id]; if (!src || typeof src !== 'object') return;
      const a = src.id ? src : Object.assign({}, src, { id });   // never write onto a doc
      const ans = answerOf(a.id);
      if (a.status === 'closed') return;
      if (a.status === 'carried' || (ans && ans.carried_at)) { G.recent.push({ a, ans }); return; }
      if (ans) { G.way.push({ a, ans }); return; }
      if (a.parked) { G.parked.push({ a }); return; }
      G[bucket(a, now)].push({ a });
    });
    const order = (x, y) => {
      const ax = gameAt(x.a.game), ay = gameAt(y.a.game);
      if ((ax ?? 9e15) !== (ay ?? 9e15)) return (ax ?? 9e15) - (ay ?? 9e15);
      const dx = t(x.a.due) ?? 9e15, dy = t(y.a.due) ?? 9e15; if (dx !== dy) return dx - dy;
      return (t(y.a.since) || 0) - (t(x.a.since) || 0);
    };
    ['now', 'week', 'later', 'parked'].forEach(k => G[k].sort(order));
    G.way.sort((x, y) => (t(y.ans.at) || 0) - (t(x.ans.at) || 0));
    G.recent.sort((x, y) => (t((y.ans && y.ans.carried_at) || y.a.carried_at) || 0) - (t((x.ans && x.ans.carried_at) || x.a.carried_at) || 0));
    G.recent = G.recent.slice(0, 20);
    return G;
  }
  const upper1 = s => { s = String(s || ''); return s ? s[0].toUpperCase() + s.slice(1) : s; };
  function linkLabel(u) {
    try { const h = new URL(u).hostname.replace(/^www\./, '');
      if (/partner\.steamgames\.com$/.test(h)) return 'Open Steamworks'; if (/steampowered\.com$|steamcommunity\.com$/.test(h)) return 'Open Steam';
      if (/roblox\.com$/.test(h)) return 'Open Roblox'; if (/claude\.ai$/.test(h)) return 'Open in Claude';
      return 'Open ' + h; } catch (e) { return 'Open the link'; }
  }
  const safeUrl = u => /^https:\/\//i.test(String(u || '')) ? String(u) : '';
  // the buttons fit the ask (glance rebuild, 15 Nov 23:00; tools/hq-app.js buttonsFor): a DO ask takes Done, Can't and
  // Reply; a YOUR CALL ask Yes, No and Reply; an ask with options one button per option and Reply; "options": [] Reply only
  const optsOf = a => Array.isArray(a.options) ? a.options.filter(o => typeof o === 'string' && o.trim()) : null;
  function buttonsOf(a) {
    const opts = optsOf(a);
    const derive = () => opts ? [...opts.map(o => 'opt:' + o), 'reply'] : a.kind === 'do' ? ['done', 'no', 'reply'] : ['yes', 'no', 'reply'];
    let out = Array.isArray(a.buttons) && a.buttons.length ? a.buttons.filter(b => CH[b] || (typeof b === 'string' && b.startsWith('opt:') && opts && opts.includes(b.slice(4)))) : derive();
    out = out.filter((b, i, xs) => xs.indexOf(b) === i);
    if (!out.length) out = derive();
    if (!out.includes('reply')) out.push('reply');                     // he can always answer in his own words
    return [...out.filter(b => b !== 'reply'), 'reply'];
  }
  // the label a choice is shown with: "Can't" on a DO ask, the option's own words on an option
  function choiceLabel(a, ans) {
    if (!ans) return '';
    if (ans.choice === 'no' && a && a.kind === 'do') return "Can't";
    if (ans.choice === 'reply' && a && optsOf(a) && optsOf(a).includes(ans.text)) return ans.text;
    return CH[ans.choice] || 'Reply';
  }
  // the short title (data/hq-app/ask-titles.json via the sync); the same fallback as tools/hq-app.js when it is missing
  function titleOf(a) {
    if (a.title && String(a.title).trim()) return String(a.title).trim();
    let s = String(a.text || '').replace(/^\s*Hey Joel,\s*/i, '').split(/,?\s+because\b/i)[0].replace(/\([^)]*\)/g, '').replace(/^\s*please\s+/i, '').trim();
    const w = s.split(/\s+/).filter(Boolean);
    s = w.length > 9 ? w.slice(0, 9).join(' ').replace(/[,;:.]$/, '') + '…' : w.join(' ').replace(/[.]$/, '');
    return upper1(s) || 'An ask';
  }
  const shortTakes = s => { const m = String(s || '').match(/(\d+)\s*(minutes?|mins?|hours?|h)\b/i); return m ? m[1] + (/^h/i.test(m[2]) ? ' h' : ' min') : ''; };
  // every game keeps one colour dot, picked from its id; never red, amber or the state green
  function gdotN(id) { let h = 2166136261; for (const c of String(id || '')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) % 10; }
  const gdot = id => `<i class="gdot gd${gdotN(id)}" aria-hidden="true"></i>`;
  const ymdF = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dayDiff = (ms, now) => Math.round((Date.parse(ymdF.format(new Date(ms))) - Date.parse(ymdF.format(new Date(now)))) / DAY);   // calendar days, Singapore
  // the due chip: "Overdue 1 day", "Due today", "Tue 17 Nov"
  function dueChip(a, now) {
    const d = t(a.due);
    if (isLate(a, now)) { const n = d != null ? Math.max(1, -dayDiff(d, now)) : null; return `<span class="chip bad">${ico('alert')}${n != null ? `Overdue ${n} ${n === 1 ? 'day' : 'days'}` : 'Overdue'}</span>`; }
    if (d == null) return '';
    const dd = dayDiff(d, now);
    return `<span class="chip${dd <= 2 ? ' warn' : ''}">${ico('clock')}${dd === 0 ? 'Due today' : dd === 1 ? 'Due tomorrow' : esc(when(a.due, 'day'))}</span>`;
  }
  const wordsCut = (s, n) => { const w = String(s || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean); return w.length > n ? w.slice(0, n).join(' ').replace(/[,;:.]$/, '') + '…' : w.join(' '); };
  function valveSentence(b) {
    const h = num(b.hours_left_valve);
    if (h != null) {
      if (h <= 0) return 'Valve has 0 working hours before the planned release';
      if (h < 16) return `Valve has ${Math.round(h)} working ${Math.round(h) === 1 ? 'hour' : 'hours'} before the planned release`;
      return `Valve has about ${Math.round(h / 8)} working days (${Math.round(h)} working hours) before the planned release`;
    }
    return b.working_left ? `Valve: ${b.working_left}` : '';
  }

  // ---- the shell: tabs, hash, notices, connection pill
  const TABS = ['today', 'approve', 'chat', 'launches', 'team', 'menu', 'people'];
  function setTab(name, opts) {
    if (!TABS.includes(name)) name = 'today';
    const was = S.tab; S.tab = name;
    TABS.forEach(n => {
      const b = $('t-' + n), v = $('v-' + n); const on = n === name;
      b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; v.hidden = !on;
    });
    if (location.hash.slice(1) !== name) { try { history.replaceState(null, '', '#' + name); } catch (e) { location.hash = name; } }
    store.set('hq-tab', name);
    try { document.documentElement.dataset.tab = name; window.dispatchEvent(new CustomEvent('room:tab', { detail: { tab: name, was } })); } catch (e) { /* ignore */ }
    if (name === 'launches') guard('Launches', drawLaunches);
    if (was !== name && !(opts && opts.keepScroll)) window.scrollTo(0, 0);
  }
  document.addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) { setTab(b.dataset.tab); renderNow(); } });   // a tab switch always draws the newest data
  document.querySelector('.tabs').addEventListener('keydown', e => {
    const i = TABS.indexOf(S.tab); let j = -1;
    if (e.key === 'ArrowRight') j = (i + 1) % TABS.length; else if (e.key === 'ArrowLeft') j = (i + TABS.length - 1) % TABS.length;
    else if (e.key === 'Home') j = 0; else if (e.key === 'End') j = TABS.length - 1;
    if (j < 0) return; e.preventDefault(); setTab(TABS[j]); $('t-' + TABS[j]).focus();
  });
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (TABS.includes(h) && h !== S.tab) setTab(h); });

  function conn() {
    const el = $('conn'), tx = $('connText'); let cls = 'wait', word = 'Reading';
    if (S.noDb) { cls = 'bad'; word = 'No data here'; }
    else if (S.err) { cls = 'bad'; word = 'Stopped'; }
    else if (allFresh()) { cls = 'live'; word = 'Live'; }
    else if (S.timedOut) { cls = 'bad'; word = anyData() ? 'Saved copy' : 'Not answering'; }
    else if (anyData()) { cls = 'wait'; word = 'Saved copy'; }
    el.className = 'conn ' + cls; if (tx.textContent !== word) tx.textContent = word;
  }
  function notice() {
    const n = $('notice'); let h = '';
    if (S.noDb) h = `<div class="banner bad">${ico('alert')}<p><b>The room cannot reach its data.</b> Check the connection, then close the page and open it again.</p></div>`;
    else if (S.err) h = `<div class="banner bad">${ico('alert')}<p><b>The room stopped answering</b> (${esc(S.err)}). What is on screen is the last thing it sent. Close the page and open it again to reconnect.</p></div>`;
    else if (S.timedOut && !allFresh()) h = anyData()
      ? `<div class="banner warn">${ico('clock')}<p><b>This may be out of date.</b> The room has not confirmed it in 10 seconds. The page keeps listening and updates by itself; there is nothing to press.</p></div>`
      : `<div class="banner warn">${ico('clock')}<p><b>The room has not answered in 10 seconds.</b> The page keeps listening and fills in by itself when it does; there is nothing to press.</p></div>`;
    if (S.bug) h += `<div class="banner bad">${ico('alert')}<p><b>Part of this page could not be drawn.</b> This is a fault in the page, not in your data. Tell Miso these words: “${esc(S.bug)}”.</p></div>`;
    if (S.canWrite === false) h += `<div class="banner info">${ico('alert')}<p>Only Joel and Nicol answer asks. You can read them.</p></div>`;
    n.innerHTML = h; n.hidden = !h;
  }
  const waitingFirst = () => !S.noDb && !S.err && !S.timedOut && !anyData() && !COLS.some(c => S.got[c]);
  const skel = n => `<div class="skel" aria-label="Reading"><i></i>${n > 1 ? '<i></i>' : ''}${n > 2 ? '<i></i>' : ''}</div>`;
  function emptyBox(title, line, icon) {
    return `<div class="panel empty"><span class="glyph">${ico(icon || 'clock')}</span><h3>${esc(title)}</h3><p>${line}</p></div>`;
  }
  const FIRST_SYNC = 'The studio PC sends everything here every 5 minutes.';
  function noDataBox() {
    if (S.noDb) return emptyBox('No data in this view', 'The room cannot reach its data. Check the connection and open it again.', 'alert');
    if (S.timedOut && !anyData()) return emptyBox('Waiting for the room', 'Nothing has arrived yet. The page fills in by itself.', 'clock');
    return emptyBox('Nothing has arrived yet', FIRST_SYNC, 'clock');
  }

  // ---- Today
  function blockerHtml(b, now) {
    if (!b || !(b.what || b.state)) return '';
    const st = ['blocking', 'at_risk', 'clear'].includes(b.state) ? b.state : 'at_risk';
    const word = { blocking: 'Blocking', at_risk: 'At risk', clear: 'Clear' }[st];
    const icon = { blocking: 'blocked', at_risk: 'wait', clear: 'done' }[st];
    const due = t(b.must_clear_by), late = b.overdue === true || (due != null && due < now && st !== 'clear');
    const lateH = num(b.overdue_by_hours) != null ? Math.max(1, Math.round(b.overdue_by_hours)) : (due != null ? Math.max(1, Math.round((now - due) / HOUR)) : null);
    const since = b.since_label || dayOrLabel(b.since);
    const meta = st === 'clear' && !b.who ? '' : [b.who ? `Waits on <b>${esc(b.who)}</b>` : 'Nobody named', since ? `since ${esc(since)}` : ''].filter(Boolean).join(' · ');
    const valve = b.valve === true || (b.valve == null && /valve/i.test(String(b.who || '')));
    const dueLine = late
      ? `<span class="bdue">${ico('fail')}<span>Was due ${due != null ? `<b>${esc(when(b.must_clear_by, 'day'))}</b>, ` : ''}${lateH != null ? `${esc(lateH)} h ago` : 'before now'}</span></span>`
      : (due != null && st !== 'clear' ? `<span class="bm">Must clear by <b>${esc(when(b.must_clear_by))}</b>${!valve ? ` · ${esc(until(b.must_clear_by, now))}` : ''}</span>` : '');
    return `<div class="blk ${st}" role="group" aria-label="Main blocker: ${esc(word)}">
      <span class="bh"><span class="bk">Main blocker</span><span class="bs">${ico(icon)}${esc(word)}</span></span>
      <span class="bw">${esc(b.what || 'Nothing is blocking this launch.')}</span>
      ${meta ? `<span class="bm">${meta}</span>` : ''}${dueLine}
      ${valve && !late && st !== 'clear' && valveSentence(b) ? `<span class="bl">${esc(valveSentence(b))}</span>` : ''}
    </div>`;
  }
  const daysTo = (g, now) => num(g.days_to_go) != null ? g.days_to_go : (t(g.at) != null ? Math.max(0, Math.ceil((t(g.at) - now) / DAY)) : null);
  const gState = g => { const s = g.blocker && g.blocker.state; return s === 'blocking' ? 'red' : s === 'at_risk' ? 'amber' : s === 'clear' ? 'green' : 'grey'; };
  // "Mon 16 Nov · 15:30 SGT": always the Singapore hour, whatever zone the store page uses
  const sgtChip = iso => { const ms = t(iso); if (ms == null) return ''; const p = parts(ms); return `${p.weekday} ${p.day} ${p.month} · ${p.hour}:${p.minute} SGT`; };
  function gameCard(g, now) {
    const d = daysTo(g, now), st = gState(g), b = g.blocker || {};
    const s = g.stage || {}; const n = num(s.n), of = num(s.of) || 9;
    const fails = Array.isArray(g.failing) ? g.failing.length : num(g.failing) || (Array.isArray(g.fails) ? g.fails.length : 0);
    const short = g.blocker_short || wordsCut(b.what || s.label || '', 6);
    const by = t(b.must_clear_by) != null && b.state !== 'clear' ? `<span class="chip">${ico('clock')}by ${esc(when(b.must_clear_by, 'day'))}</span>` : '';
    const status = b.state === 'blocking' ? `<span class="chip bad">${ico('blocked')}Blocking · ${esc(short)}</span>${by}`
      : b.state === 'at_risk' ? `<span class="chip warn">${ico('wait')}At risk · ${esc(short)}</span>${by}`
      : b.state === 'clear' ? `<span class="chip good">${ico('yes')}On track</span>` : '';
    const key = 'gd:' + g.id, open = !!S.open[key];
    return `<article class="panel gcard u-${st}" id="g-${esc(g.id)}">
      <div class="ghead">${gdot(g.id)}<h4>${esc(g.name || gameName(g.id))}</h4>
        <div class="dtg"><b class="num">${d == null ? '–' : d === 0 ? '0' : esc(d)}</b><span>${d === 0 ? 'today' : d === 1 ? 'day' : 'days'}</span></div></div>
      <div class="gbody">
        ${t(g.at) != null ? `<span class="chip date">${ico('today')}${esc(sgtChip(g.at))}</span>` : '<span class="chip">No date</span>'}
        ${n != null ? `<div class="stage"><div class="steps" style="--of:${of}" aria-hidden="true">${Array.from({ length: of }, (_, i) => `<i class="${i < n - 1 ? 'd' : i === n - 1 ? 'c' : ''}"></i>`).join('')}</div><span class="st num">Step ${esc(n)} of ${esc(of)}</span></div>` : ''}
        ${status || fails ? `<div class="chips">${status}${fails ? `<span class="chip bad">${ico('fail')}${esc(fails)} failing</span>` : ''}</div>` : ''}
        ${window.RoomBuilds ? window.RoomBuilds.strip(g.id) : ''}
      </div>
      <details class="det" data-fold="${esc(key)}"${open ? ' open' : ''}><summary class="deth">Details${ico('chev')}</summary>
        <div class="detb">${s.label ? `<p class="dl"><b>Step ${esc(n)}:</b> ${esc(s.label)}</p>` : ''}
          ${g.day_label ? `<p class="dl"><b>Store page:</b> ${esc(g.day_label)}</p>` : ''}
          ${blockerHtml(g.blocker, now)}
          <button type="button" class="btn wide" data-open-game="${esc(g.id)}">Open the launch card ${ico('arrow')}</button></div></details>
    </article>`;
  }
  function tile(cls, inner, attrs, label) { return `<button type="button" class="tile ${cls}" ${attrs} aria-label="${esc(label)}">${inner}</button>`; }
  const tick = () => `<span class="tick">${ico('yes')}</span>`;
  function drawToday(now, G) {
    const p = parts(now); $('todayDate').textContent = `${p.weekday} ${p.day} ${p.month}`;
    const el = $('todayBody');
    if (waitingFirst()) { el.innerHTML = skel(3); return; }
    const gs = games();
    if (!gs.length && !Object.keys(S.data.asks).length) { el.innerHTML = noDataBox(); return; }
    const m = main().asks || {};
    const have = Object.keys(S.data.asks).length && !G.failed;
    const count = have ? G.now.length + G.week.length + G.later.length : (num(m.open) || 0);
    const nowN = have ? G.now.length : (num(m.overdue) || 0);
    // blocked first, then by date
    const sorted = gs.slice().sort((a, b) => ((b.blocker && b.blocker.state === 'blocking') - (a.blocker && a.blocker.state === 'blocking')) || ((t(a.at) ?? 9e15) - (t(b.at) ?? 9e15)));
    const blocked = gs.filter(g => g.blocker && g.blocker.state === 'blocking');
    const next = gs.filter(g => t(g.at) != null && t(g.at) >= now - HOUR)[0];
    const nd = next ? daysTo(next, now) : null;
    const tiles = `<div class="tiles">
      ${tile(nowN ? 'u-red' : count ? 'u-amber' : 'u-green', `${count ? `<b class="num">${esc(count)}</b>` : tick()}<span>Needs you</span>`, 'data-goto-tab="approve"', `${count} need you; open Approve`)}
      ${tile(next ? 'u-' + gState(next) : 'u-grey', next ? `<b class="num">${esc(nd)}<small>${nd === 1 ? 'day' : 'days'}</small></b><span>${esc(next.name || gameName(next.id))}</span>` : `${tick()}<span>No launch</span>`, next ? `data-jump="g-${esc(next.id)}"` : 'disabled', next ? `Next launch ${next.name}, ${nd} days` : 'No launch date')}
      ${tile(blocked.length ? 'u-red' : 'u-green', `${blocked.length ? `<b class="num">${esc(blocked.length)}</b>` : tick()}<span>Blocked</span>`, blocked.length ? `data-jump="g-${esc(blocked[0].id)}"` : 'disabled', `${blocked.length} launches blocked`)}
    </div>`;
    const ne = main().next_event;
    const neKey = 'next', neOpen = !!S.open[neKey];
    const strip = ne && ne.label ? `<details class="nextd" data-fold="${neKey}"${neOpen ? ' open' : ''}><summary>${ico('clock')}<span class="nt">${esc(wordsCut(String(ne.label).replace(/[.]$/, ''), 6))}</span>${t(ne.at) != null ? `<span class="chip">${esc(dayDiff(t(ne.at), now) === 0 ? when(ne.at, 'time') : when(ne.at))}</span>` : ''}</summary>
      <div class="detb"><p>${esc(ne.label)}</p><p class="dl">${ne.game ? esc(gameName(ne.game)) + ' · ' : ''}${esc(when(ne.at))}${t(ne.at) != null ? ' · ' + esc(until(ne.at, now)) : ''}</p></div></details>` : '';
    el.innerHTML = `${tiles}${strip}
    <section class="asec u-grey" id="sec-games"><div class="shead"><h3>Launches</h3><span class="cnt num">${esc(gs.length)}</span></div>
      <div class="glist">${gs.length ? sorted.map(g => gameCard(g, now)).join('') : emptyBox('No launch dates yet', 'A game shows here once its date is fixed.', 'launches')}</div></section>`;
  }

  // ---- Approve (glance rebuild, data/hq-app/GLANCE-SPEC.md): Now / This week / Later, one short title per card,
  // the buttons that fit the ask, and everything else in a Details fold
  // a link the phone cannot open (steam://, a chat) is shown as words, never as a dead button
  function pcNote(a, url) {
    let where = a.link_text || '';
    if (!where && a.link && !url) where = /^steam:/i.test(a.link) ? 'in the Steam app on the PC: ' + a.link : 'on the PC';
    return where ? `<p class="pcnote">${ico('off')}<span>This step is done <b>${esc(where)}</b>. It cannot open from the phone.</span></p>` : '';
  }
  // the plain-words check (tools/ask-lint.js): nothing for a clean ask, one quiet line for one that fails
  const lintLine = a => Array.isArray(a.lint) && a.lint.length ? `<p class="lintline">${ico('pen')}<span>Miso is rewriting this ask to be clearer</span></p>` : '';
  const isCall = a => a.kind !== 'do' && !/^DO\b/i.test(a.tag || '');
  const pcOnly = (a, url) => a.pc_only === true || (a.pc_only == null && !url && !!(a.link || a.link_text));
  function askCard(a, now, u) {
    const id = a.id, busy = !!S.busy[id], ro = S.canWrite === false || S.noDb || !S.db;
    const bs = buttonsOf(a); const url = safeUrl(a.link); const opts = optsOf(a) || [];
    const title = titleOf(a), game = a.game_name || gameName(a.game);
    const rOpen = !!S.reply[id];
    const dis = busy || ro ? ' disabled' : '';
    const aria = l => `aria-label="${esc(l)}: ${esc(title)}"`;
    const B = {
      done: cls => `<button type="button" class="btn primary ${cls}" data-act="done" data-id="${esc(id)}" ${aria('Done')}${dis}>${ico('done')}Done<span class="sub">I did it</span></button>`,
      yes: cls => `<button type="button" class="btn primary ${cls}" data-act="yes" data-id="${esc(id)}" ${aria('Yes')}${dis}>${ico('yes')}Yes</button>`,
      no: cls => a.kind === 'do' ? `<button type="button" class="btn ${cls}" data-act="no" data-id="${esc(id)}" ${aria("Can't do it")}${dis}>${ico('no')}Can't</button>`
        : `<button type="button" class="btn no ${cls}" data-act="no" data-id="${esc(id)}" ${aria('No')}${dis}>${ico('no')}No</button>`,
      reply: cls => `<button type="button" class="btn ${cls}" data-act="reply" data-id="${esc(id)}" ${aria('Reply')} aria-expanded="${rOpen}" aria-controls="rp-${esc(id)}"${dis}>${ico('reply')}Reply</button>`,
    };
    const optBtn = b => { const i = opts.indexOf(b.slice(4)); return `<button type="button" class="btn opt" data-act="opt" data-id="${esc(id)}" data-opt="${i}" ${aria(opts[i])}${dis}>${esc(opts[i])}</button>`; };
    let acts;
    const main = bs.filter(b => b !== 'reply');
    if (!main.length) acts = `<div class="acts">${B.reply('wide big')}</div>`;
    else if (a.kind === 'do' && main[0] === 'done' && !opts.length) acts = `<div class="acts">${B.done('wide big')}<div class="acts2">${main.slice(1).map(b => B[b] ? B[b]('small') : '').join('')}${B.reply('small')}</div></div>`;
    else acts = `<div class="acts"><div class="acts1${main.length > 2 ? ' many' : ''}">${main.map(b => b.startsWith('opt:') ? optBtn(b) : B[b] ? B[b]('') : '').join('')}</div><div class="acts2">${B.reply('small')}</div></div>`;
    const takes = shortTakes(a.takes);
    const dk = 'ad:' + id, dOpen = !!S.open[dk];
    return `<article class="panel ask u-${u}" id="ask-${esc(id)}" aria-labelledby="at-${esc(id)}">
      <div class="ahead">${gdot(a.game)}<span class="game">${esc(game)}</span>${dueChip(a, now)}</div>
      <h4 class="atitle" id="at-${esc(id)}">${esc(title)}</h4>
      <div class="chips">${isCall(a) ? `<span class="tag call">${ico('reply')}Your call</span>` : `<span class="tag do">${ico('done')}Do</span>`}${takes ? `<span class="chip">${ico('clock')}${esc(takes)}</span>` : ''}${pcOnly(a, url) ? `<span class="chip pc">${ico('off')}PC only</span>` : ''}</div>
      ${rOpen ? `<div class="reply" id="rp-${esc(id)}"><label for="r-${esc(id)}">Your reply</label>
        <textarea id="r-${esc(id)}" data-draft="${esc(id)}" rows="3" placeholder="Type your answer">${esc(S.drafts[id] || '')}</textarea>
        <div class="row"><button type="button" class="btn" data-act="reply-cancel" data-id="${esc(id)}">Cancel</button>
        <button type="button" class="btn primary" data-act="reply-send" data-id="${esc(id)}"${(S.drafts[id] || '').trim() && !busy ? '' : ' disabled'}>${ico('send')}Send</button></div></div>` : acts}
      ${S.errs[id] ? `<p class="err" role="alert">${esc(S.errs[id])}</p>` : ''}
      <details class="det" data-fold="${esc(dk)}"${dOpen ? ' open' : ''}><summary class="deth">Details${ico('chev')}</summary>
        <div class="detb"><p class="full">${esc(upper1(a.text))}</p>
          ${a.holds || a.takes ? `<dl class="meta">${a.holds ? `<div><dt>Holds up</dt><dd>${esc(a.holds)}</dd></div>` : ''}${a.takes ? `<div><dt>Takes</dt><dd>${esc(a.takes)}</dd></div>` : ''}</dl>` : ''}
          ${url ? `<a class="btn wide link" href="${esc(url)}" target="_blank" rel="noopener noreferrer"><span>${esc(linkLabel(url))}</span>${ico('link')}</a>` : ''}
          ${pcNote(a, url)}${lintLine(a)}${a.since ? `<p class="dl">Asked ${esc(ago(a.since, now))}</p>` : ''}</div></details>
    </article>`;
  }
  const sentAt = (iso, now) => { const ms = t(iso); if (ms == null) return ''; return dayDiff(ms, now) === 0 ? when(iso, 'time') : when(iso, 'day'); };
  // an answered ask: one line (tick, title, "Yes · sent 21:34") with Undo and a note button
  function wayRow(a, ans, now) {
    const id = a.id, busy = !!S.busy[id], other = !!(ans.who && S.uid && ans.who !== S.uid), ro = S.canWrite === false || !S.db || other; const nOpen = !!S.note[id];
    const lab = choiceLabel(a, ans), title = titleOf(a);
    return `<div class="panel aline u-green" id="ask-${esc(id)}">
      <div class="alr">${gdot(a.game)}<span class="atk">${ico('yes')}</span><span class="alt"><b>${esc(title)}</b><span>${other ? esc(upper1(ans.who)) + ' · ' : ''}${esc(lab)} · sent ${esc(sentAt(ans.at, now))}${ans.text && lab !== ans.text ? ' · with words' : ''}</span></span>
        <button type="button" class="btn small icon" data-act="note" data-id="${esc(id)}" aria-label="${ans.text ? 'Change your words' : 'Add a note'}: ${esc(title)}"${busy || ro ? ' disabled' : ''}>${ico('pen')}</button>
        <button type="button" class="btn small" data-act="undo" data-id="${esc(id)}" aria-label="Undo: ${esc(title)}"${busy || ro ? ' disabled' : ''}>${ico('undo')}Undo</button></div>
      ${nOpen ? `<div class="reply"><label for="n-${esc(id)}">${ans.text ? 'Your words' : 'Add a note'}</label>
        <textarea id="n-${esc(id)}" data-draft="n:${esc(id)}" rows="3">${esc(S.drafts['n:' + id] != null ? S.drafts['n:' + id] : (ans.text || ''))}</textarea>
        <div class="row"><button type="button" class="btn" data-act="note-cancel" data-id="${esc(id)}">Cancel</button>
        <button type="button" class="btn primary" data-act="note-save" data-id="${esc(id)}"${busy ? ' disabled' : ''}>Save words</button></div></div>` : ''}
      ${S.errs[id] ? `<p class="err" role="alert">${esc(S.errs[id])}</p>` : ''}
    </div>`;
  }
  function recentRow(a, ans, now) {
    const at = (ans && ans.carried_at) || a.carried_at;
    return `<div class="panel aline done"><div class="alr">${gdot(a.game)}<span class="atk">${ico('done')}</span><span class="alt"><b>${esc(titleOf(a))}</b><span>${ans && ans.who ? esc(upper1(ans.who)) + ' · ' : ''}${ans ? esc(choiceLabel(a, ans)) + ' · ' : ''}delivered${at ? ' ' + esc(sentAt(at, now)) : ''}</span></span></div></div>`;
  }
  function fold(key, title, line, count, inner, openDefault) {
    const open = S.open[key] != null ? S.open[key] : !!openDefault;
    return `<details class="fold" data-fold="${key}"${open ? ' open' : ''}><summary class="foldh"><span class="t"><b>${esc(title)}</b>${line ? `<span>${line}</span>` : ''}</span><span class="c"><span class="num">${esc(count)}</span>${ico('chev')}</span></summary>
      <div class="fbody">${inner}</div></details>`;
  }
  // a game with three or more asks in one section gets its own fold (open in Now and This week, closed in Later)
  function cardsByGame(key, xs, now, u, openDefault) {
    const per = {}; xs.forEach(x => { per[x.a.game] = (per[x.a.game] || 0) + 1; });
    const done = new Set(); let h = '';
    for (const x of xs) {
      const g = x.a.game;
      if (per[g] < 3) { h += askCard(x.a, now, u); continue; }
      if (done.has(g)) continue; done.add(g);
      const k = 'gg:' + key + ':' + g, open = S.open[k] != null ? S.open[k] : openDefault;
      const mine = xs.filter(y => y.a.game === g);
      h += `<details class="ggroup u-${u}" data-fold="${esc(k)}"${open ? ' open' : ''}><summary class="ggh">${gdot(g)}<b>${esc(mine[0].a.game_name || gameName(g))}</b><span class="cnt num">${esc(mine.length)}</span>${ico('chev')}</summary>
        <div class="glist">${mine.map(y => askCard(y.a, now, u)).join('')}</div></details>`;
    }
    return h;
  }
  function drawApprove(now, G) {
    const el = $('approveBody');
    if (waitingFirst()) { el.innerHTML = skel(3); return; }
    if (G.failed) { el.innerHTML = emptyBox('Your asks could not be drawn', 'This is a fault in the page, not a sign that nothing waits on you. Answer in the chat with Miso until it is fixed.', 'alert'); return; }
    const total = Object.keys(S.data.asks).length;
    if (!total) { el.innerHTML = S.noDb ? noDataBox()
      // the asks have not been read yet: never say "nothing waits" before they have
      : !S.got.asks ? (S.timedOut || S.err ? emptyBox('Your asks have not arrived yet', 'The page keeps asking and fills in by itself. Until it does, this is not a sign that nothing waits on you.', 'clock') : skel(3))
      : !Object.keys(S.data.ops).length ? noDataBox()
      : emptyBox('Nothing waits on you', 'When a session needs your word, it shows here.', 'done'); return; }
    const SEC = [['now', 'Now', 'red', true], ['week', 'This week', 'amber', true], ['later', 'Later', 'grey', false]];
    const tiles = `<div class="tiles">${SEC.map(([k, l, u]) => tile(G[k].length ? 'u-' + u : 'u-calm', `${G[k].length ? `<b class="num">${esc(G[k].length)}</b>` : tick()}<span>${l}</span>`, G[k].length ? `data-jump="sec-${k}"` : 'disabled', `${l}: ${G[k].length}`)).join('')}</div>`;
    const open = G.now.length + G.week.length + G.later.length;
    let h = tiles;
    if (!open) h += emptyBox(G.way.length ? 'All answered' : 'Nothing waits on you', G.way.length ? 'Your answers reach the PC in under a minute.' : 'When a session needs your word, it shows here.', 'done');
    for (const [k, l, u, od] of SEC) if (G[k].length) h += `<section class="asec u-${u}" id="sec-${k}" aria-labelledby="gh-${k}"><div class="shead"><h3 id="gh-${k}">${l}</h3><span class="cnt num">${esc(G[k].length)}</span></div>
      <div class="glist">${cardsByGame(k, G[k], now, u, od)}</div></section>`;
    if (G.way.length) h += `<section class="asec u-green" id="sec-sent" aria-labelledby="gh-sent"><div class="shead"><h3 id="gh-sent">Sent</h3><span class="cnt num">${esc(G.way.length)}</span><span class="sline">Undo for 20 seconds</span></div>
      <div class="glist tight">${G.way.map(x => wayRow(x.a, x.ans, now)).join('')}</div></section>`;
    if (G.parked.length) h += fold('parked', 'Parked games', '', G.parked.length, `<div class="glist">${G.parked.map(x => askCard(x.a, now, 'grey')).join('')}</div>`, false);
    if (G.recent.length) h += fold('recent', 'Delivered', '', G.recent.length, `<div class="glist tight">${G.recent.map(x => recentRow(x.a, x.ans, now)).join('')}</div>`, false);
    el.innerHTML = h;
  }
  function badge(G) {
    const n = G.now.length + G.week.length + G.later.length, b = $('badge');
    b.hidden = !n; b.textContent = n > 99 ? '99+' : String(n);
    $('t-approve').setAttribute('aria-label', `Needs you, ${n} open`);
    if (S.badge != null && n !== S.badge && !reduced()) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
    S.badge = n;
  }

  // ---- Team
  const initials = s => String(s || '?').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  // The old worker view: kept as the fallback while team/who has not arrived, so open orders stay reachable.
  function drawTeamOld(now, el, lead) {
    const T = S.data.team._main;
    if (!T) { el.innerHTML = (lead || '') + noDataBox(); return; }
    const W = Array.isArray(T.workers) ? T.workers : [];
    const worker = w => {
      const oo = Array.isArray(w.open_orders) ? w.open_orders : [];
      const seen = t(w.last_seen); const quiet = (seen == null && oo.length) || (seen != null && now - seen > DAY);
      const kind = WKIND[w.kind] || (/helper|builders?$/i.test(w.name || '') ? 'Helper' : 'Session');
      const list = oo.map(o => { const late = o.state === 'late' || (t(o.due) != null && t(o.due) < now);
        return `<li class="${late ? 'late' : ''}"><span class="og">${esc(gameName(o.game))}</span><span class="ow">${esc(o.what)}</span>${o.due ? `<span class="od">${late ? 'Late: was due ' : 'Due '}${esc(when(o.due))}</span>` : ''}</li>`; }).join('');
      const key = 'w:' + (w.name || '');
      return `<article class="panel worker"><div class="wh"><span class="av" aria-hidden="true">${esc(initials(w.name))}</span>
        <span class="wn"><b>${esc(w.name || 'Unnamed')}</b><span>${esc(kind)} · ${seen != null ? 'last report ' + esc(ago(w.last_seen, now)) : 'no report yet'}</span></span>
        ${oo.length ? `<span class="chip${quiet ? ' warn' : ''}">${quiet ? ico('alert') : ''}${esc(oo.length)} open</span>` : '<span class="chip">Nothing open</span>'}</div>
        ${w.line ? `<p class="wl${quiet ? ' quiet' : ''}">${esc(w.line)}</p>` : ''}
        ${oo.length ? `<details class="wmore" data-fold="${esc(key)}"${S.open[key] ? ' open' : ''}><summary class="btn ghost">${ico('chev')}${S.open[key] ? 'Hide' : 'Show'} ${oo.length === 1 ? 'the open order' : 'the ' + oo.length + ' open orders'}</summary><ul class="olist">${list}</ul></details>` : ''}
      </article>`;
    };
    const runs = (Array.isArray(T.schedule) ? T.schedule : []);
    const off = Array.isArray(T.schedule_off) ? T.schedule_off : [];
    const paused = Array.isArray(T.paused) ? T.paused : [];
    const usage = Array.isArray(T.usage) ? T.usage : [];
    el.innerHTML = (lead || '') + `<div class="sec"><div class="sech"><h3>People and sessions</h3><span class="n">${esc(W.length)}</span></div>
        ${W.length ? W.map(worker).join('') : emptyBox('Nobody has reported yet', 'Workers show here once they write to the orders ledger.', 'team')}</div>
      <div class="sec"><div class="sech"><h3>Runs by itself</h3><span class="n">${esc(runs.length)} on · ${esc(off.length)} off</span></div>
        <div class="panel"><ul class="runs">${runs.map(r => `<li><span class="dot" aria-hidden="true"></span><b>${esc(r.label)}${r.every ? ` <span>· ${esc(r.every)}</span>` : ''}</b><span>${esc(r.line || [r.who, r.last_run ? 'last ran ' + when(r.last_run) : ''].filter(Boolean).join(' · '))}</span></li>`).join('')}
        ${off.map(r => `<li class="off"><span class="dot" aria-hidden="true"></span><b>${esc(r.label)} <span>· switched off</span></b><span>${esc(r.line || '')}</span></li>`).join('')}
        ${!runs.length && !off.length ? '<li><span class="dot" aria-hidden="true"></span><b>No scheduled runs listed</b><span>The task list has not been read yet.</span></li>' : ''}</ul></div>
        ${T.schedule_read_at ? `<p class="readat">Task list read ${esc(when(T.schedule_read_at))} (${esc(ago(T.schedule_read_at, now))}).</p>` : ''}</div>
      ${paused.length ? `<div class="sec"><div class="sech"><h3>Paused games</h3><span class="n">${esc(paused.length)}</span></div>
        <div class="panel"><ul class="runs">${paused.map(p => `<li class="off"><span class="dot" aria-hidden="true"></span><b>${esc(gameName(p.game))}</b><span>${esc(p.why || '')}${p.since ? ' Paused since ' + esc(dayOrLabel(p.since)) + '.' : ''}</span></li>`).join('')}</ul></div></div>` : ''}
      ${usage.length ? `<div class="sec"><div class="sech"><h3>Who uses the most</h3><span class="n">read only</span></div>
        <div class="panel"><ul class="runs">${usage.map(u => `<li><span class="dot" aria-hidden="true"></span><b>${esc(u.name || u.label || '')}</b><span>${esc(u.line || (u.share != null ? u.share + '%' : ''))}</span></li>`).join('')}</ul></div></div>` : ''}`;
  }

  // ---- Team: "Who is doing what" (spec data/hq-app/WHO-RUNS-SPEC.md, glance rebuild GLANCE-SPEC.md; data from
  // tools/who-runs.js via team/who + team/who_rows_N). At rest a row is its name, a model chip and one short phrase.
  const MODELS = [['fable', 'Fable 5.2'], ['opus', 'Opus 5.5'], ['sonnet', 'Sonnet 5.5'], ['haiku', 'Haiku 5.5'], ['gpt', 'GPT'], ['none', 'No AI'], ['people', 'People'], ['unknown', 'Model not recorded']];
  const MLABEL = Object.fromEntries(MODELS);
  const MSHORT = { fable: 'Fable', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', gpt: 'GPT', none: 'No AI', people: 'People', unknown: 'Unknown' };
  const STATE_CLS = { working: 'working', ok: 'ok', idle: 'quiet', oneoff: 'quiet', waiting: 'waiting', late: 'late', failing: 'failing', off: 'off', stopped: 'off', paused: 'paused', person: 'person' };
  const SWORD = { working: 'working', ok: 'fine', idle: 'idle', oneoff: 'one-off', waiting: 'waiting', late: 'late', failing: 'failing', off: 'switched off', stopped: 'stopped', paused: 'paused', person: '' };
  if (!S.whoPeriod) S.whoPeriod = store.get('hq-who-period') === 'd7' ? 'd7' : 'd1';
  const mchip = (m, extra) => `<span class="mchip m-${esc(m || 'unknown')}"><i aria-hidden="true"></i>${esc(MLABEL[m] || MLABEL.unknown)}${extra || ''}</span>`;
  const mchipS = m => `<span class="mchip m-${esc(m || 'unknown')}"><i aria-hidden="true"></i>${esc(MSHORT[m] || MSHORT.unknown)}</span>`;
  const sdot = r => { const c = STATE_CLS[r.state] || 'quiet', w = SWORD[r.state] != null ? SWORD[r.state] : String(r.state || '');
    return w ? `<span class="sdot s-${c}"><i aria-hidden="true"></i>${esc(w)}</span>` : ''; };
  // the one short phrase (tools/who-runs.js now_short); the state word stands in for an old build without it
  const nowShort = r => r.now_short || upper1(SWORD[r.state] || '') || '';
  function whoRows(W) {
    const out = []; let missingParts = 0;
    for (let i = 1; i <= (num(W.row_docs) || 0); i++) { const d = S.data.team['who_rows_' + i]; if (d && Array.isArray(d.rows)) out.push(...d.rows); else missingParts++; }
    return { rows: out, missingParts };
  }
  const shortWords = (s, n) => { const w = String(s || '').replace(/\s+/g, ' ').trim().split(' '); const o = w.length > n ? w.slice(0, n).join(' ').replace(/[,;:.]$/, '') + '…' : w.join(' '); return /[.!?…]$/.test(o) ? o : o + '.'; };
  function rowBody(r, now) {
    const L = [];
    if (r.job) L.push(`<p class="wj"><b>Job</b>${esc(r.job)}</p>`);
    if (r.now) L.push(`<p class="wnow"><b>Now</b>${esc(r.now)}</p>`);
    if (r.blocker && r.blocker.what) L.push(`<p class="wsub"><b>Holds the date</b>${esc(shortWords(r.blocker.what, 22))}${r.blocker.who ? ` <span class="who-w">Waits on ${esc(r.blocker.who)}.</span>` : ''}</p>`);
    if (r.why) L.push(`<p class="wsub"><b>Why paused</b>${esc(shortWords(r.why, 22))}</p>`);
    if (r.card_next) L.push(`<p class="wsub"><b>Next on its card</b>${esc(shortWords(r.card_next, 30))}</p>`);
    if (r.shared_in) L.push(`<p class="wsub"><b>Its chat</b>No chat of its own. The work happens in ${esc(r.shared_in)}'s chat.</p>`);
    const facts = [];
    if (r.kind === 'person' || r.kind === 'ledger') { if (t(r.last) != null) facts.push(['Last report', `${when(r.last)} · ${ago(r.last, now)}${r.seen_what ? ' · on ' + r.seen_what : ''}`]); }
    else if (t(r.last) != null) facts.push(['Last active', `${when(r.last)} · ${ago(r.last, now)}`]);
    else facts.push(['Last active', 'Not this week']);
    if (r.started && t(r.started) != null) facts.push(['Started', when(r.started)]);
    if (r.every) facts.push(['Runs', upper1(r.every)]);
    if (r.next && t(r.next) != null && !['off', 'oneoff'].includes(r.state)) facts.push(['Next run', `${when(r.next)} · ${until(r.next, now)}`]);
    if (r.timed && r.timed.off && r.timed.list_read_at) facts.push(['Switched off', `as of ${when(r.timed.list_read_at)}`]);
    if (num(r.runs_d1) != null && r.runs_d1 > 0) facts.push(['Runs today', String(r.runs_d1)]);
    if (num(r.helpers)) facts.push(['Helpers now', String(r.helpers)]);
    facts.push(['Model', (MLABEL[r.model] || MLABEL.unknown) + (r.model_also ? ` · also ${MLABEL[r.model_also.model] || ''} for ${r.model_also.for}` : '')]);
    if (SWORD[r.state]) facts.push(['State', upper1(SWORD[r.state])]);
    L.push(`<dl class="wfacts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`);
    if (r.model_src) L.push(`<p class="wsrc">${/^model not recorded/i.test(r.model_src) ? esc(upper1(r.model_src)) : 'Model read from ' + esc(r.model_src)}.</p>`);
    const oo = Array.isArray(r.orders) ? r.orders : [];
    if (oo.length) L.push(`<div class="word"><b>Jobs on its list · ${esc(oo.length)}</b><ul class="olist">${oo.map(o => `<li class="${o.late ? 'late' : ''}"><span class="og">${esc(o.game)}</span><span class="ow">${esc(o.what)}</span>${o.due ? `<span class="od">${o.late ? 'Late: was due ' : 'Due '}${esc(when(o.due))}</span>` : ''}</li>`).join('')}</ul></div>`);
    if (r.note) L.push(`<p class="wnote"><b>Its last note</b>${esc(shortWords(r.note, 40))}</p>`);
    if (!r.described && r.engine_name) L.push(`<p class="wsrc">The engine calls it “${esc(r.engine_name)}”.</p>`);
    return L.join('');
  }
  function rowPill(r, now) {
    const key = 'wr:' + r.k, open = !!S.open[key];
    const c = STATE_CLS[r.state] || 'quiet';
    const kid = r.kind === 'helper' || r.shared_in || /launch builder$/i.test(r.title || '') && r.group === 'games';
    return `<details class="wr st-${esc(c)}${kid ? ' kid' : ''}" id="wr-${esc(r.k)}" data-fold="${esc(key)}"${open ? ' open' : ''}>
      <summary class="wpill"><span class="wt">${esc(r.title)}</span>${mchipS(r.model)}<span class="wchev">${ico('chev')}</span>
        <span class="wn s-${esc(c)}"><i class="sd" aria-hidden="true"></i>${esc(nowShort(r))}</span></summary>
      <div class="wbody">${rowBody(r, now)}</div></details>`;
  }
  function usageCard(W, byK) {
    const U = W.usage; const p = S.whoPeriod;
    const sw = `<div class="useg" role="group" aria-label="Usage period">${[['d1', '24 h'], ['d7', '7 days']].map(([k, l]) => `<button type="button" class="segb" data-who-period="${k}" aria-pressed="${p === k}">${l}</button>`).join('')}</div>`;
    const head = `<div class="shead"><h3>Who uses the most</h3>${sw}</div>`;
    if (!U || !U[p] || !Array.isArray(U[p].rows) || !U[p].rows.length) return `<section class="asec u-grey">${head}${emptyBox('Usage was not read', 'It fills in at the next build.', 'clock')}</section>`;
    const rows = U[p].rows, max = Math.max(1, ...rows.map(r => r.pct || 0));
    const li = r => `<li${r.rest ? ' class="rest"' : ''}>
        <div class="uh">${r.k && byK[r.k] ? `<button type="button" class="ulink" data-who-jump="${esc(r.k)}">${esc(wordsCut(r.title, 4))}</button>` : `<span class="ut">${esc(wordsCut(r.title, 4))}</span>`}<b class="upct num">${esc(r.pct)}%</b></div>
        <div class="ubar m-${esc(r.model || 'unknown')}" role="img" aria-label="${esc(r.title)}, ${esc(MLABEL[r.model] || MLABEL.unknown)}: ${esc(r.pct)} percent"><i style="width:${Math.max(2, Math.round((r.pct || 0) / max * 100))}%"></i></div></li>`;
    const top = rows.slice(0, 5), rest = rows.slice(5);
    const k = 'use-all', open = !!S.open[k];
    return `<section class="asec u-grey">${head}
      <div class="panel ucard"><ol class="ulist">${top.map(li).join('')}</ol>
      ${rest.length ? `<details class="det" data-fold="${k}"${open ? ' open' : ''}><summary class="deth">Show all ${esc(rows.length)}${ico('chev')}</summary><ol class="ulist">${rest.map(li).join('')}</ol></details>` : ''}
      <p class="ufoot">To change a model, tell Miso.</p></div></section>`;
  }
  function drawTeam(now) {
    const el = $('teamBody');
    if (waitingFirst()) { el.innerHTML = skel(2); return; }
    const W = S.data.team.who;
    if (!W) {
      if (!S.got.team && !S.noDb && !S.timedOut && !S.err) { el.innerHTML = skel(2); return; }
      const lead = S.data.team._main ? emptyBox('The new list has not arrived yet', 'It comes with the next sync. Until then, here is the orders view.', 'clock') : '';
      return drawTeamOld(now, el, lead);
    }
    const { rows, missingParts } = whoRows(W);
    const byK = {}; rows.forEach(r => { byK[r.k] = r; });
    const f = S.whoFilter || null, match = r => !f || r.model === f;
    const built = t(W.built_at), age = built != null ? now - built : null, old = W.engine_off || W.old || (age != null && age > 2 * HOUR);
    const counts = {}; rows.forEach(r => { counts[r.model] = (counts[r.model] || 0) + 1; });
    let h = '';
    // usage first: one big number and a bar, Fable's share as a thin bar under it
    const P = W.plan;
    const wk = P && num(P.week_pct) != null ? Math.max(0, Math.min(100, P.week_pct)) : null, fb = P && num(P.fable_pct) != null ? Math.max(0, Math.min(100, P.fable_pct)) : null;
    const uc = wk == null ? 'u-grey' : wk >= 85 ? 'u-red' : wk >= 65 ? 'u-amber' : 'u-green';
    h += `<div class="panel plan ${uc}">
      ${wk != null ? `<div class="pl1"><b class="big num">${esc(wk)}%</b><span>of the week</span>${P.resets_at ? `<span class="chip">${ico('clock')}Resets ${esc(when(P.resets_at, 'day'))}</span>` : ''}</div>
        <div class="pbar" role="img" aria-label="${esc(wk)} percent of the week used"><i style="width:${wk}%"></i></div>
        ${fb != null ? `<div class="pl2"><span class="m-fable"><i aria-hidden="true"></i>Fable ${esc(fb)}%</span><div class="pbar thin m-fable" role="img" aria-label="Fable ${esc(fb)} percent"><i style="width:${fb}%"></i></div></div>` : ''}`
        : '<p class="dl">The weekly plan figure was not read.</p>'}
      <p class="wbuilt${old ? ' old' : ''}">${old ? ico('clock') + '<b>Old</b> · ' : ''}Built ${esc(sentAt(W.built_at, now) || 'at an unknown time')}${age != null ? ' · ' + esc(ago(W.built_at, now)) : ''}</p>
    </div>`;
    h += `<div class="mscroll"><div class="mchips" role="group" aria-label="Show one model only">${MODELS.filter(([m]) => counts[m]).map(([m]) => `<button type="button" class="mf m-${m}" data-who-filter="${m}" aria-pressed="${f === m}"><i aria-hidden="true"></i>${esc(MSHORT[m])}<b>${esc(counts[m])}</b></button>`).join('')}</div></div>`;
    if (W.engine_off) h += `<div class="banner warn">${ico('alert')}<p><b>The engine on the PC did not answer${W.checked_at ? ' at ' + esc(when(W.checked_at, 'time')) : ''}.</b> This is the last good list, from ${esc(when(W.last_good_at || W.built_at))}.</p></div>`;
    else if (old) h += `<div class="banner warn">${ico('clock')}<p><b>This list is ${esc(span(age))} old.</b> Something stopped the rebuild. Tell Miso.</p></div>`;
    if (missingParts) h += `<div class="banner warn">${ico('clock')}<p><b>Part of the list has not arrived yet.</b> It fills in at the next sync.</p></div>`;
    if (f) h += `<div class="wfnote"><span>${esc(MSHORT[f] || f)} only</span><button type="button" class="btn ghost" data-who-filter="${esc(f)}">Show all</button></div>`;
    if (!rows.some(match)) {
      h += emptyBox(`Nothing runs on ${MSHORT[f] || f} now`, 'Tap the chip again to see everyone.', 'team');
      h += usageCard(W, byK); el.innerHTML = `<div class="wpage">${h}</div>`; return;
    }
    // needs a look: late and failing rows, one tap away
    const trouble = (W.trouble || []).map(k => byK[k]).filter(r => r && match(r));
    if (trouble.length) h += `<section class="asec u-red"><div class="shead"><h3>Needs a look</h3><span class="cnt num">${esc(trouble.length)}</span></div>
      <div class="wtlist">${trouble.map(r => `<button type="button" class="wtb" data-who-jump="${esc(r.k)}"><i class="sd s-${esc(STATE_CLS[r.state] || 'quiet')}" aria-hidden="true"></i><span>${esc(wordsCut(r.title, 4))}</span><span class="wtn">${esc(nowShort(r))}</span></button>`).join('')}</div></section>`;
    // working right now: tiles, two to a row
    const work = rows.filter(r => r.state === 'working' && match(r));
    h += `<section class="asec u-green"><div class="shead"><h3>Working now</h3><span class="cnt num">${esc(work.length)}</span></div>
      ${work.length ? `<div class="wtiles">${work.map(r => `<button type="button" class="panel wtile m-${esc(r.model || 'unknown')}" data-who-jump="${esc(r.k)}" aria-label="${esc(r.title)}, ${esc(MLABEL[r.model] || MLABEL.unknown)}, working">
        <b class="wtt">${esc(r.title)}</b><span class="wtw s-working"><i class="sd" aria-hidden="true"></i>Working</span></button>`).join('')}</div>`
        : emptyBox('Nobody is working right now', 'Nothing used a model in the last hour.', 'clock')}</section>`;
    // the groups as tiles; one opens its list under the grid
    const groups = (W.groups || []).filter(g => g && g.count).map(g => ({ g, xs: rows.filter(r => r.group === g.key && match(r)) })).filter(x => x.xs.length);
    let og = S.whoGroup && groups.some(x => x.g.key === S.whoGroup) ? S.whoGroup : null;
    h += `<section class="asec u-grey" id="sec-groups"><div class="shead"><h3>Everyone</h3><span class="cnt num">${esc(rows.filter(match).length)}</span></div>
      <div class="gtiles">${groups.map(({ g, xs }) => { const wn = xs.filter(r => r.state === 'working').length, tr = xs.filter(r => r.state === 'late' || r.state === 'failing').length;
        return `<button type="button" class="panel gtile g-${esc(g.key)}" data-who-group="${esc(g.key)}" aria-expanded="${og === g.key}" aria-controls="wgl-${esc(g.key)}">
          <span class="gtop"><span class="wgn" aria-hidden="true">${esc(g.n)}</span><b class="gcount num">${esc(xs.length)}</b>${tr ? `<span class="wgbad" aria-label="${esc(tr)} need a look">${ico('alert')}${esc(tr)}</span>` : ''}</span>
          <b class="gname">${esc(g.short || wordsCut(g.title, 3))}</b>${wn ? `<span class="gw s-working"><i class="sd" aria-hidden="true"></i>${esc(wn)} working</span>` : ''}</button>`; }).join('')}</div>
      ${groups.map(({ g, xs }) => `<div class="wgl g-${esc(g.key)}" id="wgl-${esc(g.key)}"${og === g.key ? '' : ' hidden'}><div class="wglh"><span class="wgn" aria-hidden="true">${esc(g.n)}</span><b>${esc(g.title)}</b></div>
        <div class="wgb">${xs.map(r => rowPill(r, now)).join('')}</div></div>`).join('')}</section>`;
    h += usageCard(W, byK);
    el.innerHTML = `<div class="wpage">${h}</div>`;
  }
  function whoJump(k) {
    const W = S.data.team.who; if (!W) return;
    const r = whoRows(W).rows.find(x => x.k === k); if (!r) return;
    if (S.whoFilter && r.model !== S.whoFilter) S.whoFilter = null;
    S.whoGroup = r.group; S.open['wr:' + k] = true; renderNow();
    const el = document.getElementById('wr-' + k);
    if (el) { el.scrollIntoView({ block: 'center' }); const s = el.querySelector('summary'); if (s) s.focus({ preventScroll: true }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400); }
  }
  document.addEventListener('click', e => {
    const fb = e.target.closest('[data-who-filter]');
    if (fb) { const m = fb.dataset.whoFilter; S.whoFilter = S.whoFilter === m ? null : m; renderNow(); const again = document.querySelector(`.mchips [data-who-filter="${CSS.escape(m)}"]`); if (again) again.focus({ preventScroll: true }); return; }
    const pb = e.target.closest('[data-who-period]');
    if (pb) { S.whoPeriod = pb.dataset.whoPeriod === 'd7' ? 'd7' : 'd1'; store.set('hq-who-period', S.whoPeriod); renderNow(); const again = document.querySelector(`[data-who-period="${S.whoPeriod}"]`); if (again) again.focus({ preventScroll: true }); return; }
    const gb = e.target.closest('[data-who-group]');
    if (gb) { const g = gb.dataset.whoGroup; S.whoGroup = S.whoGroup === g ? null : g; renderNow();
      const again = document.querySelector(`[data-who-group="${CSS.escape(g)}"]`); if (again) again.focus({ preventScroll: true });
      const list = S.whoGroup && document.getElementById('wgl-' + S.whoGroup); if (list) list.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' }); return; }
    const jb = e.target.closest('[data-who-jump]');
    if (jb) { whoJump(jb.dataset.whoJump); }
  });

  // ---- Menu: the numbers, big digits with two-word labels; the launch steps and build times folded at the bottom
  function spark(rows) {
    const xs = (rows || []).filter(r => r && num(r.adds) != null).slice(-14); if (xs.length < 2) return '';
    const W = 300, H = 44, P = 3, max = Math.max(1, ...xs.map(r => r.adds));
    const pts = xs.map((r, i) => [P + i * (W - 2 * P) / (xs.length - 1), H - P - (r.adds / max) * (H - 2 * P)]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const last = pts[pts.length - 1];
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Wishlist adds per day, last ${xs.length} days, highest ${max}">
      <line class="gd" x1="0" x2="${W}" y1="${H - P}" y2="${H - P}"/><path class="ar" d="${line} L${last[0].toFixed(1)} ${H - P} L${P} ${H - P} Z"/><path class="ln" d="${line}"/>
      <circle class="pt" cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3"/></svg>
      <div class="sparkl"><span>${esc(when(xs[0].date, 'day'))}</span><span>adds a day</span><span>${esc(when(xs[xs.length - 1].date, 'day'))}</span></div>`;
  }
  const fmt = v => num(v) == null ? '–' : v.toLocaleString('en-GB');
  function numCard(n, now) {
    const d = num(n.adds_7d) != null && num(n.adds_prev_7d) != null ? n.adds_7d - n.adds_prev_7d : null;
    const cr = num(n.creators_reached), ct = num(n.creators_target);
    const cell = (v, l, extra) => `<div class="nc"><b class="num">${fmt(v)}</b><span>${l}</span>${extra || ''}</div>`;
    const wow = d == null ? '' : d === 0 ? `<span class="wow flat">${ico('arrow')}<span class="num">0</span><span class="sr"> change on the week before</span></span>`
      : `<span class="wow ${d > 0 ? 'up' : 'down'}">${ico('chev')}<span class="num">${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}</span><span class="sr"> on the week before</span></span>`;
    return `<article class="panel ncard" id="n-${esc(n.game)}"><div class="nh">${gdot(n.game)}<h4>${esc(n.name || gameName(n.game))}</h4>
      ${n.stale ? `<span class="chip warn">${ico('clock')}Not fresh</span>` : ''}</div>
      <div class="ngrid">${cell(n.wishlists, 'wishlists')}${cell(n.adds_7d, 'adds 7d', wow)}${cell(n.visits_7d, 'visits 7d')}
        ${num(n.units) != null ? cell(n.units, 'sold') : ''}${num(n.from_our_links_14d) != null ? cell(n.from_our_links_14d, 'from links') : ''}${num(n.keys_out) != null ? cell(n.keys_out, 'keys out') : ''}</div>
      ${spark(n.adds_daily)}
      ${cr != null ? `<div class="cr"><div class="t"><span>creators</span><span><b class="num">${fmt(cr)}</b>${ct ? ` / ${fmt(ct)}` : ''}${num(n.creators_replied) != null ? ` · ${fmt(n.creators_replied)} replied` : ''}</span></div>
        ${ct ? `<div class="bar" role="img" aria-label="${fmt(cr)} of ${fmt(ct)} creators reached"><i style="width:${Math.min(100, Math.round(cr / ct * 100))}%"></i></div>` : ''}</div>` : ''}
    </article>`;
  }
  function drawMenu(now) {
    const el = $('menuBody');
    if (waitingFirst()) { el.innerHTML = skel(2); return; }
    const M = main(); const N = Object.keys(S.data.numbers).map(k => S.data.numbers[k]).filter(Boolean);
    if (!Object.keys(S.data.ops).length && !N.length) { el.innerHTML = noDataBox(); return; }
    N.sort((a, b) => (gameAt(a.game) ?? 9e15) - (gameAt(b.game) ?? 9e15) || String(a.name).localeCompare(String(b.name)));
    const steps = M.process && Array.isArray(M.process.steps) ? M.process.steps : [];
    const gates = (Array.isArray(M.gates) ? M.gates : []).filter(g => g && g.state !== 'open');
    el.innerHTML = `<section class="asec u-grey"><div class="shead"><h3>Per game</h3><span class="cnt num">${esc(N.length)}</span></div>
        <div class="glist">${N.length ? N.map(n => numCard(n, now)).join('') : emptyBox('No numbers yet', 'They show here after the next sync.', 'clock')}</div></section>
      ${gates.length ? fold('gates', 'Closed gates', '', gates.length, gates.map(g => `<article class="panel gate"><div class="gh"><span class="chip warn">${ico('blocked')}Closed</span><b>${esc(g.held || 'Held')}</b><span class="chip">${gdot(g.game)}${esc(gameName(g.game))}</span></div>
          ${g.opens ? `<p>Opens when: ${esc(g.opens)}</p>` : ''}${g.who ? `<p>Who: ${esc(g.who)}</p>` : ''}<p>${g.planned_text ? 'Planned: ' + esc(g.planned_text) : t(g.planned) != null ? 'Planned: ' + esc(when(g.planned)) : 'No time planned'}</p></article>`).join(''), false) : ''}
      ${steps.length ? fold('steps', 'How a launch runs', '', steps.length, `<div class="panel"><ol class="steplist">${steps.map((s, i) => `<li><span class="n">${esc(num(s.n) || i + 1)}</span><b>${esc(s.title || '')}</b><span>${esc(s.line || '')}</span></li>`).join('')}</ol></div>`, false) : ''}
      ${fold('built', 'Build and sync', '', sentAt(M.synced_at, now) || '–', `<div class="panel built"><span>Data built <b>${esc(when(M.generated_at) || 'not yet')}</b>${M.generated_at ? ' · ' + esc(ago(M.generated_at, now)) : ''}</span>
        <span>Synced <b>${esc(when(M.synced_at) || 'not yet')}</b>${M.synced_at ? ' · ' + esc(ago(M.synced_at, now)) : ''}</span>
        <span>The sync runs every 15 minutes, 08:00 to midnight Singapore time.</span></div>`, false)}`;
  }

  // ---- Launches: the launch room renderer, fed from the same docs
  let lr = null;
  function opsForLr() {
    const M = main(), docs = S.data.ops, T = S.data.team._main || {};
    const seen = new Set(), orders = [];
    Object.keys(docs).filter(k => k !== '_main').forEach(k => (docs[k] && Array.isArray(docs[k].orders) ? docs[k].orders : []).forEach(o => { if (o && o.id && !seen.has(o.id)) { seen.add(o.id); orders.push(o); } }));
    return { generated_at: M.generated_at, totals: M.totals, next_event: M.next_event, launches: launches(), orders, workers: Array.isArray(T.workers) ? T.workers : [],
      schedule: M.schedule, schedule_off: M.schedule_off, schedule_read_at: M.schedule_read_at, held: M.held, gates: M.gates, process: M.process,
      numbers: Object.keys(S.data.numbers).map(k => S.data.numbers[k]),
      refresh_line: 'Filled by a no-model build; this app receives it at every sync, every 15 minutes from 08:00 to midnight.' };
  }
  function drawLaunches() {
    const el = $('lrBody');
    if (!window.LaunchRoom) { el.innerHTML = emptyBox('The launch room did not load', 'Its drawing code is missing from this page.', 'alert'); return; }
    if (waitingFirst()) { el.innerHTML = skel(3); lr = null; return; }
    if (!launches().length) { el.innerHTML = noDataBox(); lr = null; return; }
    const ops = opsForLr(); const key = JSON.stringify([ops.generated_at, ops.launches.length, Object.keys(S.data.ops).length, ops.orders.length, (S.data.team._main || {}).generated_at, window.RoomBuilds ? window.RoomBuilds.rev : 0]);
    if (!lr) { el.innerHTML = ''; lr = window.LaunchRoom.mount(el, { partner: false, staleAfterMin: 150, sourceNote: '' }); S.lrSet = ''; }
    if (S.lrSet !== key) { lr.set(ops); S.lrSet = key; } else lr.tick();
  }

  // ---- render all, keeping focus and the caret in a text box across redraws
  let raf = 0;
  function guard(what, fn) { try { return fn(); } catch (e) { if (!S.bug) S.bug = what + ': ' + String((e && e.message) || e).slice(0, 160); return undefined; } }
  // a tab that is not in front gets no animation frames: draw on a short timer there, so the page is filled in when he switches to it
  function render() { if (raf) return; raf = 1; let done = false; const run = () => { if (done) return; done = true; raf = 0; renderNow(); }; requestAnimationFrame(run); setTimeout(run, 120); }
  function renderNow() {
    const now = Date.now(); const a = document.activeElement;
    const keep = a && a.id && (a.tagName === 'TEXTAREA' || a.dataset.act) ? { id: a.id, act: a.dataset && a.dataset.act, aid: a.dataset && a.dataset.id, s: a.selectionStart, e: a.selectionEnd } : null;
    // one part that fails must never freeze the rest (15 Nov 2026: one throw left every tab on its loading boxes)
    S.bug = null;
    const G = guard('sorting the asks', () => classify(now)) || { now: [], week: [], later: [], parked: [], way: [], recent: [], failed: true };
    guard('the Approve count', () => badge(G));
    guard('Today', () => drawToday(now, G)); guard('Approve', () => drawApprove(now, G)); guard('Team', () => drawTeam(now)); guard('Menu', () => drawMenu(now));
    if (S.tab === 'launches') guard('Launches', drawLaunches);
    guard('the header', () => { conn(); notice(); });
    if (keep) {
      const el = keep.act ? document.querySelector(`[data-act="${keep.act}"][data-id="${CSS.escape(keep.aid || '')}"]`) : $(keep.id);
      if (el) { el.focus({ preventScroll: true }); if (el.tagName === 'TEXTAREA' && keep.s != null) { try { el.setSelectionRange(keep.s, keep.e); } catch (e) { /* ignore */ } } }
    }
  }

  // ---- toast with Undo
  let toastTimer = 0, toastId = null;
  function toast(text, id) {
    const el = $('toast'); $('toastText').textContent = text; toastId = id || null; $('toastUndo').hidden = !id; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; toastId = null; }, 6000);
  }
  function hideToast(id) { if (!id || id === toastId) { $('toast').hidden = true; toastId = null; clearTimeout(toastTimer); } }
  $('toastUndo').addEventListener('click', () => { const id = toastId; hideToast(); if (id) undo(id); });

  // ---- writes: only answers/<askId>, one write at a time per ask
  async function answer(id, choice, text) {
    const a = S.data.asks[id]; if (!a || S.busy[id] || !S.db) return;
    const doc = { askId: id, choice, text: text == null ? '' : String(text), at: new Date().toISOString(), uid: S.uid || 'owner' };
    S.pending[id] = doc; S.busy[id] = true; delete S.errs[id]; delete S.reply[id]; delete S.drafts[id];
    renderNow();
    const lab = choiceLabel(a, doc);
    toast(`${lab.length > 24 ? 'Reply' : lab} sent · ${a.game_name || gameName(a.game)}`, id);
    try { await S.db.doc('answers/' + id).set(doc); }
    catch (e) { delete S.pending[id]; S.errs[id] = `Your answer was not saved (${(e && e.code) || 'no answer'}). Tap it again.`; hideToast(id); }
    finally { S.busy[id] = false; render(); }
  }
  async function undo(id) {
    const cur = answerOf(id); if (!cur || S.busy[id] || !S.db) return;
    if (cur.carried_at) { S.errs[id] = 'This answer has already reached the PC, so it cannot be undone. Send a reply instead.'; render(); return; }
    S.busy[id] = true; S.pending[id] = null; delete S.errs[id]; renderNow();
    try {
      const snap = await S.db.doc('answers/' + id).get();
      const d = snap && snap.exists ? snap.data() : null;
      if (d && d.carried_at) { delete S.pending[id]; S.errs[id] = 'The sync carried this answer a moment ago, so it cannot be undone. Send a reply instead.'; }
      else if (d) await S.db.doc('answers/' + id).delete();
      toast('Undone. The ask is open again.', null);
    } catch (e) { delete S.pending[id]; S.errs[id] = `Undo did not save (${(e && e.code) || 'no answer'}). Tap Undo again.`; }
    finally { S.busy[id] = false; render(); }
  }
  async function saveNote(id, text) {
    const cur = answerOf(id); if (!cur || S.busy[id] || !S.db) return;
    if (cur.carried_at) { S.errs[id] = 'This answer has already reached the PC. Send a new reply instead.'; render(); return; }
    const next = Object.assign({}, cur, { text: String(text) });
    S.busy[id] = true; S.pending[id] = next; delete S.note[id]; delete S.drafts['n:' + id]; renderNow();
    try { await S.db.doc('answers/' + id).update({ text: String(text) }); toast('Your words are saved.', null); }
    catch (e) { S.pending[id] = cur; S.errs[id] = `Your words were not saved (${(e && e.code) || 'no answer'}).`; }
    finally { S.busy[id] = false; render(); }
  }

  document.addEventListener('click', e => {
    const tg = e.target.closest('[data-goto-tab]'); if (tg) { setTab(tg.dataset.gotoTab); return; }
    // a tile scrolls to its section or card; the section header stays pinned under the top bar
    const jp = e.target.closest('[data-jump]');
    if (jp && !jp.disabled) { const to = document.getElementById(jp.dataset.jump); if (to) { to.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' }); const f = to.querySelector('h3, h4, summary'); if (f) { f.tabIndex = -1; f.focus({ preventScroll: true }); } } return; }
    const og = e.target.closest('[data-open-game]');
    if (og) { setTab('launches'); const id = og.dataset.openGame; setTimeout(() => { if (lr && lr.openCard) lr.openCard(id); const c = document.getElementById('lr-g-' + id); if (c) c.scrollIntoView({ block: 'start' }); }, 30); return; }
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const id = b.dataset.id, act = b.dataset.act;
    if (act === 'yes' || act === 'no' || act === 'done') answer(id, act, '');
    else if (act === 'opt') { const a = S.data.asks[id]; const o = a && optsOf(a); const w = o && o[+b.dataset.opt]; if (w) answer(id, 'reply', w); }   // an option is sent as a reply in exactly its words
    else if (act === 'reply') { S.reply[id] = true; renderNow(); const ta = $('r-' + id); if (ta) ta.focus(); }
    else if (act === 'reply-cancel') { delete S.reply[id]; renderNow(); const r = document.querySelector(`[data-act="reply"][data-id="${CSS.escape(id)}"]`); if (r) r.focus(); }
    else if (act === 'reply-send') { const v = S.drafts[id] || ''; if (v.trim()) answer(id, 'reply', v); }
    else if (act === 'undo') undo(id);
    else if (act === 'note') { S.note[id] = true; renderNow(); const ta = $('n-' + id); if (ta) ta.focus(); }
    else if (act === 'note-cancel') { delete S.note[id]; delete S.drafts['n:' + id]; renderNow(); }
    else if (act === 'note-save') { const v = S.drafts['n:' + id]; saveNote(id, v != null ? v : ((answerOf(id) || {}).text || '')); }
  });
  document.addEventListener('input', e => {
    const k = e.target.dataset && e.target.dataset.draft; if (!k) return;
    S.drafts[k] = e.target.value;
    if (!k.startsWith('n:')) { const s = document.querySelector(`[data-act="reply-send"][data-id="${CSS.escape(k)}"]`); if (s) s.disabled = !e.target.value.trim() || !!S.busy[k]; }
  });
  document.addEventListener('toggle', e => {
    const d = e.target; if (!d.dataset || !d.dataset.fold) return;
    S.open[d.dataset.fold] = d.open;
    if (d.classList.contains('wmore')) { const s = d.querySelector('summary'); if (s) s.innerHTML = s.innerHTML.replace(/>(Show|Hide) /, `>${d.open ? 'Hide' : 'Show'} `); }
  }, true);

  // ---- connect: one subscription per collection, a 10 s timer, never a reload
  function onSnap(col) {
    return snap => {
      // live docs arrive frozen (read-only), unlike the test page's plain objects: the page works on its own copy
      const m = {}; snap.docs.forEach(d => { if (!d.exists) return; const v = d.data(); try { m[d.id] = JSON.parse(JSON.stringify(v)); } catch (e) { m[d.id] = v; } });
      S.data[col] = m; S.got[col] = true; if (!snap.metadata || !snap.metadata.fromCache) S.fresh[col] = true;
      if (col === 'answers') Object.keys(S.pending).forEach(id => {
        const p = S.pending[id], cur = m[id];
        if (p === null ? !cur : (cur && cur.at === p.at && cur.text === p.text)) delete S.pending[id];
      });
      if (allFresh()) S.timedOut = false;
      render();
    };
  }
  async function start() {
    setTab(TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : (store.get('hq-tab') || 'today'), { keepScroll: true });
    renderNow();
    const timer = setTimeout(() => { if (!allFresh()) { S.timedOut = true; render(); } }, 10000);
    let db = null;
    try { db = window.claude && window.claude.use ? await window.claude.use('db') : null; } catch (e) { db = null; }
    if (!db) { clearTimeout(timer); S.noDb = true; renderNow(); return; }
    S.db = db;
    try {
      const user = await window.claude.use('user'); S.user = user;
      if (user) { S.uid = await user.id().catch(() => null); const c = user.can ? await Promise.resolve(user.can('data.write')).catch(() => null) : null; S.canWrite = c === false ? false : c === true ? true : null; }
    } catch (e) { /* the page still reads */ }
    COLS.forEach(col => {
      try { db.collection(col).onSnapshot(onSnap(col), err => { S.err = (err && err.code) || 'unavailable'; clearTimeout(timer); render(); }); }
      catch (e) { S.err = 'invalid_argument'; }
    });
    render();
  }
  setInterval(() => { if (!document.hidden) render(); }, 30000);
  window.HQ = { start, setTab, render, renderNow, toast, S, ico, esc, when, ago, gdot, TABS };
})();
