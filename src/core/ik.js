// Two-bone limb IK for the R15 arms and legs, adapted from OpenRig Studio (MIT, see NOTICE).
//
// The model may give target positions for hands and feet (character space: x right, y up from the
// ground, z backwards) and an optional pole (a point the elbow / knee is pushed towards).
//
// solveChain is ANALYTIC: the elbow / knee is a hinge, so the distance shoulder → wrist fixes its
// angle exactly (law of cosines on the real joint offsets of the rig), the shoulder / hip swings
// the limb at the target, and the pole decides which way the elbow / knee points (twist around
// the shoulder → wrist line). Every candidate is checked against RIG.limits. Damped least squares
// (the old solver) only runs when a joint limit stopped the analytic answer from reaching a
// target that is within reach.
import { RIG_R15, solve, anglesDeg, cf, rotV, mulR, mul, point, eulerDeg } from './rig.js';

export const IK_CHAINS = {
  RightHand: { joints: ['RightUpperArm', 'RightLowerArm'], end: 'RightHand' },
  LeftHand: { joints: ['LeftUpperArm', 'LeftLowerArm'], end: 'LeftHand' },
  RightFoot: { joints: ['RightUpperLeg', 'RightLowerLeg'], end: 'RightFoot', foot: true },
  LeftFoot: { joints: ['LeftUpperLeg', 'LeftLowerLeg'], end: 'LeftFoot', foot: true },
};
// Parameters per chain for the numeric fallback: upper x, y, z and the hinge (lower x).
const PARAMS = [[0, 0], [0, 1], [0, 2], [1, 0]];
const clampTo = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const D2R = Math.PI / 180;

// ---- small vector helpers ----
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const unit = (a, fallback = [0, -1, 0]) => { const l = len(a); return l < 1e-9 ? fallback : scale(a, 1 / l); };
const transpose = R => [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];
// Rotation about a unit axis (Rodrigues), row-major like the rest of rig.js.
function rotAxis(k, a) {
  const c = Math.cos(a), s = Math.sin(a), v = 1 - c;
  return [
    c + k[0] * k[0] * v, k[0] * k[1] * v - k[2] * s, k[0] * k[2] * v + k[1] * s,
    k[1] * k[0] * v + k[2] * s, c + k[1] * k[1] * v, k[1] * k[2] * v - k[0] * s,
    k[2] * k[0] * v - k[1] * s, k[2] * k[1] * v + k[0] * s, c + k[2] * k[2] * v,
  ];
}
// Shortest rotation taking unit vector u onto unit vector v.
function rotBetween(u, v) {
  const ax = cross(u, v), s = len(ax), c = dot(u, v);
  if (s < 1e-9) {
    if (c > 0) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const side = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    return rotAxis(unit(cross(u, side)), Math.PI);
  }
  return rotAxis(scale(ax, 1 / s), Math.atan2(s, c));
}

function transformsFrom(rotations, base) {
  const out = { ...base };
  for (const [part, rot] of Object.entries(rotations)) out[part] = cf(base[part]?.p ?? [0, 0, 0], anglesDeg(rot));
  return out;
}

// Exact segment geometry of a chain, read from the rig's joint offsets. All offsets are pure
// translations in R15 (c0R / c1R absent); a rig with rotated joint frames falls back to the
// numeric solver.
const geomCache = new WeakMap();
function geometry(name, rig) {
  const per = geomCache.get(rig) ?? geomCache.set(rig, {}).get(rig);
  if (name in per) return per[name];
  const chain = IK_CHAINS[name];
  const jt = part => rig.joints.find(j => j.part1 === part);
  const [j1, j2] = chain.joints.map(jt), je = jt(chain.end);
  const rotated = [j1, j2, je].some(j => !j || j.c0R || j.c1R);
  if (rotated) return (per[name] = null);
  // shoulder pivot → elbow pivot (upper-bone frame), elbow pivot → wrist pivot (lower-bone frame)
  per[name] = { j1, j2, je, a: sub(j2.c0, j1.c1), b: sub(je.c0, j2.c1), endOff: scale(je.c1, -1) };
  return per[name];
}

