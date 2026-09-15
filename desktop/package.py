"""Build a local two-engine installer, without publishing or changing git refs."""
import argparse,hashlib,json,os,shutil,subprocess,sys,plistlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
MELEE=ROOT/'engines/melee'
def stage_ssb64(runtime,output):
 manifest=json.loads((runtime/'opensmash-runtime.json').read_text())
 if manifest.get('launcherInput')!=1 or manifest.get('embeddedFrames')!=1:raise ValueError('Rebuild SSB64 with desktop/build_ssb64.py first.')
 for name,digest in manifest['sha256'].items():
  source=(runtime/name).resolve()
  if not source.is_relative_to(runtime.resolve()) or hashlib.sha256(source.read_bytes()).hexdigest()!=digest:raise ValueError('SSB64 runtime hash mismatch: '+name)
 if output.exists():shutil.rmtree(output)
 output.mkdir(parents=True)
 exe='.exe' if os.name=='nt' else ''
 # Explicit allowlist: no ROM, game archive, save, log, or user configuration.
 names=['BattleShip'+exe,'torch'+exe,'f3d.o2r','gamecontrollerdb.txt','config.yml','yamls/us','assets/custom/fonts']
 if not (runtime/('torch'+exe)).exists():
  names[1]='torch-native'+exe
 for name in names:
  source=runtime/name;target=output/name
  if not source.exists():raise ValueError('Missing SSB64 runtime input: '+name)
  target.parent.mkdir(parents=True,exist_ok=True)
  if source.is_dir():shutil.copytree(source,target)
  else:shutil.copy2(source,target)
 for source in [*runtime.glob('*.dylib'),*runtime.glob('*.dll'),*runtime.glob('*.so*')]:shutil.copy2(source,output/source.name)
 if sys.platform=='darwin':
  from mac_libraries import bundle
  bundle(output)
 licenses=ROOT/'build/shared-ssb64-source'
 for source in licenses.rglob('*'):
  if source.is_file() and source.name.lower().startswith(('license','copying','copyright')) and not any(part in ('build','.git','node_modules') for part in source.relative_to(licenses).parts):
   target=output/'licenses'/source.relative_to(licenses);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
 runner='BattleShip'+exe
 if sys.platform=='darwin':
  app=output/'Smash 64 Engine.app';mac=app/'Contents/MacOS';resources=app/'Contents/Resources';entries=list(output.iterdir());mac.mkdir(parents=True);resources.mkdir()
  for entry in entries:
   dest=mac if entry.suffix=='.dylib' or entry.name in ('BattleShip','torch','torch-native') else resources
   shutil.move(str(entry),str(dest/entry.name))
  (app/'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleExecutable':'BattleShip','CFBundleIdentifier':'fun.smash.opensmash.ssb64','CFBundleName':'Smash 64 Engine','CFBundlePackageType':'APPL','CFBundleVersion':'1','NSHighResolutionCapable':True}))
  subprocess.run(['codesign','--force','--sign','-',str(app)],check=True)
  runner='Smash 64 Engine.app/Contents/MacOS/BattleShip'
 hashes={p.relative_to(output).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in output.rglob('*') if p.is_file()}
 (output/'opensmash-runtime.json').write_text(json.dumps({**manifest,'runner':runner,'workingDirectory':'Smash 64 Engine.app/Contents/Resources' if sys.platform=='darwin' else '.', 'sha256':hashes},indent=2)+'\n')
 return hashes

def verify(resources):
 for name in ['shared-web/index.html','launcher/site.cjs','launcher/input.cjs','ssb64-service/service.cjs','payload/runtime/launch-options.json']:
  if not (resources/name).is_file():raise ValueError('Missing packaged file: '+name)
 for folder,filename in [('ssb64','opensmash-runtime.json'),('runtime','runtime.json')]:
  root=resources/folder;manifest=json.loads((root/filename).read_text())
  if manifest.get('launcherInput')!=1:raise ValueError('Packaged engine lacks shared controller/audio support: '+folder)
  if folder=='ssb64' and manifest.get('embeddedFrames')!=1:raise ValueError('Packaged Smash 64 lacks embedded display support')
  for name,digest in manifest['sha256'].items():
   p=(root/name).resolve()
   if not p.is_relative_to(root.resolve()) or hashlib.sha256(p.read_bytes()).hexdigest()!=digest:raise ValueError('Packaged runtime hash mismatch: '+name)
 for p in (resources/'ssb64').rglob('*'):
  if p.suffix.lower() in ['.z64','.n64','.v64','.iso','.gcm'] or p.name.lower().startswith('battleship.o2r'):raise ValueError('Game-derived input found in packaged SSB64 runtime')

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--ssb64',type=Path,default=ROOT/'build/shared-ssb64-runtime');p.add_argument('--dir',action='store_true');p.add_argument('--skip-freeze',action='store_true');a=p.parse_args()
 stage_ssb64(a.ssb64.resolve(),ROOT/'build/desktop-ssb64')
 npm='npm.cmd' if os.name=='nt' else 'npm'
 def run(args,cwd=ROOT):subprocess.run(list(map(str,args)),cwd=cwd,check=True)
 run([npm,'--prefix',ROOT/'web-prototype','run','build'])
 run([npm,'--prefix',MELEE/'web','run','build'])
 if not a.skip_freeze:run([sys.executable,MELEE/'tools/build_desktop_payload.py'])
 run(['node','build-surface.cjs'],MELEE/'desktop')
 run([npm,'exec','--','electron-builder','--config',ROOT/'desktop/builder.cjs','--publish','never',*(['--dir'] if a.dir else [])],MELEE/'desktop')
 candidates=list((ROOT/'build/desktop-artifacts').glob('mac*/OpenSmash.app/Contents/Resources'))+list((ROOT/'build/desktop-artifacts').glob('*-unpacked/resources'))
 if not candidates:raise ValueError('Packaged application not found')
 for resources in candidates:verify(resources)
 print('Verified two-engine package:',ROOT/'build/desktop-artifacts')
