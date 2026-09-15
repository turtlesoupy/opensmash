"""Keep the SDK GX state machine, replacing the hardware FIFO boundary.

Generated copies retain original register packing, TEV, material and vertex
format behavior. No original files are edited. Draw decoding lives in the host.
"""
from pathlib import Path
import re

def function_span(text,name):
    match=re.search(r'(?m)^(?:static\s+)?(?:asm\s+)?[\w* ]+\b'+re.escape(name)+r'\([^;]*?\)\s*\{',text)
    if not match:raise ValueError('Missing SDK function '+name)
    # Braces inside comments and quoted strings must not affect the depth.
    depth=1
    tokens=re.finditer(r'/\*.*?\*/|//[^\n]*|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|[{}]',text[match.end():],re.S)
    for token in tokens:
        if token[0]=='{':depth+=1
        if token[0]=='}':depth-=1
        if depth==0:return match.start(),match.end()+token.end()
    raise ValueError('Unclosed SDK function '+name)

def edit_function(text,name,replacement):
    begin,end=function_span(text,name)
    return text[:begin]+replacement+text[end:]

def fifo_writes(text):
    text=re.sub(r'GXWGFifo\.(\w+)\s*=\s*([^;]+);',lambda m:f'port_fifo_{m[1]}({m[2]});' if m[1]!='T' else f'port_fifo_##T({m[2]});',text)
    return text

def prepare_gx(source,out,patched):
    sdk=source/'extern/dolphin';include=out/'include';gxpath=sdk/'src/dolphin/gx'
    header=(gxpath/'__gx.h').read_text()
    for suffix,param,typ in [('U8','ub','u8'),('U16','us','u16'),('U32','ui','u32'),('F32','f','f32')]:
        header=re.sub(r'#define GX_WRITE_'+suffix+r'\('+param+r'\)[^\n]+',f'#define GX_WRITE_{suffix}({param}) port_fifo_{typ}(({typ})({param}))',header)
    (include/'__gx.h').write_text('#include "port_fifo.h"\n'+header)
    header=fifo_writes((sdk/'include/dolphin/gx/GXVert.h').read_text())
    hp=include/'dolphin/gx/GXVert.h';hp.parent.mkdir(parents=True,exist_ok=True);hp.write_text('#include "port_fifo.h"\n'+header)
    sources=[gxpath/'GXStubs.c']
    for name in ['GXInit','GXAttr','GXBump','GXFrameBuf','GXGeometry','GXLight','GXPixel','GXTev','GXTexture','GXTransform']:
        src=gxpath/(name+'.c');text=src.read_text()
        # Always resolve private state/FIFO header through the port overlay.
        text=text.replace('#include "__gx.h"','#include <__gx.h>')
        text=text.replace('__cntlzw(', 'port_cntlzw(')
        if name=='GXInit':
            text=edit_function(text,'IsWriteGatherBufferEmpty','')
            text=edit_function(text,'EnableWriteGatherPipe','')
            text=edit_function(text,'DisableWriteGatherPipe','')
            start=text.index('    __piReg = OSPhysicalToUncached',text.index('GXFifoObj *GXInit('))
            end=text.index('    gx->genMode = 0;',start)
            text=text[:start]+'''    port_fifo_reset();
    static u16 cp[64],pe[64],mem[64];static u32 pi[64];
    __piReg=pi;__cpReg=cp;__peReg=pe;__memReg=mem;
'''+text[end:]
        if name=='GXTransform':
            for fn,rows,cols,stride in [('WriteMTXPS4x3',3,4,4),('WriteMTXPS3x3from3x4',3,3,4),('WriteMTXPS3x3',3,3,3),('WriteMTXPS4x2',2,4,4)]:
                text=edit_function(text,fn,f'static void {fn}(f32 mtx[{rows}][{stride}],volatile f32* dest) {{ (void)dest;for(int r=0;r<{rows};r++)for(int c=0;c<{cols};c++)port_fifo_f32(mtx[r][c]); }}')
        text=fifo_writes(text)
        text='static unsigned int port_cntlzw(unsigned int x) { return x ? __builtin_clz(x) : 32; }\n'+text
        rel=str(src.relative_to(source));path=out/'patched'/rel;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text);patched[rel]=path;sources.append(src)
    text=(gxpath/'GXMisc.c').read_text()
    safe=['GXPokeAlphaMode','GXPokeAlphaRead','GXPokeAlphaUpdate','GXPokeBlendMode','GXPokeColorUpdate','GXPokeDstAlpha','GXPokeDither','GXPokeZMode','GXPixModeSync']
    body='#include <__gx.h>\n#include <dolphin/gx.h>\n#include <dolphin/os.h>\n#include <macros.h>\n'
    for name in safe:
        start,end=function_span(text,name);body+=fifo_writes(text[start:end])+'\n'
    text=(gxpath/'GXPerf.c').read_text()
    for name in ['GXSetGPMetric','GXClearGPMetric']:
        start,end=function_span(text,name);body+=fifo_writes(text[start:end])+'\n'
    path=out/'sdk_gx_misc.c';path.write_text(body);sources.append(path)
    # Every direct FIFO write in the game/HSD sources uses the same boundary.
    for src in [* (source/'src/melee').rglob('*.c'),* (source/'src/sysdolphin').rglob('*.c')]:
        rel=str(src.relative_to(source));text=patched.get(rel,src).read_text()
        changed=fifo_writes(text)
        if changed!=text:
            path=out/'patched'/rel;path.parent.mkdir(parents=True,exist_ok=True);path.write_text('#include "port_fifo.h"\n'+changed);patched[rel]=path
    # SDK includes offer portable scalar versions of each paired-single op.
    functions=[]
    for src in (sdk/'src/dolphin/mtx').glob('*.c'):
        text=src.read_text()
        for match in re.finditer(r'(?m)^(?:void|u32|f32|f64)\s+((?:C_MTX|C_VEC|MTX)[A-Za-z0-9_]+)\(',text):
            name=match[1]
            if any(n==name for n,_ in functions):continue
            start,end=function_span(text,name);functions.append((name,text[start:end]))
    # Expose PS symbols with the same portable implementation, including C_MTX
    # helpers called by other SDK functions. The original operation order stays.
    body='#include <dolphin.h>\n#include <math.h>\nstatic float Unit01[2]={0,1};\n'
    body+='\n'.join(code for _,code in functions)
    for name,code in functions:
        if name.startswith(('C_MTX','C_VEC')):
            ps='PS'+name[2:]
            body+='\n'+re.sub(r'\b'+name+r'\s*\(',ps+'(',code,count=1)
    body+='\nvoid PSMTXTrans(Mtx m,f32 x,f32 y,f32 z) { for(int r=0;r<3;r++)for(int c=0;c<4;c++)m[r][c]=r==c?1.0f:0.0f;m[0][3]=x;m[1][3]=y;m[2][3]=z; }\n'
    path=out/'sdk_matrices.c';path.write_text(body);sources.append(path)
    return sources
