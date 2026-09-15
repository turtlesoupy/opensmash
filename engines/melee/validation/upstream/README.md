# Melee PC upstream validation — 2026-09-15

Host: Apple M5, 32 GB, macOS, Chrome 152. Rendering: 960×720.
Each benchmark uses a fresh Chrome profile and three consecutive 30-second
combat windows after the initial scene preparation. OS/GPU driver caches were
not purged. The two-player case uses a custom Mario and stock Fox; the four-player
case uses four custom fighters with Mario, Falco, Captain Falcon, and Link movesets.
Combat benchmarks use CPU-driven players; interactive keyboard input is checked
separately through the default launcher. Resolved lineups are retained in each report.

| Build / workload | FPS range | Worst window p95 | Worst frame | Audio underruns |
| --- | ---: | ---: | ---: | ---: |
| Previous direct-C, 2 players | 59.68–60.00 | 19.79 ms | 183.88 ms | 0 |
| Upstream, 2 players | 59.91–60.00 | 17.87 ms | 61.64 ms | 0 |
| Previous direct-C, 4 custom | 59.12–59.99 | 21.48 ms | 211.61 ms | 0 |
| Upstream, 4 custom | 59.96–60.00 | 19.33 ms | 46.49 ms | 0 |

Both final upstream workloads pass every window's gates: ≥58.5 FPS, p95 ≤20 ms,
p99 ≤33.34 ms, no audio underruns/overruns, and ≥95% rendered-audio coverage.
The default engine path and return-to-roster/replay also pass; replay reuses the
same verified File. Click-to-match was 4.060 s (2 players), 4.124 s (4 players),
and 4.112 s on replay. Disc verification precedes that click measurement.

The initial four-player run failed with 412–527 ms stalls and audio underruns.
Its report is retained as `before-upload-fix-4.json`. The browser staging-upload
fix replaced whole-capacity mapped-buffer copies with persistent CPU storage
and uploads of the used ranges. No benchmark thresholds were relaxed.

Chrome's physical audio output clock on this host also stalled for an isolated
oscillator. Final runs use `--disable-audio-output`, exercising the real
AudioWorklet/Sonic consumer against Chrome's advancing render clock, without
physical speaker playback. Previous direct-C reports were captured earlier on
the same host and resolution; their exact arguments are retained in each file.

Functional reports live in the pinned fork's `platforms/browser/validation`.
They cover selectable fighters/stages, custom movesets, original boot/title,
menus, results/rematch, Classic/Adventure entry, All-Star's rest area, and
IndexedDB saves including a real legacy save import. Short functional samples
are not a promise of 60 FPS for every possible match or a complete playthrough
of every mode. Mobile browsers and native desktop builds were not benchmarked.

Reproduction commands are in [UPSTREAM.md](../../UPSTREAM.md). Raw benchmark
windows and the comparison/failing runs accompany this report.

Keyboard checks send real DOM key presses/releases through the shared launcher
and iframe bridge, then assert the native controller sees movement and attack.
`input.json` records those checks. The integration unit suite also passes all
11 tests, including verification of the real disc against the pinned manifest.

The final fork pin includes a metadata-only reproducibility fix: SDL’s version
banner uses its pinned source ref rather than the enclosing Git revision. A
rebuild across a repository commit produces identical WASM bytes. The fork
report retains both artifact fingerprints; `final-startup.json` records the final launcher check.
