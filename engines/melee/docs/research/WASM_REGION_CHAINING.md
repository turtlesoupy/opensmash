# WASM region chaining — September 13, 2026

Independent pass after [WASM_INDEPENDENT_HANDOFF.md](WASM_INDEPENDENT_HANDOFF.md).
The ISO is unchanged. No emulated work is skipped and no gate was loosened.

## Baseline and diagnosis

The retained `f60b3f3bbd856e7f` runtime reproduced the slow mode on the heavy
Fountain lineup (`5,1,4,13`, stage 2): six strict windows at 51.40, 51.94,
56.13, 53.86, 50.52 and 56.17 FPS, all failing (`build/independent-heavy-fountain-01`).

Per-thread CPU sampling of the Chrome renderer (`ps -M`, 8-second deltas)
during that run showed the emulated-CPU pthread at 96–97% and the GPU thread at
about 78%, with no busy V8 compile threads. Chrome with `--js-flags=--no-liftoff`
(TurboFan only, `MELEE_CHROME_ARGS` in the harness) still measured 46.37,
50.57 and 53.74 FPS (`build/independent-fountain-noliftoff-01`), so the
compiler tier does not explain slow mode. The renderer's worker threads run at
macOS QoS 37; efficiency-core scheduling was not directly measurable without
elevated tools and is not excluded, but the CPU thread had no idle time, so
reducing its work per frame is the only lever that does not depend on the host.

A V8 CPU profile of the normal (unprofiled) build restricted to the CPU thread
over a 30-second window (`build/independent-fountain-cpuprofile-01`) attributed:

| CPU-thread self time (30 s at ~53 FPS) | Seconds |
| --- | --- |
| Recompiled game regions | 14.79 |
| `StaticRecompCore::Run` (dispatch loop, inlined dispatcher) | 5.88 |
| PPC helpers | 2.28 |
| FIFO write path (`opensmash_pc_write32`, `HookExternalWrite`, `UpdateGatherPipe`, `RunGpu`) | 2.89 |
| Host-call lambda in `main.cpp`, called from every dispatch | 0.71 |

The generated code returns to the C++ run loop at every cross-region call,
return and branch: about 267,000 dispatches per frame for roughly 5.1 million
guest cycles. The loop and the per-dispatch hook probe were about 22% of the
thread.

## Change: chained region exits

`tools/chain_browser_chunks.py` rewrites the generated regions (after math and
entry specialization, into `generated/chained/`) so that a static exit
(`bl`, cross-region `b`, conditional branch, region fall-through) or a dynamic
exit (`blr`, `bctr`, the return-dispatch default) calls the target region
directly when the run loop would have re-dispatched it anyway:

- the CPUState is the run loop's registered context (other users of the
  dispatcher, such as the skinning oracle and the tests, keep single-region
  dispatch);
- no exception is pending;
- the accumulated charge is within the dispatch's chain budget, which the run
  loop sets to the cycles left in the CoreTiming slice (capped at the existing
  256-cycle loop budget). A chain therefore ends at the first transfer after
  the slice expires, the same boundary per-region dispatch used, so external
  interrupts are delivered at the same guest positions;
- as in the run loop, a transfer that charged nothing since the previous one
  charges one cycle, so zero-charge loops end;
- the target is not a host-call (patch or hook) address or a configured idle
  loop address, which the run loop must observe;
- the target region is verified by the chassis SMC guard and is not one the
  chassis forces through the interpreter.

Exits use an ordinary call whose depth is bounded by the cycle budget (at most
one frame per transfer, at most 256 transfers). The check is one out-of-line
call per exit so the module stays small: 130,838,076 bytes versus 128,890,072.
Patch `0005-wasm-region-chaining.patch` publishes the run loop's context,
region states, forced regions and slice budget, verifies the generated region
table against the module's, and stops chains at the idle addresses. `main.cpp`
publishes a copy of the dense host-call bitmap.

### Correctness evidence

