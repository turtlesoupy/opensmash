"""A quiet audio context or a late crash must not certify sustained play."""
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from tools.report_browser_fps import report


class CombatReportTests(unittest.TestCase):
    def summarize(self, *, count=3, rendered=1440000, error=False, profile='0', window_profile=None):
        entries=[dict(type='session',sessionId='test',character='sample',profile=profile,
                      build=dict(id='build',linkOptimization='O1'),skin='host',mode='cpu-benchmark')]
        for _ in range(count):
            entries.append(dict(type='combat-performance',sessionId='test',passes=True,
                                durationMs=30000,fps=59.94,p95=17,p99=22,
                                audioUnderrunSamples=0,audioRenderedSamples=rendered))
            if window_profile is not None:entries[-1]['profile']=window_profile
        if error:entries.append(dict(type='error',sessionId='test',message='Stopped'))
        with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stdout(io.StringIO()):
            path=Path(tmp)/'trace.jsonl'
            path.write_text('\n'.join(json.dumps(e) for e in entries))
            return report(path)[0]['passesSustained60']

    def test_requires_three_complete_audible_unprofiled_windows(self):
        self.assertTrue(self.summarize())
        self.assertFalse(self.summarize(count=2))
        self.assertFalse(self.summarize(rendered=0))
        self.assertFalse(self.summarize(rendered=48000))
        self.assertFalse(self.summarize(profile='skin'))
        self.assertTrue(self.summarize(profile='skin',window_profile='0'))
        self.assertFalse(self.summarize(profile='0',window_profile='skin'))
        self.assertFalse(self.summarize(error=True))
