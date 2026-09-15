/* Optional native validation mod, never bundled with the playable client.
 * GALE01 1.02 layouts: ft/types.h and cm/types.h in the matching decomp.
 * Keep the real stage lights, fighter animation, materials and GX renderer.
 * Follow P1 with one fixed close camera across costume runs.
 */
#include "moderngekko/mod_abi.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static unsigned frames;
static float focus[3];
static unsigned read32(CPUState* s, unsigned p) { return moderngekko_mod_read(s,p,4); }
static float readf(CPUState* s,unsigned p) { unsigned u=read32(s,p);float f;memcpy(&f,&u,4);return f; }
static void writef(CPUState* s,unsigned p,float f) {
    unsigned u;memcpy(&u,&f,4);moderngekko_mod_write(s,p,u,4);
}
static void stop_joints(CPUState* s,unsigned root,unsigned depth) {
    if(!root)return;
    if(depth>128)abort();
    unsigned aobj=read32(s,root+0x7c);
    if(aobj)writef(s,aobj+0x10,0); /* HSD_AObjSetRate */
    stop_joints(s,read32(s,root+0x10),depth+1);
    stop_joints(s,read32(s,root+8),depth+1);
}
static void frame(CPUState* s) {
    frames++;
    moderngekko_mod_write(s,0x804d6d58,1,1); /* ifAll_HideHUD */
}
static unsigned dump_joint(CPUState* s,unsigned root,int parent,unsigned index) {
    if(!root)return index;
    if(index>=512)abort();
    unsigned current=index++;
    fprintf(stderr,"[pose-joint] %u %d %08x",current,parent,read32(s,root+0x14));
    for(unsigned i=0;i<12;i++)fprintf(stderr," %.9g",readf(s,root+0x44+i*4));
    fputc('\n',stderr);
    index=dump_joint(s,read32(s,root+0x10),(int)current,index);
    return dump_joint(s,read32(s,root+8),parent,index);
}
static void fighter(CPUState* s) {
    unsigned fp=read32(s,s->gpr[3]+0x2c);
    unsigned port=moderngekko_mod_read(s,fp+0xc,1);
    if(port!=0)return;
    /* Read the previous completed display's world matrices before this update.
     * The held pose is stable; this never substitutes synthetic joint poses. */
    static unsigned dumped;
    if(!dumped && frames>=240 && read32(s,fp+0x10)==14) {
        dump_joint(s,read32(s,s->gpr[3]+0x28),-1,0);
        dumped=1;
    }
    /* Hold the first idle pose. Melee evaluates the original animation and
     * skinning; only its playback rate is zero in this isolated validation. */
    if(read32(s,fp+0x10)==14) {
        writef(s,fp+0x89c,0);
        stop_joints(s,read32(s,s->gpr[3]+0x28),0);
        stop_joints(s,read32(s,fp+0x8ac),0);
    }
    for(unsigned i=0;i<3;i++)focus[i]=readf(s,fp+0xb0+i*4);
    static unsigned last;
    if(frames/60!=last) {
        last=frames/60;
        fprintf(stderr,"[shading] frame=%u motion=%u anim_bits=%08x pos=%.3f,%.3f,%.3f\n",frames,read32(s,fp+0x10),read32(s,fp+0x894),focus[0],focus[1],focus[2]);
    }
}
static void camera(CPUState* s) {
    unsigned gobj=read32(s,0x80452c68), cobj=s->gpr[3];
    if(!frames || !gobj || read32(s,gobj+0x28)!=cobj)return;
    unsigned eye=read32(s,cobj+0x24), interest=read32(s,cobj+0x28);
    float e[3]={18,9,28}, t[3]={0,8,0};
    for(unsigned i=0;i<3;i++) {
        writef(s,eye+0xc+i*4,focus[i]+e[i]);
        writef(s,interest+0xc+i*4,focus[i]+t[i]);
    }
    /* Match HSD_WObjSetPosition's dirty flags. */
    moderngekko_mod_write(s,eye+8,(read32(s,eye+8)|2)&~1u,4);
    moderngekko_mod_write(s,interest+8,(read32(s,interest+8)|2)&~1u,4);
    writef(s,cobj+0x40,30);
}
static const ModernGekkoModHook hooks[]={
    RECOMP_HOOK(0x8016D800,frame),
    RECOMP_HOOK(0x8006B82C,fighter),
    RECOMP_HOOK(0x80368458,camera),
};
static void no_magnifier(CPUState* s) {s->pc=s->lr;}
static const ModernGekkoModPatch patches[]={RECOMP_PATCH(0x802FBBDC,no_magnifier)};
static const ModernGekkoModDesc descriptor={
    .abi_version=MODERNGEKKO_MOD_ABI_VERSION,.cpu_abi_version=MODERNGEKKO_CPU_ABI_VERSION,
    .cpu_state_size=sizeof(CPUState),.game_id="GALE01",.id="opensmash_validate_shading",
    .version="0.1.0",.display_name="Shading comparison (validation only)",
    .hooks=hooks,.num_hooks=sizeof(hooks)/sizeof(hooks[0]),
    .patches=patches,.num_patches=1,
};
MODERNGEKKO_MOD_EXPORT const ModernGekkoModDesc* moderngekko_get_mod(void){return &descriptor;}
