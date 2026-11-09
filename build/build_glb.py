"""
Background Blender build: W16 backup .blend -> web-ready GLB + rig.json

Run:
  blender -b source/W16_engine_backup.blend -P build/build_glb.py -- <out_dir>

What it does (never touches the user's live session):
  1. flattens the hierarchy (keeps world transforms), drops empties/camera/light
  2. removes coincident duplicate parts
  3. assigns PBR materials per part category
  4. shares identical meshes between repeated moving parts (pistons, rods, valves ...)
  5. parents piston pins -> pistons, rod bolts -> rods, joins pulleys onto their shafts
  6. joins all static parts per functional group (few draw calls)
  7. smooth-by-angle normals, exports GLB, writes rig.json (three.js Y-up coordinates)
"""
import bpy, bmesh, sys, os, re, json, math
import numpy as np
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else os.path.join(os.path.dirname(bpy.data.filepath), "..", "build", "out")
os.makedirs(OUT, exist_ok=True)

O = bpy.data.objects
def base(n): return re.sub(r'\.\d{3}$', '', n)
def T(v):  # blender (Z-up) -> three.js (Y-up)
    return [round(float(v[0]), 6), round(float(v[2]), 6), round(float(-v[1]), 6)]

def world_verts(ob):
    me = ob.data
    n = len(me.vertices)
    co = np.empty(n * 3); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    M = np.array(ob.matrix_world)
    return co @ M[:3, :3].T + M[:3, 3]

def local_hash(me):
    n = len(me.vertices)
    co = np.empty(n * 3); me.vertices.foreach_get("co", co)
    return (n, len(me.polygons), round(float(np.abs(co).sum()), 4), tuple(np.round(co[:12], 5)))

# ---------------------------------------------------------------- 1. flatten
for o in list(O):
    if o.type in {'CAMERA', 'LIGHT'}:
        O.remove(o)
mws = {o.name: o.matrix_world.copy() for o in O}
rocker_pins = [mws[o.name].translation.copy() for o in O if base(o.name) == "Rocker Arm Pin"]
for o in O:
    o.parent = None
for o in O:
    o.matrix_world = mws[o.name]
for o in list(O):
    if o.type == 'EMPTY':
        O.remove(o)
bpy.context.view_layer.update()

# ---------------------------------------------------------------- 2. coincident duplicates
seen = {}
removed_dupes = []
for o in sorted(O, key=lambda o: o.name):
    if o.type != 'MESH':
        continue
    key = (base(o.name), local_hash(o.data), tuple(round(x, 4) for x in o.matrix_world.translation),
           tuple(round(x, 3) for x in o.matrix_world.to_quaternion()))
    if key in seen:
        removed_dupes.append(o.name)
        O.remove(o)
    else:
        seen[key] = o.name
print("removed duplicates:", removed_dupes)

# ---------------------------------------------------------------- 3. materials
def make_mat(name, color, metal, rough, coat=0.0, coat_rough=0.1, aniso=0.0):
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if coat:
        b.inputs["Coat Weight"].default_value = coat
        b.inputs["Coat Roughness"].default_value = coat_rough
    if aniso and "Anisotropic" in b.inputs:
        b.inputs["Anisotropic"].default_value = aniso
    m.diffuse_color = (*color, 1)
    return m

MATS = {
    "alu_cast":     make_mat("Aluminium cast",      (0.62, 0.63, 0.64), 1.0, 0.48),
    "alu_machined": make_mat("Aluminium machined",  (0.80, 0.80, 0.81), 1.0, 0.26),
    "steel_forged": make_mat("Steel forged",        (0.52, 0.53, 0.55), 1.0, 0.30),
    "steel_polish": make_mat("Steel polished",      (0.70, 0.71, 0.72), 1.0, 0.16),
    "steel_dark":   make_mat("Steel black oxide",   (0.06, 0.06, 0.07), 1.0, 0.38),
    "valve":        make_mat("Valve steel",         (0.66, 0.60, 0.52), 1.0, 0.24),
    "paint_cover":  make_mat("Cover satin black",   (0.018, 0.019, 0.022), 0.0, 0.42, coat=1.0, coat_rough=0.18),
    "carbon":       make_mat("Carbon",              (0.025, 0.026, 0.03), 0.0, 0.32, coat=1.0, coat_rough=0.06),
    "anod_red":     make_mat("Anodised red",        (0.42, 0.05, 0.035), 1.0, 0.34),
    "rubber":       make_mat("Rubber",              (0.012, 0.012, 0.013), 0.0, 0.78),
    "iron_cast":    make_mat("Cast iron",           (0.20, 0.20, 0.21), 1.0, 0.62),
    "titanium":     make_mat("Titanium heat",       (0.42, 0.38, 0.40), 1.0, 0.30),
    "inconel":      make_mat("Exhaust inconel",     (0.36, 0.33, 0.30), 1.0, 0.36),
    "coil":         make_mat("Ignition coil",       (0.03, 0.03, 0.035), 0.0, 0.45, coat=0.6, coat_rough=0.3),
    "brass":        make_mat("Bearing steel",       (0.74, 0.74, 0.76), 1.0, 0.20),
}

