import unittest
from unittest.mock import patch
from argparse import Namespace
from infra.gcp.coordinator import CONFIG, validate_release, run, stage, cloud_enabled


class ReleasePolicyTests(unittest.TestCase):
    def test_releases_and_prereleases_match_package_version(self):
        for version in ["0.2.1", "1.0.0-rc.1"]:
            validate_release("v" + version, "a" * 40, version)

    def test_branches_or_bad_refs_cannot_launch_builders(self):
        for ref in ["main", "refs/heads/main", "v1", "v1.2.3/extra", "v1.2.3;cmd"]:
            with self.assertRaises(ValueError):
                validate_release(ref, "a" * 40, "1.2.3")

    def test_mismatched_version_or_unpinned_source_is_rejected(self):
        for tag, commit in [("v1.2.3", "main"), ("v1.2.4", "a" * 40)]:
            with self.assertRaises(ValueError):
                validate_release(tag, commit, "1.2.3")

    @patch.dict(CONFIG, {"buildMode": "cloud"})
    @patch("infra.gcp.coordinator.subprocess.run")
    @patch("infra.gcp.coordinator.cloud", side_effect=RuntimeError("create failed"))
    def test_provisioning_failure_still_attempts_cleanup(self, cloud, command):
        command.return_value.returncode = 1
        with self.assertRaises(RuntimeError):
            run(Namespace(build="1234-abcd", platform="windows-x64"))
        self.assertTrue(
            any("delete" in call.args[0] for call in command.call_args_list)
        )
        args = cloud.call_args.args
        self.assertIn("--instance-termination-action=DELETE", args)
        self.assertIn("--max-run-duration=7200s", args)
        self.assertIn("--boot-disk-auto-delete", args)

    @patch.dict(CONFIG, {"buildMode": "local"})
    @patch("infra.gcp.coordinator.cloud")
    def test_local_release_never_stages_or_provisions(self, cloud):
        with patch("infra.gcp.coordinator.validate_release"):
            stage(Namespace(tag="v1.2.3", commit="a" * 40, build="local-test"))
        run(Namespace(build="local-test", platform="windows-x64"))
        cloud.assert_not_called()

    @patch.dict(CONFIG, {"buildMode": "invalid"})
    def test_unknown_build_mode_is_rejected(self):
        with self.assertRaises(ValueError):
            cloud_enabled()
