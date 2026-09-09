# OpenSmash website

The production React site and Node server. It combines the live character,
authentication, ROM-validation, launch, and fighter-generation flows with the
CRT, pixel-grid, 3D logo, hand cursor, cartridge, console, and controller visual
system under `visual/`. In development it reads baked character bundles from `play`, portraits
and metadata from `play/ui`, and serves the browser engine from
`BattleShip/web-dist`.

The deployed app is self-contained. `visual/` is the canonical visual runtime
and asset tree; edit and review those files directly with the React app.

## Run it

```bash
cd web-prototype
pnpm install
pnpm dev
```

Open <http://127.0.0.1:4174>. For a production-style run:

```bash
pnpm build
COOKIE_SECRET="replace-me" pnpm start
```

Use `PORT` to change the port. Set a stable, private `COOKIE_SECRET` in any real
deployment so validation cookies survive restarts and cannot be forged.

The unlisted Open Graph artwork editor lives at
<http://127.0.0.1:4174/og-studio>. It pulls from the current visible fighter
roster, saves the draft locally in the browser, and exports a 1200×630 PNG.
The composition renders the actual textured meshes from each fighter's OSB6
game bundle over the exact blue `SC1PIntro` sky used by the game's pre-battle
sequence; character-select portraits are used only inside the searchable
picker. Each position can choose any body target present in that fighter's
bundle, and the on-canvas box supports direct dragging and corner resizing.
Both PNG buttons export the clean composition at the exact 1200×630 Open Graph
size without editor handles.

For production architecture, durable GCP adapters, the versioned status
contract, and the API/worker cutover checklist, see
[`docs/production-architecture.md`](docs/production-architecture.md).
Deployment prerequisites and the one-command GCP rollout are in
[`infra/README.md`](infra/README.md).

## Publish baked characters

`config/characters.json` is the ordered allowlist and single source of truth for
the baked roster. Ignored files in `BattleShip/web-dist/bundles` never add a
website character. After reviewing a manually generated fighter, publish it
through the pipeline:

```bash
python3 pipeline/baked_roster.py character-slug
```

This validates the required `play/<slug>*.osb` and `play/ui/<slug>` outputs and
adds the slug to the manifest once. You can also pass `--publish` to
`run_character.py` when the full generation run itself is the reviewed run.
Commit the generated assets and manifest together. The site
uses the same deterministic, balanced skeleton/moveset assignment as the game.
A character can declare `base` or `preferred_bases` in its pipeline
`character.json`; otherwise it is balanced across production-ready targets.
Completed public database jobs are appended as the separate dynamic roster;
signed-in users also receive their private jobs.

## ROM gate

The browser reads the selected file locally, unwraps ordinary unencrypted ZIPs,
normalizes N64 `.z64` / `.v64` / `.n64` byte order plus recognized leading
headers and trailing padding, and compares the canonical SHA-1 and size against
`shared/rom-catalog.js`. It sends only that canonical digest and byte count to
`POST /api/validate-rom`; the server checks the same shared catalog and issues a
signed, HTTP-only, 30-day cookie. The accepted catalog is the USA v1.0 image
only: the browser builds the engine's assets from the ROM with Torch compiled
to wasm and the engine is region-compiled, so other dumps are recognised and
rejected with a region-specific message. The engine routes return 401
without that cookie, and the cookie itself is signed with HMAC-SHA-256.

The ROM and archive bytes are never uploaded or stored. Password-protected and
unsupported archives must be extracted by the user first. The current WASM
package already contains the project's extracted engine assets.

Use the `Dev: clear ROM` button in the header to expire the validation cookie
and exercise the first-run flow again.

### Other ways to provide the ROM

Both paths end in the same `identifyRomFile` → `POST /api/validate-rom`
→ IndexedDB sequence as the upload button, so the engine and the session
cookie cannot tell them apart.

