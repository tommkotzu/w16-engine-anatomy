import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
/*STRINGS*/

const $ = (s) => document.querySelector(s);
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (t) => t * t * (3 - 2 * t);
const mod = (a, n) => ((a % n) + n) % n;
const DEG = 180 / Math.PI;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const css = getComputedStyle(document.documentElement);
const tok = (n) => new THREE.Color(css.getPropertyValue(n).trim());
const COL = { intake: tok('--intake'), compress: tok('--compress'), power: tok('--power'), exhaust: tok('--exhaust'), ghost: tok('--ghost') };
const STROKES = ['intake', 'compress', 'power', 'exhaust'].map((key) => ({
  key, c: `--${key}`, get name() { return tr(`stroke.${key}`); }, get text() { return tr(`stroke.${key}.t`); },
}));

// ------------------------------------------------------------------ loader UI
const loadBar = $('#loadBar'), loadMsg = $('#loadMsg');
const setLoad = (f, msg) => { loadBar.style.width = `${Math.round(f * 100)}%`; if (msg) loadMsg.textContent = msg; };

// ------------------------------------------------------------------ renderer / scene
const canvas = $('#stage');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  loadMsg.textContent = tr('load.nogl');
  throw e;
}
let pixelRatio = Math.min(devicePixelRatio, coarse ? 1.5 : 1.75);
renderer.setPixelRatio(pixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMappingExposure = 1.12;

// lens + image settings, remembered per browser
const LENS_DEFAULTS = { focal: 45, dof: false, fstop: 2, maxblur: 0.012, exposure: 1.12, bloom: 0.42, ao: 0.95, vignette: 0.3, ca: 0.1, grain: 0 };
const FSTOPS = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16];
const lens = { ...LENS_DEFAULTS };
try { Object.assign(lens, JSON.parse(localStorage.getItem('w16-lens') || '{}')); } catch (e) { /* storage unavailable */ }
const scene = new THREE.Scene();
scene.background = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(256, 210, 10, 256, 256, 380);
  grd.addColorStop(0, '#1d262d'); grd.addColorStop(0.55, '#10161b'); grd.addColorStop(1, '#06080a');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();

const camera = new THREE.PerspectiveCamera(30, 1, 0.02, 40);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minDistance = 0.3; controls.maxDistance = 5; controls.maxPolarAngle = Math.PI * 0.6;
controls.zoomSpeed = 0.8; controls.rotateSpeed = 0.7;

const pmrem = new THREE.PMREMGenerator(renderer);
// dark studio: black box with a few softbox panels, so metals read as metal (not chrome)
function studioEnvironment() {
  const s = new THREE.Scene();
  // graded studio sweep with a bright horizon line: gives round steel parts a long, smooth highlight
  s.add(new THREE.Mesh(new THREE.SphereGeometry(9, 64, 32), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vD; void main(){ float h = vD.y;
      vec3 c = mix(vec3(0.008, 0.009, 0.010), vec3(0.11, 0.115, 0.12), smoothstep(-0.4, 0.0, h));
      c = mix(c, vec3(0.03, 0.034, 0.04), smoothstep(0.03, 0.75, h));
      c += vec3(0.95, 0.97, 1.0) * exp(-pow((h - 0.07) / 0.02, 2.0)) * 1.1;
      c += vec3(1.0, 0.93, 0.85) * exp(-pow((h + 0.08) / 0.05, 2.0)) * 0.12;
      gl_FragColor = vec4(c, 1.0); }`,
  })));
  const panel = (w, h, pos, color, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); s.add(m);
  };
  panel(7, 2.4, [0, 5.4, 0.4], 0xffffff, 2.3);      // overhead softbox
  panel(1.4, 6, [-5.4, 1.2, 2.2], 0xfff1e2, 2.4);   // warm key strip
  panel(1.4, 6, [5.4, 1.0, -2.0], 0xcfe2ff, 1.8);   // cool rim strip
  panel(5, 1.2, [0.5, 1.4, -5.6], 0xffffff, 0.9);   // back kicker
  panel(0.5, 7, [-3.6, 2.4, -3.6], 0xffffff, 2.2);   // thin strip: crisp highlight line on shafts
  panel(10, 10, [0, -5.8, 0], 0x1a1e22, 1.0);       // floor bounce
  return pmrem.fromScene(s, 0.015).texture;
}
scene.environment = studioEnvironment();
scene.environmentIntensity = 1.35;
const key = new THREE.DirectionalLight(0xfff0dd, 1.6); key.position.set(-2.5, 3.5, 2.2); scene.add(key);
const rim = new THREE.DirectionalLight(0x9fc6ff, 1.3); rim.position.set(2.5, 1.2, -3); scene.add(rim);
const fill = new THREE.HemisphereLight(0xbfd3e6, 0x1a1410, 0.35); scene.add(fill);

const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
// Depth-based passes render the scene with an override material. Hide what must not count as a surface
// there (X-ray shells, gas, flow, lines) and the texture background, whose quad would become a real plane.
function isolateSolids(scene) {
  const hidden = [];
  scene.traverse((o) => {
    if (!o.visible) return;
    const m = o.material;
    if (o.isPoints || o.isLine || o.isSprite || (o.isMesh && m && (m.transparent || m.colorWrite === false))) { o.visible = false; hidden.push(o); }
  });
  const bg = scene.background; scene.background = null;
  return () => { for (const o of hidden) o.visible = true; scene.background = bg; };
}
// ambient occlusion: contact darkening between parts. X-ray shells, gas and flow (all transparent) are left out of it.
const gtao = new GTAOPass(scene, camera, 1, 1);
gtao.output = GTAOPass.OUTPUT.Default;
gtao.blendIntensity = 0.95;
gtao.updateGtaoMaterial({ radius: 0.055, distanceExponent: 1.5, thickness: 1.6, scale: 1.25, samples: 16 });
gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
{
  const base = gtao.overrideVisibility.bind(gtao), restore = gtao.restoreVisibility.bind(gtao);
  let undo = null;
  gtao.overrideVisibility = function () { base(); undo = isolateSolids(this.scene); };
  gtao.restoreVisibility = function () { undo?.(); restore(); };
}
gtao.enabled = !coarse;
composer.addPass(gtao);
// depth of field (focus distance is set every frame from the orbit target or the selected part)
const bokeh = new BokehPass(scene, camera, { focus: 1.5, aperture: 0.04, maxblur: 0.01 });
{
  const render = bokeh.render.bind(bokeh);
  bokeh.render = (...args) => { const undo = isolateSolids(scene); try { render(...args); } finally { undo(); } };
}
bokeh.enabled = false;
composer.addPass(bokeh);
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.4, 1.7);
composer.addPass(bloom);
composer.addPass(new OutputPass());
// lens: chromatic aberration, vignette and grain on the display-ready image
const lensPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, vignette: { value: 0.3 }, ca: { value: 0.1 }, grain: { value: 0 }, time: { value: 0 }, res: { value: new THREE.Vector2(1, 1) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float vignette, ca, grain, time; uniform vec2 res; varying vec2 vUv;
    void main(){
      vec2 d = vUv - 0.5; float r2 = dot(d, d);
      vec2 off = d * ca * 0.05 * r2;
      vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float v = smoothstep(0.95, 0.25, length(d * vec2(res.x / res.y, 1.0)));
      c *= mix(1.0, v, vignette);
      float n = fract(sin(dot(floor(vUv * res) + fract(time) * 97.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      c += n * grain * 0.09;
      gl_FragColor = vec4(c, 1.0);
    }`,
});
composer.addPass(lensPass);
bloom.enabled = !coarse;

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  composer.setPixelRatio(pixelRatio); composer.setSize(w, h);
  camera.aspect = w / h;
  // focal length on a full-frame (24 mm tall) sensor; narrow screens get a wider lens so the engine still fits
  const f = lens.focal * (w / h < 0.8 ? 0.66 : 1);
  camera.fov = 2 * Math.atan(12 / f) * DEG;
  lensPass.uniforms.res.value.set(w, h);
  // keep the engine centred in the free space to the right of the chapter sheet
  const panel = document.getElementById('panel');
  const shift = w > 760 && panel ? Math.min(w * 0.22, (panel.getBoundingClientRect().right + 16) / 2) : 0;
  if (shift) camera.setViewOffset(w, h, -shift, 0, w, h); else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);

