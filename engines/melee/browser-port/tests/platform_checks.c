/* Regression checks run against the same linked services as the game. */
#include <dolphin/os.h>
#include <dolphin/pad.h>
#include <dolphin/ar.h>
#include <dolphin/dvd.h>
#include <dolphin/mtx.h>
#include <string.h>
#include "port_platform.h"
#include "port_fifo.h"
extern void* port_input(void);
extern u64 __cvt_dbl_usll(double);
#define CHECK(x) do { if(!(x))OSPanic(__FILE__,__LINE__,"Platform regression: %s",#x); } while(0)
static int sequence,arq_done,alarm_count,dvd_done;
static void dvd_complete(s32 result,DVDFileInfo* file) { CHECK(result==32 && file->cb.state==0);dvd_done++; }
static void second(void* arg) { CHECK(sequence==1);CHECK(arg==(void*)2);sequence=2; }
static void first(void* arg) {
    CHECK(sequence==0);CHECK(arg==(void*)1);
    CHECK(OSDisableInterrupts()==0);sequence=1;port_defer(second,(void*)2);
}
static void arq_complete(ARQRequest* request) { CHECK(request->owner==17);arq_done++; }
static void alarm_complete(OSAlarm* alarm,OSContext* ctx) { CHECK(alarm!=NULL && ctx!=NULL);alarm_count++; }

int port_check_platform(void) {
    OSInit();OSInitAlarm();PADInit();
    void* low=OSGetArenaLo();void* high=OSGetArenaHi();
    void* a=OSAllocFromArenaLo(31,32),*b=OSAllocFromArenaHi(65,64);
    CHECK(a==low && !((u32)a&31) && !((u32)b&63));
    CHECK(OSGetArenaLo()==(u8*)a+31 && OSGetArenaHi()==b);
    CHECK(OSAllocFromArenaLo(0xffffffff,32)==NULL);
    OSInit();CHECK(OSGetArenaLo()==low && OSGetArenaHi()==high);
    sequence=0;int old=OSDisableInterrupts();CHECK(old==1);
    port_defer(first,(void*)1);port_pump();CHECK(sequence==0);
    OSRestoreInterrupts(old);CHECK(sequence==2);
    PADStatus* input=port_input();input[0].button=PAD_BUTTON_A;input[0].stickX=65;input[0].stickY=-31;
    PADStatus read[4];PADRead(read);CHECK(read[0].button==PAD_BUTTON_A && read[0].stickX==65 && read[0].stickY==-31);
    CHECK(read[1].err==PAD_ERR_NO_CONTROLLER && read[3].err==PAD_ERR_NO_CONTROLLER);
    u32 stack[4];ARInit(stack,4);u32 address=ARAlloc(64);CHECK(address==0x4000);
    u8 src[64],dst[64];for(int i=0;i<64;i++)src[i]=(u8)(i*7);memset(dst,0,64);
    ARQRequest request;arq_done=0;
    ARQPostRequest(&request,17,ARQ_TYPE_MRAM_TO_ARAM,1,(u32)src,address,64,arq_complete);
    CHECK(arq_done==0);port_pump();CHECK(arq_done==1);
    ARQPostRequest(&request,17,ARQ_TYPE_ARAM_TO_MRAM,1,address,(u32)dst,64,arq_complete);
    port_pump();CHECK(arq_done==2 && memcmp(src,dst,64)==0);
    u32 freed=0;CHECK(ARFree(&freed)==address && freed==64);
    DVDFileInfo file;int entry=DVDConvertPathToEntrynum("LbRb.dat");CHECK(entry>=0 && DVDFastOpen(entry,&file));
    dvd_done=0;CHECK(DVDReadAsyncPrio(&file,dst,32,0,dvd_complete,2));CHECK(dvd_done==0);
    port_pump();CHECK(dvd_done==1);
    CHECK((((u32)dst[0]<<24)|((u32)dst[1]<<16)|((u32)dst[2]<<8)|dst[3])==file.length);
    CHECK(!DVDReadAsyncPrio(&file,dst,-1,0,dvd_complete,2));CHECK(DVDClose(&file));
    OSCalendarTime date;OSTicksToCalendarTime(0,&date);
    CHECK(date.year==2000 && date.mon==0 && date.mday==1 && date.wday==6);
    OSTicksToCalendarTime(OSSecondsToTicks((s64)86400*60),&date);
    CHECK(date.year==2000 && date.mon==2 && date.mday==1);
    OSAlarm alarm;OSCreateAlarm(&alarm);alarm_count=0;OSSetAlarm(&alarm,0,alarm_complete);
    port_pump();port_pump();CHECK(alarm_count==1);
    OSSetAlarm(&alarm,0,alarm_complete);OSCancelAlarm(&alarm);port_pump();CHECK(alarm_count==1);
    Mtx m;PSMTXTrans(m,2,-3,4);CHECK(m[0][0]==1 && m[1][1]==1 && m[2][2]==1 && m[0][3]==2 && m[1][3]==-3 && m[2][3]==4 && m[0][1]==0 && m[2][1]==0);
    CHECK(__cvt_dbl_usll(65536.75)==65536 && __cvt_dbl_usll(-7.5)==(u64)-7);
    port_fifo_reset();port_fifo_u8(0xAA);port_fifo_u16(0xBBCC);port_fifo_u32(0xDDEEFF00);port_fifo_f32(1.5f);port_fifo_f32(-0.0f);port_fifo_flush();
    return 1;
}
void port_check_aram_bounds(void) {
    ARQRequest request;u8 src[32];ARQPostRequest(&request,0,0,1,(u32)src,16*1024*1024-16,32,NULL);
}
