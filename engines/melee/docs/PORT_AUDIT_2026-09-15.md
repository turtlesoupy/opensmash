# Melee PC and browser port audit

Research snapshot: 2026-09-15. Intended decision: which foundations OpenSmash should use for browser performance, original-game coverage, and custom characters.

## Findings

**There are substantially more credible approaches than the two initially considered. My earlier upstream survey was too narrow.** The relevant families are direct C source ports, source-to-LLVM retargeting, executable static recompilation, emulation, and partial rewrites. Names and demo frame rates conceal these differences.

**My recommendation is to keep the working OpenSmash browser build, but treat its bespoke platform runtime as provisional.** The strongest reusable platform foundation found is [Aurora](https://github.com/encounter/aurora). The most relevant additional source-port references are [jonrosner/melee-native](https://github.com/jonrosner/melee-native), [999sian/melee-pc](https://github.com/999sian/melee-pc), and [GurekamDhillon/melee:pc-port](https://github.com/GurekamDhillon/melee/tree/pc-port). For Slippi compatibility and presentation latency, study [Melee Unlocked](https://github.com/Hero88go/melee-unlocked) and its Apple descendant [Dashdance](https://github.com/TheAndersMadsen/dashdance).

No audited native/browser project establishes complete original-game parity across every fighter, move, stage, single-player mode, save path, effect, and online configuration. This includes our build. No reviewed project is an official Nintendo port; using Aurora or Slippi code also does not imply endorsement by their maintainers.

## Scope and evidence

This is a public-source architecture and upstream-readiness audit, not a fresh cross-project execution benchmark. I searched GitHub repository metadata both with and without forks, followed dependency/credit links, read primary documentation, inspected selected build/compiler code, and inspected Melee Royale's publicly served JavaScript. Individual runtime results below are **upstream reports**, except the explicitly identified existing OpenSmash measurements.

The inventory distinguishes substantive implementations from announced targets and forks with no port-specific evidence in the material inspected. It covers the identified public families, not every private branch, Discord experiment, renamed repository, or unindexed project. Generic decomp forks, ROM-download listings, tools, and unrelated games containing “melee” were filtered out. GitHub search pagination and API rate limits constrain discovery; absence here is not proof that a project does not exist. Once API limits were reached, selected source reads continued through raw GitHub URLs.

A source file compiling, a boot screenshot, a rendered match, a completed campaign, and reference-equivalent gameplay are different levels of evidence. Likewise, inherited decomp commits and contributors do not establish a new port's maintenance history. Repository creation dates below describe public repositories, not when their authors began work.

## Inventory: implemented native-port families

| Project | Actual approach / targets | Evidence and limits | Usefulness to OpenSmash |
|---|---|---|---|
| [avak1an/MeleeRecomp](https://github.com/avak1an/MeleeRecomp/tree/pc-port) | Recovered game/HSD C + bespoke OpenGL/SDK/audio runtime; Windows | Basis of our port. Public repository created Sept 9, latest inspected commit Sept 13; no GitHub releases returned. Partial one-player coverage and graphics/audio omissions. | Shortest route to our current WASM/WebGL2 build; small upstream and bespoke device layer mean continued ownership burden. |
| [999sian/melee-pc](https://github.com/999sian/melee-pc) | Recovered C + Aurora/Dawn/SDL3; Windows, Linux, Android | Public Sept 14; beta releases through v0.1.4 on Sept 15. README reports completed Classic/Adventure and several extra modes; All-Star explicitly unfinished. | Strong gameplay/save/audio fix donor. GNU big-endian attributes make its exact compilation strategy unsuitable as a drop-in Emscripten build. |
| [jonrosner/melee-native](https://github.com/jonrosner/melee-native) | Recovered C + Aurora; Apple Silicon/Metal and Linux/Vulkan | Sept 8 releases; main last pushed Sept 9. Explicitly bounded VS coverage; saves unsupported. | Important omission from earlier survey. Native Clang build and pinned Aurora dependency are particularly relevant to our toolchain. |
| [jakeschaeffer/melee-native](https://github.com/jakeschaeffer/melee-native) | Integration fork of jonrosner | Sept 13 push; documents Classic/Continue fixes, decomp synchronization and widescreen prototype. Experimental CI artifacts, not stable releases. | Review its fixes together with its parent; not a separate independently proven engine. |
| [GurekamDhillon/melee](https://github.com/GurekamDhillon/melee/tree/pc-port) | Recovered C → PowerPC-layout LLVM IR → byte-swapped host code; Aurora platform shims | Public Sept 14, work in progress, no releases returned. Compiler transform is substantive code. | Most interesting alternative to manual endianness/pointer repairs; see below. Full-mode/performance evidence insufficient to select it outright. |
| [Hero88go/melee-unlocked](https://github.com/Hero88go/melee-unlocked) | Retail executable + Slippi patches statically translated to C++; D3D12 runtime | Public Sept 12, active Sept 15; alpha. Documents replay comparisons and high-refresh work, with remaining mismatches/coverage limits. | Strongest reviewed source of original-executable/Slippi validation techniques and subframe rendering ideas. Windows runtime is a substantial browser adaptation. |
| [TheAndersMadsen/dashdance](https://github.com/TheAndersMadsen/dashdance) | Melee Unlocked descendant; ahead-of-time game translation + native Apple/Metal integration | Public Sept 13, pushed Sept 14. Alpha/beta naming; Apple simulator coverage must not be confused with physical mobile testing. | Useful input/presentation/audio scheduling reference. It is not an independent direct-C gameplay implementation. |
| [chrissotraidis/meleepad](https://github.com/chrissotraidis/meleepad) | DolRecomp + ModernGekko/Dolphin-derived runtime; ARM64 Apple | Source-only game-module workflow; preview shell alone is not playable. Documents visual/performance gaps and experimental fixed-delay networking. | Relevant to our older recomp backend and physical mobile validation. Not evidence that direct C is unnecessary. |
| [McDandle/melee-macos-recomp](https://github.com/McDandle/melee-macos-recomp) | DolRecomp + ModernGekko, macOS ARM64 | Sept 8 source-only proof of concept. Local two-peer startup/short gameplay reports, full network matches unverified; no rollback/interpolation. | Same broad runtime family as meleepad, not another mature independent platform. |
| [lammmab/momentum](https://github.com/lammmab/momentum) | Claims recovered native C with Rainfall/Siphon; 32-bit Windows/Linux | Sept 7 repository, Sept 12 push. Sparse README; no detailed mode acceptance found in inspected material. Linked Rainfall README could not be fetched at the attempted path. | Keep on watch list. Too little verified integration/coverage evidence to rank above the other source ports. |

### Why Aurora matters

Aurora is a reusable GameCube/Wii platform layer with GX rendering through Dawn/WebGPU, platform/input integration, disc and memory-card support. Its lineage includes Metaforce, and it is used by Dusklight. This is stronger evidence of reuse than a new Melee-specific renderer. Its MIT license applies to Aurora, not automatically to every game or dependency using it. [Primary repository](https://github.com/encounter/aurora).

**Native Dawn/WebGPU support does not prove browser support.** Browser event loops, GPU surface creation, filesystem/disc access, audio scheduling, threads and memory constraints still require integration. The fact that multiple Melee ports use Aurora is a reason to investigate consolidation, not evidence that one can replace our renderer by changing a flag.

### Three materially different source-port strategies

1. **Our current route:** compile recovered C for WASM and fix assumptions exposed by the host. This produced the working browser build, but carries endian, layout and undefined-behavior repair work. Our game compilation remains O0 because optimization exposed defects; the platform runtime is optimized. That is an unresolved engineering limitation, not an inherent limit of native C.
2. **999sian:** GNU `scalar_storage_order("big-endian")` plus platform/layout accommodations. Its CMake rejects non-GNU C compilers outside Android, uses an Android compiler launcher, and keeps desktop code/data below 4 GB for 32-bit pointer slots. Thus “also C plus Aurora” is not sufficient for browser portability. [Build code](https://github.com/999sian/melee-pc/blob/master/CMakeLists.txt).
3. **GurekamDhillon:** compile C with the PowerPC frontend/layout, then transform LLVM loads/stores with byte swaps and verify aggregate layouts before host code generation. The inspected transform initializes x86 targets; a downstream project adds a WASM target. This could preserve more original data-layout semantics while retaining editable C. It still needs numeric, aliasing, callback and whole-game validation. [Transform source](https://github.com/GurekamDhillon/melee/blob/pc-port/pc/tools/gwtool/gwtool.cpp).

jonrosner's build is another important reference: it directly compiles game C, pins Aurora to `749d6ee7a22bdfab78c8ece9047bca5d79aa72ca`, and registers component tests including sanitizer-backed targets. We should review its actual portability fixes before deciding that either GNU attributes or our current manual fixes are the only choices. [CMake](https://github.com/jonrosner/melee-native/blob/main/native/CMakeLists.txt).

## Browser projects, rewrites, and early targets

| Project | What is actually evidenced | Assessment |
|---|---|---|
| **OpenSmash direct-C**, this worktree | Existing browser integration, custom characters, original menus/matches/results, local-disc import, saves, audio and recorded coverage | Currently useful and locally exercised. Full single-player parity and consistently passing four-player frame-time gates remain open. [Validation](../runtime/direct-c/VALIDATION.md). |
| [Melee Royale](https://meleeroyale.com/) | Served application separates versus/crowd/royale paths; JavaScript references `/engine/combat.wasm`, combat state exports, Three.js, fighter assets and an “instanced visuals” crowd UI | Evidence of a specialized combat simulation/rendering integration. No public source repository or independently reproducible full-game benchmark established in this audit. Do not infer original menus/campaigns/effects parity from its crowd demo. |
| [frankischilling/melee-web](https://github.com/frankischilling/melee-web) | Gecko/WebGPU integration project; README explicitly says browser boot, audio and playable performance unverified | Real project, not a proven playable substitute. GPL-3.0 integration. |
| [ioncodes/gecko](https://github.com/ioncodes/gecko) | Rust GameCube/Wii emulator with WebGPU and a WASM web crate, alongside native frontends | Actual browser-target infrastructure; emulation rather than a Melee source port. Native JIT results cannot be assumed for its browser build. |
| [Online Weekly Tournaments browser](https://github.com/Robert-Liam-Walker/online-weekly-tournaments-browser) | Tournament frontend/server currently uses a deterministic box-fighter stub; planned recovered-C WASM engine | Its engine status reports 987/989 translation units compiled to WASM bitcode, but browser shims and match ABI not started. Useful compiler work, not working Melee. [Engine status](https://github.com/Robert-Liam-Walker/online-weekly-tournaments-browser/blob/main/docs/ENGINE.md). |
| [MeleeLight](https://github.com/schmooblidon/meleelight) | JavaScript/Canvas recreation; long-standing browser project, last repository push Aug 2023 | Different implementation and limited gameplay scope. Not a whole-game source port. |
| [100-Man Melee](https://github.com/benstrumeyer/100-man-melee) | MeleeLight extension with spatial-hash collision and many local CPU fighters; June 2026 snapshot | Its reported ~3 ms simulation tick at 100 fighters is not original Melee performance. Human online multiplayer is roadmap work. |
| [Skirmish](https://github.com/cornerian/skirmish) | Incomplete Rust rewrite with differential probes and a synthetic headless match; renderer does not yet present live matches | Interesting semantics/testing work; not a feature-equivalent game. Current rewrite began Sept 2026 despite older repository date. |
| [MeleeXR](https://github.com/astelmach20/meleexr) | Aurora/OpenXR/Quest target; README says compile-baseline phase and nothing runs yet | Architecture proposal and compilation work, not demonstrated VR game parity. |
| [VibingSticks/melee-web](https://github.com/VibingSticks/melee-web), [goodtripith/meleehtml](https://github.com/goodtripith/meleehtml) | Inspected READMEs still describe the GameCube decomp/build | Screened candidates. Names alone do not establish browser execution; port-specific implementation was not established here. |
| [SmashMeleeVita](https://github.com/robin994/SmashMeleeVita), [melee-uwp](https://github.com/YTReviveMe/melee-uwp) | Inspected READMEs retain decomp instructions | Adjacent target forks, not evidence of a working PC/browser upstream. Their unreviewed branches may contain further work. |
| [ben-pv-git/meleeJS](https://github.com/ben-pv-git/meleeJS) | Discovery metadata describes a JavaScript/HTML recreation | Discovery-only entry; no basis here for full-game parity or adoption. |

Melee Royale's served bundles examined were `main-B15_4iz1.js`, `browser-DcDsHPDd.js`, and `crowd-browser-CokakkqM.js`. The crowd label is consistent with a specialized renderer, but does not by itself establish the exact batching implementation. I did not establish that its WASM contains every original gameplay subsystem, nor validate 100+ humans at 100+ FPS. Its architecture remains useful without accepting those stronger claims.

## Parity: especially All-Star and special stages

**29 selectable VS stages do not include every single-player map or prove their scripts work.** All-Star needs a complete run through opponent progression, rest-area transitions, healing items, ending and save/unlock behavior. Classic and Adventure similarly need boss, bonus, transition, results and persistence coverage.

| Implementation | Classic / Adventure | All-Star and rest area | Saves / online |
|---|---|---|---|
| Our direct-C | Classic entry/combat tested; full campaigns not established | Not validated | Local persistence tested; no established Slippi equivalence |
| MeleeRecomp upstream | Partial Classic and early Adventure reports | Locked/untested in reviewed status | Bespoke save/audio/platform implementation |
| 999sian | README reports both completed | Explicitly not done with locked roster | GCI support; rollback online not done |
| jonrosner / Jake fork | Parent has bounded VS testing; Jake adds Classic fixes | No complete-run evidence located | Parent explicitly says saving does not work |
| Gurekam / Momentum | Insufficient completion evidence | Unknown | Insufficient full-flow evidence |
| Unlocked / Dashdance | Main public emphasis is VS/Slippi | No exhaustive campaign acceptance located | Slippi compatibility claimed; do not extend tested configurations to all online modes |
| meleepad / McDandle | Limited runtime coverage | Not established | Experimental fixed-delay networking, not equivalent to Slippi rollback |
| Browser stubs / rewrites / crowd demos | Partial or different game scope | Not established | Not interchangeable with original-game saves or modes |

The useful whole-game reference remains stock [Dolphin](https://github.com/dolphin-emu/dolphin); the competitive online reference is [Slippi](https://slippi.gg/downloads). They are emulators/clients, not source-port donors with browser parity already solved.

## Performance evidence and misleading comparisons

- **Simulation Hz:** original gameplay advancement, normally 60 steps/second.
- **Presentation FPS:** submitted/displayed frames. Extra presentations may repeat a pose or sample between simulation states.
- **Unpaced throughput:** maximum steps under a particular workload; does not measure latency or frame pacing.
- **Crowd count:** may be local CPU actors, simplified visuals, or connected humans; these are not interchangeable.

Melee Unlocked's completion notes describe authored intermediate poses, replay comparisons, and some residual numeric mismatches. Its documented validation is considerably more informative than the blanket README claim that gameplay is exact. Tests across its own renderer configurations establish internal consistency, not reference equivalence by themselves. [Completion tracker](https://github.com/Hero88go/melee-unlocked/blob/main/PORT_COMPLETION.md).

Dashdance exposes simulation work, late frames, GPU work, drawable waits and presented timestamps. That instrumentation is worth adapting. Its performance documentation distinguishes simulator from physical device validation, and software presentation timestamps are not physical button-to-photon measurements. [Performance](https://github.com/TheAndersMadsen/dashdance/blob/main/docs/PERFORMANCE.md), [technical guide](https://github.com/TheAndersMadsen/dashdance/blob/main/docs/TECHNICAL.md).

Our existing quiet-host tests showed roughly 59.7–60 FPS for two fighters, with all three two-player gates passing. Four-player runs averaged roughly 59.1–60 but all three failed the p95 frame-time gate. That is not evidence of universal superiority over the older backend. The user's substantially improved experience is valuable, but we should investigate pacing/input/audio rather than turn it into an unsupported comparative benchmark. Full measurements and limitations remain in [VALIDATION.md](../runtime/direct-c/VALIDATION.md).

No new apples-to-apples performance ranking was executed in this audit. Different hardware, internal resolution, shader caches, audio settings, roster, effects and player counts make the upstream numbers unsuitable for a speed league table.

## BattleShip connection

The actual upstream used by our Smash 64 work is [JRickey/BattleShip](https://github.com/JRickey/BattleShip), a **Super Smash Bros. 64** port. Its reusable platform is libultraship, with Torch asset processing. That architecture and its platform/release/modding work explain the stronger upstream relationship we had there. BattleShip is not itself a GameCube GX runtime or a Melee port.

I checked JRickey's public repository list, BattleShip's exposed branches, main tree paths, and Melee-related issue/PR search. **I could not verify a public Melee port maintained by JRickey.** The direct Melee proposal located in BattleShip was [PR #195](https://github.com/JRickey/BattleShip/pull/195), a third-party fork author's proposed future sequel; that is not evidence of a BattleShip-maintained implementation. This does not rule out Discord work, deleted branches or other projects the user has seen.

The closest demonstrated analogue to BattleShip's reusable platform dependency is **Aurora**, while the Melee-specific applications using it remain young. We should distinguish the maturity of that shared platform from the maturity of each new port's game glue.

## Maintenance and licensing readiness

Most substantive new port repositories were published Sept 7–14. Recent activity proves current work, not sustained maintenance. Favor pinned dependencies, reproducible build recipes, documented limitations, reference tests and small reviewable fixes over star counts or inherited commit totals.

- Aurora declares MIT; MeleeLight and 100-Man describe MIT licensing. These declarations do not automatically cover external assets.
- Melee Unlocked declares GPL-2.0-or-later. Dashdance inherits that and documents GPL-3.0 implications for controller artwork included in builds.
- 999sian and the Gecko browser integration identify GPL-3.0; McDandle identifies GPL-3.0-or-later. These are code provenance observations, not a blanket compatibility determination.
- Gurekam explicitly limits its GPL-2.0-or-later declaration to its `pc/` layer and identifies Dolphin-derived floating-point code. [Dependencies and notices](https://github.com/GurekamDhillon/melee/blob/pc-port/pc/DEPENDENCIES.md).
- The matching decomp does not publish a blanket license in the inspected repository metadata; jonrosner explicitly preserves notices without applying a new blanket license. A fork's top-level license does not settle rights to all inherited material.

Keep upstream identities, commit pins and per-file notices intact when borrowing fixes. Our previous choice of a convenient renderer should not become an assumption that its provenance, portability and long-term maintenance are already solved.

## Concrete recommendation for OpenSmash

1. **Keep the working direct-C path as the validation baseline.** It already supplies our browser/custom-character integration; none of the newly found projects establishes a drop-in replacement with that coverage.
2. **Prioritize the Aurora source-port family.** Review jonrosner's Clang-compatible integration and Jake's game fixes alongside 999sian's broader single-player/save work. Separate game fixes from renderer adoption.
3. **Evaluate Gurekam's LLVM transform as the alternative compilation strategy.** The downstream WASM bitcode result makes this a concrete avenue, but browser linking/rendering and differential gameplay are still required before adoption.
4. **Borrow measurement and equivalence methods from Unlocked/Dashdance.** Keep 60 Hz gameplay separate from high-refresh presentation. Validate against recorded original-game states before considering Slippi compatibility.
5. **Use a real acceptance matrix for any migration:** all custom targets, full All-Star including rest area, Classic/Adventure completion, saves/reloads/unlocks, representative effects/items, multi-controller operation, physical mobile thermal/audio tests, and cold/warm two/four-player frame-time distributions. Passing a compile or short VS sweep cannot substitute.

The correction to the earlier recommendation is substantive: **we should have surveyed Aurora's other Melee integrations and the LLVM-retargeting branch before treating MeleeRecomp as the obvious upstream.** The audit does not establish that replacing our working build wholesale would currently produce better parity or performance.
