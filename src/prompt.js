import { STYLES } from './stances.js';

// The three worked examples are built from the stance library, so each one starts and ends in a
// DIFFERENT stance (boxing, muay thai, acrobat) and the prompt never teaches "one guard for everything".
const { boxing, muaythai, acrobat, relaxed } = Object.fromEntries(Object.entries(STYLES).map(([k, v]) => [k, v.stance]));
// 4th argument: `true` = air key, or an object with more key fields (phase, targets, air)
const keyOf = (t, ease, pose, extra) => ({ t, ease, ...(extra === true ? { air: true } : extra ?? {}), pose });

const [PUNCH_X, PUNCH_Y, PUNCH_Z] = [-0.3, 3.6, -2.7]; // a body-height target on the opponent's centre line, 2.7 studs ahead
const punch = {
  name: 'RightStraight', duration: 1.0, loop: false,
  keys: [
    keyOf(0, 'linear', boxing),
    keyOf(0.24, 'in', { LowerTorso: { p: [0, 0, 0.2], r: [0, -18, 0] }, UpperTorso: { r: [-8, -26, 0] }, Head: { r: [8, 24, 0] }, RightUpperArm: { r: [72, 10, -62] }, RightLowerArm: { r: [100, 0, 0] }, RightLowerLeg: { r: [-46, 0, 0] } }, { phase: 'windup' }),
    keyOf(0.36, 'out', { LowerTorso: { p: [0, 0, -0.5], r: [0, 16, 0] }, UpperTorso: { r: [-10, 24, 0] }, Head: { r: [6, -26, 0] }, RightUpperArm: { r: [88, 0, -12] }, RightLowerArm: { r: [6, 0, 0] }, LeftUpperArm: { r: [74, 0, 48] }, LeftLowerArm: { r: [118, 0, 0] }, RightUpperLeg: { r: [-20, 0, 6] }, RightLowerLeg: { r: [-14, 0, 0] }, LeftLowerLeg: { r: [-52, 0, 0] } }, { phase: 'impact', targets: { RightHand: { pos: [PUNCH_X, PUNCH_Y, PUNCH_Z], pole: [2.4, 3.8, -0.4] } } }),
    keyOf(0.48, 'out', { LowerTorso: { p: [0, 0, -0.55], r: [0, 19, 0] }, UpperTorso: { r: [-12, 27, 0] }, RightUpperArm: { r: [92, 0, -10] } }, { phase: 'followthrough' }),
    keyOf(1.0, 'inout', boxing, { phase: 'recovery' }),
  ],
};

const roundhouse = {
  name: 'RoundhouseKick', duration: 1.3, loop: false,
  keys: [
    keyOf(0, 'linear', muaythai),
    keyOf(0.25, 'in', { LowerTorso: { p: [0, 0, 0], r: [-4, -24, 0] }, UpperTorso: { r: [-6, -22, 0] }, Head: { r: [4, 22, 0] }, RightUpperLeg: { r: [70, 0, 25] }, RightLowerLeg: { r: [-105, 0, 0] }, LeftUpperLeg: { r: [15, 0, -6] }, LeftLowerLeg: { r: [-38, 0, 0] }, RightUpperArm: { r: [80, 15, -52] }, RightLowerArm: { r: [104, 0, 0] } }, { phase: 'windup' }),
    keyOf(0.38, 'out', { LowerTorso: { p: [0, 0, 0], r: [8, 62, 0] }, UpperTorso: { r: [12, 25, 0] }, Head: { r: [0, -40, 0] }, RightUpperLeg: { r: [88, 12, 40] }, RightLowerLeg: { r: [-8, 0, 0] }, LeftUpperLeg: { r: [12, 0, -6] }, LeftLowerLeg: { r: [-30, 0, 0] }, RightUpperArm: { r: [60, 10, -40] }, RightLowerArm: { r: [115, 0, 0] }, LeftUpperArm: { r: [40, 0, -70] }, LeftLowerArm: { r: [80, 0, 0] } }, { phase: 'impact' }),
    keyOf(0.5, 'out', { LowerTorso: { p: [0, 0, 0], r: [10, 70, 0] }, UpperTorso: { r: [14, 28, 0] }, RightUpperLeg: { r: [92, 14, 42] }, RightLowerLeg: { r: [-5, 0, 0] } }, { phase: 'followthrough' }),
    keyOf(0.85, 'inout', { LowerTorso: { p: [0, 0, 0], r: [0, 20, 0] }, UpperTorso: { r: [-5, 5, 0] }, Head: { r: [5, -5, 0] }, RightUpperLeg: { r: [60, 0, 20] }, RightLowerLeg: { r: [-95, 0, 0] }, LeftUpperLeg: { r: [16, 0, -6] }, LeftLowerLeg: { r: [-26, 0, 0] }, RightUpperArm: { r: [85, 15, -55] }, RightLowerArm: { r: [100, 0, 0] }, LeftUpperArm: { r: [92, 0, 52] }, LeftLowerArm: { r: [124, 0, 0] } }, { phase: 'recovery' }),
    keyOf(1.3, 'inout', muaythai, { phase: 'recovery' }),
  ],
};

