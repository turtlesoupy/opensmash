#!/usr/bin/env python3
"""One command: name -> playable injected fighter with full UI assets.

  run_character.py "Weird Al Yankovic" [--short WEIRDAL] [--photo ref.png]
                   [--emblem "context or object"] [--out play/ui/<slug>]
                   [--variants TARGET,...|all] [--force-stage <stage>] [--publish]

Stages (each skipped if its output already exists — delete a file or use
--force-stage to redo): expand -> tpose -> mesh (Tripo v3 + rig) ->
convert -> portrait art -> stock art -> ui pack -> announcer voice -> stage.

Model callouts: gpt-5.6-luna for the character description, gpt-image-2 for
the generated images, and MiniMax (via fal) for the announcer clip. Everything
else is deterministic.
"""
import argparse
import glob
import json
import os
import re
import subprocess
import sys
import time

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
HERE = os.path.dirname(PIPELINE_DIR)
UI_REFS = os.path.join(HERE, "web-prototype", "visual", "assets", "ui_refs")
PORTRAIT_STYLE_REFS = os.path.join(HERE, "assets", "portrait_style_refs")
# Style reference for the T-pose model sheet (the "vg7" Mario sheet the
# production recipe was tuned on; eval/ configs reference the same image from
# its original home in artifacts/experiments).
TPOSE_STYLE_REF = os.path.join(HERE, "assets", "tpose_style_ref", "vg7-tpose.png")
PORTRAIT_STYLE_REFERENCE_FILES = (
    "blakerobbins.png",
    "kaishahom.png",
    "rohansahai.png",
)
_WEBDIST_CANDIDATES = [
    os.path.join(HERE, "BattleShip", "web-dist", "bundles"),
    os.path.join(HERE, "..", "BattleShip", "web-dist", "bundles"),
]
WEBDIST = os.environ.get("OPENSMASH_WEBDIST") or next(
    (candidate for candidate in _WEBDIST_CANDIDATES if os.path.isdir(candidate)),
    _WEBDIST_CANDIDATES[0],
)

# These profiles remain available for deliberate experiments, but are not
# production-quality enough to generate/assign to every new character yet.
DEFAULT_VARIANT_EXCLUDES = {"donkey", "yoshi"}


def pipeline_script(name):
    return os.path.join(PIPELINE_DIR, name)

TRIPO_USD_PER_CREDIT = 0.01     # https://developers.tripo3d.ai/en/pricing
TRIPO_CREDITS_PER_MESH = 55     # image-to-3D 30 + auto-rig 25 (observed balance delta)
FAL_TTS_USD_PER_1K_CHARS = 0.10  # fal-ai/minimax/speech-02-hd

# stage -> USD spent in THIS run. Skipped (already-built) stages cost
# nothing now but keep whatever cost.json recorded when they last ran.
COST = {}
OUT_DIR = None   # set once main() has resolved paths, so the finally-block
SLUG = None      # reporter can run even when a stage raises


def bill(stage, usd):
    if usd is not None:
        COST[stage] = COST.get(stage, 0.0) + usd
    return usd


def gen_cost(out):
    """gen.py prints one JSON line carrying the billed token usage."""
    try:
        return json.loads(out[out.index("{"):]).get("cost_usd")
    except (ValueError, json.JSONDecodeError):
        return None

N64_TEMPLATE = (
    "A screenshot of a very low-poly 1996 Nintendo 64 fighting-game character "
    "model in T-pose: exactly ONE figure, alone, full body, front view, arms "
    "straight out horizontally, "
    "legs clearly apart with a gap between the feet, plain light-gray "
    "background, roughly 800 triangles, facial features painted flat onto the "
    "texture. The character: {desc} Chunky fighter proportions: oversized "
    "head, short thick legs, big blocky hands, hands empty (nothing held, "
    "nothing hanging from the arms). Flat solid colors with faint "
    "per-face shading, crisp boundaries, faceted low-poly look. No pure "
    "black and no mirror-like or metallic reflections anywhere: the darkest "
    "colour is charcoal grey and every garment shows lighter seams, edges "
    "and folds so each surface has visible shading detail. "
    "Match the art style, proportions, pose, framing and background of the "
    "attached low-poly Mario model sheet exactly (it is a STYLE reference "
    "only — the character must be {display})."
)
PHOTO_NOTE = (" Keep the exact likeness of the person in the attached photo(s), "
              "same expression but with closed lips, no teeth showing.")
