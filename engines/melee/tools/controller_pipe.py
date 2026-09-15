"""Send timed GameCube inputs through Dolphin's native Unix pipe backend.

Supports wall-time holds and holds counted against native frame captures.
Neither mode certifies deterministic replay. The pipe lives only in the
validation profile.
"""
import argparse
import json
import os
from pathlib import Path
import time

BUTTONS=('A','B','X','Y','Z','START','L','R','D_UP','D_DOWN','D_LEFT','D_RIGHT')


def run(path,steps):
    frame_dir=Path(path).parent.parent/"Dump/Frames"
    def frame_count():
        return sum(1 for entry in os.scandir(frame_dir) if entry.name.endswith(".png"))
    fd=os.open(path,os.O_WRONLY|os.O_NONBLOCK)
    def send(commands):os.write(fd,('\n'.join(commands)+'\n').encode())
    def reset():send(['RELEASE '+b for b in BUTTONS]+['SET MAIN 0.5 0.5','SET C 0.5 0.5','SET L 0','SET R 0'])
    try:
        reset()
        for step in steps:
            duration=step.get('seconds',.1)
            if not 0<duration<=30:raise ValueError('Duration must be in (0,30] seconds')
            buttons=step.get('buttons',[])
            if set(buttons)-set(BUTTONS):raise ValueError('Unknown button')
            commands=['PRESS '+b for b in buttons]
            for key,name in [('stick','MAIN'),('cstick','C')]:
                if key in step:
                    x,y=step[key]
                    if not 0<=x<=1 or not 0<=y<=1:raise ValueError('Stick range is 0..1')
                    commands.append(f'SET {name} {x} {y}')
            if 'frames' in step:
                frames=step['frames']
                if type(frames) is not int or not 1<=frames<=1800:raise ValueError('Invalid frame duration')
                start=frame_count();deadline=time.monotonic()+max(10,frames/10)
                send(commands)
                while frame_count()<start+frames:
                    if time.monotonic()>deadline:raise RuntimeError('Frame capture clock stopped')
                    time.sleep(.002)
            else:
                send(commands);time.sleep(duration)
            reset();time.sleep(step.get('release',.1))
    finally:reset();os.close(fd)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('plan',help='JSON steps file')
    p.add_argument('--pipe',default='build/dolphin-validation-user/Pipes/validation');a=p.parse_args()
    run(a.pipe,json.loads(Path(a.plan).read_text()))
