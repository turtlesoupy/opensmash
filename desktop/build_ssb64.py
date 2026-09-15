"""Build the shared-launcher SSB64 runtime in an isolated source snapshot."""
import argparse,hashlib,json,os,shutil,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def build(engine,output,jobs):
 source=ROOT/'build/shared-ssb64-source';source.mkdir(parents=True,exist_ok=True)
 names=subprocess.check_output(['git','-C',str(engine),'ls-files','--recurse-submodules','-z']).decode().split('\0')
 # Never copy a developer's generated assets, caches, configuration or ROMs.
 for name in filter(None,names):
  src=engine/name
  if not src.is_file():continue
  dst=source/name;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst)
 # Honor the launcher data directory on Windows as well as Unix.
 context=source/'libultraship/src/ship/Context.cpp'
 text=context.read_text().replace('std::string Context::GetAppDirectoryPath(std::string appName) {', 'std::string Context::GetAppDirectoryPath(std::string appName) {\n    if (const char* path = std::getenv("OPENSMASH_DATA_DIR")) return path;')
 context.write_text(text)
 patch=ROOT/'engines/ssb64/native/launcher.patch'
 subprocess.run(['git','apply',str(patch)],cwd=source,check=True)
 subprocess.run(['git','apply',str(ROOT/'engines/ssb64/native/embedded.patch')],cwd=source,check=True)
 cmake=source/'CMakeLists.txt';cmake.write_text('include_directories("'+str(ROOT/'desktop/native')+'")\n'+cmake.read_text())
 with (source/'CMakeLists.txt').open('a') as f:
  f.write('\ntarget_include_directories(${PROJECT_NAME} PRIVATE "'+str(ROOT/'engines/ssb64/native')+'" "'+str(ROOT/'desktop/native')+'")\n')
 rom=next((engine/('baserom.us.'+suffix) for suffix in ('z64','n64','v64') if (engine/('baserom.us.'+suffix)).is_file()),engine/'baserom.us.z64')
 subprocess.run([sys.executable,str(ROOT/'build.py'),'native','--vanilla','--battleship',str(source),'--rom',str(rom),'--output-dir',str(output),'--jobs',str(jobs)],check=True,cwd=ROOT)
 binary=output/('BattleShip.exe' if os.name=='nt' else 'BattleShip')
 (output/'opensmash-runtime.json').write_text(json.dumps({'engine':'ssb64','launcherInput':1,'embeddedFrames':1,'sha256':{binary.name:hashlib.sha256(binary.read_bytes()).hexdigest()}},indent=2)+'\n')
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--engine',type=Path,default=ROOT.parent/'BattleShip');p.add_argument('--output',type=Path,default=ROOT/'build/shared-ssb64-runtime');p.add_argument('--jobs',type=int,default=8);a=p.parse_args();build(a.engine.resolve(),a.output.resolve(),a.jobs)
