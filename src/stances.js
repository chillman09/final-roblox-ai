// Stance library. The model used to be told "reuse the stance of the examples", so every clip began
// and ended with the same guard and the same hands. Now each style has its own stance (full pose,
// every joint), the server hands the chosen one to the model, and "auto" picks a fitting style at
// random so repeated prompts do not all look alike.
//
// Pose format = the model's own: { Joint: { r: [x, y, z] } }, LowerTorso may also carry p.
// Axes: see prompt.js. All values sit inside the R15 joint limits (rig.js).

const pose = (o) => o;

export const STYLES = {
  boxing: {
    label: 'Boxing',
    hint: 'tight high guard, fists at the chin, elbows in, chin tucked, bouncy knees',
    words: /punch|jab|cross|hook|uppercut|boxing|combo|hit|bash|slug|straight/,
    stance: pose({
      LowerTorso: { p: [0, 0, 0], r: [0, -10, 0] }, UpperTorso: { r: [-8, -14, 0] }, Head: { r: [8, 14, 0] },
      RightUpperArm: { r: [80, 15, -60] }, RightLowerArm: { r: [75, 0, 0] }, RightHand: { r: [-10, 0, 0] },
      LeftUpperArm: { r: [70, 0, 45] }, LeftLowerArm: { r: [110, 0, 0] }, LeftHand: { r: [-10, 0, 0] },
      LeftUpperLeg: { r: [24, 0, -4] }, LeftLowerLeg: { r: [-42, 0, 0] }, LeftFoot: { r: [10, 0, 0] },
      RightUpperLeg: { r: [-14, 0, 6] }, RightLowerLeg: { r: [-32, 0, 0] }, RightFoot: { r: [8, 0, 0] },
    }),
  },
  karate: {
    label: 'Karate',
    hint: 'wide, low front stance; rear fist chambered at the hip, lead arm out as a block',
    words: /karate|kick|front kick|block|chop|strike|palm|martial|dojo|kata|kiai/,
    stance: pose({
      LowerTorso: { p: [0, 0, 0], r: [0, -4, 0] }, UpperTorso: { r: [0, -4, 0] }, Head: { r: [0, 4, 0] },
      RightUpperArm: { r: [-15, 0, -60] }, RightLowerArm: { r: [135, 0, 0] }, RightHand: { r: [0, 0, 0] },
      LeftUpperArm: { r: [60, -15, 15] }, LeftLowerArm: { r: [80, 0, 0] }, LeftHand: { r: [-15, 0, 10] },
      LeftUpperLeg: { r: [38, 0, -14] }, LeftLowerLeg: { r: [-70, 0, 0] }, LeftFoot: { r: [25, 0, 0] },
      RightUpperLeg: { r: [-30, 0, 18] }, RightLowerLeg: { r: [-14, 0, 0] }, RightFoot: { r: [-12, 0, 0] },
    }),
  },
  muaythai: {
    label: 'Muay Thai',
    hint: 'upright, hands high by the temples, elbows wide, weight on the back leg, lead knee light',
    words: /muay|thai|\bknee(?!l)|elbow|clinch|shin|roundhouse|low kick|teep/,
    stance: pose({
      LowerTorso: { p: [0, 0, 0.04], r: [-2, -14, 0] }, UpperTorso: { r: [2, -10, 0] }, Head: { r: [-2, 10, 0] },
      RightUpperArm: { r: [85, 15, -55] }, RightLowerArm: { r: [100, 0, 0] }, RightHand: { r: [0, 0, 0] },
      LeftUpperArm: { r: [95, 0, 55] }, LeftLowerArm: { r: [125, 0, 0] }, LeftHand: { r: [0, 0, 0] },
      LeftUpperLeg: { r: [16, 0, -6] }, LeftLowerLeg: { r: [-24, 0, 0] }, LeftFoot: { r: [18, 0, 0] },
      RightUpperLeg: { r: [-12, 0, 8] }, RightLowerLeg: { r: [-34, 0, 0] }, RightFoot: { r: [6, 0, 0] },
    }),
  },
  brawler: {
    label: 'Brawler',
    hint: 'deep crouch, arms wide and low like a wrestler about to grab, torso leaning in',
    words: /brawl|wrestl|grab|tackle|slam|throw|shove|tavern|street|heavy|smash|charge/,
    stance: pose({
      LowerTorso: { p: [0, 0, -0.05], r: [-6, 0, 0] }, UpperTorso: { r: [-22, 0, 0] }, Head: { r: [20, 0, 0] },
      RightUpperArm: { r: [50, 0, 10] }, RightLowerArm: { r: [75, 0, 0] }, RightHand: { r: [-20, 0, 0] },
      LeftUpperArm: { r: [50, 0, -10] }, LeftLowerArm: { r: [75, 0, 0] }, LeftHand: { r: [-20, 0, 0] },
      LeftUpperLeg: { r: [52, 0, -24] }, LeftLowerLeg: { r: [-88, 0, 0] }, LeftFoot: { r: [30, 0, 0] },
      RightUpperLeg: { r: [52, 0, 24] }, RightLowerLeg: { r: [-88, 0, 0] }, RightFoot: { r: [30, 0, 0] },
    }),
  },
  swordsman: {
    label: 'Swordsman',
    hint: 'side-on blade stance: sword arm forward at chest height, off hand tucked behind, narrow feet',
    words: /sword|slash|blade|katana|saber|sabre|rapier|parry|riposte|lunge|fenc|cut|stab|spear|staff/,
    stance: pose({
      LowerTorso: { p: [0, 0, 0], r: [0, 34, 0] }, UpperTorso: { r: [-3, 12, 0] }, Head: { r: [2, -40, 0] },
      RightUpperArm: { r: [20, 0, -5] }, RightLowerArm: { r: [130, 0, 0] }, RightHand: { r: [-8, 0, 0] },
      LeftUpperArm: { r: [-20, 0, 60] }, LeftLowerArm: { r: [130, 0, 0] }, LeftHand: { r: [0, 0, 0] },
      LeftUpperLeg: { r: [-16, 0, -6] }, LeftLowerLeg: { r: [-28, 0, 0] }, LeftFoot: { r: [8, 0, 0] },
      RightUpperLeg: { r: [20, 0, 8] }, RightLowerLeg: { r: [-34, 0, 0] }, RightFoot: { r: [10, 0, 0] },
    }),
  },
  acrobat: {
    label: 'Acrobat / parkour',
    hint: 'loose athletic ready pose: arms low and relaxed, knees soft, weight on the balls of the feet',
    words: /flip|spin|jump|dodge|dash|roll|vault|cartwheel|parkour|acrobat|flying|leap|dive|backflip/,
    stance: pose({
      LowerTorso: { p: [0, 0, 0], r: [-4, 0, 0] }, UpperTorso: { r: [-8, 0, 0] }, Head: { r: [6, 0, 0] },
      RightUpperArm: { r: [18, 0, 16] }, RightLowerArm: { r: [28, 0, 0] }, RightHand: { r: [0, 0, 0] },
      LeftUpperArm: { r: [18, 0, -16] }, LeftLowerArm: { r: [28, 0, 0] }, LeftHand: { r: [0, 0, 0] },
      LeftUpperLeg: { r: [14, 0, -5] }, LeftLowerLeg: { r: [-28, 0, 0] }, LeftFoot: { r: [10, 0, 0] },
      RightUpperLeg: { r: [14, 0, 5] }, RightLowerLeg: { r: [-28, 0, 0] }, RightFoot: { r: [10, 0, 0] },
    }),
  },
  relaxed: {
    label: 'Relaxed / non-combat',
    hint: 'natural standing pose for emotes, dances, walks, idles and celebrations: no fighting guard at all',
    words: /dance|wave|emote|idle|walk|run|jog|sit|cheer|celebrat|victory|taunt|bow|greet|laugh|point|clap|shrug|salute/,
    stance: pose({
      LowerTorso: { p: [0, 0, 0], r: [0, 0, 0] }, UpperTorso: { r: [0, 0, 0] }, Head: { r: [0, 0, 0] },
      RightUpperArm: { r: [6, 0, 8] }, RightLowerArm: { r: [14, 0, 0] }, RightHand: { r: [0, 0, 0] },
      LeftUpperArm: { r: [6, 0, -8] }, LeftLowerArm: { r: [14, 0, 0] }, LeftHand: { r: [0, 0, 0] },
      LeftUpperLeg: { r: [2, 0, -2] }, LeftLowerLeg: { r: [-6, 0, 0] }, LeftFoot: { r: [2, 0, 0] },
      RightUpperLeg: { r: [2, 0, 2] }, RightLowerLeg: { r: [-6, 0, 0] }, RightFoot: { r: [2, 0, 0] },
    }),
  },
};

