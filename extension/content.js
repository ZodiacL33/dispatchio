// Runs inside voice.google.com. Reads call state and presses Call after a deep-link dial.
(() => {
  if (window.__ddaLoaded) return;          // safe if injected twice
  window.__ddaLoaded = true;
  const DEF = {
    endRe: 'end call|hang up|call_end|^end$|^(un)?mute$',
    callRe: '^(call|start call)$',
    readyRe: 'calls|messages|voicemail',
  };
  const re = {};
  async function loadCfg() {
    let cfg = {};
    try { cfg = (await chrome.storage.local.get('cfg')).cfg || {}; } catch { /* use defaults */ }
    if (cfg.v !== 3) cfg = {};              // old saved patterns are replaced by the new defaults
    for (const k of Object.keys(DEF)) {
      try { re[k] = new RegExp(cfg[k] || DEF[k], 'i'); } catch { re[k] = new RegExp(DEF[k], 'i'); }
    }
  }
  const vis = (el) => el.offsetWidth > 0 || el.offsetHeight > 0;
  const label = (el) =>
    (el.getAttribute('aria-label') || el.getAttribute('mattooltip') || el.getAttribute('data-tooltip') ||
      el.getAttribute('title') || el.textContent || '').trim().replace(/\s+/g, ' ');
  const SEL = 'button,[role="button"],[role="tab"],[role="link"],[role="menuitem"],a,gv-icon-button';
  function find(r) {
    for (const el of document.querySelectorAll(SEL)) {
      if (!vis(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      if (r.test(label(el))) return el;
    }
    return null;
  }
  function state() {
    if (find(re.endRe)) return 'oncall';
    if (/\/(calls|messages|voicemail|settings)/.test(location.pathname) || find(re.readyRe)) return 'idle';
    return 'unknown';
  }
  function labels() {
    const seen = new Set();
    for (const el of document.querySelectorAll(SEL)) {
      if (!vis(el)) continue;
      const l = label(el).slice(0, 60);
      if (l) seen.add(l);
      if (seen.size >= 80) break;
    }
    return [...seen];
  }

  async function handlePending() {
    let p;
    try { p = (await chrome.storage.local.get('pendingDial')).pendingDial; } catch { return; }
    if (!p) return;
    await chrome.storage.local.remove('pendingDial');
    if (Date.now() - p.ts > 30000 || p.dry) return;
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (Date.now() - t0 > 15000 || state() === 'oncall') return clearInterval(iv);
      // Safety: only press Call once the carrier's number is visibly loaded on the page.
      const inInput = [...document.querySelectorAll('input')].some(
        (i) => i.value.replace(/\D/g, '').endsWith(p.number));
      const inText = document.body.innerText.replace(/\D/g, '').includes(p.number);
      if (!inInput && !inText) return;
      const b = find(re.callRe);
      if (b) { clearInterval(iv); setTimeout(() => b.click(), 700); }
    }, 400);
  }

  chrome.runtime.onMessage.addListener((m, _s, send) => {
    if (!m) return;
    if (m.type === 'GET_STATE') { loadCfg().then(() => send({ state: state() })); return true; }
    if (m.type === 'DEBUG') {
      loadCfg().then(() => send({ state: state(), url: location.href, labels: labels(),
        endFound: !!find(re.endRe), readyFound: !!find(re.readyRe), callFound: !!find(re.callRe) }));
      return true;
    }
  });
  loadCfg().then(handlePending);
})();
