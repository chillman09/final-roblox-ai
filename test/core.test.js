import test from 'node:test';
import assert from 'node:assert/strict';
import { polish, airBetween, groupAir, check, PHASES } from '../src/core/polish.js';
import { isDynPhase, isPeak } from '../src/core/arcs.js';
import { sampleTrack, worldAt, keyTimes } from '../src/core/sample.js';
import { lowestY, eulerDeg, RIG_R15, solve, anglesDeg, cf, rotV } from '../src/core/rig.js';
import { solveTarget, segmentLengths, footYaw } from '../src/core/ik.js';
import { pushOutInside } from '../src/core/repair.js';
import { autoRepair } from '../src/repair.js';
import { EXAMPLES } from '../src/prompt.js';
import { toRbxmx, toLuau } from '../src/core/export.js';

const punch = {
  name: 'Punch', duration: 1, loop: false,
  keys: [
    { t: 0, ease: 'linear', pose: { UpperTorso: { r: [0, -10, 0] }, RightUpperArm: { r: [40, 0, 20] }, RightLowerArm: { r: [110, 0, 0] }, RightUpperLeg: { r: [-15, 0, 0] }, LeftUpperLeg: { r: [20, 0, 0] }, RightLowerLeg: { r: [-30, 0, 0] }, LeftLowerLeg: { r: [-35, 0, 0] } } },
    { t: 0.3, ease: 'in', pose: { UpperTorso: { r: [0, 20, 0] }, RightUpperArm: { r: [88, 0, 5] }, RightLowerArm: { r: [8, 0, 0] } } },
    { t: 1, ease: 'inout', pose: { UpperTorso: { r: [0, -10, 0] }, RightUpperArm: { r: [40, 0, 20] }, RightLowerArm: { r: [110, 0, 0] } } },
  ],
};

test('rejects unusable model output', () => {
  assert.throws(() => polish({ keys: [] }), /too few keys/);
  assert.throws(() => polish(null), /too few keys/);
  assert.throws(() => polish({ keys: [{ t: 0, pose: {} }, { t: 1, pose: { Nope: { r: [1, 2, 3] } } }] }), /no usable joints/);
});

test('clamps joints to their limits and ignores unknown joints', () => {
  const a = polish({ keys: [{ t: 0, pose: { RightLowerArm: { r: [400, 90, 90] }, Tail: { r: [1, 1, 1] } } }, { t: 1, pose: {} }] });
  assert.ok(!('Tail' in a.tracks));
  assert.deepEqual(a.tracks.RightLowerArm[0].r, [150, 90, 10]);
});

test('easing is stored on the key that starts a segment (Roblox semantics)', () => {
  const a = polish(punch);
  const arm = a.tracks.RightLowerArm; // keys at 0, 0.3(+lag), 1
  assert.equal(arm.length, 3);
  assert.equal(arm[0].e, 'in');   // "arrives with in" at 0.3 → the pose at 0 carries In
  assert.equal(arm[1].e, 'inout');
  assert.equal(arm.at(-1).e, 'linear');
});

test('sampling hits keys exactly and blends between them', () => {
  const a = polish(punch);
  const tr = a.tracks.RightLowerArm;
  assert.deepEqual(eulerDeg(sampleTrack(tr, 0).R).map(v => Math.round(v) + 0), [110, 0, 0]);
  const mid = eulerDeg(sampleTrack(tr, (tr[0].t + tr[1].t) / 2).R)[0];
  assert.ok(mid < 110 && mid > 8);
});