// Public: lengths of the two bones (shoulder → elbow, elbow → wrist) from the rig.
export function segmentLengths(name, rig = RIG_R15) {
  const g = geometry(name, rig);
  return g ? { upper: len(g.a), lower: len(g.b) } : null;
}

const hingeVec = (b, th) => [b[0], Math.cos(th) * b[1] - Math.sin(th) * b[2], Math.sin(th) * b[1] + Math.cos(th) * b[2]];

// Elbow / knee angle for a shoulder → wrist distance d, kept inside the joint limits (and at least
// `minBend` degrees bent). Returns { th (rad), reach: distance really achieved }.
function hingeFor(g, d, lim, minBend) {
  const { a, b } = g;
  const A = dot(a, a), B = dot(b, b);
  const K = Math.hypot(a[1] * b[1] + a[2] * b[2], a[2] * b[1] - a[1] * b[2]);
  const delta = Math.atan2(a[2] * b[1] - a[1] * b[2], a[1] * b[1] + a[2] * b[2]);
  let lo = lim[0] * D2R, hi = lim[1] * D2R;
  const mb = minBend * D2R;
  if (mb > 0) { if (hi <= 0) hi = Math.min(hi, -mb); else if (lo >= 0) lo = Math.max(lo, mb); }
  const reachOf = th => len(add(a, hingeVec(b, th)));
  const c = Math.max(-1, Math.min(1, (d * d - A - B - 2 * a[0] * b[0]) / (2 * K)));
  const off = Math.acos(c);
  const norm = x => { while (x > Math.PI) x -= 2 * Math.PI; while (x < -Math.PI) x += 2 * Math.PI; return x; };
  let best = null;
  for (const raw of [norm(delta + off), norm(delta - off)]) {
    const th = Math.min(hi, Math.max(lo, raw));
    const miss = Math.abs(reachOf(th) - d) + Math.abs(th - raw) * 1e-3;
    if (!best || miss < best.miss - 1e-9) best = { th, miss };
  }
  return { th: best.th, reach: reachOf(best.th) };
}

const limitViolation = (euler, lim) => euler.reduce((s, v, i) => s + Math.max(0, lim[i][0] - v, v - lim[i][1]), 0);
// Equivalent Euler angle that falls inside [lo, hi] when one exists (e.g. +190 vs -170).
const intoRange = (v, [lo, hi]) => { for (const k of [0, -360, 360]) if (v + k >= lo - 1e-6 && v + k <= hi + 1e-6) return v + k; return v; };

// One analytic solution for the wrist pivot at W. Returns the two joint rotations.
function solveOnce(g, S, Pn, W, pole, guessElbowDir, rig, minBend) {
  const lim1 = rig.limits[g.j1.part1], lim2 = rig.limits[g.j2.part1];
  const dv = sub(W, S), d = len(dv), D = unit(dv);
  const { th } = hingeFor(g, d, lim2[0], minBend);
  const q = add(g.a, hingeVec(g.b, th));                      // shoulder pivot → wrist pivot, in the upper-bone frame
  const swing = rotBetween(unit(q), D);                       // any rotation taking q onto D…
  const elbow0 = rotV(swing, g.a);
  const c0 = sub(elbow0, scale(D, dot(elbow0, D)));           // …then twist about D so the elbow points to the pole
  let want = pole ? sub(sub(pole, S), scale(D, dot(sub(pole, S), D))) : guessElbowDir ? sub(guessElbowDir, scale(D, dot(guessElbowDir, D))) : null;
  let psi = 0;
  if (want && len(want) > 1e-6 && len(c0) > 1e-6) psi = Math.atan2(dot(D, cross(c0, want)), dot(c0, want));
  let best = null;
  for (const k of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7, 8, -8, 9, -9, 10, -10, 11, -11, 12]) {
    const R = mulR(rotAxis(D, psi + k * 15 * D2R), swing);
    const eul = eulerDeg(mulR(transpose(Pn), R)).map((v, i) => intoRange(v, lim1[i]));
    const viol = limitViolation(eul, lim1);
    if (!best || viol < best.viol - 1e-9) best = { viol, eul, R };
    if (viol < 1e-6) break;
  }
  const upper = best.eul.map((v, i) => clampTo(v, lim1[i]));
  return { upper, lower: [th / D2R, 0, 0], violation: best.viol, Rup: best.R };
}