// ------------------------------------------------------------------ load model + rig
setLoad(0.03, tr('load.rig'));
const rig = await (await fetch('rig.json')).json();
// the model ships as base64 text (the artifact host serves only standard web file types)
async function fetchModel(url, expected, from, span) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const total = +res.headers.get('content-length') || expected;
  const reader = res.body.getReader(); const chunks = []; let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    setLoad(from + span * Math.min(1, got / total), tr('load.model'));
  }
  const text = new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
  const bin = atob(text.trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
async function loadModel() {
  try {
    await MeshoptDecoder.ready;
    const l = new GLTFLoader(); l.setMeshoptDecoder(MeshoptDecoder);
    return await l.parseAsync(await fetchModel('engine.b64.txt', 4.9e6, 0.05, 0.85), '');
  } catch (err) {
    console.warn('Compressed model unavailable, loading uncompressed fallback.', err);
    return await new GLTFLoader().parseAsync(await fetchModel('engine_q.b64.txt', 11.1e6, 0.05, 0.85), '');
  }
}
const gltf = await loadModel();
setLoad(0.93, tr('load.mat'));
const model = gltf.scene;
scene.add(model);

// ------------------------------------------------------------------ parts
const san = THREE.PropertyBinding.sanitizeNodeName;
const parts = [];
const byName = new Map();
model.updateMatrixWorld(true);
for (const node of model.children) {
  const p = { node, name: node.name, group: node.userData.group || 'misc', side: node.userData.side || null, meshes: [],
    rest: node.matrix.clone(), G: new THREE.Matrix4(), off: new THREE.Vector3(), explodeDir: new THREE.Vector3(),
    mode: 'solid', fade: false, kind: 'static' };
  node.traverse((o) => {
    o.updateMatrix(); o.matrixAutoUpdate = false;
    if (o.isMesh) { p.meshes.push(o); o.userData.part = p; o.userData.baseMat = o.material; }
  });
  const box = new THREE.Box3().setFromObject(node);
  p.center0 = box.getCenter(new THREE.Vector3());
  p.box0 = box;
  parts.push(p);
  byName.set(node.name, p);
}
const part = (n) => byName.get(san(n));
const bounds = new THREE.Box3().setFromObject(model);
const center = bounds.getCenter(new THREE.Vector3());
key.castShadow = true;
key.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
key.shadow.bias = -0.0003; key.shadow.normalBias = 0.0025; key.shadow.intensity = 0.85;
Object.assign(key.shadow.camera, { left: -0.85, right: 0.85, top: 0.85, bottom: -0.85, near: 0.3, far: 6 });
key.shadow.camera.updateProjectionMatrix();
key.target.position.copy(center); scene.add(key.target);
key.position.copy(center).add(new THREE.Vector3(-2.5, 3.5, 2.2).normalize().multiplyScalar(3));

// metal finishes: base values + procedural surface detail (roughness/tint noise in the part's own
// frame so it stays glued to moving parts) and geometric specular anti-aliasing for polished edges
const SURFACE = {
  'Steel polished':     { color: [0.56, 0.57, 0.6], rough: 0.17, amp: 0.5, scale: 170, tint: 0.06, env: 1.25 },
  'Steel forged':       { color: [0.42, 0.425, 0.44], rough: 0.32, amp: 0.65, scale: 95, tint: 0.1, env: 1.15 },
  'Valve steel':        { color: [0.52, 0.48, 0.43], rough: 0.22, amp: 0.45, scale: 210, tint: 0.06, env: 1.2 },
  'Bearing steel':      { color: [0.62, 0.625, 0.64], rough: 0.12, amp: 0.3, scale: 210, tint: 0.03, env: 1.3 },
  'Steel black oxide':  { rough: 0.36, amp: 0.5, scale: 130, tint: 0.12, env: 1.25 },
  'Aluminium machined': { color: [0.72, 0.73, 0.74], rough: 0.26, amp: 0.4, scale: 150, tint: 0.04, env: 1.2 },
  'Aluminium cast':     { color: [0.60, 0.61, 0.62], rough: 0.5, amp: 0.6, scale: 55, tint: 0.11, env: 1.15 },
  'Cast iron':          { rough: 0.62, amp: 0.6, scale: 70, tint: 0.14, env: 1.05 },
  'Titanium heat':      { amp: 0.4, scale: 80, tint: 0.12, env: 1.3 },
  'Exhaust inconel':    { amp: 0.45, scale: 80, tint: 0.14, env: 1.25 },
  'Anodised red':       { amp: 0.35, scale: 150, tint: 0.05, env: 1.3 },
};
function surfaceDetail(s) {
  const u = new THREE.Vector4(s.scale, 0, s.amp, s.tint);
  return (sh) => {
    sh.uniforms.uSurf = { value: u };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position * length(modelMatrix[0].xyz);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec4 uSurf; varying vec3 vObj;
        float sHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float sNoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(sHash(i), sHash(i + vec3(1,0,0)), f.x), mix(sHash(i + vec3(0,1,0)), sHash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(sHash(i + vec3(0,0,1)), sHash(i + vec3(1,0,1)), f.x), mix(sHash(i + vec3(0,1,1)), sHash(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 sp = vObj * uSurf.x;
        float sN = sNoise(sp) * 0.55 + sNoise(sp * 2.9 + 7.1) * 0.3 + sNoise(sp * 0.27 + 3.3) * 0.15;
        diffuseColor.rgb *= 1.0 + (sN - 0.5) * uSurf.w;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * (1.0 + (sN - 0.5) * uSurf.z), 0.05, 1.0);
        vec3 sDn = fwidth(normalize(vNormal));
        roughnessFactor = max(roughnessFactor, min(0.45, length(sDn) * 0.75));`);
  };
}

// subtle material tuning on top of the exported PBR values
const seenMat = new Set();
model.traverse((o) => {
  if (!o.isMesh || seenMat.has(o.material)) return;
  seenMat.add(o.material);
  const m = o.material;
  m.envMapIntensity = 1;
  if (/Cover|Carbon/.test(m.name)) { m.clearcoat = 1; m.clearcoatRoughness = 0.12; }
  const s = SURFACE[m.name];
  if (s) {
    if (s.color) m.color.setRGB(...s.color);
    if (s.rough !== undefined) m.roughness = s.rough;
    m.envMapIntensity = s.env ?? 1.2;
    m.onBeforeCompile = surfaceDetail(s);
  }
});

// ------------------------------------------------------------------ kinematics setup
const X = new THREE.Vector3(1, 0, 0);
const crank = part(rig.crank.name); crank.kind = 'crank';
const pivot = V(rig.crank.pivot);
const L = rig.crank.rodLength;
const ang = (v) => Math.atan2(v.z, v.y);

const cyls = rig.cylinders.map((c) => {
  const P0 = V(c.pin), C0 = V(c.bigEnd), d = V(c.bore).normalize();
  return { ...c, P0, C0, d, r0: ang(new THREE.Vector3().subVectors(P0, C0)), piston: part(c.piston), rod: part(c.rod),
    P: P0.clone(), C: C0.clone(), s: 0, phase: 0, off: 0, valves: [] };
});
cyls.forEach((c) => { c.piston.kind = 'piston'; c.rod.kind = 'rod'; c.piston.cyl = c; c.rod.cyl = c; });

const _w = new THREE.Vector3();
function crankPin(c, th, out) {
  const cy = c.C0.y - pivot.y, cz = c.C0.z - pivot.z, co = Math.cos(th), si = Math.sin(th);
  return out.set(c.C0.x, pivot.y + cy * co - cz * si, pivot.z + cy * si + cz * co);
}
function pistonTravel(c, C) {
  _w.subVectors(c.P0, C);
  const b = _w.dot(c.d);
  return -b + Math.sqrt(Math.max(0, b * b - (_w.lengthSq() - L * L)));
}
// top dead centre of every cylinder, stroke, and a 4-stroke phase offset
const tmpC = new THREE.Vector3();
for (const c of cyls) {
  let best = -1e9, bestTh = 0, worst = 1e9;
  for (let i = 0; i < 1440; i++) {
    const th = (i / 1440) * Math.PI * 2;
    const s = pistonTravel(c, crankPin(c, th, tmpC));
    if (s > best) { best = s; bestTh = th; }
    if (s < worst) worst = s;
  }
  c.tdc = bestTh; c.sMax = best; c.sMin = worst; c.stroke = best - worst;
}
// numbering: banks A-D (left outer, left inner, right inner, right outer), front (timing belt, -X) to back
const bankName = ['A', 'B', 'C', 'D'];
cyls.sort((a, b) => a.bank - b.bank || a.x - b.x).forEach((c, i) => { c.n = i + 1; });
// alternate 0/360° offsets in TDC order so power strokes spread over both revolutions
[...cyls].sort((a, b) => a.tdc - b.tdc).forEach((c, i) => { c.off = (i % 2) * 360; });
const fireAt = (c) => mod((360 - c.off) + c.tdc * DEG, 720);
const firingOrder = [...cyls].sort((a, b) => fireAt(a) - fireAt(b));
const focusCyl = cyls[0];

// valves + rockers
const IV = { open: 700, dur: 250, lift: 0.0095 }, EV = { open: 490, dur: 250, lift: 0.0085 };
const liftAt = (ph, v) => { const t = mod(ph - v.open, 720) / v.dur; return t < 1 ? Math.sin(Math.PI * t) ** 2 : 0; };
const valves = rig.valves.map((v) => {
  const p = part(v.name); p.kind = 'valve';
  const c = cyls.find((k) => k.piston.name === san(rig.cylinders[v.cyl].piston));
  const rec = { p, cyl: c, type: v.type, dir: V(v.open).normalize(), prof: v.type === 'intake' ? IV : EV, lift: 0 };
  p.valve = rec; p.cyl = c; c.valves.push(rec);
  return rec;
});
const rockers = rig.rockers.map((r) => {
  const p = part(r.name); p.kind = 'rocker';
  const v = valves.find((q) => q.p.name === san(r.valve));
  p.cyl = v.cyl;
  return { p, v, pivot: V(r.pivot), lever: r.lever, sign: r.sign };
});
const cams = rig.cams.map((c) => { const p = part(c.name); p.kind = 'cam'; return { p, pivot: V(c.pivot) }; });
const balance = { p: part(rig.balance.name), pivot: V(rig.balance.pivot) }; balance.p.kind = 'shaft';
const rollers = rig.rollers.map((r) => ({ p: part(r.name), pivot: V(r.pivot) }));
const turbos = rig.turbos.map((t) => { const p = part(t.name); p.kind = 'rotor'; return { p, pivot: V(t.pivot), axis: V(t.axis).normalize() }; });
// each cylinder: the valve on the inboard side of the bore (towards the plenum) is the intake
for (const c of cyls) {
  const nIn = new THREE.Vector3(0, Math.abs(c.d.z), -Math.sign(c.d.z) * c.d.y);
  const deck = c.P0.clone().addScaledVector(c.d, c.sMax + c.crown);
  const side = (v) => _w.copy(v.p.center0).sub(deck).dot(nIn);
  c.valves.sort((m, n) => side(n) - side(m));
  c.valves.forEach((v, i) => { v.type = i === 0 ? 'intake' : 'exhaust'; v.prof = i === 0 ? IV : EV; });
}
// each camshaft works one row of four cylinders (outer cam: banks A/D, inner cam: banks B/C)
cams.forEach((c) => { c.row = Math.abs(c.pivot.z) > 0.28 ? 'outer' : 'inner'; c.p.camRow = c.row; });

// ------------------------------------------------------------------ rigid-motion helpers
const _v = new THREE.Vector3(), _m = new THREE.Matrix4();
function rotAbout(out, p, axis, a) {
  out.makeRotationAxis(axis, a);
  _v.copy(p).applyMatrix4(out);
  return out.setPosition(p.x - _v.x, p.y - _v.y, p.z - _v.z);
}
const translate = (out, v) => out.makeTranslation(v.x, v.y, v.z);

// ------------------------------------------------------------------ explode directions (L side = +Z)
const sideSign = (p) => {
  if (p.side === 'L') return 1; if (p.side === 'R') return -1;
  if (p.cyl) return p.cyl.side === 'L' ? 1 : -1;
  if (p.kind === 'cam' || p.kind === 'rotor') return Math.sign(p.center0.z) || 0;
  return Math.sign(p.center0.z);
};
const EXPLODE = {
  covers: [0, 0.30, 0.10], ignition: [0, 0.42, 0.13], heads: [0, 0.13, 0.17], valvetrain: [0, 0.13, 0.17],
  valves: [0, 0.13, 0.17], exhaust: [0, -0.02, 0.33], turbo: [0, -0.06, 0.46], intake: [0, 0.24, 0.30],
  timing: [-0.30, 0, 0], mainbearings: [0, -0.17, 0],
};
for (const p of parts) {
  const e = EXPLODE[p.group];
  if (!e) continue;
  const s = sideSign(p);
  if (p.group === 'intake' && p.side === 'C') p.explodeDir.set(0, 0.42, 0);
  else p.explodeDir.set(e[0], e[1], e[2] * s);
  if (p.group === 'hardware') p.fade = true;
}
parts.filter((p) => p.group === 'hardware').forEach((p) => { p.fade = true; });

// ------------------------------------------------------------------ materials: ghost / tint / hover
const ghostMat = new THREE.ShaderMaterial({
  uniforms: { color: { value: COL.ghost }, opacity: { value: 1 } },
  vertexShader: `varying vec3 vN; varying vec3 vV;
    void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform vec3 color; uniform float opacity; varying vec3 vN; varying vec3 vV;
    void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0);
      gl_FragColor = vec4(color * (0.004 + f * 0.16) * opacity, 1.0); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
});
const matCache = new Map();
function variant(base, kind, color, strength) {
  const k = `${base.uuid}|${kind}|${color ? color.getHexString() : ''}|${strength}`;
  let m = matCache.get(k);
  if (!m) {
    m = base.clone(); m.onBeforeCompile = base.onBeforeCompile;
    if (color) { m.emissive = color.clone(); m.emissiveIntensity = strength; }
    matCache.set(k, m);
  }
  return m;
}
// per-valve materials so lift can drive the glow
for (const v of valves) {
  v.mat = v.p.meshes[0].userData.baseMat.clone(); v.mat.onBeforeCompile = v.p.meshes[0].userData.baseMat.onBeforeCompile;
  v.mat.emissive = (v.type === 'intake' ? COL.intake : COL.exhaust).clone();
  v.mat.emissiveIntensity = 0;
}

// ------------------------------------------------------------------ gas columns + spark
const gasGeo = new THREE.CylinderGeometry(1, 1, 1, 40, 1, false);
const gasMatProto = new THREE.ShaderMaterial({
  uniforms: { color: { value: new THREE.Color() }, intensity: { value: 0 } },
  vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY;
    void main(){ vY = position.y + 0.5; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
  fragmentShader: `uniform vec3 color; uniform float intensity; varying vec3 vN; varying vec3 vV; varying float vY;
    void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.6);
      float a = (0.25 + 0.75 * f) * (0.55 + 0.45 * vY);
      gl_FragColor = vec4(color * intensity * a, 1.0); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
});
const sparkTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,230,170,0.8)'); r.addColorStop(1, 'rgba(255,170,60,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
})();
const _up = new THREE.Vector3(0, 1, 0);
for (const c of cyls) {
  c.gas = new THREE.Mesh(gasGeo, gasMatProto.clone());
  c.gas.quaternion.setFromUnitVectors(_up, c.d);
  c.gas.renderOrder = 5; c.gas.visible = false; c.gas.frustumCulled = false;
  scene.add(c.gas);
  c.spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  c.spark.scale.setScalar(0.05); c.spark.visible = false; c.spark.renderOrder = 6;
  scene.add(c.spark);
  c.deck = c.P0.clone().addScaledVector(c.d, c.sMax + c.crown + 0.004);
}
function gasStyle(ph, out) {
  // returns intensity; writes colour
  if (ph < 180) { out.copy(COL.intake); return 0.35 + 0.35 * (ph / 180); }
  if (ph < 360) { const t = (ph - 180) / 180; out.copy(COL.intake).lerp(COL.compress, t); return 0.7 + 1.1 * t * t; }
  if (ph < 540) {
    const t = (ph - 360) / 180;
    out.setRGB(1, 0.95, 0.8).lerp(COL.power, Math.min(1, t * 3)).lerp(COL.exhaust, clamp((t - 0.35) / 0.65, 0, 1));
    return 0.6 + 4.4 * Math.exp(-t * 4.5);
  }
  const t = (ph - 540) / 180; out.copy(COL.exhaust).multiplyScalar(0.8); return 0.55 * (1 - t) + 0.08;
}

// ------------------------------------------------------------------ floor: blueprint grid + contact shadow
{
  const fy = bounds.min.y - 0.004;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.ShaderMaterial({
    uniforms: { c: { value: new THREE.Vector2(center.x, center.z) }, line: { value: new THREE.Color('#5c7486') } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec2 c; uniform vec3 line; varying vec3 vW;
      float grid(vec2 p, float s){ vec2 g = abs(fract(p * s - 0.5) - 0.5) / fwidth(p * s); return 1.0 - min(min(g.x, g.y), 1.0); }
      void main(){ vec2 p = vW.xz; float r = length(p - c);
        float fade = smoothstep(2.4, 0.2, r);
        float l = max(grid(p, 10.0) * 0.35, grid(p, 2.0) * 0.8) * fade;
        float sh = smoothstep(1.0, 0.0, length((p - c) / vec2(0.62, 0.55)));
        vec3 col = line * l;
        gl_FragColor = vec4(col, clamp(l * 0.35 + sh * 0.65, 0.0, 1.0)); }`,
    transparent: true, depthWrite: false,
  }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = fy; floor.renderOrder = -1;
  scene.add(floor);
}

// ------------------------------------------------------------------ air & exhaust flow
const flow = (() => {
  const group = new THREE.Group(); group.visible = false; scene.add(group);
  const paths = [];
  const add = (pts, type, w = 1) => paths.push({ curve: new THREE.CatmullRomCurve3(pts.map(V), false, 'centripetal'), type, w });
  for (const s of [1, -1]) {
    const tz = (z) => z * s;
    // fresh air: filter -> outer charge pipe -> compressors -> plenum
    for (const tx of [-0.382, -0.218]) {
      add([[-0.06, 0.47, tz(0.27)], [-0.32, 0.48, tz(0.27)], [-0.56, 0.44, tz(0.36)], [-0.5, 0.2, tz(0.47)], [tx - 0.04, -0.02, tz(0.47)], [tx, -0.06, tz(0.42)],
        [tx + 0.02, 0.05, tz(0.33)], [-0.3, 0.34, tz(0.16)], [-0.33, 0.43, tz(0.03)]], 'intake', 1.4);
    }
    // plenum -> each cylinder's intake port
    for (const c of cyls.filter((k) => (k.side === 'L') === (s > 0))) {
      add([[c.x * 0.6 - 0.13, 0.43, tz(0.02)], [c.x, 0.38, tz(0.07)], [c.x, c.deck.y + 0.05, c.deck.z * 0.7], [c.deck.x, c.deck.y, c.deck.z]], 'intake', 0.6);
      // exhaust: port -> manifold -> nearest turbine -> out
      const tx = c.x < -0.3 ? -0.382 : -0.218;
      add([[c.deck.x, c.deck.y, c.deck.z], [c.x, c.deck.y - 0.02, tz(0.3)], [c.x, 0.08, tz(0.37)], [(c.x + tx) / 2, -0.02, tz(0.38)], [tx, -0.06, tz(0.36)],
        [tx + 0.03, -0.12, tz(0.38)], [tx + 0.06, -0.2, tz(0.43)]], 'exhaust', 0.6);
    }
  }
  const N = 1400;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const st = [];
  const wsum = paths.reduce((a, p) => a + p.w, 0);
  for (let i = 0; i < N; i++) {
    let r = Math.random() * wsum, k = 0;
    while (r > paths[k].w && k < paths.length - 1) { r -= paths[k].w; k++; }
    st.push({ k, u: Math.random(), sp: 0.7 + Math.random() * 0.6, j: new THREE.Vector3().randomDirection().multiplyScalar(0.006 + Math.random() * 0.01) });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { size: { value: 13 * pixelRatio } },
    vertexShader: `attribute vec3 color; varying vec3 vC; uniform float size;
      void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vC * a * 2.2, 1.0); }`,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 7; group.add(pts);
  const lut = paths.map((p) => p.curve.getSpacedPoints(160));
  const lens = paths.map((p) => p.curve.getLength());
  const tmp = new THREE.Color();
  return {
    group,
    update(dt, rate) {
      if (!group.visible) return;
      for (let i = 0; i < N; i++) {
        const s = st[i], P = lut[s.k];
        s.u += (dt * rate * s.sp * 0.22) / lens[s.k];
        if (s.u > 1) s.u -= 1;
        const f = s.u * (P.length - 1), a = Math.floor(f), b = Math.min(P.length - 1, a + 1), t = f - a;
        pos[i * 3] = P[a].x + (P[b].x - P[a].x) * t + s.j.x;
        pos[i * 3 + 1] = P[a].y + (P[b].y - P[a].y) * t + s.j.y;
        pos[i * 3 + 2] = P[a].z + (P[b].z - P[a].z) * t + s.j.z;
        if (paths[s.k].type === 'intake') tmp.copy(COL.intake).multiplyScalar(0.55 + 0.45 * s.u);
        else tmp.setRGB(1, 0.85, 0.55).lerp(COL.exhaust, Math.min(1, s.u * 1.4)).multiplyScalar(1 - 0.45 * s.u);
        col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
    },
  };
})();

// ------------------------------------------------------------------ guide lines (crank chapter)
const guides = (() => {
  const g = new THREE.Group(); g.visible = false; scene.add(g);
  const c = focusCyl;
  const r = c.C0.clone().sub(pivot); r.x = 0; const R = r.length();
  const circ = [];
  for (let i = 0; i <= 96; i++) { const a = (i / 96) * Math.PI * 2; circ.push(new THREE.Vector3(c.C0.x - 0.03, pivot.y + Math.cos(a) * R, pivot.z + Math.sin(a) * R)); }
  const lm = new THREE.LineBasicMaterial({ color: COL.power, transparent: true, opacity: 0.9, depthTest: false });
  const circle = new THREE.Line(new THREE.BufferGeometry().setFromPoints(circ), lm); circle.renderOrder = 8; g.add(circle);
  const a = c.P0.clone().addScaledVector(c.d, c.sMin).addScaledVector(X, -0.03), b = c.P0.clone().addScaledVector(c.d, c.sMax).addScaledVector(X, -0.03);
  const stroke = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: COL.intake, depthTest: false }));
  stroke.renderOrder = 8; g.add(stroke);
  const tick = (p) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 12, 8), new THREE.MeshBasicMaterial({ color: COL.intake, depthTest: false })); m.position.copy(p); m.renderOrder = 8; g.add(m); };
  tick(a); tick(b);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.005, 16, 10), new THREE.MeshBasicMaterial({ color: COL.power, depthTest: false })); dot.renderOrder = 9; g.add(dot);
  return { g, update() { if (g.visible) dot.position.copy(c.C).addScaledVector(X, -0.03); } };
})();