PORTRAIT_TEMPLATE = (
    "Create a late-1990s console fighting-game character-select portrait of "
    "the character shown in the FIRST reference image (a low-poly T-pose model "
    "sheet). Match the coarse pre-rendered CGI language of the "
    "second, third and fourth reference images: a simple "
    "bust built from a few large rounded polygonal forms, soft plastic "
    "material, restrained facial detail, slightly soft raster edges, mild "
    "texture filtering, subtle grain, and a dark red-black backdrop. It must "
    "look designed to remain readable when reduced to approximately 48 by 43 "
    "pixels. Tight head-and-shoulders crop; face occupies most of the tile; "
    "three-quarter view facing slightly left; square image. Soft warm key "
    "light from upper left, deep shadow on the opposite side, restrained "
    "highlights. Preserve the recognizable subject, clothing, hair, and face "
    "from the first reference image; use the other three images only for "
    "style and never depict the people in them. Intentionally low-detail "
    "late-90s pre-rendered CGI, not "
    "a crisp modern low-poly illustration; no sharp vector-like facets; no "
    "high-frequency skin detail; no text, letters, border, logo, or watermark."
)
STOCK_TEMPLATE = (
    "A tiny video-game stock/life icon in the exact style of the first "
    "reference image (Super Smash Bros 64 stock icon): the head of the "
    "character from the second reference image, drawn as extremely simple "
    "chibi pixel art with huge bold shapes, flat solid colors only (max 6 "
    "colors), thick black outline around the whole silhouette, straight-on "
    "view, centered, filling the frame. Solid pure green background "
    "(#00FF00). No text, no shading gradients, no dithering."
)
STOCK_DESC_TEMPLATE = (
    "A tiny video-game stock/life icon in the exact style of the reference image "
    "(Super Smash Bros 64 stock icon): the head of this character, drawn as "
    "extremely simple chibi pixel art with huge bold shapes, flat solid colors "
    "only (max 6 colors), thick black outline around the whole silhouette, "
    "straight-on view, centered, filling the frame. Solid pure green background "
    "(#00FF00). No text, no shading gradients, no dithering. The character: "
)
EMBLEM_TEMPLATE = (
    "A flat 2D video game series emblem symbol for the character {display}: "
    "ONE single iconic object strongly associated with this character{obj} "
    "— never the character themselves, no face, no figure — in the chunky "
    "simple style of the 1990s Nintendo 64 series emblems in the first "
    "reference image (the game's own ten emblems: mushroom, DK, screw "
    "attack, Star Fox, star, triforce, Yoshi egg, F-Zero, Poke Ball, "
    "globe). One bold glyph, straight-on view, perfectly centered, filling "
    "most of the frame, strong dark outline. "
    "CRITICAL: the emblem is also read as a ONE-COLOR STENCIL, so it must "
    "be recognizable from its shape alone. Build the object out of a few "
    "LARGE flat color regions with strong light/dark contrast between "
    "neighbors, each separated by a thick dark line, so the interior "
    "structure is as bold as the outline — the way the Poke Ball's band "
    "and center or Yoshi's egg spots survive as pure shape. No thin "
    "scratches, hairlines or engraved detail. "
    "Flat solid colors only (max 5 colors), no shading gradients, no "
    "dithering. Solid pure green background (#00FF00). No text, no letters."
)
# appended on a re-roll when the stencil came out as a featureless blob
EMBLEM_RETRY = (
    " The previous attempt was one solid uncut shape and read as a blob. "
    "Give the object much bolder INTERNAL structure: two or three big "
    "clearly separated regions of very different brightness (a dark region "
    "against a light region), and thick dark dividing lines across the "
    "body of the object."
)

