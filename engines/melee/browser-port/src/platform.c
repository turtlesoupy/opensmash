/* Browser platform services for the actual game. Unimplemented services remain
 * unresolved in release builds and explicitly trap in the diagnostic host. */
#include <dolphin/os.h>
#include <dolphin/pad.h>
#include <dolphin/dvd.h>
#include <dolphin/card.h>
#include <stdarg.h>
#include "port_platform.h"
#include <string.h>

#define HOST(name) __attribute__((import_module("melee_host"), import_name(name)))
HOST("log") extern void host_log(const char* text);
HOST("time_us") extern double host_time_us(void);
HOST("fatal") extern void host_fatal(const char* text);
HOST("dvd_find") extern int host_dvd_find(const char* path);
HOST("dvd_size") extern int host_dvd_size(int entry);
HOST("dvd_read") extern int host_dvd_read(int entry, void* data, int size, int offset);
HOST("rumble") extern void host_rumble(int port, int command);
HOST("card_probe") extern int host_card_probe(int port);
extern int vsnprintf(char*,size_t,const char*,va_list);

static unsigned char arena[32*1024*1024] __attribute__((aligned(32)));
static unsigned char* arena_lo=arena;
static unsigned char* arena_hi=arena+sizeof(arena);
static int interrupts=1,pumping;
static struct { void (*callback)(void*);void* argument; } completions[256];
static unsigned completion_read,completion_write;
void port_defer(void (*callback)(void*),void* argument) {
    if(completion_write-completion_read==256)OSPanic(__FILE__,__LINE__,"Completion queue overflow");
    unsigned i=completion_write++%256;completions[i].callback=callback;completions[i].argument=argument;
}
static PADStatus inputs[4];
static OSAlarm* alarms[64];
static DVDDiskID disk_id={"GALE","01",0,2};

float port_sqrt(double x) { return (float)__builtin_sqrt(x); }
void port_report_stack(void) { host_log("Wasm stack diagnostics use the browser runtime stack."); }
void OSReport(char* format, ...) {
    char text[4096];va_list args;va_start(args,format);
    vsnprintf(text,sizeof(text),format,args);va_end(args);host_log(text);
}
void OSPanic(char* file,int line,char* format,...) {
    char text[4096];va_list args;va_start(args,format);
    vsnprintf(text,sizeof(text),format,args);va_end(args);
    OSReport("%s:%d: %s",file,line,text);host_fatal(text);__builtin_trap();
}
void OSInit(void) { arena_lo=arena;arena_hi=arena+sizeof(arena);interrupts=1;pumping=0;completion_read=completion_write=0; }
void* OSGetArenaLo(void) { return arena_lo; }
void* OSGetArenaHi(void) { return arena_hi; }
void OSSetArenaLo(void* p) {
    if ((unsigned char*)p<arena || (unsigned char*)p>arena_hi) OSPanic(__FILE__,__LINE__,"Invalid arena lower bound");
    arena_lo=p;
}
void OSSetArenaHi(void* p) {
    if ((unsigned char*)p<arena_lo || (unsigned char*)p>arena+sizeof(arena)) OSPanic(__FILE__,__LINE__,"Invalid arena upper bound");
    arena_hi=p;
}
void* OSAllocFromArenaLo(u32 size,u32 align) {
    if (!align || (align&(align-1))) return NULL;
    u32 p=((u32)arena_lo+align-1)&~(align-1);
    if (p>(u32)arena_hi || size>(u32)arena_hi-p) return NULL;
    arena_lo=(void*)(p+size);return (void*)p;
}
void* OSAllocFromArenaHi(u32 size,u32 align) {
    if (!align || (align&(align-1)) || size>(u32)(arena_hi-arena_lo)) return NULL;
    u32 p=((u32)arena_hi-size)&~(align-1);
    if (p<(u32)arena_lo) return NULL;
    arena_hi=(void*)p;return (void*)p;
}
u32 OSGetPhysicalMemSize(void) { return sizeof(arena); }
u32 OSGetConsoleSimulatedMemSize(void) { return sizeof(arena); }
int OSDisableInterrupts(void) { int old=interrupts;interrupts=0;return old; }
int OSRestoreInterrupts(int enabled) { int old=interrupts;interrupts=enabled;if(enabled)port_pump();return old; }
OSTime OSGetTime(void) { return (OSTime)(host_time_us()*40.5); }
OSTick OSGetTick(void) { return (OSTick)OSGetTime(); }
void DCFlushRange(void* p,u32 size) { (void)p;(void)size; }
void DCStoreRange(void* p,u32 size) { (void)p;(void)size; }
void DCInvalidateRange(void* p,u32 size) { (void)p;(void)size; }

