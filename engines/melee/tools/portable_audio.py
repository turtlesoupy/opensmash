"""Prepare SDK voice/FX code; assembly DSP kernels remain explicit imports.

The diagnostic build traps if an untranslated kernel is invoked. These imports
are rejected by the release link until corresponding portable kernels exist.
"""
import re
from portable_gx import function_span

def prepare_audio(source,out,patched):
    sdk=source/'extern/dolphin/src/dolphin';files=[]
    for name in ['AXAlloc','AXVPB','AXAux','AXCL','AXSPB']:
        files.append(sdk/'ax'/(name+'.c'))
    for src in (sdk/'axfx').glob('*.c'):
        text=src.read_text()
        while True:
            match=re.search(r'(?m)^asm static void (\w+)\([^;]*?\)\s*\{',text)
            if not match:break
            name=match[1]
            # This source's original forward declaration supplies the ABI.
            begin=match.start();brace=text.index('{',match.start());end=text.index('\n}',brace)+2
            declaration=text[begin:brace].replace('asm static','extern').replace('register ','').strip()+';\n'
            text=text[:begin]+declaration+text[end:]
            text=re.sub(r'(?m)^static void '+name+r'\(', 'extern void '+name+'(',text)
            text=re.sub(r'\b'+name+r'\b','port_'+src.stem+'_'+name,text)
        text=text.replace('__cntlzw(', 'port_audio_cntlzw(')
        text='static unsigned int port_audio_cntlzw(unsigned int x) { return x ? __builtin_clz(x) : 32; }\n'+text
        rel=str(src.relative_to(source));path=out/'patched'/rel;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text);patched[rel]=path;files.append(src)
    # AX addresses are two u16 fields, not a native-endian u32 alias.
    rel='src/sysdolphin/baselib/synth.c'
    text=(source/rel).read_text()
    begin=text.index('                if (e + 0x10 != NULL)')
    end=text.index('            }\n            id =',begin)
    text=text[:begin]+"""                for (int address_offset=0x14;address_offset<=0x1C;address_offset+=4) {
                    u16* halves=(u16*)(e+address_offset);
                    u32 address=((u32)halves[0]<<16)|halves[1];
                    address+=hsd_SynthSFXBank[bankID]*2;
                    halves[0]=address>>16;halves[1]=address;
                }
"""+text[end:]
    path=out/'patched'/rel;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text);patched[rel]=path
    return files
