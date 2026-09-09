# On-demand complete special sets

A request generates **every special for the uploaded character**: neutral, up,
 and down, each on ground and in air. SSB64 has these three special inputs;
there is no separate side-B. A single attack can never satisfy the request.

The pipeline is character-independent. It consumes the uploaded character's
name and portrait, immutable bundle bytes, and chosen rig profile. All twelve
upload rig profiles are supported by the compiler. Every newly generated set
must pass its own runtime checks on its actual rig and bundle before equipping.
The first end-to-end fixture is Weird Al on Mario; other rigs have compiler
coverage, not a claim of completed native rollout qualification.

## Two creative stages, zero judges

1. The writer describes the entire set: identity, signature, anticipation,
   action, recovery, ground/air difference, counterplay, damage, and timing.
2. The implementer receives that frozen description and rig capabilities and
   produces bounded pose, collision, launch, and effect data for all six contexts.
3. A deterministic compiler checks completeness, limits, frozen damage/timing,
   usable recovery launches, seamless pose endpoints, and hit-bound visual cues.
4. The native worker tests all six contexts for contact damage/reaction, an
   out-of-range miss, windup and active interruption cleanup, landing cancellation, and up-special recovery (27 scenarios per set). It records
   six 3-second previews automatically, without viewing or rating the frames.
5. Only the complete validated package can be equipped. Browser loading checks
   its content hash, actual character bundle hash, rig, and player binding.

There is no judge, aesthetic score, ranking, best-of selection, or visual repair
loop. Failed artifacts are retained. Explicit retries reuse the description;
validation retries also reuse the compiled package. First-run model outputs and
native results are under `experiments/special-sets/weird-al-first-run/`.

The five writing principles are in `server/specials/generate.js`: recognizable
identity, body-led timing, distinct move roles, honest danger cues, and restrained
visuals. Numerical contracts are authoritative; prose must agree with them.

## Runtime

The engine worktree is `BattleShip/.claude/worktrees/custom-attacks`, branch
`agent/custom-attacks`. The pipeline worktree is `attack-pipeline-worktree`,
branch `agent/attack-pipeline`. These changes belong together.

No Lua is required. Version 4 data describes native hit windows, root launch,
quaternion-interpolated local pose deltas, and rectangular prop/particle
assemblies. Effects have bounded trajectories and lifetimes. Collision-bound
pieces share their hit's trajectory; decorative pieces never query a target.
Gravity, collision, damage, hitlag, and hit reactions remain engine-owned.
Up specials consume recovery and finish in special fall or special landing lag on a platform. Landing, ledge catch,
damage, grabs, death, and other status changes cancel the active snapshot.

Six slots are atomically loaded per player; an invalid reload retains the last
complete registry, and an in-progress attack retains its snapshot. Four players
may have distinct sets on the same rig. Existing v1/v2 experiments and v3 sets remain supported. Generated v3/v4 moves require a full set envelope. New native and browser builds must ship together; old loaders reject v4 safely.

Current limits: 150 frames, 12 semantic tracks with 16 keys, eight sequential hit
windows, 1,024 compiled visual segments per context, and at most 224 simultaneously visible rectangles. Packages are limited to 1 MiB per character; the four-player registry accepts at most 4 MiB. The graphics heap allocation remains capped at 224 quads per fighter. Effects are finite interpolated/spinning pieces; arbitrary Lua,
homing, reflection, healing, persistent projectiles, custom sound synthesis,
and branching scripted state machines are outside this version. The generation
prompt makes those capabilities explicit instead of promising unsupported moves.

Custom specials are offline-only. The native netplay guard remains enabled.
The browser launch bridge supports pinned direct-match character selections.
A rig override drops an incompatible equipped set. CSS roster switching and
netplay need explicit package exchange/binding before enabling specials there.

## Run locally

Build the engine's native target in its isolated worktree, with the usual local
runtime resources. The worker needs Python, ffmpeg, and a working graphics
backend (Metal on macOS; configurable `SSB64_GFX_BACKEND` elsewhere).

From `web-prototype`:

```sh
export OPENAI_API_KEY=... # use the normal secret environment
export SPECIALS_MODEL=gpt-5.6-luna # default; explicitly overridable
export SPECIALS_ENABLED=1
export SPECIALS_ENGINE_ROOT=/absolute/path/to/BattleShip/.claude/worktrees/custom-attacks
npm run dev
```

Open an uploaded character's settings, choose **Generate all specials**, inspect
the frozen descriptions or preview URLs, then **Equip special set**. The roster
refreshes immediately for the next match. Other normal moves remain unchanged.

The API and worker both need these changes. Remote worker configuration must
supply the model key and a qualified native runtime/capture environment before
`SPECIALS_ENABLED=1` is set on the API. This branch does not deploy or enable the
feature on the production service. A compiled set never bypasses a missing
validation worker.

Standalone generation:

```sh
node server/specials/cli.js character.json /new/output/directory mario /path/to/character.osb
python3 "$SPECIALS_ENGINE_ROOT/experiments/custom-attacks/validate_set.py" \
  --package /new/output/directory/package.json --bundle /path/to/character.osb \
  --output /new/validation/directory --capture
```

`character.json` provides `id`, `name`, and optionally `description`. The CLI
pins the supplied bundle bytes. `SPECIALS_ENV_FILE` optionally loads a local
secret file; it is never stored in output. Production reads environment secrets.

