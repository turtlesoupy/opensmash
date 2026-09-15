"""Report click-to-first-match-frame timing, including whether preboot had finished."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def report(path):
    sessions, ready, results = {}, {}, []
    for line in Path(path).read_text().splitlines():
        entry = json.loads(line)
        key = entry.get('sessionId')
        if entry['type'] == 'session':
            sessions[key] = entry
        elif entry['type'] == 'ready-for-selection':
            ready[key] = entry['time']
        elif entry['type'] == 'startup-performance':
            session = sessions.get(key, {})
            elapsed = entry.get('clickToMatchMs')
            warmed = entry.get('warmReadyBeforeClick')
            if warmed is None and elapsed is not None:
                warmed = key in ready and ready[key] <= entry['time'] - elapsed
            results.append({**entry, 'warmReadyBeforeClick': warmed,
                            'mode': session.get('mode'), 'profile': session.get('profile')})
    return results


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--trace', type=Path, default=ROOT / 'build/moderngekko-validation/browser-trace.jsonl')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = json.dumps(report(args.trace), indent=2) + '\n'
    if args.output:
        args.output.write_text(result)
    print(result, end='')
