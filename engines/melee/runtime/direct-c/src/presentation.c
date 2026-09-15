/* Reuse the current presentation transformations with host pointers. Game
 * simulation never passes through this adapter. */
#include "pc_runtime.h"
#include <sysdolphin/baselib/cobj.h>
#include <emscripten/heap.h>
#include <math.h>
#include <stdint.h>
#include <string.h>
typedef struct {unsigned gpr[32],lr,pc;double fpr[32];} CPUState;
extern unsigned direct_resolve_global(unsigned);
#define host_address direct_resolve_global
static unsigned moderngekko_mod_read(CPUState* s,unsigned p,unsigned size){unsigned v=0;memcpy(&v,(void*)host_address(p),size);return v;}
static void moderngekko_mod_write(CPUState* s,unsigned p,unsigned value,unsigned size){if(size==4)value=host_address(value);memcpy((void*)host_address(p),&value,size);}
static unsigned read32(CPUState* s,unsigned p){return moderngekko_mod_read(s,p,4);}
static int presentation_pointer(unsigned p) { return p>=0x02000000 && p<emscripten_get_heap_size()-256; }
static unsigned costume_identity(CPUState* s, unsigned joint, unsigned depth) {
    if(depth>100)return 0;
    for(unsigned count=0;presentation_pointer(joint) && count<100;count++,joint=read32(s,joint+8)) {
        unsigned desc=read32(s,joint+0x84);
        if(presentation_pointer(desc)) {
            unsigned d=read32(s,desc+16);
            for(unsigned n=0;presentation_pointer(d) && n<100;n++,d=read32(s,d+4)) {
                unsigned m=read32(s,d+8);
                if(presentation_pointer(m) && read32(s,m+24)==0x4f535549 && (read32(s,m+28)>=5 && read32(s,m+28)<=8))
                    return m;
            }
        }
        unsigned found=costume_identity(s,read32(s,joint+0x10),depth+1);
        if(found)return found;
    }
    return 0;
}
static void results_identity(CPUState* s) {
    static unsigned reported[4];
    unsigned match=read32(s,0x8046DBE8+0x94);
    for(unsigned port=0;port<4;port++) {
        unsigned player=0x8046DBE8+0x98+port*0xD8;
        unsigned fighter_gobj=read32(s,player+8),label=read32(s,player+0x90+5*4);
        if(!presentation_pointer(fighter_gobj))continue;
        unsigned identity=costume_identity(s,read32(s,fighter_gobj+0x28),0);
        if(!identity)continue;
        unsigned outcome=presentation_pointer(match)?moderngekko_mod_read(s,match+4,1):7;
        if(port==moderngekko_mod_read(s,0x8046DBE8+6,1) && outcome!=7 && outcome!=8) {
            unsigned title=read32(s,0x8046DBE8+0x30);
            unsigned td=presentation_pointer(title)?read32(s,title+0x18):0;
            td=presentation_pointer(td)?read32(s,td+4):0;
            unsigned tm=presentation_pointer(td)?read32(s,td+8):0;
            unsigned tt=presentation_pointer(tm)?read32(s,tm+8):0;
            if(presentation_pointer(tt) && presentation_pointer(match) &&
               moderngekko_mod_read(s,match+6,1)==0)
                moderngekko_mod_write(s,tt+88,read32(s,identity+44),4);
            unsigned logo=read32(s,0x8046DBE8+0x20);
            unsigned ld=presentation_pointer(logo)?read32(s,logo+0x18):0;
            unsigned lp=presentation_pointer(ld)?read32(s,ld+12):0;
            unsigned geometry=read32(s,identity+40);
            if(presentation_pointer(lp) && presentation_pointer(geometry)) {
                for(unsigned offset=8;offset<24;offset+=4)
                    moderngekko_mod_write(s,lp+offset,read32(s,geometry+offset)&(offset==12?0x3fffffff:0xffffffff),4);
            }
        }
        if(!presentation_pointer(label))continue;
        unsigned d=read32(s,label+0x18);
        if(!presentation_pointer(d))continue;
        unsigned m=read32(s,d+8),p=read32(s,d+12);
        if(!presentation_pointer(m) || !presentation_pointer(p))continue;
        unsigned t=read32(s,m+8),image=read32(s,identity+32),geometry=read32(s,identity+36);
        if(!presentation_pointer(t) || !presentation_pointer(image) || !presentation_pointer(geometry))continue;
        moderngekko_mod_write(s,t+88,image,4);
        for(unsigned offset=8;offset<24;offset+=4)
            moderngekko_mod_write(s,p+offset,read32(s,geometry+offset),4);
        if(reported[port]!=identity) {
            reported[port]=identity;
            fprintf(stderr,"[opensmash] results identity port=%u descriptor=%08x label=%08x\n",port,identity,label);
        }
    }
}
static float presentation_float(CPUState* s,unsigned p) {
    unsigned u=read32(s,p);float value;memcpy(&value,&u,4);return value;
}
static void presentation_write_float(CPUState* s,unsigned p,float value) {
    unsigned u;memcpy(&u,&value,4);moderngekko_mod_write(s,p,u,4);
}
static unsigned presentation_joint(CPUState* s,unsigned root,unsigned descriptor,unsigned depth) {
    if(depth>100)return 0;
    for(unsigned n=0;presentation_pointer(root)&&n<100;n++,root=read32(s,root+8)) {
        if(read32(s,root+0x84)==descriptor)return root;
        unsigned child=presentation_joint(s,read32(s,root+0x10),descriptor,depth+1);
        if(child)return child;
    }
    return 0;
}
static void results_portrait_camera(CPUState* s,unsigned port) {
    unsigned match=read32(s,0x8046DBE8+0x94);
    if(!presentation_pointer(match))return;
    unsigned standing=match+0x58+port*0xA8;
    unsigned placement=moderngekko_mod_read(s,standing+5,1);
    if(moderngekko_mod_read(s,match+6,1)) {
        unsigned team=moderngekko_mod_read(s,standing+7,1);
        if(team>=3)return;
        placement=moderngekko_mod_read(s,match+0x1C+team*0xC+8,1);
    }
    /* Loser portraits already use Melee's full-body framing. */
    if(placement!=0)return;
    unsigned player=0x8046DBE8+0x98+port*0xD8;
    unsigned fighter_gobj=read32(s,player+8);
    if(!presentation_pointer(fighter_gobj))return;
    unsigned root=read32(s,fighter_gobj+0x28),identity=costume_identity(s,root,0);
    if(!identity)return;
    unsigned head=presentation_joint(s,root,read32(s,identity+48),0);
    if(!head)return;
    unsigned camera=read32(s,s->gpr[3]+0x28);
    if(!presentation_pointer(camera))return;
    unsigned eye=read32(s,camera+0x24),interest=read32(s,camera+0x28);
    if(!presentation_pointer(eye)||!presentation_pointer(interest))return;
    float center[3],max_scale=0;
    for(unsigned row=0;row<3;row++) {
        center[row]=presentation_float(s,head+0x44+row*16+12);
        float scale=0;
        for(unsigned column=0;column<3;column++) {
            float m=presentation_float(s,head+0x44+row*16+column*4);
            center[row]+=m*presentation_float(s,identity+52+column*4);scale+=m*m;
        }
        if(scale>max_scale)max_scale=scale;
    }
    float radius=presentation_float(s,identity+64)*sqrtf(max_scale);
    if(read32(s,identity+28)>=6) {
        float fit=presentation_float(s,identity+68);radius*=fit;
        for(unsigned axis=0;axis<3;axis++)center[axis]=center[axis]*fit+(1-fit)*presentation_float(s,root+0x38+axis*4);
        center[1]+=presentation_float(s,identity+72)*presentation_float(s,root+0x30);
    }
    float fov=presentation_float(s,camera+0x40),aspect=presentation_float(s,camera+0x44);
    if(!(radius>.01f && radius<1000 && fov>1 && fov<150 && aspect>.1f))return;
    /* The portrait copies the central 52 pixels of the 640-wide EFB. Fit the
     * actual animated custom head within that crop, with shoulder/headroom. */
    float distance=radius*.6f/tanf(fov*.00872664626f)/aspect*(640.f/52.f);
    unsigned state=0x8046E3AC;
    float capture_width=moderngekko_mod_read(s,0x8046E1B0+0x164+port*24+4,2);
    float capture_height=moderngekko_mod_read(s,0x8046E1B0+0x164+port*24+6,2);
    if(capture_width<1 || capture_height<1)return;
    unsigned w1=moderngekko_mod_read(s,state+0x22B4,2),h1=moderngekko_mod_read(s,state+0x22C4,2);
    float crop_x=moderngekko_mod_read(s,state+0x22A4,2)+320-(w1/4)*2+capture_width*.5f;
    float crop_y=moderngekko_mod_read(s,state+0x22AC,2)+244-(h1/2)*2+capture_height*.5f;
    float half_height=distance*tanf(fov*.00872664626f);
    center[0]-=(crop_x-320)/320*half_height*aspect;
    center[1]-=(240-crop_y)/240*half_height+radius*.18f;
    static unsigned reported[4];
    if(reported[port]!=identity) {
        reported[port]=identity;
        fprintf(stderr,"[opensmash] portrait fit port=%u radius=%.2f distance=%.2f fov=%.2f\n",port,radius,distance,fov);
    }
    for(unsigned axis=0;axis<3;axis++) {
        presentation_write_float(s,interest+0xc+axis*4,center[axis]);
        presentation_write_float(s,eye+0xc+axis*4,center[axis]+(axis==2?distance:0));
    }
    moderngekko_mod_write(s,eye+8,(read32(s,eye+8)|2)&~1u,4);
    moderngekko_mod_write(s,interest+8,(read32(s,interest+8)|2)&~1u,4);
}
static void results_portrait0(CPUState* s){results_portrait_camera(s,0);}
static void results_portrait1(CPUState* s){results_portrait_camera(s,1);}
static void results_portrait2(CPUState* s){results_portrait_camera(s,2);}
static void results_portrait3(CPUState* s){results_portrait_camera(s,3);}
/* Normalize only the submitted draw matrix. Physics, hitboxes, animation
 * state and world-space joint matrices remain the original Melee values. */