# base name -> (group, material, role)
RULES = [
    (r"^CRANK SHAFT$",          "crank",      "steel_forged", "crank"),
    (r"^pully1$",               "crank",      "anod_red",     "join:CRANK SHAFT"),
    (r"^CONNECTING ROD$",       "rods",       "steel_polish", "rod"),
    (r"^BOLTS_CR$",             "rods",       "steel_dark",   "child:rod"),
    (r"^PISTON$",               "pistons",    "alu_machined", "piston"),
    (r"^PISTON PIN$",           "pistons",    "steel_polish", "child:piston"),
    (r"^valve$",                "valves",     "valve",        "valve"),
    (r"^Rocker Arm$",           "valvetrain", "steel_polish", "rocker"),
    (r"^Cam Shaft\d$",          "valvetrain", "steel_polish", "cam"),
    (r"^pully3$",               "valvetrain", "anod_red",     "join:cam"),
    (r"^pully2$",               "timing",     "anod_red",     "join:balancingshaft"),
    (r"^balancingshaft$",       "timing",     "steel_polish", "balance"),
    (r"^Rola intinzator$",      "timing",     "anod_red",     "roller"),
    (r"^timing belt$",          "timing",     "rubber",       "static"),
    (r"^(circlip|inafag)",      "timing",     "steel_polish", "static"),
    (r"^CYLINDER BODY$",        "block",      "alu_cast",     "static"),
    (r"^(Base|rear body)$",     "block",      "alu_cast",     "static"),
    (r"^(BEARING CAP SMALL|Bearing cap CS|Bearing cap CS_END)$", "mainbearings", "steel_forged", "static"),
    (r"^Bearing cap bolt CS_END$", "mainbearings", "steel_dark", "static"),
    (r"^CYLINDER HEAD2?-None$", "heads",      "alu_cast",     "static"),
    (r"^(RL_CH_BOLT|RL_BOLT)$", "heads",      "steel_dark",   "static"),
    (r"^rockers_pad_MODEL-MODEL$", "heads",   "alu_machined", "static"),
    (r"^(Part15|Part16)$",      "valvetrain", "steel_polish", "static"),
    (r"^JIS B 1521 SKF 6304$",  "valvetrain", "brass",        "static"),
    (r"^cylinder head cover1$", "covers",     "paint_cover",  "static"),
    (r"^Part1(_MIR)?$",         "ignition",   "coil",         "static"),
    (r"^Intake Manifold$",      "intake",     "carbon",       "static"),
    (r"^Intake Manifold A1?(_MIR)?$", "intake", "carbon",     "static"),
    (r"^Air filter$",           "intake",     "carbon",       "static"),
    (r"^(Klem|Klem2|Klem3)$",   "intake",     "alu_machined", "static"),
    (r"^Pipe1$",                "intake",     "alu_machined", "static"),
    (r"^(spk|spk1)$",           "intake",     "anod_red",     "static"),
    (r"^stand$",                "intake",     "steel_dark",   "static"),
    (r"^exhaust [12]b(_MIR)?$", "exhaust",    "inconel",      "static"),
    (r"^mufler1(_MIR)?$",       "exhaust",    "titanium",     "static"),
    (r"^T28 (Turbine Shaft|Compressor)(_MIR)?$", "turbo", "steel_polish", "rotor"),
    (r"^TURBO_ROTOR_\d+$",      "turbo",      "steel_polish", "rotor"),
    (r"^T28 Exh Housing 64(_MIR)?$",  "turbo",  "iron_cast",    "static"),
    (r"^T28 Comp Housing(_MIR)?$",    "turbo",  "alu_machined", "static"),
    (r"^T28 Bearing Housing(_MIR)?$", "turbo",  "iron_cast",    "static"),
    (r"^T28 ",                        "turbo",  "steel_dark",   "static"),
    (r"^(ISO |Indented)",       "hardware",   "steel_dark",   "static"),
]

