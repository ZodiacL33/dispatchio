const $ = (id) => document.getElementById(id);
const LOWER48 = new Set(('AL AR AZ CA CO CT DE FL GA IA ID IL IN KS KY LA MA MD ME MI MN MO MS MT ' +
  'NC ND NE NH NJ NM NV NY OH OK OR PA RI SC SD TN TX UT VA VT WA WI WV WY').split(' '));
const PHONE_OK = /^[2-9]\d{9}$/;
const DEF = {
  v: 3, maxFleet: 30, minFleet: 0, blockSize: 10000, dailyGoal: 0, autoDial: false, delaySec: 10,
  dryRun: false, liveCheck: false, webKey: '', compact: false, detectVerified: false,
  aiMode: 'demand', includeGap: true, groqKey: '', orKey: '', groqModel: '', orModel: '',
  endRe: 'end call|hang up|call_end|^end$|^(un)?mute$',
  callRe: '^(call|start call)$',
  readyRe: 'calls|messages|voicemail',
};
const TYPES = { lead: 'Lead', sale: 'Sale', followup: 'Follow-up', dnc: 'Do not call' };
const OUT = { interested: 'Interested', callback: 'Call back', noanswer: 'No answer', notinterested: 'Not interested', dnc: 'Do not call', called: 'Called, no result marked' };
const OPS = { A: 'Interstate', B: 'Intrastate (hazmat)', C: 'Intrastate (non-hazmat)' };
// phase: empty | ready | dialing | oncall | wrapup | done
const S = { queue: [], map: {}, idx: 0, calls: {}, leads: {}, notes: {}, run: 1, cfg: { ...DEF },
  cur: null, parked: null, isManual: false, phase: 'empty', gv: 'unknown', paused: false,
  idle: 0, lost: 0, timer: null, dog: null, left: 0, msg: '', kind: 'info', busy: false, polling: false,
  bkey: '', bleft: 0, bdone: 0, shown: '', live: {}, verifying: false, savedTab: 'lead', range: 'today',
  rowOpen: null, assist: {}, noteSum: {}, briefTimer: null, briefFor: '', tab: 'calling', savedAll: false, assistCollapsed: false };

// ---------- helpers ----------
const fmtPhone = (p) => (p && p.length === 10 ? `+1 (${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}` : p || '');
const num = (n) => Number(n).toLocaleString('en-US');
const todayISO = () => new Date().toLocaleDateString('en-CA');
const blockOf = (mc) => { const z = Number(S.cfg.blockSize) || 10000; return Math.floor(Number(mc) / z) * z; };
const timeout = (p, ms, fb) => Promise.race([p, new Promise((r) => setTimeout(() => r(fb), ms))]);
const carrierOf = (mc) => S.map[mc] || (S.leads[mc] && S.leads[mc].carrier) || { mc };
const ckey = () => `${S.run}:${S.cur.mc}${S.isManual ? ':m' : ''}`;
const say = (msg, kind) => { S.msg = msg; S.kind = kind || 'info'; };
const safe = (fn) => async (...a) => {
  try { return await fn(...a); }
  catch (e) { S.busy = false; say(`Something went wrong (${(e && e.message) || e}). Dispatchio is still running.`, 'bad'); try { render(); } catch {} }
};
window.addEventListener('error', (e) => { S.busy = false; say('A small error happened and was ignored: ' + e.message, 'warn'); try { render(); } catch {} });
window.addEventListener('unhandledrejection', (e) => { S.busy = false; say('A small error happened and was ignored.', 'warn'); e.preventDefault(); try { render(); } catch {} });
const daysAgo = (ts) => { const d = Math.floor((Date.now() - ts) / 864e5); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };
function setIcon(el, name, size) { const old = el.querySelector(':scope > svg.ic'); if (old) old.remove(); const s = icon(name, size || Number(el.dataset.size) || 16); s.classList.add('ic'); el.prepend(s); el.dataset.icon = name; }

let saveT = null;
async function save() {
  clearTimeout(saveT);
  try {
    await chrome.storage.local.set({ cfg: S.cfg, idx: S.idx, calls: S.calls, leads: S.leads, notes: S.notes,
      run: S.run, curMc: S.cur && !S.isManual ? S.cur.mc : null });
  } catch (e) { say('Could not save to disk: ' + e.message, 'bad'); }
}
const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(save, 500); };

// ---------- queue ----------
function setQueue(q) {
  S.queue = Array.isArray(q)
    ? q.filter((c) => c && c.mc && PHONE_OK.test(c.phone || '')).sort((a, b) => Number(a.mc) - Number(b.mc)) : [];
  S.map = Object.fromEntries(S.queue.map((c) => [c.mc, c]));
}
function eligible(c) {
  if (!c || !c.mc || S.leads[c.mc] || S.calls[`${S.run}:${c.mc}`]) return false;
  if (!PHONE_OK.test(c.phone || '') || !LOWER48.has(c.state)) return false;
  if (c.units === null || c.units === undefined) return !!c.gap && S.cfg.includeGap !== false;   // brand-new carrier, fleet size verified live
  const u = Number(c.units);
  return Number.isFinite(u) && u >= S.cfg.minFleet && u <= S.cfg.maxFleet;
}
function nextCarrier() {
  S.isManual = false;
  if (S.parked) { S.cur = S.parked; S.parked = null; S.phase = 'ready'; save(); return; }
  S.cur = null;
  while (S.idx < S.queue.length) {
    const c = S.queue[S.idx++];
    if (eligible(c)) { S.cur = c; break; }
  }
  S.phase = S.queue.length ? (S.cur ? 'ready' : 'done') : (Object.keys(S.leads).length ? 'done' : 'empty');
  save();
}
async function loadFile(file) {
  if (!file) return;
  try {
    const q = JSON.parse(await file.text());
    if (!Array.isArray(q) || !q.length || !q[0].mc) throw new Error('not a queue file');
    setQueue(q);
    S.idx = 0; S.paused = false; S.parked = null;
    await chrome.storage.local.set({ queue: S.queue });
    nextCarrier();
    say(`Loaded ${num(S.queue.length)} carriers. Your history and saved carriers were kept.`, 'ok');
  } catch { say('That file is not a valid queue.json. Run build_queue.py and try again.', 'bad'); }
  render(); renderStats();
}

// ---------- Google Voice link ----------
const voiceTab = async () => (await chrome.tabs.query({ url: 'https://voice.google.com/*' }))[0] || null;
async function inject(tab) {
  if (Date.now() - (S.lastInject || 0) < 10000) return;
  S.lastInject = Date.now();
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await new Promise((r) => setTimeout(r, 300));
  } catch { /* page not ready or blocked; try again later */ }
}
async function askState(tab) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let r = null;
    try { r = await timeout(chrome.tabs.sendMessage(tab.id, { type: 'GET_STATE' }), 2500, null); } catch { r = null; }
    if (r && r.state) return r.state;
    if (attempt === 0) await inject(tab);
  }
  return 'unknown';
}
async function diagnose() {
  const out = [], box = $('diag');
  $('diagCard').hidden = false; box.value = 'Checking...';
  const tab = await timeout(voiceTab(), 2500, null);
  if (!tab) out.push('No Google Voice tab found. Open voice.google.com in this Chrome window.');
  else {
    out.push('Tab: ' + tab.url);
    let r = null;
    for (let i = 0; i < 2 && !r; i++) {
      try { r = await timeout(chrome.tabs.sendMessage(tab.id, { type: 'DEBUG' }), 3000, null); }
      catch (e) { out.push('Page script not answering: ' + (e.message || e)); }
      if (!r && i === 0) { S.lastInject = 0; await inject(tab); }
    }
    if (!r) out.push('Could not attach to the page. Reload the Google Voice tab (F5) and check again.');
    else {
      out.push('Connected. Detected state: ' + r.state);
      out.push(`End-call button found: ${r.endFound}   Page marker found: ${r.readyFound}   Call button found: ${r.callFound}`);
      out.push('Call detection confirmed by a real call: ' + (S.cfg.detectVerified ? 'yes' : 'not yet'));
      out.push('Page URL: ' + r.url, 'Buttons and links on the page:', ...r.labels.map((l) => '  ' + l));
    }
  }
  box.value = out.join('\n');
}
async function poll() {
  if (S.polling) return;
  S.polling = true;
  try {
    const tab = await timeout(voiceTab(), 2500, null);
    S.gv = tab ? await askState(tab) : 'nogv';
    S.idle = S.gv === 'idle' ? S.idle + 1 : 0;
    if (S.phase === 'dialing' && S.gv === 'oncall') { clearTimeout(S.dog); S.phase = 'oncall'; S.lost = 0; }
    else if (S.phase === 'oncall') {
      if (S.gv === 'oncall') S.lost = 0;
      else if (S.idle >= 2) {                       // idle twice in a row = you hung up
        if (!S.cfg.detectVerified) { S.cfg.detectVerified = true; save(); say('Call detection confirmed. Auto-dial is now available.', 'ok'); }
        endCall();
      } else if (++S.lost >= 10) { endCall(); say('Lost sight of Google Voice, so the call was treated as ended.', 'warn'); }
    }
  } catch { /* keep running */ }
  S.polling = false;
  if (S.cur && S.phase === 'ready' && !S.live[S.cur.mc] && needsLive(S.cur)) safe(verifyCurrent)();
  render();
}