static unsigned root_identity(CPUState* s,unsigned root) {
    if(!presentation_pointer(root) || !(read32(s,root+0x14)&2))return 0;
    unsigned desc=read32(s,root+0x84);
    if(!presentation_pointer(desc))return 0;
    unsigned d=read32(s,desc+16);
    if(!presentation_pointer(d))return 0;
    unsigned m=read32(s,d+8);
    return presentation_pointer(m)&&read32(s,m+24)==0x4f535549&&(read32(s,m+28)>=6 && read32(s,m+28)<=8)?m:0;
}
/* Item models held by a fighter must use the same visual transform. Released
 * projectiles retain their own world-space trajectory. */
static unsigned held_item_roots[3], held_owner_root;
static void held_item_end(CPUState* s) {
    (void)s;held_owner_root=0;
    for(unsigned i=0;i<3;i++)held_item_roots[i]=0;
}
static void held_item_begin(CPUState* s) {
    held_item_end(s);
    unsigned item=read32(s,s->gpr[3]+0x2c);if(!presentation_pointer(item))return;
    unsigned kind=read32(s,item+0x10);
    /* Arrow state 0 is nocked; state 1 and later are released. */
    if(kind==64 || kind==65) {if(read32(s,item+0x24)!=0)return;}
    else if(kind!=74 && kind!=75 && kind!=76 && kind!=77 && kind!=83)return;
    unsigned owner=read32(s,item+0x518);if(!presentation_pointer(owner))return;
    unsigned root=read32(s,owner+0x28);if(!root_identity(s,root))return;
    held_item_roots[0]=read32(s,s->gpr[3]+0x28);held_owner_root=root;
    if(kind==64 || kind==65) {
        /* itLinkArrow draws two additional charge/trail model roots before
         * its normal item callback (Item.xDD4.linkarrow.xB4). */
        held_item_roots[1]=read32(s,item+0xe88);
        held_item_roots[2]=read32(s,item+0xe8c);
    }
}
/* Detached fighter animation-command effects lose their ownership after
 * spawning. Normalize the charge flash (3F3) and directional dust (3FE). */
