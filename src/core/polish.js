// Turns the model's rough keyframes into a clean KeyframeSequence-ready animation:
//   normalise → joint limits → phase-aware overlap lag → Roblox easing semantics → spins ≤120° per step →
//   loop closing → grounding (feet on the floor) → hand / foot IK targets → motion flow →
//   overshoot + arc resampling → foot lock → checks.
// Ground and collision maths use the real R15 joint offsets (rig.js), so what is checked here
// is what Studio will show.
import { RIG_R15, POSE_PARTS, mul, lowestY, rotV, solve, eulerDeg } from './rig.js';
import { sampleTrack, transformsAt, worldAt, keyTimes } from './sample.js';
import { lockFeet, flattenFeet } from './footlock.js';
import { cleanTargets, applyTargets, targetSegments, segmentCovers, resampleTargets, CHAIN_OF } from './targets.js';
import { addOvershoot, resampleArcs } from './arcs.js';
import { collisions, describe } from './collide.js';
import { r3 } from './tracks.js';

const JOINTS = POSE_PARTS.filter(p => p !== 'HumanoidRootPart');
const kind = j => j.replace(/^(Right|Left)/, '');

// Overlapping action: outer joints trail the hips by a few frames, but only on the "windup" and
// "followthrough" keys of a clip (never the first key, the last key or an "impact").
const LAG = { UpperTorso: 0.02, Head: 0.05, UpperArm: 0.01, LowerArm: 0.03, Hand: 0.06, LowerLeg: 0.02, Foot: 0.03 };
const LAG_PHASES = ['windup', 'anticipation', 'followthrough', 'settle'];
// Combat names first (kept for backward compatibility), then the general acting aliases:
// anticipation = windup, action = strike, peak = impact, settle = followthrough.
export const PHASES = ['windup', 'strike', 'impact', 'followthrough', 'recovery', 'pass', 'anticipation', 'action', 'peak', 'settle'];
export const GROUNDS = ['feet', 'body', 'none'];
const AIR_WINDOW = 0.05;   // seconds either side of a lone air key that count as airborne
const EASES = ['in', 'out', 'inout', 'linear'];
const FEET = ['LeftFoot', 'RightFoot'];
const MAX_STEP = 120; // Roblox always blends the shorter way, so one step can never reach 180°
const SPLIT_ABOVE = 150;

const num = v => (Number.isFinite(+v) ? +v : 0);
const clamp = (v, a, b) => Math.min(b, Math.max(a, num(v)));
const restKey = (t, j, e = 'linear') => ({ t, r: [0, 0, 0], e, ...(j === 'LowerTorso' ? { p: [0, 0, 0] } : {}) });
const cloneKey = (k, over = {}) => ({ ...k, r: [...k.r], ...(k.p ? { p: [...k.p] } : {}), ...over });

// Groups consecutive air:true keys into separate [start, end] flights. A lone air key is a short hop: a small window around it.
export function groupAir(keys) {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length === 1) out.push([Math.max(0, run[0] - AIR_WINDOW), run[0] + AIR_WINDOW]);
    else if (run.length > 1) out.push([run[0], run.at(-1)]);
    run = [];
  };
  for (const k of keys) { if (k.air) run.push(k.t); else flush(); }
  flush();
  return out;
}