// ---------- calls ----------
function setCall(status, why) {
  const k = ckey();
  const o = S.calls[k] || { mc: S.cur.mc, run: S.run, manual: S.isManual, ts: Date.now() };
  o.status = status; if (why) o.why = why; S.calls[k] = o;
}
function endCall() {
  if (S.cur && !S.calls[ckey()]) setCall('called');
  S.phase = 'wrapup';
  save(); renderStats(); renderSaved();
  if (S.cfg.autoDial && !S.paused) countdown(Math.max(3, Number(S.cfg.delaySec) || 10));
}
function countdown(sec) {
  clearInterval(S.timer);
  S.left = sec;
  S.timer = setInterval(() => {
    if (S.paused || S.phase !== 'wrapup' || !S.cfg.autoDial) { clearInterval(S.timer); S.left = 0; render(); return; }
    if (--S.left <= 0) { clearInterval(S.timer); S.left = 0; safe(go)(); }
    render();
  }, 1000);
}
function fail(msg) {
  clearTimeout(S.dog); clearInterval(S.timer); S.left = 0; S.busy = false;
  if (S.phase === 'dialing') S.phase = 'ready';
  say(msg, 'bad');
  if (S.cfg.autoDial) { S.paused = true; S.msg += ' Auto-dial paused.'; }
  render();
}

