import test from 'node:test';
import assert from 'node:assert/strict';
import { STYLES, STYLE_IDS, pickStyle, stanceBlock, isStyle, classifyMotion } from '../src/stances.js';
import { SYSTEM, EXAMPLES } from '../src/prompt.js';
import { buildRequest } from '../src/request.js';
import { polish } from '../src/core/polish.js';
import { worldAt } from '../src/core/sample.js';
import { RIG_R15, POSE_PARTS } from '../src/core/rig.js';

const JOINTS = POSE_PARTS.filter(p => p !== 'HumanoidRootPart');
const hold = pose => polish({ duration: 1, keys: [{ t: 0, pose }, { t: 1, pose }] });
const handSig = id => {
  const w = worldAt(hold(STYLES[id].stance), 0, RIG_R15), H = w.Head.p;
  return ['RightHand', 'LeftHand'].flatMap(n => w[n].p.map((v, i) => v - H[i]));
};
const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

test('every stance is a full pose and polishes with no warnings', () => {
  for (const id of STYLE_IDS) {
    const pose = STYLES[id].stance;
    assert.deepEqual(Object.keys(pose).sort(), [...JOINTS].sort(), `${id} must list all 15 joints`);
    assert.deepEqual(hold(pose).warnings, [], `${id} warnings`);
  }
});

test('stances really differ: the hands are not in the same place in every style', () => {
  const combat = ['boxing', 'karate', 'muaythai', 'brawler', 'swordsman'];
  for (let i = 0; i < STYLE_IDS.length; i++) for (let j = i + 1; j < STYLE_IDS.length; j++) {
    const [a, b] = [STYLE_IDS[i], STYLE_IDS[j]];
    const min = combat.includes(a) && combat.includes(b) ? 0.8 : 0.4;
    assert.ok(dist(handSig(a), handSig(b)) >= min, `${a} and ${b} hold their hands too similarly`);
  }
});

test('guard styles keep the hands near the face, not out at the sides', () => {
  for (const id of ['boxing', 'muaythai']) {
    const [rx, , , lx] = handSig(id);
    assert.ok(Math.abs(rx) < 1.35 && Math.abs(lx) < 1.35, `${id} hands are too wide`);
  }
});

test('the prompt does not teach one shared stance any more', () => {
  assert.doesNotMatch(SYSTEM, /Reuse the stance of the examples/i);
  assert.match(SYSTEM, /STANCE/);
  assert.match(SYSTEM, /cross the body/i);
  const firsts = Object.values(EXAMPLES).map(e => JSON.stringify(e.keys[0].pose));
  assert.equal(new Set(firsts).size, firsts.length, 'examples must start in different stances');
});

test('worked examples are valid and clean', () => {
  for (const [name, e] of Object.entries(EXAMPLES)) assert.deepEqual(polish(structuredClone(e)).warnings, [], name);
});

test('pickStyle: explicit wins, auto follows the words, and varies when it can', () => {
  assert.equal(pickStyle('karate', 'a sword slash'), 'karate');
  for (let i = 0; i < 10; i++) assert.equal(pickStyle('auto', 'heavy sword slash', () => i / 10), 'swordsman');
  assert.equal(pickStyle('auto', 'victory dance', () => 0.3), 'relaxed');
  const seen = new Set(Array.from({ length: 20 }, (_, i) => pickStyle('auto', 'punch and kick', () => i / 20)));
  assert.ok(seen.size >= 2, 'tied combat matches still vary');
  assert.equal(pickStyle('auto', 'something unusual', () => 0.3), 'relaxed', 'unmatched prompts are not fights');
  assert.equal(pickStyle('constructor', 'punch', () => 0), 'boxing', 'odd ids are ignored');
});

test('isStyle accepts known ids only', () => {
  assert.ok(isStyle('auto') && isStyle('boxing'));
  assert.ok(!isStyle('nope') && !isStyle('constructor') && !isStyle(undefined));
});

