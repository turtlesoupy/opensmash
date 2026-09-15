/* OpenSmash-style launch configuration feeds Melee's existing VS state machine. */
#include <melee/gm/gm_1A3F.h>
#include <melee/gm/gm_1601.h>
#include <melee/gm/gmvsmelee.h>
#include <melee/gm/gmvsmode.h>
#include <melee/gm/gmmain_lib.h>
#include <melee/gm/types.h>
#include <melee/mn/types.h>
#include <melee/ft/forward.h>
#include <melee/pl/forward.h>
#include <melee/gr/forward.h>
#include <melee/lb/lbdvd.h>
#include <string.h>

static int requested;
static int fighter,opponent,stage,stocks,seconds,cpu_level;
int port_configure_match(int character,int rival,int arena,int stock_count,int time_seconds,int level) {
    if(character<0 || character>=CKIND_PLAYABLE_COUNT || rival<0 || rival>=CKIND_PLAYABLE_COUNT ||
       arena<St_Kind_Izumi || arena>St_Kind_Last || arena==St_Kind_Akaneia || arena==St_Kind_Icetop || stock_count<1 || stock_count>99 ||
       time_seconds<0 || time_seconds>5999 || level<1 || level>9)return 0;
    fighter=character;opponent=rival;stage=arena;stocks=stock_count;seconds=time_seconds;cpu_level=level;requested=1;return 1;
}
int port_initial_mode(int original) { return requested?GM_VS:original; }
void port_mode_loaded(int mode) {
    if(!requested || mode!=GM_VS)return;
    VsModeData* vs=gmVsMelee_GetVsData();memset(vs,0,sizeof(*vs));
    gm_SetupRulesDefaults(&vs->start.rules);
    vs->start.rules.stkind=stage;
    GameRules* rules=gmMainLib_GetGameRules();
    rules->mode=1;rules->stock_count=stocks;rules->stock_time_limit=(seconds+59)/60;
    for(int i=0;i<GM_MAX_PLAYERS;i++) {
        gm_SetupPlayerDefaults(&vs->start.players[i]);
        vs->start.players[i].slot=i;
    }
    vs->start.players[0].ckind=fighter;vs->start.players[0].slot_type=Gm_PKind_Human;
    vs->start.players[1].ckind=opponent;vs->start.players[1].slot_type=Gm_PKind_Cpu;
    vs->start.players[1].cpu_level=cpu_level;
    lbDvd_SetupVsPreloadCache();
    gm_SetGameModeStateId(gmVsMode_State_Vs);
}
