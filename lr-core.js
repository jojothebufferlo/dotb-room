/* Launch room: the shared renderer for both homes (the engine page and the meeting-room tab).
   window.LaunchRoom.mount(root, opts) returns { set(ops), tick() }.
   opts: { partner: bool (the room copy: no sources, no units), staleAfterMin: number, sourceNote: string,
           exampleNote: string|'' (shown when the data is a fixture) }
   Reads the spec's ops shape (data/launch/LAUNCH-ROOM-SPEC.md). Never writes, never calls a model. */
(function () {
  'use strict';
  const TZ = 'Asia/Singapore', DAY = 864e5, HOUR = 36e5, MIN = 6e4;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;
  // a bare date means the end of that day in Singapore; a time with no zone is Singapore time
  const t = s => { if (!s) return null; s = String(s);
    if (!/\d{4}/.test(s)) return null; // a year-less label ("8 Nov") is never turned into a date or a weekday
    if (/^\d{4}-\d\d-\d\d$/.test(s)) s += 'T23:59:00+08:00'; else if (/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?$/.test(s)) s += '+08:00';
    const v = Date.parse(s); return isNaN(v) ? null : v; };
  const fmtN = v => num(v) == null ? '–' : v.toLocaleString('en-GB');

  // ---- icons (stroke = currentColor), one per state and kind
  const P = {
    done: '<path d="M4 8.5l2.6 2.6L12 5.6"/>',
    doing: '<circle cx="8" cy="8" r="5"/><path d="M8 3a5 5 0 0 1 0 10z" fill="currentColor" stroke="none"/>',
    waiting: '<circle cx="8" cy="8" r="5.2"/><path d="M8 5v3.2l2 1.3"/>',
    blocked: '<circle cx="8" cy="8" r="5.2"/><path d="M5 8h6"/>',
    failed: '<path d="M4.8 4.8l6.4 6.4M11.2 4.8l-6.4 6.4"/>',
    todo: '<circle cx="8" cy="8" r="2" fill="currentColor" stroke="none"/>',
    press: '<path d="M8 2.5l1.6 3.4 3.7.4-2.8 2.5.8 3.7L8 10.6l-3.3 1.9.8-3.7L2.7 6.3l3.7-.4z"/>',
    deadline: '<path d="M4 13.5V2.5M4 3h7.5l-1.6 2.6L11.5 8H4"/>',
    check: '<rect x="3" y="2.5" width="10" height="11" rx="1.5"/><path d="M5.5 8.2l1.7 1.7 3.3-3.4"/>',
    post: '<rect x="3" y="2.5" width="10" height="11" rx="2"/><path d="M6.8 6v4l3.2-2z" fill="currentColor"/>',
    run: '<path d="M13 8a5 5 0 1 1-1.5-3.6"/><path d="M13 2.5V5h-2.5"/>',
    chev: '<path d="M4 6l4 4 4-4"/>',
    alert: '<path d="M8 2.5l6 10.5H2z"/><path d="M8 6.5v3M8 11.2v.3"/>',
    lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7"/>',
    unlock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 4.9-.7"/>',
    held: '<rect x="3" y="3" width="10" height="10" rx="2"/><path d="M6.5 6v4M9.5 6v4"/>',
    off: '<path d="M8 2.5v5"/><path d="M4.6 4.6a5 5 0 1 0 6.8 0"/>',
    person: '<circle cx="8" cy="5.5" r="2.5"/><path d="M3.5 13.5c.6-2.6 2.3-4 4.5-4s3.9 1.4 4.5 4"/>',
    up: '<path d="M4 10l4-4 4 4"/>', down: '<path d="M4 6l4 4 4-4"/>',
  };
  const ico = (k, label) => `<span class="lr-ico"${label ? ` role="img" aria-label="${esc(label)}"` : ' aria-hidden="true"'}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[k] || P.todo}</svg></span>`;
  const STATE = { done: 'Done', doing: 'Doing', waiting: 'Waiting', blocked: 'Blocked', failed: 'Failed', todo: 'To do' };
  const stOf = s => STATE[s] ? s : 'todo';
  const badge = s => { s = stOf(s); return `<span class="lr-badge s-${s}">${ico(s)}${STATE[s]}</span>`; };
  const SHORT = { build: 'Build', build_review: 'Review', store_claims: 'Store', date_on_page: 'Date', discount: 'Discount', human_play: 'Play', go_no_go: 'Go/no-go', release: 'Release', first_72h: '72 h' };
  const LABEL = { build: 'Launch build', build_review: "Valve's build review", store_claims: 'Store page true to the build', date_on_page: 'Date on the page', discount: 'Launch discount',
    human_play: 'Second-PC play', go_no_go: 'Go or no-go', release: 'Release', first_72h: 'First 72 hours' };
  const KEYS = Object.keys(SHORT);
  const KIND = { press: 'Press', deadline: 'Deadline', check: 'Check', post: 'Reel post', run: 'Runs' };
  const GKIND = { line: 'a written line', press: 'a press in Steamworks', check: 'a check', decision: 'a decision', owner: "the owner's word" };
  const WKIND = { person: 'Person', session: 'Session', helper: 'Helper', scheduled: 'Runs by itself', valve: 'Valve' };

  // ---- time, always Singapore time with the weekday
  const partsF = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  function parts(ms) { const o = {}; partsF.formatToParts(new Date(ms)).forEach(p => { o[p.type] = p.value; }); return o; }
  const dayKey = ms => { const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)); return p; };
  function when(iso, opt) {
    const ms = t(iso); if (ms == null) return '';
    const p = parts(ms); const d = `${p.weekday} ${p.day} ${p.month}`; const hm = `${p.hour}:${p.minute}`;
    if (opt === 'day') return d; if (opt === 'time') return hm;
    if (hm === '00:00') return d; // a day-only date never shows an hour
    return hm === '23:59' ? `${d}, end of day` : `${d}, ${hm}`;
  }
  // a start date: a bare date shows its day only; a year-less label is shown as written
  function dayOrLabel(v) {
    if (v == null || v === '') return '';
    const s = String(v).trim();
    if (/^\d{4}-\d\d-\d\d$/.test(s)) return when(s, 'day');
    return t(s) != null ? when(s) : s;
  }
  function span(ms) {
    ms = Math.abs(ms);
    if (ms < MIN) return 'under a minute';
    if (ms < HOUR) return `${Math.round(ms / MIN)} min`;
    if (ms < 2 * DAY) { const h = Math.floor(ms / HOUR), m = Math.round((ms % HOUR) / MIN); return m && h < 10 ? `${h} h ${m} min` : `${Math.round(ms / HOUR)} h`; }
    return `${Math.round(ms / DAY)} days`;
  }
  const ago = (iso, now) => { const ms = t(iso); return ms == null ? 'not read' : `${span(now - ms)} ago`; };
  const until = (iso, now) => { const ms = t(iso); if (ms == null) return ''; const d = ms - now; return Math.abs(d) < MIN ? 'now' : d > 0 ? `in ${span(d)}` : `${span(d)} ago`; };

  // ---- data helpers
  const lateOf = (o, now) => o.state === 'late' || (o.state === 'open' && t(o.due) != null && t(o.due) < now);
  const isOpen = o => o.state === 'open' || o.state === 'late';
  function nameOf(ops, id) { if (!id || id === 'all') return 'All games'; const l = (ops.launches || []).find(x => x.id === id); return l ? l.name : id; }
  // a line cut at a sentence end: whole sentences up to max characters (always at least the first whole sentence)
  function sentences(s, max) {
    s = String(s || '').trim(); if (s.length <= max) return { text: s, cut: false };
    const xs = s.match(/[^.!?]+(?:[.!?]+["')\]]*|$)\s*/g) || [s];
    let out = '';
    for (const x of xs) { if (out && (out + x).trim().length > max) break; out += x; }
    out = out.trim(); return { text: out, cut: out.length < s.length };
  }
  // the launch's own day vs Singapore time: two lines only when the labels name different days
  const dayPart = s => String(s || '').split(',')[0].trim();
  function launchWhen(l) {
    const own = l.day_label, sg = l.sgt_label;
    if (own && sg && dayPart(own) !== dayPart(sg)) return { two: true, own, here: String(sg).replace(/\s*Singapore time\s*$/i, '') };
    return { two: false };
  }
  // the launch's own calendar day as a Singapore-style day key, from "Thu 19 Nov, 10:00 Pacific"
  const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  function ownDayKey(l) {
    const w = launchWhen(l); if (!w.two) return null;
    const m = /(\d{1,2})\s+([A-Z][a-z]{2})/.exec(w.own); const ms = t(l.at); if (!m || !MON[m[2]] || ms == null) return null;
    let y = Number(dayKey(ms).slice(0, 4)); if (MON[m[2]] === 12 && dayKey(ms).slice(5, 7) === '01') y -= 1;
    return `${y}-${String(MON[m[2]]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }
  // the stage line without its own "Step 6 of 9: ..." opening, which the bold stage header already says
  const stepRest = s => String(s || '').replace(/^\s*Step\s+\d+\s+of\s+\d+[:,][^.]*\.\s*/i, '').trim();
  const blockedOf = l => !!(l && l.blocker && l.blocker.state === 'blocking');
  // where the launch is on the nine-step line: the data's own stage, or the first stop not done
  function stageOf(l, pipe) {
    const s = l.stage;
    if (s && num(s.n) != null) return { n: s.n, of: num(s.of) || 9, label: s.label || (LABEL[KEYS[s.n - 1]] || ''), line: s.line || '', given: true };
    const i = pipe.findIndex(p => p.state !== 'done');
    if (i < 0) return { n: pipe.length, of: pipe.length, label: 'Every stop done', line: '', given: false };
    return { n: i + 1, of: pipe.length, label: LABEL[pipe[i].key] || pipe[i].label || '', line: '', given: false };
  }
  // working time left, in plain words
  // the Valve hours line only when the blocker waits on Valve (the data's valve flag, else who names Valve)
  const waitsOnValve = b => b.valve === true || (b.valve == null && /valve/i.test(String(b.who || '')));
  const overdueOf = (b, now) => b.overdue === true || (t(b.must_clear_by) != null && t(b.must_clear_by) < now);
  function workLeft(b, now) {
    const h = waitsOnValve(b) ? num(b.hours_left_valve) : null;
    if (h != null) {
      if (h <= 0) return 'Valve has 0 working hours before the planned release';
      if (h < 16) return `Valve has ${Math.round(h)} working ${Math.round(h) === 1 ? 'hour' : 'hours'} before the planned release`;
      const d = Math.round(h / 8); return `Valve has about ${d} working days (${Math.round(h)} working hours) before the planned release`;
    }
    const ms = t(b.must_clear_by); if (ms == null) return '';
    return ms <= now ? `The time to clear it passed ${span(now - ms)} ago` : `${span(ms - now)} left`;
  }
  const initials = s => String(s || '?').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

  function mount(root, opts) {
    opts = opts || {};
    const staleMin = opts.staleAfterMin || 150;
    let ops = null, sig = '', openSet = new Set(), pick = null, firstDraw = true;
    root.classList.add('lr');

    function set(next) {
      const s = JSON.stringify(next || {});
      if (s === sig) { tick(); return; }
      sig = s; ops = next || {};
      if (firstDraw) {
        firstDraw = false;
        // desktop: the two soonest launches start open; phones start with every card closed
        if (window.matchMedia && window.matchMedia('(min-width: 1000px)').matches) (ops.launches || []).slice().sort(byAt).slice(0, 2).forEach(l => openSet.add(l.id));
      }
      draw();
    }
    const byAt = (a, b) => (t(a.at) || 0) - (t(b.at) || 0);

    function draw() {
      const now = Date.now();
      const L = (ops.launches || []).slice().sort(byAt);
      const orders = ops.orders || [];
      const ordersById = Object.fromEntries(orders.map(o => [o.id, o]));
      root.innerHTML = [head(now), timeline(L, now), cards(L, ordersById, now), workers(orders, now), schedule(now), heldGates(), how(), foot()].join('');
      if (pick) showPick(pick, false);
    }

    // ------------------------------------------------------------ 1. header
    function head(now) {
      const g = t(ops.generated_at), old = g == null ? Infinity : now - g, stale = old > staleMin * MIN;
      const T = ops.totals || {};
      const ne = ops.next_event || {};
      const cnt = (cls, k, v, l, go, icon) => { const n = num(v); return `<button type="button" class="lr-box lr-count ${cls}${n ? '' : ' zero'}" data-go="${go}"><span class="k">${esc(k)}</span><span class="v">${icon}<span class="lr-num">${n == null ? '–' : n}</span></span><span class="l">${esc(l)}</span></button>`; };
      return `<header class="lr-head">
        <div class="lr-titlerow"><h1 class="lr-title">Launch room</h1>
          <span class="lr-age${stale ? ' stale' : ''}" data-age><i></i><span data-agetext>${ageText(now)}</span></span></div>
        ${opts.exampleNote ? `<p class="lr-banner info">${ico('alert')}<span>${esc(opts.exampleNote)}</span></p>` : ''}
        ${stale && g != null ? `<p class="lr-banner warn" data-stalebanner>${ico('alert')}<span>This page is <b>${esc(span(old))}</b> old, so treat every line as last known, not current. It was last filled on ${esc(when(ops.generated_at))} Singapore time.</span></p>` : ''}
        <div class="lr-glance">
          <div class="lr-box lr-next"><span class="k">Next</span>
            ${t(ne.at) != null ? `<span class="v" data-until="${esc(ne.at)}">${esc(until(ne.at, now))}</span><span class="l">${esc(fullText(ne.text || ne.label_full || ne.label || ''))}${ne.game && ne.game !== 'all' ? ` · <b>${esc(nameOf(ops, ne.game))}</b>` : ''}</span><span class="w">${esc(when(ne.at))} Singapore time</span>`
              : `<span class="v">Nothing timed</span><span class="w">No timed event in the data.</span>`}
          </div>
          ${cnt('c-block', 'Blocked', num(T.blocked) != null ? T.blocked : (ops.launches || []).filter(blockedOf).length, (num(T.blocked) != null ? T.blocked : (ops.launches || []).filter(blockedOf).length) === 1 ? 'launch blocked' : 'launches blocked', 'blocked', ico('blocked'))}
          ${cnt('c-fail', 'Failing', T.failing, 'checks failing', 'fail', ico('failed'))}
          ${cnt('c-doing', 'In progress', T.open_orders, 'open orders', 'work', ico('doing'))}
          ${cnt('c-joel', 'Joel', T.waiting_on_joel, 'waiting on Joel', 'joel', ico('person'))}
        </div>
      </header>`;
    }
    // a label the build cut short ("…") is matched back to the whole sentence it came from, when the data has it
    function fullText(s) {
      s = String(s || ''); const m = /^(.*?)\s*(…|\.\.\.)$/.exec(s); if (!m || m[1].length < 12) return s;
      const pre = m[1];
      const pool = [];
      (ops.orders || []).forEach(o => pool.push(o.what, o.last_note));
      (ops.launches || []).forEach(l => { (l.pipeline || []).forEach(p => pool.push(p.line)); (l.fails || []).forEach(f => pool.push(f)); (l.waiting_on_joel || []).forEach(w => pool.push(w.line)); });
      (ops.schedule || []).forEach(x => pool.push(x.label));
      const hit = pool.filter(x => typeof x === 'string' && x.length > pre.length && x.indexOf(pre) === 0 && !/(…|\.\.\.)$/.test(x)).sort((a, b) => a.length - b.length)[0];
      return hit || s;
    }
    function ageText(now) {
      const g = t(ops.generated_at);
      if (g == null) return 'Not filled in yet';
      const old = now - g;
      return old > staleMin * MIN ? `Stale (${span(old)} old)` : `Updated ${span(old)} ago · ${when(ops.generated_at, 'time')}`;
    }

    // ------------------------------------------------------------ 2. timeline
    function timeline(L, now) {
      const start = t(dayKey(now) + 'T00:00:00+08:00');
      const sched = (ops.schedule || []).filter(s => t(s.at) != null);
      const days = [];
      for (let i = 0; i < 14; i++) {
        const ms = start + i * DAY, k = dayKey(ms), p = parts(ms);
        // a launch sits on its own day (day_label) when that differs from the Singapore day
        const ls = L.filter(l => t(l.at) != null && (ownDayKey(l) || dayKey(t(l.at))) === k);
        const sgLs = L.filter(l => t(l.at) != null && dayKey(t(l.at)) === k);
        // small markers: one chip per kind per day, with a count; a release press on a launch day is the launch marker itself
        const ss = sched.filter(s => dayKey(t(s.at)) === k && t(s.at) >= now - HOUR && !(s.kind === 'press' && /release/i.test(s.label) && ls.concat(sgLs).some(l => l.id === s.game) && !/go or no-go/i.test(s.label)));
        const groups = ['press', 'deadline', 'check', 'post', 'run'].map(kind => [kind, ss.filter(s => (s.kind || 'run') === kind)]).filter(g => g[1].length);
        days.push(`<div class="lr-day${i === 0 ? ' today' : ''}${p.weekday === 'Sat' || p.weekday === 'Sun' ? ' wkend' : ''}" role="group" aria-label="${esc(p.weekday + ' ' + p.day + ' ' + p.month)}">
          <div class="lr-dh"><small>${i === 0 ? 'Today' : esc(p.weekday)}</small><b>${esc(p.day)}</b></div>
          <div class="lr-launches">${ls.map(l => { const risk = (l.fails || []).length || (l.pipeline || []).some(s => s.state === 'failed' || s.state === 'blocked');
            const w = launchWhen(l), blk = blockedOf(l);
            const own = w.two ? (w.own.split(',').slice(1).join(',').trim() || w.own) : '';
            const here = w.two ? w.here.replace(/^(\w{3})\s+\d{1,2}\s+\w{3},\s*/, '$1 ') : '';
            return `<button type="button" class="lr-lm${blk ? ' blk' : risk ? ' risk' : ''}" data-jump="${esc(l.id)}" aria-label="${esc(l.name)} launches ${w.two ? esc(w.own + ', which is ' + w.here + ' Singapore time') : esc(when(l.at)) + ' Singapore time'}${blk ? ', blocked' : ''}${risk ? ', has failing checks' : ''}">${blk ? `<span class="lr-blkw">${ico('blocked')}</span>` : ''}${esc(l.name)}${w.two ? `<small class="lr-own">${esc(own)}${risk ? ' !' : ''}</small><small class="lr-here">here ${esc(here)}</small>` : `<small>${esc(when(l.at, 'time'))}${risk ? ' !' : ''}</small>`}</button>`; }).join('')}</div>
          <div class="lr-smalls">${groups.map(([kind, xs]) => { const key = i + '|' + kind;
            return `<button type="button" class="lr-sm k-${kind}" data-pick="${key}" aria-pressed="${pick === key ? 'true' : 'false'}" aria-label="${esc(p.weekday + ' ' + p.day + ': ' + xs.length + ' ' + (KIND[kind] || 'event').toLowerCase() + (xs.length === 1 ? '' : 's'))}">${ico(kind)}${xs.length > 1 ? `<span class="c">${xs.length}</span>` : ''}</button>`; }).join('')}</div>
        </div>`);
      }
      const end = start + 14 * DAY;
      const later = L.filter(l => t(l.at) >= end);
      return `<section class="lr-sec" id="lr-timeline" aria-labelledby="lr-tlh">
        <div class="lr-sechead"><h2 id="lr-tlh">Next 14 days</h2><p>Tap a launch to open its card. Tap a small square to read what is due.</p></div>
        <div class="lr-box lr-tlbox">
          <div class="lr-tl">${days.join('')}</div>
          <div class="lr-legend" aria-label="What the squares mean"><span><i class="sw"></i>Launch</span><span><i class="sw risk"></i>Launch with a failing check</span><span><i class="sw blk"></i>Blocked launch</span>
            ${['press', 'check', 'deadline', 'post', 'run'].map(k => `<span class="k-${k}">${ico(k)}${KIND[k]}</span>`).join('')}<span class="lr-legn"><b>2</b>how many that day</span></div>
          <p class="lr-tlpick" data-pickbox hidden></p>
          ${later.length ? `<div class="lr-later"><span>Later:</span>${later.map(l => { const w = launchWhen(l); return `<button type="button" data-jump="${esc(l.id)}">${esc(l.name)} · ${esc(w.two ? dayPart(w.own) : when(l.at, 'day'))}</button>`; }).join('')}</div>` : ''}
        </div></section>`;
    }
    function showPick(key, scroll) {
      const box = root.querySelector('[data-pickbox]'); if (!box) return;
      const [di, kind] = String(key || '').split('|'); const now = Date.now();
      const start = t(dayKey(now) + 'T00:00:00+08:00'), k = di === undefined || di === '' ? null : dayKey(start + Number(di) * DAY);
      const xs = k ? (ops.schedule || []).filter(s => t(s.at) != null && t(s.at) >= now - HOUR && dayKey(t(s.at)) === k && (s.kind || 'run') === kind).sort((a, b) => t(a.at) - t(b.at)) : [];
      root.querySelectorAll('.lr-sm').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pick === key && xs.length > 0)));
      if (!xs.length) { box.hidden = true; pick = null; return; }
      box.hidden = false;
      const MAX = 6;
      box.innerHTML = `<span class="lr-pickhead"><span class="lr-pill k-${esc(kind)}" style="color:var(--k)">${ico(kind)}${esc(KIND[kind] || 'Event')}${xs.length > 1 ? 's' : ''}</span><b>${esc(when(xs[0].at, 'day'))}</b><span class="lr-muted">${xs.length} in all</span><span class="sp"></span><button type="button" class="lr-btn" data-pickclose aria-label="Close this list">Close</button></span>
        <ul class="lr-picklist">${xs.slice(0, MAX).map(s => { const g = s.game && s.game !== 'all' && (ops.launches || []).some(l => l.id === s.game);
          return `<li><time>${esc(when(s.at, 'time'))}</time><span>${esc(s.label)}<small>${esc(s.who || 'Nobody assigned')}${s.game && s.game !== 'all' ? ' · ' + esc(nameOf(ops, s.game)) : ''}</small></span>${g ? `<button type="button" class="lr-btn" data-jump="${esc(s.game)}" aria-label="Open ${esc(nameOf(ops, s.game))}">Open</button>` : '<span></span>'}</li>`; }).join('')}</ul>
        ${xs.length > MAX ? `<button type="button" class="lr-btn" data-goto="lr-sched">${xs.length - MAX} more in the schedule below</button>` : ''}`;
      if (scroll) box.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
    }

    // ------------------------------------------------------------ 3. cards
    function cards(L, byId, now) {
      if (!L.length) return `<section class="lr-sec" id="lr-cards"><div class="lr-sechead"><h2>Launches</h2></div><p class="lr-empty">No launch files read yet.</p></section>`;
      return `<section class="lr-sec" id="lr-cards" aria-labelledby="lr-ch"><div class="lr-sechead"><h2 id="lr-ch">Launches</h2><p>Soonest first. Tap a card for every stop, lane and order.</p></div>
        <div class="lr-cards">${L.map(l => card(l, byId, now)).join('')}</div></section>`;
    }
    function card(l, byId, now) {
      const open = openSet.has(l.id);
      const pipe = KEYS.map(k => (l.pipeline || []).find(s => s.key === k) || { key: k, label: LABEL[k], state: 'todo', who: '', line: '', read_at: '' });
      const ords = (l.orders || []).map(id => byId[id]).filter(Boolean);
      const openOrds = ords.filter(isOpen).sort((a, b) => (lateOf(b, now) - lateOf(a, now)) || ((t(a.due) || 9e15) - (t(b.due) || 9e15)));
      const late = openOrds.filter(o => lateOf(o, now));
      const atMs = t(l.at), toGo = atMs == null ? null : atMs - now;
      const dleft = toGo == null ? null : Math.max(0, Math.ceil(toGo / DAY));
      const togo = toGo == null ? `<b>–</b><small>no date</small>` : toGo <= 0 ? `<b>Out</b><small>released</small>` : toGo < DAY ? `<b>${esc(span(toGo).replace(' min', 'm').replace(' h', 'h'))}</b><small>to go</small>` : `<b>${dleft}</b><small>${dleft === 1 ? 'day to go' : 'days to go'}</small>`;
      const count = {}; pipe.forEach(s => { const k = stOf(s.state); count[k] = (count[k] || 0) + 1; });
      const stg = stageOf(l, pipe);
      return `<article class="lr-box lr-card${open ? ' open' : ''}" id="lr-g-${esc(l.id)}" data-game="${esc(l.id)}">
        <button type="button" class="lr-ctop" data-toggle="${esc(l.id)}" aria-expanded="${open}" aria-controls="lr-b-${esc(l.id)}">
          <span class="lr-chead">
            <span class="lr-cname">${esc(l.name)}${l.priority ? ' <span class="lr-pill prio">Priority</span>' : ''}${late.length ? ` <span class="lr-pill late">${late.length} late</span>` : ''}${(l.fails || []).length ? ` <span class="lr-pill bad">${ico('failed')}${l.fails.length} failing</span>` : ''}</span>
            ${(w => w.two ? `<span class="lr-cwhen">Launch <b>${esc(w.own)}</b> <span class="lr-here">· here ${esc(w.here)}</span></span>` : `<span class="lr-cwhen">Launch <b>${esc(when(l.at))}</b> Singapore time</span>`)(launchWhen(l))}
            <span class="lr-cside"><span class="lr-togo${toGo != null && toGo < 3 * DAY ? ' soon' : ''}">${togo}</span><span class="lr-chev">${open ? 'Close' : 'Open'}${ico('chev')}</span></span>
          </span>
          <span class="lr-stage"><b>Stage ${esc(stg.n)} of ${esc(stg.of)}</b> · ${esc(stg.label)}${stepRest(stg.line) ? `<span class="ln">${esc(stepRest(stg.line))}</span>` : ''}</span>
          <ol class="lr-track" aria-label="The nine stops to launch, now at stage ${esc(stg.n)}">${pipe.map((s, i) => { const st = stOf(s.state), cur = i + 1 === Number(stg.n);
            return `<li class="lr-stop s-${st}${cur ? ' cur' : ''}" data-stop="${esc(s.key)}"${cur ? ' aria-current="step"' : ''}><span class="lr-node">${ico(st, (SHORT[s.key] || s.key) + ': ' + STATE[st] + (cur ? ', current stage' : ''))}</span><span class="sl">${esc(SHORT[s.key] || s.label)}</span>${cur ? '<span class="now">Now</span>' : ''}</li>`; }).join('')}</ol>
          ${blockerBox(l.blocker, now)}
          <span class="lr-tracksum">${['failed', 'blocked', 'waiting', 'doing', 'done', 'todo'].filter(k => count[k]).map(k => `<span class="s-${k}">${ico(k)}${count[k]} ${STATE[k].toLowerCase()}</span>`).join('')}</span>
          ${open ? '' : `<ul class="lr-urgent">${urgent(l, pipe, openOrds, now)}</ul>`}
        </button>
        <div class="lr-cbody" id="lr-b-${esc(l.id)}"${open ? '' : ' hidden'}>${open ? body(l, pipe, ords, openOrds, now) : ''}</div>
      </article>`;
    }
    // the main blocker, never shortened; coloured by its state, with a word and an icon
    function blockerBox(b, now) {
      if (!b || !(b.what || b.state)) return '';
      const st = ['blocking', 'at_risk', 'clear'].includes(b.state) ? b.state : 'at_risk';
      const word = { blocking: 'Blocking', at_risk: 'At risk', clear: 'Clear' }[st];
      const icon = { blocking: 'blocked', at_risk: 'waiting', clear: 'done' }[st];
      const due = t(b.must_clear_by), late = overdueOf(b, now);
      const left = late ? '' : workLeft(b, now);
      const dueLine = late
        ? `<span class="bdue">${ico('failed')}<span>Was due ${due != null ? `<b>${esc(when(b.must_clear_by, 'day'))}</b>, ${esc(num(b.overdue_by_hours) != null ? Math.max(1, Math.round(b.overdue_by_hours)) : Math.max(1, Math.round((now - due) / HOUR)))} h ago` : '<b>before now</b>'}</span></span>`
        : (due != null ? `<span>Must clear by <b>${esc(when(b.must_clear_by))}</b></span>` : '');
      const meta = st === 'clear' && !b.who ? '' : [b.who ? `Waits on <b>${esc(b.who)}</b>` : '<span class="nobody">Nobody named</span>', (b.since_label || b.since) ? `since ${esc(b.since_label || dayOrLabel(b.since))}` : ''].filter(Boolean).join(' · ');
      return `<span class="lr-blocker b-${st}" role="group" aria-label="Main blocker: ${esc(word)}">
        <span class="bh"><span class="bk">Main blocker</span><span class="bs">${ico(icon)}${esc(word)}</span></span>
        <span class="bw">${esc(b.what || (st === 'clear' ? 'Nothing is blocking this launch.' : 'Not written'))}</span>
        ${meta ? `<span class="bm">${meta}</span>` : ''}
        ${dueLine || left ? `<span class="bc">${dueLine}${left ? `<span class="bl">${esc(left)}</span>` : ''}</span>` : ''}
        ${b.if_missed ? `<span class="bi"><b>If it is missed:</b> ${esc(b.if_missed)}</span>` : ''}
        <span class="bsrc">${!opts.partner && b.source ? `From ${esc(b.source)} · ` : ''}${t(b.read_at) != null ? `read ${esc(ago(b.read_at, now))}` : 'read time not written'}</span>
      </span>`;
    }
    function urgent(l, pipe, openOrds, now) {
      const out = [];
      // a collapsed card may shorten a line, but only at a sentence end, and says so
      const s = (x, max) => { const r = sentences(x, max || 150); return esc(r.text) + (r.cut ? ' <span class="lr-more">More inside.</span>' : ''); };
      (l.fails || []).forEach(f => out.push(['failed', s(f)]));
      openOrds.filter(o => lateOf(o, now)).forEach(o => out.push(['failed', `<b>Late:</b> ${esc(o.who)}, ${s(o.what, 120)} Was due ${esc(when(o.due))}.`]));
      (l.waiting_on_joel || []).forEach(w => out.push(['waiting', `<b>Waiting on Joel:</b> ${s(w.line, 130)}${w.due ? ` By ${esc(when(w.due))}.` : ''}`]));
      pipe.filter(p => p.state === 'failed' || p.state === 'blocked').forEach(p => { if (!(l.fails || []).length) out.push([p.state, `<b>${esc(LABEL[p.key] || p.label)}:</b> ${s(p.line || STATE[p.state], 130)}`]); });
      pipe.filter(p => p.state === 'waiting').forEach(p => out.push(['waiting', `<b>${esc(LABEL[p.key] || p.label)}:</b> ${s(p.line || 'Waiting', 130)}`]));
      openOrds.filter(o => !lateOf(o, now) && o.due).forEach(o => out.push(['doing', `<b>${esc(o.who)}:</b> ${s(o.what, 120)} Due ${esc(when(o.due))}.`]));
      const top = out.slice(0, 2);
      if (!top.length) { const nx = pipe.find(s => s.state !== 'done'); return `<li class="calm">${ico('done')}<span>Nothing urgent.${nx ? ` Next stop: ${esc(LABEL[nx.key] || nx.label)}.` : ' Every stop is done.'}</span></li>`; }
      return top.map(([s, h]) => `<li class="s-${s}">${ico(s)}<span>${h}</span></li>`).join('') + (out.length > 2 ? `<li class="calm"><span></span><span>${out.length - 2} more inside.</span></li>` : '');
    }
    function body(l, pipe, ords, openOrds, now) {
      const done = ords.filter(o => o.state === 'done').slice(-3);
      const pipeHtml = `<div><h3 class="lr-h3">The nine stops</h3><ol class="lr-rows">${pipe.map(s => { const st = stOf(s.state);
        return `<li class="lr-prow" data-row="${esc(s.key)}"><span class="st">${badge(st)}</span><span class="lab">${esc(LABEL[s.key] || s.label)}</span>
          <span class="ln">${s.line ? esc(s.line) : '<span class="lr-muted">No line written yet.</span>'}</span>
          <span class="mt">${s.who ? `<span class="who">${esc(s.who)}</span>` : '<span class="nobody">Nobody assigned</span>'}<span>${s.read_at ? 'read ' + esc(ago(s.read_at, now)) : 'not read'}</span>${!opts.partner && s.source ? `<span>from ${esc(s.source)}</span>` : ''}</span></li>`; }).join('')}</ol></div>`;
      const joel = (l.waiting_on_joel || []).length ? `<div><h3 class="lr-h3">Waiting on Joel <span class="n">${l.waiting_on_joel.length}</span></h3><ul class="lr-joel">${l.waiting_on_joel.map(w => `<li><span class="tag">${esc(w.tag || 'DO')}</span><span>${esc(w.line)}</span>${w.due ? `<span class="lr-muted" style="font-size:13px">Due ${esc(when(w.due))} · ${esc(until(w.due, now))}</span>` : ''}</li>`).join('')}</ul></div>` : '';
      const fails = `<div><h3 class="lr-h3">Failing <span class="n">${(l.fails || []).length}</span></h3>${(l.fails || []).length ? `<ul class="lr-fails">${l.fails.map(f => `<li>${ico('failed')}<span>${esc(f)}</span></li>`).join('')}</ul>` : `<p class="lr-ok">${ico('done')}No failing checks for this launch.</p>`}</div>`;
      const ordHtml = `<div><h3 class="lr-h3">In progress now <span class="n">${openOrds.length}</span></h3>${openOrds.length ? `<ul class="lr-orders">${openOrds.map(o => order(o, now)).join('')}</ul>` : '<p class="lr-empty">No open orders for this launch.</p>'}
        ${done.length ? `<details class="lr-daytable" style="margin-top:8px"><summary>Done lately (${done.length})</summary><ul class="lr-orders">${done.map(o => order(o, now)).join('')}</ul></details>` : ''}</div>`;
      const lanesHtml = `<div><h3 class="lr-h3">Marketing lanes</h3><div class="lr-rows">${lanes(l, now)}</div></div>`;
      return `<div class="lr-cgrid"><div class="lr-col">${pipeHtml}</div><div class="lr-col">${lanesHtml}</div><div class="lr-col">${fails}${joel}${ordHtml}</div></div>`;
    }
    function order(o, now) {
      const late = isOpen(o) && lateOf(o, now), dms = t(o.due);
      return `<li class="lr-order${late ? ' late' : ''}${o.state === 'done' ? ' done' : ''}">
        <span class="top"><span class="who"><i></i>${esc(o.who || 'Nobody assigned')}</span>${late ? `<span class="lr-pill late">${ico('failed')}Late by ${esc(span(now - dms))}</span>` : o.state === 'done' ? `<span class="lr-pill good">${ico('done')}Done</span>` : o.state === 'dropped' ? '<span class="lr-pill">Dropped</span>' : ''}</span>
        <p class="what">${esc(o.what)}</p>
        <span class="when"><span>Since ${esc(when(o.opened_at))}</span>${o.due ? `<span class="${late ? 'due-late' : ''}">Due ${esc(when(o.due))}${o.state === 'done' ? '' : ' · ' + esc(until(o.due, now))}</span>` : '<span>No due time</span>'}${o.by ? `<span>Ordered by ${esc(o.by)}</span>` : ''}</span>
        ${o.state === 'done' && o.result ? `<p class="note"><time>${esc(when(o.closed_at))}</time>${esc(o.result)}</p>` : o.last_note ? `<p class="note">${o.last_note_at ? `<time>${esc(when(o.last_note_at))}</time>` : ''}${esc(o.last_note)}</p>` : '<p class="note lr-muted">No note yet.</p>'}
      </li>`;
    }
    function lanes(l, now) {
      const ln = l.lanes || {};
      const row = (name, html, cls) => `<div class="lr-lane${cls ? ' ' + cls : ''}"><span class="nm">${esc(name)}</span><div class="bd">${html}</div></div>`;
      const empty = (name, msg) => row(name, `<span class="nobody">${ico('person')}${esc(msg || 'Nobody assigned')}</span><span>Not started.</span>`, 'isempty');
      const line = s => s ? `<span class="ln">${esc(s)}</span>` : '';
      const out = [];
      // store
      const st = ln.store;
      out.push(st && (st.state || st.line) ? row('Store', `<span class="big">${badge(st.state)}</span>${line(st.line)}`) : empty('Store'));
      // content
      const c = ln.content;
      if (c && (num(c.reels_per_day) != null || c.line || (c.next_posts || []).length)) {
        const lr = c.launch_reel === 'posted' ? `<span class="lr-pill good">${ico('done')}Launch reel posted</span>` : c.launch_reel === 'held' ? `<span class="lr-pill info">${ico('held')}Launch reel made, held</span>` : `<span class="lr-pill bad">${ico('failed')}Launch reel missing</span>`;
        const posts = (c.next_posts || []).filter(p => t(p.at) == null || t(p.at) > now - HOUR).slice(0, 3);
        out.push(row('Content', `<span class="big"><b>${num(c.reels_per_day) == null ? '–' : c.reels_per_day}</b><span>${c.reels_per_day === 1 ? 'reel a day' : 'reels a day'}</span>${lr}</span>${line(c.line)}
          ${posts.length ? `<ul class="lr-posts">${posts.map(p => `<li><time>${esc(when(p.at))}</time><span>${esc(p.hook)}</span></li>`).join('')}</ul>` : '<span class="lr-muted" style="font-size:13px">No posts timed in the next two days.</span>'}
          ${(c.platforms || []).length ? `<span class="facts">On ${esc(c.platforms.join(', '))}</span>` : ''}`));
      } else out.push(empty('Content'));
      // creators
      const cr = ln.creators;
      if (cr && (num(cr.reached) || num(cr.emailed) || num(cr.drafts_waiting) || cr.line)) {
        const pct = num(cr.target) ? Math.min(100, Math.round((cr.reached || 0) / cr.target * 100)) : 0;
        const oldBad = num(cr.oldest_draft_h) != null && cr.oldest_draft_h > 48;
        out.push(row('Creators', `<span class="big"><b>${fmtN(cr.reached)}</b><span>of ${fmtN(cr.target)} reached</span></span>
          <span class="lr-bar${pct < 34 ? ' low' : ''}" role="img" aria-label="${pct}% of the target"><i style="width:${pct}%"></i></span>
          <span class="facts"><span><b>${fmtN(cr.emailed)}</b> emailed</span><span><b>${fmtN(cr.replied)}</b> replied</span><span><b>${fmtN(cr.keys_out)}</b> keys out</span>
          <span${oldBad ? ' class="bad"' : ''}><b>${fmtN(cr.drafts_waiting)}</b> drafts waiting${cr.drafts_waiting ? `, oldest ${fmtN(cr.oldest_draft_h)} h` : ''}</span><span><b>${fmtN(cr.no_contact)}</b> with no contact yet</span></span>${line(cr.line)}`));
      } else out.push(empty('Creators'));
      // curators
      const cu = ln.curators;
      if (cu && (num(cu.offers) || cu.line)) {
        const of = num(cu.of) || 100, pct = Math.min(100, Math.round((cu.offers || 0) / of * 100));
        out.push(row('Curators', `<span class="big"><b>${fmtN(cu.offers)}</b><span>of ${of} curator offers sent</span></span><span class="lr-bar${pct < 34 ? ' low' : ''}" role="img" aria-label="${pct}% used"><i style="width:${pct}%"></i></span>${line(cu.line)}`));
      } else out.push(empty('Curators'));
      // press
      const pr = ln.press;
      if (pr && (pr.kit || (pr.release && pr.release !== 'none') || num(pr.outlets) || pr.line)) {
        const rel = { none: ['bad', 'No release'], draft: ['warn', 'Release in draft'], held: ['info', 'Release written, held'], sent: ['good', 'Release sent'] }[pr.release || 'none'] || ['', pr.release];
        out.push(row('Press', `<span class="big">${pr.kit ? `<span class="lr-pill good">${ico('done')}Press kit ready</span>` : `<span class="lr-pill warn">${ico('waiting')}No press kit yet</span>`}<span class="lr-pill ${rel[0]}">${esc(rel[1])}</span><span>${fmtN(pr.outlets)} outlets</span></span>${line(pr.line)}`));
      } else out.push(empty('Press'));
      // partners
      const pa = ln.partners;
      out.push(pa && pa.line ? row('Partners', line(pa.line)) : empty('Partners', 'No partner yet'));
      // numbers
      const nu = ln.numbers;
      if (nu && num(nu.wishlists) != null) {
        const ra = t(nu.read_at), stale = !!nu.stale || (ra != null && now - ra > 30 * HOUR);
        const d7 = num(nu.adds_7d), p7 = num(nu.adds_prev_7d);
        const ch = d7 != null && p7 ? Math.round((d7 - p7) / p7 * 100) : null;
        const units = !opts.partner && num(nu.units) != null ? `<div><b>${fmtN(nu.units)}</b><span>units sold</span></div>` : '';
        out.push(row('Numbers', `${stale ? `<span class="lr-pill stale">${ico('alert')}Stale (${esc(ra ? span(now - ra) : 'unknown')}). Last read ${esc(when(nu.read_at))}</span>` : `<span class="lr-muted" style="font-size:13px">Read ${esc(ago(nu.read_at, now))}</span>`}
          <div class="lr-nums"><div><b>${fmtN(nu.wishlists)}</b><span>wishlists${stale ? ' (as of then)' : ''}</span></div>
          <div><b>${fmtN(d7)}${ch != null ? ` <small class="${ch >= 0 ? 'up' : 'down'}">${ch >= 0 ? '+' : ''}${ch}%</small>` : ''}</b><span>added in 7 days${p7 != null ? ` (${fmtN(p7)} the week before)` : ''}</span></div>
          <div><b>${fmtN(nu.visits_7d)}</b><span>page visits, 7 days</span></div><div><b>${fmtN(nu.from_our_links_14d)}</b><span>visits from our links, 14 days</span></div>${units}</div>
          ${spark(nu.adds_daily || [], stale)}`, stale ? 'isstale' : ''));
      } else out.push(row('Numbers', `<span class="nobody">${ico('waiting')}Not read yet</span><span>No wishlist reading for this game.</span>`, 'isempty'));
      return out.join('');
    }
    // wishlist adds per day: one series, so no legend; area + line + end dot, a tooltip on hover or tap, the table below
    function spark(rows, stale) {
      rows = rows.filter(r => num(r.adds) != null);
      if (rows.length < 2) return '';
      const W = 300, H = 56, pad = 4, max = Math.max(1, ...rows.map(r => r.adds));
      const x = i => pad + i * (W - pad * 2) / (rows.length - 1), y = v => H - 4 - (v / max) * (H - 12);
      const pts = rows.map((r, i) => `${x(i).toFixed(1)},${y(r.adds).toFixed(1)}`);
      const last = rows[rows.length - 1];
      const tot = rows.reduce((a, r) => a + r.adds, 0);
      const col = stale ? 'var(--lr-muted)' : 'var(--lr-accent)';
      return `<div class="lr-spark" data-spark='${esc(JSON.stringify(rows))}'>
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Wishlists added per day, last ${rows.length} days: ${tot} in total, ${last.adds} on the last day.">
          <line x1="${pad}" x2="${W - pad}" y1="${H - 4}" y2="${H - 4}" stroke="var(--lr-line)" stroke-width="1"/>
          <line x1="${pad}" x2="${W - pad}" y1="${y(max).toFixed(1)}" y2="${y(max).toFixed(1)}" stroke="var(--lr-line)" stroke-width="1" stroke-dasharray="2 4"/>
          <polygon points="${pad},${H - 4} ${pts.join(' ')} ${W - pad},${H - 4}" fill="${col}" fill-opacity=".14"/>
          <polyline points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
          <circle cx="${x(rows.length - 1).toFixed(1)}" cy="${y(last.adds).toFixed(1)}" r="4" fill="${col}" stroke="var(--lr-panel)" stroke-width="2" vector-effect="non-scaling-stroke"/>
          <line class="cross" x1="0" x2="0" y1="4" y2="${H - 4}" stroke="var(--lr-muted)" stroke-width="1" vector-effect="non-scaling-stroke" visibility="hidden"/>
        </svg><span class="tip" hidden></span>
        <span class="cap"><span>${esc(when(rows[0].date + 'T12:00:00+08:00', 'day'))}</span><span>Wishlists added per day · peak ${max}</span><span>${esc(when(last.date + 'T12:00:00+08:00', 'day'))}: ${last.adds}</span></span>
        <details class="lr-daytable"><summary>Day by day</summary><div class="lr-tw"><table><thead><tr><th>Day</th><th>Added</th></tr></thead><tbody>${rows.slice().reverse().map(r => `<tr><td>${esc(when(r.date + 'T12:00:00+08:00', 'day'))}</td><td>${r.adds}</td></tr>`).join('')}</tbody></table></div></details>
      </div>`;
    }
    function sparkHover(e) {
      const sp = e.target.closest && e.target.closest('.lr-spark'); if (!sp) return;
      const svg = sp.querySelector('svg'); if (!svg || !svg.contains(e.target)) return;
      let rows; try { rows = JSON.parse(sp.dataset.spark); } catch (x) { return; }
      const r = svg.getBoundingClientRect(); const fx = (e.clientX - r.left) / r.width;
      const i = Math.max(0, Math.min(rows.length - 1, Math.round(((fx * 300) - 4) / (292 / (rows.length - 1)))));
      const px = (4 + i * 292 / (rows.length - 1)) / 300;
      const tip = sp.querySelector('.tip'), cross = sp.querySelector('.cross');
      tip.hidden = false; tip.textContent = `${when(rows[i].date + 'T12:00:00+08:00', 'day')}: ${rows[i].adds} added`; tip.style.left = (px * 100) + '%';
      cross.setAttribute('x1', px * 300); cross.setAttribute('x2', px * 300); cross.setAttribute('visibility', 'visible');
    }
    function sparkOut(e) { const sp = e.target.closest && e.target.closest('.lr-spark'); if (!sp) return; const tip = sp.querySelector('.tip'); if (tip) tip.hidden = true; const c = sp.querySelector('.cross'); if (c) c.setAttribute('visibility', 'hidden'); }

    // ------------------------------------------------------------ 4. who is doing what
    function workers(orders, now) {
      const W = ops.workers || [];
      const byId = Object.fromEntries(orders.map(o => [o.id, o]));
      if (!W.length) return `<section class="lr-sec" id="lr-work"><div class="lr-sechead"><h2>Who is doing what</h2></div><p class="lr-empty">Nobody has reported yet.</p></section>`;
      const rows = W.map(w => {
        const ds = (w.doing || []).map(id => byId[id]).filter(o => o && isOpen(o)).sort((a, b) => (lateOf(b, now) - lateOf(a, now)) || ((t(a.due) || 9e15) - (t(b.due) || 9e15)));
        const seen = t(w.last_seen), quiet = (seen != null && now - seen > 24 * HOUR) || (seen == null && ds.length > 0);
        const kindLabel = /helper|builders?$/i.test(w.name || '') && w.kind !== 'person' && w.kind !== 'scheduled' ? 'Helper' : (WKIND[w.kind] || 'Worker');
        const li = o => { const late = lateOf(o, now); return `<li class="${late ? 'late' : ''}"><span><span class="g">${esc(nameOf(ops, o.game))}:</span> ${esc(o.what)}</span><span class="d">${late ? 'late, was ' : ''}${o.due ? esc(when(o.due)) : 'no due time'}</span></li>`; };
        return `<div class="lr-box lr-worker k-${esc(w.kind || 'session')}">
          <div class="lr-whead"><span class="lr-av" aria-hidden="true">${esc(initials(w.name))}</span><span class="lr-wname">${esc(w.name)}</span><span class="lr-wkind">${esc(kindLabel)}${ds.length ? ` · ${ds.length} open` : ''}</span>
            <span class="lr-wseen${quiet ? ' quiet' : ''}">${seen == null ? (ds.length ? `${ico('alert')}never reported` : 'never reported') :(quiet ? 'quiet ' + span(now - seen) : 'seen ' + ago(w.last_seen, now))}</span></div>
          ${w.line ? `<p class="lr-wline">${esc(w.line)}</p>` : ''}
          ${ds.length ? `<ul class="lr-wdo">${ds.slice(0, 4).map(li).join('')}</ul>${ds.length > 4 ? `<details class="lr-wmore"><summary>${ds.length - 4} more</summary><ul class="lr-wdo">${ds.slice(4).map(li).join('')}</ul></details>` : ''}` : '<p class="lr-wnone">No open orders.</p>'}
        </div>`;
      });
      return `<section class="lr-sec" id="lr-work" aria-labelledby="lr-wh"><div class="lr-sechead"><h2 id="lr-wh">Who is doing what</h2><p>Open orders per worker, and when each last reported.</p></div><div class="lr-workers">${rows.join('')}</div></section>`;
    }

    // ------------------------------------------------------------ 5. schedule
    function schedule(now) {
      const S = ops.schedule || [];
      const OFF = Array.isArray(ops.schedule_off) ? ops.schedule_off : [];
      const offKey = x => String((x && (x.label || x.name || x.id)) || '').trim().toLowerCase();
      const offSet = new Set(OFF.map(offKey));
      // only what is switched on runs by itself; anything on the switched-off list never shows here, even if listed twice
      const rep = S.filter(s => !t(s.at) && s.every && !offSet.has(offKey(s)));
      // the next 48 hours in full; after that the presses, checks and deadlines to day 14 sit folded (reel posts only to 48 h)
      // an order's own due time is already on its card and under its worker, so it is counted here, not listed again
      const gk = g => (!g || g === 'all') ? 'all' : g;
      const orderDue = s => s.kind === 'deadline' && (ops.orders || []).some(o => isOpen(o) && t(o.due) === t(s.at) && (gk(o.game) === gk(s.game) || (o.what && String(s.label).slice(0, 40) === String(o.what).slice(0, 40))));
      const inWin = S.filter(s => t(s.at) != null && t(s.at) >= now - HOUR && t(s.at) < now + 14 * DAY);
      const dueCount = inWin.filter(orderDue).length;
      const timedAll = inWin.filter(s => !orderDue(s)).sort((a, b) => t(a.at) - t(b.at));
      const timed = timedAll.filter(s => t(s.at) < now + 2 * DAY);
      const later = timedAll.filter(s => t(s.at) >= now + 2 * DAY && s.kind !== 'post');
      const r = (s, tm, sub) => `<li class="lr-srow k-${esc(s.kind || 'run')}"><span class="ki">${ico(s.kind || 'run', KIND[s.kind] || 'Event')}</span><span class="t">${esc(tm)}${sub ? `<small>${esc(sub)}</small>` : ''}</span><span class="x">${esc(s.label)}</span>
        <span class="m">${esc(s.who || 'Nobody assigned')}${s.game && s.game !== 'all' ? ' · ' + esc(nameOf(ops, s.game)) : s.game === 'all' ? ' · every game' : ''}</span></li>`;
      const every = e => { const m = /^daily\s+(\d\d:\d\d)$/.exec(e || ''); return m ? `Every day ${m[1]}` : e === 'hourly' ? 'Every hour' : (e || '').replace(/^every/, 'Every'); };
      const today = dayKey(now);
      const list = xs => { let lastDay = ''; return xs.map(s => { const k = dayKey(t(s.at)); let h = ''; if (k !== lastDay) { lastDay = k; h = `<li class="lr-sday${k === today ? ' today' : ''}">${k === today ? 'Today, ' : ''}${esc(when(s.at, 'day'))}</li>`; }
        return h + r(s, when(s.at, 'time'), until(s.at, now)); }).join(''); };
      const timedHtml = list(timed) + (later.length ? `</ul><details class="lr-daytable lr-schedmore"><summary>Days 3 to 14: ${later.length} presses, checks and deadlines</summary><ul class="lr-srows">${list(later)}</ul></details><ul class="lr-srows">` : '');
      return `<section class="lr-sec" id="lr-sched" aria-labelledby="lr-sh"><div class="lr-sechead"><h2 id="lr-sh">Schedule</h2><p>Singapore time. What runs by itself, and every timed thing in the next 14 days.</p></div>
        <div class="lr-sched">
          <div class="lr-box lr-schedcol"><h3 class="lr-h3">Runs by itself <span class="n">${rep.length}</span>${t(ops.schedule_read_at) != null ? `<span class="lr-readat">list read ${esc(when(ops.schedule_read_at))} · ${esc(ago(ops.schedule_read_at, now))}</span>` : ''}</h3>${rep.length ? `<ul class="lr-srows">${rep.map(s => r(s, every(s.every))).join('')}</ul>` : '<p class="lr-empty">Nothing runs by itself yet.</p>'}
            ${OFF.length ? `<div class="lr-off"><h4 class="lr-h4">${ico('off', 'Switched off')}Switched off <span class="n">${OFF.length}</span></h4><ul class="lr-srows">${OFF.map(x => { const lr = x.last_run || x.last_run_at || x.last || '';
              const ev = x.every || x.was_every || x.used_to_run || '';
              return `<li class="lr-srow lr-offrow"><span class="ki">${ico('off', 'Switched off')}</span><span class="t">Off</span><span class="x">${esc(x.label || x.name || x.id || 'Unnamed task')}</span>
                <span class="m">${ev ? `Used to run ${esc(every(ev).replace(/^Every/, 'every'))}` : 'How often it ran is not written'} · ${t(lr) != null ? `last ran ${esc(when(lr))}` : 'no last run on record'}${x.game && x.game !== 'all' ? ' · ' + esc(nameOf(ops, x.game)) : ''}</span></li>`; }).join('')}</ul></div>` : ''}</div>
          <div class="lr-box lr-schedcol"><h3 class="lr-h3">Next 48 hours <span class="n">${timed.length}</span></h3>${timed.length || later.length ? `<ul class="lr-srows">${timedHtml}</ul>` : '<p class="lr-empty">Nothing timed in the next 14 days.</p>'}${!timed.length && later.length ? '<p class="lr-muted" style="margin:0;font-size:13px">Nothing in the next 48 hours.</p>' : ''}${dueCount ? `<p class="lr-muted" style="margin:0;font-size:13px">Plus ${dueCount} order due times in the next 14 days, each shown on its launch card and under its worker.</p>` : ''}</div>
        </div></section>`;
    }

    // ------------------------------------------------------------ 6. held and gates
    function heldGates() {
      const H = ops.held || [], G = (ops.gates || []).slice().sort((a, b) => (a.state === 'closed' ? 0 : 1) - (b.state === 'closed' ? 0 : 1));
      const closed = G.filter(g => g.state === 'closed').length;
      return `<section class="lr-sec" id="lr-held" aria-labelledby="lr-hh"><div class="lr-sechead"><h2 id="lr-hh">Held and gates</h2><p>Made and waiting for their moment, and the written gates that hold things back.</p></div>
        <div class="lr-hg">
          <div class="lr-box lr-hgcol"><h3 class="lr-h3">Held <span class="n">${H.length}</span></h3>${H.length ? H.map(h => `<div class="lr-hrow s-doing"><span class="ki">${ico('held', 'Held')}</span><span class="t">${esc(h.what)} <span>· ${esc(nameOf(ops, h.game))}</span></span><span class="x">${esc(h.line || '')}</span><span class="m">${t(h.release_by) != null ? `Goes out <b>${esc(when(h.release_by))}</b> · ${esc(until(h.release_by, Date.now()))}` : `Released by <b>${esc(h.release_by || 'nobody assigned')}</b>`}</span></div>`).join('') : '<p class="lr-empty">Nothing is held right now.</p>'}</div>
          <div class="lr-box lr-hgcol"><h3 class="lr-h3">Gates <span class="n">${closed} closed</span>${G.length > closed ? `<span class="lr-readat">${G.length - closed} opened</span>` : ''}</h3>${G.length ? G.map(g => { const c = g.state === 'closed';
            const kind = GKIND[g.kind] ? `<span class="lr-gkind">${esc(GKIND[g.kind])}</span>` : '';
            const what = g.held || g.line || 'Not written';
            if (!c) return `<div class="lr-hrow s-done lr-gopen"><span class="ki">${ico('unlock', 'Open')}</span><span class="t">${esc(nameOf(ops, g.game))} <span>· opened</span>${kind}</span><span class="x">${esc(what)}</span><span class="m">It waited for: ${esc(g.waits_for || 'not written')}${t(g.opened_at) != null ? ` · opened ${esc(when(g.opened_at))}` : ''}</span></div>`;
            const pl = t(g.planned);
            return `<div class="lr-hrow s-blocked lr-gate"><span class="ki">${ico('lock', 'Closed')}</span><span class="t">${esc(nameOf(ops, g.game))} <span>· closed</span>${kind}</span>
              <span class="x"><b>Held:</b> ${esc(what)}</span>
              <dl class="lr-gdl"><dt>Opens when</dt><dd>${esc(g.waits_for || 'not written')}</dd><dt>Who</dt><dd>${g.who_opens ? esc(g.who_opens) : '<span class="nobody">Nobody assigned</span>'}</dd>
                <dt>Planned</dt><dd>${pl != null ? `${esc(when(g.planned))} · ${esc(until(g.planned, Date.now()))}${g.confirmed === true ? ' · confirmed' : g.confirmed === false ? ' · <span class="lr-warnt">not confirmed</span>' : ''}` : `<span class="lr-warnt">${ico('alert')}No time planned</span>`}</dd></dl></div>`; }).join('') : '<p class="lr-empty">No written gates.</p>'}</div>
        </div></section>`;
    }

    // ------------------------------------------------------------ 7. how a launch runs here
    function how() {
      const pr = ops.process || {}, st = pr.steps || [], la = pr.lanes || [];
      const list = xs => `<ol class="lr-steps">${xs.map(s => `<li class="lr-step"><span class="n">${esc(s.n)}</span><b>${esc(s.title)}</b><span>${esc(s.line)}</span></li>`).join('')}</ol>`;
      return `<section class="lr-sec" id="lr-how" aria-labelledby="lr-hwh"><div class="lr-sechead"><h2 id="lr-hwh">How a launch runs here</h2><p>The same line for every game, and the seven marketing lanes that run beside it.</p></div>
        <div class="lr-how"><div class="lr-box lr-howcol"><h3 class="lr-h3">Nine steps</h3>${st.length ? list(st) : '<p class="lr-empty">Not filled in yet.</p>'}</div>
        <div class="lr-box lr-howcol"><h3 class="lr-h3">Seven lanes</h3>${la.length ? list(la) : '<p class="lr-empty">Not filled in yet.</p>'}</div></div></section>`;
    }
    function foot() {
      const line = typeof ops.refresh_line === 'string' && ops.refresh_line.trim() ? ops.refresh_line.trim() : 'Filled by a no-model build that runs with every ledger entry and every hourly room sync.';
      return `<p class="lr-foot"><span>${esc(line)}${opts.sourceNote ? ' ' + esc(opts.sourceNote) : ''}</span><span>Times are Singapore time unless a launch names its own.</span></p>`;
    }

    // ------------------------------------------------------------ interaction
    const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function openCard(id, stop) {
      if (!openSet.has(id)) { openSet.add(id); draw(); }
      const el = root.querySelector(`#lr-g-${CSS.escape(id)}`); if (!el) return;
      let target = el;
      if (stop) { const row = el.querySelector(`[data-row="${CSS.escape(stop)}"]`); if (row) { target = row; row.classList.add('hl'); setTimeout(() => row.classList.remove('hl'), 1600); } }
      target.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
      el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1200);
    }
    root.addEventListener('click', e => {
      const j = e.target.closest('[data-jump]'); if (j) { openCard(j.dataset.jump); return; }
      const pk = e.target.closest('[data-pick]'); if (pk) { const i = pk.dataset.pick; if (pick === i) { pick = null; showPick(''); } else { pick = i; showPick(i, true); } return; }
      if (e.target.closest('[data-pickclose]')) { const was = pick; pick = null; showPick(''); const b = was && root.querySelector(`[data-pick="${CSS.escape(was)}"]`); if (b) b.focus(); return; }
      const gt = e.target.closest('[data-goto]'); if (gt) { const s = root.querySelector('#' + CSS.escape(gt.dataset.goto)); if (s) s.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth' }); return; }
      const stop = e.target.closest('.lr-stop');
      const tg = e.target.closest('[data-toggle]');
      if (tg) {
        const id = tg.dataset.toggle;
        if (stop) { openCard(id, stop.dataset.stop); return; }
        if (openSet.has(id)) openSet.delete(id); else openSet.add(id);
        draw(); const el = root.querySelector(`[data-toggle="${CSS.escape(id)}"]`); if (el) { el.focus({ preventScroll: true }); const top = el.getBoundingClientRect().top; if (top < 0) el.scrollIntoView({ block: 'start' }); }
        return;
      }
      const go = e.target.closest('[data-go]');
      if (go) {
        const k = go.dataset.go, L = (ops.launches || []).slice().sort(byAt);
        if (k === 'work') { const s = root.querySelector('#lr-work'); if (s) s.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth' }); return; }
        const hit = L.find(l => k === 'fail' ? (l.fails || []).length : k === 'blocked' ? blockedOf(l) : (l.waiting_on_joel || []).length);
        if (hit) openCard(hit.id); else { const s = root.querySelector('#lr-cards'); if (s) s.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth' }); }
      }
    });
    root.addEventListener('pointermove', sparkHover);
    root.addEventListener('pointerdown', sparkHover);
    root.addEventListener('pointerleave', sparkOut, true);
    root.addEventListener('mouseout', e => { if (e.target.closest && e.target.closest('.lr-spark svg') && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.lr-spark svg'))) sparkOut(e); });

    // ages and countdowns refresh without a redraw
    function tick() {
      if (!ops) return;
      const now = Date.now();
      root.querySelectorAll('[data-until]').forEach(el => { el.textContent = until(el.dataset.until, now); });
      const a = root.querySelector('[data-agetext]'); if (a) a.textContent = ageText(now);
      const g = t(ops.generated_at), st = g == null || now - g > staleMin * MIN;
      const ag = root.querySelector('[data-age]'); if (ag) ag.classList.toggle('stale', st);
      if (st && g != null && !root.querySelector('[data-stalebanner]')) draw();
    }
    return { set, tick, openCard, get ops() { return ops; } };
  }
  window.LaunchRoom = { mount, version: '2026-11-15' };
})();