def classify(name):
    b = base(name)
    for pat, g, m, r in RULES:
        if re.search(pat, b):
            return g, m, r
    return "misc", "steel_dark", "static"

meshes = [o for o in O if o.type == 'MESH']
info = {o.name: classify(o.name) for o in meshes}
unknown = [n for n, v in info.items() if v[0] == "misc"]
print("unclassified:", unknown)

# ---------------------------------------------------------------- 4. share identical meshes
shared = 0
by_hash = {}
for o in meshes:
    h = (base(o.name), local_hash(o.data))
    if h in by_hash and by_hash[h] is not o.data:
        old = o.data
        o.data = by_hash[h]
        if old.users == 0:
            bpy.data.meshes.remove(old)
        shared += 1
    else:
        by_hash[h] = o.data
print("meshes shared:", shared)

def set_single_material(me, mat):
    me.materials.clear()
    me.materials.append(mat)
    idx = np.zeros(len(me.polygons), dtype=np.int32)
    me.polygons.foreach_set("material_index", idx)

done = set()
for o in meshes:
    if o.data.name in done:
        continue
    set_single_material(o.data, MATS[info[o.name][1]])
    done.add(o.data.name)

# ---------------------------------------------------------------- helpers
def select_only(objs, active):
    for x in bpy.context.view_layer.objects:
        x.select_set(False)
    for x in objs:
        x.select_set(True)
    bpy.context.view_layer.objects.active = active

def join_into(target, others):
    if not others:
        return target
    if target.data.users > 1:
        target.data = target.data.copy()
    for x in others:
        if x.data.users > 1:
            x.data = x.data.copy()
    select_only([target] + others, target)
    bpy.ops.object.join()
    assert target.name in O, "join lost target"
    return target

def set_origin_world(ob, p):
    """move object origin to world point p without moving geometry"""
    if ob.data.users > 1:
        ob.data = ob.data.copy()
    inv = ob.matrix_world.inverted()
    lp = inv @ Vector(p)
    ob.data.transform(Matrix.Translation(-lp))
    ob.matrix_world = ob.matrix_world @ Matrix.Translation(lp)

def wcenter(ob):
    v = world_verts(ob)
    return Vector(((v.min(0) + v.max(0)) / 2).tolist())

# ---------------------------------------------------------------- 5. moving part assembly
crank = O["CRANK SHAFT"]
join_into(crank, [o for o in O if base(o.name) == "pully1"])

cams = sorted([o for o in O if re.match(r"^Cam Shaft\d$", o.name)], key=lambda o: o.name)
for p3 in [o for o in O if base(o.name) == "pully3"]:
    t = p3.matrix_world.translation
    cam = min(cams, key=lambda c: (Vector((0, c.matrix_world.translation.y, c.matrix_world.translation.z)) - Vector((0, t.y, t.z))).length)
    join_into(cam, [p3])

bal = O["balancingshaft"]
join_into(bal, [o for o in O if base(o.name) == "pully2"])

pistons = sorted([o for o in O if base(o.name) == "PISTON"], key=lambda o: o.name)
rods = [o for o in O if base(o.name) == "CONNECTING ROD"]
pins = [o for o in O if base(o.name) == "PISTON PIN"]
valves = [o for o in O if base(o.name) == "valve"]
rockers = [o for o in O if base(o.name) == "Rocker Arm"]

def parent_keep(child, parent):
    mw = child.matrix_world.copy()
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()
    child.matrix_world = mw

for pn in pins:
    p = min(pistons, key=lambda q: (q.matrix_world.translation - pn.matrix_world.translation).length)
    parent_keep(pn, p)
for b in [o for o in O if base(o.name) == "BOLTS_CR"]:
    c = wcenter(b)
    r = min(rods, key=lambda r: (wcenter(r) - c).length)
    parent_keep(b, r)

# turbo rotors: compressor wheel + shaft -> one rotor with origin on the shaft axis
rotors = []
for sh in [o for o in O if re.match(r"^T28 Turbine Shaft", base(o.name))]:
    v = world_verts(sh); c = v.mean(0); _, _, vt = np.linalg.svd(v - c, full_matrices=False)
    axis = vt[0] / np.linalg.norm(vt[0])
    comp = min([o for o in O if re.match(r"^T28 Compressor", base(o.name))],
               key=lambda o: (wcenter(o) - Vector(c.tolist())).length)
    join_into(sh, [comp])
    set_origin_world(sh, c.tolist())
    sh.name = f"TURBO_ROTOR_{len(rotors)}"
    rotors.append((sh, axis))

