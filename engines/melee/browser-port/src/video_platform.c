#include <dolphin/vi.h>
#include <dolphin/os.h>

#define HOST(name) __attribute__((import_module("melee_host"), import_name(name)))
HOST("video_config") extern void host_video_config(const GXRenderModeObj* mode);
HOST("retrace") extern void host_retrace(u32 count,void* buffer,int black);
extern void port_pump(void);
static VIRetraceCallback pre_callback,post_callback;
static GXRenderModeObj mode;
static u32 retraces;
static void* framebuffer;
static int black=1;

void VIInit(void) { retraces=0;pre_callback=post_callback=NULL;framebuffer=NULL;black=1; }
VIRetraceCallback VISetPreRetraceCallback(VIRetraceCallback cb) { VIRetraceCallback old=pre_callback;pre_callback=cb;return old; }
VIRetraceCallback VISetPostRetraceCallback(VIRetraceCallback cb) { VIRetraceCallback old=post_callback;post_callback=cb;return old; }
void VIWaitForRetrace(void) {
    host_retrace(retraces+1,framebuffer,black);
    retraces++;
    if(pre_callback)pre_callback(retraces);
    port_pump();
    if(post_callback)post_callback(retraces);
}
void VIConfigure(GXRenderModeObj* rm) { mode=*rm; }
void VIFlush(void) { host_video_config(&mode); }
void VISetNextFrameBuffer(void* buffer) { framebuffer=buffer; }
void VISetBlack(int value) { black=value; }
u32 VIGetRetraceCount(void) { return retraces; }
u32 VIGetNextField(void) { return retraces&1; }
u32 VIGetTvFormat(void) { return mode.viTVmode>>2; }
u32 VIGetDTVStatus(void) { return 0; }