- `tools/validate_browser_chain.py`: for every region, 4 random entries and 6
  scenarios (FP disabled, paired-single disabled with journaling, MMIO operands,
  EXRAM operands with journaling, random GQR/FPSCR and computed returns, budget
  edge with journaling), one chained dispatch must equal the unchained sequence
  of single-region dispatches under the same continuation rule: full CPU state,
  RAM, EXRAM and callback trace. 91,032 cases, 58,100 exercising a chain,
  longest chain 251 transfers. Report: `build/moderngekko-validation/browser-chain-wasm.json`.
- `tools/validate_browser_entries.py` still passes 1,835,008 cases on the chained
  archive (the specialized entries keep their retained originals).
- Gameplay, replay and audio gates ran through the existing harness; no runtime
  errors or audio underruns in any completed run.

### Failed variants (removed)

- Wasm tail calls (`musttail`, `-mtail-call`): a node timing of the chain
  oracle first suggested chained dispatch was 8x slower, but the same figure
  appeared with ordinary calls and an order-swapped bench showed it was a
  first-run artifact of the bench, so neither variant was shown slow in
  isolation. Tail calls were dropped anyway: with the budget bounding call depth
  they add nothing, and the flag is one less toolchain requirement.
- Fixed 256-cycle chain budget: chains started where the previous one ended,
  so slice boundaries phase-locked to one instruction of the OS idle loop inside
  an interrupt-disabled window and the VI interrupt was never delivered. The game
  stalled at the preparation hold (`build/independent-chain-stall-profile-02`).
- Refusing to chain while MSR.EE is clear: every boundary then landed in
  interrupt-disabled windows (OSDisableInterrupts/OSRestoreInterrupts polling
  around memory-card I/O) and the game stalled after launch
  (`build/independent-chain-stall-profile-03`). Replaced by the slice-based budget.
- Inlined chain checks: a 192 MB module whose hot regions took much longer to
  reach TurboFan; first windows measured 30–38 FPS.

## Measurements

All on the same Apple M5, headed Chrome 152, fresh profile per run, heavy
Fountain lineup, three 30-second windows. The machine was in a slower state in
the evening than in the morning baseline; comparisons are interleaved.

TurboFan-only (`--js-flags=--no-liftoff`), inlined-check build, alternating:

| Run | FPS windows |
| --- | --- |
| chained | 33.45, 51.07, 53.53 |
| f60 control | 40.36, 42.46, 44.32 |
| chained | 34.45, 49.30, 50.76 |

Normal tiering, final out-of-line build (`3017755535d32d1f`), alternating with
the f60 control on port 8788, with renderer thread sampling
(`build/independent-{chain,control}-series-{1,2,3}`):

| Run | FPS windows | CPU-thread ms per frame (windows 2–3) |
| --- | --- | --- |
| chained 1 | 52.6, 55.2, 43.9 | 17.5, 21.4 |
| control 1 | 38.5, 41.9, 38.6 | 22.3, 24.3 |
| chained 2 | 45.2, 47.9, 46.0 | 19.7, 20.7 |
| control 2 | 41.2, 36.8, 39.9 | 25.3, 23.1 |
| chained 3 | 47.5, 50.7, 56.1 | 18.9, 17.0 |
| control 3 | 48.8, 49.1, 46.2 | 19.7, 20.6 |

Medians over windows 2–3: chained 49.3 FPS and 19.3 ms of CPU-thread time per
frame; control 40.9 FPS and 22.7 ms. An earlier alternating triple under normal
tiering measured chained 57.32, 58.03, 58.07; control 54.19, 58.58, 54.87;
chained 49.73, 56.46, 54.74 (WindowServer at 90% during the last run).

A final six-window strict run with replay on the chained runtime
(`build/independent-chain-heavy-fountain-01`, Music.app active at about 38%
CPU) measured 49.47, 52.84, 49.20, 44.58, 46.13 and 51.65 FPS with no audio
underruns and a successful replay; every window failed the gate, as the control
did in the same machine state.

