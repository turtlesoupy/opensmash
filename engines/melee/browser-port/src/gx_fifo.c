#include "port_fifo.h"
#include "port_platform.h"
#include <__gx.h>
#include <dolphin/gx.h>
#include <dolphin/os.h>
#include <string.h>

__attribute__((import_module("melee_host"), import_name("gx_submit")))
extern void host_gx_submit(const u8* bytes,u32 size);
__attribute__((import_module("melee_host"), import_name("gx_finish")))
extern void host_gx_finish(void);
static u8 fifo[1024*1024];static u32 used;
static GXDrawDoneCallback draw_done;

void port_fifo_reset(void) { used=0;draw_done=NULL; }
void port_fifo_flush(void) { if(used)host_gx_submit(fifo,used);used=0; }
void port_fifo_u8(u8 x) { if(used==sizeof(fifo))port_fifo_flush();fifo[used++]=x; }
void port_fifo_s8(s8 x) { port_fifo_u8((u8)x); }
void port_fifo_u16(u16 x) { port_fifo_u8(x>>8);port_fifo_u8(x); }
void port_fifo_s16(s16 x) { port_fifo_u16((u16)x); }
void port_fifo_u32(u32 x) { port_fifo_u16(x>>16);port_fifo_u16(x); }
void port_fifo_s32(s32 x) { port_fifo_u32((u32)x); }
void port_fifo_f32(f32 x) { u32 raw;memcpy(&raw,&x,4);port_fifo_u32(raw); }
void GXSetMisc(GXMiscToken token,u32 value) {
    if(token==GX_MT_XF_FLUSH) { gx->vNum=value;gx->unk=!value;gx->bpSent=1;if(value)gx->dirtyState|=8; }
    else if(token==GX_MT_DL_SAVE_CONTEXT)gx->dlSaveContext=value>0;
    else if(token!=GX_MT_NULL)OSPanic(__FILE__,__LINE__,"Unknown GX misc token");
}
void GXFlush(void) { if(gx->dirtyState)__GXSetDirtyState();port_fifo_flush(); }
static void complete_draw(void* argument) { ((GXDrawDoneCallback)argument)(); }
void GXSetDrawDone(void) { GXFlush();host_gx_finish();if(draw_done)port_defer(complete_draw,(void*)draw_done); }
void GXWaitDrawDone(void) { GXFlush();host_gx_finish();port_pump(); }
GXDrawDoneCallback GXSetDrawDoneCallback(GXDrawDoneCallback cb) { GXDrawDoneCallback old=draw_done;draw_done=cb;return old; }
void GXCallDisplayList(void* list,u32 size) {
    if(gx->inDispList)OSPanic(__FILE__,__LINE__,"Nested display-list recording is unsupported");
    if(gx->dirtyState)__GXSetDirtyState();
    if(*(u32*)&gx->unk==0)__GXSendFlushPrim();
    port_fifo_u8(0x40);port_fifo_u32((u32)list);port_fifo_u32(size);
}
