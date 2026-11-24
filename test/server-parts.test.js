import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore } from '../src/store.js';
import { askModel } from '../src/llm.js';

test('pairing: claim once, queue, poll in order', async () => {
  const store = await memoryStore();
  const s = await store.createSession();
  assert.equal(await store.enqueue(s.id, { n: 1 }), false, 'cannot send before Studio is linked');
  const key = await store.claim(s.code);
  assert.equal(key, s.key);
  assert.equal(await store.claim(s.code), null, 'code is single use');
  await store.enqueue(s.id, { n: 1 });
  await store.enqueue(s.id, { n: 2 });
  assert.deepEqual((await store.poll(key)).anim, { n: 1 });
  assert.deepEqual((await store.poll(key)).anim, { n: 2 });
  assert.equal((await store.poll(key)).anim, null);
  assert.equal((await store.poll('wrong')).ok, false);
  await store.close();
});

test('history is scoped to the session', async () => {
  const store = await memoryStore();
  const a = await store.createSession(), b = await store.createSession();
  await store.saveAnim({ sid: a.id, prompt: 'x', anim: {} });
  assert.equal((await store.listAnims(a.id)).length, 1);
  assert.equal((await store.listAnims(b.id)).length, 0);
  await store.close();
});

test('askModel retries busy errors, then uses the fallback model', async () => {
  const calls = [];
  const call = async (model) => {
    calls.push(model);
    if (model === 'main') throw Object.assign(new Error('busy'), { retryable: true });
    return { ok: 1 };
  };
  const orig = global.setTimeout;
  global.setTimeout = (fn) => orig(fn, 0); // skip the backoff sleeps
  try {
    assert.deepEqual(await askModel('x', { call, models: ['main', 'backup'] }), { ok: 1 });
  } finally { global.setTimeout = orig; }
  assert.deepEqual(calls, ['main', 'main', 'main', 'backup']);
});

test('askModel does not retry hard errors', async () => {
  let n = 0;
  await assert.rejects(askModel('x', { models: ['m'], call: async () => { n++; throw new Error('bad key'); } }), /bad key/);
  assert.equal(n, 1);
});

test('parseJson copes with thinking blocks, fences, prose and braces in strings', async () => {
  const { parseJson } = await import('../src/llm.js');
  assert.deepEqual(parseJson('<think>maybe {"a":1}? hmm</think>{"ok":true}'), { ok: true });
  assert.deepEqual(parseJson('```json\n{"n":"a } b","k":[1,2]}\n```'), { n: 'a } b', k: [1, 2] });
  assert.deepEqual(parseJson('Here you go: {"x":{"y":2}} hope it helps {not json}'), { x: { y: 2 } });
  assert.throws(() => parseJson('no json at all'), SyntaxError);
});

test('provider errors become clear messages with a status the server will show', async () => {
  const hard = (upstream, detail = '') => Object.assign(new Error(`LLM ${upstream}`), { upstream, detail, retryable: false });
  for (const [code, re] of [[402, /wants payment|credits/], [404, /does not offer the model "m1"/], [401, /API key/], [429, /rate limiting/]]) {
    await assert.rejects(askModel('x', { models: ['m1'], call: async () => { throw hard(code); } }), e => { assert.match(e.message, re); assert.ok(e.status === 502 || e.status === 503); return true; });
  }
  await assert.rejects(askModel('x', { models: ['m1'], call: async () => { throw hard(404, 'use z-ai/glm-5.3-flash instead'); } }), /use z-ai\/glm-5\.3-flash instead/);
});

test('a hard error on the main model falls back to the second model', async () => {
  const calls = [];
  const call = async model => { calls.push(model); if (model === 'main') throw Object.assign(new Error('gone'), { upstream: 404 }); return { ok: 1 }; };
  assert.deepEqual(await askModel('x', { call, models: ['main', 'backup'] }), { ok: 1 });
  assert.deepEqual(calls, ['main', 'backup']);
});