## API and persistence

- `POST /api/fighters/:id/specials` with `{ "requestId": "stable-client-UUID" }`
- `GET /api/fighters/:id/specials` returns latest job and enablement.
- `GET /api/fighters/:id/specials/:runId`
- `POST .../:runId/cancel`, `retry`, or `equip`
- `GET /engine/specials/:id/:runId.json` returns a validated package.
- `GET /engine/specials/:id/:runId/:slot.mp4` returns its preview, supporting
  byte ranges for mobile playback.

Mutation endpoints require the existing signed-in fighter owner and ROM session.
Package/preview access follows the fighter's visibility. Stored special
artifacts are private, and the API gates reads. Generation is bounded to one
active request per owner, ten creations daily, eight global active jobs, and
100 global daily creations. A stable request ID returns the same job.

Special jobs use their own local directory / Firestore collection (`specialJobs`,
overridable by `FIRESTORE_SPECIALS_COLLECTION`). `jobKind: specials` routes both
Cloud Run service dispatch and Cloud Run Job execution to the correct worker.
Leases fence cancelled and superseded workers. Local DB mutations use a
cross-process lock. Leases renew while a worker is alive. Expired running jobs become failed during periodic reconciliation;
an explicit retry resumes saved work. There is no recurring judge/retry daemon.

## Validation

```sh
npm test
npm run build
```

Engine tests: `test_moves.cpp` for legacy loader/pose compatibility,
`test_sets.cpp` for atomic all-slot reload and player isolation,
`test_browser_sets.mjs` for bundle/hash/rig binding, and `validate_set.py` for
actual native collision, recovery, cancellation, and preview capture. These
checks do not assess visual quality or roster-wide game balance.

## Rich compact score (default)

`server/specials/rich.js` is the default implementer contract. `full` is an
explicit legacy comparison option; `reduced.js` retains the earlier experiment.

The implementer defines three designs with air overrides, shared palette,
reusable detailed props, assembly keyframes, native hits, and particle glyph
trails. Repeated folds, keys, borders and buttons use a count and step vector.
The compiler generates layered curves and staggered trajectories. No new code,
image model, Lua interpreter, judge, or model repair call is involved.

Deterministic conventions remove redundant arithmetic:

- Relative hit rhythm anchors at frozen startup and fits a shared action interval that leaves twelve recovery frames in both contexts. Body and prop keyframes follow the same time warp; overlapping windows clip at the next beat. Damage weights allocate the frozen total.
- The main prop lifetime includes eight anticipation frames and at least eight
  follow-through frames. Authored positions and scale keys remain intact.
- Air timing remaps startup and recovery separately, with per-joint overrides.
  Up recovery launches immediately in air, with a vertical speed floor of 70.
- Props default to z=120 in front of the body; local z layers their details.
  The signature prop has a 400-unit minimum extent before animated scale, and details have a one-world-unit minimum thickness.
- Curved danger cues follow collision direction, radius, trajectory and lifetime.
  Trails sample independent birth positions, then drift, fall, spin and fade.
- Unknown references, collapsed keys, invalid hits, unsupported joints, excessive
  packages and per-frame overflow fail closed. There is no silent truncation.

The compact score and fully expanded packet describe the same implementation.
Recompilation is deterministic; comparing byte sizes measures representation
compression, not a model-quality win. Comparisons with the earlier full-model
rollout are separate creative outputs. Recorded costs must include both writer
and implementer; native validation/capture and hosting are separate.

Aerial neutral/down showcase and contact fixtures begin at height 2400, above the side platforms, so the complete action can play. Separate low-height (1100) landing scenarios test normal cancellation. This fixes the earlier fixture that landed after about twelve frames and could hide later effects. Every authored hit now has its own native contact probe. Horizontal ground impulses remain grounded; they no longer turn into zero-height jumps that cancel on landing.

### Visual construction correction (September 9)

Mechanical acceptance did not catch the compact accordion/particle regression.
The implementation score now explicitly selects `construction`: `pieces` for
arbitrary geometry, or reusable `bellows`, `music-note`, and `straw` primitives.
New structured-output calls require this choice; older scores default to `pieces`.
There is no character-name lookup or automatic substitution. The bellows library
preserves the approved prototype's construction: repeated separated pleats,
rigid red cases, ivory keys/buttons, and extension timed to every emission.

Glyphs have a minimum 100-unit extent, retain strong alpha before their final fade,
and rotate as connected objects. Straw additionally uses a thicker outlined
silhouette. Trail motion inherits both axes of the local hit trajectory. Every
compiled trail segment carries `anchorFrame`, the original emission frame.
Native v4 rendering samples the fighter root at that simulation frame, so a rising
fighter cannot drag falling fragments upward. History is bounded per player,
cleared at move entry, paused with the move during hitlag, and discarded on cancel.
Danger cues cannot use birth anchors: they must follow the actual current hitbox.
Older packets without this optional v4 field retain their previous behavior.

The corrected Weird Al fixture explicitly selects three primitives in an authored
visual migration. It is not an untouched new model result. Descriptions, tracks,
launches, and hitboxes remain identical. This isolates the construction/runtime
fix; it does not measure fresh model visual reliability. Production remains two
creative stages and deterministic validation, with no judge or model repair loop.