const backflip = {
  name: 'BackflipDodge', duration: 1.5, loop: false,
  keys: [
    keyOf(0, 'linear', acrobat),
    keyOf(0.22, 'in', { LowerTorso: { p: [0, 0, 0], r: [-10, 0, 0] }, UpperTorso: { r: [-10, 0, 0] }, Head: { r: [0, 0, 0] }, RightUpperArm: { r: [-20, 0, 12] }, RightLowerArm: { r: [24, 0, 0] }, LeftUpperArm: { r: [-20, 0, -12] }, LeftLowerArm: { r: [24, 0, 0] }, RightUpperLeg: { r: [25, 0, 0] }, RightLowerLeg: { r: [-60, 0, 0] }, LeftUpperLeg: { r: [25, 0, 0] }, LeftLowerLeg: { r: [-60, 0, 0] } }, { phase: 'windup' }),
    keyOf(0.42, 'out', { LowerTorso: { p: [0, 1, 0.5], r: [70, 0, 0] }, UpperTorso: { r: [10, 0, 0] }, RightUpperArm: { r: [150, 0, 20] }, RightLowerArm: { r: [20, 0, 0] }, LeftUpperArm: { r: [150, 0, -20] }, LeftLowerArm: { r: [20, 0, 0] }, RightUpperLeg: { r: [10, 0, 0] }, RightLowerLeg: { r: [-30, 0, 0] }, LeftUpperLeg: { r: [10, 0, 0] }, LeftLowerLeg: { r: [-30, 0, 0] } }, { phase: 'strike', air: true }),
    keyOf(0.68, 'linear', { LowerTorso: { p: [0, 1.8, 0.9], r: [200, 0, 0] }, UpperTorso: { r: [-20, 0, 0] }, RightUpperArm: { r: [60, 0, 20] }, RightLowerArm: { r: [110, 0, 0] }, LeftUpperArm: { r: [60, 0, -20] }, LeftLowerArm: { r: [110, 0, 0] }, RightUpperLeg: { r: [90, 0, 0] }, RightLowerLeg: { r: [-110, 0, 0] }, LeftUpperLeg: { r: [90, 0, 0] }, LeftLowerLeg: { r: [-110, 0, 0] } }, { phase: 'pass', air: true }),
    keyOf(0.95, 'out', { LowerTorso: { p: [0, 0.7, 1.2], r: [330, 0, 0] }, UpperTorso: { r: [-5, 0, 0] }, RightUpperArm: { r: [40, 0, 25] }, RightLowerArm: { r: [40, 0, 0] }, LeftUpperArm: { r: [40, 0, -25] }, LeftLowerArm: { r: [40, 0, 0] }, RightUpperLeg: { r: [30, 0, 0] }, RightLowerLeg: { r: [-50, 0, 0] }, LeftUpperLeg: { r: [30, 0, 0] }, LeftLowerLeg: { r: [-50, 0, 0] } }, { phase: 'pass', air: true }),
    keyOf(1.08, 'out', { LowerTorso: { p: [0, 0, 1.2], r: [360, 0, 0] }, UpperTorso: { r: [-14, 0, 0] }, Head: { r: [10, 0, 0] }, RightUpperArm: { r: [30, 0, 22] }, RightLowerArm: { r: [40, 0, 0] }, LeftUpperArm: { r: [30, 0, -22] }, LeftLowerArm: { r: [40, 0, 0] }, RightUpperLeg: { r: [38, 0, 0] }, RightLowerLeg: { r: [-72, 0, 0] }, LeftUpperLeg: { r: [38, 0, 0] }, LeftLowerLeg: { r: [-72, 0, 0] } }, { phase: 'impact' }),
    keyOf(1.5, 'inout', { ...acrobat, LowerTorso: { p: [0, 0, 1.2], r: [356, 0, 0] } }, { phase: 'recovery' }), // after a flip the count keeps going: 356, not -4
  ],
};