- **Send ROM to another device** (More menu, or Advanced when signed in with a
  ROM). The host browser opens a signalling room (`POST /api/handoff/rooms`,
  requires the ROM cookie), shows a QR code + 6-character code, and streams its
  stored ROM over a WebRTC data channel to the device that scans it
  (`src/rom-handoff-client.js`, protocol in `shared/rom-handoff.js`). The
  server relays only SDP and ICE candidates (`server/handoff-rooms.js`,
  10-minute rooms). Rooms live in memory locally and in the Firestore
  `handoffRooms` collection whenever `JOB_DATABASE=firestore` (override with
  `HANDOFF_ROOMS`), so the API can run on any number of replicas; the deploy
  enables a TTL policy on `expireAt`. ICE servers come from
  `GET /api/handoff/ice`: STUN always, plus a TURN relay when the deploy has
  Cloudflare TURN (or static `TURN_*`) credentials — see
  `infra/README.md`, "TURN relay". Without one, handoffs only succeed when
  the devices can reach each other directly. STUN only; devices should share a Wi-Fi network. On the phone
  the play flow's **Can't find your ROM?** panel (worded "Have it on your
  computer? Send it to this phone" on touch devices) or opening
  `/?handoff=CODE` receives it. Both ends hold a screen wake lock while a
  handoff is pending: a locked phone or closed lid suspends the tab and drops
  the connection, so the host modal says to keep the window open.
- **Persistent storage**. `storeRom` asks `navigator.storage.persist()` so
  Safari does not evict the ROM after a week away; a refusal is logged and
  the flow continues.

## Generate a fighter

Open `/create`, sign in, validate a supported ROM, and submit a name,
JPEG/PNG/WebP reference photo, optional emblem direction, optional move direction (powers, props, or fighting style; up to 600 characters), and public/private
visibility. Public is the default. The uploader must attest that they own or
have permission to use the character and photo. The server safety-screens the
text and image with `omni-moderation-latest` before it creates or dispatches a
paid generation job. In local mode the server stores
uploads and job records under `data/`; the production adapters use Firestore
and Cloud Storage. A single local worker runs the existing
`pipeline/run_character.py` command.

ROM verification completed through `/create` leaves the mandatory controller
check pending. The next launch from the main roster opens the completion-only
controller screen; the separate Controls menu remains a dismissible preview and
does not satisfy that check.
Before invoking the pipeline, the worker flattens multi-frame phone photos,
applies EXIF orientation, converts to plain sRGB RGB, and writes a normalized
PNG capped at 2048px so image providers receive a predictable input.

The pipeline emits versioned JSON progress records and the page receives
versioned job snapshots over server-sent events, with a slow reconciliation
poll as backup. Jobs survive server restarts, interrupted jobs are requeued, and
failed jobs can be resumed using the pipeline's existing output-based resume
behavior. Only one fighter runs at a time to avoid collisions in the shared
pipeline output directories. In GCP mode the API launches a dedicated Cloud
Run Job, which claims the Firestore record with a renewable lease.

The worker automatically rerolls provider-generated art up to two times when
output moderation blocks a random result. Temporary rate-limit, timeout, and
5xx failures receive up to three short backoff retries outside the expensive
mesh stages. Invalid inputs and mesh failures stop for manual review.

Production authentication uses Firebase Authentication with Google, Apple,
and passwordless email providers. Firebase's UID becomes the durable job
`ownerId`; the job also records the uploader profile. Private outputs are kept
in the private object bucket and served only through owner-checked API routes.
Disable an abusive uploader in Firebase Authentication to block future
creation and retry requests.

For UI or API testing without invoking paid providers, disable the worker and
optionally use a temporary job directory:

Use `pnpm dev:safe` during development. Local JSON records and a local object
store are the defaults. Set `JOB_DATABASE=firestore` and `OBJECT_STORE=gcs`
with the values shown in `.env.example` to use the production adapters.