// ------------------------------------------------------------------ chapters
const HOUSINGS = new Set(['block', 'mainbearings', 'heads', 'covers', 'intake', 'exhaust', 'hardware', 'ignition']);
const bankCol = [new THREE.Color('#8fcaff'), new THREE.Color('#4a86c8'), new THREE.Color('#ffd08a'), new THREE.Color('#c98a4a')];
const isTurboHousing = (p) => p.group === 'turbo' && p.kind !== 'rotor';
const valveSpec = (c) => {
  const iv = c.valves.find((v) => v.type === 'intake'), ev = c.valves.find((v) => v.type === 'exhaust');
  return { iv, ev };
};
const anchors = {
  crankPin: () => focusCyl.C,
  piston: () => _a.copy(focusCyl.P).addScaledVector(focusCyl.d, focusCyl.crown * 0.4),
  rod: () => _a.lerpVectors(focusCyl.P, focusCyl.C, 0.5),
  chamber: () => _a.copy(focusCyl.deck).addScaledVector(focusCyl.d, -0.012),
  ivalve: () => partCenter(valveSpec(focusCyl).iv.p),
  evalve: () => partCenter(valveSpec(focusCyl).ev.p),
  coil: () => _a.copy(focusCyl.deck).addScaledVector(focusCyl.d, 0.09),
};
const _a = new THREE.Vector3();
const _pc = new THREE.Vector3();
function partCenter(p) { return _pc.copy(p.center0).applyMatrix4(p.cur || p.G); }