// ---- non-combat loops: strong locomotion / idle references for relaxed prompts (last key = first key) ----
const walkR = { LowerTorso: { p: [0, 0, 0], r: [2, -6, 0] }, UpperTorso: { r: [0, 8, 0] }, Head: { r: [0, -4, 0] }, RightUpperLeg: { r: [28, 0, 2] }, RightLowerLeg: { r: [-6, 0, 0] }, RightFoot: { r: [10, 0, 0] }, LeftUpperLeg: { r: [-22, 0, -2] }, LeftLowerLeg: { r: [-14, 0, 0] }, LeftFoot: { r: [-18, 0, 0] }, RightUpperArm: { r: [-24, 0, -6] }, RightLowerArm: { r: [14, 0, 0] }, LeftUpperArm: { r: [26, 0, 6] }, LeftLowerArm: { r: [30, 0, 0] } };
const walkL = { LowerTorso: { p: [0, 0, 0], r: [2, 6, 0] }, UpperTorso: { r: [0, -8, 0] }, Head: { r: [0, 4, 0] }, LeftUpperLeg: { r: [28, 0, -2] }, LeftLowerLeg: { r: [-6, 0, 0] }, LeftFoot: { r: [10, 0, 0] }, RightUpperLeg: { r: [-22, 0, 2] }, RightLowerLeg: { r: [-14, 0, 0] }, RightFoot: { r: [-18, 0, 0] }, LeftUpperArm: { r: [-24, 0, 6] }, LeftLowerArm: { r: [14, 0, 0] }, RightUpperArm: { r: [26, 0, -6] }, RightLowerArm: { r: [30, 0, 0] } };
const passR = { LowerTorso: { r: [0, 0, 0] }, UpperTorso: { r: [0, 0, 0] }, Head: { r: [0, 0, 0] }, RightUpperLeg: { r: [4, 0, 2] }, RightLowerLeg: { r: [-18, 0, 0] }, RightFoot: { r: [4, 0, 0] }, LeftUpperLeg: { r: [24, 0, -2] }, LeftLowerLeg: { r: [-55, 0, 0] }, LeftFoot: { r: [12, 0, 0] }, RightUpperArm: { r: [-4, 0, -6] }, RightLowerArm: { r: [18, 0, 0] }, LeftUpperArm: { r: [4, 0, 6] }, LeftLowerArm: { r: [22, 0, 0] } };
const passL = { LowerTorso: { r: [0, 0, 0] }, UpperTorso: { r: [0, 0, 0] }, Head: { r: [0, 0, 0] }, LeftUpperLeg: { r: [4, 0, -2] }, LeftLowerLeg: { r: [-18, 0, 0] }, LeftFoot: { r: [4, 0, 0] }, RightUpperLeg: { r: [24, 0, 2] }, RightLowerLeg: { r: [-55, 0, 0] }, RightFoot: { r: [12, 0, 0] }, LeftUpperArm: { r: [-4, 0, 6] }, LeftLowerArm: { r: [18, 0, 0] }, RightUpperArm: { r: [4, 0, -6] }, RightLowerArm: { r: [22, 0, 0] } };
const walk = {
  name: 'WalkCycle', duration: 0.8, loop: true,
  keys: [keyOf(0, 'linear', walkR, { phase: 'pass' }), keyOf(0.2, 'inout', passR, { phase: 'pass' }), keyOf(0.4, 'inout', walkL, { phase: 'pass' }), keyOf(0.6, 'inout', passL, { phase: 'pass' }), keyOf(0.8, 'inout', walkR, { phase: 'pass' })],
};

