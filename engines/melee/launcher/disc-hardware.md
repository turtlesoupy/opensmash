# Melee insert-disc hardware

`disc-hardware.js` owns the Melee hardware. The shared launcher keeps its
existing music, lights, CRT treatment and draggable media. The disc label
reuses the cartridge artwork; the console badges read `fun`.

## Blender source

- `assets/fun-gamecube.blend`: editable console, separate hinged lid, materials,
  lights and camera. A hidden `Disc clearance reference` mesh can be unhidden
  to inspect the disc fit.
- `assets/fun-gamecube.glb`: web export, loaded by `createGameCube()`.
- `build_disc_hardware.py`: reproducible Blender construction, export and
  clearance validation. Run `blender --background --python
  engines/melee/launcher/build_disc_hardware.py` from the repository root.
  On macOS the binary is `/Applications/Blender.app/Contents/MacOS/Blender`.
  Inspection renders are written to `build/melee-hardware-preview/`.

The model has recessed controller sockets, contacts, memory-card doors,
vent openings, separate shell mouldings, carry handle, optical pickup and a
recessed disc well. It is authored locally; no model-generation API is needed.
The lightweight disc remains a Three.js ring with a real centre hole.

Blender uses Z up; the GLB uses Y up. The console front is +X. `DiscLid` has
its closed rotation at zero. `DiscSnapAnchor` and `DiscMouthAnchor` determine
placement. The lid opens 110 degrees behind the insertion path. The launcher
inserts along the console's up axis, keeps the disc rigid, eases through a lift and spin, and
closes the lid after the disc has settled below the roof. `disc-motion.js`
shares the timing between the real launcher and the preview play button.

## Inspection and validation

Run the website dev server and open `/tools/disc-preview.html`. Drag to rotate,
scroll to zoom, and use the insertion slider to inspect descent and lid
closure. This fixture has no audio and does not select a disc or start a game.

The Blender script checks triangle intersections at 201 poses through a
vertical descent and lid closure against the shell, deck and lid meshes.
The final fit includes the centre hole, spindle and disc thickness. This
checks the hardware sequence, not the shared scene's initial entrance motion.
Browser visual checks cover open, seated, half-closed and closed poses.
The production frontend build and all 285 website tests pass, including
motion continuity and separate disc-verification/engine-readiness coverage.

Melee uses its local ISO/GCM validator; desktop uses its native disc picker.
Verified discs skip setup. Chrome end-to-end validation used a real local USA v1.02 ISO: the copy
button produced the exact filename, disc verification completed, the launcher
transitioned into an embedded Donald Trump match, and gameplay rendered at
59 FPS with site sound off. Return to roster also completed. The engine
may still need its first-run Confirm action during startup. Native desktop
packaging was not rerun for this hardware change.