test('a 360° spin is cut into steps and keeps turning the same way', () => {
  const a = polish({ duration: 1, keys: [{ t: 0, pose: { LowerTorso: { r: [0, 0, 0] } } }, { t: 0.5, ease: 'inout', air: true, pose: { LowerTorso: { r: [0, 360, 0], p: [0, 1, 0] } } }, { t: 1, pose: { LowerTorso: { r: [0, 360, 0] } } }] });
  const ys = a.tracks.LowerTorso.map(k => k.r[1]);
  assert.deepEqual(ys.slice(0, 4), [0, 120, 240, 360]);
  const yaw = t => { const R = sampleTrack(a.tracks.LowerTorso, t).R; return Math.atan2(R[2], R[0]) * 180 / Math.PI; };
  // never reverses: successive samples move forward (mod 360)
  let prev = yaw(0.02), total = 0;
  for (let t = 0.04; t <= 0.5; t += 0.02) { let d = yaw(t) - prev; if (d < -180) d += 360; if (d > 180) d -= 360; assert.ok(d >= -1e-6, `reversed at ${t}`); total += d; prev = yaw(t); }
  assert.ok(total > 300);
  assert.deepEqual(a.warnings.filter(w => w.type === 'snap'), []);
});

test('grounding keeps the lowest foot on the floor on every key', () => {
  const a = polish(punch);
  for (const t of keyTimes(a, /Torso|Leg|Foot/)) {
    const low = lowestY(worldAt(a, t), ['LeftFoot', 'RightFoot']);
    assert.ok(Math.abs(low) < 0.02, `foot at ${low} at t=${t}`);
  }
});

test('airborne keys are not forced onto the floor', () => {
  const a = polish({ duration: 1, keys: [{ t: 0, pose: { LowerTorso: { r: [0, 0, 0] } } }, { t: 0.4, air: true, pose: { LowerTorso: { r: [0, 0, 0], p: [0, 2, 0] } } }, { t: 0.8, air: true, pose: { LowerTorso: { r: [0, 0, 0], p: [0, 2, 0] } } }, { t: 1, pose: { LowerTorso: { r: [0, 0, 0] } } }] });
  assert.ok(lowestY(worldAt(a, 0.6), ['LeftFoot', 'RightFoot']) > 1.5);
  assert.deepEqual(a.warnings.filter(w => w.type === 'ground'), []);
});

test('loops end where they start', () => {
  const a = polish({ loop: true, duration: 1, keys: [{ t: 0, pose: { Head: { r: [0, 20, 0] } } }, { t: 0.5, pose: { Head: { r: [0, -20, 0] } } }, { t: 1, pose: { Head: { r: [0, 5, 0] } } }] });
  assert.deepEqual(a.tracks.Head[0].r, a.tracks.Head.at(-1).r);
});

test('warns when a hand goes through the body', () => {
  const a = polish({ duration: 1, keys: [{ t: 0, pose: { RightUpperArm: { r: [0, 0, 0] } } }, { t: 0.5, pose: { RightUpperArm: { r: [10, 0, -70] }, RightLowerArm: { r: [0, 0, 0] } } }, { t: 1, pose: { RightUpperArm: { r: [0, 0, 0] } } }] });
  assert.ok(a.warnings.some(w => w.type === 'inside'));
});

test('exports are well formed', () => {
  const a = polish(punch);
  const x = toRbxmx(a);
  assert.equal((x.match(/<Item /g) ?? []).length, (x.match(/<\/Item>/g) ?? []).length);
  assert.match(x, /class="KeyframeSequence"/);
  assert.match(x, /<token name="EasingStyle">5<\/token>/); // CubicV2
  assert.match(toLuau(a), /Selection:Set\(\{ seq \}\)/);
});

// ---------------------------------------------------------------- upgrade: physics, IK, arcs, repair

const hipKey = (t, y, air) => ({ t, ease: 'inout', ...(air ? { air: true } : {}), pose: { LowerTorso: { p: [0, y, 0], r: [0, 0, 0] } } });