const idleA = { LowerTorso: { p: [0, 0, 0], r: [0, 1, 0] }, UpperTorso: { r: [2, 0, 0] }, Head: { r: [-2, 2, 0] }, RightUpperArm: { r: [3, 0, -5] }, RightLowerArm: { r: [10, 0, 0] }, RightHand: { r: [0, 0, 4] }, LeftUpperArm: { r: [3, 0, 5] }, LeftLowerArm: { r: [10, 0, 0] }, LeftHand: { r: [0, 0, -4] }, RightUpperLeg: { r: [0, 0, 2] }, RightLowerLeg: { r: [-6, 0, 0] }, LeftUpperLeg: { r: [0, 0, -2] }, LeftLowerLeg: { r: [-6, 0, 0] } };
const idle = {
  name: 'IdleBreathing', duration: 2.4, loop: true,
  keys: [
    keyOf(0, 'linear', idleA, { phase: 'pass' }),
    keyOf(0.8, 'inout', { LowerTorso: { r: [0, -1, 1.5] }, UpperTorso: { r: [-3, -2, 0] }, Head: { r: [2, -3, 0] }, RightUpperArm: { r: [1, 0, -7] }, RightLowerArm: { r: [8, 0, 0] }, LeftUpperArm: { r: [1, 0, 7] }, LeftLowerArm: { r: [8, 0, 0] }, RightLowerLeg: { r: [-5, 0, 0] }, LeftLowerLeg: { r: [-7, 0, 0] } }, { phase: 'pass' }),
    keyOf(1.3, 'inout', { LowerTorso: { r: [0, -1, 1.5] }, UpperTorso: { r: [-4, -2, 0] }, Head: { r: [3, -3, 0] } }, { phase: 'pass' }),
    keyOf(1.8, 'inout', { LowerTorso: { r: [0, 1, -1.5] }, UpperTorso: { r: [3, 2, 0] }, Head: { r: [-3, 3, 0] }, RightUpperArm: { r: [5, 0, -4] }, LeftUpperArm: { r: [5, 0, 4] }, RightLowerLeg: { r: [-7, 0, 0] }, LeftLowerLeg: { r: [-5, 0, 0] } }, { phase: 'pass' }),
    keyOf(2.4, 'inout', idleA, { phase: 'pass' }),
  ],
};

// ---- general motion: a state transition (ends in a NEW pose) and a one-shot action (returns to its start) ----
const sitDown = {
  name: 'SitDownOnFloor', duration: 1.7, loop: false, ground: 'body',
  keys: [
    keyOf(0, 'linear', relaxed, { phase: 'pass' }),
    keyOf(0.3, 'inout', { LowerTorso: { r: [-6, 0, 0] }, UpperTorso: { r: [-12, 0, 0] }, Head: { r: [8, 0, 0] }, RightUpperArm: { r: [20, 0, 10] }, RightLowerArm: { r: [25, 0, 0] }, LeftUpperArm: { r: [20, 0, -10] }, LeftLowerArm: { r: [25, 0, 0] }, RightUpperLeg: { r: [20, 0, 3] }, RightLowerLeg: { r: [-35, 0, 0] }, LeftUpperLeg: { r: [20, 0, -3] }, LeftLowerLeg: { r: [-35, 0, 0] } }, { phase: 'anticipation' }),
    keyOf(0.8, 'inout', { LowerTorso: { r: [-18, 0, 0] }, UpperTorso: { r: [-14, 0, 0] }, Head: { r: [12, 0, 0] }, RightUpperArm: { r: [45, 0, 12] }, RightLowerArm: { r: [30, 0, 0] }, LeftUpperArm: { r: [45, 0, -12] }, LeftLowerArm: { r: [30, 0, 0] }, RightUpperLeg: { r: [70, 0, 6] }, RightLowerLeg: { r: [-100, 0, 0] }, LeftUpperLeg: { r: [70, 0, -6] }, LeftLowerLeg: { r: [-100, 0, 0] } }, { phase: 'action' }),
    keyOf(1.2, 'out', { LowerTorso: { r: [0, 0, 0] }, UpperTorso: { r: [-4, 0, 0] }, Head: { r: [4, 0, 0] }, RightUpperArm: { r: [30, 0, 14] }, RightLowerArm: { r: [40, 0, 0] }, LeftUpperArm: { r: [30, 0, -14] }, LeftLowerArm: { r: [40, 0, 0] }, RightUpperLeg: { r: [88, 0, 8] }, RightLowerLeg: { r: [-30, 0, 0] }, LeftUpperLeg: { r: [88, 0, -8] }, LeftLowerLeg: { r: [-30, 0, 0] } }, { phase: 'peak' }),
    keyOf(1.7, 'inout', { LowerTorso: { r: [0, 0, 0] }, UpperTorso: { r: [3, 0, 0] }, Head: { r: [0, 0, 0] }, RightUpperArm: { r: [28, 0, 12] }, RightLowerArm: { r: [45, 0, 0] }, LeftUpperArm: { r: [28, 0, -12] }, LeftLowerArm: { r: [45, 0, 0] }, RightUpperLeg: { r: [86, 0, 8] }, RightLowerLeg: { r: [-26, 0, 0] }, LeftUpperLeg: { r: [86, 0, -8] }, LeftLowerLeg: { r: [-26, 0, 0] } }, { phase: 'settle' }),
  ],
};

