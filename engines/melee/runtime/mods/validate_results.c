/* Validation only: produce a normal one-stock loss through the blast zone. */
#include "moderngekko/mod_abi.h"
#include <stdio.h>
#include <stdlib.h>
static unsigned frames, results;
static void frame(CPUState* s){(void)s;frames++;}
static void fighter(CPUState* s){
    unsigned fp=moderngekko_mod_read(s,s->gpr[3]+0x2c,4);
    if(frames>180 && frames<240 && moderngekko_mod_read(s,fp+0xc,1)==(getenv("OPENSMASH_REVIEW_WINNER")?1:0))
        moderngekko_mod_write(s,fp+0xb4,0xc3960000,4); /* y=-300; real KO */
}
static void result(CPUState* s){(void)s;if(++results%60==0)fprintf(stderr,"[results-review] frame=%u\n",results);}
static const ModernGekkoModHook hooks[]={RECOMP_HOOK(0x8016D800,frame),RECOMP_HOOK(0x8006B82C,fighter),RECOMP_HOOK_RETURN(0x80179350,result)};
static const ModernGekkoModDesc descriptor={
 .abi_version=MODERNGEKKO_MOD_ABI_VERSION,.cpu_abi_version=MODERNGEKKO_CPU_ABI_VERSION,
 .cpu_state_size=sizeof(CPUState),.game_id="GALE01",.id="opensmash_validate_results",
 .version="1.0.0",.display_name="Results validation only",.hooks=hooks,.num_hooks=3,
};
MODERNGEKKO_MOD_EXPORT const ModernGekkoModDesc* moderngekko_get_mod(void){return &descriptor;}