const CH = [
  {
    get key() { return tr('ch0.key'); }, get title() { return tr('ch0.title'); }, get body() { return tr('ch0.body'); },
    widget: 'layout', xray: true, ghostExtra: ['timing'], gas: 'firing', cam: { pos: [-1.95, 0.62, 0.62], target: [-0.34, 0.12, 0] },
    look: (p) => p.kind === 'piston' ? ['tint', bankCol[p.cyl.bank], 0.55] : null,
    callouts: () => [0, 1, 2, 3].map((b) => {
      const c = cyls.filter((k) => k.bank === b).sort((m, n) => m.x - n.x)[0];
      return { label: tr('co.bank', bankName[b]), color: '#' + bankCol[b].getHexString(), at: () => _a.copy(c.deck).addScaledVector(c.d, 0.03), part: c.piston };
    }).concat([{ label: tr('co.crank'), at: () => _a.set(-0.66, pivot.y, pivot.z), part: crank }]),
  },
  {
    get key() { return tr('ch1.key'); }, get title() { return tr('ch1.title'); }, get body() { return tr('ch1.body'); },
    widget: 'strokes', xray: true, ghostExtra: ['timing', 'valvetrain'], gas: 'focus',
    cam: () => ({ pos: _a.copy(focusCyl.deck).add(new THREE.Vector3(-1.05, 0.22, 0.42)).toArray(), target: focusCyl.P0.clone().addScaledVector(focusCyl.d, -0.02).toArray() }),
    look: (p) => {
      if (p.cyl === focusCyl && (p.kind === 'piston' || p.kind === 'rod' || p.kind === 'valve' || p.kind === 'rocker')) return ['focus'];
      if (p.kind === 'piston' || p.kind === 'rod' || p.kind === 'valve' || p.kind === 'rocker') return ['dim'];
      return null;
    },
    callouts: () => [
      { label: tr('co.iv'), color: 'var(--intake)', at: anchors.ivalve, part: valveSpec(focusCyl).iv.p },
      { label: tr('co.ev'), color: 'var(--exhaust)', at: anchors.evalve, part: valveSpec(focusCyl).ev.p },
      { label: tr('co.chamber'), color: 'var(--power)', at: anchors.chamber },
      { label: tr('co.piston'), at: anchors.piston, part: focusCyl.piston },
    ],
  },
  {
    get key() { return tr('ch2.key'); }, get title() { return tr('ch2.title'); }, get body() { return tr('ch2.body'); },
    widget: 'crank', xray: true, ghostExtra: ['timing', 'valvetrain'], guides: true,
    cam: { pos: [-1.5, 0.34, 1.12], target: [-0.36, 0.04, 0] },
    look: (p) => {
      if (p.kind === 'crank' || p.kind === 'rod') return ['focus'];
      if (p.kind === 'piston') return p.cyl === focusCyl ? ['focus'] : ['solid'];
      if (p.group === 'mainbearings') return ['solid'];
      if (p.kind === 'valve' || p.kind === 'rocker' || p.kind === 'cam' || isTurboHousing(p) || p.kind === 'rotor') return ['ghost'];
      return null;
    },
    callouts: () => [
      { label: tr('co.piston'), at: anchors.piston, part: focusCyl.piston },
      { label: tr('co.rod'), at: anchors.rod, part: focusCyl.rod },
      { label: tr('co.pin'), color: 'var(--power)', at: anchors.crankPin, part: crank },
      { label: tr('co.mains'), at: () => _a.set(-0.26, -0.07, 0.05), part: parts.find((p) => p.group === 'mainbearings') },
      { label: tr('co.pulley'), at: () => _a.set(-0.67, pivot.y + 0.075, 0), part: crank },
    ],
  },
  {
    get key() { return tr('ch3.key'); }, get title() { return tr('ch3.title'); }, get body() { return tr('ch3.body'); },
    widget: 'valves', xray: true, ghostExtra: [], gas: 'focus',
    cam: { pos: [-1.3, 0.95, 1.12], target: [-0.34, 0.2, 0.2] },
    look: (p) => {
      if (p.kind === 'valve') return ['valve'];
      if (p.kind === 'cam' || p.kind === 'rocker' || p.group === 'timing' || p.kind === 'shaft') return ['focus'];
      if (p.kind === 'piston' || p.kind === 'rod') return ['dim'];
      if (p.group === 'valvetrain') return ['solid'];
      return null;
    },
    callouts: () => {
      const L = cams.filter((c) => c.pivot.z > 0);
      const inner = L.find((c) => c.row === 'inner'), outer = L.find((c) => c.row === 'outer');
      return [
        { label: tr('co.camIn'), at: () => _a.set(-0.12, inner.pivot.y + 0.03, inner.pivot.z), part: inner.p },
        { label: tr('co.camOut'), at: () => _a.set(-0.12, outer.pivot.y + 0.02, outer.pivot.z + 0.02), part: outer.p },
        { label: tr('co.iv'), color: 'var(--intake)', at: anchors.ivalve, part: valveSpec(focusCyl).iv.p },
        { label: tr('co.rocker'), at: () => partCenter(rockers.find((r) => r.v === valveSpec(focusCyl).iv).p), part: rockers.find((r) => r.v === valveSpec(focusCyl).iv).p },
        { label: tr('co.belt'), at: () => _a.set(-0.66, 0.24, 0.1), part: parts.find((p) => p.group === 'timing') },
      ];
    },
  },
  {
    get key() { return tr('ch4.key'); }, get title() { return tr('ch4.title'); }, get body() { return tr('ch4.body'); },
    widget: 'flow', xray: true, ghostExtra: [], flow: true,
    cam: { pos: [-1.2, 0.72, 1.62], target: [-0.36, 0.12, 0.22] },
    look: (p) => {
      if (p.kind === 'rotor') return ['focus'];
      if (isTurboHousing(p)) return ['ghost'];
      if (p.kind === 'piston' || p.kind === 'rod' || p.kind === 'valve' || p.kind === 'rocker' || p.kind === 'crank') return ['dim'];
      return null;
    },
    callouts: () => [
      { label: tr('co.filter'), color: 'var(--intake)', at: () => _a.set(-0.3, 0.5, 0.27) },
      { label: tr('co.comp'), color: 'var(--intake)', at: () => _a.set(-0.382, -0.06, 0.44), part: turbos.find((t) => t.pivot.z > 0).p },
      { label: tr('co.plenum'), color: 'var(--intake)', at: () => _a.set(-0.33, 0.47, 0) },
      { label: tr('co.manifold'), color: 'var(--exhaust)', at: () => _a.set(-0.55, 0.06, 0.38) },
      { label: tr('co.turbine'), color: 'var(--exhaust)', at: () => _a.set(-0.218, -0.07, 0.37), part: turbos.find((t) => t.pivot.z > 0 && t.pivot.x > -0.3).p },
    ],
  },
];

// ------------------------------------------------------------------ state
const state = {
  ch: 0, theta: 0, playing: !reduceMotion, speedTarget: 0, speed: 0, xray: true, explode: 0, explodeT: 0,
  hover: null, selected: null, isolate: false, seek: null, ghostFade: 1, view: 'shaded',
};
const speedFromSlider = (v) => 0.03 + Math.pow(v / 100, 1.7) * 2.6; // crank revolutions per second
state.speedTarget = speedFromSlider(+$('#speed').value);

