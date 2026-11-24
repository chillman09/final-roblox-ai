// Arc-aware resampling and procedural overshoot.
//
// Roblox blends two keys along a straight chord (CubicV2 lerps rotation vectors), so a sparse
// 5-9 key clip moves limbs in straight lines instead of martial-arts arcs. For the dynamic segments
// of a clip (swings over WIDE degrees, or segments next to a "strike" / "followthrough" /
// "impact" key) we run a Catmull-Rom spline (non-uniform in time, stopped dead at impact keys)
// through the neighbouring keys and bake it into linear keys on a shared 30 fps grid (60 fps
// where the swing is fast), then thin the keys again with a tolerance, so holds stay sparse and the
// file does not grow. Easing is baked in: the spline is evaluated at the eased parameter, so the
// timing the model asked for is kept.
import { anglesDeg, eulerDeg, quatFromR, rFromQuat, quatLog, quatFromRotVec, alignQuat, RIG_R15 } from './rig.js';
import { sampleTrack, EASE } from './sample.js';
import { r3, fitAngle } from './tracks.js';

export const WIDE = 50;            // degrees: a swing wider than this gets an arc
const GRID = 1 / 30;
const FAST = 35;                   // degrees between neighbouring samples that triggers a 60 fps midpoint
const MIN_SEG = 0.06;              // seconds: shorter segments are already dense
const MIN_ARC = 1.5;               // degrees: a swing whose arc bulges less than this stays as the model wrote it
export const TOLERANCE = 1.0;      // degrees: samples this close to the line through their neighbours are dropped
const D = 180 / Math.PI;

// General acting phases are aliases: action = strike, peak = impact, settle = followthrough.
export const isPeak = p => p === 'impact' || p === 'peak';
export const isDynPhase = p => p === 'strike' || p === 'action' || p === 'followthrough' || p === 'settle' || isPeak(p);

const canon = q => (q[3] < 0 ? q.map(v => -v) : q);
const quatOf = r => canon(quatFromR(anglesDeg(r)));
const vlen = v => Math.hypot(v[0], v[1], v[2]);
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const qangle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]))) * D;

// Euler angles of a rotation (matrix, or rotation vector), expressed inside the joint's limits.
const fitR = (R, lim) => eulerDeg(R).map((x, i) => Math.round(fitAngle(x, lim[i]) * 100) / 100);
const eulerIn = (v, lim) => fitR(rFromQuat(quatFromRotVec(v)), lim);

// Rotation vectors of a key run, each continuous with the one before (shortest way round).
function rotvecs(keys) {
  let q = null;
  return keys.map(k => { const c = quatOf(k.r); q = q ? alignQuat(q, c) : c; return quatLog(q); });
}

// Thin a run of linear keys (indices i0..i1 of `tr`, the ends are kept) with Ramer-Douglas-Peucker in rotation-vector space.
export function simplifyRun(tr, i0, i1, tol = TOLERANCE) {
  if (i1 - i0 < 2) return;
  const v = rotvecs(tr.slice(i0, i1 + 1));
  const keep = new Set([0, i1 - i0]);
  const stack = [[0, i1 - i0]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = -1, dev = tol;
    for (let k = a + 1; k < b; k++) {
      const f = (tr[i0 + k].t - tr[i0 + a].t) / (tr[i0 + b].t - tr[i0 + a].t);
      const d = vlen([0, 1, 2].map(c => v[k][c] - (v[a][c] + (v[b][c] - v[a][c]) * f))) * D;
      if (d > dev) { dev = d; worst = k; }
    }
    if (worst >= 0) { keep.add(worst); stack.push([a, worst], [worst, b]); }
  }
  const drop = [];
  for (let k = 1; k < i1 - i0; k++) if (!keep.has(k)) drop.push(i0 + k);
  for (const i of drop.reverse()) tr.splice(i, 1);
}

// Cubic Hermite through (p0, p1) with tangents m0, m1 (already scaled to the segment).
const hermite = (p0, p1, m0, m1, u) => {
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  return p0.map((v, i) => h00 * v + h10 * m0[i] + h01 * p1[i] + h11 * m1[i]);
};
export { hermite };

// Catmull-Rom tangent at a key for a segment of length dt: velocity = (next - prev)/(t_next - t_prev), scaled to the segment.
export const tangent = (pPrev, tPrev, pNext, tNext, dt, stop) =>
  stop || !pPrev || !pNext ? null : pPrev.map((v, i) => ((pNext[i] - v) / (tNext - tPrev)) * dt);

