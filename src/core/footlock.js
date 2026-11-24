// Foot lock: a foot that is planted on the floor must not slide. Joint-angle animation moves the
// whole leg with the body, so a planted foot drifts when the hips shift, lunge or rotate. This
// finds the planted stretches of each foot and adds leg keys (solved with IK) that pin the foot
// to where it landed.
import { lowestY, eulerDeg, anglesDeg, cf, solve, rotV, point, RIG_R15 } from './rig.js';
import { worldAt, transformsAt, keyTimes, sampleTrack } from './sample.js';
import { solveTarget, footYaw, flatLocal } from './ik.js';
import { simplifyRun } from './arcs.js';

const STEP = 1 / 60;
const GRID = 0.05;          // spacing of the leg keys inside a planted stretch
const ON_GROUND = 0.12;     // studs: sole this close to the floor counts as planted
const MIN_PLANT = 0.08;     // seconds: shorter touches are steps, not plants
const MAX_DRIFT = 1.2;      // studs: a foot that travels further than this is a slide on purpose
const TOLERANCE = 0.03;     // studs of drift allowed once locked
const MAX_IK_ERROR = 0.05;  // give up on frames the leg cannot reach
const MAX_SPEED = 2.5;      // studs/s: a ball of foot still moving faster than this is a step or a slide, not a plant
const BLEND = 0.08;         // seconds the IK is faded in / out at the ends of a planted stretch (no pop)
const KNEE_FLOOR = 8;       // degrees: a planted leg never locks fully straight (knee pop)
const BALL = f => [0, -f[1] / 2, -f[2] * 0.3]; // ball of the foot in the foot's frame (toes point to -Z)


function insertKey(track, t, r) {
  const key = { t, r, e: 'linear' };
  const i = track.findIndex(k => Math.abs(k.t - t) < 1e-6);
  if (i >= 0) { track[i] = { ...track[i], r, e: 'linear' }; return; }
  const nxt = track.findIndex(k => k.t > t);
  track.splice(nxt < 0 ? track.length : nxt, 0, key);
}

// Before grounding: feet that are near the floor get a flat sole (parallel to the floor, pointing
// where the hips point). Otherwise the body is grounded on a tilted foot's corner and a flat
// foot can't reach the floor afterwards.
export function flattenFeet(anim, { rig = RIG_R15, skip = () => false } = {}) {
  for (const t of keyTimes(anim, /Torso|Leg|Foot/)) {
    const w = worldAt(anim, t, rig);
    if (skip(t, w)) continue;
    const low = { Left: lowestY(w, ['LeftFoot'], rig), Right: lowestY(w, ['RightFoot'], rig) };
    const min = Math.min(low.Left, low.Right);
    for (const side of ['Left', 'Right']) {
      if (low[side] - min > 0.25) continue; // a lifted foot (kick, step) keeps the model's pose
      const foot = `${side}Foot`;
      // The foot keeps the direction it points in (turnout, a pivot in progress): only pitch and roll go.
      const yaw = footYaw(w[foot].R, rotV(w.LowerTorso.R, [0, 0, -1]));
      const r = flatLocal(w[`${side}LowerLeg`].R, yaw, rig.limits[foot]);
      anim.tracks[foot] ??= [{ t: 0, r: [0, 0, 0], e: 'linear' }, { t: anim.duration, r: [0, 0, 0], e: 'linear' }];
      insertKey(anim.tracks[foot], t, r);
    }
  }
}

