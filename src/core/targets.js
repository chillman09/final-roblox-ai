// IK targets: a keyframe may pin a hand or foot to a point in character space
// (x right, y up from the floor, z backwards; the character stands at x = z = 0, so a punch
// forward lands at a NEGATIVE z) with an optional pole (the point the elbow / knee bends towards):
//   "targets": { "RightHand": { "pos": [x, y, z], "pole": [x, y, z] }, "LeftFoot": { ... } }
// For feet, pos is the sole of the foot (y 0 = floor); for hands it is the centre of the hand.
//
// applyTargets solves each target with the analytic two-bone IK (ik.js) and writes the arm / leg keys
// at that keyframe. resampleTargets then moves the hand along a spline THROUGH the targets of
// consecutive keys (instead of through joint space), so a strike travels in an arc and arrives
// exactly on its target.
import { IK_CHAINS, solveTarget } from './ik.js';
import { transformsAt, EASE } from './sample.js';
import { eulerDeg, RIG_R15 } from './rig.js';
import { ensureTrack, setKey, r2, r3 } from './tracks.js';
import { hermite, tangent, simplifyRun, isDynPhase, isPeak, TOLERANCE } from './arcs.js';

export const TARGET_NAMES = Object.keys(IK_CHAINS);
const REACH_TOL = 0.05;
const LIMIT = 12;
const GRID = 1 / 30;
const num3 = v => Array.isArray(v) && v.length >= 3 && [0, 1, 2].every(i => Number.isFinite(+v[i])) ? [0, 1, 2].map(i => Math.max(-LIMIT, Math.min(LIMIT, +v[i]))) : null;

// What the model wrote → { RightHand: { pos, pole? }, ... } (bad entries dropped), or null.
export function cleanTargets(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const name of TARGET_NAMES) {
    const t = raw[name];
    const pos = num3(t?.pos);
    if (!pos) continue;
    out[name] = { pos, ...(num3(t.pole) ? { pole: num3(t.pole) } : {}) };
  }
  return Object.keys(out).length ? out : null;
}

// The chain a joint belongs to when it is driven by a target (so keys of that chain are not time-shifted).
export const CHAIN_OF = Object.fromEntries(Object.entries(IK_CHAINS).flatMap(([name, c]) => [...c.joints, ...(c.foot ? [c.end] : [])].map(j => [j, name])));

// tks: [{ t, phase, targets }] sorted by time. Solves every target at its key time.
// Returns { solved, reach: [warnings for targets the limb cannot reach] }.
export function applyTargets(anim, tks, rig = RIG_R15) {
  const reach = [];
  let solved = 0;
  for (const { t, targets, auto } of tks) {
    if (anim.loop && t >= anim.duration - 1e-6) continue; // a loop's last key repeats the first
    for (const [name, tg] of Object.entries(targets)) {
      const chain = IK_CHAINS[name];
      for (const j of chain.joints) ensureTrack(anim, j);
      if (chain.foot) ensureTrack(anim, chain.end);
      const base = transformsAt(anim, t);
      const flat = !!chain.foot && tg.pos[1] < 0.06; // a foot on the floor lies flat; a kick keeps its own pose
      const r = solveTarget(name, tg.pos, base, rig, { flat, pole: tg.pole });
      for (const [j, rot] of Object.entries(r.rotations)) setKey(anim.tracks[j], t, rot.map(r2));
      solved++;
      if (r.error > REACH_TOL && !auto) reach.push({ type: 'reach', joint: name, t: r3(t), msg: `${name} cannot reach its target at ${t.toFixed(2)}s (${r.error.toFixed(2)} studs short): move it closer or lunge towards it` });
    }
  }
  return { solved, reach };
}

