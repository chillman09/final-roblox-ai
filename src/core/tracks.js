// Small helpers for editing per-joint tracks: tracks[joint] = [{ t, r:[x,y,z], p?, e, ph? }].
// Shared by the IK, arc and repair passes. Pure, no dependencies beyond the core maths.

export const r3 = n => Math.round(n * 1000) / 1000;
export const r2 = n => Math.round(n * 100) / 100;

// A joint that has no track yet gets one that holds the rest pose for the whole clip.
export function ensureTrack(anim, joint) {
  return (anim.tracks[joint] ??= [
    { t: 0, r: [0, 0, 0], e: 'linear', ...(joint === 'LowerTorso' ? { p: [0, 0, 0] } : {}) },
    { t: anim.duration, r: [0, 0, 0], e: 'linear', ...(joint === 'LowerTorso' ? { p: [0, 0, 0] } : {}) },
  ]);
}

// Set the rotation of the key at time t (replacing it) or insert one that inherits the easing of the
// segment it lands in, so the curve before it keeps its shape. `extra` may override e / ph / p.
export function setKey(track, t, r, extra = {}) {
  const i = track.findIndex(k => Math.abs(k.t - t) < 1e-4);
  if (i >= 0) { track[i] = { ...track[i], r, ...extra }; return track[i]; }
  const nxt = track.findIndex(k => k.t > t);
  const prev = track[(nxt < 0 ? track.length : nxt) - 1] ?? track[0];
  const key = { t, r, e: prev.e, ...extra };
  track.splice(nxt < 0 ? track.length : nxt, 0, key);
  return key;
}

// An Euler angle that is the same rotation but sits inside [lo, hi] (e.g. +190 vs -170), else clamped.
export function fitAngle(v, [lo, hi]) {
  for (const k of [0, -360, 360]) if (v + k >= lo - 1e-6 && v + k <= hi + 1e-6) return v + k;
  return Math.min(hi, Math.max(lo, v));
}