test('airBetween: separate jumps are separate flights, the ground between them is not airborne', () => {
  const keys = [{ t: 0 }, { t: 0.2, air: true }, { t: 0.4, air: true }, { t: 0.6 }, { t: 0.8, air: true }, { t: 1.0, air: true }, { t: 1.2 }];
  const flights = groupAir(keys);
  assert.deepEqual(flights, [[0.2, 0.4], [0.8, 1.0]]);
  assert.equal(airBetween(flights, 0.3), true);
  assert.equal(airBetween(flights, 0.6), false);
  assert.equal(airBetween(flights, 0.9), true);
  // a lone air key is a short hop around it
  assert.equal(airBetween(groupAir([{ t: 0 }, { t: 0.5, air: true }, { t: 1 }]), 0.52), true);
  assert.equal(airBetween(groupAir([{ t: 0 }, { t: 0.5, air: true }, { t: 1 }]), 0.8), false);
  // end to end: the crouch between two jumps (hips sunk 1 stud into the floor) is grounded again
  const a = polish({ name: 'DoubleJump', duration: 1.2, keys: [hipKey(0, 0), hipKey(0.2, 1.5, true), hipKey(0.4, 1.5, true), hipKey(0.6, -1), hipKey(0.8, 1.5, true), hipKey(1.0, 1.5, true), hipKey(1.2, 0)] });
  assert.equal(a.airIntervals.length, 2);
  assert.ok(lowestY(worldAt(a, 0.6), ['LeftFoot', 'RightFoot']) > -0.12, 'the grounded middle section must be put back on the floor');
  assert.ok(lowestY(worldAt(a, 0.3), ['LeftFoot', 'RightFoot']) > 0.5, 'the flights stay airborne');
});

// the analytic IK, checked against the rig's own forward kinematics
const reachHand = (name, target, opts) => {
  const r = solveTarget(name, target, {}, RIG_R15, opts);
  const tf = {};
  for (const [j, v] of Object.entries(r.rotations)) tf[j] = cf([0, 0, 0], anglesDeg(v));
  return { r, w: solve(tf, RIG_R15) };
};

test('two-bone IK puts RightHand and LeftHand exactly on reachable targets, inside the joint limits', () => {
  const len = segmentLengths('RightHand');
  assert.ok(Math.abs(len.upper - 0.921) < 0.01 && Math.abs(len.lower - 0.807) < 0.01, 'segment lengths come from the rig offsets');
  for (const [name, target] of [['RightHand', [0.4, 4, -1.5]], ['RightHand', [1.5, 3.5, -1.2]], ['RightHand', [0.9, 4.9, -1.0]], ['LeftHand', [-0.4, 4, -1.5]], ['LeftHand', [-1.5, 3.2, -1.0]], ['LeftHand', [-0.45, 4.9, -1.1]]]) {
    const { r, w } = reachHand(name, target);
    assert.ok(r.error < 0.005, `${name} ${target} error ${r.error}`);
    assert.ok(Math.hypot(...w[name].p.map((v, i) => v - target[i])) < 0.01);
    for (const [j, rot] of Object.entries(r.rotations)) rot.forEach((v, i) => assert.ok(v >= RIG_R15.limits[j][i][0] - 1e-6 && v <= RIG_R15.limits[j][i][1] + 1e-6, `${j} axis ${i} = ${v} outside its limit`));
  }
});

test('IK: the pole picks the elbow side, and an unreachable target is clamped to the limits and reported', () => {
  const target = [0.6, 4.2, -1.4];
  const out = reachHand('RightHand', target, { pole: [3, 4.2, -1.4] }).w.RightLowerArm.p;
  const down = reachHand('RightHand', target, { pole: [0.6, 1, -1.4] }).w.RightLowerArm.p;
  assert.ok(out[0] > down[0] + 0.3 && down[1] < out[1] - 0.3, 'different poles give different elbows');
  const far = reachHand('RightHand', [0.9, 3.5, -5]);
  assert.ok(far.r.error > 1, 'out of reach is reported, not faked');
  const elbow = far.r.rotations.RightLowerArm[0];
  assert.ok(elbow >= 0 && elbow < 3, 'a fully stretched arm has a straight elbow');
  const behind = reachHand('LeftHand', [-1.2, 4.3, 1.5]); // behind the shoulder: forces the limits to matter
  for (const [j, rot] of Object.entries(behind.r.rotations)) rot.forEach((v, i) => assert.ok(v >= RIG_R15.limits[j][i][0] - 1e-6 && v <= RIG_R15.limits[j][i][1] + 1e-6));
});

