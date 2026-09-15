/* Verify the scene detour never consumes a VS result or loses match settings. */
#undef NDEBUG
#include <assert.h>
#include <string.h>
#include "../runtime/mods/launch_match.c"
static unsigned char ram[24*1024*1024];
static uint64_t rd(CPUState* s,uint32_t p,uint8_t n) {
    (void)s;assert(p>=0x80000000&&p+n<=0x81800000);
    uint64_t v=0;for(unsigned i=0;i<n;i++)v=v*256+ram[p-0x80000000+i];return v;
}
static void wr(CPUState* s,uint32_t p,uint64_t v,uint8_t n) {
    (void)s;assert(p>=0x80000000&&p+n<=0x81800000);
    for(unsigned i=n;i;i--){ram[p-0x80000000+i-1]=v;v>>=8;}
}
int main(void) {
    CPUState s={0};s.external_read=rd;s.external_write=wr;
    const unsigned start=0x80480530, names=0x80479D98;
    wr(&s,INTRO_VS_STATE,2,1);wr(&s,INTRO_VS_STATE+8,0x801B15C8,4);
    wr(&s,INTRO_VS_STATE+12,0x02000000,4);wr(&s,INTRO_VS_STATE+16,start,4);
    wr(&s,INTRO_VS_STATE+20,names,4);
    for(unsigned i=0;i<384;i++)wr(&s,names+i,i,1);
    for(unsigned i=0;i<6;i++)wr(&s,start+0x61+i*0x24,3,1);
    wr(&s,start+0x60,8,1);wr(&s,start+0x61,0,1);wr(&s,start+0x63,2,1);
    wr(&s,start+0xCC,2,1);wr(&s,start+0xCD,1,1);wr(&s,start+0xCF,3,1);
    unsigned char before[0x138], scene[16], scratch[384];
    memcpy(before,ram+start-0x80000000,sizeof(before));
    memcpy(scene,ram+INTRO_VS_STATE+8-0x80000000,sizeof(scene));
    memcpy(scratch,ram+names-0x80000000,sizeof(scratch));
    setenv("OPENSMASH_VS_INTRO","0",1);assert(!intro_prepare(&s));
    unsetenv("OPENSMASH_VS_INTRO");assert(intro_prepare(&s));
    assert(intro_active&&rd(&s,INTRO_VS_STATE+8,4)==0);
    assert(rd(&s,INTRO_DATA+13,1)==8&&rd(&s,INTRO_DATA+16,1)==2);
    assert(rd(&s,INTRO_DATA+19,1)==2&&rd(&s,INTRO_DATA+22,1)==3);
    assert(!memcmp(before,ram+start-0x80000000,sizeof(before)));
    intro_frame(&s);assert(rd(&s,0x80479D35,1)==0);
    wr(&s,0x804735A8,1,4);intro_frame(&s);assert(rd(&s,0x80479D35,1)==3);
    intro_vs_enter(&s);assert(!intro_active&&intro_resuming);
    assert(!memcmp(scene,ram+INTRO_VS_STATE+8-0x80000000,sizeof(scene)));
    assert(!memcmp(scratch,ram+names-0x80000000,sizeof(scratch)));
    wr(&s,0x80479D30,2,1);wr(&s,0x80479D33,2,1);
    s.gpr[27]=INTRO_VS_STATE;intro_scene_ready(&s);
    assert(!intro_active&&!intro_resuming);
    /* Four ports, two custom identities sharing Mario's moveset. */
    wr(&s,start+0x84,8,1);wr(&s,start+0x85,1,1);wr(&s,start+0x87,1,1);
    wr(&s,start+0xA8,22,1);wr(&s,start+0xA9,1,1);
    const unsigned registry=0x81001000;
    for(unsigned i=0;i<2;i++){
        unsigned row=registry+16+i*32;
        wr(&s,row,8,4);wr(&s,row+4,2-i,4);wr(&s,row+12,0x7017+i,4);
        wr(&s,row+24,registry+128+i*8,4);wr(&s,row+28,900+i*100,4);
        wr(&s,registry+128+i*8,'A'+i,1);
    }
    intro_capture(&s,registry,2);assert(intro_prepare(&s));
    assert(intro_count==4&&rd(&s,INTRO_DATA+11,1)==2&&rd(&s,INTRO_DATA+12,1)==2);
    assert(rd(&s,names+3,1)=='A'&&rd(&s,names+99,1)=='B');
    assert(intro_samples[0]==0x7017&&intro_samples[1]==0x7018);
    const unsigned text=0x81000000;
    wr(&s,0x804735AC+8*4,text,4);s.gpr[3]=text;s.gpr[4]=8;intro_name_begin(&s);
    assert(rd(&s,intro_name_tables[0]+8*4,4)==names+96);
    assert(rd(&s,intro_name_tables[2]+8*4,4)==0);
    intro_name_restore(&s);assert(rd(&s,intro_name_tables[0]+8*4,4)==0);
    /* Suppress the retail tick-10 VS cue; first name starts on tick 20. */
    for(unsigned tick=1;tick<=20;tick++){
        wr(&s,0x804D7420,tick,4);intro_animation(&s);
        assert(rd(&s,0x804735E0,2)!=9);
    }
    assert(rd(&s,0x804735E0,2)==99);
    /* Announcer uses the selected identity and clip duration for each port. */
    intro_elapsed=100;intro_announce(&s);assert(s.gpr[3]==8&&intro_next_sound==154);
    s.gpr[9]=INTRO_TRACK;css_voice_patch(&s);assert(s.gpr[3]==0x7017);
    intro_announce(&s);assert(s.gpr[3]==0x9C4A&&intro_voice==1);
    intro_announce(&s);s.gpr[9]=INTRO_TRACK;css_voice_patch(&s);assert(s.gpr[3]==0x7018);
    wr(&s,0x804D7420,21,4);wr(&s,0x804C20C4,0x100,4);intro_animation(&s);
    assert(rd(&s,0x804735E0,2)==140); /* A skips after the input guard. */
    intro_reset(&s);assert(!intro_active&&opensmash_intro_state()==0);
    assert(!memcmp(scene,ram+INTRO_VS_STATE+8-0x80000000,sizeof(scene)));
    assert(!memcmp(scratch,ram+names-0x80000000,sizeof(scratch)));
    wr(&s,start+0xF1,1,1);assert(!intro_prepare(&s));
    return 0;
}
