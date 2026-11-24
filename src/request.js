// Builds the text sent to the model for a new, revised or "fix" request. Kept out of server.js so it
// can be tested without Express.
import { isStyle, pickStyle, stanceBlock, classifyMotion } from './stances.js';

// A short, category-specific instruction block appended to new requests.
const MOTION_MODES = {
  transition: 'MOTION_MODE: transition (a state change such as sit, crouch, kneel, lie down, collapse, get up). "loop": false. The last key does NOT need to equal the first key: end in the target pose (the STANCE above is only the starting pose). Use "ground": "body" if the character ends kneeling, sitting, lying or fallen.',
  locomotion: 'MOTION_MODE: locomotion. "loop": true and the last key must equal the first key. Animate IN PLACE (LowerTorso p.z stays near 0): Roblox\'s character controller moves the character. Keep "ground": "feet".',
  non_upright: 'MOTION_MODE: non-upright motion. For swimming, flying, floating, hovering or climbing use "ground": "none" (and "loop": true for cycles, last key equals first; the STANCE above is only a starting reference). For crawling or push-ups use "ground": "body".',
  emote_loop: 'MOTION_MODE: emote / loop. "loop": true and the last key equals the first key. Natural, relaxed pose with no fighting guard.',
  action_oneshot: 'MOTION_MODE: one-shot action. "loop": false. Start and end in a natural, relaxed pose (the end returns to the start). No fighting guard.',
  combat: '',
};
export const motionBlock = category => MOTION_MODES[category] ?? '';

const bad = (status, message) => Object.assign(new Error(message), { status });

export function buildRequest({ text = '', fix = false, prev = null, style, rand = Math.random } = {}) {
  if (style !== undefined && style !== null && !isStyle(style)) throw bad(400, 'Unknown style.');
  if (prev) {
    // Revisions and fixes keep the stance the clip already has; they only change what was asked.
    const issues = (prev.anim.warnings ?? []).map(w => `- ${w.msg}`).join('\n');
    const user = fix
      ? `Fix these problems in the animation and change nothing else:\n${issues || '- (none found)'}\nCurrent animation:\n${JSON.stringify(prev.raw)}`
      : `Revise this animation. Keep what works, change only what the instruction asks.\nCurrent animation:\n${JSON.stringify(prev.raw)}\nInstruction: ${text}`;
    return { user, style: prev.style ?? null };
  }
  const chosen = pickStyle(style, text, rand);
  const mode = motionBlock(classifyMotion(text));
  return { user: `Create this animation: ${text}\n${stanceBlock(chosen)}${mode ? `\n${mode}` : ''}`, style: chosen };
}
