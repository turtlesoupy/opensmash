"""Regression checks for PC assignments at translated control-flow boundaries."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from specialize_browser_entries import defer_counter


class CounterBoundaryTests(unittest.TestCase):
    def transform(self, body):
        address = '801C2AAC'
        original = f'label_{address}:\n{body}'
        stats = {'deferredStores': 0}
        return defer_counter((original, address, body), stats), stats

    def test_self_branch_retains_exit_address(self):
        # Entered by fallthrough from an earlier instruction, this return must
        # expose the self-loop PC even though it equals the current label.
        body = '''    ctx->downcount -= 1;
    if (ctx->downcount <= -64) {
        ctx->pc = 0x801C2AACu;
        return;
    }
    goto label_801C2AAC;
'''
        result, stats = self.transform(body)
        self.assertEqual(result, 'label_801C2AAC:\n' + body)
        self.assertEqual(stats['deferredStores'], 0)

    def test_entry_store_can_be_removed_without_removing_exit_store(self):
        body = '''    ctx->pc = 0x801C2AACu;
    ctx->gpr[3] += 1;
    if (ctx->downcount <= -64) {
        ctx->pc = 0x801C2AACu;
        return;
    }
'''
        result, stats = self.transform(body)
        self.assertEqual(result.count('ctx->pc = 0x801C2AACu;'), 1)
        self.assertIn('        ctx->pc = 0x801C2AACu;', result)
        self.assertEqual(stats['deferredStores'], 1)


if __name__ == '__main__':
    unittest.main()