rollers = []
for r in [o for o in O if base(o.name) == "Rola intinzator"]:
    set_origin_world(r, wcenter(r))
    rollers.append(r)

# ---------------------------------------------------------------- 6. join statics per group
bpy.context.view_layer.update()
static_groups = {}
for o in list(O):
    if o.type != 'MESH' or o.parent is not None:
        continue
    g, m, role = classify(o.name)
    if role == "static":
        cy = wcenter(o).y
        side = "C" if abs(cy) < 0.06 or g in ("block", "mainbearings", "hardware", "timing") else ("L" if cy < 0 else "R")
        static_groups.setdefault((g, side), []).append(o)
static_names = {}
for (g, side), objs in static_groups.items():
    tgt = max(objs, key=lambda o: len(o.data.polygons))
    join_into(tgt, [o for o in objs if o is not tgt])
    tgt.name = f"STATIC_{g}_{side}"
    tgt["side"] = side
    static_names.setdefault(g, []).append(tgt.name)

# ---------------------------------------------------------------- 7. normals, tags
smoothed = set()
for o in O:
    if o.type != 'MESH':
        continue
    if o.data.name not in smoothed:
        smoothed.add(o.data.name)
        select_only([o], o)
    else:
        o["group"] = o.name[7:-2] if o.name.startswith("STATIC_") else classify(o.name)[0]
        continue
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(32), keep_sharp_edges=True)
    except Exception as e:
        print("smooth fail", o.name, e)
    g = o.name[7:-2] if o.name.startswith("STATIC_") else classify(o.name)[0]
    if o.name.startswith("TURBO_ROTOR"): g = "turbo"
    o["group"] = g

# keep only our own tags in the exported extras (drop CAD import metadata such as local file paths)
for idblock in list(O) + list(bpy.data.meshes) + list(bpy.data.materials):
    for k in list(idblock.keys()):
        if k not in ("group", "side"):
            del idblock[k]

# ---------------------------------------------------------------- 8. rig data
crank_pivot = crank.matrix_world.translation
cyl = []
for i, p in enumerate(pistons):
    pt = p.matrix_world.translation
    rod = min(rods, key=lambda r: abs(r.matrix_world.translation.x - pt.x))
    side = "L" if pt.y < 0 else "R"
    # bore direction: piston local axis lying in the YZ plane and pointing away from the crank
    M3 = p.matrix_world.to_3x3()
    cands = [M3.col[k].normalized() for k in range(3)] + [-M3.col[k].normalized() for k in range(3)]
    radial = Vector((0, pt.y, pt.z)).normalized()
    d = max(cands, key=lambda c: c.dot(radial) - 10 * abs(c.x))
    # crown: farthest piston vertex along bore axis from the pin
    v = world_verts(p)
    crown = float(((v - np.array(pt)) @ np.array(d)).max())
    radius = float(np.linalg.norm(((v - np.array(pt)) - np.outer((v - np.array(pt)) @ np.array(d), np.array(d))), axis=1).max())
    cyl.append({"piston": p.name, "rod": rod.name, "side": side, "pin": T(pt), "bigEnd": T(rod.matrix_world.translation),
                "bore": T(d), "crown": round(crown, 5), "radius": round(radius, 5), "x": round(pt.x, 4)})

# bank index: side + row (offset from crank axis along the bank normal)
for c in cyl:
    bv = Vector((c["bore"][0], -c["bore"][2], c["bore"][1]))  # back to blender
    n = Vector((0, -bv.z, bv.y)) if c["side"] == "L" else Vector((0, bv.z, -bv.y))
    pin_b = Vector((c["pin"][0], -c["pin"][2], c["pin"][1]))
    c["rowOffset"] = round(pin_b.dot(n), 4)
for c in cyl:
    outer = abs(math.atan2(-c["pin"][2], c["pin"][1])) > math.radians(50)
    c["bank"] = {("L", True): 0, ("L", False): 1, ("R", False): 2, ("R", True): 3}[(c["side"], outer)]

def nearest_cyl(pt):
    return min(range(len(cyl)), key=lambda i: abs(cyl[i]["x"] - pt.x) + (0 if (pt.y < 0) == (cyl[i]["side"] == "L") else 10))

