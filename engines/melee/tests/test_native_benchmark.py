import unittest
from tools.benchmark_native_windows import summarize_presentations


class NativeBenchmarkTests(unittest.TestCase):
    def test_freeze_is_counted_in_full_window(self):
        # Ten smooth seconds followed by fifty frozen seconds is 10 FPS, not 60.
        samples = [(i + 0.5) / 60 for i in range(600)]
        result = summarize_presentations(samples, 0, 60, 60)
        self.assertEqual(result["measuredFps"], 10)
        self.assertEqual(result["minOneSecondFrames"], 0)
        self.assertEqual(result["secondsBelow58Frames"], 50)

    def test_warmup_and_shutdown_are_excluded(self):
        samples = [(i + 0.5) / 60 for i in range(1200)]
        result = summarize_presentations(samples, 5, 10, 15)
        self.assertEqual(result["measuredFps"], 60)
        self.assertEqual(result["minOneSecondFrames"], 60)
        self.assertEqual(result["secondsBelow58Frames"], 0)
        self.assertTrue(result["measurementComplete"])

    def test_early_exit_is_incomplete(self):
        result = summarize_presentations([], 5, 10, 14.9)
        self.assertFalse(result["measurementComplete"])
        self.assertEqual(result["measuredFps"], 0)
