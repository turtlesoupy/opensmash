# Local browser startup

September 9, Apple M5, Codex in-app browser, 960×720.

The original local launch took approximately 28 seconds. The loader issued
roughly 2,630 separate system-resource requests and 1,212 file-size HEAD requests,
copied lazy assets one byte at a time, and retained simulated optical-disc delays.

The local server now supplies a sizes manifest and one system-resource bundle.
Sized lazy reads use bulk byte copies with bounded 1 MiB chunks. Fast-disc mode
removes simulated DVD delays. Menu startup runs without a wall-clock throttle;
the first combat callback restores the normal throttle before gameplay.

One engine starts while the roster is visible and parks on a futex before the
VS match is configured. Selecting a fighter installs the selected archive into
a reserved slot and wakes the original character/stage preloaders. Returning to
the roster terminates that engine and prepares one replacement. No pool of six
active games is kept running.

All six costume slots have fixed 2 MiB file lengths before the virtual disc's
file table is constructed. Padding changes only the DAT file-size header and
adds trailing string-table space. Vertex data, weights, relocations, symbols,
and section offsets are unchanged. `tools/validate_browser_slots.py` checks the
actual JavaScript output using the independent Python archive parser.

## Measurements

Wasm build `89141b6f6fb549b5`. Times include selection preparation and end at the
first presented match frame. Melee's normal opening countdown still follows;
this is not a measurement of the first accepted combat input.

| Character / moveset | Engine ready before click | Click → match |
|---|---|---:|
| Alan Turing / Mario | Yes | 2.241 s |
| 50 Cent / Luigi | No; clicked immediately after reload | 3.109 s |
| Al Capone / Link | Yes | 1.406 s |
| Achilles / Captain Falcon | Yes; first character conversion included | 2.099 s |
| Rob Zombie / Fox | Yes | 2.347 s |
| Alex Ovechkin / Marth | Yes | 1.425 s |

Before preboot, the optimized cold path measured 4.532 seconds on build
`d1a01a2eb8f5277c`. Browser caches and existing local builds were available during
these tests. A first-ever Wasm download/compile, different hardware, or a new
character conversion can add time. Sub-second launch is not established.

Raw evidence is retained in `build/moderngekko-validation/browser-trace.jsonl`.
The `warmReadyBeforeClick` field distinguishes a ready engine from a click that
arrived during preboot. Reproduce the reports with:

```sh
python3 tools/report_browser_startup.py --output build/moderngekko-validation/browser-startup-summary.json
node --test tests/browser_local_files.test.mjs
python3 tools/validate_browser_slots.py
```

Use `tools/serve_melee.py --trace-io --iso /path/to/melee.iso` to record resource
requests in `startup-io.jsonl`. Full ISO and extracted-executable verification
still occur before the server exposes any game assets.

The launch-mode build `649124c7433b0adb` measured a warmed **four-player,
three-custom-costume** launch at 3.90 seconds. The earlier 1.4–2.4-second timings
were two-player cases. A click before warm readiness includes the remaining
engine startup and should not be counted as a warmed measurement.
