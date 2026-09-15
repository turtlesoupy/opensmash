# Custom results presentation

The native and web launch mod read identity data from the loaded costume, not
from its base fighter ID. Two customs using one moveset remain independent;
vanilla costumes have no identity extension and retain their original assets.

The converter preserves an explicit `emblem_stencil.png`, or extracts the 48×48
coverage stencil from a validated OpenSmash OSBV UI bundle. The results panel
uses `character.json`'s short name, the winner banner uses the full display name,
and the existing winner-background emblem uses a flat mesh generated from the
stencil. Emblems keep their aspect and holes. No extra panel badge is added.

The costume's material descriptor retains its original 24-byte HSD prefix. The
OSUI extension contains versioned, relocated pointers to name textures, results
geometry and the fitted head's bind-space bounds. Fighter geometry and lighting
are unchanged. The shared launch mod applies the extension only in results.
Winner portrait cameras fit the custom head and account for Melee's off-center
EFB crop; loser portraits retain the game's full-body capture.

`tools/upgrade_character_surfaces.py ID` also refreshes cached presentation. It
checks pinned source hashes and rebuilds from the original costume instead of
accumulating abandoned presentation data. Browser generation retains its 2 MiB
slot check and texture-size fallback. Native packaging and local browser
preparation both run this migration.

## Validation

Run with a current source-preserving Mario costume (legacy distorted fits are
rejected). The optional opponent costume is assigned a separate Mario color:

```sh
OPENSMASH_REVIEW_WINNER=1 python3 tools/validate_results.py \
  --costume build/characters/web-v1-77ed06f7738b2dcb/PlMrNr.dat \
  --opponent-costume build/characters/stevejobs-mario-results-v1/PlMrNr.dat \
  --case custom --frames 360 --output build/results-review
```

The validation-only mod triggers an actual blast-zone KO in a one-stock match.
Omit `OPENSMASH_REVIEW_WINNER` to make P1 lose. Captures use the real renderer,
results transitions and costume loading. The tool saves the framebuffer, launch
arguments and runtime log, checks each expected identity hook, and closes its
engine process. The validation mod is never bundled with playable clients.

The original character-selection menus, stock icons and announcer recordings
are outside this results-presentation change.
