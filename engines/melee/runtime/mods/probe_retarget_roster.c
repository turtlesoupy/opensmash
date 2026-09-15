/* Read-only actor telemetry for the exploratory roster sweep; never shipped. */
#include "moderngekko/mod_abi.h"
#include <stdio.h>
#include <string.h>
static unsigned frames;
static unsigned read32(CPUState* s,unsigned p){return moderngekko_mod_read(s,p,4);}
static float readf(CPUState* s,unsigned p){unsigned u=read32(s,p);float f;memcpy(&f,&u,4);return f;}
static void frame(CPUState* s){(void)s;frames++;if(frames%60==0)fprintf(stderr,"[probe-frame] %u\n",frames);}
static void actor(CPUState* s){
 if(frames%60)return;
 unsigned fp=read32(s,s->gpr[3]+0x2c),port=moderngekko_mod_read(s,fp+0xc,1);
 if(frames==360){
  unsigned count=read32(s,fp+0x5ec),list=read32(s,fp+0x5f0);
  fprintf(stderr,"[probe-dobjs] port=%u count=%u flags=",port,count);
  for(unsigned i=0;i<count&&i<128;i++){unsigned d=read32(s,list+4*i);fprintf(stderr,"%u:%x,",i,read32(s,d+0x14));}
  fprintf(stderr,"\n");
 }
 fprintf(stderr,"[probe-actor] frame=%u port=%u kind=%u actor=%08x motion=%u x=%.3f y=%.3f\n",frames,port,read32(s,fp+4),fp,read32(s,fp+0x10),readf(s,fp+0xb0),readf(s,fp+0xb4));
}
static const ModernGekkoModHook hooks[]={RECOMP_HOOK(0x8016D800,frame),RECOMP_HOOK(0x8006B82C,actor)};
static const ModernGekkoModDesc descriptor={.abi_version=MODERNGEKKO_MOD_ABI_VERSION,.cpu_abi_version=MODERNGEKKO_CPU_ABI_VERSION,.cpu_state_size=sizeof(CPUState),.game_id="GALE01",.id="opensmash_roster_probe",.version="0.1.0",.display_name="Experimental roster telemetry",.hooks=hooks,.num_hooks=2};
MODERNGEKKO_MOD_EXPORT const ModernGekkoModDesc* moderngekko_get_mod(void){return &descriptor;}
