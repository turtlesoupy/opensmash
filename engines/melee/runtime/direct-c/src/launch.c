#include "pc_runtime.h"
#include <melee/gm/gm_1A3F.h>
#include <melee/gm/gm_1601.h>
#include <melee/gm/gmvsmelee.h>
#include <melee/gm/gmvsmode.h>
#include <melee/gm/gmmain_lib.h>
#include <melee/gm/types.h>
#include <melee/mn/types.h>
#include <melee/ft/types.h>
#include <melee/pl/player.h>
#include <melee/lb/lbdvd.h>
#include <sysdolphin/baselib/gobj.h>
#include <emscripten.h>
static int requested,routed,configured,mode,stage,level,stocks,minutes,launched;
static unsigned ports[4],sheik_pending;
EMSCRIPTEN_KEEPALIVE int direct_configure(int m,int st,int lv,int sk,int min,unsigned p0,unsigned p1,unsigned p2,unsigned p3){
 unsigned p[4]={p0,p1,p2,p3};if(m<0||m>4||st<2||st>32||st==21||st==26||lv<1||lv>9||sk<1||sk>99||min<0||min>99)return 0;
 int active=0;for(int i=0;i<4;i++){unsigned role=(p[i]>>8)&255;if((p[i]&255)>25||(role!=0&&role!=1&&role!=3)||(p[i]>>16)>5)return 0;if(role!=3)active++;}
 if(m==0&&active<2)return 0;
 for(int i=0;i<4;i++)if((p[i]&255)==19&&((p[i]>>8)&255)!=3)sheik_pending|=1u<<i;
 extern void direct_prepare_init(int);direct_prepare_init(m);mode=m;stage=st;level=lv;stocks=sk;minutes=min;memcpy(ports,p,sizeof(p));requested=1;return 1;
}
extern unsigned direct_present_hook(unsigned,unsigned,unsigned);
int direct_route(int original){direct_present_hook(19,0,0);if(!requested||routed||mode==4)return original;routed=1;return mode==1?GM_MENU:mode==3?GM_CLASSIC:GM_VS;}
void direct_mode_loaded(int kind){
 if(!requested||configured||mode==4)return;
 *gmMainLib_GetUnlockedCharactersBitmaskPtr()=0x7ff;gmMainLib_804D3EE0->thing.x186A=0x7ff;
 if(kind==GM_CLASSIC&&mode==3){
   unsigned char* prefs=(unsigned char*)gmMainLib_804D3EE0; // Fixed-size source structures preserve the matching game offsets.
   prefs[0x51c]=(ports[0]&255)==19?18:ports[0]&255;prefs[0x51d]=stocks;prefs[0x51e]=ports[0]>>16;prefs[0x51f]=(level-1)/2;configured=1;return;
 }
 if(kind!=GM_VS)return;
 VsModeData* vs=gmVsMelee_GetVsData();gm_SetupRulesDefaults(&vs->start.rules);vs->start.rules.stkind=stage;
 GameRules* rules=gmMainLib_GetGameRules();rules->mode=1;rules->stock_count=stocks;rules->stock_time_limit=minutes;
 for(int i=0;i<GM_MAX_PLAYERS;i++){gm_SetupPlayerDefaults(&vs->start.players[i]);PlayerInitData* p=&vs->start.players[i];p->slot=i;p->slot_type=i<4?(ports[i]>>8)&255:3;if(i<4){p->ckind=(ports[i]&255)==19?18:ports[i]&255;p->color=ports[i]>>16;p->cpu_level=level;p->stocks=stocks;}}
 configured=1;
}
EMSCRIPTEN_KEEPALIVE unsigned direct_frame_count(void){return pc_frame_count;}
EMSCRIPTEN_KEEPALIVE unsigned direct_scene(void){return gm_GetCurrentGameMode()*256+gm_GetCurrentSceneIndex();}
unsigned direct_scene_kind_value;
EMSCRIPTEN_KEEPALIVE unsigned direct_scene_kind(void){return direct_scene_kind_value;}
static float snapshot[4*12];
EMSCRIPTEN_KEEPALIVE float* direct_snapshot(void){
 memset(snapshot,0,sizeof(snapshot));if(direct_scene_kind_value!=2)return snapshot;for(int i=0;i<4;i++){HSD_GObj* obj=Player_GetEntity(i);if(!obj||!obj->user_data)continue;Fighter* fp=obj->user_data;float* p=snapshot+i*12;p[0]=1;p[1]=fp->kind;p[2]=fp->motion_id;p[3]=fp->cur_pos.x;p[4]=fp->cur_pos.y;p[5]=fp->self_vel.x;p[6]=fp->self_vel.y;p[7]=fp->facing_dir;p[8]=fp->dmg.x1830_percent;p[9]=Player_GetStocks(i);p[10]=fp->cur_anim_frame;}
 return snapshot;
}

int direct_skip_css(void){return requested&&mode==0&&configured&&!launched;}
int direct_forced_stage(void){if(direct_skip_css()&&!launched){launched=1;return stage;}return -1;}

void direct_player_init(int port,PlayerInitData* p){if(port>=0&&port<4&&(sheik_pending&(1u<<port))&&p->ckind==18){p->ckind=19;sheik_pending&=~(1u<<port);}}

void direct_menu_enter(void* data){if(requested&&mode==1){direct_mode_loaded(GM_VS);unsigned char* p=data;p[0]=2;p[1]=0;p[2]=1;}}
