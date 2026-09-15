"""Measure native gameplay presentation in an isolated Windows profile.

Supply a prepared game directory and a profile whose memory card is initialized.
CPU battles vary between runs; compare repeated runs with the same inputs.
"""
import argparse, configparser, csv, hashlib, json, mmap, os, shutil, subprocess, time
from pathlib import Path

def summarize_presentations(samples, start, duration, observed_until):
    stable = [sample for sample in samples if start <= sample < start + duration]
    windows = [sum(start + i <= sample < start + i + 1 for sample in stable)
               for i in range(int(duration))]
    return {
        "measurementComplete": observed_until >= start + duration,
        "measuredFps": len(stable) / duration,
        "measurementDuration": duration,
        "framesPerSecond": windows,
        "minOneSecondFrames": min(windows) if windows else None,
        "secondsBelow58Frames": sum(count < 58 for count in windows),
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--runtime', type=Path, required=True)
    p.add_argument('--game', type=Path, required=True)
    p.add_argument('--user-template', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--module', type=Path)
    p.add_argument('--single-core', action='store_true')
    p.add_argument('--phase', action='store_true')
    p.add_argument('--warmup', type=float, default=0)
    p.add_argument('--measure', type=float, default=60)
    p.add_argument('--timeout', type=float, default=180)
    a = p.parse_args()
    if os.name != 'nt':p.error('This harness targets the Windows native runtime')
    if a.warmup < 0 or a.measure <= 0 or a.timeout <= a.warmup + a.measure:
        p.error('Use positive measurement time and a timeout allowing startup and warmup')
    runtime = a.runtime.resolve()
    game = a.game.resolve()
    source_user = a.user_template.resolve()
    for folder in [runtime, game, source_user]:
        if not folder.is_dir():p.error('Directory not found: ' + str(folder))
    out = a.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    shutil.copytree(source_user, out / 'user')
    ini = out / 'user/Config/Dolphin.ini'
    config = configparser.ConfigParser()
    config.optionxform = str
    config.read(ini)
    if not config.has_section('Core'):
        config.add_section('Core')
    config['Core'].update(CPUThread=str(not a.single_core), SyncGPU='True', SyncGpuMaxDistance='1000000')
    with ini.open('w') as f:
        config.write(f)
    module = runtime / 'gGALE01_recomp.dll'
    if a.module: module = a.module.resolve()
    env = dict(os.environ, OPENSMASH_NATIVE_MODULE=str(module), OPENSMASH_FIXED_WINDOW='1',
               OPENSMASH_MATCH='1', OPENSMASH_PORT0='262', OPENSMASH_PORT1='268',
               OPENSMASH_PORT2='770', OPENSMASH_PORT3='777', OPENSMASH_STAGE='31',
               OPENSMASH_STOCKS='99', MELEEPAD_FRAME_PHASE_LOG=str(out / 'frames.csv'))
    command = [str(runtime / 'moderngekko-run.exe'), '--game', str(game), '--module', str(module),
               '--user-dir', str(out / 'user'), '--title', 'OpenSmash diagnostic benchmark',
               '--graphics', 'Vulkan', '--audio', 'Cubeb', '--mods', str(runtime / 'Mods')]
    env['MELEEPAD_LIGHTWEIGHT_FRAME_LOG'] = str(out / 'presentation.csv')
    samples = []
    if not a.phase:env.pop('MELEEPAD_FRAME_PHASE_LOG')
    frame_file = out / 'frame-memory'
    frame_stream = frame_file.open('w+b')
    frame_stream.truncate(3 * (960 * 720 * 4 + 64))
    mapping = mmap.mmap(frame_stream.fileno(), 0)
    env['OPENSMASH_FRAME_FILE'] = str(frame_file)
    env['OPENSMASH_STOP_FILE']=str(out/'stop-request')
    def stop_process():
        if json.loads((runtime/'runtime.json').read_text()).get('gracefulShutdown') == 'file-v1':
            (out/'stop-request').touch()
            try:return process.wait(timeout=20)
            except subprocess.TimeoutExpired:pass
        process.kill()
        return process.wait(timeout=10)
    next_log_check = 0
    combat_at = None
    measured_end = None
    started = time.perf_counter()
    with (out / 'game.log').open('w') as log:
        process = subprocess.Popen(command, cwd=runtime, env=env, stdout=log, stderr=subprocess.STDOUT,
                                   creationflags=subprocess.CREATE_NO_WINDOW)
        (out/'pid').write_text(str(process.pid))
        try:
            while time.perf_counter() - started < a.timeout and process.poll() is None:
                elapsed = time.perf_counter() - started
                if combat_at is None and elapsed >= next_log_check:
                    next_log_check = elapsed + 0.1
                    if '[opensmash] combat started' in (out / 'game.log').read_text(errors='replace'):
                        combat_at = elapsed
                        measured_end = combat_at + a.warmup + a.measure
                if measured_end is not None and elapsed >= measured_end:
                    break
                for slot in range(3):
                    offset = slot * (960 * 720 * 4 + 64)
                    if mapping[offset] == 1:
                        samples.append(time.perf_counter() - started)
                        mapping[offset] = 0
                time.sleep(.001)
            observed_until = time.perf_counter() - started
            if process.poll() is None:
                stop_process()
        finally:
            try:
                if process.poll() is None:
                    stop_process()
            finally:
                mapping.close()
                frame_stream.close()
    result = {'runnerSha256': hashlib.sha256((runtime/'moderngekko-run.exe').read_bytes()).hexdigest(),
              'moduleSha256': hashlib.sha256(module.read_bytes()).hexdigest(), 'seconds': time.perf_counter()-started, 'exitCode': process.returncode, 'game': str(game)}
    if mapping is not None:
        result['presentationSamples'] = samples
        result['combatStartedSeconds'] = combat_at
        if measured_end is not None:
            result.update(summarize_presentations(samples, combat_at + a.warmup, a.measure, observed_until))
    frames = out / 'frames.csv'
    if frames.exists():
        with frames.open() as f:
            rows = list(csv.DictReader(f))
        result['rows'] = len(rows)
        result['columns'] = list(rows[0]) if rows else []
    (out / 'result.json').write_text(json.dumps(result, indent=2))
    print(json.dumps({k:v for k,v in result.items() if k != 'presentationSamples'}, indent=2))
    if not result.get('measurementComplete') or result['exitCode'] != 0:raise SystemExit(1)


if __name__ == "__main__":
    main()