void OSInitAlarm(void) { memset(alarms,0,sizeof(alarms)); }
void OSCreateAlarm(OSAlarm* alarm) { memset(alarm,0,sizeof(*alarm)); }
void OSCancelAlarm(OSAlarm* alarm) {
    for(int i=0;i<64;i++) if(alarms[i]==alarm) alarms[i]=NULL;
    alarm->handler=NULL;
}
static void schedule(OSAlarm* alarm,OSTime fire,OSTime period,OSAlarmHandler handler) {
    OSCancelAlarm(alarm);alarm->fire=fire;alarm->start=fire;alarm->period=period;alarm->handler=handler;
    for(int i=0;i<64;i++) if(!alarms[i]) { alarms[i]=alarm;return; }
    OSPanic(__FILE__,__LINE__,"Alarm capacity exceeded");
}
void OSSetAlarm(OSAlarm* alarm,OSTime ticks,OSAlarmHandler handler) { schedule(alarm,OSGetTime()+ticks,0,handler); }
void OSSetPeriodicAlarm(OSAlarm* alarm,OSTime start,OSTime period,OSAlarmHandler handler) {
    if(period<=0) OSPanic(__FILE__,__LINE__,"Invalid alarm period");
    OSTime now=OSGetTime();if(start<now)start+=((now-start)/period+1)*period;
    schedule(alarm,start,period,handler);
}
void port_pump(void) {
    if(!interrupts || pumping)return;
    pumping=1;
    unsigned budget=1024;
    while(completion_read!=completion_write && budget--) {
        unsigned i=completion_read++%256;
        void (*callback)(void*)=completions[i].callback;void* argument=completions[i].argument;
        interrupts=0;callback(argument);interrupts=1;
    }
    OSTime now=OSGetTime();OSContext context;memset(&context,0,sizeof(context));
    for(int i=0;i<64;i++) {
        OSAlarm* alarm=alarms[i];if(!alarm || alarm->fire>now)continue;
        OSAlarmHandler callback=alarm->handler;
        if(alarm->period)alarm->fire+=((now-alarm->fire)/alarm->period+1)*alarm->period;
        else { alarms[i]=NULL;alarm->handler=NULL; }
        interrupts=0;callback(alarm,&context);interrupts=1;
    }
    pumping=0;
}
void* port_input(void) { return inputs; }
int PADInit(void) { memset(inputs,0,sizeof(inputs));for(int i=1;i<4;i++)inputs[i].err=PAD_ERR_NO_CONTROLLER;return 1; }
u32 PADRead(PADStatus* dst) { memcpy(dst,inputs,sizeof(inputs));return 0; }
int PADReset(u32 mask) { (void)mask;return 1; }
int PADRecalibrate(u32 mask) { (void)mask;return 1; }
void PADSetSpec(u32 spec) { if(spec!=5) OSPanic(__FILE__,__LINE__,"Unsupported PAD spec"); }
void PADSetSamplingRate(u32 rate) { (void)rate; }
void PADControlMotor(s32 port,u32 command) { host_rumble(port,command); }

