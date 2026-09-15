"""Apply the browser's verified matrix specializations to native chunk boundaries."""
from pathlib import Path
import re, shutil, tempfile
import specialize_browser_math as math

def specialize(module):
    module=Path(module);generated=module.parent/'dolrecomp-output/generated'
    chunks=list((generated/'chunks').glob('*.c'))
    with tempfile.TemporaryDirectory(prefix='opensmash-native-math-') as temp:
        stage=Path(temp);(stage/'chunks').mkdir()
        pairs=[]
        for address,name,boundary in [('80342204','chunk_3324_text1_80342140.c','80342140'),
                                       ('8037A54C','chunk_3549_text1_8037A540.c','8037A540')]:
            candidates=[p for p in chunks if 'label_'+address+':' in p.read_text()]
            if len(candidates)!=1:raise ValueError('Expected one native chunk for '+address)
            original=candidates[0];source=original.read_text()
            # Dispatch labels are local to a C function; normalize only that label
            # so the browser's pinned instruction-body hashes still apply.
            source=re.sub(r'return_dispatch_[0-9A-Fa-f]+', 'return_dispatch_'+boundary, source)
            target=stage/'chunks'/name;target.write_text(source);pairs.append((original,target))
        math.GENERATED=stage;math.CHUNK=stage/'chunks/chunk_3324_text1_80342140.c'
        math.specialize();math.specialize_scaled()
        for original,target in pairs:
            if original.read_bytes()!=target.read_bytes():original.write_bytes(target.read_bytes())
        for path in stage.glob('*.h'):
            destination=generated/path.name
            if not destination.exists() or destination.read_bytes()!=path.read_bytes():shutil.copy2(path,destination)
    return module.parent/'module-build'

if __name__=='__main__':
    import argparse,subprocess
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('module',type=Path);a=p.parse_args()
    build=specialize(a.module)
    subprocess.run(['cmake','--build',str(build),'-j','8'],check=True)
    shutil.copy2(build/a.module.name,a.module)