static unsigned flash_owner_root, flash_kind;
static void flash_begin(CPUState* s){
    if(!((s->lr==0x800674F8&&s->gpr[3]==0x3F3)||(s->lr==0x80067568&&s->gpr[3]==0x3FE)))return;
    flash_kind=s->gpr[3];
    unsigned gobj=s->gpr[4];flash_owner_root=0;
    if(!presentation_pointer(gobj))return;
    unsigned root=read32(s,gobj+0x28);if(root_identity(s,root))flash_owner_root=root;
}
static void flash_created(CPUState* s){
    unsigned root=flash_owner_root;flash_owner_root=0;
    unsigned identity=root_identity(s,root);if(!identity)return;
    unsigned gen=s->gpr[3];if(!presentation_pointer(gen))return;
    unsigned app=read32(s,gen+0x54);
    unsigned position_ptr=gen+0x24;
    if(flash_kind==0x3FE){if(!presentation_pointer(app))return;position_ptr=app+8;}
    float scale=presentation_float(s,identity+68),offset=presentation_float(s,identity+72);
    for(unsigned axis=0;axis<3;axis++){
        float origin=presentation_float(s,root+0x38+axis*4);
        float position=origin+scale*(presentation_float(s,position_ptr+axis*4)-origin);
        if(axis==1)position+=offset*presentation_float(s,root+0x30);
        presentation_write_float(s,position_ptr+axis*4,position);
        if(flash_kind==0x3FE)presentation_write_float(s,app+0x24+axis*4,presentation_float(s,app+0x24+axis*4)*scale);
    }
}
static void flash_return_patch(CPUState* s){
    flash_created(s);
    /* Both verified GALE01 return sites branch to 800675F8. */
    s->pc=0x800675F8;
}
static unsigned preparation=4,preparation_pause,preparation_frames;
EMSCRIPTEN_KEEPALIVE unsigned opensmash_preparation_state(void){return preparation;}
EMSCRIPTEN_KEEPALIVE void opensmash_finish_preparation(void){if(preparation==2)preparation=3;}
void direct_prepare_init(int mode){preparation=mode==0?1:4;preparation_frames=0;}
static void direct_combat_frame(CPUState* s){
 if(preparation_frames++==1&&preparation==1){preparation_pause=moderngekko_mod_read(s,0x80479D68,1);moderngekko_mod_write(s,0x80479D68,preparation_pause|3,1);preparation=2;fprintf(stderr,"[opensmash] preparing first scene; simulation held\n");}
}
static void normalized_draw(CPUState* s) {
 if(preparation==3){moderngekko_mod_write(s,0x80479D68,preparation_pause,1);preparation=4;fprintf(stderr,"[opensmash] first scene ready; simulation resumed\n");}
    unsigned root=s->gpr[3],identity=root_identity(s,root);
    if(!identity && root && (root==held_item_roots[0]||root==held_item_roots[1]||root==held_item_roots[2])) {root=held_owner_root;identity=root_identity(s,root);}
    if(!identity)return;
    float scale=presentation_float(s,identity+68),offset=presentation_float(s,identity+72);
    if(!isfinite(scale)||scale<.2f||scale>3.f)return;
    unsigned view=s->gpr[4];
    if(!view) {unsigned camera=read32(s,0x804D765C);if(!presentation_pointer(camera))return;view=camera+0x54;}
    if(!presentation_pointer(view))return;
    float shift[3];
    for(unsigned axis=0;axis<3;axis++)shift[axis]=(1-scale)*presentation_float(s,root+0x38+axis*4);
    shift[1]+=offset*presentation_float(s,root+0x30);
    unsigned dest=identity+88;
    for(unsigned row=0;row<3;row++) {
        float translation=presentation_float(s,view+row*16+12);
        for(unsigned col=0;col<3;col++) {
            float value=presentation_float(s,view+row*16+col*4);
            translation+=value*shift[col];
            presentation_write_float(s,dest+row*16+col*4,value*scale);
        }
        presentation_write_float(s,dest+row*16+12,translation);
    }
    s->gpr[4]=dest;
    static unsigned reported; if(!reported){reported=identity;fprintf(stderr,"[opensmash] stature scale=%.4f offset=%.4f root=%08x\n",scale,offset,root);}
}
static unsigned player_identity(CPUState* s,unsigned port) {
    unsigned player=0x80453080+port*0xe90;
    unsigned transformed=moderngekko_mod_read(s,player+0xc,1);if(transformed>1)return 0;
    unsigned fighter=read32(s,player+0xb0+transformed*4);
    if(!presentation_pointer(fighter))return 0;
    return root_identity(s,read32(s,fighter+0x28));
}
static void stock_identity(CPUState* s) {
    unsigned data=read32(s,s->gpr[3]+0x2c);
    if(!presentation_pointer(data))return;
    unsigned port=moderngekko_mod_read(s,data,1);if(port>=6)return;
    unsigned identity=player_identity(s,port);if(!identity)return;
    /* Lives use the full-color stock artwork; the monochrome emblem is only
     * a fallback for older costumes without a stock descriptor. */
    unsigned image=read32(s,identity+76);
    if(!presentation_pointer(image))image=read32(s,identity+80);
    if(!presentation_pointer(image))return;
    for(unsigned i=1;i<=7;i++) {
        unsigned joint=read32(s,0x804A1378+8+port*0x50+4+i*4);
        if(!presentation_pointer(joint))continue;
        unsigned d=read32(s,joint+0x18);if(!presentation_pointer(d))continue;
        unsigned m=read32(s,d+8);if(!presentation_pointer(m))continue;
        unsigned t=read32(s,m+8);if(!presentation_pointer(t))continue;
        moderngekko_mod_write(s,t+88,image,4);
    }
    static unsigned reported[6];
    if(reported[port]!=identity){reported[port]=identity;fprintf(stderr,"[opensmash] stock identity port=%u descriptor=%08x\n",port,identity);}
}
static void damage_emblem(CPUState* s) {
    for(unsigned port=0;port<6;port++) {
        if(read32(s,0x804A10C8+port*0x64+4)!=s->gpr[3])continue;
        unsigned identity=player_identity(s,port);if(!identity)return;
        unsigned joint=read32(s,s->gpr[3]+0x28);if(!presentation_pointer(joint))return;
        joint=read32(s,joint+0x10);if(!presentation_pointer(joint))return;
        unsigned d=read32(s,joint+0x18);if(!presentation_pointer(d))return;
        unsigned m=read32(s,d+8);if(!presentation_pointer(m))return;
        unsigned t=read32(s,m+8);if(!presentation_pointer(t))return;
        unsigned image=read32(s,identity+80);if(!presentation_pointer(image))return;
        moderngekko_mod_write(s,t+88,image,4);
        return;
    }
}

