# Full-set acceptance, 2026-09-08

- Two actual OpenAI calls produced the frozen description and implementation.
  Their original response IDs, model IDs and usage are in the saved JSON files.
- No judge calls, screenshots viewed, aesthetic scoring, best-of selection,
  or animation revisions. All six contexts compiled on the first implementation.
- First native pass: 18/18 contact/miss/interruption checks passed.
- Durable-worker integration: replayed those exact frozen responses through the
  same generation function, persistence, compilation, native validator, artifact
  uploads and complete-set readiness gate. 18/18 checks passed and six MP4
  previews were stored. Recovery checks also passed for both up-special variants.
- Final bundle-binding guard: matching injected bundle activated custom air up-B
  and dealt 8 damage; mismatching bundle activated no custom attack (vanilla
  fallback dealt 14 damage). See `bundle-binding-report.json`.
- Native and WebAssembly Release builds passed. C++ loader tests ran under
  AddressSanitizer/UndefinedBehaviorSanitizer, including atomic rejection of
  partial sets, invalid cues, and invalid recovery, plus player isolation.
- Browser host binding tests passed for bundle/hash/rig mismatch and four-player
  rebinding. Actual browser air up-B fixture dealt 8 damage and cleared hitboxes.
- Browser Generate → pending → all six validated → Equip flow passed using an
  HTTP fixture for the UI; `ui-smoke.json` records its calls. This UI test is
  separate from the real native-worker acceptance run.
- Web tests: 271 passed; production client build passed. Tests include job
  cancellation fencing, idempotency, ownership, partial-set rejection, frozen
  retries, worker-kind routing, local claim races, and mobile MP4 byte ranges.
- Preview metadata confirms six H.264, 60fps, 180-frame videos. Frames were
  captured and encoded automatically, not inspected or used as model feedback.

Scope: native gameplay qualification is one uploaded-character fixture on the
Mario rig. Compiler tests cover all 12 rig profiles. Newly generated sets are
qualified against their own actual bundle/rig; the first fixture is not blanket
approval for other characters. Production has not been deployed or enabled.

Known browser harness issue: forced shutdown at `SSB64_MAX_FRAMES=800` triggers
an existing WebGL deleteBuffer teardown error after clean game shutdown. The
same error was reproduced with vanilla fighters and no custom package. Gameplay
and damage checks complete before this harness-only exit path.

Large local clips and full runtime logs remain under
`/tmp/special-set-acceptance/jobs/0e70e9847bb2e83022dc9cd195963ec9c84a3a64/`.
They are not checked into Git. JSON reports and original model outputs are kept
here so the first rollout is auditable without a visual judge.