PROGRESS_STAGES = (
    ("expand:", "expand", "Describing the fighter", 6),
    ("character:", "character", "Fighter concept ready", 12),
    ("tpose:", "tpose", "Generating the model sheet", 18),
    ("mesh: uploading", "mesh-upload", "Starting the 3D model", 27),
    ("mesh: img3d", "mesh-build", "Building the 3D model", 36),
    ("mesh: rig task", "mesh-rig", "Rigging the fighter", 45),
    ("mesh:", "mesh", "3D model ready", 50),
    ("convert:", "convert", "Converting for the game", 56),
    ("variants:", "variants", "Building moveset variants", 66),
    ("portrait:", "portrait", "Painting character-select art", 75),
    ("stock:", "stock", "Drawing the stock icon", 81),
    ("emblem:", "emblem", "Designing the emblem", 86),
    ("ui:", "ui", "Packing game UI", 91),
    ("voice:", "voice", "Recording the announcer", 95),
    ("staged into", "publish", "Publishing the fighter", 98),
    ("done:", "complete", "Fighter ready", 100),
)


def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)
    normalized = msg.lower()
    for prefix, stage, label, progress in PROGRESS_STAGES:
        if normalized.startswith(prefix):
            event = {
                "protocolVersion": 1,
                "type": "job.progress",
                "stage": stage,
                "label": label,
                "progress": progress,
                "message": msg,
            }
            print("@@opensmash " + json.dumps(event, separators=(",", ":")), flush=True)
            break


def sh(cmd, timeout=900):
    r = subprocess.run(cmd, cwd=HERE, capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd[:3])}... failed:\n{(r.stdout or '') + (r.stderr or '')}"[-800:])
    return r.stdout


def generate_emblem_image(prompt, output):
    """Use a neutral local glyph if the provider blocks this optional artwork."""
    try:
        bill("emblem", gen_cost(sh(
            ["python3", pipeline_script("gen.py"), "image",
             "--ref", os.path.join(UI_REFS, "emblem_ref.png"),
             prompt, output], timeout=600)))
    except RuntimeError as error:
        if "moderation_blocked" not in str(error):
            raise
        # A decorative emblem must not discard a completed fighter. This
        # geometric ring goes through the normal stencil/packing path and
        # is saved under the usual filename so resumed jobs reuse it.
        from PIL import Image, ImageDraw
        log("emblem: provider blocked artwork; using a generic ring emblem")
        art = Image.new("RGB", (256, 256), "white")
        draw = ImageDraw.Draw(art)
        draw.ellipse((24, 24, 231, 231), fill="black")
        draw.ellipse((76, 76, 179, 179), fill="white")
        art.save(output)


def tripo_json(out):
    """tripo.py prints one JSON object (possibly {'code':0,'data':...}).
    Some Tripo status payloads embed raw control characters — fall back to
    regex field extraction rather than dying on strict JSON."""
    i = out.find("{")
    if i < 0:
        # curl/urllib produced no JSON at all: a dropped connection, not a
        # Tripo verdict — surface it so the batch driver treats it as transient
        raise RuntimeError(f"tripo empty response (network?): {out[-200:]!r}")
    try:
        obj = json.loads(out[i:], strict=False)
        return obj.get("data", obj)
    except json.JSONDecodeError:
        fields = dict(re.findall(r'"(\w+)"\s*:\s*"([^"\x00-\x1f]*)"', out))
        # Numeric fields too: consumed_credit is what the cost report bills
        # from, and tripo.py's 700-char status cut leaves the trailing signed
        # URL unterminated, so this path runs on every successful task.
        for key, value in re.findall(r'"(\w+)"\s*:\s*(-?\d+(?:\.\d+)?)\b', out):
            fields.setdefault(key, float(value) if "." in value else int(value))
        if "status" in fields or "task_id" in fields or "image_token" in fields:
            return fields
        raise