// ---------- live FMCSA check ----------
const FM = 'https://mobile.fmcsa.dot.gov/qc/services/';
async function fmcsa(path, signal) {
  const r = await fetch(`${FM}${path}?webKey=${encodeURIComponent(S.cfg.webKey)}`, { signal });
  if (r.status === 401 || r.status === 403) throw new Error('key');
  if (!r.ok) return null;
  return r.json();
}
async function liveCheck(c) {
  const done = (o) => ({ ...o, ts: Date.now() });
  if (!S.cfg.liveCheck && !c.gap) return done({ ok: null, why: 'off' });
  if (!S.cfg.webKey) return done({ ok: null, why: 'nokey' });
  if (!c.dot) return done({ ok: null, why: 'err' });
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
  try {
    const j = await fmcsa(`carriers/${encodeURIComponent(c.dot)}`, ctl.signal);
    const k = j && j.content && (j.content.carrier || j.content);
    if (!k || typeof k !== 'object' || Array.isArray(k)) return done({ ok: null, why: 'err' });
    const com = k.commonAuthorityStatus, con = k.contractAuthorityStatus;
    const def = (x) => x !== undefined && x !== null && x !== '';
    const data = { units: def(k.totalPowerUnits) ? Number(k.totalPowerUnits) : NaN, drivers: def(k.totalDrivers) ? Number(k.totalDrivers) : null,
      city: k.phyCity || '', state: k.phyState || '', country: k.phyCountry || '' };
    if (!def(com) && !def(con) && !def(k.allowedToOperate)) return done({ ok: null, why: 'shape', data });
    if (k.allowedToOperate === 'N') return done({ ok: false, reason: 'FMCSA says it is not allowed to operate', data });
    // skip only on a clear negative: both authority fields present and neither active
    if (def(com) && def(con) && com !== 'A' && con !== 'A') return done({ ok: false, reason: 'its authority is not active', data });
    if (k.brokerAuthorityStatus === 'A') return done({ ok: false, reason: 'it also has broker authority', data });
    let gf = null, cargo = [];
    try {
      const cj = await fmcsa(`carriers/${encodeURIComponent(c.dot)}/cargo-carried`, ctl.signal);
      const txt = JSON.stringify((cj && cj.content) || '');
      cargo = [...txt.matchAll(/"cargoClassDesc"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
      if (txt.length > 5) gf = /general freight/i.test(txt);
    } catch (e) { if (e.message === 'key') throw e; }
    if (gf === false) return done({ ok: false, reason: 'live data says General Freight is not ticked', data, cargo });
    return done({ ok: true, gf, data, cargo });
  } catch (e) { return done({ ok: null, why: e.message === 'key' ? 'badkey' : 'err' }); }
  finally { clearTimeout(t); }
}
// brand-new carriers (not in the census yet) get their fleet size, drivers and cargo from the live answer
function applyLive(c, v) {
  if (!c.gap || c.enriched || !v || !v.data) return;
  if (Number.isFinite(v.data.units)) { c.units = v.data.units; c.enriched = true; }
  if (v.data.drivers !== null && Number.isFinite(v.data.drivers)) c.drivers = v.data.drivers;
  if (v.cargo && v.cargo.length) c.cargo = v.cargo;
  if (!c.city && v.data.city) c.city = v.data.city;
  if (v.data.state && v.data.state.length === 2) c.state = v.data.state.toUpperCase();
}
function rejectReason(c, v) {
  if (v && v.ok === false) return v.reason;
  if (c.gap && c.enriched) {
    if (!LOWER48.has(c.state)) return `it is based outside the 48 states (${c.state || '?'})`;
    if (c.units < S.cfg.minFleet || c.units > S.cfg.maxFleet) return `fleet size ${c.units} is outside your ${S.cfg.minFleet}–${S.cfg.maxFleet} range`;
  }
  return '';
}
const needsLive = (c) => !!S.cfg.webKey && (S.cfg.liveCheck || !!c.gap);
async function verifyCurrent() {
  if (S.verifying || !S.cur || !needsLive(S.cur)) return;
  S.verifying = true;
  try {
    for (let i = 0; i < 50 && S.cur && S.phase === 'ready' && needsLive(S.cur); i++) {
      const c = S.cur;
      if (!S.live[c.mc]) { S.live[c.mc] = await liveCheck(c); applyLive(c, S.live[c.mc]); }
      const v = S.live[c.mc];
      if (S.cur !== c) continue;
      const why = rejectReason(c, v);
      if (why && !S.isManual) {
        if (!S.calls[ckey()]) setCall('skipped', 'live: ' + why);
        nextCarrier();
        say(`Live check skipped ${c.name}: ${why}.`, 'warn');
        save(); renderStats();
        continue;
      }
      break;
    }
  } finally { S.verifying = false; render(); }
}

// ---------- dialing ----------
async function go() {                       // advance if needed, then dial
  if (S.busy) return;
  if (S.phase === 'wrapup') nextCarrier();
  if (!S.cur) return render();
  await dial();
}
async function dial() {
  const c = S.cur;
  if (!c || S.busy) return;
  if (S.phase === 'dialing' || S.phase === 'oncall') return fail('A call is already in progress. Not dialing.');
  S.busy = true; say('');
  const tab = await timeout(voiceTab(), 2500, null);
  if (!tab) return fail('Open voice.google.com in a Chrome tab and sign in first.');
  const st = await askState(tab);             // fresh check right before dialing
  if (st === 'oncall') return fail('You are on a call. Not dialing.');
  if (st !== 'idle') return fail('Cannot read Google Voice yet (still loading, or button names changed). Not dialing.');
  if (!PHONE_OK.test(c.phone)) return fail('This number is not a valid US number. Skipped.');
  if (!S.isManual) {
    let v = S.live[c.mc];
    if (needsLive(c) && !(v && Date.now() - v.ts < 600000)) { v = S.live[c.mc] = await liveCheck(c); applyLive(c, v); }
    const why = v ? rejectReason(c, v) : '';
    if (why) {
      if (!S.calls[ckey()]) setCall('skipped', 'live: ' + why);
      S.busy = false; nextCarrier();
      say(`Skipped ${c.name}: ${why}.`, 'warn');
      render(); renderStats();
      if (S.cfg.autoDial && !S.paused && S.cur) return go();
      return;
    }
    if (v && v.ok === null && (S.cfg.liveCheck || c.gap)) say('Live check could not run, so this one was dialed without it.', 'warn');
  }
  await chrome.storage.local.set({ pendingDial: { number: c.phone, ts: Date.now(), dry: S.cfg.dryRun } });
  S.phase = 'dialing';
  S.dog = setTimeout(() => { if (S.phase === 'dialing') fail(S.cfg.dryRun
    ? 'Test mode: number loaded, Call was not pressed.'
    : 'Could not confirm the call started. Check the Google Voice tab.'); }, S.cfg.dryRun ? 60000 : 25000);
  if (S.cfg.dryRun) say('Test mode: number loaded. Press Call yourself.', 'info');
  try {
    await chrome.tabs.update(tab.id, { url: `https://voice.google.com/u/0/calls?a=nc,%2B1${c.phone}` });
  } catch { return fail('Could not open the Google Voice tab.'); }
  S.busy = false;
  render();
}

// ---------- actions ----------
function outcome(status) {
  if (!S.cur) return;
  setCall(status);
  if (status === 'dnc') saveLead('dnc', '');
  if (S.phase === 'ready' && !S.isManual) nextCarrier();
  save(); render(); renderStats(); renderSaved();
}
function skip() {
  if (!S.cur || S.phase === 'dialing' || S.phase === 'oncall') return;
  if (!S.isManual && !S.calls[ckey()]) setCall('skipped');
  clearInterval(S.timer); S.left = 0;
  nextCarrier(); render(); renderStats();
}
function togglePause() {
  S.paused = !S.paused;
  if (S.paused) { clearInterval(S.timer); S.left = 0; }
  else if (S.cfg.autoDial && S.phase === 'wrapup') countdown(3);
  render();
}
function setAuto(on) {
  if (on && !S.cfg.detectVerified) {
    say('Auto-dial unlocks after Dispatchio has seen one complete call. Dial one carrier and hang up first.', 'warn');
    S.cfg.autoDial = false;
  } else S.cfg.autoDial = on;
  if (!S.cfg.autoDial) { clearInterval(S.timer); S.left = 0; }
  save(); render();
}
function saveLead(type, date) {
  const c = S.cur; if (!c) return;
  const prev = S.leads[c.mc] || {};
  const d = date === undefined ? ($('followDate').value || prev.followDate || '') : date;
  S.leads[c.mc] = { type, followDate: d, ts: prev.ts || Date.now(), carrier: c };
  save(); render(); renderSaved();
}
function unsave(mc) {
  const m = mc || (S.cur && S.cur.mc); if (!m) return;
  delete S.leads[m];
  say('Removed from saved. It can be dialed automatically again.', 'info');
  save(); render(); renderSaved();
}
async function openCarrier(c, dialNow) {
  if (S.phase === 'dialing' || S.phase === 'oncall') { say('Finish the current call first.', 'warn'); return render(); }
  if (S.cur && S.phase === 'ready' && !S.isManual) S.parked = S.cur;
  clearInterval(S.timer); S.left = 0;
  S.cur = c; S.isManual = true; S.phase = 'ready';
  save(); render();
  if (dialNow) await go();
}
function jump() {
  const v = Number($('jumpMc').value);
  if (!Number.isInteger(v) || v <= 0) { say('Enter an MC number, for example 1300000.', 'warn'); return render(); }
  if (S.phase === 'dialing' || S.phase === 'oncall') { say('Finish the current call first.', 'warn'); return render(); }
  if (!S.queue.length) { say('Load queue.json first, then jump to an MC.', 'warn'); return render(); }
  const i = S.queue.findIndex((c) => Number(c.mc) >= v);
  if (i < 0) { say(`No qualifying carriers at or after MC ${v}. That number may be higher than the newest MC in FMCSA's data. Try a lower one.`, 'warn'); return render(); }
  const b = blockOf(v);
  const repeat = Object.values(S.calls).some((l) => l.run === S.run && !l.manual && blockOf(l.mc) === b);
  if (repeat) S.run++;
  S.parked = null; clearInterval(S.timer); S.left = 0;
  S.idx = i; nextCarrier();
  say((S.cur ? `Jumped to MC ${S.cur.mc}.` : 'No eligible carriers from that MC on.') + (repeat ? ` Repeating this block: starting pass ${S.run}.` : ''), 'ok');
  render(); renderStats();
}
function setFleet(min, max) {
  let a = Number.isFinite(min) && min >= 0 ? Math.floor(min) : S.cfg.minFleet;
  let b = Number.isFinite(max) && max >= 0 ? Math.floor(max) : S.cfg.maxFleet;
  if (a > b) { say('Min trucks cannot be above max trucks. Adjusted.', 'warn'); a = b; }
  S.cfg.minFleet = a; S.cfg.maxFleet = b;
  if ((S.phase === 'ready' && !S.isManual) || S.phase === 'done') { S.parked = null; S.idx = 0; nextCarrier(); }
  save(); render();
}
function infoText(c) {
  return [
    c.name + (c.dba ? ` (DBA ${c.dba})` : ''),
    `MC ${c.mc} | DOT ${c.dot}`,
    `Phone: ${fmtPhone(c.phone)}`,
    c.email && `Email: ${c.email}`,
    c.owner && `Owner/Officer: ${c.owner}`,
    `Fleet: ${c.units} trucks, ${c.drivers ?? '?'} drivers`,
    `Address: ${[c.street, c.city, c.state, c.zip].filter(Boolean).join(', ')}`,
    S.notes[c.mc] && `Note: ${S.notes[c.mc]}`,
  ].filter(Boolean).join('\n');
}
async function copyText(t, ok) {
  try { await navigator.clipboard.writeText(t); say(ok || 'Copied.', 'ok'); }
  catch { say('Copy failed. Click inside the panel and try again.', 'bad'); }
  render();
}

// ---------- exports, backup ----------
const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
function downloadFile(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/csv' }));
  a.download = name; a.click();
}
const csv = (name, lines) => downloadFile(`${name}-${todayISO()}.csv`, lines.join('\r\n'));
function exportCalls() {
  const cols = ['status', 'called_at', 'pass', 'manual', 'mc', 'dot', 'name', 'phone', 'email', 'owner', 'city', 'state', 'units', 'drivers', 'note'];
  const rows = Object.values(S.calls).sort((a, b) => a.ts - b.ts).map((l) => { const c = carrierOf(l.mc);
    return [l.status, new Date(l.ts).toLocaleString(), l.run, l.manual ? 'yes' : '', l.mc, c.dot, c.name, c.phone, c.email, c.owner, c.city, c.state, c.units, c.drivers, S.notes[l.mc]].map(q).join(','); });
  csv('call-log', [cols.join(','), ...rows]);
}
function exportSaved() {
  const cols = ['type', 'follow_up_date', 'mc', 'dot', 'name', 'phone', 'email', 'owner', 'city', 'state', 'note', 'saved_at'];
  const rows = Object.entries(S.leads).map(([mc, l]) => { const c = l.carrier || {};
    return [TYPES[l.type], l.followDate, mc, c.dot, c.name, c.phone, c.email, c.owner, c.city, c.state, S.notes[mc], new Date(l.ts).toLocaleString()].map(q).join(','); });
  csv('saved-carriers', [cols.join(','), ...rows]);
}
function exportStats() {
  const cols = ['block_start', 'pass', 'first_call', 'last_mc_called', 'called', 'picked_up', 'pickup_rate', 'interested', 'callback', 'unmarked'];
  const rows = stats().rows.map((o) => { const m = o.called - o.unmarked;
    return [o.block, o.run, new Date(o.first).toLocaleDateString(), o.last, o.called, o.picked, pct(o.picked, m), o.interested, o.callback, o.unmarked].map(q).join(','); });
  csv('mc-block-stats', [cols.join(','), ...rows]);
}
function backup() {
  const { webKey, groqKey, orKey, ...cfg } = S.cfg;
  downloadFile(`dispatchio-backup-${todayISO()}.json`, JSON.stringify({ app: 'dispatchio', version: 1, exportedAt: new Date().toISOString(), cfg, calls: S.calls, leads: S.leads, notes: S.notes, run: S.run }), 'application/json');
  say('Backup saved to your Downloads folder.', 'ok'); render();
}
async function restore(file) {
  if (!file) return;
  let o;
  try { o = JSON.parse(await file.text()); } catch { o = null; }
  if (!o || o.app !== 'dispatchio' || typeof o.calls !== 'object' || typeof o.leads !== 'object') { say('That file is not a Dispatchio backup.', 'bad'); return render(); }
  if (!confirm('Restore this backup? It replaces your current call history, saved carriers, notes and settings (API keys are kept).')) return;
  const keep = { webKey: S.cfg.webKey, groqKey: S.cfg.groqKey, orKey: S.cfg.orKey };
  S.cfg = { ...DEF, ...(o.cfg || {}), ...keep }; S.calls = o.calls || {}; S.leads = o.leads || {}; S.notes = o.notes || {}; S.run = o.run || 1;
  S.idx = 0; S.parked = null; S.live = {}; S.assist = {};
  nextCarrier(); applyCfg(); fillSettings();
  say('Backup restored.', 'ok'); render(); renderStats(); renderSaved();
}
async function refreshStorage() {
  let used = '';
  try { const b = await chrome.storage.local.getBytesInUse(null); used = `${(b / 1048576).toFixed(1)} MB used. `; } catch { /* ignore */ }
  $('storageInfo').textContent = `${used}${num(Object.keys(S.calls).length)} calls, ${num(Object.keys(S.leads).length)} saved carriers, ${num(Object.keys(S.notes).length)} notes. Stored on this computer only.`;
}

// ---------- stats ----------
function tween(el, to) {
  const from = Number(el.dataset.v || 0); el.dataset.v = to;
  const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (from === to || still || !window.requestAnimationFrame) { el.textContent = num(to); return; }
  const t0 = performance.now(), d = 480;
  const step = (t) => { const p = Math.min(1, (t - t0) / d), e = 1 - Math.pow(1 - p, 3); el.textContent = num(Math.round(from + (to - from) * e)); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
const PICKED = new Set(['interested', 'callback', 'notinterested', 'dnc']);
const since = () => { const d = new Date(); if (S.range === 'today') { d.setHours(0, 0, 0, 0); return d.getTime(); } return S.range === 'week' ? Date.now() - 7 * 864e5 : 0; };
function stats() {
  const B = {}, t = { total: 0, picked: 0, interested: 0, callback: 0, liveSkips: 0 }, from = since();
  for (const l of Object.values(S.calls)) {
    if (l.status === 'skipped' && l.ts >= from && /^live/.test(l.why || '')) t.liveSkips++;
    if (l.status === 'skipped' || l.ts < from) continue;
    t.total++;
    if (PICKED.has(l.status)) t.picked++;
    if (l.status === 'interested') t.interested++;
    if (l.status === 'callback') t.callback++;
    if (l.manual) continue;
    const b = blockOf(l.mc), k = `${b}|${l.run}`;
    const o = B[k] || (B[k] = { block: b, run: l.run, first: l.ts, last: 0, called: 0, picked: 0, interested: 0, callback: 0, unmarked: 0 });
    o.called++; o.last = Math.max(o.last, Number(l.mc)); o.first = Math.min(o.first, l.ts);
    if (PICKED.has(l.status)) o.picked++;
    if (l.status === 'interested') o.interested++;
    else if (l.status === 'callback') o.callback++;
    else if (l.status === 'called') o.unmarked++;
  }
  return { totals: t, rows: Object.values(B).sort((a, b) => a.block - b.block || a.run - b.run) };
}
const pct = (n, d) => (d ? Math.round((n / d) * 100) + '%' : '-');
function renderStats() {
  $('bs').textContent = S.cfg.blockSize;
  const { totals: t, rows } = stats();
  $('liveSkips').textContent = t.liveSkips ? `${num(t.liveSkips)} carrier${t.liveSkips > 1 ? 's' : ''} skipped by the live FMCSA check in this range.` : '';
  tween($('sTotal'), t.total); tween($('sPicked'), t.picked); tween($('sInt'), t.interested); tween($('sCb'), t.callback);
  const tb = $('stats'); tb.textContent = '';
  const head = tb.insertRow();
  for (const h of ['Block', 'Called', 'Picked up', 'Interested', 'Call back', 'Unmarked']) { const th = document.createElement('th'); th.textContent = h; head.append(th); }
  for (const o of rows) {
    const marked = o.called - o.unmarked, r = tb.insertRow();
    [null, o.called, `${o.picked} (${pct(o.picked, marked)})`, `${o.interested} (${pct(o.interested, marked)})`, `${o.callback} (${pct(o.callback, marked)})`, o.unmarked].forEach((v, i) => {
      const td = r.insertCell();
      if (i === 0) { td.textContent = num(o.block); const sm = document.createElement('small'); sm.textContent = `pass ${o.run}, ${new Date(o.first).toLocaleDateString()}, to MC ${o.last}`; td.append(sm); }
      else td.textContent = v;
    });
  }
  if (!rows.length) { const td = tb.insertRow().insertCell(); td.colSpan = 6; td.textContent = 'No calls in this range.'; }
}

// ---------- saved carriers ----------
const isDue = (l) => l.type === 'followup' && l.followDate && l.followDate <= todayISO();
function renderSaved() {
  const all = Object.entries(S.leads), ul = $('savedList');
  $('savedCount').textContent = all.length;
  document.querySelectorAll('#savedTabs button').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.f === S.savedTab));
    b.querySelector('i').textContent = all.filter(([, l]) => l.type === b.dataset.f).length;
  });
  ul.textContent = '';
  const items = all.filter(([, l]) => l.type === S.savedTab)
    .sort(([, a], [, b]) => (isDue(b) - isDue(a)) || String(a.followDate || '9').localeCompare(String(b.followDate || '9')) || b.ts - a.ts);
  const va = $('savedViewAll'); va.hidden = items.length <= 5; va.firstChild.textContent = S.savedAll ? 'Show Less ' : 'View All ';
  if (!items.length) { const li = document.createElement('li'); li.className = 'muted'; li.textContent = 'Nothing saved here yet.'; ul.append(li); return; }
  for (const [mc, l] of (S.savedAll ? items : items.slice(0, 5))) {
    const c = l.carrier || { mc }, li = document.createElement('li');
    const r = document.createElement('div'); r.className = 'srow';
    const ic = document.createElement('span'); ic.className = 'tileic'; ic.dataset.icon = 'building'; ic.dataset.size = '16';
    const who = document.createElement('div'); who.className = 'who';
    const b = document.createElement('b'); b.textContent = c.name || `MC ${mc}`;
    const sp = document.createElement('span'); sp.textContent = `MC ${mc}  •  ${fmtPhone(c.phone)}`;
    who.append(b, sp);
    const bd = document.createElement('span'); bd.className = 'badge ' + l.type; bd.textContent = TYPES[l.type];
    const kb = document.createElement('button'); kb.className = 'icon-btn sm'; kb.dataset.icon = 'ellipsis'; kb.dataset.size = '16'; kb.setAttribute('aria-label', 'Actions for ' + (c.name || mc)); kb.setAttribute('aria-expanded', String(S.rowOpen === mc));
    kb.onclick = safe(() => { S.rowOpen = S.rowOpen === mc ? null : mc; renderSaved(); });
    r.append(ic, who, bd, kb); li.append(r);
    if (S.rowOpen === mc) {
      const ex = document.createElement('div'); ex.className = 'sextra';
      if (l.followDate) { const e = document.createElement('div'); e.className = isDue(l) ? 'due' : 'muted small'; e.textContent = `Follow up: ${l.followDate}${isDue(l) ? ' (due)' : ''}`; ex.append(e); }
      if (S.notes[mc]) { const n = document.createElement('div'); n.className = 'note'; n.textContent = S.notes[mc]; ex.append(n); }
      const row = document.createElement('div'); row.className = 'row';
      const mk = (txt, ic2, cls, fn) => { const bt = document.createElement('button'); bt.className = 'btn sm ' + cls; bt.dataset.icon = ic2; bt.dataset.size = '14'; bt.append(' ' + txt); bt.onclick = safe(fn); return bt; };
      row.append(mk('Call', 'phone-solid', 'dark', () => openCarrier(c, true)), mk('Open', 'external', '', () => openCarrier(c, false)), mk('Remove', 'trash', 'danger-text', () => unsave(mc)));
      ex.append(row); li.append(ex);
    }
    ul.append(li);
  }
  hydrateIcons(ul);
}