test('buildRequest: new clips get the stance, revisions and fixes keep theirs', () => {
  const made = buildRequest({ text: 'a hook', style: 'boxing' });
  assert.equal(made.style, 'boxing');
  assert.match(made.user, /^Create this animation: a hook\nSTYLE: Boxing/);
  assert.ok(made.user.includes(JSON.stringify(STYLES.boxing.stance)));
  const prev = { raw: { name: 'X' }, style: 'karate', anim: { warnings: [{ msg: 'Feet sink 0.3 studs' }] } };
  const rev = buildRequest({ text: 'faster', prev, style: 'boxing' });
  assert.equal(rev.style, 'karate');
  assert.doesNotMatch(rev.user, /STANCE/);
  assert.match(buildRequest({ fix: true, prev }).user, /Feet sink 0.3 studs/);
  assert.throws(() => buildRequest({ text: 'x', style: 'nope' }), e => e.status === 400);
  assert.match(stanceBlock('swordsman'), /Swordsman/);
  assert.equal(stanceBlock('nope'), '');
});

test('pickStyle auto: non-combat prompts get relaxed, never a random guard', () => {
  for (let i = 0; i < 10; i++) {
    assert.equal(pickStyle('auto', 'sit down on a chair', () => i / 10), 'relaxed');
    assert.equal(pickStyle('auto', 'wave hello', () => i / 10), 'relaxed');
    assert.equal(pickStyle('auto', 'kneel down', () => i / 10), 'relaxed');
  }
  assert.equal(pickStyle('boxing', 'wave hello'), 'boxing', 'an explicit combat style is still honoured');
});

test('classifyMotion sorts prompts into the six categories', () => {
  const cases = {
    transition: ['sit down on a chair', 'kneel and bow your head', 'lie down and sleep', 'death collapse', 'crouch low', 'fall down then get up'],
    non_upright: ['swim freestyle', 'fly like superman', 'float in zero gravity', 'climb a ladder', 'crawl through a tunnel', 'do pushups'],
    locomotion: ['walk cycle', 'sprint', 'sneak forward', 'limp along', 'jog in place', 'strafe left'],
    emote_loop: ['victory dance', 'idle breathing', 'cheer', 'laugh out loud', 'clap hands', 'taunt the enemy'],
    action_oneshot: ['wave hello', 'cast a spell', 'salute', 'pick up an item', 'drink a potion', 'point forward', 'something unusual'],
    combat: ['right hook punch', 'roundhouse kick', 'sword slash', 'parry and riposte', 'tackle', 'dodge the attack'],
  };
  for (const [cat, prompts] of Object.entries(cases)) for (const p of prompts) assert.equal(classifyMotion(p), cat, p);
});

test('buildRequest appends a MOTION_MODE block that fits the category', () => {
  const get = text => buildRequest({ text, rand: () => 0.3 }).user;
  assert.match(get('sit down'), /MOTION_MODE: transition[^\n]*"loop": false[^\n]*does NOT need to equal[^\n]*"ground": "body"/);
  assert.match(get('walk'), /MOTION_MODE: locomotion[^\n]*"loop": true[^\n]*last key must equal the first[^\n]*IN PLACE[^\n]*p\.z/);
  assert.match(get('swim'), /MOTION_MODE: non-upright[^\n]*"ground": "none"[^\n]*"ground": "body"/);
  assert.match(get('dance'), /MOTION_MODE: emote[^\n]*"loop": true[^\n]*no fighting guard/i);
  assert.match(get('wave'), /MOTION_MODE: one-shot[^\n]*"loop": false[^\n]*no fighting guard/i);
  assert.doesNotMatch(get('a right hook'), /MOTION_MODE/);
  assert.match(get('wave'), /STYLE: Relaxed/);
});

test('the prompt documents ground modes, general phases and the new examples', () => {
  assert.match(SYSTEM, /"ground": ?"feet" \| "body" \| "none"|"feet" \(default[\s\S]*"body"[\s\S]*"none"/);
  for (const ph of ['anticipation', 'action', 'peak', 'settle']) assert.match(SYSTEM, new RegExp(`"${ph}"`));
  assert.match(SYSTEM, /last key does NOT equal the first/);
  assert.match(SYSTEM, /IN PLACE/);
  const sit = EXAMPLES.sitDown;
  assert.equal(sit.ground, 'body');
  assert.equal(sit.loop, false);
  assert.notDeepEqual(sit.keys.at(-1).pose, sit.keys[0].pose, 'a transition ends in a new pose');
  const wave = EXAMPLES.wave;
  assert.equal(wave.loop, false);
  assert.deepEqual(['anticipation', 'action', 'peak', 'settle'].filter(p => !wave.keys.some(k => k.phase === p)), []);
  assert.ok(wave.keys.some(k => k.targets));
  for (const n of ['punch', 'roundhouse', 'backflip', 'walk', 'idle']) assert.ok(EXAMPLES[n], n);
});
