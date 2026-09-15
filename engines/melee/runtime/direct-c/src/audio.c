/* Keep pitch stable when the video thread briefly falls behind the audio clock. */
#include "pc_runtime.h"
#include "sonic.h"
#include <emscripten.h>
static sonicStream stream;
static float tempo=1;
static int enabled;
EMSCRIPTEN_KEEPALIVE void direct_audio_tempo(float value){
 enabled=1;tempo=fminf(1.08f,fmaxf(.85f,value));
}
EM_JS(void,direct_audio_output,(const short* p,int frames),{Module.onAudio?.(HEAP16.subarray(p>>1,(p>>1)+frames*2),32000);});
void direct_audio(const short* samples,int frames){
 if(!enabled){direct_audio_output(samples,frames);return;}
 if(!stream){stream=sonicCreateStream(32000,2);if(!stream)pc_exit(3);}
 sonicSetSpeed(stream,tempo);
 if(!sonicWriteShortToStream(stream,samples,frames))pc_exit(3);
 short output[2048];int count;
 while((count=sonicReadShortFromStream(stream,output,1024))>0)direct_audio_output(output,count);
}
