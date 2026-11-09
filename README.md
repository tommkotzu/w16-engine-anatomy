# W16 Engine Anatomy

An interactive, animated W16 engine in the browser, explained in five chapters: layout, the four-stroke cycle, the crank train, the valvetrain, and the air path through four turbochargers. English and German UI.

**Live:** https://tommkotzu.github.io/w16-engine-anatomy/

## Features

- Real kinematics computed in the browser: crankshaft, 16 pistons and rods, 32 valves with rocker arms, 4 camshafts at half crank speed, balance shaft, belt idlers, turbo rotors
- Five guided chapters with callouts, live readouts (crank angle, valve lift, piston travel), a stroke stepper and a firing-order strip
- Render styles: **Real** (PBR, contact shadows, shadow mapping), **Clay**, **Cel** (colour-coded with legend), **Wire** (quad-dominant wireframe)
- X-ray housings, explode slider, hover/click part info, isolate
- Lens panel: focal length, depth of field with autofocus and f-stops, exposure, glow, contact shadows, vignette, chromatic aberration, film grain
- Adaptive quality: drops glow, ambient occlusion and resolution on slow devices

## Layout

```
src/page.html      markup + styles
src/strings.js     EN/DE text
src/app.js         three.js app (kinematics, materials, view modes, UI)
build/build_glb.py Blender (background) export: materials, mesh sharing, static joins, rig.json
build/optimize.mjs glTF-Transform: per-part simplification + meshopt compression
build/assemble.py  inlines the app into the page, writes docs/ (GitHub Pages)
docs/              deployable site
```

## Build

```bash
blender -b source/W16_engine_backup.blend --factory-startup -P build/build_glb.py -- build/out
mkdir -p web && cd build && npm install && node optimize.mjs out/engine_raw.glb ../web/engine.glb && cd ..
cp build/out/rig.json web/
python3 build/assemble.py
python3 -m http.server 8137 --directory docs
```

The source `.blend` is not in the repository. The models ship as base64 text (`engine.b64.txt`, plus an uncompressed fallback for browsers that block WebAssembly) so the same build also works on hosts that only serve standard web file types.

## Model

The engine is derived from a third-party CAD assembly ("high detailed W16 engine assembly, functional internals"). Check the original model's license before reusing it.