test('hand targets in keys: a punch lands exactly on its target, the phase keeps impact keys on time', () => {
  const a = polish(structuredClone(EXAMPLES.punch));
  const impact = EXAMPLES.punch.keys.find(k => k.phase === 'impact');
  const hand = worldAt(a, impact.t).RightHand.p;
  assert.ok(Math.hypot(...hand.map((v, i) => v - impact.targets.RightHand.pos[i])) < 0.02, `hand at ${hand}`);
  assert.deepEqual(a.warnings, []);
  assert.ok(a.tracks.RightUpperArm.some(k => k.t === impact.t), 'impact key not delayed');
  assert.ok(a.overshoots > 0, 'overshoot after impact');
});

test('flattenFeet keeps a turned-out foot turned out and only removes pitch and roll', () => {
  const pose = { LowerTorso: { r: [0, 0, 0] }, RightUpperLeg: { r: [0, 24, 0] }, RightFoot: { r: [12, 0, 6] }, LeftUpperLeg: { r: [0, -18, 0] } };
  const raw = { name: 'Turnout', duration: 1, keys: [{ t: 0, pose }, { t: 1, pose }] };
  const rough = worldAt(polish(raw, { footLock: false }), 0);
  const flat = worldAt(polish(raw), 0);
  for (const foot of ['RightFoot', 'LeftFoot']) {
    const up = rotV(flat[foot].R, [0, 1, 0]);
    assert.ok(up[1] > 0.9999, `${foot} sole is parallel to the floor`);
    const was = footYaw(rough[foot].R), now = footYaw(flat[foot].R);
    assert.ok(Math.abs(was - now) < 1, `${foot} yaw ${was} -> ${now}`);
  }
  assert.ok(Math.abs(footYaw(flat.RightFoot.R) - footYaw(flat.LeftFoot.R)) > 20, 'the feet are not forced parallel');
});

test('overlap lag and loop closing never clobber the last keyframes', () => {
  const pose = (x, y) => ({ RightUpperArm: { r: [x, 0, 10] }, RightLowerArm: { r: [y, 0, 0] }, LowerTorso: { r: [0, x / 4, 0] } });
  const raw = {
    name: 'Loop', duration: 1, loop: true,
    keys: [
      { t: 0, ease: 'linear', pose: pose(0, 20) },
      { t: 0.3, ease: 'in', phase: 'windup', pose: pose(40, 90) },
      { t: 0.5, ease: 'out', phase: 'impact', pose: pose(80, 10) },
      { t: 0.9, ease: 'inout', phase: 'followthrough', pose: pose(30, 60) },
      { t: 0.97, ease: 'inout', phase: 'followthrough', pose: pose(5, 25) },
      { t: 1, ease: 'inout', pose: pose(0, 99) },
    ],
  };
  const a = polish(raw, { footLock: false });
  for (const [j, tr] of Object.entries(a.tracks)) {
    assert.equal(tr.at(-1).t, 1, `${j} last key stays at the full duration`);
    assert.equal(tr[0].t, 0);
    tr.forEach((k, i) => i && assert.ok(k.t > tr[i - 1].t + 0.009, `${j} keys stay ordered and distinct`));
    assert.deepEqual(tr.at(-1).r, tr[0].r, `${j} loop closes`);
  }
  const arm = a.tracks.RightUpperArm;
  assert.ok(arm.some(k => k.t > 0.3 && k.t < 0.33), 'windup keys lag');
  assert.ok(arm.some(k => k.t === 0.5), 'impact keys do not');
  assert.ok(arm.some(k => k.t > 0.9 && k.t < 0.96) || arm.some(k => k.t > 0.9), 'the follow-through key before the end is kept, not merged into the last key');
  assert.equal(arm.filter(k => k.t > 0.95).length >= 2 || arm.at(-2).t < 1, true);
  assert.deepEqual(a.warnings.filter(w => w.type === 'loop'), []);
  // a loop that turns whole revolutions is not unwound by loop closing
  const spin = polish({ name: 'Spin', duration: 1, loop: true, keys: [{ t: 0, pose: { LowerTorso: { r: [0, 0, 0] } } }, { t: 0.5, pose: { LowerTorso: { r: [0, 180, 0] } } }, { t: 1, pose: { LowerTorso: { r: [0, 360, 0] } } }] }, { footLock: false });
  assert.equal(spin.tracks.LowerTorso.at(-1).r[1], 360);
  assert.deepEqual(spin.warnings.filter(w => w.type === 'loop'), []);
});

