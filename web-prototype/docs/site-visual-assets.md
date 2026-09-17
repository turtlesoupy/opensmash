# Site visual assets

How the 3D hardware, CRT intro, and mesh-generation tooling behind the
website's look were made. Nothing here is needed to run the site or generate
fighters; the finished assets are committed under `visual/assets`, the sources and
references under `asset-sources/`. Commands below run from `web-prototype/`.

## Retro cartridge

`visual/assets/n64-cartridge-tripo.glb` is a Tripo P1 multiview model generated from
front, side, and back references. It is used by the centered cartridge
control in the production visual runtime and rendered inside
the same low-resolution Three.js post-process as the glove, including the
posterized palette, dithered alpha edge, and dark one-texel outline.

The original procedural fallback can be rebuilt with:

```bash
blender --background --python tools/build_cartridge_model.py
```

## Recovered N64 console + fitted cartridge interaction

`asset-sources/n64-console-sketchfab-recovered.glb` is the recovered 718-triangle
viewer model with embedded diffuse, normal, and AO maps from NeoZeroo's
original Sketchfab upload.
The archival recovery remains untouched. Normalize its axes, scale, and texture
size for the site with:

```bash
blender --background --python tools/prepare_sketchfab_console.py
```

`visual/assets/hybrid-four-port-console-fitted.glb` preserves the recovered shell,
four ports, top switches, badge, and cartridge slot. A small flush cover adds
`FUN` light pipes, and a `CartridgeSnapAnchor` node drives the site interaction.
Rebuild that derived interaction asset with:

```bash
blender --background --python tools/build_console_cartridge_system.py
```

The cartridge is scaled to 44% of the console width. The receiver is derived
from the cartridge bounds and adds 0.006 units of clearance per side. It begins
centered in the open space between the top of the viewport and the console;
its idle depth sits closer to the camera. Pressing it springs the cartridge back
onto the console's drag plane and immediately gives the console a small upward
tilt. Dragging downward smoothly continues that tilt toward the cartridge while
rotating the cartridge into its entry angle well before it reaches the slot.
The console is treated as a fixed rounded rigid collider and the dragged
cartridge as a spring-driven movable rigid body. Off-axis approaches resolve
against the console's top, shoulders, rounded corners, and sides with normal
impulse, light restitution, and tangential friction. Only a narrow capture
throat around the cartridge centerline is open. Once the cartridge body reaches
the visibly seated point inside that throat, it clamps to the slot mouth and
finishes with a short non-overshooting insertion animation; high-speed pulls
cannot tunnel through the console. Releasing any incomplete drag always
springs it directly from the release point to the upper resting pose with a
small settling overshoot, without an intermediate slot or center waypoint.
Inside a tapered cone above the slot,
a progressive horizontal attraction stays gentle high up and grows assertive
near the opening; outside that cone there is no positional assistance. Approach
assistance also rotates the cartridge into the authored slot angle and eases it
onto the slot's exact depth plane while the console tilts slightly upward to
meet it. Once the cartridge is fully seated, the cartridge and console animate
off the bottom of the viewport. The presenter credit fades in first, followed
by the rest of the site two seconds later. Releasing the free cartridge launches
a fast clockwise Y-axis spring that leaves its label facing forward; inserting
it requires dragging it into the console slot. The hand mesh is always rendered
above both pieces of hardware.

The default runtime shader uses 2× pixels, 12 color steps, 50% posterization,
full edge dither, a 70%-strength 1px `#383838` outline, and display gamma 2.50.
The tuning controls remain part of the page but are hidden from the final UI.

## Tripo CRT intro screen

`asset-sources/tripo-crt-tv.glb` is a 10k-face-target, geometry-only Tripo v3.0
image-to-model result generated from the supplied Trinitron reference. The
optional cartridge intro gives the cabinet an authored charcoal material and a
segmented, physically curved screen. The default route loads the character-grid
site directly and plays the hosted MP4 trailer in the 4:3 video container
at the top of the page. The native player autoplays muted, loops, and follows
the site's sound preference after the user's first interaction.

Append `?intro=cartridge` to the local URL to preview the preserved cartridge
insertion experience. The default URL opens the running main screen directly.
`#skipboot` can still be added to the cartridge URL to bypass its interaction.

The full browser viewport uses a 199X-inspired two-stage treatment: a backdrop
pass adds the slight composite softness, color density, and pixel blending of
the original preset's color/NTSC stages, then `crt-viewport.js` adds the tube
edge, vignette, visible raster lines, RGB aperture grille, rolling luminance,
flicker, and analog noise above every page layer. Add `?crt=off` to compare the
page without the viewport effect, or `?crt=soft` for a restrained version of
the default exaggerated preset.

## Mesh generation

Meshy and Tripo are configured through the git-ignored `.env` file. The mesh
generator is dependency-free and uses Python 3's standard library.

Validate both API connections without spending generation credits:

```bash
python3 tools/generate_mesh.py check
```

Generate an untextured GLB (the cheaper geometry-only path):

```bash
python3 tools/generate_mesh.py generate \
  --provider meshy \
  --prompt "a low-poly fighting-game arena platform"
```

```bash
python3 tools/generate_mesh.py generate \
  --provider tripo \
  --prompt "a low-poly fighting-game arena platform"
```

Generate from ordered front, left, back, and right reference images with
Tripo's multiview model:

```bash
python3 tools/generate_mesh.py generate-multiview \
  --front front.png \
  --left left.png \
  --back back.png \
  --right right.png \
  --target-polycount 8000 \
  --name referenced-model.glb
```

Generate from a single concept or product reference image with Tripo:

```bash
python3 tools/generate_mesh.py generate-image \
  --image concept.png \
  --textured \
  --target-polycount 15000 \
  --name referenced-model.glb
```

Add `--textured` for textures and PBR maps. Meshy accepts optional texture
guidance with `--texture-prompt`; either provider accepts `--target-polycount`.
For example:

```bash
python3 tools/generate_mesh.py generate \
  --provider meshy \
  --prompt "a chunky red arcade joystick, centered, no background" \
  --textured \
  --texture-prompt "red enamel, brushed steel base, subtle wear" \
  --target-polycount 12000
```

Finished models are downloaded to `visual/assets/generated/` by
default. This folder is git-ignored because generated GLBs can be large. Use `--output-dir` or
`--name` to change the destination. Run the CLI with `--help` for all options.

Generation consumes provider credits. `--textured` may consume additional
credits, and Meshy's textured flow runs a preview task followed by a refine task.
