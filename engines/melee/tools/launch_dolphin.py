"""Launch a fixed 960x720 game viewport, floating beside Codex in AeroSpace."""
import argparse
from pathlib import Path
import re
import shutil
import struct
import subprocess
import time

ROOT=Path(__file__).resolve().parents[1]
APP='/Applications/Dolphin.app/Contents/MacOS/Dolphin'


def decode_qbytearray(value):
    if not value.startswith('@ByteArray(') or not value.endswith(')'):
        raise ValueError('Expected Qt QByteArray')
    out=bytearray()
    escapes={'0':0,'a':7,'b':8,'t':9,'n':10,'v':11,'f':12,'r':13,'\\':92,'"':34}
    for match in re.finditer(r'\\x([0-9a-fA-F]{1,2})|\\(.)|([^\\])',value[11:-1],re.S):
        hx,esc,char=match.groups()
        out.append(int(hx,16) if hx else escapes.get(esc,ord(esc)) if esc else ord(char))
    return out


def fixed_geometry(value=None):
    if value:
        data=decode_qbytearray(value)
        if len(data)!=66 or struct.unpack_from('>IHH',data)!=(0x1d9d0cb,3,0):
            raise ValueError('Unsupported Qt saved geometry version; refusing to corrupt settings')
    else:
        data=bytearray(struct.pack('>IHH8iiBBi4i',0x1d9d0cb,3,0,
                                  100,100,1059,907,100,128,1059,907,0,0,0,1920,100,128,1059,907))
    # Qt frame rect includes macOS titlebar, normal/widget rects do not.
    for start,height in ((8,808),(24,780),(50,780)):
        left,top,_,_=struct.unpack_from('>4i',data,start)
        struct.pack_into('>4i',data,start,left,top,left+959,top+height-1)
    data[44]=data[45]=0  # Neither maximized nor fullscreen.
    return '@ByteArray('+''.join(f'\\x{b:02x}' for b in data)+')'


def configure_geometry(user):
    path=user/'Config/Qt.ini';path.parent.mkdir(parents=True,exist_ok=True)
    text=path.read_text() if path.exists() else ''
    match=re.search(r'(?m)^\[mainwindow\]\n(?P<body>(?:(?!\[).*(?:\n|$))*)',text)
    old=None
    if match:
        geometry=re.search(r'(?m)^geometry=(.*)$',match['body'])
        if geometry:old=geometry[1]
    line='geometry='+fixed_geometry(old)+'\n'
    if match:
        body=re.sub(r'(?m)^geometry=.*\n?',lambda _:line,match['body']) if old else line+match['body']
        text=text[:match.start('body')]+body+text[match.end('body'):]
    else:
        text+='\n[mainwindow]\n'+line
    if path.exists() and not path.with_suffix('.ini.before-fixed-window').exists():
        shutil.copy2(path,path.with_suffix('.ini.before-fixed-window'))
    path.write_text(text)


def windows():
    lines=subprocess.check_output(['aerospace','list-windows','--all','--format',
            '%{window-id} %{app-bundle-id} %{workspace}'],text=True).splitlines()
    return [line.split(maxsplit=2) for line in lines]


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('game',help='Validated ISO or a staged game sys/main.dol')
    p.add_argument('--user',type=Path,default=ROOT/'build/dolphin-user')
    p.add_argument('--dump-frames',action='store_true',help='Capture native frames in isolated validation user directory')
    p.add_argument('--state',type=Path,help='Load a local verification checkpoint')
    p.add_argument('--movie',type=Path,help='Dolphin DTM verification input fixture')
    args=p.parse_args()
    game=Path(args.game).resolve()
    if not game.is_file():p.error('Game file does not exist')
    aero=bool(shutil.which('aerospace'))
    before=windows() if aero else []
    if any(app=='org.dolphin-emu.dolphin' for _,app,_ in before):
        p.error('Close the existing Dolphin session before launching another')
    codex=[ws for _,app,ws in before if app=='com.openai.codex']
    workspace=codex[0] if codex else None
    configure_geometry(args.user)
    args.user.mkdir(parents=True,exist_ok=True)
    log=(args.user/'launch.log').open('w')
    command=[APP,'-u',str(args.user),'-e',str(game),
        '-C','Dolphin.Display.RenderToMain=True',
        '-C','Dolphin.Display.Fullscreen=False',
        '-C','Dolphin.Display.RenderWindowAutoSize=False',
        '-C','Dolphin.Interface.ConfirmStop=False',
        '-C','Dolphin.Core.CPUThread=False']
    if args.dump_frames:
        command+=['-C','Dolphin.Movie.DumpFrames=True','-C','Dolphin.Movie.DumpFramesSilent=True']
    if args.state:
        command+=['--save_state',str(args.state.resolve())]
    if args.movie:
        command+=['--movie',str(args.movie.resolve()),'-C','Dolphin.Movie.PauseMovie=True']
    proc=subprocess.Popen(command,stdout=log,stderr=subprocess.STDOUT)
    log.close()
    if aero:
        deadline=time.monotonic()+20
        while time.monotonic()<deadline:
            found=[wid for wid,app,_ in windows() if app=='org.dolphin-emu.dolphin']
            if found:
                for wid in found:
                    subprocess.run(['aerospace','layout','--window-id',wid,'floating'],check=True)
                    if workspace:
                        subprocess.run(['aerospace','move-node-to-workspace','--window-id',wid,workspace],check=True)
                print(f'Dolphin PID {proc.pid}; floating on Codex workspace {workspace}; 960x720 game viewport',flush=True)
                raise SystemExit(proc.wait())
            if proc.poll() is not None:raise SystemExit('Dolphin exited; inspect '+str(args.user/'launch.log'))
            time.sleep(.2)
        raise SystemExit('Dolphin window did not appear; inspect '+str(args.user/'launch.log'))
    print(f'Dolphin PID {proc.pid}; fixed 960x720 game viewport',flush=True)
    raise SystemExit(proc.wait())


if __name__=='__main__':main()
