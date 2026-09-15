/* Memory transport and voice ownership for the software audio backend. */
#include <dolphin/ar.h>
#include <dolphin/ai.h>
#include <dolphin/ax.h>
#include <dolphin/os.h>
#include <string.h>
#include "port_platform.h"
static void complete_arq(void* arg) { ARQRequest* request=arg;if(request->callback)request->callback(request); }

static u8 aram[16*1024*1024] __attribute__((aligned(32)));
static u32 aram_top=0x4000,*allocations,allocation_count,allocation_capacity;
static u32 sample_rate;
static u8 left_volume,right_volume;
static void (*audio_callback)(void);
extern void __AXAllocInit(void),__AXVPBInit(void),__AXAuxInit(void);

u32 ARInit(u32* stack,u32 count) { allocations=stack;allocation_capacity=count;allocation_count=0;aram_top=0x4000;memset(aram,0,sizeof(aram));return aram_top; }
u32 ARGetSize(void) { return sizeof(aram); }
u32 ARAlloc(u32 length) {
    if(allocation_count>=allocation_capacity || length>sizeof(aram)-aram_top)OSPanic(__FILE__,__LINE__,"Audio RAM exhausted");
    u32 result=aram_top;allocations[allocation_count++]=length;aram_top+=length;return result;
}
u32 ARFree(u32* length) {
    if(!allocation_count)OSPanic(__FILE__,__LINE__,"Audio RAM stack underflow");
    u32 size=allocations[--allocation_count];aram_top-=size;if(length)*length=size;return aram_top;
}
void ARQInit(void) {}
void ARQPostRequest(ARQRequest* request,u32 owner,u32 type,u32 priority,u32 source,u32 destination,u32 length,ARQCallback callback) {
    request->owner=owner;request->type=type;request->priority=priority;request->source=source;request->dest=destination;request->length=length;request->callback=callback;
    u32 offset=type==ARQ_TYPE_MRAM_TO_ARAM?destination:source;
    if(type>1 || offset>sizeof(aram) || length>sizeof(aram)-offset)OSPanic(__FILE__,__LINE__,"Audio RAM request out of bounds: type=%u source=%x destination=%x length=%x",type,source,destination,length);
    if(type==ARQ_TYPE_MRAM_TO_ARAM)memcpy(aram+destination,(void*)source,length);
    else memcpy((void*)destination,aram+source,length);
    if(callback)port_defer(complete_arq,request);
}
void AIInit(u8* stack) { (void)stack;sample_rate=0;left_volume=right_volume=255; }
void AISetDSPSampleRate(u32 rate) { if(rate>1)OSPanic(__FILE__,__LINE__,"Invalid audio rate");sample_rate=rate; }
u32 AIGetDSPSampleRate(void) { return sample_rate; }
void AISetStreamVolLeft(u8 value) { left_volume=value; }
void AISetStreamVolRight(u8 value) { right_volume=value; }
void AXInit(void) { __AXAllocInit();__AXVPBInit();__AXAuxInit();audio_callback=NULL; }
void AXRegisterCallback(void (*callback)(void)) { audio_callback=callback; }

/* The host mixer consumes the original AX voice state and ARAM buffers. */
void* port_aram(void) { return aram; }
void port_audio_callback(void) { if(audio_callback)audio_callback(); }