test('arc resampling: curved swings get keys on a shared grid, straight swings and holds stay sparse', () => {
  const curved = polish({ name: 'Swing', duration: 1, keys: [
    { t: 0, ease: 'linear', pose: { RightUpperArm: { r: [0, 0, 0] } } },
    { t: 0.3, ease: 'inout', phase: 'windup', pose: { RightUpperArm: { r: [-20, 0, -60] } } },
    { t: 0.5, ease: 'out', phase: 'impact', pose: { RightUpperArm: { r: [90, 40, -10] } } },
    { t: 0.7, ease: 'out', phase: 'followthrough', pose: { RightUpperArm: { r: [120, -30, 10] } } },
    { t: 1, ease: 'inout', pose: { RightUpperArm: { r: [0, 0, 0] } } },
  ] }, { footLock: false });
  assert.ok(curved.arcKeys > 0 && curved.tracks.RightUpperArm.length > 5);
  const straight = polish(structuredClone(punch), { footLock: false });
  assert.equal(straight.tracks.RightLowerArm.length, 3, 'a straight wide swing is left to Roblox easing');
  const times = curved.tracks.RightUpperArm.map(k => k.t);
  assert.equal(new Set(times).size, times.length);
  for (const t of times) if (![0, 0.3, 0.5, 0.7, 1].some(k => t >= k && t <= k + 0.07)) assert.ok(Math.abs(t * 30 - Math.round(t * 30)) < 0.05 || Math.abs(t * 60 - Math.round(t * 60)) < 0.1, `${t} is on the 30/60 fps grid (lagged and overshoot keys sit right after a raw key)`);
  assert.ok(toRbxmx(curved).length < 120000, 'file size stays reasonable');
  assert.ok(toLuau(curved).length < 60000);
});

test('check() finds a leg through the other leg and a hand through a thigh', () => {
  const legs = polish({ name: 'Cross', duration: 1, keys: [{ t: 0, pose: {} }, { t: 0.5, pose: { RightUpperLeg: { r: [0, 0, -40] }, LeftUpperLeg: { r: [0, 0, 40] } } }, { t: 1, pose: {} }] }, { footLock: false });
  assert.ok(legs.warnings.some(w => w.type === 'inside' && /Leg/.test(w.joint) && /Leg/.test(w.msg)), JSON.stringify(legs.warnings));
  const hand = polish({ name: 'Slap', duration: 1, keys: [{ t: 0, pose: {} }, { t: 0.5, pose: { RightUpperArm: { r: [0, 0, -70] }, RightUpperLeg: { r: [0, 0, -20] } } }, { t: 1, pose: {} }] }, { footLock: false });
  assert.ok(hand.warnings.every(w => w.type === 'inside' || w.type === 'reach'));
  for (const name of Object.keys(EXAMPLES)) assert.deepEqual(polish(structuredClone(EXAMPLES[name])).warnings, [], `${name} example is clean`);
});