export function polish(raw, { rig = RIG_R15, footLock = true } = {}) {
  if (!raw || !Array.isArray(raw.keys) || raw.keys.length < 2) throw new Error('The model returned too few keys');

  // ---- 1. normalise: sorted keys, sparse poses become one track per joint ----
  const keys = raw.keys
    .filter(k => k && typeof k === 'object')
    .map(k => ({
      t: clamp(k.t, 0, 8), e: EASES.includes(k.ease) ? k.ease : 'inout', air: k.air === true,
      phase: PHASES.includes(k.phase) ? k.phase : null, targets: cleanTargets(k.targets), auto: k.auto === true,
      pose: k.pose && typeof k.pose === 'object' ? k.pose : {},
    }))
    .sort((a, b) => a.t - b.t);
  if (keys.length < 2) throw new Error('The model returned too few keys');
  keys[0].t = 0;
  const duration = Math.max(0.2, keys.at(-1).t);
  const airTimes = keys.filter(k => k.air).map(k => k.t);
  const airIntervals = groupAir(keys);
  const tks = keys.filter(k => k.targets).map(k => ({ t: k.t, phase: k.phase, targets: k.targets, auto: k.auto }));

  const tracks = {};
  const state = {};
  for (const k of keys) {
    for (const [j, v] of Object.entries(k.pose)) {
      if (!JOINTS.includes(j) || !v || typeof v !== 'object') continue;
      const lim = rig.limits[j];
      const s = (state[j] ??= { r: [0, 0, 0], p: [0, 0, 0] });
      if (Array.isArray(v.r)) s.r = [0, 1, 2].map(i => clamp(v.r[i], lim[i][0], lim[i][1]));
      if (j === 'LowerTorso' && Array.isArray(v.p)) s.p = [0, 1, 2].map(i => clamp(v.p[i], -4, 4));
      // `ph` (the key's phase) and `pin` (an IK target drives this limb here) are working fields, removed before the end
      (tracks[j] ??= []).push({ t: k.t, r: [...s.r], e: k.e, ph: k.phase, pin: !!k.targets?.[CHAIN_OF[j]], ...(j === 'LowerTorso' ? { p: [...s.p] } : {}) });
    }
  }
  if (!Object.keys(tracks).length && !tks.length) throw new Error('The model returned no usable joints');

  for (const [j, tr] of Object.entries(tracks)) {
    // 2. every animated joint starts at t=0 and runs to the full duration
    if (tr[0].t > 0) tr.unshift(restKey(0, j));
    const last = tr.at(-1);
    if (last.t < duration) tr.push(cloneKey(last, { t: duration, e: 'linear', ph: null, pin: false }));
    // 3. overlapping action, phase-aware: only "windup" / "followthrough" keys trail the hips. The first and
    //    last key, impacts and keys driven by an IK target never move, and a lagged key never crowds its
    //    neighbour, so nothing is clamped onto the end of the clip or merged away and loops keep their return curve.
    const lag = LAG[kind(j)] ?? 0;
    const out = [tr[0]];
    for (let i = 1; i < tr.length; i++) {
      const k = tr[i], next = tr[i + 1];
      const shift = next && lag && LAG_PHASES.includes(k.ph) && !k.pin && k.t > 0 && k.t < duration - 1e-9 ? Math.min(lag, 0.4 * (next.t - k.t)) : 0;
      const t = k.t + shift;
      out.push(shift > 0 && t > out.at(-1).t + 0.01 ? { ...k, t } : k);
    }
    // 4. the model describes how motion ARRIVES at a key; Roblox stores how it LEAVES one
    tracks[j] = out.map((k, i) => ({ ...k, e: out[i + 1]?.e ?? 'linear' }));
  }

  // ---- 5. spins: Roblox blends the short way, so big turns are cut into steps ≤120° ----
  for (const [j, tr] of Object.entries(tracks)) tracks[j] = splitTurns(unwrapTurns(tr));

  const ground = GROUNDS.includes(raw.ground) ? raw.ground : 'feet';
  const anim = { name: cleanName(raw.name), duration: r3(duration), loop: !!raw.loop, ground, tracks };

  // ---- 6. loops, after every timing change: the last key must equal the first, or the clip pops.
  //         (A turn of whole revolutions already ends where it started; it must not be unwound.) ----
  if (anim.loop) for (const tr of Object.values(tracks)) {
    const a = tr[0], b = tr.at(-1);
    if (!sameRotation(a.r, b.r)) tr[tr.length - 1] = cloneKey(a, { t: b.t, e: 'linear', ph: null, pin: false });
  }

  // ---- 7. ground the body, then hand / foot IK targets, then smooth easing so motion doesn't stop mid-swing ----
  // ground: 'feet' = standing (flat soles, feet on the floor, planted feet locked); 'body' = the lowest body part rests
  // on the floor (kneel, sit, crawl, collapse); 'none' = nothing is grounded (swim, fly, float, climb).
  const plantSkip = (t, w) => airBetween(airIntervals, t) || !isUpright(w);
  const standing = ground === 'feet' && footLock;
  if (standing) flattenFeet(anim, { rig, skip: plantSkip }); // flat soles first, so grounding measures what the foot really is
  if (ground !== 'none') groundBody(anim, airTimes, airIntervals, rig, ground);
  const ik = applyTargets(anim, tks, rig);
  motionFlow(anim);
  // ---- 8. overshoot + settle after impacts, arcs through the keys of fast swings (30-60 fps, then thinned) ----
  const segs = targetSegments(tks);
  anim.overshoots = addOvershoot(anim, { rig });
  anim.arcKeys = resampleArcs(anim, { rig, skip: (j, t0, t1) => segmentCovers(segs, j, t0, t1) }) + resampleTargets(anim, segs, rig);
  // ---- 9. foot lock: planted feet stay where they landed (IK on the legs) ----
  anim.feetLocked = standing ? lockFeet(anim, { rig, skip: plantSkip }) : 0;

  for (const tr of Object.values(anim.tracks)) for (const k of tr) {
    k.t = r3(k.t); k.r = k.r.map(r3); if (k.p) k.p = k.p.map(r3);
    delete k.ph; delete k.pin;
  }
  anim.airTimes = airTimes.map(r3);
  anim.airIntervals = airIntervals.map(iv => iv.map(r3));
  anim.warnings = [...check(anim, rig), ...ik.reach].slice(0, 8);
  return anim;
}