def report_cost():
    """Merge this run into <out>/cost.json and print the breakdown.

    A re-run REPLACES that stage's cost: cost.json answers "what did the
    current set of artifacts cost", not "how much have I ever spent on this
    slug". Stages skipped by the resume logic keep the cost they were last
    built at. Called from a finally block so a character that dies at the
    torn-tri gate still records what its failed attempt cost -- at scale the
    rejects are most of the surprise."""
    if not OUT_DIR:
        return
    path = os.path.join(OUT_DIR, "cost.json")
    prev = {}
    if os.path.exists(path):
        try:
            prev = json.loads(open(path).read())
        except json.JSONDecodeError:
            pass
    stages = dict(prev.get("stages") or {})
    for k, v in COST.items():
        stages[k] = round(v, 6)
    doc = {"slug": SLUG, "stages": stages,
           "total_usd": round(sum(stages.values()), 4),
           "last_run": {"at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                        "stages": {k: round(v, 6) for k, v in COST.items()},
                        "total_usd": round(sum(COST.values()), 4)}}
    json.dump(doc, open(path, "w"), indent=1)
    if COST:
        log("cost: " + "  ".join(
            f"{k} ${v:.4f}" for k, v in sorted(COST.items(), key=lambda kv: -kv[1])))
    log(f"cost: ${doc['last_run']['total_usd']:.4f} this run, "
        f"${doc['total_usd']:.4f} for {SLUG} to date -> {path}")


def tripo_balance():
    """Tripo task payloads carry no cost field, so the charge is only
    observable as a balance delta around the task."""
    return tripo_json(sh(["python3", pipeline_script("tripo.py"), "balance"], timeout=60))["balance"]