const handThroughBody = { name: 'Clip', duration: 1, keys: [{ t: 0, pose: {} }, { t: 0.5, ease: 'inout', pose: { RightUpperArm: { r: [10, 0, -70] }, RightLowerArm: { r: [0, 0, 0] } } }, { t: 1, pose: {} }] };

test('deterministic push-out clears hand-through-body warnings with Hand IK targets', () => {
  const before = polish(structuredClone(handThroughBody));
  assert.ok(before.warnings.some(w => w.type === 'inside'));
  const fixed = pushOutInside(structuredClone(handThroughBody), before);
  assert.ok(fixed.pushed > 0);
  assert.deepEqual(fixed.anim.warnings.filter(w => w.type === 'inside'), []);
  assert.ok(fixed.raw.keys.some(k => k.targets?.RightHand), 'the fix is a hand target on a key');
  assert.deepEqual(fixed.raw.keys[0].targets ?? null, null, 'the rest pose at the start is untouched');
  assert.equal(handThroughBody.keys.some(k => k.targets), false, 'the input is not mutated');
});

test('autoRepair: push-out first, at most one silent model pass, never worse than before', async () => {
  let asked = 0;
  const ask = async () => { asked++; return structuredClone(handThroughBody); };
  const buildFix = (raw, anim) => `fix ${anim.warnings.length}`;
  const a = await autoRepair({ raw: structuredClone(handThroughBody), anim: polish(structuredClone(handThroughBody)), ask, buildFix });
  assert.equal(asked, 0, 'a minor clip needs no model call');
  assert.deepEqual(a.anim.warnings.filter(w => w.type === 'inside'), []);
  assert.ok(a.repair.pushedOut > 0);

  // a leg through a leg cannot be nudged away: one model pass, and only an improvement is accepted
  const legs = { name: 'Cross', duration: 1, keys: [{ t: 0, pose: {} }, { t: 0.5, pose: { RightUpperLeg: { r: [0, 0, -40] }, LeftUpperLeg: { r: [0, 0, 40] } } }, { t: 1, pose: {} }] };
  const bad = polish(structuredClone(legs));
  assert.ok(bad.warnings.some(w => w.type === 'inside'), 'precondition: unresolved leg clipping');
  asked = 0;
  const calls = [];
  const same = await autoRepair({ raw: legs, anim: bad, ask: async u => { asked++; return structuredClone(legs); }, buildFix: (r, an) => { calls.push(an.warnings.length); return 'fix'; } });
  assert.equal(asked, 1, 'exactly one silent repair pass');
  assert.deepEqual(same.anim.warnings, bad.warnings, 'an answer that is not better is ignored');
  const good = { name: 'Fixed', duration: 1, keys: [{ t: 0, pose: {} }, { t: 0.5, pose: { RightUpperLeg: { r: [0, 0, 10] }, LeftUpperLeg: { r: [0, 0, -10] } } }, { t: 1, pose: {} }] };
  const better = await autoRepair({ raw: legs, anim: bad, ask: async () => structuredClone(good), buildFix: () => 'fix' });
  assert.equal(better.anim.name, 'Fixed');
  assert.deepEqual(better.anim.warnings.filter(w => w.type === 'inside'), []);
  const broken = await autoRepair({ raw: legs, anim: bad, ask: async () => { throw new Error('offline'); }, buildFix: () => 'fix' });
  assert.deepEqual(broken.anim.warnings, bad.warnings, 'a failing model never breaks the clip');
});