// Same rotation, possibly a whole number of turns apart (e.g. 0 and 360)?
const sameRotation = (a, b, tol = 0.5) => a.every((v, i) => { const d = Math.abs(v - b[i]) % 360; return Math.min(d, 360 - d) < tol; });

export const cleanName = s => String(s || 'Combat').replace(/[^\w ]/g, '').trim().slice(0, 40) || 'Combat';

// Models often finish a flip with the angle "wrapped" (…, -300, then 0 for upright) instead of
// continuing the count (-360). Read literally that is a 300° turn the other way: a second flip.
// When a big step reverses the direction of the turn before it, and the wrapped reading would
// just continue that turn, use the wrapped reading. Later keys shift by the same 360° so a hold
// at 0 stays a hold.
function unwrapTurns(tr) {
  for (let c = 0; c < 3; c++) {
    for (let i = 2; i < tr.length; i++) {
      const prev = tr[i - 1].r[c] - tr[i - 2].r[c];
      const step = tr[i].r[c] - tr[i - 1].r[c];
      if (Math.abs(step) <= 180 || Math.abs(prev) < 30) continue;
      const wrapped = step - 360 * Math.sign(step);
      if (wrapped * prev < 0 || Math.sign(step) === Math.sign(prev)) continue; // wrapped = 0 (a full 360 step) counts too
      for (let k = i; k < tr.length; k++) tr[k].r[c] -= 360 * Math.sign(step);
    }
  }
  return tr;
}

function splitTurns(tr) {
  const out = [tr[0]];
  for (let i = 1; i < tr.length; i++) {
    const a = tr[i - 1], b = tr[i];
    const big = Math.max(...b.r.map((v, n) => Math.abs(v - a.r[n])));
    if (big <= SPLIT_ABOVE) { out.push(b); continue; }
    const n = Math.ceil(big / MAX_STEP);
    const e = a.e; // easing of the whole segment (it leaves `a`)
    for (let s = 0; s < n; s++) {
      const from = s === 0 ? a : out.at(-1);
      // outer pieces keep the slow start / end, inner pieces are linear
      from.e = (s === 0 && (e === 'in' || e === 'inout')) ? 'in' : (s === n - 1 && (e === 'out' || e === 'inout')) ? 'out' : e === 'linear' ? 'linear' : 'linear';
      if (s < n - 1) {
        const f = (s + 1) / n;
        out.push({ t: a.t + (b.t - a.t) * f, r: a.r.map((v, c) => v + (b.r[c] - v) * f), e: 'linear', ...(a.p ? { p: a.p.map((v, c) => v + (b.p[c] - v) * f) } : {}) });
      } else out.push(b);
    }
  }
  return out;
}