// base: sampled transforms {part: {p, R}} at this keyframe; rot: current [x,y,z] per joint (the model's own guess).
// Returns new rotations for the chain joints (+ foot when flat) and the remaining error in studs.
// Options: flat   – turn the foot so its sole is parallel to the ground (off: the foot keeps its own pose)
//          yaw    – world yaw (deg) the flat foot should keep; default = the foot's own current yaw
//          pole   – point in character space the elbow / knee is pushed towards (default: where the guess has it)
//          minBend – smallest knee / elbow bend in degrees (keeps planted legs from locking straight)
export function solveChain(name, target, base, rot, rig = RIG_R15, { flat = true, yaw, pole, minBend = 0 } = {}) {
  const chain = IK_CHAINS[name];
  const want = chain.foot ? [target[0], target[1] + rig.parts[chain.end][1] / 2, target[2]] : target;
  const lim = j => rig.limits[j];
  const endPos = state => solve(transformsFrom(state, base), rig)[chain.end].p;
  const err = state => { const p = endPos(state); return [want[0] - p[0], want[1] - p[1], want[2] - p[2]]; };
  const guess = Object.fromEntries(chain.joints.map(j => [j, [...(rot[j] ?? [0, 0, 0])]]));

  let state = guess, violated = true;
  const g = geometry(name, rig);
  if (g) {
    const world = solve(base, rig);
    const P = world[g.j1.part0];
    const S = point(P, g.j1.c0);
    const guessUp = mulR(P.R, anglesDeg(guess[chain.joints[0]]));
    const guessElbow = rotV(guessUp, g.a);
    const Rend = base[chain.end]?.R ?? [1, 0, 0, 0, 1, 0, 0, 0, 1];
    let off = [0, 0, 0], sol = null;
    // the end part's centre sits a little past the wrist pivot and swings with the forearm: fixed point, 3-4 rounds
    for (let it = 0; it < 4; it++) {
      sol = solveOnce(g, S, P.R, sub(want, off), pole, guessElbow, rig, minBend);
      const Rlow = mulR(sol.Rup, anglesDeg(sol.lower));
      const next = rotV(mulR(Rlow, Rend), g.endOff);
      if (len(sub(next, off)) < 1e-5) { off = next; break; }
      off = next;
    }
    state = { [chain.joints[0]]: sol.upper, [chain.joints[1]]: sol.lower };
    violated = sol.violation > 0.01;
  }
  let e = err(state), en = Math.hypot(...e);

  // Numeric fallback (damped least squares from the analytic / guessed pose): only when a limit got in the way.
  if (!g || (violated && en > 0.005)) {
    const get = (s, [ji, ai]) => s[chain.joints[ji]][ai];
    const set = (s, [ji, ai], v) => { s[chain.joints[ji]][ai] = clampTo(v, lim(chain.joints[ji])[ai]); };
    const copy = s => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, [...v]]));
    let cur = copy(state), ce = err(cur), cen = Math.hypot(...ce), lambda = 30;
    for (let it = 0; it < 80 && cen > 0.005; it++) {
      const p0 = endPos(cur);
      const J = PARAMS.map(pi => {
        const s = copy(cur);
        const v = get(s, pi);
        set(s, pi, v + 0.5);
        if (get(s, pi) === v) set(s, pi, v - 0.5);
        const dh = get(s, pi) - v;
        if (dh === 0) return [0, 0, 0];
        const p1 = endPos(s);
        return [0, 1, 2].map(k => (p1[k] - p0[k]) / dh);
      });
      const A = PARAMS.map((_, a) => PARAMS.map((_, b) => J[a].reduce((s, v, k) => s + v * J[b][k], 0) + (a === b ? lambda * 1e-4 : 0)));
      const gr = PARAMS.map((_, a) => J[a].reduce((s, v, k) => s + v * ce[k], 0));
      const delta = solveLinear(A, gr);
      if (!delta) break;
      const next = copy(cur);
      PARAMS.forEach((pi, i) => set(next, pi, get(next, pi) + Math.max(-25, Math.min(25, delta[i]))));
      const ne = err(next), nen = Math.hypot(...ne);
      if (nen < cen) { cur = next; ce = ne; cen = nen; lambda = Math.max(1, lambda / 2); }
      else lambda *= 4;
      if (lambda > 1e6) break;
    }
    if (cen < en) { state = cur; en = cen; }
  }
  if (chain.foot && flat) state[chain.end] = flatFoot(chain, state, base, rig, yaw);
  return { rotations: state, error: en };
}

