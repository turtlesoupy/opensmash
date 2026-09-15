"""Bundle non-system Mach-O dependencies and make every reference relocatable."""
import shutil,subprocess
from pathlib import Path

def dependencies(binary):
 return [line.strip().split(' (compatibility')[0] for line in subprocess.check_output(['otool','-L',str(binary)],text=True).splitlines()[1:]]

def bundle(directory):
 directory=directory.resolve();pending=[p for p in directory.iterdir() if p.is_file() and (p.suffix=='.dylib' or p.name in ('BattleShip','torch','torch-native'))];seen=set();origins={}
 while pending:
  binary=pending.pop()
  if binary in seen:continue
  seen.add(binary)
  for dependency in dependencies(binary):
   if dependency.startswith(('/System/Library/','/usr/lib/')):continue
   if dependency.startswith('@loader_path/'):
    target=binary.parent/dependency.removeprefix('@loader_path/')
    if not target.exists():raise ValueError('Missing bundled library: '+dependency)
    pending.append(target);continue
   if not dependency.startswith('/'):raise ValueError('Unresolved native dependency: '+dependency)
   source=Path(dependency).resolve();target=directory/source.name
   if source.name in origins and origins[source.name]!=source:raise ValueError('Conflicting native library: '+source.name)
   origins[source.name]=source
   if not target.exists():shutil.copy2(source,target)
   subprocess.run(['install_name_tool','-change',dependency,'@loader_path/'+target.name,str(binary)],check=True)
   pending.append(target)
  if binary.suffix=='.dylib':subprocess.run(['install_name_tool','-id','@loader_path/'+binary.name,str(binary)],check=True)
 for binary in seen:
  subprocess.run(['codesign','--force','--sign','-',str(binary)],check=True)
  if any(d.startswith('/') and not d.startswith(('/System/Library/','/usr/lib/')) for d in dependencies(binary)):
   raise ValueError('Nonportable dependency remains: '+str(binary))
