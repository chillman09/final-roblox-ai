// End-to-end through Express. Skipped when dependencies are not installed (npm install first).
import test from 'node:test';
import assert from 'node:assert/strict';

let express;
try { express = await import('express'); } catch { /* not installed */ }

test('generate → send → plugin poll, with ownership checks', { skip: !express }, async () => {
  const { createApp } = await import('../server.js');
  const { memoryStore } = await import('../src/store.js');
  const store = await memoryStore();
  const raw = { name: 'Wave', duration: 1, keys: [{ t: 0, pose: { RightUpperArm: { r: [0, 0, 0] } } }, { t: 1, pose: { RightUpperArm: { r: [170, 0, 0] } } }] };
  const server = createApp({ store, ask: async () => raw }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json() }));
  try {
    const { body: s } = await post('/api/session', {});
    const gen = await post('/api/generate', { sid: s.id, prompt: 'wave hello' });
    assert.equal(gen.status, 200);
    assert.equal(gen.body.anim.name, 'Wave');
    assert.equal((await post('/api/generate', { sid: 'nope', prompt: 'wave hello' })).status, 404);
    assert.equal((await post(`/api/session/${s.id}/send`, { animId: gen.body.id })).status, 409);
    const claim = await post('/api/plugin/claim', { code: s.code });
    assert.equal(claim.status, 200);
    assert.equal((await post(`/api/session/${s.id}/send`, { animId: gen.body.id })).status, 200);
    const poll = await fetch(`${base}/api/plugin/poll`, { headers: { 'X-Plugin-Key': claim.body.key } }).then(r => r.json());
    assert.equal(poll.anim.name, 'Wave');
    const other = (await post('/api/session', {})).body;
    assert.equal((await post(`/api/session/${other.id}/send`, { animId: gen.body.id })).status, 404, 'cannot send someone else\'s clip');
    assert.equal((await fetch(`${base}/api/anim/${gen.body.id}/rbxmx?sid=${other.id}`)).status, 404);
    assert.equal((await fetch(`${base}/api/anim/${gen.body.id}/rbxmx?sid=${s.id}`)).status, 200);
  } finally { server.close(); await store.close(); }
});

test('styles: listed, passed to the model, stored, and validated', { skip: !express }, async () => {
  const { createApp } = await import('../server.js');
  const { memoryStore } = await import('../src/store.js');
  const store = await memoryStore();
  const seen = [];
  const raw = { name: 'Hook', duration: 1, keys: [{ t: 0, pose: { RightUpperArm: { r: [0, 0, 0] } } }, { t: 1, pose: { RightUpperArm: { r: [90, 0, 0] } } }] };
  const server = createApp({ store, ask: async user => { seen.push(user); return raw; }, rand: () => 0 }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json() }));
  try {
    const { styles } = await fetch(`${base}/api/styles`).then(r => r.json());
    assert.equal(styles[0].id, 'auto');
    assert.ok(styles.some(s => s.id === 'muaythai'));
    const { body: s } = await post('/api/session', {});
    const a = await post('/api/generate', { sid: s.id, prompt: 'a hook', style: 'muaythai' });
    assert.equal(a.status, 200);
    assert.equal(a.body.style, 'muaythai');
    assert.match(seen[0], /STYLE: Muay Thai/);
    const auto = await post('/api/generate', { sid: s.id, prompt: 'heavy sword slash', style: 'auto' });
    assert.equal(auto.body.style, 'swordsman');
    const rev = await post('/api/generate', { sid: s.id, prompt: 'faster', previousId: a.body.id, style: 'boxing' });
    assert.equal(rev.body.style, 'muaythai', 'a revision keeps the clip\'s own style');
    assert.doesNotMatch(seen.at(-1), /STANCE/);
    assert.equal((await post('/api/generate', { sid: s.id, prompt: 'a hook', style: 'nope' })).status, 400);
    const history = await fetch(`${base}/api/session/${s.id}/history`).then(r => r.json());
    assert.deepEqual(history.items.map(i => i.style), ['muaythai', 'swordsman', 'muaythai']);
  } finally { server.close(); await store.close(); }
});

test('model errors reach the browser as readable messages, not "something went wrong"', { skip: !express }, async () => {
  const { createApp } = await import('../server.js');
  const { memoryStore } = await import('../src/store.js');
  const store = await memoryStore();
  const server = createApp({ store, ask: async () => { throw Object.assign(new Error('The AI provider wants payment for this model (402).'), { status: 502 }); } }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const s = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.json());
    const r = await fetch(`${base}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid: s.id, prompt: 'a punch' }) });
    assert.equal(r.status, 502);
    assert.match((await r.json()).error, /wants payment/);
  } finally { server.close(); await store.close(); }
});
