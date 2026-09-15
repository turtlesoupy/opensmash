#include "sonic.h"
/* This small independent module runs on the audio consumer, never the game thread. */
static sonicStream stream;
static float input[4096],output[4096];
int audio_create(void){stream=sonicCreateStream(48000,2);return stream!=0;}
float* audio_input(void){return input;}
float* audio_output(void){return output;}
void audio_speed(float speed){sonicSetSpeed(stream,speed);}
int audio_write(int frames){return frames>=0&&frames<=2048&&sonicWriteFloatToStream(stream,input,frames);}
int audio_read(int frames){return sonicReadFloatFromStream(stream,output,frames>2048?2048:frames);}
int audio_available(void){return sonicSamplesAvailable(stream);}
