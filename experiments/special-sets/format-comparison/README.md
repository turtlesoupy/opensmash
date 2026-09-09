# Reduced authoring comparison

This experiment compares full numerical authoring with a small reduced format.
It does not change the production/default generator or native runtime ABI.

## Protocol

- Freeze the earlier Weird Al description, all six contexts, identity and rig.
- Generate one full and one reduced implementation with GPT-6 Astra, then with
  GPT-5.6 Luna, using sequential Standard API requests and the same 24k output
  cap. No judges, repairs, best-of selection, or screenshots in model prompts.
- Save requests, raw responses, usage, elapsed generation time, and failures.
- Expand reduced data into the existing full implementation schema, then use
  the same compiler and native acceptance suite for both formats.
- Each compiled set must pass six contact, six miss and six interruption checks.
  Miss checks also verify recovery height and exhausted fall for both up moves.
- Capture all six miss scenarios with the same engine/camera/bundle/input frames.
  Preview composition only labels and places captured frames side by side.
- Include the earlier validated full implementation as a historical reference,
  visibly distinct from the fresh full-format sample. It is not a replacement
  for a failed trial in the measured results.

This is one character and one sample per cell, not a reliability estimate.
The old description is deliberately retained, including its unusually long
neutral-special duration; neither format is allowed to rewrite the brief.

## Reduced format

`web-prototype/server/specials/reduced.js` adds only an authoring layer:

- Three base moves with explicit per-joint air overrides.
- A shared color table and reusable rectangular prop assemblies.
- Bounded deterministic fan emitters for decorative fragments.
- Automatic zero-pose start/end keys.
- Air timing mapped around the existing ground/air startup and duration.
- Damage allocated as positive integer shares of the frozen total.
- Bound visuals inherit collision timing. Fixed knockback and impulse defaults
  are stated in the implementation prompt; arbitrary keyframes remain supported.

Expansion rejects invalid data through the full schema/compiler. It does not
truncate excessive effects, silently discard pose keys, or ignore bad references.
No Lua, animation-primitive library, or new runtime interpreter is introduced.

The defaults do reduce the available authoring choices: per-piece spin and
custom knockback are not exposed by this first reduced schema. The comparison
therefore tests this specific format, not lossless compression of the old one.

## Reproduce

From the pipeline worktree, with a configured API key and the same input bundle:

```sh
SPECIALS_ENV_FILE=/path/to/local.env \
SPECIALS_COMPARISON_BUNDLE=/path/to/character.osb \
node web-prototype/server/specials/compare-formats.js /tmp/new-format-comparison
```

Run the engine's `experiments/custom-attacks/validate_set.py --capture` on each
compiled package. Preserve failures; do not modify generated outputs. Estimated
cost uses recorded input/cache-write/output usage and standard rates published
at https://developers.openai.com/api/docs/pricing on 2026-09-08. Description,
preview rendering, storage, and development costs are excluded.

## First-pass results

| Model / format | Output tokens | Generation | Estimated implementation USD | Compilation |
| --- | ---: | ---: | ---: | --- |
| Astra / full | 10,775 | 156 s | $0.575780 | Failed: first hit had no danger cue |
| Astra / reduced | 8,458 | 144 s | $0.464205 | Failed: undefined color and prop references |
| Luna / full | 4,470 | 27 s | $0.006105 | Failed: up-special launch occurred after first hit |
| Luna / reduced | 2,987 | 27 s | $0.004411 | Passed all six contexts |
| Earlier Astra / full reference | 11,424 | Not recorded | $0.607805 | Previously validated; recaptured separately |

The fresh reduced output used 21.5% fewer output tokens on Astra and 33.2% fewer
on Luna. These savings are below the proposed 3–5× target. Generation latency
improved by only 7.5% / 2.3% in this single sequential trial. Reasoning tokens
are included in output totals and costs. The four fresh calls together cost an
estimated $1.050501 at Standard rates, including failed attempts.

The only fresh implementation to compile was Luna/reduced. The displayed visual
pair therefore changes BOTH format and model: the historical full Astra reference
versus the new reduced Luna implementation. This is explicitly labeled, not
presented as a successful controlled full-versus-reduced visual trial. Raw failed
outputs are retained. Do not infer reliable model success rates from four samples.

The historical reference has 420 expanded pose keys and 9–15 visual parts per
context; Luna/reduced expands to 224 keys and 4–5 parts. It made simpler visual
choices, so its cost saving cannot be attributed entirely to deduplication.
Against the fresh failed Luna/full output (156 pose keys), the reduced compiled
output actually expands to more keys despite fewer output tokens.

No default generator settings or production paths were changed. These are
experiment-only modules and evidence, not a claim of production readiness.

## Native failure and interpretation

The earlier full reference passed 18/18 checks again. The fresh Luna/reduced
set failed the air up-special recovery-height check after compiling. Its
initial fail-fast native report remains unchanged. The comparison completion
script reuses finished logs, runs the remaining independent scenarios, and
captures every move including failed recovery; it does not repair the attack.
Completed audit details are in `native-comparison-report.json`.

Before the compiler correction, this trial produced no newly qualified complete set. The reduced format lowers
output volume, but this evidence does not establish better model understanding
or production reliability. The prototype remains opt-in experiment code.

## Compiler correction, with no new model call

The failure exposed a reduced-format default bug: it scheduled the air-up
launch at the first hit (frame 17). Native gravity landed the fighter before
that frame; measured rise was zero and exhausted special fall never occurred.

The compiler now launches air up at frame 0. Ground-up launch remains at its
startup. The original generated response is unchanged. A structural comparison
confirmed that only slot 4's `motion.frame` changed, from 17 to 0, and that the
other five compiled moves are byte-identical when serialized.

The three affected native scenarios are rerun. The other 15 checks reuse
completed native evidence for those identical moves, with the same bundle and
engine hashes. This is incremental qualification, not 18 fresh native launches.
`luna-reduced-launch-fix/change.json` and its native comparison report record the
change and the source package hash for each scenario. The first-pass report and
failed video remain available. No model retry, judge, or animation retuning was
used. The current implementation prompt documents the corrected launch default;
original request snapshots retain the exact prompts used in the four trials.

Final correction result: all 18 scenarios are covered (15 reused, 3 rerun).
Air-up rise increased from 0 to 1,357.599 world units, exceeding the 350-unit
requirement, and exhausted fall passed. All six contact probes dealt their
frozen damage amounts: 11, 9, 15, 9, 8, and 13. Web tests: 286 passed.