// skip(t, world): true where the body is airborne or tilted so feet can't be planted.
//
// A planted stretch pins the BALL of the foot, not its centre: the foot may turn on the ball (a
// pivot) without that counting as sliding. Each stretch fades the IK in and out over BLEND seconds,
// and a planted leg never locks fully straight (KNEE_FLOOR), so nothing pops at the edges.
export function lockFeet(anim, { rig = RIG_R15, skip = () => false } = {}) {
  let windowsLocked = 0;
  for (const side of ['Left', 'Right']) {
    const foot = `${side}Foot`, chain = [`${side}UpperLeg`, `${side}LowerLeg`, foot];
    const ball = BALL(rig.parts[foot]);
    for (const w of plantedWindows(anim, foot, rig, skip)) {
      for (const j of chain) anim.tracks[j] ??= [{ t: 0, r: [0, 0, 0], e: 'linear' }, { t: anim.duration, r: [0, 0, 0], e: 'linear' }];
      const snapshot = chain.map(j => structuredClone(anim.tracks[j]));
      // the heading the foot had before locking: the pin turns with it
      const yaws = [];
      for (let t = w.start; t <= w.end + STEP; t += STEP) yaws.push(footYaw(worldAt(anim, Math.min(t, anim.duration), rig)[foot].R));
      const yawAt = t => yaws[Math.min(yaws.length - 1, Math.max(0, Math.round((t - w.start) / STEP)))];
      const originAt = t => { // foot centre that keeps the ball on its spot at this heading
        const a = yawAt(t) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
        return [w.ball[0] - (c * ball[0] + s * ball[2]), 0, w.ball[1] - (-s * ball[0] + c * ball[2])];
      };
      const blend = Math.min(BLEND, (w.end - w.start) / 3);
      const weight = t => { const x = Math.max(0, Math.min(1, (t - w.start) / blend, (w.end - t) / blend)); return x * x * (3 - 2 * x); };
      // leg keys inside the stretch blend linearly; the IK keys carry the shape
      for (const j of chain) for (const k of anim.tracks[j]) if (k.t >= w.start - 1e-6 && k.t < w.end) k.e = 'linear';
      const solveAt = t => {
        const base = transformsAt(anim, t);
        chain.forEach((j, i) => { base[j] = sampleTrack(snapshot[i], t); }); // solve from the leg the model animated
        const solved = solveFlat(foot, chain, originAt(t), base, rig, { yaw: yawAt(t) });
        if (!solved) return false;
        const wt = weight(t);
        for (const j of chain) {
          const from = eulerDeg(base[j].R);
          insertKey(anim.tracks[j], t, solved[j].map((v, c) => Math.round((from[c] + (v - from[c]) * wt) * 100) / 100));
        }
        return true;
      };
      let ok = true;
      for (let t = w.start; t <= w.end + 1e-6 && ok; t += GRID) {
        const tt = Math.min(w.end, Math.round(t * 1000) / 1000);
        const wt = weight(tt);
        if (wt < 0.001) continue;
        if (wt < 0.999 || needs(anim, foot, originAt(tt), tt, rig)) ok = solveAt(tt);
      }
      // verify between the grid keys (inside the full-weight part); add a key where the foot still drifts
      const lo = w.start + blend, hi = w.end - blend;
      for (let pass = 0; pass < 6 && ok; pass++) {
        let worst = null;
        for (let t = lo; t <= hi; t += STEP) {
          const d = drift(anim, foot, originAt(t), t, rig);
          if (d > TOLERANCE && (!worst || d > worst.d)) worst = { t: Math.round(t * 1000) / 1000, d };
        }
        if (!worst) break;
        ok = solveAt(worst.t);
      }
      if (ok) {
        windowsLocked++;
        // thin the pin keys again where the leg moves in a straight line (keeps files small); the drift check above ran on the full set
        for (const j of chain) {
          const tr = anim.tracks[j];
          const i0 = tr.findIndex(k => k.t >= w.start - 1e-6), i1 = tr.findLastIndex(k => k.t <= w.end + 1e-6);
          if (i0 >= 0 && i1 > i0) {
            const keep = structuredClone(tr);
            simplifyRun(tr, i0, i1, 0.8);
            if (maxDrift(anim, foot, originAt, w, rig) > TOLERANCE * 3.5) tr.splice(0, tr.length, ...keep);
          }
        }
      }
      else chain.forEach((j, i) => { anim.tracks[j] = snapshot[i]; }); // all or nothing per stretch
    }
  }
  return windowsLocked;
}

// The foot is a big box: with the shin tilted it hangs at an angle and its centre sits far above
// the floor. IK is solved with the foot already flattened, a few times, so the sole ends flat on
// the target. Returns the leg rotations, or null when the leg can't reach.
// opts.yaw keeps the foot's heading; the knee is held at least KNEE_FLOOR degrees bent.
export function solveFlat(foot, chain, target, base, rig, { yaw, minBend = KNEE_FLOOR } = {}) {
  const r = solveTarget(foot, target, base, rig, { flat: true, yaw, minBend });
  const rot = r.rotations;
  const placed = { ...base };
  for (const j of chain) placed[j] = cf(base[j]?.p ?? [0, 0, 0], anglesDeg(rot[j]));
  const w = solve(placed, rig);
  const err = Math.max(Math.hypot(w[foot].p[0] - target[0], w[foot].p[2] - target[2]), Math.abs(lowestY(w, [foot], rig)));
  return err <= MAX_IK_ERROR ? rot : null;
}

function maxDrift(anim, foot, originAt, w, rig) {
  let m = 0;
  for (let t = w.start; t <= w.end; t += STEP) m = Math.max(m, drift(anim, foot, originAt(t), t, rig));
  return m;
}
function drift(anim, foot, target, t, rig) {
  const w = worldAt(anim, t, rig);
  return Math.max(Math.hypot(w[foot].p[0] - target[0], w[foot].p[2] - target[2]), Math.abs(lowestY(w, [foot], rig)));
}
const kneeStraight = (anim, foot, t) => {
  const tr = anim.tracks[foot.replace('Foot', 'LowerLeg')];
  return !!tr && eulerDeg(sampleTrack(tr, t).R)[0] > -(KNEE_FLOOR - 0.5);
};
const needs = (anim, foot, target, t, rig) => drift(anim, foot, target, t, rig) > TOLERANCE || kneeStraight(anim, foot, t);

function plantedWindows(anim, foot, rig, skip) {
  const out = [];
  const ball = BALL(rig.parts[foot]);
  let cur = null, last = null;
  const close = () => {
    if (cur && cur.end - cur.start >= MIN_PLANT && cur.maxDrift <= MAX_DRIFT) out.push({ start: cur.start, end: cur.end, ball: cur.pos });
    cur = null;
  };
  for (let t = 0; t <= anim.duration + 1e-9; t += STEP) {
    const tt = Math.min(t, anim.duration);
    const w = worldAt(anim, tt, rig);
    // the ball of the foot decides: turning on it (a pivot) is not drift, walking off it is
    const b = point(w[foot], ball);
    const speed = last ? Math.hypot(b[0] - last[0], b[2] - last[2]) / STEP : 0;
    last = b;
    const planted = !skip(tt, w) && lowestY(w, [foot], rig) < ON_GROUND && (cur || speed < MAX_SPEED);
    if (!planted || (cur && speed > MAX_SPEED * 2)) { close(); continue; }
    if (!cur) cur = { start: tt, end: tt, pos: [b[0], b[2]], maxDrift: 0 };
    cur.end = tt;
    cur.maxDrift = Math.max(cur.maxDrift, Math.hypot(b[0] - cur.pos[0], b[2] - cur.pos[1]));
  }
  close();
  return out;
}