// ------------------------------------------------------------------ view modes: shaded / cel / wire
const CEL = {
  block: '#8d99ae', heads: '#6d8fb8', covers: '#384252', mainbearings: '#d4a373', crank: '#ffb703', rods: '#fb6f92', pistons: '#f1faee',
  valveIn: '#4cc9f0', valveEx: '#ff7b00', rocker: '#b388ff', cam: '#57cc99', timing: '#e63946', intake: '#2a9d8f', exhaust: '#9c6644',
  turbo: '#c0d461', rotor: '#e0e0e0', ignition: '#9d4edd', hardware: '#5c636a', valvetrain: '#7d8590', misc: '#7d8590',
};
function celKey(p) {
  switch (p.kind) {
    case 'crank': return 'crank'; case 'rod': return 'rods'; case 'piston': return 'pistons';
    case 'valve': return p.valve.type === 'intake' ? 'valveIn' : 'valveEx';
    case 'rocker': return 'rocker'; case 'cam': return 'cam'; case 'rotor': return 'rotor'; case 'shaft': return 'timing';
    default: return CEL[p.group] ? p.group : 'misc';
  }
}
const toonRamp = (() => {
  const t = new THREE.DataTexture(new Uint8Array([70, 150, 215, 255]), 4, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
})();
const toonCache = new Map();
function toonMat(k, v) {
  const id = `${k}|${v}`;
  let m = toonCache.get(id);
  if (!m) {
    const c = new THREE.Color(CEL[k]);
    if (v === 'dim') c.multiplyScalar(0.4);
    m = new THREE.MeshToonMaterial({ color: c, gradientMap: toonRamp });
    if (v === 'focus') { m.emissive = new THREE.Color(CEL[k]); m.emissiveIntensity = 0.12; }
    if (v === 'hi') { m.emissive = COL.power.clone(); m.emissiveIntensity = 0.45; }
    toonCache.set(id, m);
  }
  return m;
}
const lineCache = new Map();
function lineMat(k, v) {
  const id = `${k}|${v}`;
  let m = lineCache.get(id);
  if (!m) {
    const c = v === 'hi' ? COL.power.clone() : new THREE.Color(CEL[k]);
    if (v === 'focus') c.lerp(new THREE.Color(1, 1, 1), 0.35);
    if (v === 'dim') c.multiplyScalar(0.45);
    m = new THREE.LineBasicMaterial({ color: c, transparent: v === 'ghost', opacity: v === 'ghost' ? 0.14 : 1, depthWrite: v !== 'ghost' });
    lineCache.set(id, m);
  }
  return m;
}
const inkMat = new THREE.LineBasicMaterial({ color: '#05080a' });
const hullMat = new THREE.ShaderMaterial({
  uniforms: { w: { value: 0.0022 }, color: { value: new THREE.Color('#05080a') } },
  vertexShader: `uniform float w; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vec3 n = normalize(normalMatrix * normal);
    mv.xyz += n * w * -mv.z; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform vec3 color; void main(){ gl_FragColor = vec4(color, 1.0); }`,
  side: THREE.BackSide,
});
const wireFill = new THREE.MeshBasicMaterial({ color: '#0a1116', polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
const hiddenMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
// clay: matte white, so only light, shadow and occlusion describe the shapes
const clayMats = {
  base: new THREE.MeshStandardMaterial({ color: '#eceae6', roughness: 0.82, metalness: 0, envMapIntensity: 0.7 }),
  focus: new THREE.MeshStandardMaterial({ color: '#f4eee4', roughness: 0.82, metalness: 0, envMapIntensity: 0.7, emissive: COL.power, emissiveIntensity: 0.05 }),
  dim: new THREE.MeshStandardMaterial({ color: '#77787a', roughness: 0.85, metalness: 0, envMapIntensity: 0.5 }),
  hi: new THREE.MeshStandardMaterial({ color: '#eceae6', roughness: 0.82, metalness: 0, envMapIntensity: 0.7, emissive: COL.power, emissiveIntensity: 0.28 }),
};

// Edge extraction from the CAD tessellation. "wire": drop edges between coplanar faces and the
// diagonal of each near-flat triangle pair (longest edge of both), which leaves a quad-dominant net.
// "feat": creases sharper than 30° for the cel outlines.
function buildEdges(geo) {
  const pos = geo.attributes.position, idx = geo.index, n = pos.count;
  const weld = new Int32Array(n), vmap = new Map();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos.getX(i) * 2e4)},${Math.round(pos.getY(i) * 2e4)},${Math.round(pos.getZ(i) * 2e4)}`;
    let w = vmap.get(k); if (w === undefined) { w = vmap.size; vmap.set(k, w); } weld[i] = w;
  }
  const M = vmap.size, F = idx ? idx.count / 3 : n / 3;
  const fn = new Float32Array(F * 3), longest = new Float64Array(F);
  const edges = new Map();
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const vi = [0, 0, 0];
  for (let f = 0; f < F; f++) {
    for (let j = 0; j < 3; j++) vi[j] = idx ? idx.getX(f * 3 + j) : f * 3 + j;
    A.fromBufferAttribute(pos, vi[0]); B.fromBufferAttribute(pos, vi[1]); C.fromBufferAttribute(pos, vi[2]);
    e1.subVectors(B, A); e2.subVectors(C, A); e1.cross(e2).normalize();
    fn[f * 3] = e1.x; fn[f * 3 + 1] = e1.y; fn[f * 3 + 2] = e1.z;
    const L = [A.distanceToSquared(B), B.distanceToSquared(C), C.distanceToSquared(A)];
    let best = -1, bestK = -1;
    for (let j = 0; j < 3; j++) {
      const u = vi[j], v = vi[(j + 1) % 3], wu = weld[u], wv = weld[v];
      if (wu === wv) continue;
      const k = wu < wv ? wu * M + wv : wv * M + wu;
      if (L[j] > best) { best = L[j]; bestK = k; }
      const e = edges.get(k);
      if (!e) edges.set(k, [f, -1, u, v]); else if (e[1] < 0) e[1] = f;
    }
    longest[f] = bestK;
  }
  const cosFeat = Math.cos(THREE.MathUtils.degToRad(30)), cosFlat = Math.cos(THREE.MathUtils.degToRad(0.6)), cosDiag = Math.cos(THREE.MathUtils.degToRad(14));
  const wire = [], feat = [];
  const put = (arr, e) => arr.push(pos.getX(e[2]), pos.getY(e[2]), pos.getZ(e[2]), pos.getX(e[3]), pos.getY(e[3]), pos.getZ(e[3]));
  for (const [k, e] of edges) {
    if (e[1] < 0) { put(wire, e); put(feat, e); continue; }
    const a = e[0] * 3, b = e[1] * 3;
    const d = fn[a] * fn[b] + fn[a + 1] * fn[b + 1] + fn[a + 2] * fn[b + 2];
    if (d < cosFeat) put(feat, e);
    if (d < cosFlat && !(d > cosDiag && longest[e[0]] === k && longest[e[1]] === k)) put(wire, e);
  }
  const mk = (arr) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); return g; };
  return { wire: mk(wire), feat: mk(feat) };
}
let edgesReady = null;
function ensureEdges(onProgress) {
  if (edgesReady) return edgesReady;
  edgesReady = new Promise((resolve) => {
    const cache = new Map();
    const meshes = parts.flatMap((p) => p.meshes);
    let i = 0;
    const noRay = () => {};
    const step = () => {
      const t0 = performance.now();
      while (i < meshes.length && performance.now() - t0 < 30) {
        const m = meshes[i++];
        let E = cache.get(m.geometry);
        if (!E) { E = buildEdges(m.geometry); cache.set(m.geometry, E); }
        const wire = new THREE.LineSegments(E.wire, inkMat), feat = new THREE.LineSegments(E.feat, inkMat), hull = new THREE.Mesh(m.geometry, hullMat);
        for (const o of [wire, feat, hull]) { o.matrixAutoUpdate = false; o.visible = false; o.raycast = noRay; m.add(o); }
        Object.assign(m.userData, { wire, feat, hull });
      }
      onProgress?.(i / meshes.length);
      if (i < meshes.length) setTimeout(step, 0); else resolve();
    };
    step();
  });
  return edgesReady;
}

// ------------------------------------------------------------------ look application
const dimCache = new Map();
function dimVariant(base) {
  let m = dimCache.get(base.uuid);
  if (!m) { m = base.clone(); m.onBeforeCompile = base.onBeforeCompile; m.color = base.color.clone().multiplyScalar(0.35); m.envMapIntensity = 0.35; dimCache.set(base.uuid, m); }
  return m;
}
function lookFor(p) {
  const ch = CH[state.ch];
  if (state.isolate && state.selected) return p === state.selected ? ['focus'] : ['ghost'];
  let look = ch.look(p);
  if (!look) {
    const housing = HOUSINGS.has(p.group) || (ch.ghostExtra || []).includes(p.group) || (ch.flow && isTurboHousing(p));
    look = state.xray && housing ? ['ghost'] : ['solid'];
  }
  if (look[0] === 'ghost' && !state.xray) look = ['solid'];
  return look;
}
function lookMat(p, m) {
  const base = m.userData.baseMat, look = p.look || ['solid'];
  switch (look[0]) {
    case 'ghost': return ghostMat;
    case 'tint': return variant(base, 'tint', look[1], look[2]);
    case 'focus': return variant(base, 'focus', COL.power, 0.05);
    case 'dim': return dimVariant(base);
    case 'valve': return p.valve.mat;
    default: return base;
  }
}
function currentMat(p, m) {
  const view = state.view, hi = !p.ghosted && (p === state.hover || p === state.selected), look = p.look ? p.look[0] : 'solid';
  if (view === 'wire') return p.ghosted ? hiddenMat : wireFill;
  if (view === 'clay') return p.ghosted ? ghostMat : clayMats[hi ? 'hi' : look === 'dim' ? 'dim' : look === 'focus' ? 'focus' : 'base'];
  if (view === 'cel') return p.ghosted ? ghostMat : toonMat(celKey(p), hi ? 'hi' : look === 'dim' ? 'dim' : look === 'focus' ? 'focus' : 'base');
  if (!p.ghosted && p === state.hover) return variant(m.userData.baseMat, 'hover', COL.power, 0.35);
  if (!p.ghosted && p === state.selected) return variant(m.userData.baseMat, 'sel', COL.power, 0.28);
  return lookMat(p, m);
}
function refresh(p) {
  if (!p) return;
  const view = state.view, hi = p === state.hover || p === state.selected, look = p.look ? p.look[0] : 'solid';
  for (const m of p.meshes) {
    m.material = currentMat(p, m);
    const lit = view === 'shaded' || view === 'clay';
    m.castShadow = lit && !p.ghosted; m.receiveShadow = lit;
    const u = m.userData;
    if (!u.wire) continue;
    u.wire.visible = view === 'wire';
    if (view === 'wire') u.wire.material = lineMat(celKey(p), p.ghosted ? 'ghost' : hi ? 'hi' : look === 'dim' ? 'dim' : look === 'focus' ? 'focus' : 'base');
    u.feat.visible = u.hull.visible = view === 'cel' && !p.ghosted;
  }
}
function applyLook() {
  for (const p of parts) { p.look = lookFor(p); p.ghosted = p.look[0] === 'ghost'; refresh(p); }
  rebuildPickList();
}
function setHover(p) {
  if (state.hover === p) return;
  const prev = state.hover; state.hover = p;
  refresh(prev); refresh(p);
  canvas.classList.toggle('hovering', !!p);
}

// ------------------------------------------------------------------ picking
const raycaster = new THREE.Raycaster();
let pickList = [];
function rebuildPickList() { pickList = parts.filter((p) => !p.ghosted && p.node.visible).flatMap((p) => p.meshes); }
let bvhReady = false;
import('three-mesh-bvh').then(({ computeBoundsTree, acceleratedRaycast }) => {
  THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
  THREE.Mesh.prototype.raycast = acceleratedRaycast;
  raycaster.firstHitOnly = true;
  const done = new Set();
  const list = parts.flatMap((p) => p.meshes);
  let i = 0;
  const step = () => {
    const t0 = performance.now();
    while (i < list.length && performance.now() - t0 < 12) {
      const g = list[i++].geometry;
      if (done.has(g)) continue; done.add(g);
      try { g.computeBoundsTree(); } catch (e) { /* fall back to plain raycast for this mesh */ }
    }
    if (i < list.length) requestIdleCallback ? requestIdleCallback(step) : setTimeout(step, 16); else bvhReady = true;
  };
  step();
}).catch((e) => console.warn('BVH unavailable; picking uses plain raycasts.', e));

const pointer = new THREE.Vector2(); let pointerDirty = false, pointerIn = false, lastPick = 0, downAt = null;
function pick() {
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(pickList, false)[0];
  return hit ? hit.object.userData.part : null;
}
canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  pointerDirty = true; pointerIn = e.pointerType === 'mouse';
  tip.style.transform = `translate(${Math.min(e.clientX - r.left + 16, r.width - 270)}px, ${e.clientY - r.top + 16}px)`;
});
canvas.addEventListener('pointerleave', () => { pointerIn = false; setHover(null); tip.classList.remove('on'); });
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; cancelTween(); });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  const r = canvas.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  select(pick());
});
canvas.addEventListener('dblclick', () => { if (state.selected) frame(state.selected); });

// ------------------------------------------------------------------ part descriptions
function describe(p) {
  const c = p.cyl;
  const where = c ? tr('p.where', c.n, bankName[c.bank]) : '';
  switch (p.kind) {
    case 'crank': return tr('p.crank');
    case 'piston': return [...tr('p.piston'), where];
    case 'rod': return [...tr('p.rod'), where];
    case 'valve': return [...tr(p.valve.type === 'intake' ? 'p.iv' : 'p.ev'), where];
    case 'rocker': return [...tr('p.rocker'), where];
    case 'cam': return [...tr('p.cam', p.camRow), tr(p.center0.z > 0 ? 'p.leftHead' : 'p.rightHead')];
    case 'rotor': return tr('p.rotor');
    case 'shaft': return tr('p.shaft');
    default: {
      const g = I18N[lang][`g.${p.group}`] || tr('g.part');
      return [g[0], g[1], p.side === 'L' ? tr('p.left') : p.side === 'R' ? tr('p.right') : ''];
    }
  }
}

// ------------------------------------------------------------------ selection + info card
const tip = $('#tip'), info = $('#info');
function select(p) {
  state.selected = p;
  if (!p) { state.isolate = false; $('#infoIsolate').setAttribute('aria-pressed', 'false'); }
  const [t, d, meta] = p ? describe(p) : ['', '', ''];
  info.hidden = !p;
  if (p) { $('#infoTitle').textContent = t; $('#infoText').textContent = d; $('#infoMeta').textContent = meta; }
  applyLook();
  renderCallouts();
}
$('#infoClose').onclick = () => select(null);
$('#infoFocus').onclick = () => state.selected && frame(state.selected);
$('#infoIsolate').onclick = (e) => {
  state.isolate = !state.isolate; e.currentTarget.setAttribute('aria-pressed', String(state.isolate)); applyLook();
};

// ------------------------------------------------------------------ camera tween
let tween = null;
function flyTo(pos, target, dur = 1.4) {
  if (reduceMotion) dur = 0.001;
  tween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: V(pos), t1: V(target), t: 0, dur };
}
function cancelTween() { tween = null; }
function frame(p) {
  const box = new THREE.Box3();
  for (const m of p.meshes) box.expandByObject(m);
  const c = box.getCenter(new THREE.Vector3()), r = Math.max(0.05, box.getSize(new THREE.Vector3()).length() * 0.5);
  const dir = camera.position.clone().sub(controls.target).normalize();
  flyTo(c.clone().addScaledVector(dir, r * 3.2 + 0.15).toArray(), c.toArray(), 1.1);
}
function stepTween(dt) {
  if (!tween) return;
  tween.t = Math.min(1, tween.t + dt / tween.dur);
  const k = smooth(smooth(tween.t));
  camera.position.lerpVectors(tween.p0, tween.p1, k);
  controls.target.lerpVectors(tween.t0, tween.t1, k);
  if (tween.t >= 1) tween = null;
}

// ------------------------------------------------------------------ chapter UI
const nav = $('#chapters');
CH.forEach((c, i) => {
  const b = document.createElement('button');
  b.onclick = () => goChapter(i);
  nav.appendChild(b);
});
function renderNav() {
  nav.querySelectorAll('button').forEach((b, i) => {
    b.innerHTML = `<b>${String(i + 1).padStart(2, '0')}</b><span>${CH[i].key}</span>`;
    b.setAttribute('aria-label', tr('nav.chapter', i + 1, CH[i].key));
  });
}
const widget = $('#chWidget');
let widgetRefs = {};
const bore = (cyls[0].radius * 2 * 1000), stroke = cyls[0].stroke * 1000;
const ccPerCyl = Math.PI / 4 * (bore / 10) ** 2 * (stroke / 10);
function buildWidget(kind) {
  widgetRefs = {};
  if (kind === 'layout') {
    widget.innerHTML = `
      <dl class="specs">
        <div><dt>${tr('w.bore')}</dt><dd>${nf(bore)}<small>mm</small></dd></div>
        <div><dt>${tr('w.stroke')}</dt><dd>${nf(stroke)}<small>mm</small></dd></div>
        <div><dt>${tr('w.percyl')}</dt><dd>${nf(ccPerCyl)}<small>cm³</small></dd></div>
        <div><dt>${tr('w.disp')}</dt><dd>${nf(ccPerCyl * 16 / 1000, 1)}<small>L</small></dd></div>
      </dl>
      <div style="display:grid;gap:8px;margin-top:16px">
        <span class="label">${tr('w.firing')}</span>
        <div class="firing" id="firing">${firingOrder.map((c) => `<span data-n="${c.n}">${c.n}</span>`).join('')}</div>
        <span class="label" style="text-transform:none;letter-spacing:.02em;font-family:var(--body);font-size:12px;color:var(--muted)">${tr('w.firingNote')}</span>
      </div>`;
    widgetRefs.cells = firingOrder.map((c) => [c, widget.querySelector(`[data-n="${c.n}"]`)]);
  } else if (kind === 'strokes') {
    widget.innerHTML = `
      <div class="strokes" role="group" aria-label="${tr('stroke.jump')}">${STROKES.map((s, i) => `<button data-i="${i}" style="--c:var(${s.c})" aria-pressed="false">${s.name}</button>`).join('')}</div>
      <div class="stroke-now" id="strokeNow" style="margin-top:12px"><b id="strokeName"></b><span id="strokeText"></span></div>
      <div class="meters" style="margin-top:12px">
        <div class="meter" style="--c:var(--intake)"><span>${tr('w.ivalve')}</span><span class="bar"><i id="mIv"></i></span><output id="oIv">0 mm</output></div>
        <div class="meter" style="--c:var(--exhaust)"><span>${tr('w.evalve')}</span><span class="bar"><i id="mEv"></i></span><output id="oEv">0 mm</output></div>
        <div class="meter" style="--c:var(--fg)"><span>${tr('w.piston')}</span><span class="bar"><i id="mPi"></i></span><output id="oPi">0 mm</output></div>
      </div>`;
    widget.querySelectorAll('.strokes button').forEach((b) => { b.onclick = () => seekStroke(+b.dataset.i); });
    Object.assign(widgetRefs, { name: $('#strokeName'), text: $('#strokeText'), now: $('#strokeNow'), btns: [...widget.querySelectorAll('.strokes button')],
      mIv: $('#mIv'), mEv: $('#mEv'), mPi: $('#mPi'), oIv: $('#oIv'), oEv: $('#oEv'), oPi: $('#oPi') });
  } else if (kind === 'crank') {
    widget.innerHTML = `
      <dl class="specs">
        <div><dt>${tr('w.throw')}</dt><dd>35<small>mm</small></dd></div>
        <div><dt>${tr('w.stroke')}</dt><dd>${nf(stroke)}<small>mm</small></dd></div>
        <div><dt>${tr('w.rodlen')}</dt><dd>190<small>mm</small></dd></div>
        <div><dt>${tr('w.pins')}</dt><dd>8<small>${tr('w.pinsUnit')}</small></dd></div>
      </dl>
      <div class="meters" style="margin-top:16px">
        <div class="meter" style="--c:var(--intake)"><span>${tr('w.piston1')}</span><span class="bar"><i id="mPi"></i></span><output id="oPi">0 mm</output></div>
        <div class="meter" style="--c:var(--power)"><span>${tr('w.crankAngle')}</span><span class="bar"><i id="mCa"></i></span><output id="oCa">0°</output></div>
      </div>
      <div class="legend" style="margin-top:12px"><span><i style="--c:var(--power)"></i>${tr('w.pinPath')}</span><span><i style="--c:var(--intake)"></i>${tr('w.travel')}</span></div>`;
    Object.assign(widgetRefs, { mPi: $('#mPi'), oPi: $('#oPi'), mCa: $('#mCa'), oCa: $('#oCa') });
  } else if (kind === 'valves') {
    widget.innerHTML = `
      <dl class="specs">
        <div><dt>${tr('w.crank')}</dt><dd id="vCrank">0<small>°</small></dd></div>
        <div><dt>${tr('w.cam')}</dt><dd id="vCam">0<small>°</small></dd></div>
      </dl>
      <div class="meters" style="margin-top:16px">
        <div class="meter" style="--c:var(--intake)"><span>${tr('w.c1in')}</span><span class="bar"><i id="mIv"></i></span><output id="oIv">0 mm</output></div>
        <div class="meter" style="--c:var(--exhaust)"><span>${tr('w.c1ex')}</span><span class="bar"><i id="mEv"></i></span><output id="oEv">0 mm</output></div>
      </div>
      <div class="legend" style="margin-top:12px"><span><i style="--c:var(--intake)"></i>${tr('w.inValves')}</span><span><i style="--c:var(--exhaust)"></i>${tr('w.exValves')}</span><span>${tr('w.brighter')}</span></div>`;
    Object.assign(widgetRefs, { vCrank: $('#vCrank'), vCam: $('#vCam'), mIv: $('#mIv'), mEv: $('#mEv'), oIv: $('#oIv'), oEv: $('#oEv') });
  } else if (kind === 'flow') {
    widget.innerHTML = `
      <div class="legend"><span><i style="--c:var(--intake)"></i>${tr('w.airPath')}</span><span><i style="--c:var(--exhaust)"></i>${tr('w.exPath')}</span></div>
      <dl class="specs" style="margin-top:16px">
        <div><dt>${tr('w.turbos')}</dt><dd>4</dd></div>
        <div><dt>${tr('w.perTurbo')}</dt><dd>4<small>${tr('w.cylinders')}</small></dd></div>
      </dl>
      <p style="margin:12px 0 0;color:var(--muted);font-size:13px">${tr('w.flowNote')}</p>`;
  } else widget.innerHTML = '';
}

function renderChapterText() {
  const i = state.ch, c = CH[i];
  $('#chNum').textContent = String(i + 1).padStart(2, '0');
  $('#chKicker').textContent = c.key;
  $('#chTitle').textContent = c.title;
  $('#chBody').innerHTML = c.body;
  nav.querySelectorAll('button').forEach((b, k) => b.setAttribute('aria-current', k === i ? 'step' : 'false'));
  buildWidget(c.widget);
}
function goChapter(i) {
  state.ch = i;
  const c = CH[i];
  renderChapterText();
  state.xray = c.xray; $('#xray').setAttribute('aria-pressed', String(state.xray));
  select(null);
  flow.group.visible = !!c.flow;
  guides.g.visible = !!c.guides;
  const cam = typeof c.cam === 'function' ? c.cam() : c.cam;
  flyTo(cam.pos, cam.target);
  $('#ring').style.display = (c.widget === 'strokes' || c.widget === 'valves') ? '' : 'none';
  applyLook();
  renderCallouts();
  try { localStorage.setItem('w16-chapter', String(i)); } catch (e) { /* storage unavailable */ }
}

// stroke stepping
function seekStroke(i) {
  const target = i * 180 + 90;
  const ph = focusPhase();
  const delta = mod(target - ph, 720) || 720;
  state.seek = { from: state.theta, to: state.theta + delta / DEG, t: 0, dur: reduceMotion ? 0.001 : 0.6 + delta / 720 * 1.2 };
  setPlaying(false);
}
const focusPhase = () => mod((state.theta - focusCyl.tdc) * DEG + focusCyl.off, 720);

// ------------------------------------------------------------------ callouts
const calloutLayer = $('#callouts');
let callouts = [];
function renderCallouts() {
  calloutLayer.innerHTML = '';
  callouts = (CH[state.ch].callouts ? CH[state.ch].callouts() : []).map((c) => {
    const el = document.createElement('button');
    el.className = 'callout'; el.type = 'button';
    if (c.color) el.style.setProperty('--c', c.color);
    el.innerHTML = `<i></i><span>${c.label}</span>`;
    if (c.part) el.onclick = () => select(c.part === state.selected ? null : c.part);
    if (c.part && c.part === state.selected) el.classList.add('on');
    calloutLayer.appendChild(el);
    return { ...c, el };
  });
}
const _p = new THREE.Vector3();
function updateCallouts() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const camDir = camera.getWorldDirection(new THREE.Vector3());
  for (const c of callouts) {
    _p.copy(c.at());
    const toP = _p.clone().sub(camera.position);
    const inFront = toP.dot(camDir) > 0;
    _p.project(camera);
    const x = (_p.x * 0.5 + 0.5) * w, y = (-_p.y * 0.5 + 0.5) * h;
    c.el.style.transform = `translate(${x - 6}px, ${y}px) translate(0, -50%)`;
    c.el.style.visibility = inFront && x > -50 && x < w + 50 ? 'visible' : 'hidden';
  }
}

// ------------------------------------------------------------------ controls
function setPlaying(v) {
  state.playing = v;
  $('#icoPause').hidden = !v; $('#icoPlay').hidden = v;
  $('#play').setAttribute('aria-label', tr(v ? 'dock.pause' : 'dock.play'));
  if (v) state.seek = null;
}
$('#play').onclick = () => setPlaying(!state.playing);
$('#speed').oninput = (e) => { state.speedTarget = speedFromSlider(+e.target.value); if (!state.playing) setPlaying(true); };
$('#xray').onclick = () => { state.xray = !state.xray; $('#xray').setAttribute('aria-pressed', String(state.xray)); applyLook(); };
$('#explode').oninput = (e) => { state.explodeT = +e.target.value / 100; };
$('#reset').onclick = () => { const c = CH[state.ch].cam; const cam = typeof c === 'function' ? c() : c; flyTo(cam.pos, cam.target); };
$('#sheetToggle').onclick = (e) => {
  const p = $('#panel'); const col = p.classList.toggle('collapsed');
  e.currentTarget.setAttribute('aria-expanded', String(!col));
  e.currentTarget.style.transform = col ? 'rotate(180deg)' : '';
};
addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); setPlaying(!state.playing); }
  else if (e.key === 'ArrowRight') goChapter(Math.min(CH.length - 1, state.ch + 1));
  else if (e.key === 'ArrowLeft') goChapter(Math.max(0, state.ch - 1));
  else if (e.key.toLowerCase() === 'x') $('#xray').click();
  else if (e.key.toLowerCase() === 'r') $('#reset').click();
  else if (e.key === 'Escape') select(null);
});

// ------------------------------------------------------------------ view switching + colour key
const viewBtns = [...document.querySelectorAll('[data-view]')];
const legendEl = $('#legend');
const LEGEND = [
  ['crank', () => tr('p.crank')[0]], ['rods', () => tr('p.rod')[0]], ['pistons', () => tr('p.piston')[0]],
  ['valveIn', () => tr('p.iv')[0]], ['valveEx', () => tr('p.ev')[0]], ['rocker', () => tr('p.rocker')[0]], ['cam', () => tr('w.cam')],
  ['timing', () => tr('g.timing')[0]], ['rotor', () => tr('p.rotor')[0]], ['turbo', () => tr('g.turbo')[0]],
  ['intake', () => tr('g.intake')[0]], ['exhaust', () => tr('g.exhaust')[0]], ['heads', () => tr('g.heads')[0]],
  ['block', () => tr('g.block')[0]], ['mainbearings', () => tr('g.mainbearings')[0]], ['covers', () => tr('g.covers')[0]], ['ignition', () => tr('g.ignition')[0]],
];
function renderLegend() {
  legendEl.hidden = state.view === 'shaded' || state.view === 'clay';
  legendEl.innerHTML = `<span class="label">${tr('view.legend')}</span><ul>${LEGEND.map(([k, l]) => `<li><i style="background:${CEL[k]}"></i>${l()}</li>`).join('')}</ul>`;
}
async function setView(v) {
  if ((v === 'cel' || v === 'wire') && !edgesReady) {
    const btn = viewBtns.find((b) => b.dataset.view === v);
    btn.textContent = tr('view.building');
    await ensureEdges((f) => { btn.textContent = `${Math.round(f * 100)}%`; });
    btn.textContent = tr(`view.${v}`);
  }
  state.view = v;
  viewBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  const lit = v === 'shaded' || v === 'clay';
  renderer.toneMapping = lit ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
  gtao.enabled = lit && !coarse && degraded === 0;
  gtao.blendIntensity = Math.min(1, lens.ao * (v === 'clay' ? 1.06 : 1));
  key.castShadow = lit;
  applyLook();
  renderLegend();
  try { localStorage.setItem('w16-view', v); } catch (e) { /* storage unavailable */ }
}
viewBtns.forEach((b) => { b.onclick = () => setView(b.dataset.view); });

// ------------------------------------------------------------------ lens panel
const lensPanel = $('#lensPanel');
const LENS_ROWS = [
  ['focal', 18, 135, 1, (v) => `${v} mm`],
  ['fstop', 0, FSTOPS.length - 1, 1, (v) => `f/${nf(FSTOPS[v], FSTOPS[v] % 1 ? 1 : 0)}`],
  ['maxblur', 0.002, 0.03, 0.001, (v) => `${Math.round(v / 0.03 * 100)} %`],
  ['exposure', 0.6, 1.8, 0.01, (v) => nf(v, 2)],
  ['bloom', 0, 1.5, 0.01, (v) => `${Math.round(v / 1.5 * 100)} %`],
  ['ao', 0, 1, 0.01, (v) => `${Math.round(v * 100)} %`],
  ['vignette', 0, 1, 0.01, (v) => `${Math.round(v * 100)} %`],
  ['ca', 0, 1, 0.01, (v) => `${Math.round(v * 100)} %`],
  ['grain', 0, 1, 0.01, (v) => `${Math.round(v * 100)} %`],
];
function applyLens(save = true) {
  renderer.toneMappingExposure = lens.exposure;
  bloom.strength = lens.bloom;
  gtao.blendIntensity = Math.min(1, lens.ao * (state.view === 'clay' ? 1.06 : 1));
  bokeh.enabled = lens.dof;
  bokeh.uniforms.aperture.value = 0.11 / FSTOPS[lens.fstop];
  bokeh.uniforms.maxblur.value = lens.maxblur;
  lensPass.uniforms.vignette.value = lens.vignette;
  lensPass.uniforms.ca.value = lens.ca;
  lensPass.uniforms.grain.value = lens.grain;
  resize();
  if (save) try { localStorage.setItem('w16-lens', JSON.stringify(lens)); } catch (e) { /* storage unavailable */ }
}
function renderLensPanel() {
  const row = ([k, min, max, step, fmt]) => `<label class="lrow${k === 'fstop' || k === 'maxblur' ? ' dofrow' : ''}" for="lens-${k}"><span>${tr(`lens.${k}`)}</span>
    <input type="range" id="lens-${k}" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${lens[k]}"><output>${fmt(lens[k])}</output></label>`;
  lensPanel.innerHTML = `<div class="lhead"><b>${tr('lens.title')}</b><button class="tb" id="lensReset">${tr('lens.reset')}</button></div>
    <div class="lgroup"><span class="label">${tr('lens.optics')}</span>${row(LENS_ROWS[0])}
      <label class="lrow ltoggle" for="lens-dof"><span>${tr('lens.dof')}</span><input type="checkbox" id="lens-dof" ${lens.dof ? 'checked' : ''}><output></output></label>
      ${row(LENS_ROWS[1])}${row(LENS_ROWS[2])}<p class="lnote">${tr('lens.focusNote')}</p></div>
    <div class="lgroup"><span class="label">${tr('lens.image')}</span>${LENS_ROWS.slice(3).map(row).join('')}</div>`;
  lensPanel.querySelectorAll('input[type=range]').forEach((inp) => {
    inp.oninput = () => {
      const k = inp.dataset.k, r = LENS_ROWS.find((x) => x[0] === k);
      lens[k] = +inp.value; inp.nextElementSibling.textContent = r[4](lens[k]); applyLens();
    };
  });
  const dof = $('#lens-dof');
  const syncDof = () => lensPanel.classList.toggle('nodof', !lens.dof);
  dof.onchange = () => { lens.dof = dof.checked; syncDof(); applyLens(); };
  syncDof();
  $('#lensReset').onclick = () => { Object.assign(lens, LENS_DEFAULTS); applyLens(); renderLensPanel(); };
}
$('#lensBtn').onclick = () => {
  lensPanel.hidden = !lensPanel.hidden;
  $('#lensBtn').setAttribute('aria-expanded', String(!lensPanel.hidden));
  if (!lensPanel.hidden) { renderLensPanel(); legendEl.style.visibility = 'hidden'; } else legendEl.style.visibility = '';
};

// ------------------------------------------------------------------ language
function applyStaticText() {
  document.documentElement.lang = lang;
  document.title = tr('doc.title');
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = tr(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', tr(el.dataset.i18nAria)); });
  const lb = $('#lang'); lb.textContent = tr('dock.langShort'); lb.setAttribute('aria-label', tr('dock.lang')); lb.title = tr('dock.lang');
  $('#play').setAttribute('aria-label', tr(state.playing ? 'dock.pause' : 'dock.play'));
}
function setLang(l) {
  lang = l;
  try { localStorage.setItem('w16-lang', l); } catch (e) { /* storage unavailable */ }
  applyStaticText(); renderNav(); renderChapterText(); renderCallouts(); renderLegend(); if (!lensPanel.hidden) renderLensPanel();
  if (state.selected) { const [t0, d, meta] = describe(state.selected); $('#infoTitle').textContent = t0; $('#infoText').textContent = d; $('#infoMeta').textContent = meta; }
  hudT = 1;
}
$('#lang').onclick = () => setLang(lang === 'de' ? 'en' : 'de');

// ring arcs
{
  const g = $('#ringArcs');
  const R = 46, arc = (a0, a1) => {
    const p = (a) => [60 + R * Math.sin(a), 60 - R * Math.cos(a)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  g.innerHTML = STROKES.map((s, i) => `<path d="${arc(i * Math.PI / 2 + 0.03, (i + 1) * Math.PI / 2 - 0.03)}" stroke="${css.getPropertyValue(s.c).trim()}" stroke-width="7" fill="none"/>`).join('')
    + `<circle cx="60" cy="60" r="36" fill="none" stroke="#24303a" stroke-width="1"/>`;
}

// ------------------------------------------------------------------ per-frame update
const T = new THREE.Matrix4(), M = new THREE.Matrix4();
const gasCol = new THREE.Color();
function updateKinematics(th) {
  rotAbout(crank.G, pivot, X, th);
  for (const c of cyls) {
    crankPin(c, th, c.C);
    c.s = pistonTravel(c, c.C);
    c.P.copy(c.P0).addScaledVector(c.d, c.s);
    translate(c.piston.G, _v.copy(c.d).multiplyScalar(c.s));
    const r = ang(_v.subVectors(c.P, c.C));
    rotAbout(c.rod.G, c.C0, X, r - c.r0);
    c.rod.G.elements[12] += c.C.x - c.C0.x; c.rod.G.elements[13] += c.C.y - c.C0.y; c.rod.G.elements[14] += c.C.z - c.C0.z;
    c.phase = mod((th - c.tdc) * DEG + c.off, 720);
  }
  for (const v of valves) {
    v.lift = liftAt(v.cyl.phase, v.prof);
    translate(v.p.G, _v.copy(v.dir).multiplyScalar(v.lift * v.prof.lift));
  }
  for (const r of rockers) rotAbout(r.p.G, r.pivot, X, r.sign * (r.v.lift * r.v.prof.lift) / r.lever);
  for (const c of cams) rotAbout(c.p.G, c.pivot, X, th / 2);
  rotAbout(balance.p.G, balance.pivot, X, th * 2);
  for (const r of rollers) rotAbout(r.p.G, r.pivot, X, -th * 2.1);
}
let turboAngle = 0;
function commitParts() {
  const e = smooth(state.explode) * 0.8;
  for (const p of parts) {
    M.copy(p.G);
    if (e > 0 && p.explodeDir.lengthSq() > 0) {
      M.elements[12] += p.explodeDir.x * e; M.elements[13] += p.explodeDir.y * e; M.elements[14] += p.explodeDir.z * e;
    }
    p.cur = p.cur || new THREE.Matrix4();
    p.cur.copy(M);
    p.node.matrix.multiplyMatrices(M, p.rest);
    p.node.matrixWorldNeedsUpdate = true;
    if (p.fade) p.node.visible = e < 0.03;
  }
}
function updateGas() {
  const ch = CH[state.ch];
  const e = smooth(state.explode);
  for (const c of cyls) {
    const show = ch.gas === 'focus' ? c === focusCyl : ch.gas === 'firing';
    let I = 0;
    if (show) {
      I = gasStyle(c.phase, gasCol);
      if (ch.gas === 'firing') I = c.phase >= 360 && c.phase < 540 ? I * 0.9 : 0;
    }
    c.gas.visible = I > 0.02 && e < 0.05;
    if (c.gas.visible) {
      const crown = _v.copy(c.P).addScaledVector(c.d, c.crown);
      const len = Math.max(0.002, c.deck.clone().sub(crown).dot(c.d));
      c.gas.position.copy(crown).addScaledVector(c.d, len / 2);
      c.gas.scale.set(c.radius * 0.97, len, c.radius * 0.97);
      c.gas.material.uniforms.color.value.copy(gasCol);
      c.gas.material.uniforms.intensity.value = I;
    }
    const sp = show && c.phase > 344 && c.phase < 372 && e < 0.05;
    c.spark.visible = sp;
    if (sp) {
      c.spark.position.copy(c.deck).addScaledVector(c.d, -0.004);
      const f = 1 - Math.abs(c.phase - 356) / 16;
      c.spark.material.opacity = clamp(f, 0, 1) * (0.7 + Math.random() * 0.3);
      c.spark.scale.setScalar(0.03 + 0.04 * f);
    }
  }
  if (ch.widget === 'valves' || ch.widget === 'strokes') {
    for (const v of valves) v.mat.emissiveIntensity = v.lift * 0.9;
  }
}

let hudT = 0;
function updateHUD(dt) {
  hudT += dt; if (hudT < 0.066) return; hudT = 0;
  const crankDeg = mod((state.theta - focusCyl.tdc) * DEG, 360);
  $('#hudCrank').innerHTML = `${crankDeg.toFixed(0).padStart(3, ' ')}<small>°</small>`;
  $('#hudRpm').innerHTML = `${(state.speed * 60).toFixed(0)}<small>${tr('unit.rpm')}</small>`;
  const ph = focusPhase(), si = Math.floor(ph / 180), s = STROKES[si];
  $('#ringNeedle').setAttribute('transform', `rotate(${(ph / 2).toFixed(1)} 60 60)`);
  $('#ringLabel').textContent = s.name.toUpperCase();
  $('#ringLabel').setAttribute('fill', css.getPropertyValue(s.c).trim());
  $('#ringSub').textContent = `${tr('ring.cyl')} · ${ph.toFixed(0)}°`;
  const R = widgetRefs;
  const { iv, ev } = valveSpec(focusCyl);
  if (R.cells) for (const [c, el] of R.cells) { const g = c.phase >= 360 && c.phase < 540 ? Math.exp(-(c.phase - 360) / 60) : 0; el.style.setProperty('--g', g.toFixed(3)); }
  if (R.name && R.name.dataset.si !== String(si)) {
    R.name.dataset.si = String(si);
    R.name.textContent = s.name; R.text.textContent = s.text;
    R.now.style.setProperty('--c', `var(${s.c})`);
    R.btns.forEach((b, k) => b.setAttribute('aria-pressed', String(k === si)));
  }
  if (R.mIv) {
    R.mIv.style.width = `${(iv.lift * 100).toFixed(1)}%`; R.oIv.textContent = `${nf(iv.lift * iv.prof.lift * 1000, 1)} mm`;
    R.mEv.style.width = `${(ev.lift * 100).toFixed(1)}%`; R.oEv.textContent = `${nf(ev.lift * ev.prof.lift * 1000, 1)} mm`;
  }
  if (R.mPi) {
    const down = (focusCyl.sMax - focusCyl.s) * 1000;
    R.mPi.style.width = `${(100 - down / stroke * 100).toFixed(1)}%`; R.oPi.textContent = `−${down.toFixed(0)} mm`;
  }
  if (R.mCa) { R.mCa.style.width = `${(crankDeg / 3.6).toFixed(1)}%`; R.oCa.textContent = `${crankDeg.toFixed(0)}°`; }
  if (R.vCrank) {
    R.vCrank.innerHTML = `${crankDeg.toFixed(0)}<small>°</small>`;
    R.vCam.innerHTML = `${mod((state.theta - focusCyl.tdc) * DEG / 2, 360).toFixed(0)}<small>°</small>`;
  }
}

// ------------------------------------------------------------------ main loop
const clock = new THREE.Clock();
let fpsAcc = 0, fpsN = 0, degraded = 0;
function loop() {
  tick(Math.min(clock.getDelta(), 0.05));
  requestAnimationFrame(loop);
}
function tick(dt) {
  stepTween(dt);
  // speed eases towards target; pausing eases to zero
  const tgt = state.playing ? state.speedTarget : 0;
  state.speed += (tgt - state.speed) * Math.min(1, dt * 4);
  if (state.seek) {
    const s = state.seek; s.t = Math.min(1, s.t + dt / s.dur);
    state.theta = s.from + (s.to - s.from) * smooth(s.t);
    if (s.t >= 1) state.seek = null;
  } else state.theta += state.speed * Math.PI * 2 * dt;
  state.explode += (state.explodeT - state.explode) * Math.min(1, dt * 6);
  updateKinematics(state.theta);
  turboAngle += dt * (4 + state.speed * 60);
  for (const t of turbos) rotAbout(t.p.G, t.pivot, t.axis, turboAngle);
  commitParts();
  updateGas();
  guides.update();
  flow.update(dt, 0.25 + state.speed * 1.2);
  controls.update();
  if (bokeh.enabled) {
    const fp = state.selected ? partCenter(state.selected) : controls.target;
    bokeh.uniforms.focus.value = camera.position.distanceTo(fp);
  }
  lensPass.uniforms.time.value += dt;
  updateCallouts();
  updateHUD(dt);
  if (pointerDirty && pointerIn && performance.now() - lastPick > 60 && !tween) {
    lastPick = performance.now(); pointerDirty = false;
    const p = pick(); setHover(p);
    if (p) { const [t, d] = describe(p); tip.querySelector('b').textContent = t; tip.querySelector('span').textContent = d; tip.classList.add('on'); }
    else tip.classList.remove('on');
  }
  composer.render(dt);
  // adaptive quality: drop bloom, then resolution, if frames run long
  fpsAcc += dt; fpsN++;
  if (fpsN === 90) {
    const avg = fpsAcc / fpsN; fpsAcc = 0; fpsN = 0;
    if (avg > 0.026 && degraded === 0) { degraded = 1; bloom.enabled = false; gtao.enabled = false; }
    else if (avg > 0.026 && degraded === 1) { degraded = 2; pixelRatio = 1; renderer.setPixelRatio(1); resize(); }
  }
}

// ------------------------------------------------------------------ start
let startCh = 0;
try { const s = +localStorage.getItem('w16-chapter'); if (s >= 0 && s < CH.length) startCh = s; } catch (e) { /* storage unavailable */ }
applyStaticText(); renderNav();
applyLens(false);
const c0 = CH[startCh].cam; const cam0 = typeof c0 === 'function' ? c0() : c0;
camera.position.set(cam0.pos[0] - 0.6, cam0.pos[1] + 0.25, cam0.pos[2] + 0.9);
controls.target.set(...cam0.target);
updateKinematics(0); commitParts();
setPlaying(state.playing);
goChapter(startCh);
renderLegend();
try { const v = localStorage.getItem('w16-view'); if (v === 'cel' || v === 'wire' || v === 'clay') setView(v); } catch (e) { /* storage unavailable */ }
setLoad(1, tr('load.ready'));
setTimeout(() => $('#loader').classList.add('done'), 150);
requestAnimationFrame(loop);
window.__w16 = { tick: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) tick(dt); }, renderer, composer, scene, bloom, state, parts, cyls, valves, rig, camera, controls, goChapter, firingOrder };
