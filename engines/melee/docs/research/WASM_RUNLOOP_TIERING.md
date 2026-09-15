# WASM CPU-loop re-entry — September 13, 2026

V8 initially runs WASM functions with its baseline compiler. Newly optimized code
is used on a later call; an existing activation does not switch tiers. A CPU loop
that stays inside one invocation for the whole emulation session can therefore
miss that optimization. See [V8's compilation pipeline](https://v8.dev/docs/wasm-compilation-pipeline)
and [current WASM architecture](https://chromium.googlesource.com/v8/v8/+/main/docs/wasm/architecture.md).

The browser patch returns from the static-recompiler CPU loop after 64 complete
CoreTiming slices. At that boundary, guest state has already been synchronized
back to PowerPCState. CPUManager immediately invokes Run again. No guest work,
cycle charge, interrupt boundary, graphics operation or audio sample is skipped;
no sleep or frame-counter adjustment is introduced. The native builds do not
apply this browser patch.

## Evidence

The 512-region game archive is unchanged from the archive that passed 1,835,008
full-state/memory/callback comparisons after extending the scenarios. This comparison validates generated game
code, not the CPU scheduling change. The run-loop change is checked separately
through gameplay, frame pacing, audio, replay and the retained WASM call graph.

| Four-stock Battlefield build | FPS in three 30-second windows |
| --- | --- |
| 512 regions, corrected PC boundaries (`cdb257af543a7e28`) | 54.35, 55.77, 57.20 |
| Same game code, periodic CPU-loop re-entry (`a5a6022cc087b619`) | 59.16, 59.93, 59.94 |

The latter passed every window's FPS, p95/p99 and audio gate, with replay and no
reported runtime errors. Its WASM is 128,889,122 bytes, only 15 bytes larger than
the comparison build. All tests used normal headed Chrome on the Apple M5,
without special V8 flags. Raw evidence: `build/wasm-robust/reentry-stock/` and
`build/wasm-robust/coverage-stock/`.

This is not yet a universal 60 FPS certificate. The broader stock/stage matrix
has exposed startup stalls and a persistent Fountain of Dreams shortfall. Those
failures are retained in `build/wasm-robust/matrix/`; they must not be replaced by
the successful original-matchup result.

## Stock roster and stage coverage

The 26 stock fighter IDs were covered across seven four-player lineups (some
fighters repeat), with three level-9 CPU opponents, 20 stocks and five stages.
Each row is three consecutive 30-second windows; every requested window must
pass the existing FPS, p95/p99 and audio thresholds. Replay also passed.

| Fighter IDs | Stage | FPS windows | All-window gate |
| --- | --- | --- | --- |
| 8, 2, 0, 6 | Battlefield | 59.16, 59.93, 59.94 | Pass |
| 2, 20, 9, 19 | Final Destination | 54.40, 59.53, 59.35 | Fail |
| 5, 1, 4, 13 | Fountain of Dreams | 43.61, 47.20, 47.13 | Fail |
| 14, 12, 16, 15 | Dream Land | 56.60, 59.93, 59.03 | Fail |
| 10, 11, 17, 18 | Pokémon Stadium | 52.32, 58.42, 56.04 | Fail |
| 7, 21, 22, 23 | Battlefield | 58.30, 60.03, 59.77 | Fail |
| 3, 24, 25, 0 | Final Destination | 55.73, 59.94, 59.03 | Fail |

Moving the Fountain lineup (Bowser, Donkey Kong, Kirby and Pikachu) to Battlefield
passed the same strict gate. Evidence: `build/wasm-robust/heavy-battlefield/`.
This isolates a substantial stage contribution; it does not establish that every
character or stage combination will sustain 60 FPS. The Fountain CPU profile
averaged about 897 draw calls and 266,214 translated dispatches per frame, versus
562 and 192,714 in the earlier original Battlefield profile. Those profiled runs
include instrumentation overhead and are not used as FPS gate results.

## Other results and correctness work

- Extending PC deferral around arithmetic helpers alone gave 53.63–56.52 FPS.
  A repeat committed baseline was 51.97–53.20 FPS; attribution needs repeats.
- Forcing memory-helper inlining plus a direct FP-enabled check gave
  50.43–53.33 FPS and was removed.
- Four extra math-LTO regions gave 54.74–56.80 FPS, overlapping the 512-region
  comparison. The extra LTO configuration was removed.
- Expanded coverage exposed an unsafe substring match in the PC-store pass:
  a self-branch's exit-PC assignment could be mistaken for an entry store.
  Only a store at the beginning of the instruction body is now removable.
  Focused regression checks and the expanded differential comparison pass.
- The comparison runner now shards independent regions across four processes
  and reports failures instead of discarding the child's diagnostic output.

## Threading follow-up

With CPU-loop re-entry in place, a new normal dual-core run on Fountain produced
54.63, 54.36 and 54.19 FPS (`b89da8b89c4dbed1`), compared with 43.61, 47.20 and
47.13 in single-core mode. Audio had zero underruns and replay passed, but every
window still failed the strict gate. This is a materially different result from
the earlier rejected threading trials, and still requires wider validation.

The first GPU helper's C++ `noinline` attribute did not preserve its boundary:
its name is absent from the final symbol map, and the profile places the loop in
the worker entry. Binaryen's single-caller inlining can eliminate these functions;
[its inlining implementation](https://raw.githubusercontent.com/WebAssembly/binaryen/main/src/passes/Inlining.cpp)
treats exported functions differently. The next candidate preserves exported
work/batch boundaries and returns after at most 64 packets per batch, immediately
continuing the same FIFO drain. Packet ordering, interrupts, async requests and
final flush operations remain intact. The final symbol map and call graph confirm
those boundaries survive (`25c572b11e57f5d9`), but Fountain windows of 53.90, 54.74
and 55.33 FPS overlap the first threaded trial. This does not establish a useful
independent gain; the extra GPU loop structure has been removed.

Separating the FIFO queue counter, CPU/GPU pointers and status fields onto
128-byte-aligned storage produced 58.00, 58.00 and 54.19 FPS on Fountain. This
improves some windows but does not establish robust 60 FPS. The next experiment
uses the original GPU drain loop and requests sleep on an empty queue, through
BlockingLoop's existing wakeup protocol.

An expanded FP-PC-deferral/direct-FP-check candidate (`e0ffef5742c1c062`) passed
1,835,008 full-state/memory/callback cases, including randomized FPSCR and disabled
lazy FP gating. It produced 58.23, 56.87 and 56.57 FPS, overlapping the previous
candidate. Its generator changes were removed; the additional comparison
scenarios are retained. The restored integer game archive matches the previously
validated SHA-256 exactly.

The empty-queue-sleep candidate (`a906c56a936035e4`) regressed Fountain and was
removed. A subsequent candidate retains busy polling, but skips most redundant
full payload calls only while BlockingLoop is idle and awake. Pending work is
handled immediately; sleeping timeouts still invoke the payload, and a full
status poll remains every 64 idle iterations. A Wasm/Node concurrency check passed
200,000 producer wakeups plus 20 unsignaled timed checks. This is a synchronization
check. Its Fountain windows were 57.70, 57.36 and 59.75 FPS; only the last passed.


## Static FIFO writes and current validation

The static-recompiler MMIO write path now uses Dolphin's FastWrite plus
FastCheckGatherPipe operations. They retain byte order, buffering, FIFO bursts
and journaling, while omitting the dynamic-JIT FIFO profiling call. GPFifo.cpp
and Memmap.cpp join the existing small C++ LTO set so constant-size copies can
inline through that path.

Build `f60b3f3bbd856e7f` produced 57.63, 59.16 and 59.60 FPS on four-stock
Fountain, with zero audio underruns and successful replay. The first window
failed; the later two passed. Its injected Battlefield run passed all three
windows at 59.90, 59.93 and 59.97 FPS. These tests do not establish universal
60 FPS. Raw evidence is in `build/wasm-robust/fifo-fast-fountain/` and
`build/wasm-robust/fifo-fast-injected/`.

A longer preparation barrier (120 frames averaging under 17 ms instead of 30
under 20 ms) did not resolve Fountain's gameplay dips and was removed. The
simulation was held during preparation, and the measured gameplay thresholds
were unchanged. Evidence: `build/wasm-robust/prepared-fountain/`.

### Full roster repeat on the FIFO candidate

All seven cases used three strict 30-second windows, four stock fighters, active
audio and replay. Five cases passed every window; Fountain and the Ice Climbers
matchup failed. No runtime errors or audio underruns were reported.

| Matchup | Stage ID | FPS windows | All gates |
| --- | --- | --- | --- |
| original | 31 | 59.55, 59.94, 59.94 | Pass |
| space-animals-swords | 32 | 59.64, 59.75, 59.77 | Pass |
| heavyweights | 2 | 54.8, 57.07, 58.43 | Fail |
| climbers-peach-samus-puff | 28 | 58.47, 59.93, 59.93 | Fail |
| psychic-transform | 3 | 59.26, 59.93, 59.94 | Pass |
| plumbers-swords | 31 | 59.68, 59.93, 59.93 | Pass |
| remaining-stock | 32 | 59.48, 59.97, 59.94 | Pass |

Evidence: `build/wasm-robust/fifo-matrix/summary.json`. The reusable runner is
`tools/validate_wasm_roster.py`; it exits unsuccessfully if any case fails.


### Longer runs and shader-cache investigation

A load-before-CAS guard in BlockingLoop passed the concurrency test but showed
no useful gameplay gain and was removed. With a larger shader seed, its six
Fountain windows were 56.42, 59.06, 59.13, 58.13, 49.27 and 39.07 FPS. The last
window had 5,632 audio-underrun samples. The tab stayed visible and focused.
The machine also had only about 3 GB of disk space left and background system
work was active, so the late collapse cannot be attributed solely to that edit.

Discarded candidate runtimes and temporary test profiles were removed, freeing
about 4 GB. The harness now deletes its Chrome profile after saving evidence;
`MELEE_KEEP_BROWSER_PROFILE=1` retains one explicitly for investigation.

The restored `f60b3f3bbd856e7f` runtime, with the larger shader seed, measured
58.84, 55.71, 58.83, 59.03, 58.71 and 57.03 FPS. It had no audio underruns or
runtime errors and replay passed. Cleanup occurred during its early portion,
so this is diagnostic evidence, not a clean before/after comparison. It still
fails the strict gate. Evidence: `fifo-long-fountain/` and `idle-guard-fountain/`
under `build/wasm-robust/`.

The original warmup contained 96 portable pipeline descriptions. The full stock
sweep produced a union of 833 (482,315 bytes), validated against Dolphin's v8
579-byte SerializedGXPipelineUid layout. These are render-state descriptions,
not game assets or driver binaries. The larger seed alone gave Fountain 58.00,
58.73 and 59.73 FPS; it did not make every window pass. Evidence:
`build/wasm-robust/roster-warm-fountain/`.


The targeted Ice Climbers/Peach/Samus/Jigglypuff repeat with the larger seed
passed all three windows: 59.83, 59.42 and 59.86 FPS, p95 18.90, 18.29 and
18.06 ms, with no audio underruns or runtime errors and successful replay.
The earlier 96-pipeline seed's first window was 58.47 FPS with p95 20.72 ms.
The broader seed is retained. Existing local caches are merged with it rather
than overwritten, so returning users also receive the additional warmup entries
and keep their own learned pipelines. The merge handles duplicate entries and
replaces incompatible or truncated local caches; the corresponding tests pass.
Evidence: `build/wasm-robust/roster-warm-climbers/`.

Final source validation: the restored FIFO runtime's game archive still matches
the 1,835,008-case oracle hash; all browser patches reverse-check against the
prepared source. The browser module tests passed (25 passed, one skipped), the
PC-boundary and FPS-report tests passed, and the Wasm pthread test again passed
200,000 wakeups plus 20 timed checks. These checks do not certify universal FPS.


### Final clean comparison and restored runtime

With cleanup complete and the cache-upgrade code in place, `f60b3f3bbd856e7f`
ran six Fountain windows at 58.80, 59.63, 59.32, 59.94, 57.57 and 58.84 FPS.
Four windows passed; the first missed the p95 gate (20.219 ms), and the fifth
missed the FPS gate. Audio had zero underruns, replay passed, and no runtime
errors were reported. This remains below the requested robust-60 target.
Evidence: `build/wasm-robust/final-fountain/`.

A further candidate skipped redundant relaxed watermark stores in the command
processor. [Wasm's atomic accesses use sequentially consistent ordering](https://github.com/WebAssembly/threads/blob/main/proposals/threads/Overview.md),
and a small two-writer Wasm test made unchanged-value publication much cheaper.
That did not establish a gameplay benefit. The candidate (`a64539ee1992dae2`)
ran at 43.19–45.55 FPS while other applications consumed substantial CPU time.
The previous runtime then also fell to 42.27, 44.71 and 42.20 FPS under that load.
Those runs are confounded and cannot establish either a useful gain or a code
regression. The candidate source and binary were removed, restoring verified
`f60b3f3bbd856e7f`. Evidence: `status-store-fountain/`, `status-store-control/`,
and `status-store-build.json` under `build/wasm-robust/`.

The retained implementation is the 512-region integer pass with its PC-boundary
fix, periodic CPU-loop re-entry, GPU canvas transfer, sparse idle payload polling,
FIFO cache-line separation, static FIFO writes, and the expanded shader warmup.
No ISO/ROM bytes are changed. The aggregate report is
`build/wasm-robust/summary.json`. Further FPS comparisons need a quiet machine;
universal 60 FPS has not been achieved or claimed.


### Retry after user resource cleanup

After the user closed applications and relieved memory pressure, the verified
`f60b3f3bbd856e7f` runtime measured 42.00, 46.36, 47.84, 48.73, 50.61 and
46.29 FPS on the same four-player Fountain test. All six windows failed; audio
had no underruns and replay completed. Disk space was about 15 GB, macOS reported
nominal thermal state and normal memory pressure, and the busy unrelated
application processes were gone. The slowdown cannot be explained solely by the
previous background CPU contention. Evidence: `quiet-fountain/`.

A separate instrumented repeat showed about 5.14 million guest cycles, 267,675
dispatches and 71,243 primitives per frame in its last 500 frames, with no new
vertex or pixel shaders in that tail. This is broadly similar guest work to the
earlier profile, with slower host execution. The profiled run is diagnostic and
is not FPS acceptance evidence. Evidence: `quiet-profile/`, `quiet-analysis.txt`.

A new candidate (`857fc20cc214fa96`) put the entire BlockingLoop polling and
waiting state machine behind a volatile indirect call, returning every 64
iterations. This differs from the earlier payload-only batching experiment.
The optimized Wasm call graph retained the boundary, and the concurrency test
passed 200,000 wakeups plus 20 timed checks. Nevertheless, six unprofiled Fountain
windows measured 50.63, 52.32, 48.20, 46.61, 44.37 and 53.29 FPS; all failed.
There were no audio underruns or runtime errors, and replay completed. No robust
improvement was established. The additional loop restructuring was removed and
the previous `f60b3f3bbd856e7f` source and runtime restored. Evidence:
`gpu-reentry-fountain/`, `gpu-reentry-build.json`, `gpu-reentry-callgraph.txt`.

Robust 60 FPS remains unresolved. The original ISO is unchanged.