void DVDInit(void) {}
DVDDiskID* DVDGetCurrentDiskID(void) { return &disk_id; }
int DVDCheckDisk(void) { return 1; }
s32 DVDGetDriveStatus(void) { return 0; }
s32 DVDConvertPathToEntrynum(const char* path) { return host_dvd_find(path); }
int DVDFastOpen(s32 entry,DVDFileInfo* file) {
    int length=host_dvd_size(entry);if(length<0)return 0;
    memset(file,0,sizeof(*file));file->startAddr=entry;file->length=length;return 1;
}
int DVDClose(DVDFileInfo* file) { file->cb.state=0;return 1; }
static void complete_dvd(void* arg) {
    DVDFileInfo* file=arg;
    int result=file->cb.state<0?-1:file->cb.transferredSize;
    file->cb.state=result<0?-1:0;
    if(file->callback)file->callback(result,file);
}
int DVDReadAsyncPrio(DVDFileInfo* file,void* data,s32 length,s32 offset,DVDCallback callback,s32 priority) {
    (void)priority;
    if(length<0 || offset<0 || (u32)offset>file->length || (u32)length>file->length-(u32)offset+31)return 0;
    file->cb.state=1;file->cb.addr=data;file->cb.length=length;file->cb.offset=offset;file->callback=callback;
    int read=host_dvd_read(file->startAddr,data,length,offset);
    file->cb.transferredSize=read>0?read:0;file->cb.currTransferSize=file->cb.transferredSize;file->cb.state=read<0?-1:1;
    port_defer(complete_dvd,file);
    return 1; // The request was accepted; its completion carries any read error.
}

/* Insertion is owned by the host; an absent card is a supported SDK state. */
void CARDInit(void) {}
int CARDProbe(s32 port) { return host_card_probe(port); }
s32 CARDProbeEx(s32 port,s32* size,s32* sector) {
    if(!host_card_probe(port))return CARD_RESULT_NOCARD;
    *size=64;*sector=8192;return CARD_RESULT_READY;
}
int DBIsDebuggerPresent(void) { return 0; }
static OSErrorHandler error_handlers[16];
OSErrorHandler OSSetErrorHandler(OSError kind,OSErrorHandler handler) {
    if(kind>=16)OSPanic(__FILE__,__LINE__,"Invalid error handler");
    OSErrorHandler old=error_handlers[kind];error_handlers[kind]=handler;return old;
}

/* Console preferences live in host-owned persistent settings, matching SRAM. */
HOST("preference_get") extern int host_preference_get(int key,int fallback);
HOST("preference_set") extern void host_preference_set(int key,int value);
unsigned long OSGetSoundMode(void) { return host_preference_get(0,1)&1; }
void OSSetSoundMode(unsigned long mode) { host_preference_set(0,mode&1); }
unsigned long OSGetVideoMode(void) { return host_preference_get(1,0); }
void OSSetVideoMode(unsigned long mode) { if(mode!=0 && mode!=2)OSPanic(__FILE__,__LINE__,"Invalid video mode");host_preference_set(1,mode); }
unsigned char OSGetLanguage(void) { return host_preference_get(2,0); }
void OSSetLanguage(unsigned char language) { host_preference_set(2,language); }
unsigned long OSGetProgressiveMode(void) { return host_preference_get(3,0)&1; }
void OSSetProgressiveMode(u32 mode) { host_preference_set(3,mode&1); }

HOST("reset_code") extern u32 host_reset_code(void);
HOST("reset_button") extern int host_reset_button(void);
HOST("reset") extern void host_reset(int kind,u32 code,int menu);
unsigned long OSGetResetCode(void) { return host_reset_code(); }
int OSGetResetSwitchState(void) { return host_reset_button(); }
void OSResetSystem(int kind,u32 code,int menu) { host_reset(kind,code,menu);__builtin_trap(); }
/* There is one cooperatively scheduled game context. Hardware FPU exception
 * registers do not exist in Wasm; the browser reports Wasm traps directly. */
long OSCheckActiveThreads(void) { return 1; }

/* Metrowerks helper: truncate toward zero, preserve signed two's complement,
 * and saturate at its 63-bit magnitude boundary. */
u64 __cvt_dbl_usll(double x) {
    u64 bits;memcpy(&bits,&x,8);int negative=(int)(bits>>63);
    double magnitude=negative?-x:x;
    if(magnitude<1.0)return 0;
    if(!__builtin_isfinite(magnitude) || magnitude>=9223372036854775808.0)
        return negative?0x8000000000000000ULL:0x7fffffffffffffffULL;
    u64 value=(u64)magnitude;return negative?0-value:value;
}