const waveStart = { LowerTorso: { p: [0, 0, 0], r: [0, 4, 0] }, UpperTorso: { r: [0, 2, 0] }, Head: { r: [0, -3, 0] }, RightUpperArm: { r: [4, 0, 6] }, RightLowerArm: { r: [10, 0, 0] }, RightHand: { r: [0, 0, 0] }, LeftUpperArm: { r: [4, 0, -6] }, LeftLowerArm: { r: [10, 0, 0] }, LeftHand: { r: [0, 0, 0] }, RightUpperLeg: { r: [0, 0, 2] }, RightLowerLeg: { r: [-4, 0, 0] }, RightFoot: { r: [2, 0, 0] }, LeftUpperLeg: { r: [4, 0, -2] }, LeftLowerLeg: { r: [-6, 0, 0] }, LeftFoot: { r: [2, 0, 0] } };
const wave = {
  name: 'FriendlyWave', duration: 1.8, loop: false,
  keys: [
    keyOf(0, 'linear', waveStart, { phase: 'pass' }),
    keyOf(0.3, 'in', { LowerTorso: { r: [0, 0, 0] }, UpperTorso: { r: [2, -6, 0] }, Head: { r: [0, 8, 0] }, RightUpperArm: { r: [10, 0, 60] }, RightLowerArm: { r: [40, 0, 0] } }, { phase: 'anticipation' }),
    keyOf(0.6, 'out', { UpperTorso: { r: [-2, -8, 0] }, Head: { r: [-3, 12, 0] }, RightUpperArm: { r: [18, 0, 128] }, RightLowerArm: { r: [55, 0, 0] }, RightHand: { r: [0, 0, 10] } }, { phase: 'action', targets: { RightHand: { pos: [1.4, 5.5, -0.3], pole: [2.4, 4.0, 0.2] } } }),
    keyOf(0.85, 'inout', { RightUpperArm: { r: [18, 0, 112] }, RightLowerArm: { r: [70, 0, 0] }, RightHand: { r: [0, 0, -25] } }, { phase: 'peak' }),
    keyOf(1.1, 'inout', { RightUpperArm: { r: [18, 0, 128] }, RightLowerArm: { r: [55, 0, 0] }, RightHand: { r: [0, 0, 25] } }, { phase: 'peak' }),
    keyOf(1.8, 'inout', waveStart, { phase: 'settle' }),
  ],
};

