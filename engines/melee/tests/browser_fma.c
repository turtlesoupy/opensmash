#include "core/cpu.h"
#include "core/browser_fma.h"
#include <stdio.h>
#include <time.h>
extern void reference_ppc_fmadd_op(CPUState*,u8,u8,u8,u8,bool,bool,bool);
static unsigned seed=129;
static unsigned random32(void){seed^=seed<<13;seed^=seed>>17;seed^=seed<<5;return seed;}
static double randomValue(unsigned mode){
 unsigned hi=random32(),lo=random32();
 if(mode==0)return (double)(float)((int)hi/100000.0);
 if(mode==1)return f64_value(convert_to_double(hi));
 return f64_value(((u64)hi<<32)|lo);
}
static double seconds(void){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return t.tv_sec+t.tv_nsec*1e-9;}
int main(void){
 CPUState base={0},a,b;
 for(unsigned i=0;i<120000;i++){
  base.fpscr=random32();
  base.fpr[1]=randomValue(i%3);base.fpr[2]=randomValue(i%3);base.fpr[3]=randomValue(i%3);
  for(unsigned single=0;single<2;single++)for(unsigned sub=0;sub<2;sub++)for(unsigned neg=0;neg<2;neg++){
   a=base;b=base;
   reference_ppc_fmadd_op(&a,0,1,2,3,single,sub,neg);
   ppc_fmadd_op(&b,0,1,2,3,single,sub,neg);
   if(memcmp(&a,&b,sizeof(a))){fprintf(stderr,"FMA CPU mismatch case %u single %u sub %u neg %u\n",i,single,sub,neg);return 1;}
  }
 }
 a=base;b=base;a.fpscr=b.fpscr=0;
 a.fpr[1]=b.fpr[1]=.5;a.fpr[2]=b.fpr[2]=(double)(float).123;a.fpr[3]=b.fpr[3]=1.0;
 double start=seconds();for(unsigned i=0;i<200000;i++)reference_ppc_fmadd_op(&a,0,1,2,3,true,false,false);double generic=seconds()-start;
 start=seconds();for(unsigned i=0;i<200000;i++)ppc_fmadd_op(&b,0,1,2,3,true,false,false);double optimized=seconds()-start;
 printf("{\"cases\":960000,\"fullCpuMatches\":true,\"genericSeconds\":%.6f,\"specializedSeconds\":%.6f,\"speedup\":%.3f}\n",generic,optimized,generic/optimized);
 return 0;
}