This is a demonstrated reduction of about 15% in CPU-thread work per frame on
the hardest case. It is not a universal 60 FPS result: on the evening machine
state neither build passed the strict gate, and the roster sweep has not been
rerun on the chained runtime.

## Tooling changes

- `tools/validate_local_disc.cjs`: `MELEE_CHROME_ARGS` passes diagnostic Chrome
  flags; with `MELEE_TRACE=1` the trace starts at launch and is saved even when
  the run fails.
- Per-thread renderer sampling and profile analysis were done with ad-hoc
  scripts (`ps -M` deltas; V8 `ProfileChunk` events resolved through the symbol
  map and restricted to the CPU thread).

## Rejected follow-up: direct gather-pipe writes

The FIFO write path (about 10% of the CPU thread) was tried next: generated
stores to the 0xCC008000 page wrote Dolphin's gather pipe directly, with the
32-byte burst still going through GPFifo and the run loop publishing the pipe
for its own guest context only. Correctness held (chain and entries oracles,
plus a unit test of byte order, pointer advance, bursts and context gating),
but neither variant beat the chained control in six alternating runs with
thread sampling on the heavy Fountain lineup:

| Variant | Module bytes | Median CPU-thread ms per frame (windows 2–3) | Control |
| --- | --- | --- | --- |
| Inline write at every store site | 149,353,614 | 18.96 | 17.15 |
| Out-of-line write, call in the non-RAM branch | 133,025,289 | 17.07 | 16.32 |

Evidence: `build/independent-{gp,chainctl}-series-{1,2,3}` and
`build/independent-{gp2,chainctl2}-series-{1,2,3}`. The change was removed.
During the second series, with the machine cool, the chained control measured
individual windows of 59.3, 59.8 and 59.4 FPS with p95 of 19.2–19.6 ms, so the
retained runtime does reach the gate in a good machine state.

## Retained follow-up: MEM1 before EXRAM in guest memory access

`0006-wasm-mem1-first.patch` reorders `get_ram_ptr` in the browser build so
the MEM1 range is tested before the Wii EXRAM pointer. GameCube titles have no
EXRAM, so every guest load and store previously paid a load and branch on a
null pointer before the RAM hit. The two ranges do not overlap, so the result is
identical for every address; both oracles pass. Module: 129,016,825 bytes.

Six alternating runs against the chained control
(`build/independent-{m1,chainctl3}-series-{1,2,3}`), windows 2–3:

| Build | Median FPS | Median CPU-thread ms per frame | Better in paired windows |
| --- | --- | --- | --- |
| MEM1 first | 58.2 | 16.52 | 4 of 6 |
| Chained control | 56.5 | 17.09 | 2 of 6 |

A small gain, at the edge of run-to-run noise, kept because it has no
correctness exposure and reduces code size. The MEM1-first build measured
59.7, 58.4 and 58.5 FPS in its best windows with p95 of 18.8–20.7 ms.

## Roster sweep on the committed build

`tools/validate_wasm_roster.py` on build `306061dbf4003b33` (chaining plus
MEM1-first), three strict windows per case, evidence in `build/independent-roster-01`:

| Matchup | Stage | FPS windows | p95 ms | Gate |
| --- | --- | --- | --- | --- |
| original | 31 | 58.93, 59.13, 59.90 | 19.9, 17.9, 18.0 | Pass |
| space-animals-swords | 32 | 58.46, 59.71, 59.57 | 21.2, 18.1, 18.1 | Fail (window 1 p95) |
| heavyweights | 2 | 54.50, 58.29, 57.16 | 25.6, 20.6, 21.1 | Fail |
| climbers-peach-samus-puff | 28 | 59.16, 59.93, 59.97 | 20.1, 17.9, 18.1 | Fail (window 1 p95 by 0.1 ms) |
| psychic-transform | 3 | 58.27, 59.93, 59.94 | 21.5, 17.7, 17.6 | Fail (window 1) |
| plumbers-swords | 31 | 59.55, 59.93, 59.97 | 19.3, 17.7, 17.8 | Pass |
| remaining-stock | 32 | 58.42, 59.78, 59.47 | 20.0, 18.1, 18.0 | Fail (window 1 p95 by 0.03 ms) |