#include <pc_endian.h>
#include <pc_hsd_swap.h>
static void direct_prepare_css(CPUState* s){
 unsigned archive=read32(s,0x804D6CD0);if(!presentation_pointer(archive))return;
 unsigned data=read32(s,archive+32),table=read32(s,archive+40),count=read32(s,archive+12);
 if(count>100)return;
 for(unsigned i=0;i<count;i++){unsigned* r=(unsigned*)(data+read32(s,table+i*8));if(r[0]!=0x5343534f)continue;
 for(int j=0;j<4;j++)pc_swap32(r+j);if(r[1]!=1||r[2]>29)return;
 for(unsigned j=0;j<r[2];j++){unsigned* row=r+4+j*8;for(int k=0;k<4;k++)pc_swap32(row+k);pc_swap32(row+7);pc_swap_imagedesc((HSD_ImageDesc*)row[4]);pc_swap_imagedesc((HSD_ImageDesc*)row[5]);}
 }
}
static void write8(CPUState* s,unsigned p,unsigned v){moderngekko_mod_write(s,p,v,1);}
static void mark_ready(void){}
#include <stdatomic.h>
#include "vs_intro.h"
#include "character_select.h"
unsigned direct_present_hook(unsigned hook,unsigned a,unsigned b){
 CPUState s={0};s.gpr[3]=a;s.gpr[4]=b;
 switch(hook){case 20:direct_combat_frame(&s);break;case 0:normalized_draw(&s);break;case 7:css_draw_begin(&s);break;case 8:css_draw_end(&s);break;case 9:direct_prepare_css(&s);css_enter_identity(&s);break;case 10:css_exit_identity(&s);break;case 11:css_exited_identity(&s);break;case 12:css_door_identity(&s);break;case 13:css_cursor_begin(&s);break;case 14:css_cursor_end(&s);break;case 15:intro_vs_enter(&s);break;case 16:intro_camera(&s);break;case 17:if(a==host_address(INTRO_VS_STATE)){s.gpr[27]=INTRO_VS_STATE;intro_scene_ready(&s);}break;case 18:intro_frame(&s);break;case 19:intro_reset(&s);break;case 1:stock_identity(&s);break;case 2:damage_emblem(&s);break;case 3:results_identity(&s);break;case 4:results_portrait_camera(&s,b);break;case 5:held_item_begin(&s);break;case 6:held_item_end(&s);break;}
 return s.gpr[4];
}