def stage_needed(path, force, name):
    if force == name:
        return True
    # An empty file is a stage that died mid-write (seen when expand crashed
    # after its output file was already opened), not a finished stage.
    return not os.path.exists(path) or os.path.getsize(path) == 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("name")
    ap.add_argument("--short", default=None,
                    help="tile caption for in-game text (<=10 chars, A-Z)")
    ap.add_argument("--display", default=None,
                    help="in-game name AND what the announcer shouts (e.g. \"Mozart\"); "
                         "the expander picks it, this overrides and persists it. Delete "
                         "announcer.wav to re-record after changing it.")
    ap.add_argument("--photo", default=None)
    ap.add_argument("--notes", default=None,
                    help="steering for the expander (which depiction, outfit, era); "
                         "use with --force-stage expand to redo an existing character")
    ap.add_argument("--emblem", default=None,
                    help="context for the series emblem, or the object itself "
                         "(\"a red accordion\", \"he restores lighthouses\"). "
                         "Default: inferred from the name and photo. Also "
                         "editable afterwards as \"emblem\" in character.json.")
    ap.add_argument("--out", default=None)
    ap.add_argument("--slug", default=None,
                    help="bundle/output name ([a-z0-9]); default is derived from the name. "
                         "The web fighter lab passes a suffixed one so players' fighters never "
                         "collide with each other or with the baked roster")
    ap.add_argument(
        "--variants", default=None, metavar="TARGET,...|all",
        help="variant targets to build; default is every profile except "
             "donkey/yoshi, while 'all' includes those experimental targets")
    ap.add_argument("--force-stage", default=None,
                    choices=["expand", "tpose", "mesh", "convert", "variants", "portrait", "stock", "emblem", "ui", "voice"])
    ap.add_argument("--flip-facing", action="store_true",
                    help="convert with the facing flipped and skip the vision gate; for a fighter "
                         "verified backwards by eye that the gate keeps passing (or a gate false positive)")
    ap.add_argument("--publish", action="store_true",
                    help="after a successful run, validate and add this manual character to the baked roster")
    a = ap.parse_args()

    slug = a.slug or re.sub(r"[^a-z0-9]", "", a.name.lower())[:16]
    if not re.fullmatch(r"[a-z0-9]{1,32}", slug):
        ap.error(f"--slug must be 1-32 lowercase letters/digits, got {slug!r}")
    out = a.out or os.path.join(HERE, "play", "ui", slug)
    os.makedirs(out, exist_ok=True)
    global OUT_DIR, SLUG
    OUT_DIR, SLUG = out, slug
    F = lambda n: os.path.join(out, n)
    force = a.force_stage

    # 1. expand ----------------------------------------------------------
    if stage_needed(F("character.json"), force, "expand"):
        log("expand: describing character")
        cmd = ["python3", pipeline_script("expand_character.py"), a.name]
        if a.photo:
            cmd += ["--photo", a.photo]
        if a.notes:
            cmd += ["--notes", a.notes]
        if a.emblem:
            cmd += ["--emblem", a.emblem]
        # Run first, write second: open(..., "w") before sh() truncated the
        # file, and a failing expand left an empty character.json behind.
        expanded = sh(cmd, timeout=180)
        open(F("character.json"), "w").write(expanded)
        bill("expand", json.loads(open(F("character.json")).read()).get("cost_usd"))
    cdef = json.loads(open(F("character.json")).read())
    # display = in-game name = announcer call ("Mozart", "Hercules", "Marilyn
    # Monroe"); name_full keeps the roster entry for search. Older
    # character.json files predate name_full — backfill it from the name
    # this run was invoked with.
    _dirty = False
    if a.display and cdef.get("display") != a.display:
        cdef["display"] = a.display
        _dirty = True
    if not cdef.get("name_full"):
        cdef["name_full"] = a.name
        _dirty = True
    if _dirty:
        json.dump(cdef, open(F("character.json"), "w"), indent=1)
    short = (a.short or cdef.get("short") or re.sub(r"[^A-Za-z]", "", cdef["display"]).upper())
    short = re.sub(r"[^A-Z]", "", short.upper())[:10]
    # Persist the resolved short name. The .osbui pack takes it as an argument,
    # but the dev server's /roster.json reads it back out of character.json --
    # so a --short override has to land in the file or the tile caption and the
    # roster entry disagree.
    if cdef.get("short") != short:
        cdef["short"] = short
        json.dump(cdef, open(F("character.json"), "w"), indent=1)
    log(f"character: {cdef['display']} (short: {short}, full: {cdef['name_full']})")

    # 2. tpose -----------------------------------------------------------
    if stage_needed(F("tpose.png"), force, "tpose"):
        log("tpose: generating source image")
        prompt = N64_TEMPLATE.format(desc=cdef["desc"], display=cdef["display"])
        cmd = ["python3", pipeline_script("gen.py"), "image", "--api", "openai", "--model", "gpt-image-2",
               "--ref", TPOSE_STYLE_REF]
        if a.photo:
            cmd += ["--ref", a.photo]
            prompt += PHOTO_NOTE
        bill("tpose", gen_cost(sh(cmd + [prompt, F("tpose.png")], timeout=600)))

    # 3. mesh + rig ------------------------------------------------------
    if stage_needed(F("rigged.glb"), force, "mesh"):
        # Tripo task IDs are persisted the moment they exist so an interrupted
        # container (SIGTERM, lease loss) resumes polling the paid task instead
        # of buying the mesh again. --force-stage mesh deliberately starts over.
        tasks_path = F("tripo_tasks.json")
        tasks = {}
        if force != "mesh" and os.path.exists(tasks_path):
            try:
                tasks = json.loads(open(tasks_path).read())
            except json.JSONDecodeError:
                tasks = {}

        def remember(key, task_id):
            tasks[key] = task_id
            json.dump(tasks, open(tasks_path, "w"), indent=1)

        def forget():
            tasks.clear()
            if os.path.exists(tasks_path):
                os.remove(tasks_path)

        def wait_task(task_id):
            st = {"status": "unknown"}
            for _ in range(90):
                st = tripo_json(sh(["python3", pipeline_script("tripo.py"), "status", task_id], timeout=60))
                if st["status"] in ("success", "failed", "banned"):
                    break
                time.sleep(10)
            return st

        task = tasks.get("img3d")
        if task:
            log(f"mesh: img3d task {task} (resumed)")
        else:
            log("mesh: uploading to Tripo")
            tok = tripo_json(sh(["python3", pipeline_script("tripo.py"), "upload", F("tpose.png")], timeout=300))["image_token"]
            task = tripo_json(sh(["python3", pipeline_script("tripo.py"), "img3d", tok], timeout=900))["task_id"]
            remember("img3d", task)
            log(f"mesh: img3d task {task}")
        st = wait_task(task)
        if st["status"] != "success":
            # Keep a still-running task on disk so a retry resumes polling
            # instead of buying the mesh again; only a terminal status is
            # forgotten.
            if st["status"] in ("failed", "banned"):
                forget()
            raise RuntimeError(f"img3d {st['status']}")
        model_credits = st.get("consumed_credit")
        rig = tasks.get("rig")
        if rig:
            log(f"mesh: rig task {rig} (resumed)")
        else:
            rig = tripo_json(sh(["python3", pipeline_script("tripo.py"), "rig", task], timeout=900))["task_id"]
            remember("rig", rig)
            log(f"mesh: rig task {rig}")
        st = wait_task(rig)
        if st["status"] != "success":
            # Keep a still-running task on disk so a retry resumes polling
            # instead of buying the mesh again; only a terminal status is
            # forgotten.
            if st["status"] in ("failed", "banned"):
                forget()
            raise RuntimeError(f"rig {st['status']}")
        rig_credits = st.get("consumed_credit")
        # Download to a side file so a kill mid-transfer never leaves a
        # truncated rigged.glb that the resume logic would treat as complete.
        sh(["python3", pipeline_script("tripo.py"), "download", rig, F("rigged.glb.part")], timeout=600)
        os.replace(F("rigged.glb.part"), F("rigged.glb"))
        if model_credits is None or rig_credits is None:
            # Status payloads stopped carrying consumed_credit (2026-09-02);
            # the balance delta says img3d 30 + rig 25 = 55 per character.
            log(f"mesh: Tripo did not report per-task credits; billing the "
                f"list price of {TRIPO_CREDITS_PER_MESH}")
            bill("mesh", TRIPO_CREDITS_PER_MESH * TRIPO_USD_PER_CREDIT)
        else:
            credits = model_credits + rig_credits
            log(f"mesh: {credits} Tripo credits (img3d + rig)")
            bill("mesh", credits * TRIPO_USD_PER_CREDIT)

    # 4. convert ---------------------------------------------------------
    osb = os.path.join(HERE, "play", f"{slug}.osb")
    if stage_needed(osb, force, "convert"):
        log("convert: retargeting onto the game skeleton")
        outtxt = sh(["python3", pipeline_script("convert_rigged.py"), "--mild-color", "--no-profile", "--flatten",
                     F("rigged.glb"), "skels/mario-frames.skel", F("bundle.json")], timeout=900)
        torn = re.search(r"torn-tri cut: (\d+)", outtxt)
        if torn and int(torn.group(1)) > 80:
            raise RuntimeError(f"torn-tri gate: {torn.group(1)} > 80 — bad mesh, re-roll tpose/mesh")
        # Facing gate: the converter's geometric cues (skin colour, head
        # offset, toe reach) misread non-human bodies (Cthulhu, the Jersey
        # Devil walked backwards). Render the bundle and let the vision
        # model compare against the t-pose, which is the front by
        # construction; redo the conversion with --flip-facing if needed.
        # --flip-facing on the command line is the human override: the
        # judgement was made by eye, so skip the model entirely.
        if a.flip_facing:
            log("convert: --flip-facing given — reconverting flipped, skipping the facing gate")
            sh(["python3", pipeline_script("convert_rigged.py"), "--mild-color", "--no-profile", "--flatten",
                "--flip-facing", F("rigged.glb"), "skels/mario-frames.skel", F("bundle.json")], timeout=900)
            open(F("facing_flipped"), "w").write("1")
        else:
          try:
            fc = json.loads(sh(["python3", pipeline_script("facing_check.py"), F("bundle.json"), F("tpose.png")],
                               timeout=300).strip().splitlines()[-1])
            bill("facing", fc.get("cost_usd"))
            if fc.get("flipped"):
                log(f"convert: facing check says the model faces away ({fc.get('confidence')}) — reconverting with --flip-facing")
                sh(["python3", pipeline_script("convert_rigged.py"), "--mild-color", "--no-profile", "--flatten",
                    "--flip-facing", F("rigged.glb"), "skels/mario-frames.skel", F("bundle.json")], timeout=900)
                open(F("facing_flipped"), "w").write("1")
            else:
                log(f"convert: facing check ok ({fc.get('confidence')})")
          except Exception as e:  # never block a character on the gate itself
            log(f"convert: facing check unavailable ({str(e)[-120:]}) — keeping the converter's call")
        sh(["python3", pipeline_script("convert_rigged.py"), "--binary5", F("bundle.json"), osb], timeout=300)

    # 4b. variants -------------------------------------------------------
    # Conversion is pure deterministic geometry (no model calls). Enabled
    # targets use the canonical lambda blend (0.5 unless their profile pins a
    # recipe; Kirby/Purin use 0.6 + ball mode). Build the production target
    # pool by default; experimental profiles can still be requested explicitly
    # with --variants donkey,yoshi (or --variants all).
    all_variants = sorted(
        os.path.basename(pj)[:-len(".profile.json")]
        for pj in glob.glob(os.path.join(HERE, "skels", "*.profile.json")))
    if a.variants is None:
        variants = [v for v in all_variants if v not in DEFAULT_VARIANT_EXCLUDES]
    elif a.variants.strip().lower() == "all":
        variants = all_variants
    else:
        requested = [v.strip().lower() for v in a.variants.split(",") if v.strip()]
        unknown = sorted(set(requested) - set(all_variants))
        if unknown:
            ap.error("unknown variant target(s): " + ", ".join(unknown))
        variants = list(dict.fromkeys(requested))
    for tgt in variants:
        vosb = os.path.join(HERE, "play", f"{slug}-{tgt}.osb")
        if not stage_needed(vosb, force, "variants"):
            continue
        log(f"variants: retargeting onto {tgt}")
        profile = os.path.join(HERE, "skels", f"{tgt}.profile.json")
        try:
            # Profiles' production morph recipes (including Kirby/Purin ball
            # mode and bind-orientation repair) live in the canonical writer.
            # The old direct-target path silently ignored those settings.
            sh(["python3", pipeline_script("convert_rigged.py"),
                "--binary5-canonical", F("bundle.json"), vosb, profile],
               timeout=300)
        except Exception as e:
            log(f"variants: {tgt} FAILED ({e}) — continuing")

    # 4c. pack ----------------------------------------------------------
    # The shipped bundle is one OSB6 per character: the atlas once (at the
    # 512x512 production size) plus every built target's payload, so the
    # engine picks the block for whatever fighter it spawns. The per-target
    # .osb files above stay as pipeline intermediates for the offline tools.
    osb6 = os.path.join(HERE, "play", f"{slug}.osb6")
    log("pack: merging targets into one OSB6 bundle")
    sh(["python3", pipeline_script("osb_merge.py"), osb, "-o", osb6, "--atlas", "512"], timeout=300)

    # 5+6. UI art --------------------------------------------------------
    if stage_needed(F("portrait_raw.png"), force, "portrait"):
        log("portrait: generating tile art")
        # Subject FIRST. With the tpose as the trailing (fourth) image,
        # gpt-image-2 painted the last style reference's face on every
        # character (pilot 2026-09-02: three different people, one portrait).
        refs = ["--ref", F("tpose.png")]
        for filename in PORTRAIT_STYLE_REFERENCE_FILES:
            ref = os.path.join(PORTRAIT_STYLE_REFS, filename)
            if not os.path.exists(ref):
                raise RuntimeError(f"portrait style reference missing: {ref}")
            refs += ["--ref", ref]
        bill("portrait", gen_cost(sh(["python3", pipeline_script("gen.py"), "image"] + refs
             # No name in this prompt: naming a public figure next to their likeness
             # trips gpt-image-2's input moderation ("public-figure"); the tpose
             # image alone carries the identity.
             + [PORTRAIT_TEMPLATE, F("portrait_raw.png")],
             timeout=600)))
    # Site derivatives of the portrait (grid tile + thumbnail); the 1024 raw
    # stays for the .osbui pack and anywhere a large portrait is shown.
    sh(["python3", pipeline_script("portrait_tiles.py"), out], timeout=120)

    if stage_needed(F("stock_raw.png"), force, "stock"):
        log("stock: generating icon art")
        try:
            bill("stock", gen_cost(sh(
                ["python3", pipeline_script("gen.py"), "image", "--ref", os.path.join(UI_REFS, "stockicon_ref.png"),
                 "--ref", F("tpose.png"), STOCK_TEMPLATE, F("stock_raw.png")], timeout=600)))
        except RuntimeError as e:
            # For some public figures the input filter refuses the t-pose
            # image on this call even though the portrait call accepted it
            # (Gandhi: 10/10 refusals, any wording, any extra refs). A 16px
            # icon survives without the likeness reference: draw it from the
            # text description with the name stripped.
            if "moderation_blocked" not in str(e) or '"input"' not in str(e):
                raise
            log("stock: input moderation on the likeness — drawing the icon from the description")
            desc = cdef["desc"].replace(cdef["display"], "The character", 1)
            bill("stock", gen_cost(sh(
                ["python3", pipeline_script("gen.py"), "image", "--ref", os.path.join(UI_REFS, "stockicon_ref.png"),
                 STOCK_DESC_TEMPLATE + desc, F("stock_raw.png")], timeout=600)))
    if stage_needed(F("emblem_raw.png"), force, "emblem"):
        # --emblem beats whatever the expander inferred, so the object can be
        # steered without re-running the expand stage.
        obj = a.emblem or cdef.get("emblem") or ""
        log(f"emblem: generating series-emblem art{' (' + obj + ')' if obj else ''}")
        prompt = EMBLEM_TEMPLATE.format(display=cdef["display"],
                                        obj=f", specifically {obj}," if obj else "")
        # The engine draws the emblem as a flat one-color stencil, so gate on
        # the stencil, not on the art: a gorgeous solid object is still a blob.
        for _ in range(2):
            generate_emblem_image(prompt, F("emblem_raw.png"))
            st = json.loads(sh(["python3", pipeline_script("emblem_stencil.py"), F("emblem_raw.png")],
                               timeout=120))
            log(f"emblem: stencil cut {st['cut_frac']:.0%} in {st['cuts']} holes")
            if not st.get("blobby"):
                break
            log("emblem: featureless blob — re-rolling with bolder interior")
            prompt += EMBLEM_RETRY

    # 7. pack ------------------------------------------------------------
    osbui = F(f"{slug}.osbui")
    if stage_needed(osbui, force, "ui"):
        log("ui: packing .osbui")
        sh(["python3", pipeline_script("gen_ui_assets.py"), osbui, "--art", F("portrait_raw.png"),
            "--stock-art", F("stock_raw.png"), "--emblem", F("emblem_raw.png"),
            "--name", short], timeout=300)

    # One source package serves every Melee moveset; no per-target conversion.
    log("melee-source: preparing native source assets")
    sh([sys.executable, os.path.join(HERE, "engines", "melee", "tools", "bake_native_sources.py"), out], timeout=90)

    # 8. voice -----------------------------------------------------------
    wav = F("announcer.wav")
    if stage_needed(wav, force, "voice"):
        log("voice: generating announcer clip")
        spoken = cdef["display"].strip()   # display IS the announcer form (Mozart, Hercules, Marilyn Monroe)
        log(f"voice: announcer says {spoken!r}")
        sh(["python3", pipeline_script("announcer_voice.py"), spoken, "--slug", slug,
            "--out", wav, "--no-stage"], timeout=300)
        # generate_announcer speaks the name plus a terminal "!"
        spoken += "" if spoken.endswith("!") else "!"
        bill("voice", len(spoken) / 1000.0 * FAL_TTS_USD_PER_1K_CHARS)

    # 9. stage -----------------------------------------------------------
    if os.path.isdir(WEBDIST):
        stage_files = [(osb6, f"{slug}.osb6"), (osbui, f"{slug}.osbui"), (wav, f"{slug}.wav")]
        for src, base in stage_files:
            dst = os.path.join(WEBDIST, base)
            open(dst, "wb").write(open(src, "rb").read())
        log(f"staged into web-dist/bundles ({len(stage_files)} files)")
    if a.publish:
        canonical_out = os.path.join(HERE, "play", "ui", slug)
        if os.path.realpath(out) != os.path.realpath(canonical_out):
            raise RuntimeError("--publish requires the canonical play/ui/<slug> output directory")
        from baked_roster import publish_character
        changed = publish_character(slug)
        log(f"{'published' if changed else 'already present in'} baked roster manifest")
    url = (f"http://localhost:8600/index.html?inject=bundles/{slug}.osb6"
           f"&inject_ui=bundles/{slug}.osbui&inject_voice=bundles/{slug}.wav"
           f"&SSB64_START_SCENE=16")
    log(f"done: {url}")


if __name__ == "__main__":
    try:
        main()
    finally:
        report_cost()
