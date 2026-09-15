"""Compile upstream game/HSD translation units for wasm32 without modifying them.

Produces object files, diagnostics, and a link-boundary inventory. Compilation
is not runtime compatibility; unresolved functions are never stubbed here.
"""
import argparse, concurrent.futures, collections, hashlib, json, os, re, subprocess, time
from pathlib import Path
from browser_port_sources import prepare
ROOT=Path(__file__).resolve().parents[1]
DEFAULT_CLANG=Path(os.environ.get('MELEE_EMSDK', ROOT.parents[2]/'emsdk')).expanduser()/'upstream/bin/clang'

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--clang',type=Path,default=DEFAULT_CLANG);ap.add_argument('--workers',type=int,default=6);ap.add_argument('--out',type=Path,default=ROOT/'build/browser-port');args=ap.parse_args()
    source=ROOT/'melee';out=args.out.resolve();out.mkdir(parents=True,exist_ok=True)
    patched=prepare(out)
    files=sorted(list((source/'src/melee').rglob('*.c'))+list((source/'src/sysdolphin').rglob('*.c')))
    flags=['--target=wasm32-unknown-emscripten','-xc','-std=c99','-nostdinc','-fno-builtin','-fno-strict-aliasing','-ffp-contract=off','-ffunction-sections','-fdata-sections','-DLINT','-I'+str(ROOT/'browser-port/include'),'-I'+str(out/'include'),'-Isrc','-isystemsrc/MSL','-isystemextern/dolphin/include','-isystemextern/dolphin/src','-Wno-typedef-redefinition','-O1']
    def compile(path):
        rel=path.relative_to(source);obj=out/'objects'/rel.with_suffix('.o');obj.parent.mkdir(parents=True,exist_ok=True)
        input_path=patched.get(str(rel),path)
        proc=subprocess.run([str(args.clang),*flags,'-I'+str(path.parent),'-c',str(input_path),'-o',str(obj)],cwd=source,capture_output=True,text=True)
        obj.with_suffix('.log').write_text(proc.stderr)
        errors=re.findall(r'error: (.+)',proc.stderr)
        return dict(source=str(rel),sha256=hashlib.sha256(path.read_bytes()).hexdigest(),compiled=proc.returncode==0,portability_patch=str(rel) in patched,effective_sha256=hashlib.sha256(input_path.read_bytes()).hexdigest(),errors=errors,object=str(obj.relative_to(out)))
    start=time.monotonic();rows=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for r in pool.map(compile,files):
            rows.append(r)
            if len(rows)%100==0:print(f'{len(rows)}/{len(files)} checked',flush=True)
    report=dict(scope='wasm32 compilation only; two documented source adaptations; original layout assertions enabled; no gameplay claim',upstream=subprocess.check_output(['git','rev-parse','HEAD'],cwd=source,text=True).strip(),compiler=subprocess.check_output([str(args.clang),'--version'],text=True).splitlines()[0],total=len(rows),compiled=sum(r['compiled'] for r in rows),failed=sum(not r['compiled'] for r in rows),elapsed_seconds=time.monotonic()-start,errors=collections.Counter(e for r in rows for e in r['errors']),units=rows)
    (out/'compile-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='units'},indent=2))
    nm=args.clang.parent/'llvm-nm';defined=set();undefined=set();owners=collections.defaultdict(list)
    for r in rows:
        if not r['compiled']:continue
        proc=subprocess.run([str(nm),str(out/r['object'])],capture_output=True,text=True,check=True)
        for line in proc.stdout.splitlines():
            fields=line.split()
            if len(fields)==2 and fields[0]=='U':undefined.add(fields[1]);owners[fields[1]].append(r['source'])
            elif len(fields)>=3 and fields[-2].isupper():defined.add(fields[-1])
    missing={name:owners[name] for name in sorted(undefined-defined)}
    (out/'unresolved-symbols.json').write_text(json.dumps(missing,indent=2)+'\n');print('Unresolved external symbols:',len(missing),flush=True)
    if report['failed']: raise SystemExit(1)

if __name__=='__main__':main()
