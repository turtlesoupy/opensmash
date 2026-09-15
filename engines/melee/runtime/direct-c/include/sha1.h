#ifndef DIRECT_SHA1_H
#define DIRECT_SHA1_H
#include <stdint.h>
#include <string.h>
static uint32_t sha1_rot(uint32_t v,unsigned n){return (v<<n)|(v>>(32-n));}
static void direct_sha1(const unsigned char* data,size_t n,unsigned char out[20]){
 uint32_t h[5]={0x67452301,0xefcdab89,0x98badcfe,0x10325476,0xc3d2e1f0};
 size_t blocks=(n+9+63)/64;
 for(size_t b=0;b<blocks;b++){
  unsigned char chunk[64]={0};uint32_t w[80];
  for(size_t j=0;j<64;j++){size_t pos=b*64+j;if(pos<n)chunk[j]=data[pos];else if(pos==n)chunk[j]=0x80;}
  if(b==blocks-1){uint64_t bits=(uint64_t)n*8;for(int j=0;j<8;j++)chunk[63-j]=(unsigned char)(bits>>(j*8));}
  for(int j=0;j<16;j++)w[j]=(uint32_t)chunk[j*4]<<24|(uint32_t)chunk[j*4+1]<<16|(uint32_t)chunk[j*4+2]<<8|chunk[j*4+3];
  for(int j=16;j<80;j++)w[j]=sha1_rot(w[j-3]^w[j-8]^w[j-14]^w[j-16],1);
  uint32_t a=h[0],c=h[2],d=h[3],e=h[4],bb=h[1];
  for(int j=0;j<80;j++){uint32_t f,k;if(j<20){f=(bb&c)|(~bb&d);k=0x5a827999;}else if(j<40){f=bb^c^d;k=0x6ed9eba1;}else if(j<60){f=(bb&c)|(bb&d)|(c&d);k=0x8f1bbcdc;}else{f=bb^c^d;k=0xca62c1d6;}uint32_t t=sha1_rot(a,5)+f+e+k+w[j];e=d;d=c;c=sha1_rot(bb,30);bb=a;a=t;}
  h[0]+=a;h[1]+=bb;h[2]+=c;h[3]+=d;h[4]+=e;
 }
 for(int i=0;i<20;i++)out[i]=(unsigned char)(h[i/4]>>(24-8*(i%4)));
}
#endif