No audio underruns or runtime errors in any case; replay passed everywhere.
Windows 2 and 3 pass on six of seven matchups. Four of the five failures are
the first window alone, where V8 is still optimizing the module (the p95
excess is 0.03–1.5 ms). Fountain of Dreams with the heavy lineup remains the
one case that is short in steady state. Reducing first-window warm-up (for
example compiling the module before the character select) is the next
target after Fountain.

## Warm-up and Chrome's WebAssembly code cache

The below-60 first window is V8 tiering: the module runs as Liftoff baseline
code until TurboFan finishes optimizing the hot regions on background threads,
which takes the first 10–15 seconds of combat on a fresh browser profile. It is
not a code path the runtime controls.

The harness's fresh profile per run measures a first-ever visit. With
`MELEE_BROWSER_PROFILE=<dir>` the profile persists, which measures a returning
visitor: Chrome writes the optimized module to its WebAssembly code cache after
TurboFan completes (about 420 MB on disk for this module, in
`Default/Code Cache/wasm`) and later visits start from it. Measured on the
Final Destination lineup `2,20,9,19`:

| Visit | Build | Playable at | FPS windows | p95 ms |
| --- | --- | --- | --- | --- |
| first (fresh) | chained | 13.6 s | 59.57, 59.30, 59.94 | 19.7, 17.6, 17.7 |
| first (fresh) | chained | 13.6 s | 58.97, 59.94, 59.96 | 20.5, 17.6, 17.6 |
| third (cached) | chained | 9.0 s | 57.35, 59.94, 59.93 | 20.7, 16.9, 16.9 |
| first (fresh) | f60 | 13.7 s | 59.10, 59.94, 59.93 | 19.7, 18.0, 17.8 |
| second (cached) | f60 | 11.3 s | 59.06, 59.94, 59.93 | 19.5, 17.2, 16.9 |

One earlier chained first visit collapsed to about 15 FPS for twenty seconds
mid-match while the cache was being written, and the following visit timed out
loading it; neither reproduced in two further fresh visits, so this is noted,
not established. Chrome offers no site-side opt-out; if it ever proves
necessary, instantiating from an ArrayBuffer through Emscripten's
`instantiateWasm` hook bypasses the cache (only the streaming APIs are cached).

## Fountain: where the CPU thread's time goes now

CPU-thread profile of the committed build on the heavy Fountain lineup
(`build/independent-fountain-final-profile`, 30-second window; the profiled
window itself ran at 45 FPS because tracing perturbs the run):

| CPU-thread self time | Seconds | Share |
| --- | --- | --- |
| Recompiled game regions (plus entry-specialized references) | 19.25 | 64% |
| PPC helpers (paired-single loads/stores, FP operations) | 2.41 | 8% |
| FIFO write path (write hook, external write, gather pipe, RunGpu) | 3.39 | 11% |
| Run loop, dispatch and chain checks | 1.72 | 6% |
| Waiting on the GPU thread at idle | 0.77 | 3% |
| Everything else | about 2.4 | 8% |

The dispatch overhead that chaining targeted is gone from the top of the list.
What remains is the generated code itself: per-instruction PC stores outside
the 512 specialized regions, bounds-checked big-endian memory access, and flag
updates. Reaching a steady 60 on Fountain needs roughly 10% less CPU-thread
work, and the remaining levers are generator-level: extend deferred PC stores
to every region (the entry-hint generator is not in the repository; a
deferral-only pass with a test-only reference archive would avoid module
growth), avoid the 256-way entry switch on chained transfers into function
starts, and keep guest registers in locals across a region. The FIFO path was
tried directly and did not pay (above).

## Retained follow-up: deferred PC stores in every region

