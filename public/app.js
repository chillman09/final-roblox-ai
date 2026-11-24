import { createStage } from '/stage.js';
import { keyTimes } from '/core/sample.js';

const $ = s => document.querySelector(s);
function h(tag, props = {}, ...kids) {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
}

// ---------- state ----------
const items = new Map();           // id -> { id, prompt, revision, anim }
let sid = localStorage.getItem('sid'), linked = false;
let current = null, t = 0, playing = false, last = performance.now(), busy = false;

// [prompt, style it suits]
const EXAMPLES = [
  ['Jab, cross, hook combo', 'boxing'],
  ['Front kick then a spinning back kick', 'karate'],
  ['Knee strike into an elbow', 'muaythai'],
  ['Heavy overhead sword slash with a big windup', 'swordsman'],
  ['Shoulder charge and body slam', 'brawler'],
  ['Backflip dodge', 'acrobat'],
  ['Victory dance', 'relaxed'],
];
let styles = [{ id: 'auto', label: 'Auto (varies)', hint: '' }];
const styleLabel = id => styles.find(x => x.id === id)?.label ?? '';

// ---------- api ----------
async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `Request failed (${r.status})`), { status: r.status });
  return j;
}
let toastTimer;
function toast(msg) {
  const n = $('#toast');
  n.textContent = msg;
  n.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => n.classList.remove('show'), 2000);
}
const showError = msg => { $('#err').textContent = msg || ''; };

// ---------- stage + playback ----------
const stage = createStage($('#stage'));
const scrub = $('#scrub'), timeEl = $('#time'), playBtn = $('#play');
const anim = () => current && items.get(current)?.anim;

function setPlaying(v) { playing = v; playBtn.textContent = v ? 'Pause' : 'Play'; }
function seek(x) { const a = anim(); if (a) t = Math.max(0, Math.min(a.duration, x)); }
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const a = anim();
  if (a && playing) {
    t += dt * +$('#speed').value;
    if (t >= a.duration) { if ($('#loop').checked) t = 0; else { t = a.duration; setPlaying(false); } }
  }
  stage.setTime(t);
  if (a) { scrub.value = (t / a.duration) * 1000; timeEl.textContent = `${t.toFixed(2)} / ${a.duration.toFixed(2)}s`; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
playBtn.onclick = () => { const a = anim(); if (!a) return; if (t >= a.duration) t = 0; setPlaying(!playing); };
scrub.oninput = () => { setPlaying(false); seek((scrub.value / 1000) * anim().duration); };

function drawTicks(a) {
  const box = $('#ticks');
  box.replaceChildren();
  if (!a) return;
  const pct = x => `${(x / a.duration) * 100}%`;
  for (const x of keyTimes(a)) box.append(h('i', { style: `left:${pct(x)}` }));
  for (const w of a.warnings ?? []) box.append(h('i', { className: 'bad', style: `left:${pct(w.t)}`, title: w.msg }));
  // one band per flight (a combo with two jumps shows two bands, not one)
  const flights = a.airIntervals ?? ((a.airTimes ?? []).length >= 2 ? [[a.airTimes[0], a.airTimes.at(-1)]] : []);
  for (const [s, e] of flights) box.append(h('u', { style: `left:${pct(s)};width:${pct(e - s)}`, title: 'Airborne' }));
}

function drawWarnings(a) {
  const box = $('#warnings');
  const list = a?.warnings ?? [];
  box.hidden = !list.length;
  if (!list.length) return;
  const fix = h('button', { type: 'button', textContent: 'Ask the AI to fix this', onclick: () => generate({ fix: true }) });
  box.replaceChildren(h('b', { textContent: `${list.length} thing${list.length > 1 ? 's' : ''} to check` }), h('ul', {}, ...list.map(w => h('li', { textContent: w.msg }))), fix);
}

function select(id) {
  current = id;
  const it = items.get(id), a = it?.anim;
  t = 0;
  stage.setAnim(a);
  for (const b of [playBtn, scrub, $('#rev'), $('#rbxmx'), $('#luau')]) b.disabled = !a;
  $('#apply').disabled = !(a && linked);
  document.querySelectorAll('.msg').forEach(m => m.classList.toggle('active', m.dataset.id === id));
  drawTicks(a);
  drawWarnings(a);
  setPlaying(!!a);
}

// ---------- history list ----------
function addItem(it, activate = true) {
  items.set(it.id, it);
  $('#log').querySelector('.empty')?.remove();
  const n = it.anim.warnings?.length;
  const b = h('button', { className: 'msg', type: 'button', onclick: () => select(it.id) },
    h('b', { textContent: it.prompt }),
    h('span', { textContent: `${it.anim.name}, ${it.anim.duration}s${it.style && styleLabel(it.style) ? `, ${styleLabel(it.style)}` : ''}${it.anim.feetLocked ? `, ${it.anim.feetLocked} foot lock${it.anim.feetLocked > 1 ? 's' : ''}` : ''}${it.revision ? ', revision' : ''}` }),
    ...(n ? [h('span', { className: 'flag', textContent: ` · ${n} to check` })] : []));
  b.dataset.id = it.id;
  $('#log').append(b);
  $('#log').scrollTop = $('#log').scrollHeight;
  if (activate) select(it.id);
}

// ---------- generate ----------
async function generate({ revise = false, fix = false } = {}) {
  if (busy) return;
  const prompt = $('#prompt').value.trim();
  if (!fix && prompt.length < 3) return;
  showError('');
  busy = true;
  const gen = $('#gen'), rev = $('#rev');
  gen.disabled = rev.disabled = true;
  // Slow models can think for a while; counting seconds shows the app has not frozen.
  const started = Date.now(), word = fix ? 'Fixing' : revise ? 'Revising' : 'Generating';
  const tick = () => { gen.textContent = `${word}… ${Math.round((Date.now() - started) / 1000)}s`; };
  tick();
  const timer = setInterval(tick, 1000);
  try {
    const it = await api('/api/generate', { sid, prompt, previousId: revise || fix ? current : undefined, fix, style: $('#style').value });
    addItem(it);
    if (!fix) $('#prompt').value = '';
  } catch (e) {
    if (e.status === 404 && /Session/.test(e.message)) { await ensureSession(); showError('Your session expired and was renewed. Try again.'); }
    else showError(e.message);
  } finally {
    clearInterval(timer);
    busy = false;
    gen.disabled = false;
    rev.disabled = !current;
    gen.textContent = 'Generate';
  }
}
$('#form').onsubmit = e => { e.preventDefault(); generate(); };
$('#rev').onclick = () => generate({ revise: true });
$('#prompt').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); generate(); } });
$('#chips').append(...EXAMPLES.map(([text, style]) => h('button', { type: 'button', textContent: text, onclick: () => { $('#prompt').value = text; setStyle(style); $('#prompt').focus(); } })));

