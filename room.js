// Team room (Miso, 22 Nov 2026): the live layer around the HQ core (hq-core.js).
// - the door: email link or a sign-in code, then "ask to join" for someone who is not a member yet
// - a database stand-in for the core (window.claude.use('db' | 'user')) backed by Supabase: room_docs, room_answers
// - Chat (table messages, reactions), People (members, requests, sign-in codes), and the motion layer
// Only the publishable key is in this page; every table is closed to anyone who is not a signed-in room member.
(function () {
  'use strict';
  const CFG = window.ROOM_CFG || {};
  const HQ = window.HQ; const esc = HQ.esc, ico = HQ.ico;
  const $ = id => document.getElementById(id);
  const OWNERS = CFG.owners || ['joel', 'nicol'];
  const PAGE = 250; // chat messages per load
  const AI = CFG.ai || [['miso', 'COO · publishing'], ['ashra', 'Assistant COO · builds'], ['juno', 'COO · Born Juicy side']];
  const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const Q = new URLSearchParams(location.search);
  const DEMO = LOCAL && Q.has('demo');
  const TZ = 'Asia/Singapore';
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* full or private */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const cap = s => { s = String(s || ''); return s ? s[0].toUpperCase() + s.slice(1) : s; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const buzz = n => { try { if (navigator.vibrate && !reduced()) navigator.vibrate(n || 8); } catch (e) { /* ignore */ } };
  const hash = s => { let h = 2166136261; for (const c of String(s || '')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const debounce = (fn, ms) => { let t = 0; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };

  // ---- brand (one place: config.js)
  const BRAND = CFG.brand || 'Team Room';
  (function brand() {
    document.title = BRAND;
    const w = BRAND.split(' '); const last = w.length > 1 ? w.pop() : '';
    $('brandName').innerHTML = esc(w.join(' ')) + (last ? ` <span>${esc(last)}</span>` : '');
    $('gTitle').textContent = BRAND;
    if (CFG.kicker) $('gKick').textContent = CFG.kicker;
  })();

  // ---- theme: auto, dark, light (per device)
  const THEMES = ['auto', 'dark', 'light'];
  function applyTheme(t) {
    if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    const dark = t === 'dark' || (t !== 'light' && !(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches));
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = dark ? '#07060d' : '#f4f2fb';
  }
  applyTheme(store.get('room-theme') || 'auto');

  // ---- the Supabase client
  let sb = null;
  if (!DEMO) {
    try { sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }); }
    catch (e) { sb = null; }
  }
  const me = { name: null, team: null, role: null, email: null };
  const isOwner = () => me.role === 'owner';
  const isAdmin = () => me.role === 'admin' || me.role === 'owner';
  const roleName = r => (r === 'owner' ? 'Owner' : r === 'admin' ? 'Admin' : 'Member');
  const teamFor = n => (n === 'nicol' ? 'bornjuicy' : me.team || 'okasan'); // Nicol is Born Juicy's owner

  // =====================================================================================================
  // The door
  // =====================================================================================================
  const gate = $('gate'), gCard = $('gCard'), gFoot = $('gFoot');
  const G = { step: 'boot', email: store.get('room-email') || '', msg: '', busy: false, err: '', sent: false, asked: false };
  function gateDraw() {
    let h = '';
    const err = G.err ? `<p class="gerr" role="alert">${ico('alert')}<span>${esc(G.err)}</span></p>` : '';
    if (G.step === 'boot') h = '<div class="gspin" aria-label="Opening the room"><i></i><i></i><i></i></div>';
    else if (G.step === 'down') h = `<h2>The room is not answering</h2><p class="gp">Check your connection.</p><button type="button" class="btn primary wide big" data-g="retry">Try again</button>`;
    else if (G.step === 'email') h = `<h2>Sign in</h2>
      <label class="glab" for="gEmail">Your email</label>
      <input id="gEmail" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="you@example.com" value="${esc(G.email)}">
      ${err}
      <button type="button" class="btn primary wide big" data-g="link"${G.busy ? ' disabled' : ''}>${ico('send')}Email me a link</button>
      <button type="button" class="btn wide" data-g="havecode"${G.busy ? ' disabled' : ''}>${ico('key')}I have a code</button>
      <button type="button" class="btn wide ghost" data-g="want">New here? Ask to join</button>`;
    else if (G.step === 'want') h = `<h2>Ask to join</h2>
      <label class="glab" for="gName">Your first name</label>
      <input id="gName" type="text" autocomplete="given-name" maxlength="24" placeholder="Name" value="${esc(G.name || '')}">
      <label class="glab" for="gEmail">Your email</label>
      <input id="gEmail" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="you@example.com" value="${esc(G.email)}">
      ${err}
      <button type="button" class="btn primary wide big" data-g="wantsend"${G.busy ? ' disabled' : ''}>${ico('send')}Ask to join</button>
      <button type="button" class="btn wide ghost" data-g="back">Back</button>`;
    else if (G.step === 'wanted') h = `<div class="gok">${ico('yes')}</div><h2>Asked</h2>
      <p class="gp">Joel or Nicol lets you in, then sends you a code.</p>
      <button type="button" class="btn primary wide big" data-g="havecode">${ico('key')}I have a code</button>
      <button type="button" class="btn wide ghost" data-g="back">Back</button>`;
    else if (G.step === 'sent') h = `<div class="gok">${ico('yes')}</div><h2>Check your email</h2>
      <p class="gp">Tap the link in it. This page opens by itself.</p>
      ${err}
      <button type="button" class="btn wide" data-g="havecode">${ico('key')}I have a code instead</button>
      <button type="button" class="btn wide ghost" data-g="back">Use another email</button>`;
    else if (G.step === 'code') h = `<h2>Enter your code</h2>
      <label class="glab" for="gEmail">Your email</label>
      <input id="gEmail" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="you@example.com" value="${esc(G.email)}">
      <label class="glab" for="gCode">Code</label>
      <input id="gCode" class="gcode" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="10" placeholder="••••••">
      ${err}
      <button type="button" class="btn primary wide big" data-g="verify"${G.busy ? ' disabled' : ''}>${ico('arrow')}Open the room</button>
      <button type="button" class="btn wide ghost" data-g="back">Back</button>`;
    else if (G.step === 'join') h = G.asked
      ? `<div class="gok">${ico('yes')}</div><h2>Asked</h2><p class="gp">Joel or Nicol lets you in. This page opens by itself.</p>
         <button type="button" class="btn wide" data-g="recheck"${G.busy ? ' disabled' : ''}>Check now</button><button type="button" class="btn wide ghost" data-g="signout">Sign out</button>`
      : `<h2>Ask to join</h2><p class="gp">Signed in as <b>${esc(me.email || '')}</b></p>
         <label class="glab" for="gName">Your first name</label>
         <input id="gName" type="text" autocomplete="given-name" maxlength="24" placeholder="Name">
         ${err}
         <button type="button" class="btn primary wide big" data-g="ask"${G.busy ? ' disabled' : ''}>${ico('send')}Ask to join</button>
         <button type="button" class="btn wide ghost" data-g="signout">Sign out</button>`;
    gCard.innerHTML = h;
    gCard.dataset.step = G.step;
    gFoot.textContent = G.step === 'email' || G.step === 'code' ? 'Members only. One sign-in per device.' : '';
  }
  const emailNow = () => { const el = $('gEmail'); const v = (el ? el.value : G.email || '').trim().toLowerCase(); G.email = v; return v; };
  const emailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  function authWords(e) {
    const m = String((e && (e.message || e.error_description)) || e || '');
    if (/rate limit|too many|security purposes/i.test(m)) return 'Too many emails this hour. Ask Joel or Nicol for a code.';
    if (/expired|invalid/i.test(m)) return 'That code or link is wrong or too old. Get a new one.';
    if (/not allowed|signups? (are )?disabled/i.test(m)) return 'This email is not on the list yet. Ask Joel or Nicol.';
    if (/fetch|network/i.test(m)) return 'No connection. Try again.';
    return m.slice(0, 120) || 'That did not work. Try again.';
  }
  gate.addEventListener('click', async e => {
    const b = e.target.closest('[data-g]'); if (!b || b.disabled) return;
    const act = b.dataset.g; buzz();
    if (act === 'retry') { location.reload(); return; }
    if (act === 'back') { G.step = 'email'; G.err = ''; gateDraw(); return; }
    if (act === 'want') { emailNow(); G.step = 'want'; G.err = ''; gateDraw(); const c = $('gName'); if (c) c.focus(); return; }
    if (act === 'wantsend') {
      const em = emailNow(); const nm = (($('gName') || {}).value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24); G.name = nm;
      if (!nm) { G.err = 'Type your first name.'; gateDraw(); return; }
      if (!emailOk(em)) { G.err = 'Type your email.'; gateDraw(); return; }
      G.busy = true; G.err = ''; gateDraw(); store.set('room-email', em);
      let error = null; if (!DEMO) ({ error } = await sb.from('room_requests').insert({ email: em, wanted_name: nm })); else await sleep(600);
      G.busy = false;
      if (error && !/duplicate|23505|conflict/i.test((error.message || '') + (error.code || ''))) { G.err = /row-level|policy|42501/i.test((error.message || '') + (error.code || '')) ? 'The list is full right now. Tell Joel or Nicol.' : authWords(error); gateDraw(); return; }
      G.step = 'wanted'; gateDraw(); return;
    }
    if (act === 'havecode') { emailNow(); G.step = 'code'; G.err = ''; gateDraw(); const c = $(G.email ? 'gCode' : 'gEmail'); if (c) c.focus(); return; }
    if (act === 'signout') { try { await sb.auth.signOut(); } catch (x) { /* ignore */ } G.step = 'email'; G.asked = false; G.err = ''; gateDraw(); return; }
    if (act === 'link') {
      const em = emailNow(); if (!emailOk(em)) { G.err = 'Type your email first.'; gateDraw(); return; }
      G.busy = true; G.err = ''; gateDraw(); store.set('room-email', em);
      const { error } = await sb.auth.signInWithOtp({ email: em, options: { emailRedirectTo: location.origin + location.pathname } });
      G.busy = false;
      if (error) { G.err = authWords(error); gateDraw(); return; }
      G.step = 'sent'; gateDraw(); return;
    }
    if (act === 'verify') {
      const em = emailNow(); const code = (($('gCode') || {}).value || '').replace(/\D/g, '');
      if (!emailOk(em)) { G.err = 'Type your email first.'; gateDraw(); return; }
      if (code.length < 6) { G.err = 'Type the whole code.'; gateDraw(); return; }
      G.busy = true; G.err = ''; gateDraw(); store.set('room-email', em);
      let r = await sb.auth.verifyOtp({ email: em, token: code, type: 'email' });
      if (r.error) r = await sb.auth.verifyOtp({ email: em, token: code, type: 'magiclink' });
      G.busy = false;
      if (r.error) { G.err = authWords(r.error); gateDraw(); const c = $('gCode'); if (c) c.focus(); return; }
      return;   // onAuthStateChange takes it from here
    }
    if (act === 'ask') {
      const nm = (($('gName') || {}).value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24);
      if (!nm) { G.err = 'Type your first name.'; gateDraw(); return; }
      G.busy = true; G.err = ''; gateDraw();
      const { error } = await sb.from('room_requests').upsert({ email: me.email, wanted_name: nm }, { onConflict: 'email', ignoreDuplicates: true });
      G.busy = false;
      if (error && !/duplicate/i.test(error.message || '')) { G.err = authWords(error); gateDraw(); return; }
      G.asked = true; gateDraw(); return;
    }
    if (act === 'recheck') { G.busy = true; gateDraw(); await enter(); G.busy = false; if (!me.name) gateDraw(); }
  });
  gate.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    const b = gCard.querySelector(G.step === 'code' ? '[data-g="verify"]' : G.step === 'join' ? '[data-g="ask"]' : G.step === 'want' ? '[data-g="wantsend"]' : '[data-g="link"]'); if (b) b.click();
  });

  // signed in: member → the room; not a member → ask to join
  let entered = false, joinPoll = 0;
  async function enter() {
    let row = null;
    try {
      const { data: s } = await sb.auth.getSession();
      const user = s && s.session && s.session.user; if (!user) { G.step = 'email'; gateDraw(); return; }
      me.email = String(user.email || '').toLowerCase();
      const { data, error } = await sb.rpc('room_me');
      if (error) throw error;
      row = Array.isArray(data) ? data[0] : data;
    } catch (e) { G.step = 'down'; gateDraw(); return; }
    if (!row || !row.name) {
      me.name = null; G.step = 'join';
      try { const { data } = await sb.from('room_requests').select('email').eq('email', me.email); G.asked = !!(data && data.length); } catch (e) { /* ignore */ }
      gateDraw();
      clearInterval(joinPoll); joinPoll = setInterval(async () => { if (entered || document.hidden) return; const { data } = await sb.rpc('room_me'); const r = Array.isArray(data) ? data[0] : data; if (r && r.name) enter(); }, 15000);
      return;
    }
    clearInterval(joinPoll);
    me.name = String(row.name).toLowerCase(); me.team = row.team || 'okasan'; me.role = row.role || 'member';
    if (!entered) { entered = true; openRoom(); }
  }
  function openRoom() {
    $('meIni').textContent = (me.name || '?')[0].toUpperCase();
    $('hq').hidden = false; $('tabs').hidden = false;
    document.documentElement.classList.add('in-room');
    gate.classList.add('open');
    setTimeout(() => { gate.hidden = true; }, reduced() ? 0 : 650);
    window.claude = { use: async name => name === 'db' ? dbApi : name === 'user' ? userApi : null };
    $('busBtn').hidden = !isAdmin();
    Live.start(); HQ.start(); Chat.start(); People.start(); FX.afterTab(HQ.S.tab, true);
  }

  // =====================================================================================================
  // The data layer the core reads through (same call shapes as the HQ app's database)
  // =====================================================================================================
  const D = { docs: {}, stamp: {}, answers: {}, subs: {}, fresh: false, cached: false };
  const CACHE = 'room-cache-v1';
  const COLS = ['ops', 'team', 'numbers', 'asks'];
  function snap(col, fromCache) {
    let docs;
    if (col === 'answers') docs = Object.keys(D.answers).map(k => ({ id: k, exists: true, data: () => D.answers[k] }));
    else { const p = col + '/'; docs = Object.keys(D.docs).filter(id => id.startsWith(p)).map(id => ({ id: id.slice(p.length), exists: true, data: () => D.docs[id] })); }
    return { docs, metadata: { fromCache: !!fromCache } };
  }
  function emit(col) { (D.subs[col] || []).forEach(fn => { try { fn(snap(col, !D.fresh)); } catch (e) { /* the core guards itself */ } }); }
  const saveCache = debounce(() => { if (DEMO) return; store.set(CACHE, JSON.stringify({ who: me.email, docs: D.docs, stamp: D.stamp, answers: D.answers })); }, 1500);
  function readCache() {
    try { const c = JSON.parse(store.get(CACHE) || 'null'); if (c && c.who === me.email && c.docs) { D.docs = c.docs; D.stamp = c.stamp || {}; D.answers = c.answers || {}; D.cached = true; } } catch (e) { /* ignore */ }
  }
  const ansRow = r => ({ askId: r.ask_id, choice: r.choice, text: r.text || '', at: (r.at ? new Date(r.at) : new Date()).toISOString(), uid: r.who, who: r.who, carried_at: r.carried_at || undefined, carried_to: r.carried_to || undefined, _id: r.id });
  const dbApi = {
    collection(col) {
      return { onSnapshot(next) {
        (D.subs[col] = D.subs[col] || []).push(next);
        if (D.fresh || D.cached) setTimeout(() => { try { next(snap(col, !D.fresh)); } catch (e) { /* ignore */ } }, 0);
        return () => { D.subs[col] = (D.subs[col] || []).filter(f => f !== next); };
      } };
    },
    doc(path) {
      const i = path.indexOf('/'); const col = path.slice(0, i), id = path.slice(i + 1);
      const only = () => { if (col !== 'answers') throw Object.assign(new Error('the page only writes answers'), { code: 'permission_denied' }); };
      return {
        async get() { only(); const r = await Api.latestAnswer(id); return { id, exists: !!r, data: () => r || undefined }; },
        async set(doc) { only(); const r = await Api.insertAnswer({ ask_id: id, choice: doc.choice, text: doc.text || '', who: me.name }); D.answers[id] = r; emit('answers'); saveCache(); },
        async update(part) { only(); const cur = await Api.latestAnswer(id); if (!cur || cur.who !== me.name) throw Object.assign(new Error('missing'), { code: 'not_found' }); if (cur.carried_at) throw Object.assign(new Error('carried'), { code: 'already_carried' });
          await Api.deleteAnswers(id); const r = await Api.insertAnswer({ ask_id: id, choice: cur.choice, text: part.text != null ? String(part.text) : cur.text, who: me.name }); D.answers[id] = r; emit('answers'); saveCache(); },
        async delete() { only(); await Api.deleteAnswers(id); await Live.answers(); },
      };
    },
  };
  const userApi = { id: async () => me.name, can: () => OWNERS.includes(me.name), isOwner: () => OWNERS.includes(me.name) };
  const fail = (error, code) => { if (error) throw Object.assign(new Error(error.message || 'failed'), { code: code || error.code || 'refused' }); };

  // ---- every call to the database, live or the local demo
  let demo = null, demoP = null;
  const demoReady = () => demoP || (demoP = fetch('dev/fixture.json').then(r => r.json()).then(f => { demo = { docs: {}, answers: f.answers || {}, msgs: f.msgs || [], rx: [], nid: 9000 }; Object.keys(f.docs).forEach(c => Object.keys(f.docs[c]).forEach(id => { demo.docs[c + '/' + id] = f.docs[c][id]; })); }));
  const Api = DEMO ? {
    async docs() { await demoReady(); return Object.keys(demo.docs).map(id => ({ id, data: demo.docs[id], updated_at: '2026-11-22T00:00:00Z' })); },
    async stamps() { return []; }, async docsById() { return []; },
    async answers() { return Object.values(demo.answers); },
    async latestAnswer(id) { return demo.answers[id] || null; },
    async insertAnswer(r) { await sleep(350); const a = ansRow(Object.assign({ id: ++demo.nid }, r)); demo.answers[r.ask_id] = a; return a; },
    async deleteAnswers(id) { await sleep(250); delete demo.answers[id]; },
    async msgs(before) { await demoReady(); return before ? [] : demo.msgs.slice(); },
    async send(to, text) { await sleep(200); const m = { id: ++demo.nid, at: new Date().toISOString(), from_name: me.name, to_name: to, team: me.team, text }; demo.msgs.push(m); return m; },
    async rx() { await demoReady(); return demo.rx.slice(); },
    async react(id, emoji, on) { demo.rx = demo.rx.filter(r => !(r.msg_id === id && r.who === me.name && r.emoji === emoji)); if (on) demo.rx.push({ msg_id: id, who: me.name, emoji }); },
    async team() { return [{ name: 'joel', team: 'okasan', role: 'admin' }, { name: 'nicol', team: 'bornjuicy', role: 'admin' }]; },
    async members() { return [{ email: 'joel@example.com', name: 'joel', team: 'okasan', role: 'admin' }, { email: 'nicol@example.com', name: 'nicol', team: 'bornjuicy', role: 'admin' }]; },
    async requests() { return [{ email: 'agnes@example.com', wanted_name: 'agnes', at: new Date().toISOString() }]; },
    async addMember() { await sleep(300); }, async setRole() { await sleep(300); }, async removeMember() { await sleep(300); }, async dropRequest() { await sleep(300); },
    async askCode() { await sleep(900); return { code: '482913', made_at: new Date().toISOString() }; },
    async myCode() { return null; },
  } : {
    async docs() { const { data, error } = await sb.from('room_docs').select('id,data,updated_at'); fail(error); return data || []; },
    async stamps() { const { data, error } = await sb.from('room_docs').select('id,updated_at'); fail(error); return data || []; },
    async docsById(ids) { const { data, error } = await sb.from('room_docs').select('id,data,updated_at').in('id', ids); fail(error); return data || []; },
    async answers() { const { data, error } = await sb.from('room_answers').select('*').order('id', { ascending: false }).limit(800); fail(error); return (data || []).map(ansRow); },
    async latestAnswer(id) { const { data, error } = await sb.from('room_answers').select('*').eq('ask_id', id).order('id', { ascending: false }).limit(1); fail(error); return data && data[0] ? ansRow(data[0]) : null; },
    async insertAnswer(r) { const { data, error } = await sb.from('room_answers').insert(r).select().single(); fail(error); return ansRow(data); },
    async deleteAnswers(id) { const { error } = await sb.from('room_answers').delete().eq('ask_id', id).eq('who', me.name).is('carried_at', null); fail(error); },
    async msgs(before) { let q = sb.from('messages').select('id,at,from_name,to_name,team,text').order('at', { ascending: false }).order('id', { ascending: false }).limit(PAGE); if (before) q = q.lt('at', before); const { data, error } = await q; fail(error); return (data || []).reverse(); },
    async send(to, text) { const { data, error } = await sb.from('messages').insert({ from_name: me.name, to_name: to, team: me.team || 'okasan', text }).select('id,at,from_name,to_name,team,text').single(); fail(error); return data; },
    async rx() { const { data, error } = await sb.from('room_reactions').select('msg_id,who,emoji').order('at', { ascending: false }).limit(2000); fail(error); return data || []; },
    async react(id, emoji, on) {
      if (on) { const { error } = await sb.from('room_reactions').upsert({ msg_id: id, who: me.name, emoji }, { onConflict: 'msg_id,who,emoji', ignoreDuplicates: true }); fail(error); }
      else { const { error } = await sb.from('room_reactions').delete().eq('msg_id', id).eq('who', me.name).eq('emoji', emoji); fail(error); }
    },
    async team() { const { data, error } = await sb.rpc('room_team'); fail(error); return data || []; },
    async members() { const { data, error } = await sb.from('room_members').select('email,name,team,role').order('name'); fail(error); return data || []; },
    async requests() { const { data, error } = await sb.from('room_requests').select('email,wanted_name,at').order('at'); fail(error); return data || []; },
    async addMember(m) { const { error } = await sb.from('room_members').insert(m); fail(error); },
    async setRole(email, role) { const { error } = await sb.from('room_members').update({ role }).eq('email', email); fail(error); },
    async removeMember(email) { const { error } = await sb.from('room_members').delete().eq('email', email); fail(error); },
    async dropRequest(email) { const { error } = await sb.from('room_requests').delete().eq('email', email); fail(error); },
    // a sign-in code is made on the studio PC (it holds the only key that can); this page asks and waits
    async askCode(email) {
      const asked = new Date().toISOString();
      const { error } = await sb.from('room_codes').upsert({ email, code: null, made_at: null, asked_at: asked, asked_by: me.name }, { onConflict: 'email' }); fail(error);
      for (let i = 0; i < 20; i++) { await sleep(1500); const { data } = await sb.from('room_codes').select('code,made_at').eq('email', email).limit(1); const r = data && data[0]; if (r && r.code) return r; }
      return null;
    },
  };

  // Partner studio cards (room docs partner/<team>): one card per studio under the Team list. Read-only.
  const Partner = {
    open: {},
    draw() {
      const el = $('partnerBody'); if (!el) return;
      const ids = Object.keys(D.docs).filter(id => id.startsWith('partner/')).sort();
      const now = Date.now(); const day = iso => { try { return HQ.when(iso, 'day'); } catch (e) { return ''; } };
      const fold = (key, title, line, count, body) => `<details class="fold" data-pfold="${esc(key)}"${Partner.open[key] ? ' open' : ''}><summary class="foldh"><span class="t"><b>${esc(title)}</b>${line ? `<span>${esc(line)}</span>` : ''}</span><span class="c"><span class="num">${esc(count)}</span>${ico('chev')}</span></summary><div class="pfb">${body}</div></details>`;
      el.innerHTML = ids.map(id => {
        const P = D.docs[id] || {}; const k = id.slice(8); const C = P.checks || {};
        const now_ = Array.isArray(P.now) ? P.now : [], wait = Array.isArray(P.waiting) ? P.waiting : [], games = Array.isArray(P.games) ? P.games : [], ppl = Array.isArray(P.people) ? P.people : [];
        const fails = +C.fail || 0, pass = +C.pass || 0, off = (+C.off || 0) + (+C.skipped || 0);
        const stale = P.read_at && now - Date.parse(P.read_at) > 3 * 864e5;
        const item = (t, sub, tag) => `<li><b>${esc(t)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}${tag ? `<i>${esc(tag)}</i>` : ''}</li>`;
        const more = (n, shown) => (n > shown ? `<li class="more">+${n - shown} more in their backlog</li>` : '');
        const nn = +P.now_n || now_.length, wn = +P.waiting_n || wait.length;
        return `<section class="sec partner"><div class="eyebrow">Partner studio</div><article class="panel pcard">
          <div class="pch"><span class="av" aria-hidden="true">${esc(String(P.title || k).split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase())}</span>
            <span class="pcn"><b>${esc(P.title || cap(k))}</b><span>${esc(P.lead || '')}${P.read_at ? ' · read ' + esc(day(P.read_at)) : ''}</span></span>
            ${stale ? `<span class="chip warn">${ico('wait')}Old</span>` : ''}</div>
          <div class="pstats">
            <div class="pst ${fails ? 'bad' : 'good'}"><b class="num">${fails ? esc(fails) : esc(pass)}</b><span>${fails ? 'checks fail' : 'checks pass'}</span></div>
            <div class="pst"><b class="num">${esc(nn)}</b><span>in work</span></div>
            <div class="pst ${wn ? 'warn' : ''}"><b class="num">${esc(wn)}</b><span>waiting</span></div>
          </div>
          ${now_.length ? fold(k + ':now', 'In work', now_[0].t, nn, '<ul class="pli">' + now_.map(x => item(x.t, x.line, [x.who, x.d].filter(Boolean).join(' · '))).join('') + more(nn, now_.length) + '</ul>') : ''}
          ${wait.length ? fold(k + ':wait', 'Waiting on', wait[0].who ? cap(wait[0].who) : '', wn, '<ul class="pli">' + wait.map(x => item(x.t, x.why, [x.who ? cap(x.who) : '', x.d].filter(Boolean).join(' · '))).join('') + more(wn, wait.length) + '</ul>') : ''}
          ${games.length ? fold(k + ':games', 'Games', games.map(g => g.name).join(', '), games.length, '<ul class="pli">' + games.map(g => item(g.name, g.next ? 'Next: ' + g.next : '', [g.kind, g.stage].filter(Boolean).join(' · ')) + (Array.isArray(g.needs) && g.needs.length ? `<li class="needs">${g.needs.map(n => `<span class="chip warn">${esc(n)}</span>`).join('')}</li>` : '')).join('') + '</ul>') : ''}
          ${ppl.length ? fold(k + ':team', 'Their team', ppl.map(p => p.name).slice(0, 3).join(', '), ppl.length, '<ul class="pli">' + ppl.map(p => item(p.name, p.job, p.kind)).join('') + '</ul>') : ''}
          ${C.at ? fold(k + ':checks', 'Checks', 'Run ' + day(C.at), pass + '/' + (pass + fails), `<div class="pchk"><span class="chip good">${esc(pass)} pass</span><span class="chip ${fails ? 'bad' : ''}">${esc(fails)} fail</span><span class="chip">${esc(off)} off</span></div>` + (Array.isArray(C.off_list) && C.off_list.length ? '<p class="poff">Off: ' + esc(C.off_list.concat(C.skipped_list || []).join(', ')) + '</p>' : '')) : ''}
        </article></section>`;
      }).join('');
    },
  };
  document.addEventListener('toggle', e => { const d = e.target; if (d && d.dataset && d.dataset.pfold) Partner.open[d.dataset.pfold] = d.open; }, true);

  // Which build is where (room doc builds/_main, from tools/room-builds.js; partner games from partner/<team>).
  // A strip on every game card and one list on the Launches tab. A missing value reads "Not known", never a guess.
  const Builds = {
    rev: 0, open: {},
    all() { const d = D.docs['builds/_main']; return d && Array.isArray(d.games) ? d.games : null; },
    get(id) { const g = this.all(); if (!g) return undefined; const n = String(id || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); return g.find(x => x.id === id) || g.find(x => (x.aliases || []).includes(n)) || null; },
    partner() {
      const out = [];
      Object.keys(D.docs).filter(id => id.startsWith('partner/')).sort().forEach(id => { const P = D.docs[id] || {};
        (Array.isArray(P.games) ? P.games : []).forEach(g => out.push({ id: id + ':' + g.name, name: g.name, kind: g.kind || '', studio: P.title || '', live: g.live || null, live_at: g.live_at || null, build: g.build || null, verdict: ['none', 'coo', 'owners'].includes(g.verdict) ? g.verdict : null, verdict_at: g.verdict_at || null, verdict_build: g.verdict_build || null, old: g.live_old === true || (!!g.live && !!g.build && String(g.live) !== String(g.build)) })); });
      return out;
    },
    day(d) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? (+m[3]) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1] : ''; },
    cells(g) {
      const nk = '<span class="bv unk">Not known</span>';
      const live = g.live ? `<span class="bv" title="${esc(g.live)}"><b>${esc(g.live)}</b>${g.live_at ? ' · ' + esc(this.day(g.live_at)) : ''}</span>` : nk;
      const build = g.build ? `<span class="bv" title="${esc(g.build)}"><b>${esc(g.build)}</b></span>` : nk;
      const vw = { none: 'None', coo: 'COO verdict', owners: 'Owners seen' }[g.verdict];
      const vsub = [g.verdict_word, g.verdict_build ? 'on ' + g.verdict_build : '', this.day(g.verdict_at)].filter(Boolean).join(' · ');
      const verdict = vw ? `<span class="bv">${esc(vw)}${vsub && g.verdict !== 'none' ? `<small> · ${esc(vsub)}</small>` : ''}</span>` : nk;
      return `<span class="bstrip" role="group" aria-label="Which build is where">
        <span class="bcell${g.old ? ' old' : ''}"><span class="bk">On platform now</span>${live}${g.old ? `<span class="btag">${ico('wait')}OLD</span>` : ''}</span>
        <span class="bcell"><span class="bk">In the build</span>${build}</span>
        <span class="bcell v-${esc(g.verdict || 'unk')}"><span class="bk">Verdict</span>${verdict}</span></span>`;
    },
    // '' until the builds doc has loaded; all "Not known" for a game the doc does not have
    strip(id) { const g = this.get(id); return g === undefined ? '' : this.cells(g || {}); },
    draw() {
      const el = $('buildsBody'); if (!el) return;
      const mine = this.all(); if (!mine) { el.innerHTML = ''; return; }
      const games = mine.concat(this.partner());
      const known = games.filter(g => g.old || g.live || g.verdict).sort((a, b) => (b.old - a.old) || ((a.verdict === 'none') - (b.verdict === 'none')) * -1 || String(a.name).localeCompare(String(b.name)));
      const rest = games.filter(g => !(g.old || g.live || g.verdict)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
      const nOld = games.filter(g => g.old).length, nNone = games.filter(g => g.verdict === 'none').length;
      const row = g => `<article class="panel brow${g.old ? ' old' : ''}"><div class="brh"><b>${esc(g.name)}</b><span>${esc([cap(g.kind), g.studio].filter(Boolean).join(' · '))}</span></div>${this.cells(g)}</article>`;
      const key = 'builds:rest';
      el.innerHTML = `<section class="sec builds"><div class="eyebrow">Which build is where</div>
        <div class="pstats">
          <div class="pst ${nOld ? 'warn' : 'good'}"><b class="num">${esc(nOld)}</b><span>old on platform</span></div>
          <div class="pst ${nNone ? 'warn' : ''}"><b class="num">${esc(nNone)}</b><span>no verdict</span></div>
          <div class="pst"><b class="num">${esc(rest.length)}</b><span>not known</span></div>
        </div>
        ${known.map(row).join('')}
        ${rest.length ? `<article class="panel pcard"><details class="fold" data-bfold="${key}"${this.open[key] ? ' open' : ''}><summary class="foldh"><span class="t"><b>Not known</b><span>No live revision on the card</span></span><span class="c"><span class="num">${esc(rest.length)}</span>${ico('chev')}</span></summary><div class="pfb">${rest.map(row).join('')}</div></details></article>` : ''}
      </section>`;
    },
    // a builds or partner doc changed: redraw the list and every game card
    bump(cols) { this.rev++; this.draw(); if (!cols || !cols.has('ops')) emit('ops'); },
  };
  window.RoomBuilds = Builds;
  document.addEventListener('toggle', e => { const d = e.target; if (d && d.dataset && d.dataset.bfold) Builds.open[d.dataset.bfold] = d.open; }, true);

  const Live = {
    last: 0, channel: null,
    async start() {
      readCache(); const had = D.cached; if (had) { Partner.draw(); Builds.draw(); }
      await this.all();
      if (!had) setTimeout(() => FX.afterTab(HQ.S.tab), 90);   // first cards rise in when they first arrive
      if (DEMO) return;
      this.listen();
      document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - this.last > 20000) this.delta(); });
      window.addEventListener('online', () => this.delta());
      setInterval(() => { if (!document.hidden && Date.now() - this.last > 150000) this.delta(); }, 30000);   // a quiet safety net under the live channel
    },
    async all() {
      try {
        const rows = await Api.docs(); const docs = {}, stamp = {};
        rows.forEach(r => { docs[r.id] = r.data; stamp[r.id] = r.updated_at; });
        D.docs = docs; D.stamp = stamp; await this.answers(true);
        D.fresh = true; this.last = Date.now(); COLS.forEach(emit); emit('answers'); Partner.draw(); Builds.draw(); saveCache();
      } catch (e) { if (D.cached) { COLS.forEach(emit); emit('answers'); } HQ.S.err = HQ.S.err || null; setTimeout(() => this.all(), 8000); }
    },
    async answers(quiet) {
      const rows = await Api.answers(); const m = {};
      rows.forEach(r => { if (!m[r.askId]) m[r.askId] = r; });   // newest first: the latest tap on an ask wins
      D.answers = m; if (!quiet) { emit('answers'); saveCache(); }
    },
    async delta() {
      try {
        const st = await Api.stamps(); const want = [], seen = new Set();
        st.forEach(r => { seen.add(r.id); if (D.stamp[r.id] !== r.updated_at) want.push(r.id); });
        const cols = new Set();
        Object.keys(D.docs).forEach(id => { if (!seen.has(id)) { delete D.docs[id]; delete D.stamp[id]; cols.add(id.split('/')[0]); } });
        if (want.length) (await Api.docsById(want)).forEach(r => { D.docs[r.id] = r.data; D.stamp[r.id] = r.updated_at; cols.add(r.id.split('/')[0]); });
        await this.answers(true); this.last = Date.now();
        cols.forEach(c => { if (COLS.includes(c)) emit(c); }); emit('answers'); if (cols.has('partner')) Partner.draw(); if (cols.has('partner') || cols.has('builds')) Builds.bump(cols); saveCache();
        Chat.catchUp();
      } catch (e) { /* the next tick tries again */ }
    },
    queue: new Set(),
    flush: debounce(async () => {
      const ids = [...Live.queue]; Live.queue.clear(); if (!ids.length) return;
      try {
        const rows = await Api.docsById(ids); const got = new Set(); const cols = new Set();
        rows.forEach(r => { got.add(r.id); D.docs[r.id] = r.data; D.stamp[r.id] = r.updated_at; cols.add(r.id.split('/')[0]); });
        ids.forEach(id => { if (!got.has(id) && D.docs[id]) { delete D.docs[id]; delete D.stamp[id]; cols.add(id.split('/')[0]); } });
        Live.last = Date.now(); cols.forEach(c => { if (COLS.includes(c)) emit(c); }); if (cols.has('partner')) Partner.draw(); if (cols.has('partner') || cols.has('builds')) Builds.bump(cols); saveCache();
      } catch (e) { /* delta() picks it up */ }
    }, 500),
    listen() {
      const again = debounce(() => this.answers().catch(() => {}), 300);
      const rx = debounce(() => Chat.loadRx(), 300);
      let first = true;
      this.channel = sb.channel('room-live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'room_docs' }, p => { const id = (p.new && p.new.id) || (p.old && p.old.id); if (id) { this.queue.add(id); this.flush(); } })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'room_answers' }, again)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'room_reactions' }, rx)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, p => { if (p.new) Chat.add(p.new, true); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'room_requests' }, () => People.load())
        .subscribe(status => { if (status === 'SUBSCRIBED') { if (!first) this.delta(); first = false; } });
    },
  };

  // =====================================================================================================
  // Chat
  // =====================================================================================================
  const dayF = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const hmF = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const dF = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
  const EMOJI = ['👍', '✅', '👀', '🔥', '❤️'];
  const NAMES = { room: 'Room', all: 'Everyone' };
  const nameOf = n => NAMES[n] || cap(n);
  function linkify(s) {
    return esc(s).replace(/https:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u.length > 46 ? u.slice(8, 44) + '…' : u.slice(8)}</a>`);
  }
  const Chat = {
    msgs: [], ids: new Set(), rx: {}, filter: store.get('room-chat-filter') || 'room', to: 'room', seen: +(store.get('room-chat-seen-at') || 0), drawn: 0, more: true, loadingOld: false, open: {}, rxOpen: null, ready: false, people: [],
    async start() {
      this.toChips();
      try { const rows = await Api.msgs(); rows.forEach(m => this.add(m, false)); this.more = rows.length >= PAGE; } catch (e) { /* drawn as empty; delta retries */ }
      this.ready = true; if (!this.seen) this.seen = this.maxAt(true);
      await this.loadRx(); this.draw(); this.badge();
    },
    async catchUp() { if (!this.ready) return; try { const rows = await Api.msgs(); let n = 0; rows.forEach(m => { if (!this.ids.has(m.id)) { this.add(m, false); n++; } }); if (n) { this.draw(); this.badge(); } } catch (e) { /* ignore */ } },
    async loadRx() { try { const rows = await Api.rx(); const m = {}; rows.forEach(r => { ((m[r.msg_id] = m[r.msg_id] || {})[r.emoji] = m[r.msg_id][r.emoji] || []).push(r.who); }); this.rx = m; if (this.ready) this.draw(); } catch (e) { /* ignore */ } },
    add(m, live) {
      if (!m || this.ids.has(m.id)) return; this.ids.add(m.id); m.t = Date.parse(m.at) || Date.now(); this.msgs.push(m);
      if (!live) return;
      const mine = m.from_name === me.name;
      if (this.shows(m)) { const stick = this.atBottom() || mine; this.draw(); if (HQ.S.tab === 'chat') { if (stick) this.bottom(true); else $('chatNew').hidden = false; } }
      this.badge();
      if (!mine && this.counts(m) && (HQ.S.tab !== 'chat' || document.hidden)) buzz(12);
    },
    maxAt(countable) { let x = 0; this.msgs.forEach(m => { if ((!countable || this.counts(m)) && m.t > x) x = m.t; }); return x; },
    async older() {
      if (this.loadingOld || !this.more || !this.msgs.length) return; this.loadingOld = true; this.draw();
      const first = this.msgs.reduce((a, b) => (b.t < a.t ? b : a)); const h0 = document.documentElement.scrollHeight, y0 = window.scrollY;
      try { const rows = await Api.msgs(first.at); rows.forEach(m => this.add(m, false)); this.more = rows.length >= PAGE; } catch (e) { HQ.toast('Could not load. Try again.', null); }
      this.loadingOld = false; this.draw();
      requestAnimationFrame(() => window.scrollTo({ top: y0 + (document.documentElement.scrollHeight - h0), behavior: 'auto' }));
    },
    // the Room view: what was said to everyone, plus anything to or from me; relay copies made for the old helper are noise
    counts(m) { return m.from_name !== 'room' && (m.to_name === 'room' || m.to_name === 'all' || m.to_name === me.name || m.from_name === me.name); },
    shows(m) {
      if (this.filter === 'bus') return true;
      if (this.filter === 'me') return m.to_name === me.name || (m.from_name === me.name && m.to_name !== 'room' && m.to_name !== 'all');
      return this.counts(m);
    },
    atBottom() { return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160; },
    bottom(smooth) { requestAnimationFrame(() => { window.scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth && !reduced() ? 'smooth' : 'auto' }); $('chatNew').hidden = true; }); },
    badge() {
      const b = $('chatBadge'); if (!this.ready) return;
      if (HQ.S.tab === 'chat' && !document.hidden) { const x = this.maxAt(true); if (x > this.seen) { this.seen = x; store.set('room-chat-seen-at', String(x)); } }
      const n = this.msgs.filter(m => m.t > this.seen && m.from_name !== me.name && this.counts(m)).length;
      b.hidden = !n; b.textContent = n > 99 ? '99+' : String(n);
    },
    toChips() {
      const names = ['room', ...AI.map(a => a[0]), ...this.people.map(p => p.name).filter(n => n !== me.name && !AI.some(a => a[0] === n))];
      const ok = new Set(['room', 'all', 'miso', 'ashra', 'juno', 'nicol', 'joel']);
      $('toChips').innerHTML = '<span class="tol">To</span>' + names.filter(n => ok.has(n)).map(n => `<button type="button" class="toc${n === this.to ? ' on' : ''}" role="radio" aria-checked="${n === this.to}" data-to="${esc(n)}">${n === 'room' ? '' : `<i class="av a${hash(n) % 8}">${esc(n[0].toUpperCase())}</i>`}${esc(nameOf(n))}</button>`).join('');
      $('chatText').placeholder = this.to === 'room' ? 'Message the room' : 'Message ' + nameOf(this.to);
    },
    draw() {
      const el = $('chatBody'); const list = this.msgs.filter(m => this.shows(m)).sort((a, b) => a.t - b.t || a.id - b.id);
      document.querySelectorAll('[data-chat-filter]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.chatFilter === this.filter)));
      if (!this.ready) return;
      if (!list.length) { el.innerHTML = `<div class="panel empty"><span class="glyph">${ico('reply')}</span><h3>${this.filter === 'me' ? 'Nothing sent to you' : 'Quiet in here'}</h3><p>Say something below.</p></div>`; return; }
      let h = this.more ? `<div class="cearlier"><button type="button" class="btn small" data-earlier${this.loadingOld ? ' disabled' : ''}>${this.loadingOld ? 'Loading' : 'Earlier messages'}</button></div>` : '', day = '', prev = null; const today = dayF.format(new Date()); const fresh = this.drawn;
      for (const m of list) {
        const at = new Date(m.at); const d = dayF.format(at);
        if (d !== day) { day = d; prev = null; h += `<div class="cday"><span>${d === today ? 'Today' : esc(dF.format(at))}</span></div>`; }
        const mine = m.from_name === me.name; const run = prev && prev.from_name === m.from_name && prev.to_name === m.to_name && (at - new Date(prev.at)) < 5 * 60000;
        const long = m.text.length > 420 || (m.text.match(/\n/g) || []).length > 7; const open = !!this.open[m.id];
        const rx = this.rx[m.id] || {}; const rxKeys = Object.keys(rx);
        const direct = m.to_name !== 'room' && m.to_name !== 'all';
        h += `<div class="msg${mine ? ' mine' : ''}${run ? ' run' : ''}${m.t > fresh && fresh ? ' new' : ''}" data-mid="${m.id}">
          ${mine ? '' : `<i class="av a${hash(m.from_name) % 8}" aria-hidden="true">${esc((m.from_name || '?')[0].toUpperCase())}</i>`}
          <div class="mb">
            ${run ? '' : `<div class="mh"><b>${esc(mine ? 'You' : nameOf(m.from_name))}</b>${direct ? `<span class="mto">${ico('arrow')}${esc(m.to_name === me.name ? 'you' : nameOf(m.to_name))}</span>` : ''}<time>${esc(hmF.format(at))}</time></div>`}
            <div class="bub${long && !open ? ' clamp' : ''}" data-bub="${m.id}" tabindex="0" role="button" aria-label="React to this message">${linkify(m.text)}</div>
            ${long ? `<button type="button" class="mmore" data-more-msg="${m.id}">${open ? 'Less' : 'More'}</button>` : ''}
            ${rxKeys.length || this.rxOpen === m.id ? `<div class="rxs">${rxKeys.map(k => `<button type="button" class="rx${rx[k].includes(me.name) ? ' on' : ''}" data-rx="${m.id}" data-e="${esc(k)}" aria-label="${esc(k)} ${rx[k].length}">${esc(k)}<b>${rx[k].length}</b></button>`).join('')}${this.rxOpen === m.id ? EMOJI.filter(k => !rx[k]).map(k => `<button type="button" class="rx add" data-rx="${m.id}" data-e="${esc(k)}" aria-label="React ${esc(k)}">${esc(k)}</button>`).join('') : ''}</div>` : ''}
          </div></div>`;
        prev = m;
      }
      el.innerHTML = h; this.drawn = list[list.length - 1].t;
    },
    async send() {
      const ta = $('chatText'); const text = ta.value.trim(); if (!text || this.busy) return;
      this.busy = true; $('chatSend').disabled = true; $('chatSend').classList.add('busy'); buzz();
      try { const m = await Api.send(this.to, text); ta.value = ''; this.grow(); this.add(m, true); this.bottom(true); FX.burst($('chatSend'), 10, true); }
      catch (e) { HQ.toast('Not sent. Try again.', null); }
      finally { this.busy = false; $('chatSend').classList.remove('busy'); $('chatSend').disabled = !ta.value.trim(); }
    },
    grow() { const ta = $('chatText'); ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; },
  };
  $('chatSend').innerHTML = ico('send');
  $('composer').addEventListener('submit', e => { e.preventDefault(); Chat.send(); });
  $('chatText').addEventListener('input', () => { Chat.grow(); $('chatSend').disabled = !$('chatText').value.trim() || !!Chat.busy; });
  $('chatText').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); Chat.send(); } });
  $('chatNew').addEventListener('click', () => Chat.bottom(true));
  // typing on a phone: the dock steps aside and the box rides just above the keyboard
  const TOUCH = 'ontouchstart' in window;
  $('chatText').addEventListener('focus', () => { if (TOUCH) document.documentElement.classList.add('typing'); });
  $('chatText').addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== $('chatText')) document.documentElement.classList.remove('typing'); }, 220));
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const kb = () => { const k = Math.max(0, window.innerHeight - vv.height - vv.offsetTop); document.documentElement.style.setProperty('--kb', (k > 80 ? Math.round(k) : 0) + 'px'); };
    vv.addEventListener('resize', kb); vv.addEventListener('scroll', kb);
  }
  document.addEventListener('click', e => {
    const f = e.target.closest('[data-chat-filter]'); if (f) { Chat.filter = f.dataset.chatFilter; store.set('room-chat-filter', Chat.filter); Chat.drawn = 0; Chat.draw(); Chat.bottom(false); buzz(); return; }
    if (e.target.closest('[data-earlier]')) { Chat.older(); buzz(); return; }
    const to = e.target.closest('[data-to]'); if (to) { Chat.to = to.dataset.to; Chat.toChips(); $('chatText').focus(); buzz(); return; }
    const mm = e.target.closest('[data-more-msg]'); if (mm) { const id = +mm.dataset.moreMsg; Chat.open[id] = !Chat.open[id]; Chat.draw(); return; }
    const rx = e.target.closest('[data-rx]');
    if (rx) { const id = +rx.dataset.rx, k = rx.dataset.e; const on = !rx.classList.contains('on'); const cur = (Chat.rx[id] = Chat.rx[id] || {}); cur[k] = (cur[k] || []).filter(w => w !== me.name); if (on) cur[k].push(me.name); if (!cur[k].length) delete cur[k]; Chat.rxOpen = null; Chat.draw(); buzz(); if (on) FX.burst(document.querySelector(`[data-rx="${id}"][data-e="${CSS.escape(k)}"]`), 6, true); Api.react(id, k, on).catch(() => Chat.loadRx()); return; }
    const bub = e.target.closest('[data-bub]'); if (bub && !e.target.closest('a')) { const id = +bub.dataset.bub; Chat.rxOpen = Chat.rxOpen === id ? null : id; Chat.draw(); return; }
    const ai = e.target.closest('[data-chat-to]'); if (ai) { Chat.to = ai.dataset.chatTo; Chat.toChips(); HQ.setTab('chat'); setTimeout(() => $('chatText').focus(), 250); }
  });

  // =====================================================================================================
  // People: who is in the room, who wants in, sign-in codes, this device
  // =====================================================================================================
  const People = {
    team: [], members: [], requests: [], busy: {}, code: {}, add: false, err: '',
    async start() { await this.load(); window.addEventListener('room:tab', e => { if (e.detail.tab === 'people') this.load(); }); },
    async load() {
      try { this.team = await Api.team(); Chat.people = this.team; Chat.toChips(); } catch (e) { /* keep the last list */ }
      if (isAdmin()) { try { this.members = await Api.members(); this.requests = await Api.requests(); } catch (e) { /* ignore */ } }
      this.draw();
    },
    draw() {
      const el = $('peopleBody'); const th = store.get('room-theme') || 'auto';
      const row = (name, sub, right, extra) => `<div class="panel prow">${`<i class="av a${hash(name) % 8}" aria-hidden="true">${esc(name[0].toUpperCase())}</i>`}<span class="pn"><b>${esc(cap(name))}</b>${sub ? `<span>${sub}</span>` : ''}</span>${right || ''}${extra || ''}</div>`;
      const codeBox = em => { const c = this.code[em]; if (!c) return ''; if (c.wait) return `<div class="codebox wait"><div class="gspin"><i></i><i></i><i></i></div><span>Making a code…</span></div>`; if (c.fail) return `<div class="codebox bad">${ico('alert')}<span>The studio PC did not answer. Try again in a minute.</span></div>`;
        return `<div class="codebox"><b class="num">${esc(c.code)}</b><span>Works once · 1 hour</span><button type="button" class="btn small" data-p="copy" data-email="${esc(em)}">${ico('link')}Copy invite</button></div>`; };
      let h = `<section class="asec u-grey"><div class="shead"><h3>You</h3></div><div class="glist tight">
        ${row(me.name || '?', roleName(me.role), `<button type="button" class="btn small" data-p="signout">${ico('out')}Sign out</button>`)}
        <div class="panel pset"><span class="pk">${ico('sun')}Look</span><div class="seg" role="group" aria-label="Theme">${THEMES.map(t => `<button type="button" class="segb" data-theme-set="${t}" aria-pressed="${t === th}">${cap(t)}</button>`).join('')}</div></div>
        <div class="panel pset"><span class="pk">${ico('key')}Another device</span><button type="button" class="btn small" data-p="code" data-email="${esc(me.email)}"${this.busy.code ? ' disabled' : ''}>Get a code</button>${codeBox(me.email)}</div>
        <details class="det panel pinst"><summary class="deth">Put it on your phone${ico('chev')}</summary><div class="detb"><p class="dl"><b>iPhone:</b> Share, then Add to Home Screen.</p><p class="dl"><b>Android:</b> menu ⋮, then Add to Home screen.</p><p class="dl">Then sign in once inside the app with a code.</p></div></details>
      </div></section>`;
      if (isAdmin() && this.requests.length) h += `<section class="asec u-amber"><div class="shead"><h3>Wants in</h3><span class="cnt num">${this.requests.length}</span></div><div class="glist tight">
        ${this.requests.map(r => `<div class="panel prow"><i class="av a${hash(r.wanted_name) % 8}">${esc((r.wanted_name || '?')[0].toUpperCase())}</i><span class="pn"><b>${esc(cap(r.wanted_name || 'Someone'))}</b><span>${esc(r.email)}</span></span>
          <button type="button" class="btn small primary" data-p="letin" data-email="${esc(r.email)}" data-name="${esc(r.wanted_name || '')}"${this.busy[r.email] ? ' disabled' : ''}>${ico('yes')}Let in</button><button type="button" class="btn small" data-p="deny" data-email="${esc(r.email)}"${this.busy[r.email] ? ' disabled' : ''}>No</button></div>`).join('')}</div></section>`;
      const humans = (isAdmin() && this.members.length ? this.members : this.team);
      h += `<section class="asec u-green"><div class="shead"><h3>In the room</h3><span class="cnt num">${humans.length}</span></div><div class="glist tight">
        ${humans.map(m => { const self = m.name === me.name; const k = 'm:' + (m.email || m.name);
          const mine = isOwner() || (m.role !== 'owner' && !OWNERS.includes(m.name)); const canCode = isOwner() ? m.role !== 'owner' : (m.role === 'member' && !OWNERS.includes(m.name));
          return isAdmin() && m.email && !self && mine ? `<details class="panel prow pfold" data-fold-p="${esc(k)}"${this.code[m.email] ? ' open' : ''}><summary><i class="av a${hash(m.name) % 8}">${esc(m.name[0].toUpperCase())}</i><span class="pn"><b>${esc(cap(m.name))}</b><span>${roleName(m.role)}</span></span>${ico('chev')}</summary>
            <div class="pacts">${canCode ? `<button type="button" class="btn small" data-p="code" data-email="${esc(m.email)}">${ico('key')}Sign-in code</button>` : ''}${m.role === 'owner' ? '' : `<button type="button" class="btn small" data-p="role" data-email="${esc(m.email)}" data-role="${m.role === 'admin' ? 'member' : 'admin'}">${m.role === 'admin' ? 'Make member' : 'Make admin'}</button>`}<button type="button" class="btn small no" data-p="remove" data-email="${esc(m.email)}" data-name="${esc(m.name)}">Remove</button>${codeBox(m.email)}</div></details>`
            : row(m.name, roleName(m.role), self ? '<span class="chip">You</span>' : ''); }).join('')}
        ${isAdmin() ? (this.add ? `<div class="panel padd"><label for="pName">First name</label><input id="pName" type="text" maxlength="24" autocomplete="off" placeholder="nicol"><label for="pEmail">Email</label><input id="pEmail" type="email" inputmode="email" autocapitalize="off" autocomplete="off" placeholder="name@example.com">
          ${this.err ? `<p class="err" role="alert">${esc(this.err)}</p>` : ''}<div class="row"><button type="button" class="btn" data-p="add-cancel">Cancel</button><button type="button" class="btn primary" data-p="add-save"${this.busy.add ? ' disabled' : ''}>${ico('yes')}Add</button></div></div>`
          : `<button type="button" class="btn wide" data-p="add">${ico('plus')}Add a person</button>`) : ''}
      </div></section>`;
      h += `<section class="asec u-grey"><div class="shead"><h3>AI teammates</h3><span class="cnt num">${AI.length}</span></div><div class="glist tight">
        ${AI.map(a => row(a[0], esc(a[1]), `<button type="button" class="btn small" data-chat-to="${esc(a[0])}">${ico('reply')}Message</button>`)).join('')}</div></section>`;
      const keepOpen = [...el.querySelectorAll('details[open][data-fold-p]')].map(d => d.dataset.foldP); const inst = el.querySelector('.pinst[open]');
      const f = document.activeElement && document.activeElement.id; const fv = f && $(f) ? $(f).value : null; const vals = {}; ['pName', 'pEmail'].forEach(i => { if ($(i)) vals[i] = $(i).value; });
      el.innerHTML = h;
      keepOpen.forEach(k => { const d = el.querySelector(`[data-fold-p="${CSS.escape(k)}"]`); if (d) d.open = true; }); if (inst) el.querySelector('.pinst').open = true;
      Object.keys(vals).forEach(i => { if ($(i)) $(i).value = vals[i]; }); if (f && $(f)) { $(f).focus(); if (fv != null) $(f).value = fv; }
    },
    async getCode(email) {
      this.code[email] = { wait: true }; this.draw();
      let r = null; try { r = await Api.askCode(email); } catch (e) { r = null; }
      this.code[email] = r && r.code ? { code: r.code } : { fail: true }; this.draw();
    },
    invite(email) { const c = this.code[email]; return `${BRAND}: open ${location.origin + location.pathname} , tap "I have a code", type your email (${email}) and this code: ${c ? c.code : ''} (works once, 1 hour).`; },
  };
  document.addEventListener('click', async e => {
    const ts = e.target.closest('[data-theme-set]'); if (ts) { store.set('room-theme', ts.dataset.themeSet); applyTheme(ts.dataset.themeSet); People.draw(); buzz(); return; }
    const b = e.target.closest('[data-p]'); if (!b || b.disabled) return;
    const act = b.dataset.p, email = b.dataset.email; buzz();
    try {
      if (act === 'signout') { store.del(CACHE); if (sb) await sb.auth.signOut(); location.reload(); }
      else if (act === 'code') await People.getCode(email);
      else if (act === 'copy') { const t = People.invite(email); try { if (navigator.share && 'ontouchstart' in window) await navigator.share({ text: t }); else { await navigator.clipboard.writeText(t); HQ.toast('Invite copied.', null); } } catch (x) { /* closed the sheet */ } }
      else if (act === 'add') { People.add = true; People.err = ''; People.draw(); const n = $('pName'); if (n) n.focus(); }
      else if (act === 'add-cancel') { People.add = false; People.draw(); }
      else if (act === 'add-save') {
        const name = ($('pName').value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''); const em = ($('pEmail').value || '').trim().toLowerCase();
        if (!name || !emailOk(em)) { People.err = 'A first name and an email, please.'; People.draw(); return; }
        if ((People.members || []).some(m => String(m.name).toLowerCase() === name) || AI.some(a => a[0] === name) || ['room', 'all', 'dot', 'pip'].includes(name)) { People.err = 'That name is taken. Pick another.'; People.draw(); return; }
        if (OWNERS.includes(name) && !isOwner()) { People.err = 'Only an owner can add ' + cap(name) + '.'; People.draw(); return; }   // this name can answer asks
        People.busy.add = true; People.draw();
        try { await Api.addMember({ email: em, name, team: teamFor(name), role: 'member' }); People.add = false; HQ.toast(cap(name) + ' is in. Making a code.', null); People.busy.add = false; await People.load(); People.getCode(em); return; }
        catch (x) { People.err = /duplicate/i.test(x.message) ? 'That email is already in.' : 'Not saved. Try again.'; }
        People.busy.add = false; await People.load();
      }
      else if (act === 'letin') {
        let name = (b.dataset.name || email.split('@')[0]).toLowerCase().replace(/[^a-z0-9]/g, '') || 'guest';
        const taken = x => (People.members || []).some(m => String(m.name).toLowerCase() === x) || AI.some(a => a[0] === x) || ['room', 'all', 'dot', 'pip'].includes(x);
        if (OWNERS.includes(name) && !taken(name) && !isOwner()) { HQ.toast('Only an owner can let ' + cap(name) + ' in.', null); return; }
        if (OWNERS.includes(name) && !taken(name) && b.dataset.sure !== '1') { b.dataset.sure = '1'; b.innerHTML = 'Really ' + esc(cap(name)) + '? Tap again'; return; }   // this name can answer asks
        if (taken(name)) { let i = 2; while (taken(name + i)) i++; name += i; }
        People.busy[email] = true; People.draw();
        await Api.addMember({ email, name, team: teamFor(name), role: 'member' }); await Api.dropRequest(email); delete People.busy[email]; FX.burst(b, 18); HQ.toast(cap(name) + ' is in. Making a code.', null); await People.load(); People.getCode(email);
      }
      else if (act === 'deny') { People.busy[email] = true; People.draw(); await Api.dropRequest(email); delete People.busy[email]; await People.load(); }
      else if (act === 'role') { await Api.setRole(email, b.dataset.role); await People.load(); }
      else if (act === 'remove') { if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Tap again to remove'; return; } await Api.removeMember(email); HQ.toast(cap(b.dataset.name) + ' removed.', null); await People.load(); }
    } catch (x) { delete People.busy[email]; HQ.toast('That did not save. Try again.', null); People.draw(); }
  });

  // =====================================================================================================
  // Motion: tab ink, view entrances, count-ups, bursts. All of it stands still under reduced motion.
  // =====================================================================================================
  const MORE = ['team', 'menu', 'people'];
  const FX = {
    cv: $('fx'), ctx: null, parts: [], raf: 0,
    ink(tab) {
      const sub = MORE.includes(tab); const btn = sub ? $('t-more') : $('t-' + tab); const ink = $('tabInk'); if (!btn || !ink) return;
      const r = btn.getBoundingClientRect(), p = btn.parentElement.getBoundingClientRect(); if (!r.width) return;
      ink.style.width = r.width + 'px'; ink.style.transform = `translateX(${r.left - p.left}px)`; ink.classList.add('on');
      $('t-more').classList.toggle('on', sub); $('t-more').setAttribute('aria-expanded', String(!$('subtabs').hidden));
    },
    afterTab(tab, first) {
      const sub = MORE.includes(tab); $('subtabs').hidden = !sub; this.ink(tab);
      document.documentElement.classList.toggle('chat-on', tab === 'chat');
      const v = $('v-' + tab);
      if (v && !reduced()) { v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter'); clearTimeout(this.et); this.et = setTimeout(() => v.classList.remove('enter'), 900); this.count(v); }
      if (tab === 'chat') { Chat.badge(); Chat.bottom(false); }
      if (first) window.addEventListener('resize', debounce(() => this.ink(HQ.S.tab), 100));
    },
    count(root) {
      root.querySelectorAll('.tiles b.num, .dtg b.num').forEach(el => {
        const node = el.firstChild; if (!node || node.nodeType !== 3) return; const to = parseInt(node.nodeValue, 10); if (!isFinite(to) || to < 2 || to > 9999) return;
        const t0 = performance.now(), dur = 520; const step = now => { if (!node.isConnected) return; const k = Math.min(1, (now - t0) / dur); node.nodeValue = String(Math.round(to * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(step); };
        node.nodeValue = '0'; requestAnimationFrame(step);
      });
    },
    size() { const c = this.cv, d = Math.min(2, window.devicePixelRatio || 1); c.width = innerWidth * d; c.height = innerHeight * d; this.ctx = c.getContext('2d'); this.ctx.setTransform(d, 0, 0, d, 0, 0); },
    burst(el, n, small) {
      if (reduced() || !el || !el.getBoundingClientRect) return; const r = el.getBoundingClientRect(); if (!r.width) return;
      if (!this.ctx || this.cv.width !== Math.round(innerWidth * Math.min(2, window.devicePixelRatio || 1))) this.size();
      const cs = getComputedStyle(document.documentElement); const cols = ['--accent', '--accent-2', '--done', '--ink'].map(v => cs.getPropertyValue(v).trim() || '#fff');
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      for (let i = 0; i < (n || 22); i++) { const a = Math.random() * Math.PI * 2, s = (small ? 2 : 4) + Math.random() * (small ? 4 : 9); this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - (small ? 1.5 : 3.5), g: .28, life: 1, d: .016 + Math.random() * .02, c: cols[i % cols.length], w: 3 + Math.random() * (small ? 3 : 6), r: Math.random() * 6, vr: (Math.random() - .5) * .5, sq: Math.random() < .6 }); }
      if (!small) this.parts.push({ ring: true, x, y, life: 1, d: .045, c: cols[0], w: Math.max(r.width, r.height) / 2 });
      if (!this.raf) this.raf = requestAnimationFrame(() => this.tick());
    },
    tick() {
      const c = this.ctx; c.clearRect(0, 0, innerWidth, innerHeight);
      this.parts = this.parts.filter(p => p.life > 0);
      for (const p of this.parts) {
        c.globalAlpha = Math.max(0, p.life);
        if (p.ring) { c.strokeStyle = p.c; c.lineWidth = 2.5 * p.life; c.beginPath(); c.arc(p.x, p.y, p.w + (1 - p.life) * 70, 0, 7); c.stroke(); p.life -= p.d; continue; }
        p.vy += p.g; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life -= p.d;
        c.fillStyle = p.c; c.save(); c.translate(p.x, p.y); c.rotate(p.r);
        if (p.sq) c.fillRect(-p.w / 2, -p.w / 2, p.w, p.w * .6); else { c.beginPath(); c.arc(0, 0, p.w / 2, 0, 7); c.fill(); }
        c.restore();
      }
      c.globalAlpha = 1;
      if (this.parts.length) this.raf = requestAnimationFrame(() => this.tick()); else { this.raf = 0; c.clearRect(0, 0, innerWidth, innerHeight); }
    },
  };
  window.addEventListener('room:tab', e => { FX.afterTab(e.detail.tab); if (e.detail.tab !== 'chat') Chat.badge(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) Chat.badge(); });
  $('t-more').addEventListener('click', () => { buzz(); const s = $('subtabs'); if (MORE.includes(HQ.S.tab)) return; s.hidden = !s.hidden; $('t-more').setAttribute('aria-expanded', String(!s.hidden)); if (!s.hidden) HQ.setTab(store.get('room-more') || 'team'); });
  window.addEventListener('room:tab', e => { if (MORE.includes(e.detail.tab)) store.set('room-more', e.detail.tab); });
  // a yes or a done goes off with a bang; every button gives a tick under the thumb
  document.addEventListener('click', e => {
    const b = e.target.closest('button, a.btn'); if (!b || b.disabled) return;
    const act = b.dataset && b.dataset.act;
    if (act === 'yes' || act === 'done' || act === 'opt' || act === 'reply-send') { buzz(18); FX.burst(b, act === 'reply-send' ? 12 : 26); }
    else if (b.dataset && (b.dataset.tab || b.dataset.act)) buzz();
  }, true);

  // =====================================================================================================
  // Boot
  // =====================================================================================================
  async function boot() {
    gateDraw();
    if (DEMO) { me.name = Q.get('as') || 'joel'; me.team = 'okasan'; me.role = Q.get('role') || 'admin'; me.email = 'joel@example.com'; if (Q.get('demo') === 'gate') { G.step = Q.get('step') || 'email'; gateDraw(); return; } entered = true; openRoom(); return; }
    if (!sb) { G.step = 'down'; gateDraw(); return; }
    // a link that came back refused or too old says so in the address
    const hp = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (hp.get('error') || hp.get('error_code')) { G.err = authWords(hp.get('error_description') || hp.get('error_code')); try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ } }
    sb.auth.onAuthStateChange((ev, session) => {
      if (ev === 'SIGNED_IN' && session && !entered) setTimeout(enter, 0);
      if (ev === 'SIGNED_OUT' && entered) location.reload();
    });
    try {
      const { data } = await sb.auth.getSession();
      if (data && data.session) { if (/access_token=/.test(location.hash)) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ } } await enter(); }
      else { G.step = 'email'; gateDraw(); }
    } catch (e) { G.step = 'down'; gateDraw(); }
  }
  if ('serviceWorker' in navigator && !LOCAL) { window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); }); }
  window.ROOM = { me, Chat, People, Live, FX, D };
  boot();
})();