// ---- grounding ----
// Mid-flip or mid-roll the feet are nowhere near the floor, so the body must not be pulled down to it.
const isUpright = w => rotV(w.LowerTorso.R, [0, 1, 0])[1] > 0.7;
const MAX_GROUND_SHIFT = 1.5;
// 'feet': the lowest foot corner, only meaningful while upright. 'body': the lowest corner of any body part, in any pose.
function footLow(anim, t, rig, mode = 'feet') {
  const w = worldAt(anim, t, rig);
  return mode === 'body' ? { low: lowestY(w, JOINTS, rig), upright: true } : { low: lowestY(w, FEET, rig), upright: isUpright(w) };
}
const nearAir = (t, air) => air.some(a => Math.abs(a - t) < 1e-6);

function groundBody(anim, air, intervals, rig, mode = 'feet') {
  // a crawl or a collapse can sit well above or below the floor (hips are ~2.3 studs high at rest), so body mode may shift up to the p clamp
  const maxShift = mode === 'body' ? 4 : MAX_GROUND_SHIFT;
  const root = (anim.tracks.LowerTorso ??= [{ t: 0, r: [0, 0, 0], p: [0, 0, 0], e: 'linear' }, { t: anim.duration, r: [0, 0, 0], p: [0, 0, 0], e: 'linear' }]);
  // A key on the body track at time t that reproduces the pose already there.
  const ensureKey = t => {
    const i = root.findIndex(k => Math.abs(k.t - t) < 1e-6);
    if (i >= 0) return root[i];
    const nxt = root.findIndex(k => k.t > t);
    const prev = root[nxt - 1];
    const s = sampleTrack(root, t);
    // pick the Euler form closest to the previous key so cumulative turns (…, 330, 342, 360) stay cumulative
    const r = eulerDeg(s.R).map((v, c) => v + 360 * Math.round((prev.r[c] - v) / 360));
    const key = { t, r, p: [...s.p], e: prev.e };
    root.splice(nxt, 0, key);
    return key;
  };
  for (let pass = 0; pass < 2; pass++) {
    for (const t of keyTimes(anim, /Torso|Leg|Foot/)) { // only joints that move the feet matter
      if (nearAir(t, air)) continue;
      const { low, upright } = footLow(anim, t, rig, mode);
      if (!upright || Math.abs(low) < 1e-4 || Math.abs(low) > maxShift) continue;
      const k = ensureKey(t);
      k.p[1] = Math.max(-4, Math.min(4, k.p[1] - low));
    }
  }
  // Between keys the legs can still push through the floor (most at take-offs). Add a body key
  // at the deepest frame, lifted so the foot touches the ground, until nothing sinks.
  for (let added = 0; added < 8; added++) {
    let worst = null;
    for (let t = 1 / 60; t < anim.duration; t += 1 / 60) {
      if (airBetween(intervals, t)) continue;
      const { low, upright } = footLow(anim, t, rig, mode);
      if (upright && low < -0.05 && low > -maxShift && (!worst || low < worst.low)) worst = { t: r3(t), low };
    }
    if (!worst) break;
    const k = ensureKey(worst.t);
    k.p[1] = Math.min(4, k.p[1] - worst.low);
  }
}
// true when t lies inside a flight: one of the [start, end] intervals of consecutive air keys. The grounded
// stretch between two separate jumps is NOT airborne.
export const airBetween = (intervals, t) => intervals.some(([a, b]) => t > a && t < b);

