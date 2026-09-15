#include "pc_runtime.h"
#include <dolphin/pad.h>
#include <emscripten.h>
#include <string.h>
#include <stdio.h>
static PADStatus pads[4];static unsigned spec;
EMSCRIPTEN_KEEPALIVE void direct_set_pad(int port,int buttons,int x,int y,int cx,int cy,int l,int r,int connected){
 if(port<0||port>=4)return;PADStatus* p=&pads[port];memset(p,0,sizeof(*p));
 p->button=buttons;p->stickX=x;p->stickY=y;p->substickX=cx;p->substickY=cy;p->triggerLeft=l;p->triggerRight=r;p->analogA=(buttons&PAD_BUTTON_A)?200:0;p->analogB=(buttons&PAD_BUTTON_B)?200:0;p->err=connected?0:PAD_ERR_NO_CONTROLLER;
}
BOOL PADInit(void){for(int i=0;i<4;i++)pads[i].err=i?PAD_ERR_NO_CONTROLLER:0;return 1;}
void PADSetSpec(u32 s){spec=s;}unsigned long PADGetSpec(void){return spec;}
void PADSetSamplingRate(unsigned long m){}int PADReset(unsigned long m){return 1;}BOOL PADRecalibrate(u32 m){return 1;}BOOL PADSync(void){return 1;}
EM_JS(void,direct_rumble,(int port,int command),{Module.onRumble?.(port,command);});
void PADControlMotor(s32 p,u32 c){direct_rumble(p,c);}void PADControlAllMotors(const u32* c){for(int i=0;i<4;i++)PADControlMotor(i,c[i]);}
int pc_pad_load_keymap(const char* p){return 1;}
static void script(PADStatus* p){
 static struct {unsigned a,b;unsigned short buttons;signed char x,y;} steps[256];static int loaded,n;
 if(!loaded){loaded=1;if(pc_config.input_script){FILE* f=fopen(pc_config.input_script,"r");if(!f){fprintf(stderr,"Cannot open input script\n");pc_exit(2);}char line[256];while(fgets(line,sizeof(line),f)&&n<256){unsigned a,b;int x=0,y=0;char keys[80];if(sscanf(line,"%u %u %79s %d %d",&a,&b,keys,&x,&y)<3)continue;unsigned bits=0;char* t=strtok(keys,"+");while(t){const char* names[]={"LEFT","RIGHT","DOWN","UP","Z","R","L","A","B","X","Y","START"};unsigned values[]={1,2,4,8,16,32,64,256,512,1024,2048,4096};for(int i=0;i<12;i++)if(!strcmp(t,names[i]))bits|=values[i];t=strtok(NULL,"+");}steps[n].a=a;steps[n].b=b;steps[n].buttons=bits;steps[n].x=x;steps[n++].y=y;}fclose(f);}}
 for(int i=0;i<n;i++)if(pc_frame_count>=steps[i].a&&pc_frame_count<=steps[i].b){p->button|=steps[i].buttons;p->stickX=steps[i].x;p->stickY=steps[i].y;}
}
u32 PADRead(PADStatus* out){memcpy(out,pads,sizeof(pads));if(pc_config.input_script)script(out);if(pc_config.autoplay){unsigned t=pc_frame_count%150;if(t<2)out[0].button|=PAD_BUTTON_START;else if(t>=60&&t<62)out[0].button|=PAD_BUTTON_A;}unsigned mask=0;for(int i=0;i<4;i++)if(!out[i].err)mask|=PAD_CHAN0_BIT>>i;return mask;}
BOOL PADIsBarrel(s32 chan){return 0;}
