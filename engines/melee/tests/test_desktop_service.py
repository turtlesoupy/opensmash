import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from opensmash_melee.native_service import NativeService

ROOT = Path(__file__).resolve().parents[1]


class DesktopServiceTests(unittest.TestCase):
    def test_development_refresh_uses_current_backend_with_staged_catalog(self):
        from desktop.backend_entry import refresh_code
        root = self.service.root
        payload, development, workspace = root / 'payload', root / 'source', root / 'workspace'
        workspace.mkdir()
        for name in ('opensmash_melee', 'tools', 'runtime', 'web'):
            (payload / name).mkdir(parents=True)
            (payload / name / 'version.txt').write_text('staged')
            (development / name).mkdir(parents=True)
            (development / name / 'version.txt').write_text('current')
        refresh_code(payload, workspace, development)
        for name in ('opensmash_melee', 'tools', 'runtime'):
            self.assertEqual((workspace / name / 'version.txt').read_text(), 'current')
        self.assertEqual((workspace / 'web/version.txt').read_text(), 'staged')

    def test_startup_status_tracks_real_milestones(self):
        self.service.process = SimpleNamespace(poll=lambda: None)
        self.service.log.write_text("[staticrecomp] core init\n")
        self.assertEqual(self.service.status()["message"], "Loading game data…")
        self.service.log.write_text("[opensmash] launch mode=0\n")
        self.assertEqual(self.service.status()["message"], "Preparing your match…")
        self.service.log.write_text("unrelated output\n")
        self.assertEqual(self.service.status()["message"], "Preparing your match…")
        self.service.log.write_text("[opensmash] destination ready\n")
        self.assertTrue(self.service.status()["ready"])

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        (root / "runtime").mkdir()
        (root / "build").mkdir()
        (root / "runtime/launch-options.json").write_bytes(
            (ROOT / "runtime/launch-options.json").read_bytes()
        )
        import hashlib

        (root / "engine").write_bytes(b"fixture")
        digest = hashlib.sha256(b"fixture").hexdigest()
        (root / "runtime.json").write_text(
            json.dumps(
                {
                    "protocol": 1,
                    "runner": "engine",
                    "module": "engine",
                    "controllers": "engine",
                    "sha256": {"engine": digest},
                }
            )
        )
        self.service = NativeService(root, {}, SimpleNamespace(ready=False), root)
        self.plan = {
            "mode": 0,
            "stage": 31,
            "level": 5,
            "stocks": 4,
            "minutes": 8,
            "ports": [
                {"device": d, "fighter": 8, "color": 0}
                for d in ["keyboard", "cpu", "off", "off"]
            ],
            "costumes": [],
        }

    def test_app_update_removes_stale_code_but_preserves_game_data(self):
        from desktop.backend_entry import refresh_code

        root = self.service.root
        payload = root / "payload"
        workspace = root / "workspace"
        for name in ["opensmash_melee", "tools", "runtime", "web"]:
            (payload / name).mkdir(parents=True)
            (payload / name / "current.txt").write_text("new")
            (workspace / name).mkdir(parents=True)
            (workspace / name / "removed.py").write_text("old")
        (workspace / "assets").mkdir()
        (workspace / "assets/user-save").write_text("keep")
        refresh_code(payload, workspace)
        self.assertEqual((workspace / "assets/user-save").read_text(), "keep")
        self.assertFalse((workspace / "tools/removed.py").exists())
        self.assertEqual((workspace / "tools/current.txt").read_text(), "new")

    def test_each_native_port_uses_its_controller_profile(self):
        ports = [{"device": d} for d in ["gamepad0", "gamepad1", "cpu", "off"]]
        controls = {"gamepads": {"gamepad0": {"a": 2, "l": 7}, "gamepad1": {"a": 1}}}
        with patch.object(self.service, "check_controllers", return_value=["SDL/0/Xbox", "SDL/0/Sony"]):
            self.service.controllers(ports, controls)
        import configparser
        config = configparser.ConfigParser()
        config.read(self.service.user / "Config/GCPadNew.ini")
        self.assertEqual(config["GCPad1"]["Buttons/A"], "`Button X`")
        self.assertEqual(config["GCPad2"]["Buttons/A"], "`Button B`")
        self.assertEqual(config["GCPad1"]["Triggers/L-Analog"], "`Trigger R`")
        self.assertEqual(config["GCPad2"]["Triggers/L-Analog"], "`Trigger L`")

    def test_launch_requires_verified_disc(self):
        with self.assertRaisesRegex(ValueError, "verify your ISO"):
            self.service.launch(
                {**self.plan, "session": "00000000-0000-0000-0000-000000000001"}
            )

    def test_windows_render_worker_has_bounded_gpu_lead(self):
        import configparser

        for system in ["win32", "darwin"]:
            with self.subTest(system=system), patch(
                "opensmash_melee.native_service.sys.platform", system
            ), patch("opensmash_melee.native_service.subprocess.run", return_value=SimpleNamespace(stdout="")):
                self.service.controllers(self.plan["ports"])
                config = configparser.ConfigParser()
                config.read(self.service.user / "Config/Dolphin.ini")
                self.assertEqual(config.getboolean("Core", "CPUThread"), system == "win32")
                if system == "win32":
                    self.assertTrue(config.getboolean("Core", "SyncGPU"))
                    self.assertEqual(config.getint("Core", "SyncGpuMaxDistance"), 1000000)

    def test_embedded_launch_rejects_old_runtime_before_spawning_window(self):
        with patch.dict("os.environ", {"OPENSMASH_SURFACE_SERVICE": "test-surface"}):
            with self.assertRaisesRegex(ValueError, "embedded-display update"):
                self.service.launch({**self.plan, "session": "00000000-0000-0000-0000-000000000001"})

    def test_stale_close_does_not_stop_new_game(self):
        self.service.session = "00000000-0000-0000-0000-000000000002"

        class Process:
            def poll(self):
                return None

            def terminate(self):
                raise AssertionError("Stopped unrelated game")

        self.service.process = Process()
        self.assertTrue(
            self.service.stop("00000000-0000-0000-0000-000000000001")["running"]
        )

    def test_cancel_before_launch(self):
        sid = "00000000-0000-0000-0000-000000000001"
        self.service.stop(sid)
        with self.assertRaisesRegex(ValueError, "cancelled"):
            self.service.launch({**self.plan, "session": sid})

    def test_stop_requests_cache_flush_before_terminating(self):
        stop_file = self.service.root / "stop-request"
        self.service.stop_file = stop_file

        class Process:
            returncode = None

            def poll(self):
                return self.returncode

            def wait(self, timeout=None):
                self_test.assertTrue(stop_file.exists())
                self.returncode = 0
                return 0

            def terminate(self):
                raise AssertionError("Terminated before the engine could save caches")

        self_test = self
        self.service.process = Process()
        self.assertFalse(self.service.stop()["running"])
        self.assertFalse(stop_file.exists())

    def test_stop_kills_unresponsive_engine_after_grace_period(self):
        import subprocess
        from unittest.mock import Mock

        process = Mock()
        process.poll.side_effect = [None, -9, -9]
        process.wait.side_effect = [subprocess.TimeoutExpired("engine", 8), -9]
        self.service.process = process
        self.service.stop_file = self.service.root / "stop-request"
        self.service.stop()
        process.terminate.assert_not_called()
        process.kill.assert_called_once()

    def test_replacement_cancels_preparation_and_stale_cleanup_is_harmless(self):
        first = "00000000-0000-0000-0000-000000000001"
        second = "00000000-0000-0000-0000-000000000002"
        self.service.begin(first)
        self.service.begin(second)
        self.service.stop(first)
        self.assertEqual(self.service.session, second)
        self.assertNotIn(second, self.service.cancelled)
        with self.assertRaisesRegex(ValueError, "cancelled"):
            self.service.launch({**self.plan, "session": first})

    def test_reload_cancels_a_reserved_launch(self):
        sid = "00000000-0000-0000-0000-000000000001"
        self.service.begin(sid)
        self.service.stop()
        with self.assertRaisesRegex(ValueError, "cancelled"):
            self.service.launch({**self.plan, "session": sid})

    def test_keyboard_launch_does_not_probe_gamepads(self):
        with patch("opensmash_melee.native_service.subprocess.run") as probe:
            self.service.controllers(self.plan["ports"])
        probe.assert_not_called()

    def test_preflight_rejects_missing_controller_before_preparation(self):
        self.plan["ports"][0]["device"] = "gamepad0"
        self.plan["costumes"] = [{"character": "not-prepared"}]
        with patch("opensmash_melee.native_service.subprocess.run",
                   return_value=SimpleNamespace(stdout="")):
            with self.assertRaisesRegex(ValueError, "Gamepad 1 is not connected"):
                self.service.preflight(self.plan)
        self.assertFalse(self.service.user.exists())
        self.assertIsNone(self.service.session)

    def test_preflight_accepts_connected_controller_without_prepared_costumes(self):
        self.plan["ports"][0]["device"] = "gamepad0"
        self.plan["costumes"] = [{"character": "not-prepared"}]
        with patch("opensmash_melee.native_service.subprocess.run",
                   return_value=SimpleNamespace(stdout="SDL/0/Test Pad\n")):
            self.assertEqual(self.service.preflight(self.plan), {"ready": True})
        self.assertFalse(self.service.user.exists())

    def test_default_keyboard_bindings_match_the_controls_screen(self):
        with patch.dict(os.environ, {"OPENSMASH_INPUT_FILE": "/tmp/input"}):
            self.service.controllers(self.plan["ports"])
        ini = (self.service.user / "Config/GCPadNew.ini").read_text()
        for line in ["Device = OpenSmash/0/Keyboard", "Buttons/A = `J`", "Buttons/X = `Space`",
                     "Buttons/Z = `U`", "Buttons/Start = `Return`", "C-Stick/Up = `Up Arrow`",
                     "Triggers/L-Analog = `Q`", "D-Pad/Up = `T`"]:
            self.assertIn(line, ini)

    def test_rebound_controls_reach_the_pad_config(self):
        controls = {
            "keyboard": {"a": "KeyT", "start": "Digit1", "cup": "Space", "x": "Escape", "z": 5},
            "gamepad": {"a": 1, "b": 0, "z": 4, "l": 99, "bogus": 2},
        }
        self.service.manifest["keyboardKeys"] = 2
        with patch.dict(os.environ, {"OPENSMASH_INPUT_FILE": "/tmp/input"}):
            self.service.controllers(self.plan["ports"], controls)
        ini = (self.service.user / "Config/GCPadNew.ini").read_text()
        self.assertIn("Buttons/A = `T`", ini)
        self.assertIn("Buttons/Start = `1`", ini)
        self.assertIn("C-Stick/Up = `Space`", ini)
        self.assertIn("Buttons/X = `Space`", ini)  # invalid code keeps the default
        self.assertIn("Buttons/Z = `U`", ini)
        self.assertNotIn("D-Pad/Up", ini)  # T now attacks, so the fixed D-pad key yields
        keyboard, gamepad = self.service.bindings(controls)
        self.assertEqual((gamepad["a"], gamepad["b"], gamepad["z"], gamepad["l"]), (1, 0, 4, 6))
        self.assertNotIn("bogus", gamepad)
        self.assertEqual(keyboard["y"], "KeyI")

    def test_old_embedded_runtime_only_rebinds_keys_it_can_name(self):
        controls = {"keyboard": {"a": "KeyP", "b": "KeyT", "start": "Digit1"}}
        keyboard, _ = self.service.bindings(controls, embedded=True)
        self.assertEqual((keyboard["a"], keyboard["b"], keyboard["start"]), ("KeyJ", "KeyT", "Enter"))
        keyboard, _ = self.service.bindings(controls, embedded=False)
        self.assertEqual((keyboard["a"], keyboard["start"]), ("KeyP", "Digit1"))
        self.service.manifest["keyboardKeys"] = 2
        keyboard, _ = self.service.bindings(controls, embedded=True)
        self.assertEqual((keyboard["a"], keyboard["start"]), ("KeyP", "Digit1"))

    def test_key_names_follow_each_dolphin_backend(self):
        name = self.service.key_name
        self.assertEqual([name("Enter", b) for b in ["embedded", "quartz", "dinput", "xinput2"]],
                         ["Return", "Return", "RETURN", "Return"])
        self.assertEqual([name("Space", b) for b in ["quartz", "dinput", "xinput2"]], ["Space", "SPACE", "space"])
        self.assertEqual([name("ArrowLeft", b) for b in ["quartz", "dinput", "xinput2"]], ["Left Arrow", "LEFT", "Left"])
        self.assertEqual(name("Digit7", "dinput"), "7")
        self.assertIsNone(name("Escape", "quartz"))
        self.assertIsNone(name("Keyboard", "quartz"))

    def test_packed_ports_are_derived_not_trusted(self):
        self.plan["packedPorts"] = [999] * 4
        packed, _ = self.service.validate(self.plan)
        self.assertEqual(packed, [8, 264, 776, 776])

    def test_malformed_and_duplicate_players(self):
        for ports in [
            [None] * 4,
            [{"device": "keyboard", "fighter": 8, "color": 0}] * 4,
        ]:
            with self.assertRaises(ValueError):
                self.service.validate({**self.plan, "ports": ports})

    def test_runtime_integrity(self):
        (self.service.runtime / "engine").write_bytes(b"modified")
        with self.assertRaisesRegex(ValueError, "integrity"):
            NativeService(self.service.root, {}, None, self.service.runtime)

    @unittest.skipUnless(os.name == "nt", "Windows paths are case insensitive")
    def test_runtime_path_uses_canonical_casing(self):
        runtime = Path(str(self.service.runtime).swapcase())
        service = NativeService(self.service.root, {}, None, runtime)
        self.assertEqual(str(service.runtime), str(self.service.runtime.resolve()))


if __name__ == "__main__":
    unittest.main()
