// Differential oracle: original generated PPC versus the specialized routine.
#include "generated.h"
#include "opensmash_concat_reference.h"
#include "opensmash_concat.h"
#include "opensmash_scaled_reference.h"
#include "opensmash_scaled.h"
#ifdef TEST_SCALED
#define reference_concat reference_scaled
#define opensmash_concat opensmash_scaled
#endif
#include <stdlib.h>
#include <time.h>
#include <stdio.h>
static unsigned seed=42;
static unsigned random32(void){seed^=seed<<13;seed^=seed>>17;seed^=seed<<5;return seed;}
static double seconds(void){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return t.tv_sec+t.tv_nsec*1e-9;}
int main(void){
 CPUState reference,fast;
 unsigned fallbacks=0;
 if(!cpu_init(&reference)||!cpu_init(&fast))return 2;
 unsigned char *ramA=reference.ram,*ramB=fast.ram;
 for(unsigned n=0;n<12000;n++){
  CPUState initial={0}; initial.ram=ramA;initial.ram_size=GC_MAIN_RAM_SIZE;
  initial.pc=0x80342204;initial.lr=0x80012340;initial.downcount=1000;
  initial.msr=PPC_MSR_FP;initial.hid2=PPC_HID2_LSQE;initial.gpr[1]=0x80100040;
  for(unsigned j=0;j<32;j++){
   initial.fpr[j]=(double)(int)random32()/100;
   initial.ps1[j]=(double)(int)random32()/100;
  }
  initial.gpr[3]=0x80001000+(n%4);initial.gpr[4]=0x80001100+(n%4);
  initial.gpr[5]=n%3==0?initial.gpr[3]:n%3==1?initial.gpr[4]:0x80001200;
  if(n%7==0)initial.gpr[5]+=4; // partial overlaps retain the exact load/store order
  reference=initial;
  for(unsigned i=0;i<0x400;i++)ramA[0x1000+i]=(unsigned char)random32();
  if(n%3)for(unsigned i=0;i<12;i++){
   float x=(float)(int)random32()/10000000.0f;
   float y=(float)(int)random32()/10000000.0f;
   mem_write32(&reference,initial.gpr[3]+4*i,dolrecomp_f32_to_bits(x));
   mem_write32(&reference,initial.gpr[4]+4*i,dolrecomp_f32_to_bits(y));
  }
  mem_write32(&reference,0x804d5c00,0);mem_write32(&reference,0x804d5c04,0x3f800000);
  memcpy(ramB+0x1000,ramA+0x1000,0x400);
  memcpy(ramB+0x100000,ramA+0x100000,64);
  memcpy(ramB+0x4d5c00,ramA+0x4d5c00,8);
  fast=reference;fast.ram=ramB;
  reference_concat(&reference);
  if(!opensmash_concat(&fast)){fallbacks++;reference_concat(&fast);}
  fast.ram=ramA;
  if(memcmp(&reference,&fast,sizeof(reference))||memcmp(ramA+0x1000,ramB+0x1000,0x400)||memcmp(ramA+0x100000,ramB+0x100000,64)){
   for(unsigned i=0;i<sizeof(reference);i++)if(((unsigned char*)&reference)[i]!=((unsigned char*)&fast)[i]){fprintf(stderr,"CPU mismatch case %u offset %u: %x %x\n",n,i,((unsigned char*)&reference)[i],((unsigned char*)&fast)[i]);break;}
   fprintf(stderr,"differential mismatch case %u\n",n);return 4;
  }
 }
 if(fallbacks>4000)return 6;
 fast.ram=ramB;
 for(unsigned condition=0;condition<4;condition++){
  CPUState before=fast;
  if(condition==0)fast.msr=0;
  if(condition==1)fast.gpr[5]=0xcc008000;
  if(condition==2)fast.gpr[3]=0xcc008000;
  if(condition==3)fast.exception=1;
  CPUState rejected=fast;
  if(opensmash_concat(&fast)||memcmp(&fast,&rejected,sizeof(fast)))return 5;
  fast=before;
 }
 reference.fpr[1]=fast.fpr[1]=.5;
 reference.gpr[3]=fast.gpr[3]=0x80001000;
 reference.gpr[4]=fast.gpr[4]=0x80001100;
 reference.gpr[5]=fast.gpr[5]=0x80001200;
 for(unsigned i=0;i<12;i++){
  mem_write32(&reference,0x80001000+i*4,dolrecomp_f32_to_bits((i%5==0)?1.0f:0.0f));
  mem_write32(&fast,0x80001000+i*4,dolrecomp_f32_to_bits((i%5==0)?1.0f:0.0f));
 }
 double start=seconds();for(unsigned i=0;i<200000;i++)reference_concat(&reference);double generic=seconds()-start;
 start=seconds();for(unsigned i=0;i<200000;i++)opensmash_concat(&fast);double optimized=seconds()-start;
 printf("{\"cases\":12000,\"fullCpuMatches\":true,\"memoryMatches\":true,\"fallbackChecks\":4,\"genericSeconds\":%.6f,\"specializedSeconds\":%.6f,\"speedup\":%.3f}\n",generic,optimized,generic/optimized);
 cpu_free(&reference);cpu_free(&fast);return 0;
}
