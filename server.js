import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { polish } from './src/core/polish.js';
import { autoRepair } from './src/repair.js';
import { toRbxmx, toLuau } from './src/core/export.js';
import { askModel, providerInfo } from './src/llm.js';
import { openStore } from './src/store.js';
import { buildRequest } from './src/request.js';
import { STYLES } from './src/stances.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const httpErr = (status, message) => Object.assign(new Error(message), { status });

// Sliding-window limiter per IP; old entries are dropped so the map can't grow forever.
function limiter(max, windowMs = 60000) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some(t => now - t < windowMs)) hits.delete(k); }, windowMs).unref();
  return (req, _res, next) => {
    const now = Date.now(), list = (hits.get(req.ip) ?? []).filter(t => now - t < windowMs);
    list.push(now);
    hits.set(req.ip, list);
    next(list.length > max ? httpErr(429, 'Too many requests. Wait a minute.') : undefined);
  };
}

export function createApp({ store, ask = askModel, rand = Math.random } = {}) {
  const app = express();
  app.set('trust proxy', 1); // Railway & co. sit behind a proxy; without this every user shares one IP
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); next(); });
  app.use(express.json({ limit: '200kb' }));
  app.use(express.static(path.join(root, 'public')));
  app.use('/core', express.static(path.join(root, 'src/core'))); // same maths in the browser as on the server
  app.use('/vendor/three', express.static(path.join(root, 'node_modules/three')));
  const wrap = fn => (req, res, next) => fn(req, res).catch(next);

  app.get('/healthz', (_req, res) => res.json({ ok: true, store: store.kind }));

  // Styles the web app offers (id, label, one-line description). "auto" picks one that fits the prompt.
  app.get('/api/styles', (_req, res) => res.json({ styles: [{ id: 'auto', label: 'Auto (varies)', hint: 'picks a style that fits your prompt, different each time' }, ...Object.entries(STYLES).map(([id, s]) => ({ id, label: s.label, hint: s.hint }))] }));

  const session = async id => { const s = await store.getSession(id); if (!s) throw httpErr(404, 'Session expired'); return s; };
  const publicAnim = a => ({ id: a.id, prompt: a.prompt, revision: !!a.revision, style: a.style ?? null, anim: a.anim });

  // ---- Studio pairing: the browser holds a session id, the plugin enters the short code ----
  app.post('/api/session', limiter(10), wrap(async (_req, res) => { const s = await store.createSession(); res.json({ id: s.id, code: s.code }); }));
  app.get('/api/session/:id', wrap(async (req, res) => { const s = await session(req.params.id); res.json({ code: s.code, claimed: s.claimed }); }));
  app.get('/api/session/:id/history', wrap(async (req, res) => { await session(req.params.id); res.json({ items: (await store.listAnims(req.params.id)).map(publicAnim) }); }));

  app.post('/api/session/:id/send', wrap(async (req, res) => {
    const a = await store.getAnim(String(req.body?.animId ?? ''));
    if (!a || a.sid !== req.params.id) throw httpErr(404, 'Animation not found');
    if (!(await store.enqueue(req.params.id, a.anim))) throw httpErr(409, 'Studio is not linked yet.');
    res.json({ ok: true });
  }));

  // ---- generate / revise / fix ----
  app.post('/api/generate', limiter(20), wrap(async (req, res) => {
    const { sid, prompt, previousId, fix, style: wanted } = req.body ?? {};
    await session(sid);
    const text = typeof prompt === 'string' ? prompt.trim() : '';
    if (!fix && (text.length < 3 || text.length > 500)) throw httpErr(400, 'Prompt must be 3 to 500 characters.');
    let prev = null;
    if (previousId) {
      prev = await store.getAnim(String(previousId));
      if (!prev || prev.sid !== sid) throw httpErr(404, 'Animation not found');
    }
    const { user, style } = buildRequest({ text, fix: !!fix, prev, style: wanted, rand });
    let raw = await ask(user, { role: 'generate' });
    let anim;
    try { anim = polish(raw); } catch (e) { throw httpErr(502, `The model's answer could not be used (${e.message}). Try again.`); }
    // Silent auto-repair: push minor hand clipping out with Hand IK, then at most one model "fix" pass for what is left.
    const fixed = await autoRepair({
      raw, anim, ask: user2 => ask(user2, { role: 'fix' }),
      buildFix: (r, a) => buildRequest({ fix: true, prev: { raw: r, anim: a, style } }).user,
    });
    raw = fixed.raw; anim = fixed.anim;
    const label = fix ? 'Fix issues' : text;
    const id = await store.saveAnim({ sid, prompt: label, raw, anim, revision: !!prev, style });
    res.json({ id, prompt: label, revision: !!prev, style, anim, repair: fixed.repair });
  }));

  // ---- downloads (no plugin needed) ----
  const owned = async req => { const a = await store.getAnim(req.params.id); if (!a || a.sid !== String(req.query.sid ?? '')) throw httpErr(404, 'Animation not found'); return a; };
  app.get('/api/anim/:id/rbxmx', wrap(async (req, res) => { const a = await owned(req); res.type('application/xml').attachment(`${a.anim.name}.rbxmx`).send(toRbxmx(a.anim)); }));
  app.get('/api/anim/:id/luau', wrap(async (req, res) => { const a = await owned(req); res.type('text/plain').send(toLuau(a.anim)); }));

  // ---- plugin ----
  app.post('/api/plugin/claim', limiter(10), wrap(async (req, res) => {
    const code = String(req.body?.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const key = await store.claim(code);
    if (!key) throw httpErr(404, 'Code not found or already used.');
    res.json({ key });
  }));

  // Long poll: holds the request for up to `wait` seconds so Studio gets the clip instantly
  // without hammering the server every two seconds.
  app.get('/api/plugin/poll', limiter(120), wrap(async (req, res) => {
    const key = req.get('x-plugin-key') || String(req.query.key ?? '');
    const until = Date.now() + Math.min(20, Math.max(0, +req.query.wait || 0)) * 1000;
    let closed = false;
    req.on('close', () => { closed = true; });
    for (;;) {
      const r = await store.poll(key);
      if (!r.ok) throw httpErr(401, 'Not linked');
      if (r.anim) return res.json({ anim: r.anim });
      if (closed || Date.now() >= until) return res.json({ anim: null });
      await sleep(600);
    }
  }));

  app.use((err, _req, res, _next) => {
    const status = err.status ?? 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'Something went wrong on the server.' : err.message });
  });
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { missing } = providerInfo();
  if (missing.length) throw new Error(`Missing ${missing.join(', ')} in environment (see .env.example)`);
  const store = await openStore();
  const port = process.env.PORT || 3000;
  const server = createApp({ store }).listen(port, () => console.log(`Animator running on port ${port} (${store.kind} storage)`));
  const stop = () => server.close(() => store.close().finally(() => process.exit(0)));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