// ---------- styles ----------
function setStyle(id) {
  const sel = $('#style');
  if (![...sel.options].some(o => o.value === id)) id = 'auto';
  sel.value = id;
  $('#stylehint').textContent = styles.find(x => x.id === id)?.hint ?? '';
  try { localStorage.setItem('style', id); } catch { /* private mode */ }
}
$('#style').onchange = () => setStyle($('#style').value);
async function loadStyles() {
  try {
    styles = (await api('/api/styles')).styles;
    $('#style').replaceChildren(...styles.map(x => h('option', { value: x.id, textContent: x.label })));
  } catch { /* keep the built-in "Auto" option */ }
  let saved = 'auto';
  try { saved = localStorage.getItem('style') || 'auto'; } catch { /* private mode */ }
  setStyle(saved);
}

// ---------- export ----------
$('#rbxmx').onclick = () => { location.href = `/api/anim/${current}/rbxmx?sid=${sid}`; };
$('#luau').onclick = async () => {
  try {
    const text = await (await fetch(`/api/anim/${current}/luau?sid=${sid}`)).text();
    await navigator.clipboard.writeText(text);
    toast('Luau copied. Select your rig in Studio, paste into the Command Bar.');
  } catch { toast('Could not copy. Use the .rbxmx download instead.'); }
};
$('#apply').onclick = async () => {
  showError('');
  try {
    await api(`/api/session/${sid}/send`, { animId: current });
    toast('Sent. Select your R15 rig in Studio if you have not yet.');
  } catch (e) { showError(e.message); }
};

// ---------- Studio link ----------
async function ensureSession() {
  try {
    if (!sid) throw 0;
    await api(`/api/session/${sid}`);
  } catch {
    ({ id: sid } = await api('/api/session', {}));
    localStorage.setItem('sid', sid);
  }
}
async function refreshLink() {
  if (document.hidden) return;
  try {
    const s = await api(`/api/session/${sid}`);
    linked = s.claimed;
    $('#dot').classList.toggle('on', linked);
    const txt = $('#linktext');
    if (linked) txt.textContent = 'Studio linked';
    else {
      txt.textContent = 'Enter this code in the Studio plugin: ';
      txt.append(h('span', { id: 'code', textContent: s.code, title: 'Click to copy', onclick: () => navigator.clipboard?.writeText(s.code).then(() => toast('Code copied')) }));
    }
    $('#apply').disabled = !(linked && anim());
  } catch { await ensureSession().catch(() => { $('#linktext').textContent = 'Server unreachable'; }); }
}

// ---------- keyboard ----------
addEventListener('keydown', e => {
  if (/^(TEXTAREA|INPUT|SELECT)$/.test(e.target.tagName) || !anim()) return;
  if (e.key === ' ') { e.preventDefault(); playBtn.click(); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { setPlaying(false); seek(t + (e.key === 'ArrowRight' ? 1 : -1) / 30); }
});

// ---------- start ----------
await loadStyles();
try {
  await ensureSession();
  await refreshLink();
  const { items: past } = await api(`/api/session/${sid}/history`);
  past.forEach((it, i) => addItem(it, i === past.length - 1));
} catch (e) { showError(e.message); }
setInterval(refreshLink, 4000);
document.addEventListener('visibilitychange', refreshLink);