const char* direct_css_name(unsigned fighter,unsigned door){CPUState s={0};s.gpr[3]=door;css_door_identity(&s);if(door<4&&css_selected[door]){unsigned r=css_row(css_selected[door]);if(read32(&s,r)==fighter)return (const char*)read32(&s,r+24);}extern const char* gm_80160980(unsigned char);return gm_80160980(fighter);}
void direct_css_announce(unsigned id,unsigned track){CPUState s={0};s.gpr[3]=id;s.gpr[6]=track;css_announce(&s);}
unsigned direct_voice(unsigned id,unsigned group,float* pitch1,float* pitch2){CPUState s={0};s.gpr[3]=id;s.gpr[9]=group;s.fpr[1]=*pitch1;s.fpr[2]=*pitch2;css_voice_patch(&s);*pitch1=s.fpr[1];*pitch2=s.fpr[2];return s.gpr[3];}
int direct_intro_animation(unsigned a){CPUState s={0};s.gpr[3]=a;s.lr=1;intro_animation(&s);return s.pc!=1;}
unsigned direct_intro_announce(unsigned fighter){CPUState s={0};s.gpr[3]=fighter;s.lr=1;intro_announce(&s);if(s.pc==1)return ~0u;if(s.pc==0x800237A8){extern int lbAudioAx_800237A8(int,int,int);lbAudioAx_800237A8(s.gpr[3],s.gpr[4],s.gpr[5]);return ~0u;}return s.gpr[3];}
int direct_intro_track(unsigned id){if(!intro_active)return -2;extern int lbAudioAx_80023870(int,int,int,int);return lbAudioAx_80023870(id,127,64,INTRO_TRACK);}
unsigned direct_intro_banks(void){extern int gm_GetCurrentGameMode(void);return intro_enabled()&&gm_GetCurrentGameMode()==2?0x38:0x20;}
void direct_intro_name(unsigned text,unsigned fighter){CPUState s={0};s.gpr[3]=text;s.gpr[4]=fighter;intro_name_begin(&s);}

void direct_flash(unsigned kind,unsigned gobj,unsigned result){CPUState s={0};if(gobj){s.gpr[3]=kind;s.gpr[4]=gobj;s.lr=kind==0x3F3?0x800674F8:0x80067568;flash_begin(&s);}else{s.gpr[3]=result;flash_created(&s);}}
