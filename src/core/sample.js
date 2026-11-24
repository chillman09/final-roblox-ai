// Samples an animation the way Roblox plays a KeyframeSequence, so the preview, the grounding
// pass and the checks all see the same pose Studio will.
//
// Data model (what polish() returns): tracks[joint] = [{ t, r:[x,y,z]deg, p?:[x,y,z], e }].
// `e` is the easing style of the segment LEAVING that key, exactly what a Roblox Pose stores
// (the pose at the start of a segment decides its curve).
import { anglesDeg, cf, solve, quatFromR, rFromQuat, quatLog, quatFromRotVec, alignQuat, IDENTITY } from './rig.js';

export const EASE = {
  linear: s => s,
  in: s => s ** 3,
  out: s => 1 - (1 - s) ** 3,
  inout: s => (s < 0.5 ? 4 * s ** 3 : 1 - (-2 * s + 2) ** 3 / 2),
};

const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);

// Rotation blend measured in Studio: two Linear poses use a normalised quaternion lerp, every
// other pair lerps rotation vectors. Both take the shorter way round.
function blendRotation(a, b, k, bothLinear) {
  const canon = q => (q[3] < 0 ? q.map(v => -v) : q); // w ≥ 0, so rotation vectors stay within ±180°
  const qa = canon(quatFromR(anglesDeg(a.r))), qb = alignQuat(qa, canon(quatFromR(anglesDeg(b.r))));
  if (bothLinear) {
    const q = mix(qa, qb, k), n = Math.hypot(...q) || 1;
    return rFromQuat(q.map(v => v / n));
  }
  return rFromQuat(quatFromRotVec(mix(quatLog(qa), quatLog(qb), k)));
}

// Pose of one joint at time t: { p, R } = Motor6D.Transform.
export function sampleTrack(tr, t) {
  const at = key => cf(key.p ?? [0, 0, 0], anglesDeg(key.r));
  if (t <= tr[0].t) return at(tr[0]);
  const last = tr.at(-1);
  if (t >= last.t) return at(last);
  let i = 1;
  while (tr[i].t < t) i++;
  const a = tr[i - 1], b = tr[i];
  const k = (EASE[a.e] ?? EASE.inout)((t - a.t) / (b.t - a.t));
  const pa = a.p ?? [0, 0, 0], pb = b.p ?? [0, 0, 0];
  const bothLinear = a.e === 'linear' && b.e === 'linear';
  return { p: mix(pa, pb, k), R: blendRotation(a, b, k, bothLinear) };
}

export function transformsAt(anim, t) {
  const out = {};
  for (const [joint, tr] of Object.entries(anim.tracks)) out[joint] = sampleTrack(tr, t);
  return out;
}

export const worldAt = (anim, t, rig) => solve(transformsAt(anim, t), rig);

// Sorted union of all key times.
export function keyTimes(anim, only) {
  const set = new Set();
  for (const [j, tr] of Object.entries(anim.tracks)) if (!only || only.test(j)) for (const k of tr) set.add(k.t);
  return [...set].sort((a, b) => a - b);
}

export { IDENTITY };