// ---- motion flow ----
// With no tangents across keys, 'inout' on every key makes continuous motion stop at each key.
// A key a joint passes through in the same direction gets pass-through easing instead.
function motionFlow(anim) {
  for (const tr of Object.values(anim.tracks)) {
    const n = tr.length;
    if (n < 3) continue;
    const delta = i => tr[i].r.map((v, c) => v - tr[i - 1].r[c]);
    const pass = Array.from({ length: n }, (_, i) => {
      if (i === 0 || i === n - 1) return false;
      const a = delta(i), b = delta(i + 1);
      const na = Math.hypot(...a), nb = Math.hypot(...b);
      if (na < 1 || nb < 1) return false;
      return (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (na * nb) > 0.5;
    });
    for (let i = 0; i < n - 1; i++) {
      if (tr[i].e !== 'inout') continue; // respect the strike/wind-up easing the model chose on purpose
      const a = pass[i], b = pass[i + 1];
      if (a && b) tr[i].e = 'linear';
      else if (!a && b) tr[i].e = 'in';
      else if (a && !b) tr[i].e = 'out';
    }
  }
}

// ---- checks (reported to the UI and to the auto-repair; they never change the clip) ----
// ground: feet in the floor · inside: hands through the body, hands through the legs, one leg through the other ·
// snap: a joint turning faster than anyone could · loop: a loop that does not end where it starts.
export function check(anim, rig = RIG_R15) {
  const found = new Map();
  const add = (type, joint, t, msg, key = `${type}:${joint}`) => { if (!found.has(key)) found.set(key, { type, joint, t: r3(t), msg }); };
  const air = anim.airIntervals ?? groupFromTimes(anim.airTimes ?? []);
  const ground = GROUNDS.includes(anim.ground) ? anim.ground : 'feet';
  let prev = null;
  for (let t = 0; t <= anim.duration + 1e-9; t += 1 / 60) {
    const tf = transformsAt(anim, Math.min(t, anim.duration));
    const w = solve(tf, rig);
    if (ground !== 'none' && !airBetween(air, t) && (ground === 'body' || isUpright(w))) {
      const low = lowestY(w, ground === 'body' ? JOINTS : FEET, rig);
      const what = ground === 'body' ? 'Body' : 'Feet';
      if (low < -0.12) add('ground', what, t, `${what} sink ${Math.abs(low).toFixed(2)} studs into the floor at ${t.toFixed(2)}s`);
    }
    if (prev) for (const j of Object.keys(tf)) {
      const d = angleBetween(prev.tf[j].R, tf[j].R) / (t - prev.t);
      if (d > (j === 'LowerTorso' ? 3200 : 2600)) add('snap', j, t, `${j} snaps (${Math.round(d)}°/s) at ${t.toFixed(2)}s`);
    }
    prev = { t, tf };
  }
  for (const c of collisions(anim, rig)) add('inside', c.probe, c.t, describe(c), `inside:${c.probe}:${c.kind}`);
  if (anim.loop) {
    for (const [j, tr] of Object.entries(anim.tracks)) if (!sameRotation(tr[0].r, tr.at(-1).r)) { add('loop', j, anim.duration, `${j} does not end where it starts, so the loop pops`); break; }
  }
  return [...found.values()].slice(0, 8);
}
// Older clips only stored air times: treat them as one flight.
const groupFromTimes = a => (a.length >= 2 ? [[a[0], a.at(-1)]] : a.length ? [[a[0] - AIR_WINDOW, a[0] + AIR_WINDOW]] : []);

// Angle between two local joint rotations, in degrees.
function angleBetween(A, B) {
  const m = mul({ p: [0, 0, 0], R: [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]] }, { p: [0, 0, 0], R: B }).R;
  const c = Math.max(-1, Math.min(1, (m[0] + m[4] + m[8] - 1) / 2));
  return (Math.acos(c) * 180) / Math.PI;
}