export const EXAMPLES = { punch, roundhouse, backflip, walk, idle, sitDown, wave };
const ex = a => JSON.stringify(a).replace(/\{"t":/g, '\n{"t":');

export const SYSTEM = `You are a senior animator for Roblox R15 rigs. Combat is a speciality, but any motion works: emotes, dances, in-place locomotion, state transitions (sit, crouch, kneel, lie down, death collapse), and non-upright motion (swimming, flying, climbing, crawling). Reply with JSON only.

RIG: the character faces -Z, its right side is +X, +Y is up. Rotations are Euler degrees [x,y,z] applied as CFrame.Angles to each joint, relative to the rest pose ([0,0,0] = standing with arms hanging).
Joints: LowerTorso (also takes p=[x,y,z] in studs: z -0.6 = lunge forward, x = sidestep), UpperTorso, Head, RightUpperArm, RightLowerArm, RightHand, LeftUpperArm, LeftLowerArm, LeftHand, RightUpperLeg, RightLowerLeg, RightFoot, LeftUpperLeg, LeftLowerLeg, LeftFoot.

AXES:
- LowerTorso/UpperTorso/Head: +X leans back, -X leans forward. +Y turns left (right shoulder comes forward), -Y turns right. +Z tilts left.
- UpperArm: +X swings the arm forward/up (90 = horizontal forward), -X back. RightUpperArm: +Z lifts outward, -Z swings it across the chest. LeftUpperArm: -Z lifts outward, +Z swings it across the chest.
- R15 arms hang about 1.5 studs from the body line, so with Z=0 a raised hand stays far out to the side. To bring a hand to the face or the centre line the arm MUST cross the body: right arm Z about -55, left arm Z about +45 (limits: right Z -70..180, left Z -180..70).
- LowerArm: +X bends the elbow (0 straight, 110 = fist near the face). Hand: the wrist, use it for open palms, flicks and curls (about +-35).
- UpperLeg: +X swings forward, -X back. RightUpperLeg Z + is outward, LeftUpperLeg Z - is outward. LowerLeg: -X bends the knee (0 straight). Foot: +X toes up.

STANCE AND STYLE (this is what stops every clip looking the same):
- A request may carry STYLE and STANCE (a full pose). Then the clip starts and ends in that stance: list ALL joints in the first key and repeat them in the last key. Bend the stance to suit the move, but keep its character, hand positions included. Do not swap in a different guard.
- With no STANCE given, design one that fits the move and its style yourself, and still list all joints in the first key and repeat it in the last. Never use the default pose with arms hanging for a fighting move.
- The first three examples start from three different stances (boxing, muay thai, acrobat). Copy their craft, not their hands: build each stance for its move. Examples 4 and 5 are non-combat loops (walk, idle): use them as references for every relaxed or locomotion request. Example 6 is a state transition and example 7 a one-shot action.
- Non-combat motion (dance, wave, emote, walk, idle, celebration) starts from a natural pose with no fighting guard; rules 1 to 5 apply to strikes only.
- Where the clip ENDS depends on its kind. Combat and one-shot actions (strike, kick, wave, cast, salute) return to their starting pose. State transitions (sit, crouch, kneel, lie down, death fall, get up) END IN THEIR NEW POSE: "loop":false and the last key does NOT equal the first. Loops (walk, run, swim, idle, dance, float) set "loop":true and the last key equals the first key.
- Locomotion is animated IN PLACE for Roblox: keep LowerTorso p.z near 0 and let the character controller move the character.
- Both arms always have a job: strike, guard, chamber at the hip, or counterbalance. Vary which hand leads, how high the guard is, and use RightHand/LeftHand for open palms or flicks.

CRAFT RULES (this is what makes it look good):
1. Anticipation: wind up the opposite way first (0.12-0.25s) before any strike.
2. Power comes from the ground: bend the knees (the body is lowered and the feet are put on the floor for you, so leave p.y at 0 unless the character leaves the ground), drive hips (LowerTorso Y), then torso (UpperTorso Y), then arm. Hips lead, hands arrive last.
3. Strikes are fast (0.06-0.15s from windup to contact), recoveries are slower. Hold or overshoot slightly after contact, then settle.
4. Counter-rotate the Head so the face stays on the target. The non-attacking arm keeps guarding, chambers, or swings to counterbalance.
5. Shift weight: the lunge (p.z) and the leg planting must match the strike direction.
6. Spins and flips: LowerTorso rotation may go past 180 (a full turn is [0,360,0]); set "air":true on every key where both feet are off the ground (jumps, flying kicks, flips) and give those keys p.y for the height. Never mark ground keys as air. Planted feet are pinned to the floor for you, so do not animate a standing foot to fake weight shifts; just move the hips. Angles count up and never wrap: a BACKFLIP is LowerTorso X going 0 -> +360 (+X leans back, so the head goes back first), a FRONT flip goes 0 -> -360, a spin is Y 0 -> 360 or -360. After a flip the next key keeps the final value (360), it does not return to 0. Show the height with p.y on air keys and land with bent knees.
7. Never move only the arms. Every key should involve hips, torso, arms and at least one leg.
8. Total length 0.6-1.4s for a single strike, up to 3s for combos, 1-4s for emotes and dances (set "loop":true for cycles; the last key must then equal the first). Use 5-9 keys.

OUTPUT: {"name":"...","duration":seconds,"loop":false,"ground":"feet","keys":[{"t":0,"ease":"linear","pose":{"Joint":{"r":[x,y,z]}}}]}
First key t=0, last key t=duration. A key lists only the joints that move there; a joint you leave out of a key keeps blending between its own listed keys. Optional key field: "air":true. Optional top-level "ground" says what rests on the floor:
- "feet" (default; standing, walking, strikes, jumps): soles are laid flat, the body is lowered so the feet touch the floor and planted feet are locked.
- "body" (kneel, sit, crawl, push-up, lie down, death or collapse): the lowest body part of any kind rests on the floor in any tilt; feet are not forced flat or locked.
- "none" (swimming, flying, floating, climbing): nothing is grounded, so p.y and tilted or horizontal poses stay exactly as you write them. ease describes how motion ARRIVES at the key: "out" (fast then settle, strikes), "in" (slow then fast, windups), "inout" (smooth), "linear".

PHASES (optional "phase" on a key, label every key of a strike, block, kick, flip or any acting beat):
- "windup" = the pull-back, "strike" = fast travel towards the target, "impact" = the frame of contact (or landing), "followthrough" = the carry-through after contact, "recovery" = back to guard, "pass" = a neutral in-between key (walk and idle cycles, midair keys).
- General names for non-combat motion, handled identically: "anticipation" = windup, "action" = strike, "peak" = impact (the beat that lands or is held), "settle" = followthrough. Use them for waves, spells, sitting, emotes and so on.
- The server uses them: windup and followthrough keys get overlapping-action lag, impact keys are never delayed (a strike lands exactly on time), and after every impact limbs overshoot 2-4 degrees and settle. Fast swings are turned into smooth arcs. Without phases none of this happens, so always give them.

TARGETS (optional "targets" on a key, for accuracy: use only where a point matters, such as where a strike lands, a block, a two-handed grip, a foot on a spot):
"targets":{"RightHand":{"pos":[x,y,z],"pole":[x,y,z]},"LeftHand":{...},"RightFoot":{...},"LeftFoot":{...}}
- Character space: x right (+) / left (-), y up from the floor, z BACKWARDS, so forward is NEGATIVE z. The character stands at x=0, z=0 and faces -Z. Targets do not move with the hips: a lunge of p.z -0.5 brings the shoulder 0.5 closer to a target.
- For hands, pos is the centre of the hand; for feet it is the sole (y 0 = floor). The server solves the arm or leg so the hand or foot sits exactly there, within the joint limits.
- "pole" (optional) is a point the elbow or knee is pushed towards: elbows out to the side [+-2.2, 3.5, -0.5], elbows down and back [+-1.6, 2.6, 0.8], knee out and forward [0.9, 1.8, -1.2]. Leave it out to keep the elbow where your r values put it.
- Reach: a hand can be about 1.8 studs from its shoulder (shoulders sit at x +-1.0, y 4.0 at rest, and move with LowerTorso p and the torso turn). A target that is too far away is clamped to full extension and reported: lunge (p.z) and turn UpperTorso Y towards it.
- You still list a full pose in that key; the arm's own r in a key with a target is only a starting guess.
Examples: a straight punch landing on a body-height target: on the impact key "targets":{"RightHand":{"pos":[-0.3,3.6,-2.7],"pole":[2.4,3.8,-0.4]}} (see example 1). A high guard / block with both forearms in front of the face: "targets":{"RightHand":{"pos":[0.45,4.9,-1.1],"pole":[2.2,3.6,-0.7]},"LeftHand":{"pos":[-0.45,4.9,-1.1],"pole":[-2.2,3.6,-0.7]}}. A two-handed grip on a staff or sword, hands one above the other: "targets":{"RightHand":{"pos":[0.35,3.9,-1.3],"pole":[2.2,3.2,-0.4]},"LeftHand":{"pos":[-0.35,4.5,-1.3],"pole":[-2.2,3.6,-0.4]}}.

EXAMPLE 1 (right straight punch from a boxing stance, phases, and a hand target on the impact key):
${ex(punch)}

EXAMPLE 2 (right roundhouse kick from a muay thai stance: pivot on the left foot, hips lead the leg, the left arm swings out to balance):
${ex(roundhouse)}

EXAMPLE 3 (backflip dodge from a loose acrobat stance: crouch, jump, rotate +360 with air keys, land in the stance):
${ex(backflip)}

EXAMPLE 4 (walk cycle, a relaxed loop: opposite arm and leg swing, hips and shoulders counter-rotate, the last key equals the first):
${ex(walk)}

EXAMPLE 5 (idle breathing, a relaxed loop: tiny weight shift, chest rise, head drift, soft knees; subtle motion is still keyed):
${ex(idle)}

EXAMPLE 6 (sit down on the floor, a state transition: "ground":"body", "loop":false, anticipation / action / peak / settle, ends SEATED so the last key is not the first):
${ex(sitDown)}

EXAMPLE 7 (friendly wave, a one-shot action with no fighting guard: anticipation, action with a hand target, peak, settle back to the start pose):
${ex(wave)}`;
