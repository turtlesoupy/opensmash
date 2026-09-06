/* Adapter state for the unchanged Battleship canonical pose algorithm. */
#include "pose_state.h"
#define OSB5_PLAYER_SLOTS 4
static f32 sShLift[2][3];
static int port_current_scene(void) {return *(u8 *)0x800a4ad0;}
static int port_get_frame_count(void) {return *(u32 *)0x8003b6e8;}
#define getenv(name) ((char *)0)
#define port_log(...) ((void)0)
static void *skin_memcpy(void *out,const void *in,unsigned n) {u8 *d=out;const u8 *s=in;while(n--)*d++=*s++;return out;}
static void *skin_memset(void *out,int v,unsigned n) {u8 *d=out;while(n--)*d++=v;return out;}
#define memcpy skin_memcpy
#define memset skin_memset
static float skin_sqrtf(float x) {float y;__asm__("sqrt.s %0,%1":"=f"(y):"f"(x));return y;}
#define sqrtf skin_sqrtf
static float skin_sinf(float x) {return ((float (*)(float))0x800303f0)(x);}
static float skin_cosf(float x) {return ((float (*)(float))0x80035cd0)(x);}
static float skin_atan2f(float y,float x) {return ((float (*)(float,float))0x8001863c)(y,x);}
#define sinf skin_sinf
#define cosf skin_cosf
#define atan2f skin_atan2f
static float skin_acosf(float x) {return skin_atan2f(skin_sqrtf(1.f-x*x),x);}
#define acosf skin_acosf
static void osb5_dobj_frame(DObj *j,float o[3],float m[3][3]) {
    Frame f;frame(j,&f);memcpy(o,f.o,12);memcpy(m,f.m,36);
}
#include "native_pose.inc"
#undef getenv
#undef port_log
