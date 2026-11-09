// engine_raw.glb -> web/engine.glb : dedup, weld, per-part simplification, meshopt compression
// usage: node optimize.mjs out/engine_raw.glb ../web/engine.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, weld, prune, simplifyPrimitive, meshopt, quantize } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';

const [, , IN, OUT] = process.argv;
await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

// simplification error relative to each mesh's own extent
const ERROR = [
  [/^STATIC_mainbearings_/, 0.0035], // mostly hidden inside the block
  [/^STATIC_valvetrain_/, 0.003],    // cam bearings, rocker pins (inside heads)
  [/^STATIC_timing_/, 0.0025],
  [/^STATIC_hardware_/, 0.0015],
  [/^STATIC_(heads|intake|turbo)_/, 0.0012],
  [/^BOLTS_CR/, 0.004],
  [/^(PISTON|valve|Rocker Arm)/, 0.002],
  [/^CONNECTING ROD/, 0.0015],
  [/.*/, 0.0008],
];
const errorFor = (name) => ERROR.find(([re]) => re.test(name))[1];

const doc = await io.read(IN);
await doc.transform(dedup(), weld());

const tris = (d) => d.getRoot().listNodes().reduce((s, n) => {
  const m = n.getMesh();
  return s + (m ? m.listPrimitives().reduce((a, p) => a + p.getIndices().getCount() / 3, 0) : 0);
}, 0);
const before = tris(doc);

const done = new Set();
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh || done.has(mesh)) continue;
  done.add(mesh);
  const error = errorFor(node.getName());
  for (const prim of mesh.listPrimitives()) {
    simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: 0, error, lockBorder: false });
  }
}
const after = tris(doc);

await doc.transform(prune(), quantize({ quantizePosition: 16, quantizeNormal: 10 }));
// fallback without EXT_meshopt_compression, for hosts that block WebAssembly
await io.write(OUT.replace(/\.glb$/, '_q.glb'), doc);
await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16, quantizeNormal: 10 }));
await io.write(OUT, doc);
console.log(`rendered tris ${before} -> ${after}`);
