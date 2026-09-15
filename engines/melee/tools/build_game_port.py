"""Build actual Melee game code for Wasm, separately from the animation viewer.

--diagnostic permits explicit, trapping host imports for unfinished platform
services. The default build rejects every unresolved symbol. Diagnostic output
must never be deployed as a playable game.
"""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from browser_port_sources import prepare
from portable_gx import prepare_gx
from portable_audio import prepare_audio
from portable_os import prepare_os

ROOT = Path(__file__).resolve().parents[1]
SDK = Path(os.environ.get('MELEE_EMSDK', ROOT.parents[2]/'emsdk'))
SOURCE = ROOT/'melee'
OUT = ROOT/'build/browser-port/game'

def replace(text, before, after):
    if text.count(before) != 1:
        raise ValueError('Port patch context changed: '+before[:100])
    return text.replace(before, after)

def prepare_game():
    OUT.mkdir(parents=True, exist_ok=True)
    patched = prepare(OUT)
    patches = {
        'src/melee/ef/eflib.c': [
            ('#include "eflib.h"', '#include "eflib.h"\n__attribute__((import_module("melee_host"), import_name("archive_type"))) extern void port_archive_type(const void*,int);'),
            ('                 .data)[gfx_id % 1000];', '                 .data)[gfx_id % 1000];\n    port_archive_type(desc,0);')],
        'src/melee/gm/gm_1A3F.c': [
            ('#include "gm_1A3F.h"', '#include "gm_1A3F.h"\nextern int port_initial_mode(int);\nextern void port_mode_loaded(int);'),
            ('    while (!sm->pending_mode_change) {','    port_mode_loaded(mode_kind);\n    while (!sm->pending_mode_change) {'),
            ('    state_machine.routing.prev_mode = GM_COUNT;', '    state_machine.routing.curr_mode = port_initial_mode(state_machine.routing.curr_mode);\n    state_machine.routing.prev_mode = GM_COUNT;')],
        'src/sysdolphin/baselib/archive.c': [
            ('#include "archive.h"', '#include "archive.h"\n__attribute__((import_module("melee_host"), import_name("archive_prepare"))) extern void port_archive_prepare(u8*,u32);\n__attribute__((import_module("melee_host"), import_name("archive_symbol"))) extern void port_archive_symbol(u8*,const char*);'),
            ('    memset(archive, 0, sizeof(HSD_Archive));','    port_archive_prepare(src,file_size);\n    memset(archive, 0, sizeof(HSD_Archive));'),
            ('            return archive->data + archive->public_info[i].offset;', '            port_archive_symbol(archive->top_ptr,symbols);\n            return archive->data + archive->public_info[i].offset;')],
        'src/melee/lb/lbfile.c': [('dst >= 0x80000000','dst >= 0x02000000')],
        'src/melee/lb/lbmemory.c': [('0x80000000U', '0x01000000U')],
        'src/melee/lb/lb_0195.c': [
            ('void fn_800195FC(void)', 'static void port_pad_alarm(OSAlarm* alarm,OSContext* context) { (void)alarm;(void)context;fn_800195FC(); }\nvoid fn_800195FC(void)'),
            ('(OSAlarmHandler) fn_800195FC', 'port_pad_alarm'),
            ('void lb_800195D0(void)\n{', 'extern void port_pump(void);\nvoid lb_800195D0(void)\n{\n    port_pump();')],
        'src/melee/it/kinds/itcoin.c': [('void inline itCoin_ResetRotation(', 'static inline void itCoin_ResetRotation(')],
        'src/melee/mn/mnmainrule.c': [('void mnCharSel_802640A0(void);', 's32 mnCharSel_802640A0(void);')],
        'src/melee/mn/mnhyaku.c': [
            ('void gm_801677E8(void);', 'void gm_801677E8(s8);'),
            ('mn_802295AC();\n        gm_801677E8();', 'gm_801677E8(mn_802295AC());')],
        # The PPC wrapper leaves ftAnim_IsFramesRemaining's result in r3;
        # its result-screen caller consumes it. Make that contract explicit.
        'src/melee/gm/gm_1798.c': [('extern s32 ftLib_800876B4(HSD_GObj*);', 'extern s32 ftAnim_IsFramesRemaining(HSD_GObj*);'),
                                ('ftLib_800876B4(Player_GetEntity(arg2))', 'ftAnim_IsFramesRemaining(Player_GetEntity(arg2))')],
    }
    for rel, edits in patches.items():
        text=(SOURCE/rel).read_text()
        for before,after in edits:
            if rel=='src/melee/lb/lbmemory.c':
                if text.count(before)!=3: raise ValueError('ARAM address comparisons changed')
                text=text.replace(before,after)
            else: text=replace(text,before,after)
        path=OUT/'patched'/rel;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text);patched[rel]=path
    includes=OUT/'include';includes.mkdir(exist_ok=True)
    hp=includes/'melee/ft/ftlib.h'
    if hp.exists(): hp.unlink()
    # Preserve the game's float-returning sqrt ABI without aliasing libc sqrt.
    header=(SOURCE/'src/MSL/math.h').read_text().replace('float sqrt(double);','float port_sqrt(double);\n#define sqrt port_sqrt')
    (includes/'math.h').write_text(header)
    header=(SOURCE/'extern/dolphin/include/dolphin/os.h').read_text()
    header=header.replace('#define __OSBusClock (*(u32*) (OS_BASE_CACHED | 0x00F8))','#define __OSBusClock 162000000u')
    header=header.replace('#define __OSCoreClock (*(u32*) (OS_BASE_CACHED | 0x00FC))','#define __OSCoreClock 486000000u')
    start=header.index('#if !DEBUG\n#define OSPhysicalToCached')
    end=header.index('#endif',start)+len('#endif')
    header=header[:start]+'''#define OSPhysicalToCached(p) ((void*)(u32)(p))
#define OSPhysicalToUncached(p) ((void*)(u32)(p))
#define OSCachedToPhysical(p) ((u32)(p))
#define OSUncachedToPhysical(p) ((u32)(p))
#define OSCachedToUncached(p) ((void*)(p))
#define OSUncachedToCached(p) ((void*)(p))
'''+header[end:]
    hp=includes/'dolphin/os.h';hp.parent.mkdir(parents=True,exist_ok=True);hp.write_text(header)
    # HSD's private Metrowerks FILE layout cannot be applied to musl FILE.
    text=(SOURCE/'src/sysdolphin/baselib/debug.c').read_text()
    start=text.index('void HSD_LogInit(void)');end=text.index('\nvoid __assert',start)
    text=text[:start]+'void HSD_LogInit(void)\n{\n    /* Output is handled by the portable OSReport sink. */\n}\n'+text[end:]
    path=OUT/'patched/src/sysdolphin/baselib/debug.c';path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text);patched['src/sysdolphin/baselib/debug.c']=path
    # Debug stack reporting uses the actual Wasm stack bounds.
    text=(SOURCE/'src/melee/db/dbinit.c').read_text()
    start=text.index('void db_PrintThreadInfo(void)');end=text.index('\nstatic inline int db_get_pad_button',start)
    text=text[:start]+'extern void port_report_stack(void);\nvoid db_PrintThreadInfo(void) { port_report_stack(); }\n'+text[end:]
    path=OUT/'patched/src/melee/db/dbinit.c';path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text);patched['src/melee/db/dbinit.c']=path
    # Wasm has no PPC floating-point trap registers or hardware crash screen.
    from portable_gx import edit_function
    for rel, fn, replacement in [
        ('src/melee/db/dberror.c','db_ClearFPUExceptions','void db_ClearFPUExceptions(void) {}'),
        ('src/sysdolphin/baselib/debug.c','HSD_Panic','void HSD_Panic(char* file,u32 line,char* message) { OSPanic(file,line,"%s",message); }')]:
        text=patched.get(rel,SOURCE/rel).read_text()
        text=edit_function(text,fn,replacement)
        path=OUT/'patched'/rel;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text);patched[rel]=path
    gx_sources=prepare_gx(SOURCE,OUT,patched)
    sdk_sources=gx_sources+prepare_audio(SOURCE,OUT,patched)+prepare_os(SOURCE,OUT,patched)
    manifest={rel:dict(original_sha256=hashlib.sha256((SOURCE/rel).read_bytes()).hexdigest(),effective_sha256=hashlib.sha256(path.read_bytes()).hexdigest()) for rel,path in patched.items()}
    (OUT/'source-patches.json').write_text(json.dumps(manifest,indent=2)+'\n')
    return patched,sdk_sources

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--diagnostic',action='store_true');a=ap.parse_args()
    patched,gx_sources=prepare_game()
    flags=['--target=wasm32-unknown-emscripten','-xc','-std=c99','-nostdinc','-fno-builtin','-fno-strict-aliasing','-ffp-contract=off','-ffunction-sections','-fdata-sections','-DLINT',
           '-I'+str(OUT/'include'),'-I'+str(ROOT/'browser-port/include'),'-I'+str(ROOT/'build/browser-port/include'),'-Isrc','-isystemsrc/MSL','-isystemextern/dolphin/include','-isystemextern/dolphin/src','-Wno-typedef-redefinition','-O1','-g']
    files=sorted(list((SOURCE/'src/melee').rglob('*.c'))+list((SOURCE/'src/sysdolphin').rglob('*.c')))
    files += gx_sources+[SOURCE/'src/MSL/ctype.c',SOURCE/'src/MSL/float.c',SOURCE/'extern/dolphin/src/dolphin/os/OSAlloc.c',ROOT/'browser-port/src/platform.c',ROOT/'browser-port/src/video_platform.c',ROOT/'browser-port/src/gx_fifo.c',ROOT/'browser-port/src/audio_platform.c',ROOT/'browser-port/src/match_launch.c']
    if a.diagnostic: files.append(ROOT/'browser-port/tests/platform_checks.c')
    header_digest=hashlib.sha256()
    for folder in [SOURCE/'src',SOURCE/'extern/dolphin',OUT/'include',ROOT/'browser-port/include',ROOT/'build/browser-port/include']:
        for header in sorted(folder.rglob('*.h')):
            header_digest.update(str(header).encode());header_digest.update(header.read_bytes())
    build_fingerprint=json.dumps(flags).encode()+header_digest.digest()
    def compile(src):
        rel=str(src.relative_to(SOURCE)) if src.is_relative_to(SOURCE) else src.name
        path=patched.get(rel,src);obj=OUT/'objects'/Path(rel).with_suffix('.o');obj.parent.mkdir(parents=True,exist_ok=True)
        fingerprint=hashlib.sha256(path.read_bytes()+build_fingerprint).hexdigest()
        cache=obj.with_suffix('.sha256')
        if not obj.exists() or not cache.exists() or cache.read_text()!=fingerprint:
            p=subprocess.run([str(SDK/'upstream/bin/clang'),*flags,'-I'+str(src.parent),'-c',str(path),'-o',str(obj)],cwd=SOURCE,capture_output=True,text=True)
            obj.with_suffix('.log').write_text(p.stderr)
            if p.returncode:raise RuntimeError(rel+'\n'+p.stderr[-5000:])
            cache.write_text(fingerprint)
        return str(obj)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool: objects=list(pool.map(compile,files))
    response=OUT/'objects.rsp';response.write_text('\n'.join(objects))
    wasm=OUT/('melee-game-diagnostic.wasm' if a.diagnostic else 'melee-game.wasm')
    temporary=wasm.with_name(wasm.stem+'.tmp.wasm')
    exports=['_main','_port_input','_port_pump','_port_configure_match']
    if a.diagnostic: exports+=['_port_check_platform','_port_check_aram_bounds']
    command=[str(SDK/'upstream/emscripten/emcc'),'@'+str(response),'--no-entry','-O1','-g','-sSTANDALONE_WASM=1','-sEXPORTED_FUNCTIONS='+json.dumps(exports),'-sSTACK_SIZE=2097152','-sINITIAL_MEMORY=134217728','-sGLOBAL_BASE=33554432','-sALLOW_MEMORY_GROWTH=1','-Wl,--fatal-warnings','-Wl,--error-limit=0','-o',str(temporary)]
    if a.diagnostic:command+=['-sERROR_ON_UNDEFINED_SYMBOLS=0','-Wl,--import-undefined']
    p=subprocess.run(command,env=dict(os.environ,EM_CONFIG=str(SDK/'.emscripten')),capture_output=True,text=True)
    (OUT/('link-diagnostic.log' if a.diagnostic else 'link-release.log')).write_text(p.stdout+p.stderr)
    if p.returncode:raise SystemExit((p.stdout+p.stderr)[-9000:])
    temporary.replace(wasm)
    report=dict(wasm=str(wasm),bytes=wasm.stat().st_size,diagnostic=a.diagnostic,sources=len(files),
                sha256=hashlib.sha256(wasm.read_bytes()).hexdigest(),
                upstream_commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=SOURCE,text=True).strip(),
                header_digest=header_digest.hexdigest(),playable=False)
    (OUT/('build-diagnostic.json' if a.diagnostic else 'build-release.json')).write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))

if __name__=='__main__': main()