export const STYLE_IDS = Object.keys(STYLES);
export const isStyle = id => id === 'auto' || Object.hasOwn(STYLES, id);

// Which style to use. An explicit style wins. "auto" scores each style against the prompt's words
// and picks at random among the best matches, so asking for the same punch twice does not give the
// same guard twice. When nothing matches, the prompt is not a fight: "relaxed", never a random guard.
export function pickStyle(requested, text = '', rand = Math.random) {
  if (requested && requested !== 'auto' && Object.hasOwn(STYLES, requested)) return requested;
  const t = String(text).toLowerCase();
  const scored = STYLE_IDS.map(id => ({ id, n: (t.match(new RegExp(STYLES[id].words.source, 'g')) ?? []).length }));
  const top = Math.max(...scored.map(s => s.n));
  if (top <= 0) return 'relaxed';
  const pool = scored.filter(s => s.n === top).map(s => s.id);
  return pool[Math.floor(rand() * pool.length)];
}

// ---- motion categories ----
// Each category has a regex; the category with the most matches wins. Ties go to the earlier entry in
// MOTION_ORDER, so "sit down and die" is a transition, and anything with no match is a one-shot action.
export const MOTION_CATEGORIES = ['combat', 'locomotion', 'non_upright', 'transition', 'emote_loop', 'action_oneshot'];
const MOTION_WORDS = {
  combat: /punch|jab|hook|uppercut|kick|slash|\bcut\b|stab|lunge|parry|riposte|\bblock|tackle|dodge|fight|combat|attack|strike|boxing|karate|sword|katana|brawl|wrestl|slam|smash|clinch|knee strike|backflip|roundhouse/g,
  locomotion: /\bwalk|\brun(?:ning)?\b|\bjog|sprint|sneak|\blimp|strafe|march|stroll|tiptoe|trudge|\bhop(?:ping)?\b|skip(?:ping)?/g,
  non_upright: /swim|\bfly(?:ing)?\b|flight|float|hover|climb|crawl|push-?up|\bglid|soar|levitat|dive underwater|ladder/g,
  transition: /\bsit(?:ting)?\b|crouch|kneel|lie down|lying|lay down|sleep|\bdie\b|\bdies\b|dying|death|collaps|fall(?:ing)? down|\bfall over|get(?:ting)? up|stand up|stand(?:ing)? up|squat|faint|knock(?:ed)? out|drop to/g,
  emote_loop: /danc|\bidle|breath|cheer|laugh|\bcry|crying|\bclap|taunt|celebrat|victory|\bsway|\bbop|groove|shiver|wiggle/g,
  action_oneshot: /\bwave|salute|cast|spell|\bopen|pick up|drink|reload|\bmine\b|mining|\bchop|\bpoint|throw|bow\b|nod|shrug|push button|pull lever|read|write|eat/g,
};
const MOTION_ORDER = ['transition', 'non_upright', 'locomotion', 'combat', 'emote_loop', 'action_oneshot'];

// Sorts a prompt into one of MOTION_CATEGORIES. Nothing recognisable = a general one-shot action.
export function classifyMotion(text = '') {
  const t = String(text).toLowerCase();
  let best = 'action_oneshot', top = 0;
  for (const id of MOTION_ORDER) {
    const n = (t.match(MOTION_WORDS[id]) ?? []).length;
    if (n > top) { top = n; best = id; }
  }
  return best;
}

// The text added to the model's request for a new animation.
export function stanceBlock(styleId) {
  const s = Object.hasOwn(STYLES, styleId) ? STYLES[styleId] : null;
  return s ? `STYLE: ${s.label} (${s.hint}).\nSTANCE for the first and last key (all joints; bend it to suit the move, but keep its character, hand positions included):\n${JSON.stringify(s.stance)}` : '';
}
