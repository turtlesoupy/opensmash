# Injected characters in Melee's character select

Desktop launches and browser launches stage select-screen assets alongside the
costumes in their launch plan. The verified source disc remains unchanged.

The two arrows in the empty lower corners page through the roster. Point a
player hand at an arrow and press A. Page zero shows vanilla fighters where an
original costume remains available. Further pages show prepared customs in their
moveset's cell; customs sharing a moveset occupy successive pages. The original
player hands and tokens still hover, select, cancel and advance to stage select.
Confirmed player identities survive page changes. A token is hidden when its
character is not on the visible page; its player panel retains the selection.

Roster tiles and player panels use `portrait_raw.png`, and the panel name comes
from `character.json`. User-selected nametags retain Melee's existing behavior.
Confirmation plays that character's `announcer.wav` through Melee's audio mixer,
with the clip's own sample rate and pitch. Vanilla selections use an available
original costume rather than an injected costume masquerading as the base fighter.
If all of a base fighter's costumes are injected, that cell retains a custom
identity instead of offering a nonexistent vanilla costume.

## Implementation

`opensmash_melee/character_select.py` appends a relocated OSCS v1 registry and
arrow joints to both language versions of `MnSlChr`, preserving existing joint
indices. It converts the short PCM announcers to DSP ADPCM and extends both
`nr_select.ssm` banks. The banks are rebased to sample 0x7000 to avoid collisions
with Classic's announcer bank. Original selection samples are remapped at the
synthesizer entry; all other sound banks retain their IDs.

`runtime/mods/character_select.h` reads that scene-owned registry. Identity is
keyed by external fighter ID and costume color, not by fighter ID alone. Hover
updates are attached to the portrait routine and the verified name call site:
some native recompiler chunks contain both the cursor and door routine, so an
observational hook on the door routine alone misses internal branches. Temporary
portrait overrides are restored after each CSS draw. They run at the verified
GObj call into `HSD_JObjDispAll`; hooking the shared GObj scheduler chunk itself
stalled native menu/results rendering. Recursive child draws cannot restore the
outer overrides early. No costume heap pointers
are retained across scenes. Audio identity is retained per announcer track until
the asynchronous sound script reaches the synthesizer.

JIT compilation must end a block before a mod hook, even when branch following
would inline that function into its caller. The native patch also executes an
observational hook's first guest instruction once before returning to JIT code;
otherwise a cache miss can dispatch the same hook twice. These boundaries are
required for CSS initialization, arrow presses, and balanced render overrides.

The desktop service stages these files in its private lineup directory. The
browser prepares them through `/api/character-select`, installs them before
releasing the first-scene barrier, and updates their virtual-disc file lengths.
Rebuild the native mod / Wasm runtime with the UI; older browser runtimes report
an explicit update error rather than launching without the injection API.

The available in-game customs are the prepared launch lineup (currently up to
four distinct injected costumes), not an on-demand browser for the entire web
catalog. Import and prepare a character through the existing launcher first.
The standalone Swift launcher does not yet stage this registry; the integrated
desktop service and local browser do.

## Validation

```sh
python3 -m unittest discover -s tests -p test_character_select.py
python3 tools/validate_character_select.py \
  --entry stevejobs-mario-results-v1:8:0 \
  --entry alanturing-mario-game-v1:8:1 \
  --output build/css-vs-review
# Add --mode 0/1/2/3/4 for each boot route (3 is Classic).
# Add --runtime build/desktop-runtime to test the integrated desktop engine.
# Use a new output directory for each run.
```

The private runtime review stages actual costumes, drives left/right, hover and
confirmation with a validation-only mod, records the selected fighter/color
pairs, captures the native framebuffer, and dumps the actual audio mix. The
validation mod is never packaged in playable clients. Asset tests verify DAT
relocation, unchanged existing joint indices, isolated sound IDs and ADPCM
round-trip fidelity; the C harness exercises the actual runtime callbacks.

The launch-mode review follows Full Boot through title/menus, VS Menu into CSS,
and Free-for-All through combat, no-contest results, stage select and Back to CSS.
Full Boot starts on the vanilla page and the review explicitly pages to the custom.
The C harness also verifies fresh archive discovery after CSS exit, preservation
of both same-moveset identities, one-time routing in all five modes, and that
re-entering Classic does not overwrite the player's later selection.
