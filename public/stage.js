// 3D preview. Parts are placed from the real R15 joint offsets (core/rig.js) and the clip is
// sampled with Roblox's own blending rules (core/sample.js), so the preview is what Studio plays.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RIG_R15, POSE_PARTS, solve } from '/core/rig.js';
import { worldAt } from '/core/sample.js';

const SKIN = 0xf0c9a0, TORSO = 0x4a5a85, RIGHT = 0xf2542d, LEFT = 0x5b7bd5;
const colorOf = p => (/^Right/.test(p) ? RIGHT : /^Left/.test(p) ? LEFT : p === 'Head' ? SKIN : TORSO);

export function createStage(el) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  el.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdfe5ee);
  const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  cam.position.set(5.5, 4.5, -9);
  const controls = new OrbitControls(cam, renderer.domElement);
  controls.target.set(0, 2.6, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.update();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8896ad, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-4, 9, -6);
  scene.add(sun);
  scene.add(new THREE.GridHelper(24, 24, 0x9aa6ba, 0xc3ccda));

  const meshes = {};
  for (const part of POSE_PARTS) {
    const [sx, sy, sz] = RIG_R15.parts[part];
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: colorOf(part), roughness: 0.7, transparent: part === 'HumanoidRootPart', opacity: part === 'HumanoidRootPart' ? 0 : 1 }));
    if (part !== 'HumanoidRootPart') mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x17203a })));
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
    meshes[part] = mesh;
  }
  // soft blob under the character so you can see where the body is relative to the floor
  const blob = new THREE.Mesh(new THREE.CircleGeometry(1.3, 32), new THREE.MeshBasicMaterial({ color: 0x17203a, transparent: true, opacity: 0.12 }));
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.01;
  scene.add(blob);

  let anim = null, t = 0;
  function pose() {
    const world = anim ? worldAt(anim, t, RIG_R15) : solve({}, RIG_R15);
    for (const part of POSE_PARTS) {
      const { p, R } = world[part];
      meshes[part].matrix.set(R[0], R[1], R[2], p[0], R[3], R[4], R[5], p[1], R[6], R[7], R[8], p[2], 0, 0, 0, 1);
    }
    const root = world.LowerTorso.p;
    blob.position.x = root[0];
    blob.position.z = root[2];
    blob.scale.setScalar(Math.max(0.5, 1 - Math.max(0, Math.min(...POSE_PARTS.filter(x => /Foot/.test(x)).map(x => world[x].p[1])) - 0.2) * 0.15));
  }
  const resize = () => {
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(el);
  resize();
  renderer.setAnimationLoop(() => { controls.update(); pose(); renderer.render(scene, cam); });

  return { setAnim: a => { anim = a; }, setTime: x => { t = x; } };
}