// ---------- Dispatchio Assist ----------
const hasKeys = () => !!(S.cfg.groqKey || S.cfg.orKey);
function localInsights(c) {
  const f = [], hist = Object.values(S.calls).filter((l) => l.mc === c.mc && l.status !== 'skipped').sort((a, b) => b.ts - a.ts);
  if (hist.length) f.push(`Called ${hist.length} time${hist.length > 1 ? 's' : ''} before. Last: ${OUT[hist[0].status] || hist[0].status}, ${daysAgo(hist[0].ts)}.`);
  const lead = S.leads[c.mc];
  if (lead) f.push(`Saved as ${TYPES[lead.type]}${lead.followDate ? `, follow up ${lead.followDate}` : ''}.`);
  if (S.notes[c.mc]) f.push('Your note: ' + (S.notes[c.mc].length > 90 ? S.notes[c.mc].slice(0, 90) + '…' : S.notes[c.mc]));
  if (c.gap && !c.enriched) f.push('Brand-new carrier, not in the FMCSA census yet. Fleet size and cargo are unconfirmed' + (S.cfg.webKey ? '.' : ', so add your FMCSA key to verify them live.'));
  const units = Number(c.units);
  if (c.units !== null && c.units !== undefined && units === 0) f.push('FMCSA lists 0 trucks. This is often a reporting gap, so ask about their real fleet.');
  else if (c.units !== null && c.units !== undefined && units === 1) f.push('Single-truck operation, likely an owner-operator.');
  const added = Date.parse(c.added), upd = Date.parse(c.mcs150);
  if (!isNaN(added) && Date.now() - added < 365 * 864e5) f.push(`Newer registration (record added ${Math.max(1, Math.round((Date.now() - added) / 2629800000))} months ago).`);
  if (!isNaN(upd) && Date.now() - upd > 730 * 864e5) f.push(`FMCSA record last updated ${Math.floor((Date.now() - upd) / 31557600000)} years ago, so details may be out of date.`);
  if (c.phone2) f.push('A second phone number is on file.');
  return f.slice(0, 4);
}
function factsFor(c) {
  const hist = Object.values(S.calls).filter((l) => l.mc === c.mc && l.status !== 'skipped').sort((a, b) => b.ts - a.ts);
  const yrs = (d) => { const t = Date.parse(d); return isNaN(t) ? null : Math.round((Date.now() - t) / 31557600000 * 10) / 10; };
  return { company: c.name, city: c.city, state: c.state, trucks: c.units, drivers: c.drivers, officer: c.owner || null,
    cargo: (c.cargo || []).slice(0, 8), hazmat: !!c.hazmat, operation: OPS[c.op] || c.op || null,
    yearsSinceRecordAdded: yrs(c.added), yearsSinceLastUpdate: yrs(c.mcs150),
    previousCalls: hist.length ? { count: hist.length, last: OUT[hist[0].status], when: daysAgo(hist[0].ts) } : null,
    dispatcherNote: S.notes[c.mc] || null };
}
async function genBrief(c) {
  if (!hasKeys() || S.cfg.aiMode === 'off') return;
  S.assist[c.mc] = { status: 'loading' }; render();
  try {
    const r = await AI.brief(S.cfg, factsFor(c));
    S.assist[c.mc] = { status: 'done', summary: r.summary, opener: r.opener, raw: r.text, provider: r.provider, model: r.model };
  } catch (e) { S.assist[c.mc] = { status: 'error', err: e.message }; }
  render();
}
async function genNote() {
  const c = S.cur, note = c && S.notes[c.mc];
  if (!c || !note || !hasKeys()) return;
  S.noteSum[c.mc] = { status: 'loading' }; render();
  try { const r = await AI.noteSummary(S.cfg, note); S.noteSum[c.mc] = { status: 'done', summary: r.summary, follow: r['follow-up'], raw: r.text }; }
  catch (e) { S.noteSum[c.mc] = { status: 'error', err: e.message }; }
  render();
}
function useNoteSummary() {
  const c = S.cur, ns = c && S.noteSum[c.mc]; if (!ns || ns.status !== 'done') return;
  const add = `\nSummary: ${ns.summary || ns.raw}${ns.follow ? `\nFollow-up: ${ns.follow}` : ''}`;
  S.notes[c.mc] = ((S.notes[c.mc] || '') + add).slice(0, 500);
  $('note').value = S.notes[c.mc]; $('noteCount').textContent = `${S.notes[c.mc].length} / 500`;
  saveSoon(); render();
}
function labeled(p, pairs) {
  p.textContent = '';
  pairs.forEach(([k, v], i) => { if (!v) return; if (i && p.childNodes.length) p.append('\n'); const b = document.createElement('b'); b.textContent = k + ': '; p.append(b, v); });
}
function renderAssist() {
  const c = S.cur, box = $('assist');
  box.classList.toggle('collapsed', !!S.assistCollapsed); $('assistToggle').setAttribute('aria-expanded', String(!S.assistCollapsed));
  const mode = S.cfg.aiMode, keys = hasKeys();
  if (!c) { box.hidden = true; return; }
  const facts = localInsights(c), a = S.assist[c.mc], ns = S.noteSum[c.mc];
  const aiOn = mode !== 'off';
  if (!facts.length && !aiOn) { box.hidden = true; return; }
  box.hidden = false;
  const key = facts.join('|'); if (box._k !== key) { box._k = key; const ul = $('assistFacts'); ul.textContent = ''; facts.forEach((t) => { const li = document.createElement('li'); li.textContent = t; ul.append(li); }); }
  const p = $('assistAI'); p.className = 'assist-ai' + ((a && a.status === 'loading') || (!a && mode === 'auto' && keys) ? ' loading' : '');
  if (!aiOn) { p.textContent = ''; }
  else if (!keys) p.textContent = 'Add a Groq or OpenRouter key in Settings to get a brief and a suggested opener.';
  else if (!a) p.textContent = mode === 'auto' ? 'Preparing brief…' : 'Press the refresh button for a quick brief and a suggested opener.';
  else if (a.status === 'loading') p.textContent = 'Preparing brief…';
  else if (a.status === 'error') { p.className = 'assist-ai err'; p.textContent = 'Could not reach an AI provider. ' + a.err; }
  else if (a.summary || a.opener) labeled(p, [['Summary', a.summary], ['Opener', a.opener]]); else p.textContent = a.raw;
  $('assistSrc').textContent = a && a.status === 'done' ? `${a.provider} · ${a.model.split('/').pop()}` : '';
  $('assistGen').hidden = !(aiOn && keys);
  const note = S.notes[c.mc] || '';
  $('assistNoteRow').hidden = !(aiOn && keys && note.length >= 15);
  $('assistNote').disabled = !!(ns && ns.status === 'loading');
  $('assistUse').hidden = !(ns && ns.status === 'done');
  const p2 = $('assistAI2'); p2.className = 'assist-ai';
  if (ns && ns.status === 'loading') p2.textContent = 'Summarizing your note…';
  else if (ns && ns.status === 'error') { p2.className = 'assist-ai err'; p2.textContent = 'Note summary failed. ' + ns.err; }
  else if (ns && ns.status === 'done') labeled(p2, [['Note summary', ns.summary || ns.raw], ['Follow-up', ns.follow]]); else p2.textContent = '';
  // automatic brief, only after the carrier has been on screen for a moment
  if (aiOn && mode === 'auto' && keys && !a && S.briefFor !== c.mc) {
    S.briefFor = c.mc; clearTimeout(S.briefTimer);
    S.briefTimer = setTimeout(() => { if (S.cur && S.cur.mc === c.mc && !S.assist[c.mc]) safe(genBrief)(c); }, 1200);
  }
}

