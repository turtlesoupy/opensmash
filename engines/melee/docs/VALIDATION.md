# Mario character validation — 2026-09-08

**Current: revision 6.** See [SHAPE_VALIDATION.md](SHAPE_VALIDATION.md).
Revision 5 below was rejected: it flattened the head. These older results
are retained as history, not current visual approval.


## Chibi style restored (revision 5)

The user confirmed the earlier short, broad head was intentional. Revision 5
restores that chibi silhouette as the default; `--head-style uniform` retains
the optional revision 4 fit. Rowan’s default exported costume is byte-for-byte
identical to revision 2 (SHA-256 `a14d6c775e04ad2b73a7aea66b32706641c28377c139c6f453c6d74150aee039`).
The shoe fitting and unused-foot handling remain. The 23-test suite includes
a regression against the earlier profile, including all body transforms.

Revision 5 also passed all 1,067 complete export/decode audits, with zero
rejections (`build/character-export-audit-v5.json`). Rowan’s revision 5 combat
clip is in `build/validation-v5/rowanatkinson/`; it shows damage dealt and
received on Yoshi’s Story against CPU Peach. Other characters have not had
new revision 5 combat runs.

The revision 4 results below are historical coverage of the uniform option.


## Library coverage

Fit revision 4 was audited against all **1,067 local rigged GLBs**. All passed:

- GLB parsing, actual Mario bone fitting, finite fitted bounds, head aspect ratio,
  and normalized skin weights.
- HSD/GX binary export and independent decode of **4,117,491 triangles**,
  including every position, normal, UV, and envelope weight.
- Archive and palette constraints. The largest export uses 434 draw batches;
  this is not a runtime performance certificate.

Reports: `build/character-export-audit-v4.json` (per-character hashes/results),
`build/character-export-audit-v4.log`. The audit does not run the game for each
character. All mappings here target Mario, not arbitrary base fighters.

The automated test suite also passes all **22 tests**.

## Earlier uniform-head experiment

Revision 2 stretched Rowan's head width/depth 1.67× relative to height.
Revision 3 made head scaling uniform, but still used Mario's terminal head
joint as the height limit. The reference geometry reaches above that joint.
Revision 4 fits the uniformly scaled head to the original Mario head mesh.
Rowan's predominantly head-weighted vertices now reach Y=14.255; the original
Mario reference reaches Y=14.210. The 0.044 difference includes the reference
head-axis tilt. This is geometry alignment, not a subjective visual approval.

The reference-bound decoder handles the actual Mario envelope descriptors and
quantized GX positions. It is a diagnostic for this costume, not a general
DAT format implementation. The fitter also handles entirely unweighted foot
joints (Captain Ahab), without inventing geometry for the absent foot.

## Actual combat coverage

Standard versus matches use **Yoshi's Story against CPU Peach (level 1)**.
Battlefield/Final Destination were locked in the isolated fresh save.

| Character | Fit tested | Observations |
|---|---|---|
| Rowan Atkinson | 3 and 4 | Received and dealt damage (41% / 29% captured); intact movement, airborne and knockback poses; KO and respawn captured in revision 3; revision 4 captured 31% / 20% damage |
| Steve Jobs | 3 | Identity verified by black shirt/blue jeans; received and dealt damage (33% / 25% captured); mesh remained intact |
| Count Dracula | 3 | Identity verified by cape/red outfit; received and dealt damage (11% / 19% captured); KO/respawn and invulnerability rendering observed |

Clips and stills are under `build/validation-v3/<character>/`.
Revision 4 follow-up evidence is under `build/validation-v4/rowanatkinson/`.
Input scripts exercised attacks, aerials, special, grab, shield, crouch, and
both horizontal directions. Not every move or successful grab/throw has been
individually certified from the footage. Items were enabled in these smoke
tests. Four-player load, full movesets, all costumes, all fighters, performance,
UI/audio replacement, and browser/native runtime parity remain open.

## Validation harness pitfalls found

- A checkpoint after fighter selection can contain the old costume in RAM.
  Replacing its file does not prove the new character was loaded. Verify the
  rendered identity and begin before fighter selection (or clean boot).
- Changing a file's length changes Dolphin's extracted-folder virtual-disc
  layout. A run stalled with a reused state and a differently sized costume;
  padding back to the known slot size allowed the new model to load.
  `tools/pad_costume_slot.py` preserves the archive and fixed file size for
  this validation workflow. It cannot fix a state already containing a model.
- Restored memory-card state can disagree with the current isolated card.
  Validation continued without overwriting the card when prompted.
- The original DTM cross-character replay is **not replay-verified** and must
  not be treated as a deterministic acceptance fixture.
- Wall-time menu holds drift under capture load. The pipe controller also
  supports frame-counted holds against Dolphin's native PNG dump; selections
  still require visual confirmation. Combat clips are direct observations,
  not claims of identical deterministic outcomes.

The original ISO, original extracted assets, and existing OpenSmash source
are unchanged. Only generated staged games and isolated Dolphin profiles are
used. Dolphin remains floating on Codex's AeroSpace workspace at the configured
960×720 game viewport.