// Foot rotation that keeps the sole parallel to the ground. The foot keeps the direction it
// already points in (turned-out feet stay turned out, a pivot keeps turning); only pitch and roll
// are removed. `yaw` (world degrees) overrides the foot's own heading.
export function footYaw(R, fallbackForward) {
  const f = rotV(R, [0, 0, -1]);
  if (Math.hypot(f[0], f[2]) > 0.25) return Math.atan2(-f[0], -f[2]) / D2R;
  const r = rotV(R, [1, 0, 0]); // toe pointing up or down: use the side axis instead
  if (Math.hypot(r[0], r[2]) > 0.25) return Math.atan2(-r[2], r[0]) / D2R;
  return fallbackForward ? Math.atan2(-fallbackForward[0], -fallbackForward[2]) / D2R : 0;
}
export function flatLocal(shinR, yaw, limits) {
  const local = mulR(transpose(shinR), anglesDeg([0, yaw, 0]));
  return eulerDeg(local).map((v, i) => Math.round(clampTo(intoRange(v, limits[i]), limits[i]) * 100) / 100);
}
function flatFoot(chain, state, base, rig, yaw) {
  const world = solve(transformsFrom(state, base), rig);
  const P = world[chain.joints[1]].R;
  const heading = Number.isFinite(yaw) ? yaw : footYaw(world[chain.end].R, rotV(world.LowerTorso.R, [0, 0, -1]));
  return flatLocal(P, heading, rig.limits[chain.end]);
}

// Several rounds of solveChain: the foot box hangs below the ankle and the hand's centre moves with
// the wrist, so the end position is refined with the end part's own rotation until it settles.
// Returns { rotations, error } like solveChain; `base` is not modified.
export function solveTarget(name, target, base, rig = RIG_R15, opts = {}) {
  const chain = IK_CHAINS[name];
  let b = { ...base };
  for (const j of [...chain.joints, chain.end]) b[j] ??= cf();
  const rot = Object.fromEntries(chain.joints.map(j => [j, eulerDeg(b[j].R)]));
  let r = null;
  for (let i = 0; i < 4; i++) {
    r = solveChain(name, target, b, rot, rig, opts);
    Object.assign(rot, r.rotations);
    if (chain.foot && opts.flat !== false) b = { ...b, [chain.end]: cf(b[chain.end].p, anglesDeg(r.rotations[chain.end])) };
    if (i > 0 && r.error < 0.01) break;
    if (!(chain.foot && opts.flat !== false)) break; // hands: one solveChain already iterates the end offset
  }
  return r;
}

function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}