// ---------- rendering ----------
function age(d) {
  const t = Date.parse(d);
  if (!d || isNaN(t)) return null;
  const m = Math.max(0, Math.floor((Date.now() - t) / 2629800000));
  return { months: m, text: m >= 12 ? `${Math.floor(m / 12)} yr ${m % 12} mo` : `${m} mo` };
}
function row(dl, k, v, cls) {
  const dt = document.createElement('dt'), dd = document.createElement('dd');
  dt.textContent = k; dd.textContent = v; if (cls) dd.className = cls; dl.append(dt, dd);
}
const GV = { nogv: ['Open Google Voice', 'bad'], unknown: ['Voice not readable', 'warn'], idle: ['Google Voice Connected', 'ok'], oncall: ['On a call', 'call'] };
const VIEWS = ['calling', 'queue', 'saved', 'stats', 'settings'];

function setTab(t) {
  S.tab = VIEWS.includes(t) ? t : 'calling';
  VIEWS.forEach((v) => { $('v-' + v).hidden = v !== S.tab; });
  document.querySelectorAll('#mainTabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === S.tab)));
  const ti = ['calling', 'queue', 'saved', 'stats'].indexOf(S.tab); $('mainTabs').style.setProperty('--ti', Math.max(ti, 0)); $('mainTabs').classList.toggle('noind', ti < 0);
  $('fleetMenu').hidden = true; $('fleetChip').setAttribute('aria-expanded', 'false');
  if (S.tab === 'stats') renderStats();
  if (S.tab === 'saved') renderSaved();
  if (S.tab === 'settings') refreshStorage();
  render(); window.scrollTo(0, 0);
}

function render() {
  // header
  const [gt, gc] = GV[S.gv] || GV.unknown;
  $('gvText').textContent = gt; $('gvDot').className = 'dot ' + gc;
  const t0 = new Date().toDateString();
  const done = Object.values(S.calls).filter((l) => l.status !== 'skipped' && new Date(l.ts).toDateString() === t0).length;
  const due = Object.values(S.leads).filter(isDue).length;
  $('kToday').textContent = `${done}${S.cfg.dailyGoal ? ' / ' + S.cfg.dailyGoal : ''} call${done === 1 && !S.cfg.dailyGoal ? '' : 's'}`;
  $('kDue').textContent = `${due} due`;

  // banner
  const bn = $('banner');
  bn.hidden = !S.msg; bn.className = 'banner ' + (S.kind === 'info' ? '' : S.kind);
  if (S.msg) { $('bannerText').textContent = S.msg; setIcon($('bannerIcon'), { ok: 'circle-check', warn: 'triangle-alert', bad: 'circle-alert', info: 'info' }[S.kind] || 'info', 16); }

  // queue
  const hasQ = S.queue.length > 0, z = Number(S.cfg.blockSize) || 10000;
  $('queueCard').hidden = !hasQ;
  $('emptyCard').hidden = !(S.phase === 'empty' || (S.phase === 'done' && !S.cur));
  if (!$('emptyCard').hidden) {
    const dn = S.phase === 'done';
    $('emptyTitle').textContent = dn ? 'No more carriers match' : 'No call list loaded';
    $('emptyText').textContent = dn ? 'Change the truck limits, jump to another MC, or load a new queue.' : 'Three quick steps and you are calling.';
    $('steps').hidden = dn;
    const st = { queue: hasQ, voice: S.gv === 'idle' || S.gv === 'oncall', call: !!S.cfg.detectVerified };
    document.querySelectorAll('#steps li').forEach((li) => li.classList.toggle('done', !!st[li.dataset.step]));
  }
  const fleetTxt = S.cfg.maxFleet >= 9999 ? (S.cfg.minFleet ? `${S.cfg.minFleet}+ Trucks` : 'Any Fleet Size') : `${S.cfg.minFleet}–${S.cfg.maxFleet} Trucks`;
  $('qTitle').textContent = 'Queue Loaded'; $('fleetText').textContent = fleetTxt;
  $('qcState').textContent = hasQ ? `Loaded · ${num(S.queue.length)}` : 'No queue';
  let p = 0;
  if (S.cur) {
    const b = blockOf(S.cur.mc);
    const key = `${S.cur.mc}|${Object.keys(S.calls).length}|${Object.keys(S.leads).length}|${S.cfg.minFleet}|${S.cfg.maxFleet}|${z}|${S.run}`;
    if (S.bkey !== key) {
      S.bkey = key;
      S.bleft = S.queue.filter((c) => blockOf(c.mc) === b && eligible(c)).length;
      S.bdone = Object.values(S.calls).filter((l) => l.run === S.run && !l.manual && blockOf(l.mc) === b).length;
    }
    const tot = S.bleft + S.bdone; p = tot ? Math.round((S.bdone / tot) * 100) : 0;
    const range = `${num(b)} – ${num(b + z - 1)}`;
    $('blockText').textContent = `MC Block: ${range}`; $('passText').textContent = '';
    $('leftText').textContent = `${num(S.bleft)} remaining`; $('qcBlock').textContent = range;
    $('qcLeft').textContent = `${num(S.bleft)} carriers remaining`; $('qcPct').textContent = `${p}%`;
    $('fpText').textContent = `${num(S.bdone)} / ${num(tot)}`; $('fpPass').firstChild.textContent = `Pass ${S.run} `;
  } else { ['blockText', 'passText', 'leftText', 'qcBlock', 'qcLeft', 'qcPct', 'fpText'].forEach((i) => { $(i).textContent = i === 'qcBlock' ? '—' : ''; }); }
  for (const id of ['progFill', 'qcFill', 'fpFill']) $(id).style.width = p + '%';
  $('prog').setAttribute('aria-valuenow', p);
  const showFoot = S.tab === 'calling' && !!S.cur && hasQ;
  $('footProg').hidden = !showFoot; document.body.classList.toggle('hasfoot', showFoot);
  document.querySelectorAll('[data-min]').forEach((el) => {
    const on = Number(el.dataset.min) === S.cfg.minFleet && Number(el.dataset.max) === S.cfg.maxFleet;
    if (el.classList.contains('pill')) el.setAttribute('aria-pressed', String(on)); else el.setAttribute('aria-checked', String(on));
  });
  for (const k of ['minFleet', 'maxFleet']) if (document.activeElement !== $(k)) $(k).value = S.cfg[k];

  // carrier
  $('carrier').hidden = !S.cur; $('actions').hidden = !S.cur;
  if (S.cur) {
    const c = S.cur, lead = S.leads[c.mc], lv = S.live[c.mc];
    $('name').textContent = (c.name || 'Unknown carrier') + (c.dba ? ` (${c.dba})` : '');
    $('ids').textContent = `MC ${c.mc}  •  DOT ${c.dot ?? ''}`;
    $('manualTag').hidden = !S.isManual;
    const vc = $('verChip'); let vt = 'Census data', vcl = 'chip', vtt = 'From FMCSA daily files. Turn on the live check in Settings to verify authority before each call.';
    if (c.gap && !c.enriched) { vt = S.cfg.webKey ? (lv && lv.ok !== false ? 'Unverified' : 'Checking…') : 'Not in census yet'; vcl = 'chip warn'; vtt = 'Brand-new carrier. Fleet size and cargo are not in FMCSA\'s census yet' + (S.cfg.webKey ? '' : '. Add your FMCSA key in Settings to verify them live.'); }
    else if (S.cfg.liveCheck && S.cfg.webKey) {
      if (!lv) { vt = 'Checking…'; vtt = 'Asking FMCSA live'; }
      else if (lv.ok === true) { vt = 'Verified'; vcl = 'chip ok'; vtt = 'FMCSA live check: authority active' + (lv.gf ? ', General Freight confirmed' : ''); }
      else if (lv.ok === false) { vt = 'Not authorized'; vcl = 'chip bad'; vtt = lv.reason; }
      else { vt = lv.why === 'badkey' ? 'Key rejected' : 'Unverified'; vcl = 'chip warn'; vtt = lv.why === 'badkey' ? 'FMCSA rejected the webKey. Check it in Settings.' : 'FMCSA did not give a clear answer, so this carrier was kept'; }
    }
    vc.className = vcl; vc.title = vtt; $('verText').textContent = vt;
    $('phone').textContent = fmtPhone(c.phone);
    $('fleet').textContent = c.units === null || c.units === undefined ? '— Trucks' : `${c.units} Trucks`; $('drivers').textContent = `${c.drivers ?? '—'} Drivers`;
    $('owner').textContent = c.owner || '—'; $('loc').textContent = [c.city, c.state].filter(Boolean).join(', ') || '—'; $('email').textContent = c.email || '—';
    const more = $('more'); more.textContent = '';
    const a = age(c.added), m = age(c.mcs150);
    row(more, 'Address', [c.street, `${c.city ?? ''}, ${c.state ?? ''} ${c.zip ?? ''}`].filter(Boolean).join(', '));
    row(more, 'Record added', a ? `${c.added} (${a.text} ago)` : '—');
    row(more, 'Last update', m ? `${c.mcs150} (${m.text} ago)${m.months > 24 ? ' · stale' : ''}` : '—', m && m.months > 24 ? 'stale' : '');
    row(more, 'Operation', OPS[c.op] || c.op || '—'); row(more, 'Class', c.cls || '—'); row(more, 'Hazmat', c.hazmat ? 'Yes' : 'No');
    row(more, 'Cargo', (c.cargo && c.cargo.length) ? c.cargo.join(', ') : 'General freight');
    if (c.phone2) row(more, 'Other phone', fmtPhone(c.phone2));
    $('safer').href = `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT&query_string=${encodeURIComponent(c.dot ?? '')}`;
    const sk = c.mc + (S.isManual ? 'm' : '');
    if (S.shown !== sk) {                       // reset inputs only when the carrier changes
      S.shown = sk; const cc = $('carrier'); cc.classList.remove('swap'); void cc.offsetWidth; cc.classList.add('swap');
      $('note').value = S.notes[c.mc] || ''; $('noteCount').textContent = `${($('note').value || '').length} / 500`;
      $('followDate').value = (lead && lead.followDate) || '';
    }
    const tg = $('savedTag'); tg.hidden = !lead; if (lead) tg.textContent = `Saved as ${TYPES[lead.type]}${lead.followDate ? `, follow up ${lead.followDate}` : ''}. Not dialed automatically.`;
    $('unsave').hidden = !lead;
    document.querySelectorAll('#saveAs button').forEach((bn) => bn.setAttribute('aria-pressed', String(!!lead && lead.type === bn.dataset.t)));
    const cl = S.calls[ckey()];
    document.querySelectorAll('#outcomes button').forEach((bn) => bn.setAttribute('aria-pressed', String(!!cl && cl.status === bn.dataset.o)));
  }
  renderAssist();

  // dial area
  const locked = S.phase === 'dialing' || S.phase === 'oncall';
  $('dial').disabled = !S.cur || locked || S.gv !== 'idle' || S.busy; $('dial').dataset.state = S.phase;
  $('dialText').textContent = S.phase === 'oncall' ? 'On a Call' : S.phase === 'dialing' ? 'Calling…' : S.phase === 'wrapup' ? 'Dial Next Carrier' : 'Dial Carrier';
  $('skip').disabled = !S.cur || locked; $('skipText').textContent = S.isManual ? ' Close' : ' Skip';
  $('pauseText').textContent = S.paused ? ' Resume' : ' Pause';
  if ($('pause').dataset.icon !== (S.paused ? 'play' : 'pause')) setIcon($('pause'), S.paused ? 'play' : 'pause', 17);
  let hint = '';
  if (S.phase === 'oncall') hint = 'On a call. The next dial is locked until you hang up.';
  else if (S.phase === 'wrapup' && S.left) hint = `Next call in ${S.left}s. Press Pause to stop it.`;
  else if (S.paused) hint = 'Paused. Auto-dial will not start until you press Resume.';
  else if (S.gv === 'nogv') hint = 'Open voice.google.com in a Chrome tab to enable dialing.';
  else if (S.gv === 'unknown' && !locked) hint = 'Google Voice is open but not readable yet. Tap the status at the top to check.';
  else if (S.phase === 'dialing' && S.cfg.dryRun) hint = 'Test mode: the number is loaded. Press Call yourself.';
  $('dialHint').textContent = hint;
  $('autoDial').checked = !!S.cfg.autoDial; $('autoChip').hidden = !S.cfg.autoDial;
  const an = $('autoNote'); an.hidden = S.cfg.detectVerified; an.textContent = 'Auto-dial unlocks after Dispatchio sees one complete call: dial a carrier and hang up once.';
  document.querySelectorAll('#outcomes button, #saveAs button, #copy, #copyPhone, #unsave').forEach((bn) => { bn.disabled = !S.cur; });
}

// ---------- settings ----------
function applyCfg() { document.body.classList.toggle('compact', !!S.cfg.compact); }
function ensureOption(sel, value, label) { if (![...sel.options].some((o) => Number(o.value) === Number(value))) sel.add(new Option(label, value)); sel.value = value; }
function fillSettings() {
  for (const k of ['blockSize', 'webKey', 'groqKey', 'orKey', 'groqModel', 'orModel', 'endRe', 'callRe', 'readyRe']) $(k).value = S.cfg[k] || '';
  ensureOption($('delaySec'), S.cfg.delaySec, `${S.cfg.delaySec} sec`);
  ensureOption($('dailyGoal'), S.cfg.dailyGoal || 0, S.cfg.dailyGoal ? String(S.cfg.dailyGoal) : '0 (disabled)');
  $('aiMode').value = S.cfg.aiMode;
  for (const k of ['dryRun', 'liveCheck', 'compact']) $(k).checked = !!S.cfg[k];
  $('includeGap').checked = S.cfg.includeGap !== false;
  $('ver').textContent = 'v' + (chrome.runtime.getManifest ? chrome.runtime.getManifest().version : '');
}

function bind() {
  const on = (id, ev, fn) => { $(id)['on' + ev] = safe(fn); };
  document.querySelectorAll('#mainTabs button').forEach((b) => (b.onclick = safe(() => setTab(b.dataset.tab))));
  document.querySelectorAll('[data-go]').forEach((b) => (b.onclick = safe(() => setTab(b.dataset.go))));
  on('btnStats', 'click', () => setTab('stats')); on('btnSettings', 'click', () => setTab('settings')); on('settingsBack', 'click', () => setTab('calling'));
  on('dial', 'click', go); on('skip', 'click', skip); on('pause', 'click', togglePause);
  on('copy', 'click', () => copyText(infoText(S.cur), 'Carrier info copied.')); on('copyPhone', 'click', () => copyText(S.cur.phone, 'Phone number copied.'));
  on('gv', 'click', () => { if ($('diagCard').hidden) diagnose(); else $('diagCard').hidden = true; });
  on('diagRun', 'click', diagnose); on('diagClose', 'click', () => { $('diagCard').hidden = true; });
  on('diagCopy', 'click', () => copyText($('diag').value, 'Connection details copied.'));
  on('bannerClose', 'click', () => { say(''); render(); });
  // fleet dropdown on the queue card
  on('fleetChip', 'click', (e) => { e.stopPropagation(); const h = $('fleetMenu').hidden; $('fleetMenu').hidden = !h; $('fleetChip').setAttribute('aria-expanded', String(h)); });
  on('fleetCustom', 'click', () => setTab('queue'));
  document.addEventListener('click', (e) => { if (!$('fleetMenu').hidden && !e.target.closest('.menuwrap')) { $('fleetMenu').hidden = true; $('fleetChip').setAttribute('aria-expanded', 'false'); } });
  document.querySelectorAll('[data-min]').forEach((el) => (el.onclick = safe(() => { setFleet(Number(el.dataset.min), Number(el.dataset.max)); $('fleetMenu').hidden = true; $('fleetChip').setAttribute('aria-expanded', 'false'); })));
  document.querySelectorAll('[data-step]').forEach((b) => (b.onclick = safe(() => {
    const k = b.dataset.step, v = (Number($(k).value) || 0) + Number(b.dataset.d);
    k === 'minFleet' ? setFleet(Math.max(0, v), NaN) : setFleet(NaN, Math.max(0, v));
  })));
  for (const k of ['minFleet', 'maxFleet']) $(k).onchange = safe((e) => { const v = e.target.value === '' ? NaN : Number(e.target.value); k === 'minFleet' ? setFleet(v, NaN) : setFleet(NaN, v); });
  on('jump', 'click', jump); $('jumpMc').onkeydown = (e) => { if (e.key === 'Enter') safe(jump)(); };
  on('file', 'change', (e) => loadFile(e.target.files[0])); on('file2', 'change', (e) => loadFile(e.target.files[0]));
  on('restore', 'change', (e) => restore(e.target.files[0]));
  document.querySelectorAll('#outcomes button').forEach((b) => (b.onclick = safe(() => outcome(b.dataset.o))));
  document.querySelectorAll('#saveAs button').forEach((b) => (b.onclick = safe(() => saveLead(b.dataset.t))));
  on('unsave', 'click', () => unsave());
  $('note').oninput = (e) => { if (!S.cur) return; const v = e.target.value; if (v) S.notes[S.cur.mc] = v; else delete S.notes[S.cur.mc]; $('noteCount').textContent = `${v.length} / 500`; saveSoon(); };
  on('followDate', 'change', (e) => { const l = S.cur && S.leads[S.cur.mc]; if (l) { l.followDate = e.target.value; save(); renderSaved(); render(); } });
  on('autoDial', 'change', (e) => setAuto(e.target.checked)); on('autoChip', 'click', () => setAuto(false));
  on('moreToggle', 'click', () => { const h = $('moreBox').hidden; $('moreBox').hidden = !h; $('moreToggle').setAttribute('aria-expanded', String(h)); $('moreText').textContent = h ? 'Hide Details' : 'Show More Details'; });
  on('moreSettingsBtn', 'click', () => { const h = $('moreSettings').hidden; $('moreSettings').hidden = !h; $('moreSettingsBtn').setAttribute('aria-expanded', String(h)); if (h) refreshStorage(); });
  on('assistGen', 'click', () => genBrief(S.cur)); on('assistNote', 'click', genNote); on('assistUse', 'click', useNoteSummary);
  on('assistToggle', 'click', () => { S.assistCollapsed = !S.assistCollapsed; render(); });
  document.querySelectorAll('#savedTabs button').forEach((b) => (b.onclick = safe(() => { S.savedTab = b.dataset.f; S.rowOpen = null; S.savedAll = false; renderSaved(); })));
  on('savedViewAll', 'click', () => { S.savedAll = !S.savedAll; renderSaved(); });
  const setRange = (r) => { S.range = r; document.querySelectorAll('#statRange button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.r === r))); renderStats(); };
  document.querySelectorAll('#statRange button').forEach((b) => (b.onclick = safe(() => setRange(b.dataset.r))));
  on('statsViewAll', 'click', () => setRange('all')); on('fpPass', 'click', () => setTab('stats'));
  on('exportSaved', 'click', exportSaved); on('exportStats', 'click', exportStats); on('export', 'click', exportCalls); on('backup', 'click', backup);
  document.querySelectorAll('.reveal').forEach((b) => (b.onclick = safe(() => { const i = $(b.dataset.for), show = i.type === 'password'; i.type = show ? 'text' : 'password'; setIcon(b, show ? 'eye-off' : 'eye', 16); })));
  // settings fields
  on('dryRun', 'change', (e) => { S.cfg.dryRun = e.target.checked; save(); });
  on('includeGap', 'change', (e) => { S.cfg.includeGap = e.target.checked; S.bkey = ''; if ((S.phase === 'ready' && !S.isManual) || S.phase === 'done') { S.parked = null; S.idx = 0; nextCarrier(); } save(); render(); });
  on('compact', 'change', (e) => { S.cfg.compact = e.target.checked; applyCfg(); save(); });
  on('liveCheck', 'change', (e) => {
    S.cfg.liveCheck = e.target.checked; S.live = {};
    if (e.target.checked && !S.cfg.webKey) say('Live check is on but no FMCSA webKey is set, so it will do nothing until you add one.', 'warn');
    save(); render();
  });
  on('webKey', 'change', (e) => { S.cfg.webKey = e.target.value.trim(); S.live = {}; save(); render(); });
  on('aiMode', 'change', (e) => { S.cfg.aiMode = e.target.value; S.briefFor = ''; save(); render(); });
  for (const k of ['groqKey', 'orKey', 'groqModel', 'orModel']) on(k, 'change', (e) => { S.cfg[k] = e.target.value.trim(); S.assist = {}; S.briefFor = ''; save(); render(); });
  on('aiTest', 'click', async () => {
    const out = $('aiTestOut'); out.textContent = 'Testing…';
    try { const r = await AI.test(S.cfg); out.textContent = `Working: ${r.provider} (${r.model}) answered in ${(r.ms / 1000).toFixed(1)}s.`; }
    catch (e) { out.textContent = 'Not working: ' + e.message; }
  });
  on('delaySec', 'change', (e) => { S.cfg.delaySec = Math.max(3, Number(e.target.value) || 10); save(); });
  on('dailyGoal', 'change', (e) => { S.cfg.dailyGoal = Math.max(0, Math.floor(Number(e.target.value)) || 0); save(); render(); });
  on('blockSize', 'change', (e) => { S.cfg.blockSize = Math.max(100, Math.floor(Number(e.target.value)) || 10000); S.bkey = ''; fillSettings(); save(); renderStats(); render(); });
  for (const k of ['endRe', 'callRe', 'readyRe']) on(k, 'change', (e) => {
    try { new RegExp(e.target.value); S.cfg[k] = e.target.value || DEF[k]; } catch { say('That pattern is not valid. Kept the old one.', 'warn'); }
    fillSettings(); save(); render();
  });
  on('reset', 'click', () => {
    if (!confirm('Clear the whole call history and stats? Saved carriers and notes are kept.')) return;
    S.calls = {}; S.run = 1; S.idx = 0; S.paused = false; S.parked = null; S.assist = {}; clearInterval(S.timer); S.left = 0;
    nextCarrier(); say('History cleared.', 'ok'); render(); renderStats(); renderSaved();
  });
}

(async function init() {
  hydrateIcons();
  let d = {};
  try { d = await chrome.storage.local.get(['queue', 'cfg', 'idx', 'calls', 'leads', 'notes', 'run', 'curMc']); }
  catch { say('Could not read saved data. Starting fresh.', 'warn'); }
  S.cfg = { ...DEF, ...(d.cfg || {}) };
  if (S.cfg.v !== DEF.v) { S.cfg.v = DEF.v; S.cfg.endRe = DEF.endRe; S.cfg.callRe = DEF.callRe; S.cfg.readyRe = DEF.readyRe; }
  if (S.cfg.autoDial && !S.cfg.detectVerified) S.cfg.autoDial = false;
  S.calls = d.calls || {}; S.leads = d.leads || {}; S.notes = d.notes || {};
  S.run = d.run || 1; S.idx = d.idx || 0;
  setQueue(d.queue);
  if (S.queue.length) {
    const c = d.curMc && S.map[d.curMc];
    if (c && eligible(c)) { S.cur = c; S.phase = 'ready'; } else nextCarrier();
  } else if (Object.keys(S.leads).length) S.phase = 'done';
  applyCfg(); bind(); fillSettings(); setTab('calling'); renderStats(); renderSaved();
  setInterval(safe(poll), 1000);
})();
