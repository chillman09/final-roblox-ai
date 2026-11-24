// KeyframeSequence exporters: .rbxmx (Insert from File) and a Luau snippet (Command Bar).
// Easing: Roblox's legacy "Cubic" runs reversed, so ease curves use CubicV2 (measured in Studio).
import { POSE_PARTS, RIG_R15, anglesDeg, cf, IDENTITY } from './rig.js';
import { keyTimes, sampleTrack } from './sample.js';

const EASE = { linear: ['Linear', 'In'], in: ['CubicV2', 'In'], out: ['CubicV2', 'Out'], inout: ['CubicV2', 'InOut'] };
const STYLE_TOKEN = { Linear: 0, Constant: 1, Elastic: 2, Cubic: 3, Bounce: 4, CubicV2: 5 };
const DIR_TOKEN = { In: 0, Out: 1, InOut: 2 };
const PRIORITY_ACTION = 2; // Enum.AnimationPriority.Action
const num = v => String(Math.round(v * 1e5) / 1e5);
const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// One pose tree per keyframe: keyed poses have Weight 1, their ancestors Weight 0.
// A joint that has no key at this time is sampled, so every keyframe is complete.
export function exportTree(anim, rig = RIG_R15) {
  const parent = Object.fromEntries(rig.joints.map(j => [j.part1, j.part0]));
  return keyTimes(anim).map(t => {
    const nodes = new Map();
    const node = part => {
      if (nodes.has(part)) return nodes.get(part);
      const n = { part, weight: 0, cframe: IDENTITY, style: 'Linear', dir: 'In', children: [] };
      nodes.set(part, n);
      if (parent[part]) node(parent[part]).children.push(n);
      return n;
    };
    for (const part of POSE_PARTS) {
      const tr = anim.tracks[part];
      if (!tr) continue;
      const key = tr.find(k => Math.abs(k.t - t) < 1e-6);
      const [style, dir] = EASE[(key ?? tr[Math.max(0, tr.findLastIndex(k => k.t < t))]).e] ?? EASE.inout;
      Object.assign(node(part), { weight: 1, cframe: key ? cf(key.p ?? [0, 0, 0], anglesDeg(key.r)) : sampleTrack(tr, t), style, dir });
    }
    return { t, root: nodes.get(rig.root) ?? null };
  });
}

export function toRbxmx(anim) {
  const lines = ['<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">'];
  let ref = 0;
  const pose = (n, ind) => {
    const { p, R } = n.cframe;
    lines.push(`${ind}<Item class="Pose" referent="RBX${ref++}"><Properties><string name="Name">${n.part}</string>` +
      `<CoordinateFrame name="CFrame"><X>${num(p[0])}</X><Y>${num(p[1])}</Y><Z>${num(p[2])}</Z>` +
      R.map((v, i) => `<R${Math.floor(i / 3)}${i % 3}>${num(v)}</R${Math.floor(i / 3)}${i % 3}>`).join('') + '</CoordinateFrame>' +
      `<token name="EasingDirection">${DIR_TOKEN[n.dir]}</token><token name="EasingStyle">${STYLE_TOKEN[n.style]}</token><float name="Weight">${n.weight}</float></Properties>`);
    for (const c of n.children) pose(c, ind + ' ');
    lines.push(`${ind}</Item>`);
  };
  lines.push(`<Item class="KeyframeSequence" referent="RBX${ref++}"><Properties><string name="Name">${xml(anim.name)}</string><bool name="Loop">${anim.loop}</bool><token name="Priority">${PRIORITY_ACTION}</token></Properties>`);
  for (const kf of exportTree(anim)) {
    lines.push(` <Item class="Keyframe" referent="RBX${ref++}"><Properties><string name="Name">Keyframe</string><float name="Time">${num(kf.t)}</float></Properties>`);
    if (kf.root) pose(kf.root, '  ');
    lines.push(' </Item>');
  }
  lines.push('</Item>', '</roblox>');
  return lines.join('\n');
}

// Luau for the Command Bar: builds the KeyframeSequence into the selected rig's AnimSaves folder.
export function toLuau(anim) {
  const poseLua = n => `{"${n.part}",${n.weight},{${[...n.cframe.p, ...n.cframe.R].map(num).join(',')}},"${n.style}","${n.dir}",{${n.children.map(poseLua).join(',')}}}`;
  const data = exportTree(anim).map(kf => `{${num(kf.t)},${kf.root ? poseLua(kf.root) : 'nil'}}`).join(',\n');
  const name = anim.name.replace(/[^\w ]/g, '');
  return `-- Select your R15 rig in the Explorer, then run this in the Command Bar.
local Selection = game:GetService("Selection")
local rig = Selection:Get()[1]
assert(rig and rig:FindFirstChildOfClass("Humanoid"), "Select your R15 rig first")
local DATA = {${data}}
local seq = Instance.new("KeyframeSequence")
seq.Name = "${name}"
seq.Loop = ${anim.loop}
seq.Priority = Enum.AnimationPriority.Action
local function pose(spec, parent)
	local p = Instance.new("Pose")
	p.Name = spec[1]
	p.Weight = spec[2]
	p.CFrame = CFrame.new(table.unpack(spec[3]))
	p.EasingStyle = Enum.PoseEasingStyle[spec[4]]
	p.EasingDirection = Enum.PoseEasingDirection[spec[5]]
	for _, child in spec[6] do pose(child, p) end
	p.Parent = parent
end
for _, kf in DATA do
	local k = Instance.new("Keyframe")
	k.Time = kf[1]
	if kf[2] then pose(kf[2], k) end
	k.Parent = seq
end
local folder = rig:FindFirstChild("AnimSaves") or Instance.new("Folder")
folder.Name = "AnimSaves"
folder.Parent = rig
seq.Parent = folder
Selection:Set({ seq })
`;
}
