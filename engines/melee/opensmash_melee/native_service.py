"""Desktop protocol v1: validated launch plans, local costumes, and native processes."""

import hashlib, json, os, platform, re, subprocess, sys, threading, uuid
from pathlib import Path


class NativeService:
    def __init__(self, root, catalog, setup, runtime, startup_log=None):
        report = startup_log or (lambda message: None)
        report("Reading native runtime configuration")
        self.root = Path(root)
        self.catalog = catalog
        self.setup = setup
        # Match the executable's canonical directory spelling on Windows. The
        # runner also searches its own Mods directory; different casing can
        # otherwise make it load the same plugin twice and reject every mod.
        self.runtime = Path(runtime).resolve()
        self.schema = json.loads(
            (self.root / "runtime/launch-options.json").read_text()
        )
        self.manifest = json.loads((self.runtime / "runtime.json").read_text())
        self.session = None
        self.cancelled = set()
        self.process = None
        self.stop_file = None
        self.lock = threading.RLock()
        self.log = self.root / "build/native-session.log"
        self.user = self.root / "build/native-user"
        self.status_message = "Ready."
        self.startup_phase = 0
        if self.manifest.get("protocol") != 1:
            raise ValueError("Incompatible native runtime protocol")
        for key in ["runner", "module", "controllers"]:
            if self.manifest.get(key) not in self.manifest.get("sha256", {}):
                raise ValueError("Incomplete runtime manifest")
        for name, digest in self.manifest["sha256"].items():
            report(f"Verifying runtime file: {name}")
            path = (self.runtime / name).resolve()
            if not path.is_relative_to(self.runtime.resolve()):
                raise ValueError("Invalid runtime manifest path")
            with path.open("rb") as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != digest:
                    raise ValueError("Runtime integrity check failed: " + name)
            report(f"Verified runtime file: {name}")
        report("Native runtime verification complete")

    def status(self):
        running = self.process is not None and self.process.poll() is None
        text = ""
        if self.log.exists():
            with self.log.open("rb") as stream:
                stream.seek(max(0, self.log.stat().st_size - 16000))
                text = stream.read().decode(errors="replace")
        milestones = [
            ("mod loaded:", "Opening your game…"),
            ("[staticrecomp] core init", "Loading game data…"),
            ("[staticrecomp] module loaded:", "Loading fighters and stage…"),
            ("[staticrecomp] execution=", "Booting Melee…"),
            ("[opensmash] launch mode=", "Preparing your match…"),
            ("[opensmash] preparing first scene", "Getting the first scene ready…"),
            ("[opensmash] destination ready", "Game is running."),
            ("[opensmash] combat started", "Game is running."),
        ]
        if running:
            for step, (marker, _) in enumerate(milestones, 1):
                if marker in text:
                    self.startup_phase = max(self.startup_phase, step)
        ready = self.startup_phase >= 7
        starting = milestones[self.startup_phase - 1][1] if self.startup_phase else "Checking game files…"
        return {
            "protocol": 1,
            "session": self.session,
            "running": running,
            "ready": running and ready,
            "exitCode": self.process.poll() if self.process else None,
            "message": (
                "Game is running."
                if running and ready
                else starting if running else self.status_message
            ),
        }

    def stop(self, session=None):
        with self.lock:
            if session is not None:
                if not isinstance(session, str) or not re.fullmatch(
                    r"[a-f0-9-]{36}", session
                ):
                    raise ValueError("Invalid launch session")
                self.cancelled.add(session)
                if session != self.session:
                    return self.status()
            if self.session:
                self.cancelled.add(self.session)
            if self.process and self.process.poll() is None:
                if self.stop_file is not None:
                    self.stop_file.touch()
                else:
                    self.process.terminate()
                try:
                    self.process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait()
            if self.stop_file is not None:
                self.stop_file.unlink(missing_ok=True)
                self.stop_file = None
            self.status_message = "Game closed."
        return self.status()

    def begin(self, session):
        """Reserve the next launch before character preparation starts."""
        if not isinstance(session, str) or not re.fullmatch(r"[a-f0-9-]{36}", session):
            raise ValueError("Invalid launch session")
        with self.lock:
            if session in self.cancelled:
                raise ValueError("Launch was cancelled")
            self.stop()
            self.session = session
            self.process = None
            self.status_message = "Preparing your character…"
            return self.status()

    def validate(self, plan):
        def integer(x, lo, hi):
            return type(x) is int and lo <= x <= hi

        if not isinstance(plan, dict) or not integer(plan.get("mode"), 0, 4):
            raise ValueError("Invalid launch mode")
        if plan.get("stage") not in [
            s["id"] for s in self.schema["stages"] if s["id"] != -1
        ]:
            raise ValueError("Invalid stage")
        for key, lo, hi in [("level", 1, 9), ("stocks", 1, 99), ("minutes", 0, 99)]:
            if not integer(plan.get(key), lo, hi):
                raise ValueError("Invalid " + key)
        ports = plan.get("ports")
        packed = []
        devices = set()
        if not isinstance(ports, list) or len(ports) != 4:
            raise ValueError("Four ports are required")
        for p in ports:
            if not isinstance(p, dict):
                raise ValueError("Invalid player")
            d = p.get("device")
            f = p.get("fighter")
            c = p.get("color")
            if (
                d
                not in [
                    "keyboard",
                    "cpu",
                    "off",
                    "gamepad0",
                    "gamepad1",
                    "gamepad2",
                    "gamepad3",
                ]
                or not integer(f, 0, 25)
                or not integer(c, 0, 5)
            ):
                raise ValueError("Invalid player")
            if d not in ["cpu", "off"]:
                if d in devices:
                    raise ValueError("Each controller can only be assigned once")
                devices.add(d)
            packed.append(
                f | ((3 if d == "off" else 1 if d == "cpu" else 0) << 8) | (c << 16)
            )
        if plan["mode"] == 0 and sum(p["device"] != "off" for p in ports) < 2:
            raise ValueError("A match needs two players")
        if plan["mode"] == 3 and ports[0]["device"] in ["off", "cpu"]:
            raise ValueError("Classic needs a human player 1")
        costumes = plan.get("costumes", [])
        if not isinstance(costumes, list) or len(costumes) > 8:
            raise ValueError("Invalid costumes")
        from .targets import BY_SLUG, cache_id
        kinds = {slug:row['fighter'] for slug,row in BY_SLUG.items()}
        paths = []
        for c in costumes:
            if not isinstance(c, dict):
                raise ValueError("Invalid costume")
            row = self.catalog.get(c.get("character"))
            target = c.get("target", row["target"] if row else None)
            if not row or c.get("fighter") != kinds.get(target):
                raise ValueError("Unknown custom character")
            slots = BY_SLUG[target]["costumes"]
            color = c.get("color")
            if (
                not integer(color, 0, len(slots) - 1)
                or c.get("filename") != slots[color]["filename"]
            ):
                raise ValueError("Invalid costume slot")
            ident = cache_id(row["slug"],target,row.get("original_target", row["target"]))
            source = (
                self.root
                / "build/characters"
                / ident
                / ("browser-compact" if len(costumes) >= 3 else "browser")
                / c["filename"]
            )
            if not source.is_file():
                raise ValueError("Prepare the character before launching")
            paths.append((source, c["filename"]))
        return packed, paths

    # Rebindable controls the Controls screen saves (see web/lib/controls.ts).
    ACTIONS = [
        "up", "down", "left", "right", "a", "b", "x", "y", "z", "l", "r", "start",
        "cup", "cdown", "cleft", "cright",
    ]
    BUTTONS = ["a", "b", "x", "y", "z", "l", "r", "start"]
    DEFAULT_KEYBOARD = {
        "up": "KeyW", "down": "KeyS", "left": "KeyA", "right": "KeyD",
        "a": "KeyJ", "b": "KeyK", "x": "Space", "y": "KeyI", "z": "KeyU",
        "l": "KeyQ", "r": "KeyE", "start": "Enter",
        "cup": "ArrowUp", "cdown": "ArrowDown", "cleft": "ArrowLeft", "cright": "ArrowRight",
    }
    DEFAULT_GAMEPAD = {"a": 0, "b": 1, "x": 2, "y": 3, "z": 5, "l": 6, "r": 7, "start": 9}
    # Dolphin SDL input names by standard-mapping gamepad button index.
    SDL_BUTTONS = [
        "Button A", "Button B", "Button X", "Button Y", "Shoulder L", "Shoulder R",
        "Trigger L", "Trigger R", "Back", "Start", "Thumb L", "Thumb R",
        "Pad N", "Pad S", "Pad W", "Pad E",
    ]
    BINDING_TARGETS = {
        "up": "Main Stick/Up", "down": "Main Stick/Down",
        "left": "Main Stick/Left", "right": "Main Stick/Right",
        "a": "Buttons/A", "b": "Buttons/B", "x": "Buttons/X", "y": "Buttons/Y",
        "z": "Buttons/Z", "l": "Triggers/L", "r": "Triggers/R", "start": "Buttons/Start",
        "cup": "C-Stick/Up", "cdown": "C-Stick/Down",
        "cleft": "C-Stick/Left", "cright": "C-Stick/Right",
    }

    # Keys the first embedded runtime's keyboard device exposed; newer runtimes
    # (manifest keyboardKeys >= 2) name every rebindable key.
    LEGACY_EMBEDDED_KEYS = {"Key" + c for c in "ASDFHGQWETOUIJK"} | {
        "Enter", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
    }

    def bindings(self, controls, embedded=False):
        """Merge saved controls over the defaults, dropping anything malformed."""
        keyboard = dict(self.DEFAULT_KEYBOARD)
        gamepad = dict(self.DEFAULT_GAMEPAD)
        controls = controls if isinstance(controls, dict) else {}
        limited = embedded and (self.manifest.get("keyboardKeys") or 1) < 2
        saved = controls.get("keyboard")
        if isinstance(saved, dict):
            for action in self.ACTIONS:
                code = saved.get(action)
                if not isinstance(code, str) or not self.key_name(code, "embedded"):
                    continue
                if limited and code not in self.LEGACY_EMBEDDED_KEYS:
                    continue
                keyboard[action] = code
        saved = controls.get("gamepad")
        if isinstance(saved, dict):
            for action in self.BUTTONS:
                index = saved.get(action)
                if type(index) is int and 0 <= index < len(self.SDL_BUTTONS):
                    gamepad[action] = index
        return keyboard, gamepad

    @staticmethod
    def key_name(code, backend):
        """Dolphin's name for a DOM key code on one keyboard backend, or None."""
        arrows = {"ArrowUp": "Up", "ArrowDown": "Down", "ArrowLeft": "Left", "ArrowRight": "Right"}
        if len(code) == 4 and code.startswith("Key") and code[3].isupper() and code[3].isalpha():
            return code[3]
        if len(code) == 6 and code.startswith("Digit") and code[5].isdigit():
            return code[5]
        if backend == "dinput":
            names = {"Space": "SPACE", "Enter": "RETURN"}
            names.update({k: v.upper() for k, v in arrows.items()})
        elif backend == "xinput2":
            names = {"Space": "space", "Enter": "Return", **arrows}
        else:  # Quartz and the embedded OpenSmash keyboard share names.
            names = {"Space": "Space", "Enter": "Return"}
            names.update({k: v + " Arrow" for k, v in arrows.items()})
        return names.get(code)

    def preflight(self, plan):
        if not isinstance(plan, dict):
            raise ValueError("Invalid launch plan")
        self.validate({**plan, "costumes": []})
        self.check_controllers(plan["ports"])
        return {"ready": True}

    def check_controllers(self, ports):
        if os.environ.get("OPENSMASH_LAUNCHER_INPUT"):
            if self.manifest.get("launcherInput") != 1:
                raise ValueError("Install the updated native runtime for shared controller input and audio.")
            return []
        pads = []
        if any(p["device"].startswith("gamepad") for p in ports):
            helper = self.runtime / self.manifest["controllers"]
            result = subprocess.run(
                [str(helper)], capture_output=True, text=True, timeout=10
            )
            pads = [line for line in result.stdout.splitlines() if line.startswith("SDL/")]
        for p in ports:
            if p["device"].startswith("gamepad"):
                index = int(p["device"][-1])
                if index >= len(pads):
                    raise ValueError(
                        "Gamepad %d is not connected. Connect it or choose Keyboard."
                        % (index + 1)
                    )
        return pads

    def controllers(self, ports, controls=None):
        pads = self.check_controllers(ports)
        config = self.user / "Config"
        config.mkdir(parents=True, exist_ok=True)
        embedded = bool(os.environ.get("OPENSMASH_INPUT_FILE"))
        if embedded:
            keyboard, backend = "OpenSmash/0/Keyboard", "embedded"
        elif sys.platform == "darwin":
            keyboard, backend = "Quartz/0/Keyboard & Mouse", "quartz"
        elif os.name == "nt":
            keyboard, backend = "DInput/0/Keyboard Mouse", "dinput"
        else:
            keyboard, backend = "XInput2/0/Virtual core pointer", "xinput2"
        keys, buttons = self.bindings(controls, embedded)
        quote = lambda name: "`" + name + "`"
        keyboard_bind = {
            self.BINDING_TARGETS[action]: quote(self.key_name(code, backend))
            for action, code in keys.items()
        }
        keyboard_bind["Triggers/L-Analog"] = keyboard_bind["Triggers/L"]
        keyboard_bind["Triggers/R-Analog"] = keyboard_bind["Triggers/R"]
        # Fixed D-pad keys, minus any the player rebound to something else.
        for target, code in [("D-Pad/Up", "KeyT"), ("D-Pad/Down", "KeyG"),
                             ("D-Pad/Left", "KeyF"), ("D-Pad/Right", "KeyH")]:
            if code not in keys.values():
                keyboard_bind[target] = quote(self.key_name(code, backend))
        pad_bind = {
            "Main Stick/Up": "`Left Y+`",
            "Main Stick/Down": "`Left Y-`",
            "Main Stick/Left": "`Left X-`",
            "Main Stick/Right": "`Left X+`",
            "C-Stick/Up": "`Right Y+`",
            "C-Stick/Down": "`Right Y-`",
            "C-Stick/Left": "`Right X-`",
            "C-Stick/Right": "`Right X+`",
        }
        for action in self.BUTTONS:
            pad_bind[self.BINDING_TARGETS[action]] = quote(self.SDL_BUTTONS[buttons[action]])
        pad_bind["Triggers/L-Analog"] = pad_bind["Triggers/L"]
        pad_bind["Triggers/R-Analog"] = pad_bind["Triggers/R"]
        pad_bind.update(
            {
                "D-Pad/Up": "`Pad N`",
                "D-Pad/Down": "`Pad S`",
                "D-Pad/Left": "`Pad W`",
                "D-Pad/Right": "`Pad E`",
            }
        )
        lines = []
        for i, p in enumerate(ports):
            lines.append("[GCPad%d]" % (i + 1))
            d = p["device"]
            if d in ["cpu", "off"]:
                continue
            if d.startswith("gamepad") and os.environ.get("OPENSMASH_LAUNCHER_INPUT"):
                device = "OpenSmash/0/Pad" + str(i + 1)
                names = {"a":"A","b":"B","x":"X","y":"Y","z":"Z","l":"L","r":"R","start":"Start",
                         "up":"StickUp","down":"StickDown","left":"StickLeft","right":"StickRight",
                         "cup":"CUp","cdown":"CDown","cleft":"CLeft","cright":"CRight"}
                bindings = {self.BINDING_TARGETS[k]: quote(v) for k,v in names.items()}
                bindings.update({"Triggers/L-Analog":"`AnalogL`", "Triggers/R-Analog":"`AnalogR`",
                                 "D-Pad/Up":"`Up`","D-Pad/Down":"`Down`","D-Pad/Left":"`Left`","D-Pad/Right":"`Right`"})
            elif d.startswith("gamepad"):
                index = int(d[-1])
                device = pads[index]
                bindings = dict(pad_bind)
                profiles = controls.get("gamepads", {}) if isinstance(controls, dict) else {}
                profile = profiles.get(d) if isinstance(profiles, dict) else None
                if isinstance(profile, dict):
                    _, port_buttons = self.bindings({"gamepad": {**buttons, **profile}})
                    for action in self.BUTTONS:
                        bindings[self.BINDING_TARGETS[action]] = quote(self.SDL_BUTTONS[port_buttons[action]])
                    bindings["Triggers/L-Analog"] = bindings["Triggers/L"]
                    bindings["Triggers/R-Analog"] = bindings["Triggers/R"]
            else:
                device = keyboard
                bindings = keyboard_bind
            lines.append("Device = " + device)
            lines.extend(k + " = " + v for k, v in bindings.items())
            lines.extend(
                ["Main Stick/Calibration = 100.00", "C-Stick/Calibration = 100.00"]
            )
        (config / "GCPadNew.ini").write_text("\n".join(lines) + "\n")
        # Keep simulation and rendering on separate Windows workers, with the
        # same bounded GPU lead used by the native runtime on iOS. Unbounded
        # dual-core execution can race guest FIFO writes.
        execution = (
            "CPUThread = True\nSyncGPU = True\nSyncGpuMaxDistance = 1000000\n"
            if sys.platform == "win32"
            else "CPUThread = False\n"
        )
        (config / "Dolphin.ini").write_text(
            "[Display]\nFullscreen = False\nRenderWindowWidth = 960\nRenderWindowHeight = 720\n"
            "[Interface]\nConfirmStop = False\n[Core]\n" + execution +
            "FastDiscSpeed = True\n[Input]\nBackgroundInput = True\n"
        )
        # Fill the fixed 960x720 transport frame. The Electron canvas already
        # fits that 4:3 image to the display; automatic VI aspect correction here
        # adds a second set of black bars inside the frame.
        (config / "GFX.ini").write_text("[Settings]\nAspectRatio = 3\n")

    def launch(self, plan):
        with self.lock:
            transport = ("iosurface-v1" if os.environ.get("OPENSMASH_SURFACE_SERVICE") else
                         "rgba-memory-v1" if os.environ.get("OPENSMASH_FRAME_FILE") else None)
            if transport and transport not in self.manifest.get("embeddedSurfaces", []):
                raise ValueError("This runtime needs the embedded-display update. Rebuild the desktop native runtime.")
            session = plan.get("session") if isinstance(plan, dict) else None
            if not isinstance(session, str) or not re.fullmatch(
                r"[a-f0-9-]{36}", session
            ):
                raise ValueError("Invalid launch session")
            if session in self.cancelled:
                raise ValueError("Launch was cancelled")
            if not self.setup.ready:
                raise ValueError("Choose and verify your ISO first")
            if self.process and self.process.poll() is None:
                raise ValueError("Close the current game first")
            packed, costumes = self.validate(plan)
            if costumes and self.manifest.get("characterSelect") != 1:
                raise ValueError("Update the desktop runtime to use character select injection.")
            self.session = session
            self.process = None
            self.startup_phase = 0
            self.status_message = "Connecting your controllers…"
            self.controllers(plan["ports"], plan.get("controls"))
            self.status_message = "Preparing your game files…"
            game = self.root / "build/native-lineup"
            def customize(stage):
                if costumes:
                    from .character_select import stage_character_select, catalog_identities
                    stage_character_select(stage, catalog_identities(self.root, self.catalog, plan["costumes"]),
                                           cache=self.root / "build/announcer-cache")
                    return ['MnSlChr.dat', 'MnSlChr.usd', 'audio/nr_select.ssm', 'audio/us/nr_select.ssm']
                return []
            from .game_staging import stage_game
            stage_game(self.setup.game, game, costumes, customize)
            module = self.runtime / self.manifest["module"]
            runner = self.runtime / self.manifest["runner"]
            environment = {
                **os.environ,
                "OPENSMASH_FIXED_WINDOW": "1",
                "OPENSMASH_MATCH": "1",
                "OPENSMASH_NATIVE_MODULE": str(module),
            }
            self.stop_file = None
            if self.manifest.get("gracefulShutdown") == "file-v1":
                self.stop_file = self.root / "build" / ("native-stop-" + uuid.uuid4().hex)
                environment["OPENSMASH_STOP_FILE"] = str(self.stop_file)
            if sys.platform == "darwin":
                # Apple Silicon static execution slows progressively during
                # combat (about 15 FPS after a minute); the ARM64 JIT fallback
                # holds 60 FPS with mod hooks retained. Users can still force
                # OPENSMASH_CPU_BACKEND=static for comparison.
                environment.setdefault("OPENSMASH_CPU_BACKEND", "jit")
            if sys.platform.startswith("linux") and os.environ.get("DISPLAY"):
                environment.setdefault("SDL_VIDEODRIVER", "x11")
            for key, name in [
                ("mode", "MODE"),
                ("stage", "STAGE"),
                ("level", "CPU_LEVEL"),
                ("stocks", "STOCKS"),
                ("minutes", "MINUTES"),
            ]:
                environment["OPENSMASH_" + name] = str(plan[key])
            for i, p in enumerate(packed):
                environment["OPENSMASH_PORT" + str(i)] = str(p)
            args = [
                str(runner),
                "--game",
                str(game),
                "--module",
                str(module),
                "--user-dir",
                str(self.user),
                "--title",
                "OpenSmash Melee",
                "--graphics",
                "Metal" if sys.platform == "darwin" else "Vulkan",
                "--audio",
                "Cubeb",
                "--mods",
                str(self.runtime / "Mods"),
            ]
            self.startup_phase = 0
            with self.log.open("w") as output:
                self.process = subprocess.Popen(
                    args,
                    cwd=self.runtime,
                    env=environment,
                    stdout=output,
                    stderr=subprocess.STDOUT,
                )
            self.session = session
            self.status_message = "Game finished."
        return self.status()
