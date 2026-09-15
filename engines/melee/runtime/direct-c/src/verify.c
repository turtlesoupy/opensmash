/* Stream the same complete-disc SHA-256 check used by the existing backend. */
#include "hash/sha256.c"
#include <stdio.h>
#include <emscripten.h>
void mbedtls_platform_zeroize(void* buffer,size_t length){volatile unsigned char* p=buffer;while(length--)*p++=0;}
EMSCRIPTEN_KEEPALIVE int direct_verify_disc(void){
 static unsigned char buffer[1024*1024];
 static const char expected[]="0de05981a34156b9cedcef73c73d4244ac05cf6149ab3c9cfed917698819e464";
 FILE* file=fopen("/disc/game.iso","rb");if(!file)return 0;
 mbedtls_sha256_context context;mbedtls_sha256_init(&context);int error=mbedtls_sha256_starts_ret(&context,0);size_t total=0;
 while(!error){size_t n=fread(buffer,1,sizeof(buffer),file);if(!n)break;error=mbedtls_sha256_update_ret(&context,buffer,n);total+=n;if(total%(64*1024*1024)==0)EM_ASM({Module.onVerifyProgress?.($0);},(double)total);}
 if(ferror(file))error=-1;fclose(file);unsigned char hash[32];char hex[65];if(!error)error=mbedtls_sha256_finish_ret(&context,hash);mbedtls_sha256_free(&context);if(error)return 0;
 for(int i=0;i<32;i++)sprintf(hex+i*2,"%02x",hash[i]);return strcmp(hex,expected)==0;
}