// Consecutive target keys of the same limb that form a dynamic segment (strike / follow-through / a long sweep).
export function targetSegments(tks) {
  const segs = [];
  for (const name of TARGET_NAMES) {
    const seq = tks.filter(k => k.targets[name]);
    for (let i = 0; i < seq.length - 1; i++) {
      const a = seq[i], b = seq[i + 1];
      const far = Math.hypot(...[0, 1, 2].map(c => a.targets[name].pos[c] - b.targets[name].pos[c]));
      if (b.t - a.t < 0.06 || !(isDynPhase(a.phase) || isDynPhase(b.phase) || far > 1.5)) continue;
      segs.push({ name, a, b, prev: seq[i - 1] ?? null, next: seq[i + 2] ?? null });
    }
  }
  return segs;
}
export const segmentCovers = (segs, joint, t0, t1) => segs.some(s => CHAIN_OF[joint] === s.name && Math.abs(s.a.t - t0) < 1e-4 && Math.abs(s.b.t - t1) < 1e-4);

// Move each limb along a spline through its targets, solving the IK on the 30 fps grid.
export function resampleTargets(anim, segs, rig = RIG_R15, tolerance = TOLERANCE) {
  let added = 0;
  for (const { name, a, b, prev, next } of segs) {
    if (anim.loop && b.t >= anim.duration - 1e-6) continue;
    const chain = IK_CHAINS[name], dt = b.t - a.t;
    const pa = a.targets[name], pb = b.targets[name];
    const ease = EASE[anim.tracks[chain.joints[0]].find(k => Math.abs(k.t - a.t) < 1e-4)?.e] ?? EASE.inout;
    const pPrev = prev?.targets[name]?.pos, pNext = next?.targets[name]?.pos;
    const m0 = isPeak(a.phase) ? [0, 0, 0] : tangent(pPrev, prev?.t, pb.pos, b.t, dt) ?? pb.pos.map((v, i) => v - pa.pos[i]);
    const m1 = isPeak(b.phase) ? [0, 0, 0] : tangent(pa.pos, a.t, pNext, next?.t, dt) ?? pb.pos.map((v, i) => v - pa.pos[i]);
    const poles = pa.pole && pb.pole ? [pa.pole, pb.pole] : pa.pole ? [pa.pole, pa.pole] : pb.pole ? [pb.pole, pb.pole] : null;
    const joints = [...chain.joints, ...(chain.foot ? [chain.end] : [])];
    const flat = !!chain.foot && pa.pos[1] < 0.06 && pb.pos[1] < 0.06;
    for (const j of joints) { const k = anim.tracks[j].find(x => Math.abs(x.t - a.t) < 1e-4); if (k) k.e = 'linear'; }
    for (let g = Math.floor((a.t + 0.012) / GRID + 1e-9) + 1; g * GRID < b.t - 0.012; g++) {
      const t = r3(g * GRID), s = (t - a.t) / dt, u = ease(s);
      // as in arcs.js: only the bulge perpendicular to the straight line comes from the spline, timing stays the eased one
      const h = hermite(pa.pos, pb.pos, m0, m1, u);
      const chord = pb.pos.map((v, i) => v - pa.pos[i]), cl = Math.hypot(...chord) || 1;
      const off = h.map((v, i) => v - (pa.pos[i] + chord[i] * u));
      const along = off.reduce((x, v, i) => x + (v * chord[i]) / cl, 0);
      const pos = pa.pos.map((v, i) => v + chord[i] * u + off[i] - (along * chord[i]) / cl);
      const pole = poles && poles[0].map((v, i) => v + (poles[1][i] - v) * u);
      const r = solveTarget(name, pos, transformsAt(anim, t), rig, { flat, pole });
      for (const [j, rot] of Object.entries(r.rotations)) setKey(anim.tracks[j], t, rot.map(r2), { e: 'linear' });
      added++;
    }
    for (const j of joints) {
      const tr = anim.tracks[j];
      const i0 = tr.findIndex(k => Math.abs(k.t - a.t) < 1e-4), i1 = tr.findIndex(k => Math.abs(k.t - b.t) < 1e-4);
      if (i0 >= 0 && i1 > i0) simplifyRun(tr, i0, i1, tolerance);
    }
  }
  return added;
}
