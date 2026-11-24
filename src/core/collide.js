// Collision probes for the clip checker and the push-out repair. A probe is a point on a limb; it
// "intersects" a part when it sits inside that part's box shrunk by SHRINK on every side (so
// grazing the surface is fine, only real clipping counts). Three kinds are checked:
//   body     hands / forearms against Head, UpperTorso, LowerTorso
//   arm-leg  hands / forearms against the thighs and shins
//   leg-leg  shin, foot and thigh points of one leg against the other leg
import { solve, inv, point, rotV } from './rig.js';
import { transformsAt } from './sample.js';

export const SHRINK = 0.12;
const SIDES = ['Left', 'Right'];
const other = s => (s === 'Left' ? 'Right' : 'Left');

export function pairsFor(rig) {
  const has = p => !!rig.parts[p];
  const arms = (rig.probes ?? []).filter(([j]) => has(j));
  const legsOf = s => [`${s}UpperLeg`, `${s}LowerLeg`].filter(has);
  const pairs = [];
  for (const [probe, off] of arms) {
    for (const body of rig.colliders ?? []) pairs.push({ kind: 'body', probe, off, body });
    for (const s of SIDES) for (const body of legsOf(s)) pairs.push({ kind: 'arm-leg', probe, off, body });
  }
  for (const s of SIDES) {
    for (const [probe, off] of [[`${s}LowerLeg`, [0, 0, 0]], [`${s}Foot`, [0, 0, 0]], [`${s}UpperLeg`, [0, -0.25, 0]]]) {
      if (!has(probe)) continue;
      for (const body of legsOf(other(s))) pairs.push({ kind: 'leg-leg', probe, off, body });
    }
  }
  return pairs;
}

// Penetration of a world point into a part's shrunk box: null when outside, else
// { depth, normal (world, unit, pointing out through the nearest face), out (distance to leave the real surface) }.
export function penetration(world, body, p, rig) {
  const local = point(inv(world[body]), p);
  const half = rig.parts[body].map(v => v / 2 - SHRINK);
  if (half.some(h => h <= 0)) return null;
  let axis = -1, depth = Infinity;
  for (let i = 0; i < 3; i++) {
    const pen = half[i] - Math.abs(local[i]);
    if (pen <= 0) return null;
    if (pen < depth) { depth = pen; axis = i; }
  }
  const n = [0, 0, 0];
  n[axis] = local[axis] >= 0 ? 1 : -1;
  return { depth, normal: rotV(world[body].R, n), out: depth + SHRINK + 0.02 };
}

// Every intersection of the clip, sampled at 60 fps: [{ t, kind, probe, body, depth, normal, out, pos }].
export function collisions(anim, rig, { step = 1 / 60 } = {}) {
  const pairs = pairsFor(rig);
  const found = [];
  for (let t = 0; t <= anim.duration + 1e-9; t += step) {
    const tt = Math.min(t, anim.duration);
    const w = solve(transformsAt(anim, tt), rig);
    for (const { kind, probe, off, body } of pairs) {
      const pos = point(w[probe], off);
      const hit = penetration(w, body, pos, rig);
      if (hit) found.push({ t: tt, kind, probe, body, pos, ...hit });
    }
  }
  return found;
}

export const describe = (c, t = c.t) => c.kind === 'leg-leg'
  ? `${c.probe} crosses through the ${c.body} at ${t.toFixed(2)}s`
  : `${c.probe} passes through the ${c.body} at ${t.toFixed(2)}s`;