cam_info = [{"name": c.name, "pivot": T(c.matrix_world.translation)} for c in cams]
vrig = []
for v in valves:
    pts = world_verts(v)
    c = pts.mean(0); _, _, vt = np.linalg.svd(pts - c, full_matrices=False); ax = vt[0]
    proj = (pts - c) @ ax
    perp = np.linalg.norm((pts - c) - np.outer(proj, ax), axis=1)
    hi = perp[proj > np.percentile(proj, 90)].max(); lo = perp[proj < np.percentile(proj, 10)].max()
    head_dir = ax if hi > lo else -ax           # points towards the valve head (into cylinder)
    tip = c - head_dir * np.abs(proj).max()
    headp = c + head_dir * np.abs(proj).max()
    ci = nearest_cyl(Vector(headp.tolist()))
    camd = sorted(cams, key=lambda k: (Vector((0, k.matrix_world.translation.y, k.matrix_world.translation.z)) - Vector((0, tip[1], tip[2]))).length)
    vrig.append({"name": v.name, "cyl": ci, "open": T(head_dir), "tip": T(tip), "cam": camd[0].name})
# intake/exhaust: per side, the cam nearer the engine centre-line (inboard, under the plenum) is intake
for side in "LR":
    sc = [c for c in cams if (c.matrix_world.translation.y < 0) == (side == "L")]
    inboard = min(sc, key=lambda c: abs(c.matrix_world.translation.y))
    for vr in vrig:
        if (cyl[vr["cyl"]]["side"] == side):
            vr["type"] = "intake" if vr["cam"] == inboard.name else "exhaust"

rrig = []
for r in rockers:
    pts = world_verts(r)
    rc = Vector(pts.mean(0).tolist())
    pivot = min(rocker_pins, key=lambda q: (q - rc).length)
    vr = min(vrig, key=lambda q: (Vector((q["tip"][0], -q["tip"][2], q["tip"][1])) - rc).length)
    tip = Vector((vr["tip"][0], -vr["tip"][2], vr["tip"][1]))
    rr = tip - pivot; rr.x = 0
    opn = Vector((vr["open"][0], -vr["open"][2], vr["open"][1]))
    tang = Vector((1, 0, 0)).cross(rr)
    sign = 1 if tang.dot(opn) > 0 else -1
    rrig.append({"name": r.name, "valve": vr["name"], "pivot": T(pivot), "lever": round(max(rr.length, 0.01), 5), "sign": sign})

def bb(ob):
    v = world_verts(ob)
    return {"min": T([v[:, 0].min(), v[:, 1].max(), v[:, 2].min()]), "max": T([v[:, 0].max(), v[:, 1].min(), v[:, 2].max()])}

rig = {
    "units": "m", "up": "Y",
    "crank": {"name": crank.name, "pivot": T(crank_pivot), "axis": [1, 0, 0], "throw": 0.035, "rodLength": 0.19},
    "cylinders": cyl,
    "valves": vrig,
    "rockers": rrig,
    "cams": cam_info,
    "balance": {"name": bal.name, "pivot": T(bal.matrix_world.translation), "ratio": 2},
    "rollers": [{"name": r.name, "pivot": T(r.matrix_world.translation)} for r in rollers],
    "turbos": [{"name": s.name, "pivot": T(s.matrix_world.translation), "axis": T(a)} for s, a in rotors],
    "static": static_names,
    "bounds": {o.name: bb(o) for o in O if o.type == 'MESH' and o.name.startswith("STATIC_")},
    "removedDuplicates": removed_dupes,
}

# ---------------------------------------------------------------- 9. export
tris = 0
dg = bpy.context.evaluated_depsgraph_get()
for o in O:
    if o.type == 'MESH':
        tris += sum(len(p.vertices) - 2 for p in o.data.polygons)
rig["sourceTris"] = tris
with open(os.path.join(OUT, "rig.json"), "w") as f:
    json.dump(rig, f, indent=1)

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "W16_web_prepared.blend"), compress=True)
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, "engine_raw.glb"),
    export_format='GLB', export_yup=True, export_apply=False, export_extras=True,
    export_normals=True, export_texcoords=False, export_materials='EXPORT',
    export_cameras=False, export_lights=False, export_animations=False,
)
print("BUILD OK", "objects:", len([o for o in O if o.type == 'MESH']), "tris:", tris)