// Resample the dynamic segments of every non-root joint. skip(joint, t0, t1) lets another pass (target-space IK)
// own a segment. Returns the number of keys added.
export function resampleArcs(anim, { rig = RIG_R15, skip = () => false, tolerance = TOLERANCE } = {}) {
  let added = 0;
  for (const [j, tr] of Object.entries(anim.tracks)) {
    if (j === rig.body || j === 'LowerTorso' || tr.length < 2 || !rig.limits[j]) continue;
    const lim = rig.limits[j];
    const out = [tr[0]];
    for (let i = 0; i < tr.length - 1; i++) {
      const a = tr[i], b = tr[i + 1], dt = b.t - a.t;
      const seg = [];
      const qa = quatOf(a.r), qb = alignQuat(qa, quatOf(b.r));
      const ang = qangle(qa, qb);
      const dyn = ang > WIDE || isDynPhase(a.ph) || isDynPhase(b.ph);
      if (ang >= 2 && dyn && dt >= MIN_SEG && !skip(j, a.t, b.t)) {
        const va = quatLog(qa), vb = quatLog(qb);
        const vPrev = i > 0 ? quatLog(alignQuat(qa, quatOf(tr[i - 1].r))) : null;
        const vNext = i + 2 < tr.length ? quatLog(alignQuat(qb, quatOf(tr[i + 2].r))) : null;
        // zero tangent at an impact key: the strike stops dead on its target
        const m0 = tangent(vPrev, i > 0 ? tr[i - 1].t : 0, vb, b.t, dt, isPeak(a.ph)) ?? (isPeak(a.ph) ? [0, 0, 0] : vsub(vb, va));
        const m1 = tangent(va, a.t, vNext, i + 2 < tr.length ? tr[i + 2].t : 0, dt, isPeak(b.ph)) ?? (isPeak(b.ph) ? [0, 0, 0] : vsub(vb, va));
        const ease = EASE[a.e] ?? EASE.inout;
        const chord = vsub(vb, va), cl = vlen(chord);
        const dir = cl > 1e-9 ? chord.map(x => x / cl) : [0, 0, 0];
        // Only the arc BULGE is taken from the spline: the part of (spline - straight blend) that is perpendicular to the
        // chord. The position along the chord stays the model's own eased blend, so its timing and easing are untouched.
        const bulge = t => {
          const u = ease((t - a.t) / dt);
          const h = hermite(va, vb, m0, m1, u);
          const off = h.map((x, c) => x - (va[c] + chord[c] * u));
          const along = off[0] * dir[0] + off[1] * dir[1] + off[2] * dir[2];
          const perp = off.map((x, c) => x - along * dir[c]);
          return { v: va.map((x, c) => x + chord[c] * u + perp[c]), dev: vlen(perp) * D };
        };
        const at = t => {
          const { v } = bulge(t);
          let r = eulerIn(v, lim);
          // the pose must stay believable: fall back to the model's own blend if limits would bend it
          if (qangle(canon(quatFromRotVec(v)), canon(quatFromR(anglesDeg(r)))) > 6) r = fitR(sampleTrack(tr, t).R, lim);
          return { t: r3(t), r, e: 'linear', ph: null, q: canon(quatFromR(anglesDeg(r))) };
        };
        const times = [];
        for (let g = Math.floor((a.t + 0.012) / GRID + 1e-9) + 1; g * GRID < b.t - 0.012; g++) times.push(g * GRID);
        // a swing that stays on its straight path needs no extra keys: Roblox already blends it with the right easing
        if (times.length && Math.max(...times.map(t => bulge(t).dev)) >= MIN_ARC) {
          let pts = times.map(at);
          // fast swings get 60 fps midpoints
          const edge = [{ t: a.t, q: qa }, ...pts, { t: b.t, q: qb }];
          const mids = [];
          for (let k = 0; k < edge.length - 1; k++) if (qangle(edge[k].q, edge[k + 1].q) > FAST && edge[k + 1].t - edge[k].t > 0.02) mids.push(at((edge[k].t + edge[k + 1].t) / 2));
          pts = [...pts, ...mids].sort((x, y) => x.t - y.t);
          for (const p of pts) { delete p.q; seg.push(p); }
        }
      }
      if (seg.length) {
        a.e = 'linear';
        const start = out.length - 1;
        out.push(...seg, b);
        simplifyRun(out, start, out.length - 1, tolerance);
        added += out.length - 1 - start - 1;
      } else out.push(b);
    }
    tr.splice(0, tr.length, ...out);
  }
  return added;
}

// Overshoot and settle: after an "impact" key a limb that was moving fast carries on 2-4 degrees past the pose,
// then settles into the next key. The impact key itself is untouched, so a strike still lands exactly on its target.
export function addOvershoot(anim, { rig = RIG_R15 } = {}) {
  let n = 0;
  for (const [j, tr] of Object.entries(anim.tracks)) {
    if (j === rig.body || j === 'LowerTorso' || !rig.limits[j]) continue;
    for (let i = 1; i < tr.length - 1; i++) {
      const k = tr[i], next = tr[i + 1];
      if (!isPeak(k.ph) || next.t - k.t < 0.05) continue;
      const qp = quatOf(tr[i - 1].r), qk = alignQuat(qp, quatOf(k.r));
      const vp = quatLog(qp), vk = quatLog(qk);
      const move = vsub(vk, vp), moved = vlen(move) * D;
      if (moved < 12) continue;
      const mag = Math.min(4, Math.max(2, moved * 0.05)) / D;
      const vo = [0, 1, 2].map(c => vk[c] + (move[c] / vlen(move)) * mag);
      const r = eulerIn(vo, rig.limits[j]);
      if (r.every((v, c) => Math.abs(v - k.r[c]) < 0.3)) continue; // a limit stops the overshoot
      tr.splice(i + 1, 0, { t: r3(k.t + Math.min(0.04, 0.4 * (next.t - k.t))), r, e: k.e, ph: null });
      k.e = 'out';
      i++; n++;
    }
  }
  return n;
}