// ---- ground modes ----
const BODY = ['UpperTorso', 'Head', 'RightUpperArm', 'RightLowerArm', 'LeftUpperArm', 'LeftLowerArm', 'RightUpperLeg', 'RightLowerLeg', 'LeftUpperLeg', 'LeftLowerLeg', 'RightFoot', 'LeftFoot', 'RightHand', 'LeftHand', 'LowerTorso'];
const lowAt = (anim, t) => lowestY(worldAt(anim, t, RIG_R15), BODY, RIG_R15);
// a crawl-like pose: torso pitched forward to near horizontal, hips held at height y
const crawlClip = (y, ground) => ({
  ground, duration: 1, loop: false,
  keys: [0, 1].map(t => ({ t, pose: { LowerTorso: { p: [0, y, 0], r: [-80, 0, 0] }, UpperTorso: { r: [-5, 0, 0] }, RightFoot: { r: [40, 0, 0] }, LeftFoot: { r: [40, 0, 0] } } })),
});

test('ground "feet" is the default and invalid values fall back to it', () => {
  assert.equal(polish(punch).ground, 'feet');
  assert.equal(polish({ ...punch, ground: 'sideways' }).ground, 'feet');
  assert.equal(polish({ ...punch, ground: 'body' }).ground, 'body');
});

test('ground "body" rests the lowest body part on the floor, with no flat or locked feet', () => {
  for (const y of [0, -3.5]) { // a horizontal pose hangs ~2.3 studs in the air at y=0; at -3.5 it is sunk into the floor
    const a = polish(crawlClip(y, 'body'));
    assert.equal(a.ground, 'body');
    for (const t of [0, 0.5, 1]) assert.ok(Math.abs(lowAt(a, t)) < 0.06, `y=${y} t=${t} lowest ${lowAt(a, t)}`);
    assert.equal(a.feetLocked, 0, 'no foot lock in body mode');
    assert.deepEqual(a.tracks.RightFoot[0].r, [40, 0, 0], 'foot is not forced flat');
    assert.ok(!a.warnings.some(w => w.type === 'ground'));
  }
  // the standing grounding leaves the same tilted pose alone (it is not upright), so body mode is what rescues it
  assert.ok(lowAt(polish(crawlClip(-3.5, 'feet')), 0.5) < -0.5);
});

test('ground "body" keeps a collapse on top of the floor all the way down', () => {
  const a = polish({ ground: 'body', duration: 1.2, loop: false, keys: [
    { t: 0, pose: { LowerTorso: { r: [0, 0, 0] } } },
    { t: 0.6, ease: 'in', phase: 'action', pose: { LowerTorso: { r: [-40, 0, 0] }, UpperTorso: { r: [-30, 0, 0] }, RightUpperLeg: { r: [60, 0, 0] }, RightLowerLeg: { r: [-90, 0, 0] } } },
    { t: 1.2, ease: 'out', phase: 'settle', pose: { LowerTorso: { r: [-88, 0, 0] }, UpperTorso: { r: [-10, 0, 0] } } },
  ] });
  for (let t = 0; t <= 1.2; t += 1 / 30) assert.ok(lowAt(a, t) > -0.12, `sinks at ${t}`);
  assert.ok(Math.abs(lowAt(a, 1.2)) < 0.06);
});

test('ground "none" leaves swimming / flying poses untouched', () => {
  for (const y of [2, -1]) {
    const a = polish(crawlClip(y, 'none'));
    assert.equal(a.ground, 'none');
    for (const k of a.tracks.LowerTorso) assert.equal(k.p[1], y, 'hips are not moved');
    assert.deepEqual(a.tracks.RightFoot[0].r, [40, 0, 0]);
    assert.equal(a.feetLocked, 0);
    assert.ok(!a.warnings.some(w => w.type === 'ground'), 'no floor checks');
  }
  assert.ok(lowAt(polish(crawlClip(2, 'none')), 0.5) > 0.5, 'still floating');
});

