// Dispatchio Assist: Groq first, OpenRouter free models as the fallback. Model lists are fetched live so
// retired models are never hard-wired; users can still pin a model in Settings.
const AI = (() => {
  const GROQ = 'https://api.groq.com/openai/v1', OR = 'https://openrouter.ai/api/v1';
  const NON_CHAT = /whisper|tts|orpheus|guard|safeguard|embed|playai|compound|transcri|speech|moderation/i;
  // Preference order (substring match). Small fast models first so the free request limits last longest.
  const GROQ_PREF = ['llama-3.1-8b-instant', 'gpt-oss-20b', 'llama-3.3-70b', 'llama-4-scout', 'gpt-oss-120b', 'qwen3', 'llama-4-maverick', 'kimi'];
  const OR_PREF = ['gpt-oss-120b', 'llama-3.3-70b', 'gpt-oss-20b', 'qwen3', 'gemma', 'mistral', 'deepseek', 'llama'];
  const lists = {}; let lastCall = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rank = (ids, pref) => ids.map((id) => { const i = pref.findIndex((p) => id.toLowerCase().includes(p)); return [i < 0 ? 99 : i, id]; })
    .sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1])).map((x) => x[1]);

  async function http(url, opt, ms) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms || 15000);
    try { return await fetch(url, { ...opt, signal: ctl.signal }); } finally { clearTimeout(t); }
  }
  async function models(kind, key) {
    const c = lists[kind];
    if (c && Date.now() - c.ts < 6 * 3600e3) return c.ids;
    let ids = [];
    if (kind === 'groq') {
      const r = await http(`${GROQ}/models`, { headers: { Authorization: `Bearer ${key}` } });
      if (r.status === 401) throw Object.assign(new Error('Groq rejected the key'), { auth: true });
      if (!r.ok) throw new Error(`Groq model list failed (${r.status})`);
      const j = await r.json();
      ids = rank((j.data || []).filter((m) => m.active !== false && !NON_CHAT.test(m.id)).map((m) => m.id), GROQ_PREF);
    } else {
      const r = await http(`${OR}/models`, key ? { headers: { Authorization: `Bearer ${key}` } } : {});
      if (!r.ok) throw new Error(`OpenRouter model list failed (${r.status})`);
      const j = await r.json();
      const free = (j.data || []).filter((m) => {
        const p = m.pricing || {}, out = (m.architecture && m.architecture.output_modalities) || ['text'];
        const isFree = String(m.id).endsWith(':free') || (Number(p.prompt) === 0 && Number(p.completion) === 0);
        return isFree && out.length === 1 && out[0] === 'text' && !NON_CHAT.test(m.id) && (m.context_length || 8192) >= 4096;
      }).map((m) => m.id);
      ids = rank(free, OR_PREF);
    }
    lists[kind] = { ts: Date.now(), ids };
    return ids;
  }
  const clean = (t) => String(t || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  async function callModel(kind, key, model, messages, max) {
    const body = { model, messages, temperature: 0.4, max_tokens: max };
    if (kind === 'groq' && /gpt-oss/i.test(model)) body.reasoning_effort = 'low';
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
    if (kind === 'or') { headers['X-Title'] = 'Dispatchio'; headers['HTTP-Referer'] = 'https://dispatchio.local'; }
    const r = await http(`${kind === 'groq' ? GROQ : OR}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) }, 20000);
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error('key rejected'), { auth: true });
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
    const j = await r.json();
    const text = clean(j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content);
    if (!text) throw new Error('empty answer');
    return text;
  }

  // Tries Groq models, then OpenRouter free models. Returns { text, provider, model, ms } or throws a readable error.
  async function chat(cfg, messages, max) {
    const wait = 1200 - (Date.now() - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const t0 = Date.now(), notes = [];
    const plans = [];
    if (cfg.groqKey) plans.push(['groq', cfg.groqKey, cfg.groqModel, 2, 'Groq']);
    if (cfg.orKey) plans.push(['or', cfg.orKey, cfg.orModel, 3, 'OpenRouter']);
    if (!plans.length) throw new Error('Add a Groq or OpenRouter key in Settings first.');
    for (const [kind, key, pinned, tries, label] of plans) {
      let list;
      try { list = pinned ? [pinned] : await models(kind, key); }
      catch (e) { notes.push(`${label}: ${e.message}`); continue; }
      let n = 0;
      for (const model of list) {
        if (n++ >= tries) break;
        try {
          const text = await callModel(kind, key, model, messages, max || 400);
          return { text, provider: label, model, ms: Date.now() - t0 };
        } catch (e) {
          if (e.auth) { notes.push(`${label}: the key was rejected`); break; }
          notes.push(`${label} ${model}: ${e.name === 'AbortError' ? 'timed out' : e.message}`);
          if (e.status === 404 || e.status === 400) delete lists[kind];
        }
      }
    }
    throw new Error(notes.slice(-3).join(' | ') || 'No AI provider answered.');
  }

  const SYS_BRIEF = 'You are Dispatchio Assist, helping a truck dispatcher prepare a cold call to a small trucking company. ' +
    'Use ONLY the facts provided. Never invent numbers, names, equipment or claims. If a fact is missing, leave it out. ' +
    'Reply with exactly two plain-text lines and nothing else:\nSummary: <at most 28 words on who this carrier is>\nOpener: <one natural sentence the dispatcher can say to start the call, at most 30 words>';
  const SYS_NOTE = 'You help a truck dispatcher after a sales call. Use ONLY the dispatcher\'s note. Never invent details. ' +
    'Reply with exactly two plain-text lines and nothing else:\nSummary: <at most 35 words>\nFollow-up: <one concrete next step and a sensible timing, at most 25 words>';

  const parse = (text, keys) => { const o = {}; for (const k of keys) { const m = new RegExp(`${k}\\s*:\\s*(.+)`, 'i').exec(text); if (m) o[k.toLowerCase()] = m[1].trim(); } return o; };
  return {
    brief: async (cfg, facts) => { const r = await chat(cfg, [{ role: 'system', content: SYS_BRIEF }, { role: 'user', content: JSON.stringify(facts) }], 500); return { ...r, ...parse(r.text, ['Summary', 'Opener']) }; },
    noteSummary: async (cfg, note) => { const r = await chat(cfg, [{ role: 'system', content: SYS_NOTE }, { role: 'user', content: note.slice(0, 600) }], 500); return { ...r, ...parse(r.text, ['Summary', 'Follow-up']) }; },
    test: (cfg) => chat(cfg, [{ role: 'user', content: 'Reply with the single word: ready' }], 40),
  };
})();