`tools/specialize_browser_entries.py` now applies the reviewed pure-integer
PC-store deferral to the 3,281 regions without entry hints as well
(`generated/deferred/`), keeping their full entry switches. Their retained
originals go to `generated/references/`, compiled into the test-only
`opensmash-game-reference` archive that only the oracle links, so the game
module does not carry them. 771,827 redundant stores are deferred in total; the
module is 101,557,763 bytes, down from 129,016,825.

`tools/validate_browser_entries.py` now compares all 3,793 regions:
13,594,112 cases (256 entries × 14 scenarios per region, including write
journaling and preset exceptions), about 15 minutes on eight shards. The chain
oracle also passes on the new archive.

Six alternating runs against the chained MEM1-first control
(`build/independent-{df,chainctl4}-series-{1,2,3}`), windows 2–3: median
16.10 ms of CPU-thread time per frame versus 16.17, 59.0 versus 59.1 FPS. No
measurable speed change on Fountain; kept for the smaller module and the
complete oracle coverage. Fountain windows 2–3 on both builds were 57.2–59.8
FPS with p95 of 18.1–21.2 ms on this (cool) machine state; first windows were
57.1–57.9 FPS with p95 21.5–21.9 ms.

## Rejected follow-up: inline FP-available check

Every generated floating-point instruction first calls `ppc_fp_available`,
an out-of-line function testing the lazy-FP setting and MSR.FP. Inlining the
common case (MSR.FP set) with the exception path out of line passed both
oracles but measured no gain: six alternating runs against the deferred-store
control gave a median 16.45 versus 16.27 ms of CPU-thread time per frame
(`build/independent-{fp,chainctl5}-series-{1,2,3}`), with the module 2 MB
larger. Removed.

## State at the end of the pass

Committed runtime `072fb1a5a308df58` (chaining, MEM1-first, deferred stores in
every region). On this machine in a cool state it holds 58–60 FPS in steady
state on every roster matchup including Fountain, where windows 2–3 measured
57.2–59.8 FPS with p95 of 18.1–21.2 ms; first windows and the slow machine
state still miss the strict gate. The CPU thread remains about 95% busy, with
about 64% of its time in the generated regions' instruction semantics. The
remaining levers are generator-level: keeping guest registers in locals across
a region, fusing condition-register updates, and avoiding the 256-way entry
switch on chained transfers. Tried and rejected here for lack of demonstrated
benefit: direct gather-pipe writes (two variants) and the inline FP check.


## Audit fix: preserve timebase updates at chained transfers

The original chain skipped the run loop's per-dispatch timebase update. A
reproduction using Melee's call at `0x8001C900` into `OSGetTime` read 100 when
chained versus 101 with the normal dispatcher at a tick boundary. The earlier
chain oracle omitted that dispatcher update too, so its passing result did not
cover clock equivalence.

The runtime now publishes the burst timebase/cycle snapshot at dispatch entry.
Before continuing into another region, the chain advances `ctx->timebase` using
the same accumulated guest cycles and 12-cycle tick conversion as the run loop.
It preserves sub-tick remainders, leaves cycle charging and interrupt budgets
unchanged, and lets the outer dispatcher perform the final update when a chain
ends. A compile-time assertion checks the conversion against Dolphin's ratio.

The revised oracle independently accumulates cycles and updates its reference
clock between regions. It passes 91,032 cases (57,983 chained), plus 48 targeted
actual-game clock cases per shard: static calls, dynamic returns, all sub-tick
remainders and low-word rollover. Runtime: `30e6328c416e85f6`; evidence:
`build/audit-wasm/timebase-chain.log` and `timebase-build.log`. The PC-store
boundary tests also pass. This is a correctness fix, not a new 60 FPS claim.

The post-fix vanilla Fountain check measured 57.77, 58.07, 58.30 FPS, with zero audio underruns, no runtime errors and successful replay.
It still failed the strict performance gate. Evidence: `build/audit-wasm/timebase-gameplay/`.