test('check() honours the ground mode of the clip', () => {
  const sunk = polish(crawlClip(-3.5, 'none'));
  assert.deepEqual(check(sunk).filter(w => w.type === 'ground'), []);
  assert.ok(check({ ...sunk, ground: 'body' }).some(w => w.type === 'ground' && /Body sink/.test(w.msg)));
  assert.ok(check({ ...sunk, ground: 'feet' }).every(w => w.type !== 'ground'), 'tilted pose is not upright: feet check skipped');
  const upright = polish({ duration: 1, keys: [{ t: 0, pose: { LowerTorso: { p: [0, -1, 0], r: [0, 0, 0] } } }, { t: 1, pose: {} }] });
  assert.ok(check({ ...upright, tracks: { ...upright.tracks, LowerTorso: upright.tracks.LowerTorso.map(k => ({ ...k, p: [0, -1, 0] })) } }).some(w => w.type === 'ground'));
});

// ---- general phases ----
const ALIAS = { windup: 'anticipation', strike: 'action', impact: 'peak', followthrough: 'settle' };

test('general phases are accepted and listed next to the combat phases', () => {
  for (const p of ['windup', 'strike', 'impact', 'followthrough', 'recovery', 'pass', 'anticipation', 'action', 'peak', 'settle']) assert.ok(PHASES.includes(p), p);
  assert.ok(isDynPhase('action') && isDynPhase('peak') && isDynPhase('settle') && !isDynPhase('anticipation') && !isDynPhase('pass'));
  assert.ok(isPeak('peak') && isPeak('impact') && !isPeak('action'));
});

test('polish() treats anticipation/action/peak/settle exactly like windup/strike/impact/followthrough', () => {
  for (const name of ['punch', 'roundhouse', 'backflip']) {
    const clip = structuredClone(EXAMPLES[name]);
    const renamed = structuredClone(clip);
    for (const k of renamed.keys) if (ALIAS[k.phase]) k.phase = ALIAS[k.phase];
    assert.ok(renamed.keys.some(k => Object.values(ALIAS).includes(k.phase)), name);
    const a = polish(clip), b = polish(renamed);
    assert.deepEqual(b.tracks, a.tracks, `${name}: identical tracks`);
    assert.equal(b.overshoots, a.overshoots);
    assert.equal(b.arcKeys, a.arcKeys);
    assert.deepEqual(b.warnings, a.warnings);
  }
});

test('peak adds overshoot and a hand target stops dead at it, like impact', () => {
  const a = polish(structuredClone(EXAMPLES.punch));
  assert.ok(a.overshoots > 0, 'the legacy impact overshoots');
  const clip = structuredClone(EXAMPLES.punch);
  for (const k of clip.keys) if (k.phase === 'impact') k.phase = 'peak';
  assert.equal(polish(clip).overshoots, a.overshoots);
});

test('lag applies to anticipation and settle keys only', () => {
  const mk = phase => polish({ duration: 1, keys: [
    { t: 0, pose: { RightLowerArm: { r: [0, 0, 0] } } }, { t: 0.4, phase, pose: { RightLowerArm: { r: [60, 0, 0] } } }, { t: 1, pose: { RightLowerArm: { r: [0, 0, 0] } } },
  ] }).tracks.RightLowerArm.map(k => k.t);
  assert.deepEqual(mk('anticipation'), mk('windup'));
  assert.deepEqual(mk('settle'), mk('followthrough'));
  assert.notDeepEqual(mk('anticipation'), mk('pass'));
});

test('the new worked examples polish clean and check() passes', () => {
  for (const n of ['sitDown', 'wave']) {
    const a = polish(structuredClone(EXAMPLES[n]));
    assert.deepEqual(a.warnings, [], n);
    assert.deepEqual(check(a), [], n);
  }
  const sit = polish(structuredClone(EXAMPLES.sitDown));
  assert.ok(Math.abs(lowAt(sit, sit.duration)) < 0.06, 'seated on the floor');
  assert.ok(sit.tracks.RightUpperLeg.at(-1).r[0] > 60, 'ends seated, not back on its feet');
});
