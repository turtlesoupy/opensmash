"""Build the pinned Melee C source port for WebAssembly, in an isolated directory."""
from pathlib import Path
import argparse, concurrent.futures, hashlib, json, os, re, shutil, subprocess
ROOT=Path(__file__).resolve().parents[1]
PORT=ROOT/'runtime/direct-c'
OUT=ROOT/'build/direct-c'
SDK=Path(os.environ.get('MELEE_EMSDK',str(ROOT.parents[2]/'emsdk'))).expanduser().resolve()
UP=ROOT/'build/source-port-upstream'
def function(s,name,body):
    m=re.search(r'(?m)^(?:static )?[^\n;{}]+\b'+re.escape(name)+r'\([^;{}]*\)\s*\{',s)
    if not m: raise ValueError('Missing function '+name)
    a=s.index('{',m.start()); depth=1;i=a+1
    # Function bodies here do not contain unmatched braces in strings/comments.
    while depth:
        depth+=(s[i]=='{')-(s[i]=='}');i+=1
    return s[:a]+'{\n'+body+'\n}'+s[i:]
def prepare():
    pin=json.loads((PORT/'upstream.json').read_text())
    if not UP.exists():
        subprocess.run(['git','clone','--no-checkout',pin['url'],str(UP)],check=True)
        subprocess.run(['git','checkout','--detach',pin['revision']],cwd=UP,check=True)
    rev=subprocess.check_output(['git','rev-parse','HEAD'],cwd=UP,text=True).strip()
    if rev!=pin['revision']:raise ValueError('Unexpected source port revision '+rev)
    src=OUT/'source';src.mkdir(parents=True,exist_ok=True)
    for folder in ['src','extern/dolphin','pc']:
        shutil.copytree(UP/folder,src/folder,dirs_exist_ok=True)
    def edit(rel,fn):
        p=src/rel;p.write_text(fn(p.read_text()))
    def no_windows(s):return re.sub(r'#include <(?:windows.h|dbghelp.h|crtdbg.h|mmsystem.h|wincrypt.h|direct.h)>', '',s)
    edit('pc/include/pc_platform.h',lambda s:s.replace('#if !defined(_MSC_VER)','#if !defined(_MSC_VER) && !defined(__EMSCRIPTEN__)').replace('#include <math.h>','#include "host_compat.h"\n#include <math.h>'))
    edit('src/Runtime/platform.h',lambda s:s.replace('typedef signed int ssize_t;', '/* ssize_t comes from the host libc. */'))
    edit('src/melee/mn/mnmainrule.c',lambda s:s.replace('void mnCharSel_802640A0(void);','s32 mnCharSel_802640A0(void);'))
    edit('src/melee/gm/gm_1798.c',lambda s:s.replace('extern s32 ftLib_800876B4(HSD_GObj*);','extern s32 ftAnim_IsFramesRemaining(HSD_GObj*);').replace('ftLib_800876B4(Player_GetEntity(arg2))','ftAnim_IsFramesRemaining(Player_GetEntity(arg2))'))
    edit('src/melee/lb/lbmemory.c',lambda s:s.replace('0x80000000U','0x02000000U'))
    edit('src/melee/lb/lbfile.c',lambda s:s.replace('dst >= 0x80000000','dst >= 0x02000000'))
    s=no_windows((src/'pc/src/runtime.c').read_text())
    a=s.index('static int sym_init(');b=s.index('__declspec(noreturn) void pc_exit',a)
    s=s[:a]+'''const char* pc_symbol_name(const void* addr) { static char b[32]; snprintf(b,sizeof(b),"%p",addr);return b; }
void pc_print_backtrace(void) { emscripten_log(EM_LOG_C_STACK|EM_LOG_ERROR,"direct-C stack"); }
uintptr_t pc_symbol_address(const char* spec) { return 0; }
const char* pc_exe_dir(void) { return "/"; }
int pc_ptr_readable(const void* p,size_t bytes) { uintptr_t a=(uintptr_t)p; return a>=1024 && a<=emscripten_get_heap_size() && bytes<=emscripten_get_heap_size()-a; }
'''+s[b:]
    a=s.index('static HANDLE main_thread;');b=s.index('/* --- Completion pump',a)
    s=s[:a]+'''void pc_runtime_init(void) {
 mem_base=aligned_alloc(32,PC_MEM_SIZE); if(!mem_base)abort(); memset(mem_base,0,PC_MEM_SIZE);
 arena_lo=mem_base;arena_hi=mem_base+PC_MEM_SIZE;
 QueryPerformanceFrequency(&qpc_freq);QueryPerformanceCounter(&qpc_start);
 setvbuf(stdout,NULL,_IONBF,0);setvbuf(stderr,NULL,_IONBF,0);
}
'''+s[b:]
    s='#include <emscripten/heap.h>\nextern void pc_ax_shutdown(void);\n'+s
    (src/'pc/src/runtime.c').write_text(s)
    edit('pc/src/vi.c',lambda s:function(no_windows(s),'pace_to_60hz','static double next; double now=emscripten_get_now(); if(next<now-500)next=now;next+=1000.0/60;emscripten_sleep((unsigned)fmax(0,next-now));'))
    # The loader checks the exact executable with SHA-1 before touching archives.
    s=no_windows((src/'pc/src/dvd.c').read_text())
    s=s.replace('#include <ctype.h>','#include <ctype.h>\n#include "sha1.h"')
    s=s.replace('    HCRYPTPROV prov = 0;\n    HCRYPTHASH hash = 0;','').replace('    DWORD dlen = sizeof(digest);','')
    a=s.index('    if (!CryptAcquireContextA');b=s.index('    for (i = 0; i < 20;',a)
    s=s[:a]+'    direct_sha1(data,dol_size,digest);\n    free(data);\n'+s[b:]
    (src/'pc/src/dvd.c').write_text(s)
    s=no_windows((src/'pc/src/card.c').read_text());s='#include <dirent.h>\n'+s
    s=function(s,'load_all','''if(loaded)return;loaded=1;DIR* dir=opendir(save_dir());if(!dir)return;
struct dirent* entry;while((entry=readdir(dir))){size_t n=strlen(entry->d_name);if(n<4||strcmp(entry->d_name+n-4,".sav"))continue;
char path[MAX_PATH+64];snprintf(path,sizeof(path),"%s/%s",save_dir(),entry->d_name);load_one(path);}closedir(dir);''')
    (src/'pc/src/card.c').write_text(s)
    s=no_windows((src/'pc/src/ax.c').read_text());a=s.index('#define OUT_BUFFERS');b=s.index('/* --- debug dump',a)
    s=s[:a]+'''static void out_open(void) {}
extern void direct_audio(const short*,int);
static void out_push(const s32* frame) { if(pc_config.no_audio)return;short out[AX_FRAME*2];for(int i=0;i<AX_FRAME*2;i++)out[i]=clamp16((frame[i]*pc_config.volume)/100);direct_audio(out,AX_FRAME); }
'''+s[b:];(src/'pc/src/ax.c').write_text(s)
    # Browser adapters replace only the OS devices, retaining the mixer and GX engine.
    for name in ['gl_window.c','pad.c','trace.c','host.c','audio.c','verify.c','launch.c','presentation.c','skinning.c']:
        shutil.copy2(PORT/'src'/name,src/'pc/src'/name)
    shutil.copytree(PORT/'vendor/mbedtls',src/'pc/src/hash',dirs_exist_ok=True)
    for name in ['sonic.c','sonic.h']:shutil.copy2(PORT/'vendor/sonic'/name,src/'pc/src'/name)
    (src/'pc/src/gcadapter.c').unlink()
    old=(src/'pc/src/pc_gl.h').read_text();decl=old[old.index('/// Create the window'):]
    funcs=re.findall(r'extern PFN_(gl\w+) pc_\1;',old)
    (src/'pc/src/pc_gl.h').write_text('#ifndef PC_GL_H\n#define PC_GL_H\n#include "host_compat.h"\n#define GL_GLEXT_PROTOTYPES 1\n#include <GL/gl.h>\n#include <GL/glext.h>\n'+ '\n'.join('#define pc_'+n+' '+n for n in funcs)+ '\n'+decl)
    edit('pc/src/gx_render.c',lambda s:s.replace('#version 120\\n','#version 100\\nprecision highp float;\\n').replace('int ok = (ver != NULL','int ok = 1 || (ver != NULL').replace('pc_glBufferStorage != NULL','0').replace('pc_glMapBufferRange != NULL','0'))
    edit('pc/src/gx_render.c',lambda s:function(s,'ring_init','use_ring=0;'))
    def webgl_buffers(s):
        s=s.replace('static int use_ring = -1;', 'static int use_ring = -1;\nstatic GLuint direct_vbo,direct_ibo;')
        s=s.replace('use_ring=0;', 'use_ring=0;glGenBuffers(1,&direct_vbo);glGenBuffers(1,&direct_ibo);glBindBuffer(GL_ARRAY_BUFFER,direct_vbo);glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,direct_ibo);')
        s=s.replace('const u8* vbase = use_ring > 0 ? NULL : (gpu_path > 0 ? (const u8*) gverts : (const u8*) glverts);','const u8* vbase = NULL;')
        a=s.index('        if (use_ring > 0) {',s.index('static void flush_batch(void)\n{'))
        b=s.index('        prof_ms[8]',a)
        s=s[:a]+'''        glBufferData(GL_ARRAY_BUFFER,batch_verts*(gpu_path>0?sizeof(GLVertexG):sizeof(GLVertex)),gpu_path>0?(void*)gverts:(void*)glverts,GL_STREAM_DRAW);
        glBufferData(GL_ELEMENT_ARRAY_BUFFER,batch_idx*sizeof(u16),indices,GL_STREAM_DRAW);
        glDrawElements(GL_TRIANGLES,batch_idx,GL_UNSIGNED_SHORT,0);
'''+s[b:]
        s=s.replace('            glDrawArrays(mode,', '            glBufferData(GL_ARRAY_BUFFER,(base+nverts)*(gpu_path>0?sizeof(GLVertexG):sizeof(GLVertex)),gpu_path>0?(void*)gverts:(void*)glverts,GL_STREAM_DRAW);\n            glDrawArrays(mode,')
        return s
    edit('pc/src/gx_render.c',webgl_buffers)


    def css_layout(s):
        pattern=r'(?ms)^static ([^\n]+?) PC_ADJACENT\(([a-f])\) (\w+)([^=;]*) = (\{.*?^\});'
        declarations=list(re.finditer(pattern,s))
        if len(declarations)!=6:raise ValueError('CSS layout changed')
        fields=[];values=[];names=[]
        for m in declarations:
            typ,key,name,shape,value=m.groups();fields.append(f'{typ} v_{key}{shape};');values.append(f'.v_{key}={value}');names.append((name,f'(direct_css.v_{key})'))
        group='static struct {\n'+'\n'.join(fields)+'\n} direct_css = {\n'+',\n'.join(values)+'\n};\n'
        pos=declarations[0].start()
        for m in reversed(declarations):s=s[:m.start()]+s[m.end():]
        s=s[:pos]+group+s[pos:]
        a=s.index('#define CSS_ALL')
        tail=s[a:]
        for name,value in names:tail=re.sub(r'(?<![.>])\b'+name+r'\b',value,tail)
        return s[:a]+tail
    def mute_layout(s):
        s=s.replace('static s32 PC_ADJACENT(g) grMc_pc_before[1];','').replace('static s32 PC_ADJACENT(h) grMc_8049F440[30];','')
        s=s.replace('#include "grmutecity.static.h"','#include "grmutecity.static.h"\nstatic struct {s32 before[1];s32 indices[30];grMc_CarEntry cars[30];} direct_mute;\n#define grMc_pc_before direct_mute.before\n#define grMc_8049F440 direct_mute.indices\n#define grMc_8049F4B8 direct_mute.cars')
        return s
    edit('src/melee/gr/grmutecity.static.h',lambda s:s.replace('static grMc_CarEntry PC_ADJACENT(i) grMc_8049F4B8[30];',''))
    edit('src/melee/gr/grmutecity.c',mute_layout)
    def venom_layout(s):
        pat=r'(?ms)^(?:static )?(grVe_Data|int|StageCallbacks) PC_ADJACENT\(([lmn])\) (\w+)([^=;]*) = (\{.*?\});'
        matches=list(re.finditer(pat,s));fields=[];values=[];macros=[]
        if len(matches)!=3:raise ValueError('Venom layout changed')
        for m in matches:
            typ,key,name,shape,value=m.groups();fields.append(f'{typ} v_{key}{shape};');values.append(f'.v_{key}={value}');macros.append(f'#define {name} (direct_venom.v_{key})')
        pos=matches[0].start()
        for m in reversed(matches):s=s[:m.start()]+s[m.end():]
        group='static struct {\n'+'\n'.join(fields)+'\n} direct_venom = {\n'+',\n'.join(values)+'\n};\n'+'\n'.join(macros)+'\nstatic int grVe_803E5530[53];\nstatic int grVe_803E56A0[6];\n'
        s=s[:pos]+group+s[pos:]
        s=s.replace('base[base[gp->u.venom.xC8 + 14] + 170]','grVe_803E5530[base[gp->u.venom.xC8 + 14] + 48]').replace('base[base[gp->u.venom.xC8 + 11] + 0x7A]','grVe_803E5530[base[gp->u.venom.xC8 + 11]]').replace('base[idx0 + 0xD6]','grVe_803E56A0[idx0]')
        return s
    edit('src/melee/gr/grvenom.c',venom_layout)
    edit('src/melee/mn/mncharsel.c',css_layout)
    edit('src/melee/mn/mncharsel.c',lambda s:s.replace('void mnCharSel_Scene_OnFrame(void)\n{','extern int direct_skip_css(void);\nvoid mnCharSel_Scene_OnFrame(void)\n{\n    if(direct_skip_css())mnCharSel_804D6CF6=1;'))
    edit('src/melee/mn/mnstagesel.c',lambda s:s.replace('void mnStageSel_Scene_OnEnter(void* arg0)\n{','extern int direct_forced_stage(void);\nvoid mnStageSel_Scene_OnEnter(void* arg0)\n{\n    int forced=direct_forced_stage();if(forced>=0)((SSSData*)arg0)->force_stage_id=forced;'))
    for p in (src/'src').rglob('*.c'):
        text=p.read_text()
        if '_ReturnAddress()' in text:p.write_text(text.replace('_ReturnAddress()', 'NULL /* host stack address is diagnostic-only */'))
    edit('pc/src/game_swap.c',lambda s:s+'''
void direct_swap_visibility(FtPartsVisLookup* lookup,int count){
 if(!lookup||!pc_swap_once(lookup))return;
 for(int m=0;m<count;m++){pc_swap32(&lookup[m].x0);TempS* t=lookup[m].x4;
 if(t&&pc_swap_once(t))for(int j=0;j<lookup[m].x0;j++)pc_swap32(&t[j].x0);}
}
''')
    edit('src/melee/ft/kinds/ftGameWatch/ftgamewatch.c',lambda s:s.replace('fp->x5AC.xC[4] = items[10];','extern void direct_swap_visibility(FtPartsVisLookup*,int);direct_swap_visibility(items[10],fp->x5AC.model_num);\n        fp->x5AC.xC[4] = items[10];'))
    edit('pc/src/game_swap.c',lambda s:s+'''
void direct_swap_gw_item(void* p){if(p&&pc_swap_once(p)){pc_swap16(p);pc_swap16((u8*)p+8);}}
''')
    edit('src/melee/it/itzako.c',lambda s:s.replace('item->xDD4_itemVar.gamewatch.attr = arg_attr_address;','extern void direct_swap_gw_item(void*);direct_swap_gw_item(arg_attr_address);\n    item->xDD4_itemVar.gamewatch.attr = arg_attr_address;'))
    edit('src/melee/ft/ft_0899.c',lambda s:s.replace('((volatile f32*) &sp1C)[-1] = (f32) ((f64) line_len * guess);\n                line_len = ((volatile f32*) &sp1C)[-1];','line_len = (f32) ((f64) line_len * guess);'))
    edit('src/melee/gm/gm_1AED.c',lambda s:s.replace('void gm_Scene_MemCard_OnFrame(void)\n{','void gm_Scene_MemCard_OnFrame(void)\n{\n    if(gm_80480DA8.unk14==5||gm_80480DA8.unk14==7){gm_80480DA8.unk1C=0;for(int p=0;p<4;p++)HSD_PadCopyStatus[p].trigger|=HSD_PAD_A;}'))
    edit('src/melee/lb/lbvector.c',lambda s:s.replace('Mtx projMtx;', 'Mtx44 projMtx;'))
    edit('src/melee/gm/gm_16AE.c',lambda s:s.replace('void fn_8016D8AC(int arg0, struct PlayerInitData* arg1)\n{','extern void direct_player_init(int,struct PlayerInitData*);\nvoid fn_8016D8AC(int arg0, struct PlayerInitData* arg1)\n{\n    direct_player_init(arg0,arg1);'))
    edit('src/melee/mn/mnmain.c',lambda s:s.replace('void mnMain_Scene_OnEnter(void* user_data)\n{','extern void direct_menu_enter(void*);\nvoid mnMain_Scene_OnEnter(void* user_data)\n{\n    direct_menu_enter(user_data);'))
    edit('src/melee/if/ifstock.c',lambda s:s.replace('static struct ifStock_804A1378 ifStock_804A1378;','struct ifStock_804A1378 ifStock_804A1378;'))
    def present_hook(s,name,line):
        # A declaration in the owning unit avoids changing any game types.
        pattern=r'(\b'+name+r'\([^;{}]*\)\s*\{)'
        s,n=re.subn(pattern,lambda m:m[0]+'\n'+line,s,count=1)
        if n!=1:raise ValueError('Missing presentation hook '+name)
        return 'extern unsigned direct_present_hook(unsigned,unsigned,unsigned);\n'+s
    edit('src/sysdolphin/baselib/jobj.c',lambda s:present_hook(s,'HSD_JObjDispAll','vmtx=(MtxPtr)direct_present_hook(0,(unsigned)jobj,(unsigned)vmtx);'))
    edit('src/melee/if/ifstock.c',lambda s:present_hook(s,'fn_802F94E0','direct_present_hook(1,(unsigned)gobj,0);'))
    edit('src/melee/if/ifstatus.c',lambda s:present_hook(s,'ifStatus_802F5E50','direct_present_hook(2,(unsigned)gobj,0);'))
    edit('src/melee/gm/gmresultplayer.c',lambda s:s.replace('fn_80179350_update(data, match_end, arg0);','fn_80179350_update(data, match_end, arg0);\n    direct_present_hook(3,(unsigned)arg0,0);'))
    edit('src/melee/gm/gm_1798.c',lambda s:present_hook(present_hook(present_hook(present_hook(s,'fn_80179D3C','direct_present_hook(4,(unsigned)gobj,0);'),'fn_80179D60','direct_present_hook(4,(unsigned)gobj,1);'),'fn_80179D84','direct_present_hook(4,(unsigned)gobj,2);'),'fn_80179DA8','direct_present_hook(4,(unsigned)gobj,3);'))
    edit('pc/src/hsd_swap.c',lambda s:s.replace('    /* pedesc is all bytes; renderdesc is not read by the loader */','''    /* OSUI is our own extended descriptor; ordinary disc materials have no extension. */
    u32* ui=(u32*)desc;
    if(ui[6]==0x4955534f){
        pc_swap32(&ui[6]);pc_swap32(&ui[7]);
        if(ui[7]>=5&&ui[7]<=8){
            for(int n=13;n<=18;n++)pc_swap32(&ui[n]);
            pc_swap_imagedesc((HSD_ImageDesc*)ui[8]);
            pc_swap_pobjdesc((HSD_PObjDesc*)ui[9]);
            pc_swap_pobjdesc((HSD_PObjDesc*)ui[10]);
            pc_swap_imagedesc((HSD_ImageDesc*)ui[11]);
            if(ui[7]>=6){pc_swap_imagedesc((HSD_ImageDesc*)ui[19]);pc_swap_imagedesc((HSD_ImageDesc*)ui[20]);}
        }
    }
    /* pedesc is all bytes; renderdesc is not read by the loader */'''))
    edit('src/sysdolphin/baselib/pobj.c',lambda s:function(s.replace('pobj->next = HSD_PObjLoadDesc(desc->next);','pobj->next = NULL;'),'HSD_PObjLoadDesc','''HSD_PObj* root=NULL;HSD_PObj** tail=&root;
 for(;pobjdesc;pobjdesc=pobjdesc->next){HSD_PObj* pobj;HSD_ClassInfo* info;
 if(!pobjdesc->class_name||!(info=hsdSearchClassInfo(pobjdesc->class_name)))pobj=HSD_PObjAlloc();
 else {pobj=hsdNew(info);HSD_ASSERT(605,pobj);}
 HSD_POBJ_METHOD(pobj)->load(pobj,pobjdesc);*tail=pobj;tail=&pobj->next;
 }return root;'''))
    edit('src/melee/ft/ftdata.c',lambda s:s.replace('temp_r4_2 < 0x80000000','temp_r4_2 < 0x02000000'))
    def around(s,name,args,before,after):
        pattern=r'(?m)^(?:static )?void '+name+r'\([^;{}]*\)\s*\{'
        m=re.search(pattern,s)
        if not m:raise ValueError('Missing wrapper '+name)
        signature=m[0][:-1].strip();replacement=m[0].replace(name,'direct_original_'+name)
        s=s[:m.start()]+replacement+s[m.end():]
        return 'extern unsigned direct_present_hook(unsigned,unsigned,unsigned);\n'+s+'\n'+signature+'{\n'+before+'\n direct_original_'+name+'('+args+');\n'+after+'\n}\n'
    edit('src/melee/mn/mncharsel.c',lambda s:present_hook(s,'mnCharSel_802640A0','direct_present_hook(9,0,0);'))
    edit('src/melee/mn/mncharsel.c',lambda s:around(s,'mnCharSel_Scene_OnExit','unused','direct_present_hook(10,0,0);','direct_present_hook(11,0,0);'))
    edit('src/melee/mn/mncharsel.c',lambda s:around(s,'mnCharSel_CursorThink','gobj','direct_present_hook(13,(unsigned)gobj,0);','direct_present_hook(14,0,0);'))
    edit('src/melee/mn/mncharsel.c',lambda s:present_hook(s,'mnCharSel_8025D5AC','direct_present_hook(12,door,0);'))
    edit('src/melee/mn/mncharsel.c',lambda s:'extern const char* direct_css_name(unsigned,unsigned);\n'+s.replace('gm_80160980((direct_css.v_b)[sel_icon].char_kind)','direct_css_name((direct_css.v_b)[sel_icon].char_kind,arg0)'))
    edit('src/sysdolphin/baselib/gobj.c',lambda s:around(s,'HSD_GObj_JObjCallback','gobj,arg1','direct_present_hook(7,(unsigned)gobj,0);','direct_present_hook(8,0,0);'))
    edit('src/melee/it/kinds/itlinkarrow.c',lambda s:around(s,'it_802A7D8C','gobj,arg1','direct_present_hook(5,(unsigned)gobj,0);','direct_present_hook(6,0,0);'))
    edit('src/melee/ef/efasync.c',lambda s:'extern void direct_flash(unsigned,unsigned,unsigned);\n'+s.replace('    case 0x3F3:\n', '    case 0x3F3:\n        direct_flash(gfx_id,(unsigned)gobj,0);\n').replace('    case 0x3FE:\n','    case 0x3FE:\n        direct_flash(gfx_id,(unsigned)gobj,0);\n').replace('ret_obj = efLib_CreateGenerator(0xB, va_arg(vlist, Vec3*));','ret_obj = efLib_CreateGenerator(0xB, va_arg(vlist, Vec3*));\n        direct_flash(gfx_id,0,(unsigned)ret_obj);').replace('efLib_CreateGenerator_Translate_FacingDir(0x107, &translate,\n                                                            f32_1);','efLib_CreateGenerator_Translate_FacingDir(0x107, &translate,\n                                                            f32_1);\n        direct_flash(gfx_id,0,(unsigned)ret_obj);'))
    edit('src/melee/it/itdraw.c',lambda s:around(s,'it_8026EECC','gobj,arg1','direct_present_hook(5,(unsigned)gobj,0);','direct_present_hook(6,0,0);'))
    edit('src/melee/lb/lbaudio_ax.c',lambda s:'extern void direct_css_announce(unsigned,unsigned);\n'+present_hook(s,'lbAudioAx_80023870','direct_css_announce(id,track);'))
    edit('src/sysdolphin/baselib/synth.c',lambda s:'extern unsigned direct_voice(unsigned,unsigned,float*,float*);\n'+present_hook(s,'HSD_SynthSFXPlayWithGroup','sfx_id=direct_voice(sfx_id,group,&pitch1,&pitch2);'))
    edit('src/melee/gm/gm_16AE.c',lambda s:present_hook(s,'gm_Scene_Vs_OnFrame','direct_present_hook(20,0,0);'))
    edit('src/melee/gm/gmvsmode.c',lambda s:present_hook(s,'onEnterVs','direct_present_hook(15,(unsigned)state,0);'))
    edit('src/melee/gm/gm_1A3F.c',lambda s:'extern unsigned direct_present_hook(unsigned,unsigned,unsigned);\n'+s.replace('    info = &state->info;','    direct_present_hook(17,(unsigned)state,0);\n    extern unsigned direct_scene_kind_value;direct_scene_kind_value=state->info.scene_kind;\n    info = &state->info;'))
    edit('src/melee/gm/gm_1832.c',lambda s:'#include "pc_endian.h"\n'+s.replace('lbArchive_80016DBC("GmIntEz.dat", &lbl_804D6604, "gmIntroEasyTable", 0);','lbArchive_80016DBC("GmIntEz.dat", &lbl_804D6604, "gmIntroEasyTable", 0);\n    if(pc_swap_once(lbl_804D6604))pc_swap32_range(lbl_804D6604,sizeof(*lbl_804D6604));'))
    edit('src/melee/gm/gm_1832.c',lambda s:present_hook(s,'gm_Scene_IntroEasy_OnFrame','direct_present_hook(18,0,0);'))
    edit('src/melee/gm/gm_1832.c',lambda s:'extern int direct_intro_animation(unsigned);\n'+present_hook(s,'fn_80184AB8','if(!direct_intro_animation((unsigned)arg0))return;'))
    edit('src/sysdolphin/baselib/gobj.c',lambda s:present_hook(s,'HSD_GObj_803910D8','direct_present_hook(16,(unsigned)gobj,0);'))
    edit('src/melee/gm/gm_1601.c',lambda s:'extern void direct_intro_name(unsigned,unsigned);\n'+present_hook(s,'fn_80160DE8','direct_intro_name((unsigned)arg0,arg1);'))
    edit('src/melee/gm/gm_1601.c',lambda s:'extern unsigned direct_intro_announce(unsigned);\n'+present_hook(s,'gm_80168C5C','arg0=direct_intro_announce(arg0);if(arg0==~0u)return;'))
    edit('src/melee/lb/lbaudio_ax.c',lambda s:'extern int direct_intro_track(unsigned);\n'+present_hook(s,'lbAudioAx_800243F4','int direct_result=direct_intro_track(id);if(direct_result!=-2)return direct_result;'))
    edit('src/melee/gm/gm_1601.c',lambda s:'extern unsigned direct_intro_banks(void);\n'+s.replace('lbAudioAx_8002702C(2, 0x20);','lbAudioAx_8002702C(2, direct_intro_banks());'))
    edit('pc/src/pc_gl.h',lambda s:s.replace('#define pc_glUseProgram glUseProgram','void direct_use_program(GLuint);\n#define pc_glUseProgram direct_use_program'))
    def point_shader(s):
        s=s.replace('uniform mat4 u_proj;\\n','uniform mat4 u_proj;\\nuniform float directPointSize;\\n')
        return re.sub(r'("void main\(\) \{\\n"\s*)("    vec4 (?:ip|p) =)',lambda m:m[1]+'" gl_PointSize=directPointSize;\\n"\n'+m[2],s)
    edit('pc/src/gx_render.c',point_shader)
    edit('src/melee/ft/ftdata.c',lambda s:s.replace('(ftData_UnkCountStruct*) &CostumeListsForeachCharacter[FTKIND_MAX]','ftData_Table_Unk0').replace('(ftData_UnkCountStruct*) ((u8*) CostumeListsForeachCharacter + 5940)','ftData_UnkIntPairs').replace('((ft_8045993C_t*) &list[FTKIND_MAX])[i]','ft_8045993C[i]'))
    edit('src/sysdolphin/baselib/pobj.c',lambda s:present_hook(s,'PObjSetupMtx','extern int direct_skin(HSD_PObj*,MtxPtr,MtxPtr);if(direct_skin(pobj,vmtx,NULL))return;'))
    edit('src/melee/ft/ftparts.c',lambda s:s.replace('void ftPartsSetupEnvelopeMtx(HSD_PObj* pobj, MtxPtr vmtx, MtxPtr pmtx,','extern int direct_skin(HSD_PObj*,MtxPtr,MtxPtr);\nvoid ftPartsSetupEnvelopeMtx(HSD_PObj* pobj, MtxPtr vmtx, MtxPtr pmtx,').replace('    HSD_JObj* jobj;           // r23','    if(direct_skin(pobj,vmtx,ft_jobj_scale.has_z_scale?ft_jobj_scale.mtx:NULL))return;\n    HSD_JObj* jobj;           // r23'))
    edit('src/melee/gm/gm_1832.c',lambda s:present_hook(s.replace('Mtx sp1C;','Mtx44 sp1C;'),'fn_8018575C','direct_present_hook(16,(unsigned)gobj,0);'))
    edit('src/sysdolphin/baselib/hsd_3A76.c',lambda s:s.replace('Mtx projection_m;','Mtx44 projection_m;'))
    edit('src/melee/it/it_2725.c',lambda s:s.replace('desc->x4_matanim_joint, desc->x8_parameters);','(uintptr_t)desc->x4_matanim_joint==UINT32_MAX?NULL:desc->x4_matanim_joint, (uintptr_t)desc->x8_parameters==UINT32_MAX?NULL:desc->x8_parameters);'))
    edit('src/melee/cm/camera.c',lambda s:s.replace('data->desc.', 'cm_803BCB64.'))
    edit('src/melee/gm/gm_1A3F.c',lambda s:s.replace('#include "gm_1A3F.h"', '#include "gm_1A3F.h"\nextern int direct_route(int);\nextern void direct_mode_loaded(int);').replace('    state_machine.routing.pending_mode = pending_mode;\n    state_machine.pending_mode_change = true;', '    state_machine.routing.pending_mode = direct_route(pending_mode);\n    state_machine.pending_mode_change = true;').replace('    while (!sm->pending_mode_change) {', '    direct_mode_loaded(mode_kind);\n    while (!sm->pending_mode_change) {'))
    # Classic round zero addresses the byte immediately before its order array.
    # Name the containing intro field instead of forming an out-of-bounds index.
    edit('src/melee/gm/gmclassic.c',lambda s:s.replace('temp_r28 = gm_804908A0[idx_val];','temp_r28 = idx_val == -1 ? pc_classic_runtime.intro.x1F : gm_804908A0[idx_val];').replace('gm_804908A0[idx] = 2;','if(idx == -1)pc_classic_runtime.intro.x1F=2;else gm_804908A0[idx] = 2;').replace('gm_804908A0[idx] = 1;','if(idx == -1)pc_classic_runtime.intro.x1F=1;else gm_804908A0[idx] = 1;'))
    # The matching source indexes across separately declared name-width tables.
    # Native globals have no guaranteed adjacency.
    edit('src/melee/gm/gm_1601.c',lambda s:s.replace('lbl_803B75F8[tmp_ckind + 0x63]','lbl_803B7784[tmp_ckind]').replace('lbl_803B75F8[tmp_ckind + 0x21]','lbl_803B767C[tmp_ckind]').replace('lbl_803B75F8[tmp_ckind + 0x42]','lbl_803B7700[tmp_ckind]'))
    # Long stage display-object lists must not consume one WASM call stack per node.
    edit('src/sysdolphin/baselib/dobj.c',lambda s:function(s.replace('dobj->next = HSD_DObjLoadDesc(desc->next);','dobj->next = NULL;'),'HSD_DObjLoadDesc','''HSD_DObj* root=NULL;HSD_DObj** tail=&root;
 for(;desc;desc=desc->next){HSD_DObj* dobj;HSD_ClassInfo* info;
 if(!desc->class_name||!(info=hsdSearchClassInfo(desc->class_name)))dobj=HSD_DObjAlloc();
 else {dobj=HSD_DOBJ(hsdNew(info));HSD_ASSERT(378,dobj);}
 HSD_DOBJ_METHOD(dobj)->load(dobj,desc);*tail=dobj;tail=&dobj->next;
 }return root;'''))
    # ResultsDisplayLayout described four consecutive console globals. Keep their
    # native objects separate and address each by name, including portrait state.
    def results_layout(s):
        s=s.replace('ResultsDisplayLayout* disp = (ResultsDisplayLayout*) &lbl_8046E1B0;', 'ResultsDisplayData* disp = &lbl_8046E1B0;').replace('disp->state','lbl_8046E3AC').replace('disp->gobjs','lbl_8046E38C').replace('disp->jobjs','lbl_8046E39C')
        # Packed words in the original binary encode high halfword first.
        for field,constant in [('dim_w1','lbl_804D3FD0'),('dim_h1','lbl_804D3FD8'),('dim_w2','lbl_804D3FE0'),('dim_h2','lbl_804D3FE8'),('scissor_y','lbl_804D3FF0'),('scissor_x','lbl_804D3FF8')]:
            s=s.replace('*(U32Pair*) lbl_8046E3AC.'+field+' = '+constant+';', 'for(int k=0;k<4;k++)lbl_8046E3AC.'+field+'[k]=((u32*)&'+constant+')[k/2] >> (k%2?0:16);')
        for field,constant in [('score_tbl','gmResultScoreTableInit'),('x22F4','gmResultX22F4Init')]:
            s=s.replace('lbl_8046E3AC.'+field+'[i] = ((PackedS16x4*) '+constant+')[i];','for(int k=0;k<4;k++)lbl_8046E3AC.'+field+'[i].h[k]='+constant+'[i*2+k/2] >> (k%2?0:16);')
        return s
    edit('src/melee/gm/gm_1798.c',results_layout)
    # Debug KO injection must never follow freed fighter pointers into CSS/results.
    edit('src/melee/pl/player.c',lambda s:present_hook(s,'pc_debug_kill_fighter','extern unsigned direct_scene_kind_value;if(direct_scene_kind_value!=2)return;'))
    from direct_c_globals import generate
    generate(src,UP,PORT)
    return src

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--jobs',type=int,default=4);ap.add_argument('--dol',type=Path,required=True);ap.add_argument('--prepare-only',action='store_true');a=ap.parse_args()
    src=prepare(); inc=OUT/'include';subprocess.run(['python3',str(ROOT/'tools/extract_browser_fonts.py'),'--dol',str(a.dol),'--out',str(inc/'sysdolphin/baselib')],check=True)
    if a.prepare_only:return
    files=sorted((src/'src/melee').rglob('*.c'))+sorted((src/'src/sysdolphin/baselib').glob('*.c'))
    files=[p for p in files if p.name!='ftCo_BuryWait.c']
    files+=list((src/'pc/src').glob('*.c'))+list((src/'pc/generated').glob('*.c'))+[src/'extern/dolphin/src/dolphin'/p for p in ['os/OSAlloc.c','pad/PadClamp.c','mtx/mtx44.c']]
    includes=[PORT/'include',src/'pc/include',src/'pc/src',src/'src',src/'extern/dolphin/include',inc,ROOT/'runtime/mods']
    flags=['-std=gnu11','-fms-extensions','-fno-strict-aliasing','-ffp-contract=off','-ftrivial-auto-var-init=zero','-DTARGET_PC=1','-DVERSION_GALE01','-DBUILD_VERSION=2','-include',str(src/'pc/include/pc_platform.h'),'-Wno-error=incompatible-function-pointer-types','-Wno-error=return-mismatch','-Wno-incompatible-pointer-types','-Wno-int-conversion','-Wno-implicit-function-declaration','-Wno-return-type','-Wno-unknown-pragmas','-Wno-deprecated-non-prototype','-Wno-pointer-sign']+['-I'+str(p) for p in includes]
    env=dict(os.environ,EM_CONFIG=str(SDK/'.emscripten'))
    headers=hashlib.sha256(b''.join(p.read_bytes() for d in includes for p in sorted(d.rglob('*.h')))).hexdigest()
    def compile(p):
        obj=OUT/'objects'/p.relative_to(src).with_suffix('.o');obj.parent.mkdir(parents=True,exist_ok=True)
        extra=['-O2' if '/pc/' in str(p) else '-O0','-g']
        if re.search(r'(?m)^(?!static)(?:[\w*]+ )*inline ',p.read_text()):extra+=['-fgnu89-inline']
        if p.name=='verify.c':extra+=['-I'+str(src/'pc/src/hash')]
        if p.name=='gmmain.c':extra+=['-Dmain=melee_main']
        digest=hashlib.sha256(p.read_bytes()+repr(flags+extra).encode()+headers.encode()).hexdigest();cache=obj.with_suffix('.sha256')
        if obj.exists() and cache.exists() and cache.read_text()==digest:return obj
        r=subprocess.run([str(SDK/'upstream/emscripten/emcc'),*flags,*extra,'-c',str(p),'-o',str(obj)],capture_output=True,text=True,env=env)
        obj.with_suffix('.log').write_text(r.stderr)
        if r.returncode:return (str(p),r.stderr[-4000:])
        cache.write_text(digest);return obj
    with concurrent.futures.ThreadPoolExecutor(max_workers=a.jobs) as pool:results=list(pool.map(compile,files))
    errors=[r for r in results if isinstance(r,tuple)]
    if errors:
        (OUT/'errors.json').write_text(json.dumps(errors,indent=2));print(json.dumps(errors[:8],indent=2));raise SystemExit(f'{len(errors)} compile failures')
    rsp=OUT/'objects.rsp';rsp.write_text('\n'.join(str(r) for r in results))
    args=['-Wl,--error-limit=0','-O1','-g','-sMODULARIZE=1','-sEXPORT_ES6=1','-sEXPORT_NAME=createDirectMelee','-sENVIRONMENT=web,worker,node','-sALLOW_MEMORY_GROWTH=1','-sINITIAL_MEMORY=134217728','-sSTACK_SIZE=4194304','-sGLOBAL_BASE=33554432','-sASYNCIFY=1','-sASYNCIFY_STACK_SIZE=1048576','-sEMULATE_FUNCTION_POINTER_CASTS=1','-sOFFSCREENCANVAS_SUPPORT=1','-sFULL_ES2=1','-sFULL_ES3=1','-sMIN_WEBGL_VERSION=2','-sMAX_WEBGL_VERSION=2','-sEXIT_RUNTIME=1','-sFORCE_FILESYSTEM=1','-sEXPORTED_RUNTIME_METHODS=["FS","callMain","ENV"]','-sEXPORTED_FUNCTIONS=["_main","_direct_verify_disc","_direct_audio_tempo","_direct_set_pad","_direct_configure","_direct_snapshot","_direct_scene","_direct_scene_kind","_direct_frame_count","_opensmash_intro_state","_opensmash_finish_intro_preparation","_opensmash_preparation_state","_opensmash_finish_preparation"]','-lnodefs.js','-lworkerfs.js','-lidbfs.js']
    staging=OUT/'link-staging';staging.mkdir(exist_ok=True)
    r=subprocess.run([str(SDK/'upstream/emscripten/emcc'),'@'+str(rsp),*args,'-o',str(staging/'melee-direct.mjs')],env=env,capture_output=True,text=True)
    (OUT/'link.log').write_text(r.stdout+r.stderr)
    if r.returncode:raise SystemExit(r.stderr[-8000:])
    audio_exports=['_audio_'+name for name in ['create','input','output','speed','write','read','available']]
    subprocess.run([str(SDK/'upstream/emscripten/emcc'),str(PORT/'audio/playback.c'),str(PORT/'vendor/sonic/sonic.c'),'-I'+str(PORT/'vendor/sonic'),'-O2','-sSTANDALONE_WASM=1','-sFILESYSTEM=0','-sINITIAL_MEMORY=2097152','-sSTACK_SIZE=65536','-sALLOW_MEMORY_GROWTH=0','-sMALLOC=emmalloc','-sABORTING_MALLOC=0','--no-entry','-sEXPORTED_FUNCTIONS='+json.dumps(audio_exports),'-o',str(staging/'melee-audio.wasm')],env=env,check=True)
    for name in ['melee-direct.wasm','melee-direct.mjs','melee-audio.wasm']:os.replace(staging/name,OUT/name)
    (OUT/'errors.json').unlink(missing_ok=True)
    digest=hashlib.sha256()
    inputs=[Path(__file__),Path(__file__).with_name('direct_c_globals.py'),*(PORT/'src').glob('*.c'),*(PORT/'audio').glob('*.c'),*(PORT/'vendor').rglob('*.[ch]'),*(PORT/'include').glob('*.h'),*(ROOT/'runtime/mods').glob('*.h')]
    for p in sorted(inputs):digest.update(str(p.relative_to(ROOT)).encode());digest.update(p.read_bytes())
    wasm=OUT/'melee-direct.wasm'
    audio_wasm=OUT/'melee-audio.wasm'
    manifest=dict(audioWasmSha256=hashlib.sha256(audio_wasm.read_bytes()).hexdigest(),audioWasmBytes=audio_wasm.stat().st_size,backend='direct-c',upstream=json.loads((PORT/'upstream.json').read_text()),wasmSha256=hashlib.sha256(wasm.read_bytes()).hexdigest(),wasmBytes=wasm.stat().st_size,patchSha256=digest.hexdigest(),gameOptimization='O0',runtimeOptimization='O2',resolution=[960,720],sonicRevision='b93885dcb70aae50c6f76b0fe4e0868f029a077e')
    temporary=OUT/'manifest.tmp';temporary.write_text(json.dumps(manifest,indent=2)+'\n');os.replace(temporary,OUT/'melee-direct-build.json')
    print('Built',OUT/'melee-direct.mjs')
if __name__=='__main__':main()
