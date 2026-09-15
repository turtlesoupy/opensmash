/* Validation-only controller stimuli; never packaged in playable clients. */
#include "moderngekko/mod_abi.h"
#include <stdio.h>
#include <stdlib.h>
static unsigned get(CPUState*s,unsigned a,unsigned n){return moderngekko_mod_read(s,a,n);}
static void put(CPUState*s,unsigned a,unsigned v,unsigned n){moderngekko_mod_write(s,a,v,n);}
static void fl(CPUState*s,unsigned a,float v){union{float f;unsigned u;}x={v};put(s,a,x.u,4);}
static void drive(CPUState*s){
 unsigned c=get(s,s->gpr[3]+0x2c,4);if(c<0x80000000||c>=0x81800000||get(s,c+4,1))return;
 unsigned frame=get(s,0x804D6CEC,4),pad=0x804C20BC+8,m=get(s,0x804A0BD0,4);
 /* A fresh Full Boot save has no selected fighter and opens vanilla page 0. */
 if(frame==10 && getenv("OPENSMASH_MODE") && atoi(getenv("OPENSMASH_MODE"))==4){
  fl(s,c+0xc,25.5f);fl(s,c+0x10,2.5f);put(s,pad,0x100,4);
 }
 if(frame==180){
  unsigned data=get(s,0x804D6CB0,4);
  fprintf(stderr,"[css-review] done ports=%u:%u,%u:%u\n",get(s,data+0x70,1),get(s,data+0x73,1),get(s,data+0x94,1),get(s,data+0x97,1));
 }
 if(frame==30||frame==60||frame==150||frame==170){fl(s,c+0xc,(frame==60||frame==170)?25.5f:-27);fl(s,c+0x10,2.5);put(s,pad,0x100,4);fprintf(stderr,"[css-review] arrow frame=%u\n",frame);}
 if(frame==90||frame==120){
  put(s,c+5,1,1);put(s,c+6,0,1);fl(s,c+0xc,-21);fl(s,c+0x10,17);
  put(s,m+5,1,1);put(s,m+6,0,1);fl(s,m+8,-21);fl(s,m+0xc,17);fl(s,m+0x10,-21);fl(s,m+0x14,17);
  put(s,pad,frame==120?0x100:0,4);fprintf(stderr,"[css-review] %s\n",frame==120?"confirm":"hover");
 }
}
static void stage_visit(CPUState*s){(void)s;static unsigned visits;fprintf(stderr,"[css-review] stage visits=%u\n",++visits);}
static const ModernGekkoModHook hooks[]={RECOMP_HOOK(0x802602A0,drive),RECOMP_HOOK(0x8025A998,stage_visit)};
static const ModernGekkoModDesc desc={.abi_version=1,.cpu_abi_version=MODERNGEKKO_CPU_ABI_VERSION,.cpu_state_size=sizeof(CPUState),.game_id="GALE01",.id="aaa_css_review",.version="1.0.0",.display_name="CSS input review",.hooks=hooks,.num_hooks=2};
MODERNGEKKO_MOD_EXPORT const ModernGekkoModDesc* moderngekko_get_mod(void){return &desc;}
