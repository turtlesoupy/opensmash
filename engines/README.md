# Engines

The launcher in `web-prototype` owns the product UI. Engine-specific implementation
belongs here; shared code should dispatch to an engine, not reinterpret its binary
formats or controller protocol.

- `ssb64`: BattleShip launch adapter. Native/ROM build entry points remain at the
  repository root for compatibility.
- `melee`: imported Melee engine, browser and native adapters, conversion tools,
  tests, and desktop packaging. `IMPORT.json` records source provenance.

Generated engines, discs and derived assets are not source. Follow each engine's
build instructions to prepare local inputs. Do not copy another checkout's build
cache into version control.
