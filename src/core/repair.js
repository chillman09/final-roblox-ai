// Deterministic repair for hands / forearms that clip into the body or the legs.
// For each intersection found in the polished clip, the hand is pushed out along the collider's
// normal, to just outside its surface, as a Hand-IK target on the nearest key (or a new "pass"
// key at the moment of the clipping); polish() then re-solves the arm. Works on the model's raw
// JSON, so the repaired clip stays an editable animation. Pure, no dependencies.
import { RIG_R15 } from './rig.js';
import { collisions } from './collide.js';
import { worldAt } from './sample.js';
import { polish } from './polish.js';

const HANDS = { RightHand: 'RightHand', RightLowerArm: 'RightHand', LeftHand: 'LeftHand', LeftLowerArm: 'LeftHand' };
const MINOR = 0.45;        // studs deep (inside the shrunk collider): deeper than this is a pose problem, not a nudge
const MAX_PER_ROUND = 6;
const FOREARM_GAIN = 1.6;  // a forearm point moves ~60% as far as the hand does

// One round: returns { raw: repaired copy, pushed: n }.
export function pushOutRound(raw, anim, rig = RIG_R15) {
  const hits = collisions(anim, rig).filter(c => HANDS[c.probe] && c.depth <= MINOR);
  const next = structuredClone(raw);
  next.keys = next.keys.filter(k => k && typeof k === 'object');
  // worst hit of every contiguous clipping per hand
  const clusters = [];
  for (const hand of new Set(hits.map(h => HANDS[h.probe]))) {
    let cur = null;
    for (const h of hits.filter(x => HANDS[x.probe] === hand).sort((a, b) => a.t - b.t)) {
      if (!cur || h.t - cur.last > 0.1) clusters.push(cur = { hand, worst: h, last: h.t });
      cur.last = h.t;
      if (h.out > cur.worst.out) cur.worst = h;
    }
  }
  let pushed = 0;
  for (const { hand, worst } of clusters.sort((a, b) => b.worst.out - a.worst.out).slice(0, MAX_PER_ROUND)) {
    const gain = worst.probe.endsWith('LowerArm') ? FOREARM_GAIN : 1;
    const d = worst.normal.map(v => v * worst.out * gain);
    // the first and last key are the clip's rest / loop poses: never pin them, add a key at the moment of the clipping instead
    const end = Math.max(...next.keys.map(k => +k.t || 0));
    let key = next.keys.find(k => Math.abs((+k.t || 0) - worst.t) < 0.03 && (+k.t || 0) > 0 && (+k.t || 0) < end - 1e-6);
    if (!key) {
      key = { t: Math.round(worst.t * 1000) / 1000, ease: 'inout', phase: 'pass', pose: {} };
      next.keys.push(key);
      next.keys.sort((a, b) => (+a.t || 0) - (+b.t || 0));
    }
    key.auto = true; // a target the repair added: not worth a "cannot reach" warning
    key.targets ??= {};
    const have = key.targets[hand]?.pos;
    // already pinned there: move the existing target, else start from where the hand really is
    const from = Array.isArray(have) ? have : worldAt(anim, worst.t, rig)[hand].p;
    key.targets[hand] = { ...key.targets[hand], pos: from.map((v, i) => Math.round((v + d[i]) * 1000) / 1000) };
    pushed++;
  }
  return { raw: next, pushed };
}

// Repeats pushOutRound (re-polishing in between) until no minor hand clipping is left or it stops helping.
export function pushOutInside(raw, anim, { rig = RIG_R15, rounds = 4 } = {}) {
  let cur = { raw, anim, pushed: 0 };
  for (let i = 0; i < rounds; i++) {
    if (!cur.anim.warnings.some(w => w.type === 'inside')) break;
    const step = pushOutRound(cur.raw, cur.anim, rig);
    if (!step.pushed) break;
    let a;
    try { a = polish(step.raw, { rig }); } catch { break; }
    const before = cur.anim.warnings.filter(w => w.type === 'inside').length;
    const after = a.warnings.filter(w => w.type === 'inside').length;
    if (after > before) break; // made it worse: keep the previous clip
    cur = { raw: step.raw, anim: a, pushed: cur.pushed + step.pushed };
  }
  return cur;
}
