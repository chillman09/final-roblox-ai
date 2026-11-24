// Server-side auto-repair, run after polish() and before the clip is returned:
//   1. deterministic push-out of minor hand / forearm clipping (core/repair.js, Hand IK, no model call)
//   2. at most ONE silent model repair pass (the normal "fix" prompt with anim.warnings) if critical warnings remain
// The repaired clip is only used when it is not worse than what we had.
import { polish } from './core/polish.js';
import { pushOutInside } from './core/repair.js';

export const CRITICAL = ['ground', 'snap', 'loop', 'inside'];
export const critical = anim => (anim.warnings ?? []).filter(w => CRITICAL.includes(w.type));
const score = anim => [critical(anim).length, (anim.warnings ?? []).length];
const better = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

// ask(user) → raw JSON; buildFix(raw, anim) → the user prompt of the fix request.
export async function autoRepair({ raw, anim, ask, buildFix }) {
  const info = { pushedOut: 0, llm: false };
  let cur = { raw, anim };
  try {
    const d = pushOutInside(cur.raw, cur.anim);
    cur = { raw: d.raw, anim: d.anim };
    info.pushedOut = d.pushed;
  } catch { /* repair is best effort */ }
  if (critical(cur.anim).length && ask && buildFix) {
    try {
      info.llm = true;
      const raw2 = await ask(buildFix(cur.raw, cur.anim));
      let a2 = polish(raw2);
      const d2 = pushOutInside(raw2, a2);
      if (better(score(d2.anim), score(cur.anim))) { cur = { raw: d2.raw, anim: d2.anim }; info.pushedOut += d2.pushed; info.accepted = true; }
    } catch { /* keep what we have */ }
  }
  return { ...cur, repair: info };
}
