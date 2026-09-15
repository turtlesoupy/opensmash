"""Resolve presentation globals from the pinned decomp's address catalog.

Addresses are only keys for existing presentation hooks, never executable code.
The generated accessors return native WASM pointers into the source game.
"""
import re

def generate(src,up,port):
    text=(port/'src/presentation.c').read_text()+(port.parent/'mods/character_select.h').read_text()+(port.parent/'mods/vs_intro.h').read_text()
    addresses={int(x,16) for x in re.findall(r'0x(80[34][0-9a-fA-F]{5})',text)}
    sections=[];owner=None
    for line in (up/'config/GALE01/splits.txt').read_text().splitlines():
        if line.endswith('.c:'):owner=line[:-1]
        m=re.search(r'(\.\w+)\s+start:0x([\da-fA-F]+) end:0x([\da-fA-F]+)',line)
        if m and owner:sections.append((int(m[2],16),int(m[3],16),owner))
    symbols=[]
    for line in (up/'config/GALE01/symbols.txt').read_text().splitlines():
        m=re.match(r'(\w+) = (\.\w+):0x([\da-fA-F]+);.*type:object size:0x([\da-fA-F]+)',line)
        if m:symbols.append((int(m[3],16),int(m[4],16),m[1]))
    chosen={};unmapped=[]
    for addr in sorted(addresses):
        matches=[v for v in symbols if v[0]<=addr<v[0]+v[1]]
        if not matches:continue # Function addresses are only call-site discriminators.
        start,size,name=max(matches,key=lambda v:v[1]);chosen[start]=(size,name)
    for start,size,name in symbols:
        if 0x803b75f8<=start<0x803b75f8+33*4*4:chosen[start]=(size,name)
    declarations=[];cases=[]
    css={'mnCharSel_803F0A48':'direct_css.v_a','icons':'direct_css.v_b','mnCharSel_803F0DFC':'direct_css.v_c','mnCharSel_803F0E8C':'direct_css.v_d','mnCharSel_803F0EBC':'direct_css.v_e','data2':'direct_css.v_f'}
    for address,(size,name) in chosen.items():
        owners=[o for a,b,o in sections if a<=address<b]
        if not owners:raise ValueError(f'No owner for {name}')
        path=src/'src'/owners[0]
        if name=='retraceCount':path=src/'pc/src/vi.c';name='retrace_count'
        if not path.exists():raise ValueError(f'Missing owner {path}')
        expression=css.get(name,name) if owners[0].endswith('mncharsel.c') else name
        accessor=f'direct_global_{address:08x}'
        body=path.read_text();body+=f'\nunsigned {accessor}(void){{return (unsigned)&{expression};}}\n';path.write_text(body)
        declarations.append(f'extern unsigned {accessor}(void);')
        cases.append(f'if(p>=0x{address:x}u&&p<0x{address+size:x}u)return {accessor}()+p-0x{address:x}u;')
    (src/'pc/src/presentation_globals.c').write_text('\n'.join(declarations)+f'\nunsigned direct_resolve_global(unsigned p){{\nif(p<0x{min(chosen):x}u||p>=0x{max(a+v[0] for a,v in chosen.items()):x}u)return p;\n'+'\n'.join(cases)+'\nreturn p;\n}\n')
