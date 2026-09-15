/* GALE01 revision 2 only. Addresses and layouts are from the matching decomp.
 * Configure VS, then let the real CSS/SSS preloaders run before combat.
 * Keep original fighter code, combat, results and subsequent menus. */
#include "moderngekko/mod_abi.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
static int original_pacing = 0;
static int launch_mode = 0, cpu_level = 5, routed = 0, destination_ready = 0;
static unsigned port_config[4] = {8, 12 | 256, 2 | 768, 9 | 768};
static int fighter = 8, opponent = 12, arena = 31, stocks = 4, minutes = 8;
static void validate_config(void) {
    if (launch_mode < 0 || launch_mode > 4 || arena < 2 || arena > 32 || arena == 21 || arena == 26 ||
        cpu_level < 1 || cpu_level > 9 || stocks < 1 || stocks > 99 || minutes < 0 || minutes > 99) abort();
    int active = 0;
    for (int i=0;i<4;i++) {
        unsigned role=(port_config[i]>>8)&255, color=port_config[i]>>16;
        if ((port_config[i]&255)>25 || (role!=0 && role!=1 && role!=3) || color>5) abort();
        if(role!=3)active++;
    }
    if(launch_mode==0 && active<2)abort();
}
int opensmash_destination_ready(void) { return destination_ready || original_pacing; }
#ifdef __EMSCRIPTEN__
#include <stdatomic.h>
#include <emscripten.h>
#include <emscripten/threading.h>
static const char* costume_names[] = {"PlMrNr.dat", "PlMrYe.dat", "PlMrBk.dat", "PlMrBu.dat", "PlMrGr.dat", "PlFxNr.dat", "PlFxOr.dat", "PlFxLa.dat", "PlFxGr.dat", "PlCaNr.dat", "PlCaGy.dat", "PlCaRe.dat", "PlCaWh.dat", "PlCaGr.dat", "PlCaBu.dat", "PlDkNr.dat", "PlDkBk.dat", "PlDkRe.dat", "PlDkBu.dat", "PlDkGr.dat", "PlKbNr.dat", "PlKbYe.dat", "PlKbBu.dat", "PlKbRe.dat", "PlKbGr.dat", "PlKbWh.dat", "PlKpNr.dat", "PlKpRe.dat", "PlKpBu.dat", "PlKpBk.dat", "PlLkNr.dat", "PlLkRe.dat", "PlLkBu.dat", "PlLkBk.dat", "PlLkWh.dat", "PlSkNr.dat", "PlSkRe.dat", "PlSkBu.dat", "PlSkGr.dat", "PlSkWh.dat", "PlNsNr.dat", "PlNsYe.dat", "PlNsBu.dat", "PlNsGr.dat", "PlPeNr.dat", "PlPeYe.dat", "PlPeWh.dat", "PlPeBu.dat", "PlPeGr.dat", "PlPpNr.dat", "PlPpGr.dat", "PlPpOr.dat", "PlPpRe.dat", "PlNnNr.dat", "PlNnYe.dat", "PlNnAq.dat", "PlNnWh.dat", "PlPkNr.dat", "PlPkRe.dat", "PlPkBu.dat", "PlPkGr.dat", "PlSsNr.dat", "PlSsPi.dat", "PlSsBk.dat", "PlSsGr.dat", "PlSsLa.dat", "PlYsNr.dat", "PlYsRe.dat", "PlYsBu.dat", "PlYsYe.dat", "PlYsPi.dat", "PlYsAq.dat", "PlPrNr.dat", "PlPrRe.dat", "PlPrBu.dat", "PlPrGr.dat", "PlPrYe.dat", "PlMtNr.dat", "PlMtRe.dat", "PlMtBu.dat", "PlMtGr.dat", "PlLgNr.dat", "PlLgWh.dat", "PlLgAq.dat", "PlLgPi.dat", "PlMsNr.dat", "PlMsRe.dat", "PlMsGr.dat", "PlMsBk.dat", "PlMsWh.dat", "PlZdNr.dat", "PlZdRe.dat", "PlZdBu.dat", "PlZdGr.dat", "PlZdWh.dat", "PlClNr.dat", "PlClRe.dat", "PlClBu.dat", "PlClWh.dat", "PlClBk.dat", "PlDrNr.dat", "PlDrRe.dat", "PlDrBu.dat", "PlDrGr.dat", "PlDrBk.dat", "PlFcNr.dat", "PlFcRe.dat", "PlFcBu.dat", "PlFcGr.dat", "PlPcNr.dat", "PlPcRe.dat", "PlPcBu.dat", "PlPcGr.dat", "PlGwNr.dat", "PlGnNr.dat", "PlGnRe.dat", "PlGnBu.dat", "PlGnGr.dat", "PlGnLa.dat", "PlFeNr.dat", "PlFeRe.dat", "PlFeBu.dat", "PlFeGr.dat", "PlFeYe.dat"};
static unsigned costume_sizes[sizeof(costume_names)/sizeof(costume_names[0])], css_sizes[4];
static const char* css_names[]={"MnSlChr.dat","MnSlChr.usd","nr_select.ssm","nr_select.ssm"};
EMSCRIPTEN_KEEPALIVE void opensmash_css_size(unsigned slot,unsigned size) {
    if(slot>=4 || !size || size>16777216)abort();css_sizes[slot]=size;
}
EMSCRIPTEN_KEEPALIVE void opensmash_costume_size(unsigned slot,unsigned size) {if(slot<sizeof(costume_sizes)/sizeof(costume_sizes[0]) && size>=32 && size<=2097152)costume_sizes[slot]=size;else abort();}
static atomic_uint combat_frames;
/* Browser-only first-scene barrier. Use Melee's scheduler pause bits so the
 * clock, CPUs and countdown cannot advance behind the preparation screen. */
static atomic_int preparation;
static unsigned preparation_pause;
EMSCRIPTEN_KEEPALIVE int opensmash_preparation_state(void) {return atomic_load(&preparation);}
EMSCRIPTEN_KEEPALIVE void opensmash_finish_preparation(void) {
    if(atomic_load(&preparation)==2)atomic_store(&preparation,3);
}
static atomic_int selected_fighter = -1;
EMSCRIPTEN_KEEPALIVE unsigned opensmash_combat_frames(void) { return atomic_load(&combat_frames); }
EMSCRIPTEN_KEEPALIVE void opensmash_choose_fighter(int choice) {
    if (choice < 0 || choice > 25) return;
    atomic_store(&selected_fighter, choice);
    emscripten_futex_wake(&selected_fighter, 1);
}
EMSCRIPTEN_KEEPALIVE void opensmash_configure_launch(int mode,int stage,int level,int stock,int mins,
                                                   unsigned p0,unsigned p1,unsigned p2,unsigned p3) {
    launch_mode=mode;arena=stage;cpu_level=level;stocks=stock;minutes=mins;
    port_config[0]=p0;port_config[1]=p1;port_config[2]=p2;port_config[3]=p3;
    validate_config();atomic_store(&preparation,mode==0?1:4);opensmash_choose_fighter(p0&255);
}
#endif

static unsigned sheik_pending;
static int requested = 0, prepared = 0, classic_prepared = 0, launched = 0, css_frames = 0;
static int boot_card_seen = 0, boot_card_active = 0;

static unsigned read32(CPUState* s, unsigned address) {
    return (unsigned)moderngekko_mod_read(s, address, 4);
}
static void write8(CPUState* s, unsigned address, unsigned value) {
    moderngekko_mod_write(s, address, value, 1);
}
static void boot_card_enter(CPUState* s) {
    (void)s;
    boot_card_active = requested && !boot_card_seen;
    boot_card_seen = 1;
}
static void boot_card_exit(CPUState* s) {(void)s;boot_card_active=0;}
static void boot_card_input(CPUState* s) {
    if(!boot_card_active)return;
    /* GALE01 gm_Scene_MemCard_OnFrame: state 5 asks to create a missing
     * save; state 7 acknowledges successful creation. Let Melee initialize
     * and persist its own data. Never approve formatting or error dialogs. */
    unsigned state=read32(s,0x80480DA8+0x14);
    if(state==5 || state==7) {
        static unsigned reported;
        if(!(reported&(1u<<state))){reported|=1u<<state;fprintf(stderr,"[opensmash] fresh save %s\n",state==5?"creating":"created");}
        write8(s,0x80480DA8+0x1c,0);
        for(unsigned port=0;port<4;port++)
            moderngekko_mod_write(s,0x804C20BC+port*0x44+8,0x100,4);
    }
}
static int setting(const char* name, int fallback, int minimum, int maximum) {
    const char* raw = getenv(name);
    if (!raw) return fallback;
    char* end;
    long value = strtol(raw, &end, 10);
    if (*end || value < minimum || value > maximum) {
        fprintf(stderr, "Invalid %s\n", name);
        abort();
    }
    return (int)value;
}
static void on_load(const ModernGekkoModHostApi* api) {
    (void)api;
    requested = getenv("OPENSMASH_MATCH") != NULL;
    fighter = setting("OPENSMASH_FIGHTER", 8, 0, 25);
    opponent = setting("OPENSMASH_OPPONENT", 12, 0, 25);
    arena = setting("OPENSMASH_STAGE", 31, 2, 32);
    if (arena == 21 || arena == 26) abort();
    stocks = setting("OPENSMASH_STOCKS", 4, 1, 99);
    minutes = setting("OPENSMASH_MINUTES", 8, 0, 99);
    launch_mode=setting("OPENSMASH_MODE",0,0,4);
    cpu_level=setting("OPENSMASH_CPU_LEVEL",5,1,9);
    port_config[0]=fighter | (setting("OPENSMASH_P1_CPU",0,0,1)<<8);
    port_config[1]=opponent | 256;
    for(int i=0;i<4;i++) {
        char name[32];snprintf(name,sizeof(name),"OPENSMASH_PORT%d",i);
        port_config[i]=setting(name,port_config[i],0,0x50319);
    }
    validate_config();
}
static void mark_ready(void) {
    if(!destination_ready){destination_ready=1;fprintf(stderr,"[opensmash] destination ready mode=%d\n",launch_mode);}
}
static void scene_main(CPUState* s) {
    (void)s;
#ifdef __EMSCRIPTEN__
    if(getenv("OPENSMASH_WAIT_SELECTION")) {
        fprintf(stderr,"[opensmash] ready for character selection\n");
        while(atomic_load(&selected_fighter)<0)emscripten_futex_wait(&selected_fighter,-1,1000);
        fighter=atomic_load(&selected_fighter);
        /* The virtual disc reserves space for swapping costumes before launch.
         * Report their real lengths to Melee so its 24 MB heap never allocates
         * the reserved padding (especially in Classic and title demos). */
        unsigned fst=read32(s,0x80000038), count=read32(s,fst+8), changed=0;
        if(fst<0x80000000 || fst>=0x81800000 || count>10000)abort();
        unsigned strings=fst+count*12;
        unsigned select_bank=0;
        for(unsigned i=1;i<count;i++) {
            unsigned entry=fst+i*12, type=read32(s,entry);
            if(type>>24)continue;
            char name[32]={0};unsigned address=strings+(type&0xffffff);
            for(unsigned j=0;j<31;j++){name[j]=moderngekko_mod_read(s,address+j,1);if(!name[j])break;}
            /* FST traverses audio/nr_select then audio/us/nr_select. Both menu
             * archives and both sound banks are staged before scene routing. */
            for(unsigned slot=0;slot<4;slot++) {
                if(!strcmp(name,css_names[slot])) {
                    if(slot>=2)slot=2+select_bank++;
                    if(slot<4 && css_sizes[slot])moderngekko_mod_write(s,entry+8,css_sizes[slot],4);
                    break;
                }
            }
            for(unsigned slot=0;slot<sizeof(costume_sizes)/sizeof(costume_sizes[0]);slot++)
                if(!strcmp(name,costume_names[slot]) && costume_sizes[slot]) {
                    moderngekko_mod_write(s,entry+8,costume_sizes[slot],4);changed++;break;
                }
        }
        fprintf(stderr,"[opensmash] actual costume lengths restored slots=%u\n",changed);
    }
#endif
    fprintf(stderr,"[opensmash] launch mode=%d stage=%d cpu=%d stocks=%d minutes=%d ports=%u,%u,%u,%u\n",
            launch_mode,arena,cpu_level,stocks,minutes,port_config[0],port_config[1],port_config[2],port_config[3]);
    if(launch_mode==4)original_pacing=1;
}
static void intro_reset(CPUState* s);
static void change_mode(CPUState* s) {
    intro_reset(s);
    unsigned next = s->gpr[3];
    if (requested && !routed && launch_mode!=4) {
        next=launch_mode==1?1:launch_mode==3?3:2;routed=1;
    }
    write8(s, 0x80479D31, next);
    write8(s, 0x80479D3C, 1);
    s->pc = s->lr;
}
static void vs_on_load(CPUState* s) {
    /* Original function clears the six per-player KO counts. */
    for (unsigned i = 0; i < 6; ++i) write8(s, 0x804D6730 + i, 0);
    if (!requested || prepared) { s->pc = s->lr; return; }
    unsigned preferences = read32(s, 0x804D3EE0);
    if (preferences < 0x80000000 || preferences >= 0x81800000) abort();
    /* gmMainLib_GetUnlockedCharactersBitmaskPtr (8015ED8C) returns base+1868.
     * The local roster includes Luigi/Marth even with a fresh virtual save.
     * Set all eleven unlock bits before CSS validates its player selections. */
    moderngekko_mod_write(s, preferences + 0x1868, 0x7FF, 2);
    moderngekko_mod_write(s, preferences + 0x186A, 0x7FF, 2);
    unsigned start = preferences + 0x590 + 8;
    moderngekko_mod_write(s, start + 0xE, arena, 2);
    write8(s, preferences + 0x1852, 1); /* stock rules */
    write8(s, preferences + 0x1854, stocks);
    write8(s, preferences + 0x1858, minutes);
    for (unsigned i = 0; i < 6; ++i) {
        unsigned player = start + 0x60 + i * 0x24;
        write8(s, player + 4, i);
        write8(s, player + 1, i < 4 ? ((port_config[i]>>8)&255) : 3);
        if (i < 4) {
            unsigned choice=port_config[i]&255;
            /* CSS has a Zelda tile, but no Sheik tile. An unrecognized 19
             * becomes CKIND_PLAYABLE_COUNT (Master Hand) or disables CPUs. */
            write8(s, player, choice==19?18:choice);
            if(choice==19 && ((port_config[i]>>8)&255)!=3)sheik_pending|=1u<<i;
            write8(s, player + 3, port_config[i]>>16);
            write8(s, player + 0xF, cpu_level);
        }
    }
    prepared = 1;
    fprintf(stderr, "[opensmash] launch fighter=%d opponent=%d stage=%d stocks=%d minutes=%d\n",
            fighter, opponent, arena, stocks, minutes);
    s->pc = s->lr;
}
static void menu_enter(CPUState* s) {
    if(launch_mode==1 && !destination_ready) {unsigned pc=s->pc;vs_on_load(s);s->pc=pc;write8(s,s->gpr[3],2);write8(s,s->gpr[3]+1,0);write8(s,s->gpr[3]+2,1);}
}
static void title_frame(CPUState* s) {(void)s;if(launch_mode==4)mark_ready();}
static void menu_frame(CPUState* s) {(void)s;if(launch_mode==1)mark_ready();}
static void classic_enter(CPUState* s) {
    if(!requested || launch_mode!=3 || classic_prepared)return;
    classic_prepared=1;
    unsigned prefs=read32(s,0x804D3EE0);
    moderngekko_mod_write(s,prefs+0x1868,0x7FF,2);
    unsigned choice=port_config[0]&255;
    write8(s,prefs+0x51C,choice==19?18:choice);if(choice==19)sheik_pending|=1;write8(s,prefs+0x51D,stocks);
    write8(s,prefs+0x51E,port_config[0]>>16);write8(s,prefs+0x51F,(cpu_level-1)/2);
}
static void initialize_requested_form(CPUState* s) {
    unsigned port=s->gpr[3],player=s->gpr[4];
    if(port>=4 || !(sheik_pending&(1u<<port)))return;
    sheik_pending&=~(1u<<port);
    if(moderngekko_mod_read(s,player,1)==18 && moderngekko_mod_read(s,player+3,1)==(port_config[port]>>16)) {
        write8(s,player,19);
        fprintf(stderr,"[opensmash] starting Sheik port=%u\n",port);
    }
}
static void report_heap_exhaustion(CPUState* s) {
    unsigned heap=s->gpr[3], size=(s->gpr[4]+31)&~31u;
    if(heap<0x80000000 || heap>0x817fffe0)return;
    unsigned start=read32(s,heap+4), end=read32(s,heap+8);
    unsigned node=read32(s,heap+12), free_bytes=0, largest=0;
    for(unsigned count=0;count<132;count++) {
        if(node && (node<0x80000000 || node>0x817fffe0))return;
        unsigned next=node?read32(s,node+4):end;
        if(next<start)return;
        unsigned gap=next-start;free_bytes+=gap;if(gap>largest)largest=gap;
        if(!node)break;
        start=read32(s,node+4)+read32(s,node+8);node=read32(s,node);
    }
    if(largest<size)fprintf(stderr,"[opensmash] heap exhausted request=%u free=%u largest=%u bounds=%08x-%08x caller=%08x\n",
        size,free_bytes,largest,read32(s,heap+4),end,s->lr);
}
static void report_assert(CPUState* s) {
    char file[161] = {0}, message[241] = {0};
    for (unsigned i = 0; i + 1 < sizeof(file); ++i) {
        file[i] = (char)moderngekko_mod_read(s, s->gpr[3] + i, 1);
        if (!file[i]) break;
    }
    for (unsigned i = 0; i + 1 < sizeof(message); ++i) {
        message[i] = (char)moderngekko_mod_read(s, s->gpr[5] + i, 1);
        if (!message[i]) break;
    }
    unsigned sp = s->gpr[1];
    for (unsigned depth = 0; depth < 12 && sp >= 0x80000000 && sp < 0x81800000; ++depth) {
        fprintf(stderr, "[opensmash] stack %08x lr=%08x\n", sp, read32(s, sp + 4));
        unsigned next = read32(s, sp);
        if (next <= sp) break;
        sp = next;
    }
    fprintf(stderr, "[opensmash] guest assert %s:%u %s lr=%08x\n", file, s->gpr[4], message, s->lr);
}
static void css_frame(CPUState* s) {
    if(launch_mode==2 || launch_mode==3)mark_ready();
    if (prepared && !launched && css_frames++ == 0)
        fprintf(stderr, "[opensmash] character select ready\n");
    if (launch_mode==0 && prepared && !launched && css_frames >= 1)
        write8(s, 0x804D6CF6, 1); /* Let the original frame handler finish loading. */
}
static void stage_enter(CPUState* s) {
    if (launch_mode==0 && prepared && !launched) {
        fprintf(stderr, "[opensmash] stage select ready\n");
        write8(s, s->gpr[3] + 3, arena); /* SSSData.force_stage_id */
        launched = 1;
    }
}
static void combat_frame(CPUState* s) {
    (void)s;
    mark_ready();
#ifdef __EMSCRIPTEN__
    unsigned frame=atomic_fetch_add(&combat_frames, 1);
    if (frame == 0)fprintf(stderr, "[opensmash] combat started\n");
    if (frame == 1 && atomic_load(&preparation)==1) {
        preparation_pause=moderngekko_mod_read(s,0x80479D68,1);
        write8(s,0x80479D68,preparation_pause|3);
        atomic_store(&preparation,2);
        fprintf(stderr,"[opensmash] preparing first scene; simulation held\n");
    }
#else
    static unsigned native_frames;
    if (native_frames++ == 0)
        fprintf(stderr, "[opensmash] combat started\n");
    if (native_frames == 180)
        fprintf(stderr, "[opensmash] native combat frame=180\n");
#endif
}
#ifdef __EMSCRIPTEN__
static void preparation_poll(CPUState* s) {
    if(atomic_load(&preparation)==3) {
        write8(s,0x80479D68,preparation_pause);
        atomic_store(&preparation,4);
        fprintf(stderr,"[opensmash] first scene ready; simulation resumed\n");
    }
}
#endif
/* Results names are normally an atlas indexed by fighter kind. Read the
 * custom identity from the loaded costume instead, so shared movesets and
 * vanilla opponents remain independent. No allocation or combat-frame work. */
static int presentation_pointer(unsigned p) { return p>=0x80000000 && p<0x817fff00; }
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
static void normalized_draw(CPUState* s) {
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
static void css_draw_root_begin(CPUState* s);
static void normalized_draw_patch(CPUState* s) {
    css_draw_root_begin(s);
#ifdef __EMSCRIPTEN__
    preparation_poll(s);
#endif
    normalized_draw(s);
    /* Verified GALE01 1.02 entry instruction: mflr r0 (7c0802a6).
     * A patch is required: observational hooks restore register arguments. */
    s->gpr[0]=s->lr;s->pc=0x803709E0;
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
#include "vs_intro.h"
#include "character_select.h"

static const ModernGekkoModHook hooks[] = {
    RECOMP_HOOK(0x801B1588, intro_vs_enter),
    RECOMP_HOOK(0x80160DE8, intro_name_begin),
    RECOMP_HOOK(0x803910D8, intro_camera),
    RECOMP_HOOK(0x80186DFC, intro_frame),
    RECOMP_HOOK(0x801B0264, boot_card_enter),
    RECOMP_HOOK(0x801B0304, boot_card_exit),
    RECOMP_HOOK(0x801AF568, boot_card_input),
    RECOMP_HOOK(0x802640A0, css_enter_identity),
    RECOMP_HOOK(0x80266D70, css_exit_identity),
    RECOMP_HOOK_RETURN(0x80266D70, css_exited_identity),
    RECOMP_HOOK(0x8025D5AC, css_door_identity),
    RECOMP_HOOK(0x802602A0, css_cursor_begin),
    RECOMP_HOOK_RETURN(0x802602A0, css_cursor_end),
    RECOMP_HOOK(0x80023870, css_announce),
    RECOMP_HOOK_RETURN(0x803709DC, css_draw_root_end),

    RECOMP_HOOK(0x8005FDDC, flash_begin),
    RECOMP_HOOK(0x802A7D8C, held_item_begin),
    RECOMP_HOOK_RETURN(0x802A7D8C, held_item_end),
    RECOMP_HOOK(0x8026EECC, held_item_begin),
    RECOMP_HOOK_RETURN(0x8026EECC, held_item_end),
    RECOMP_HOOK(0x802F94E0, stock_identity),
    RECOMP_HOOK(0x802F5E50, damage_emblem),
    RECOMP_HOOK(0x80179D3C, results_portrait0),
    RECOMP_HOOK(0x80179D60, results_portrait1),
    RECOMP_HOOK(0x80179D84, results_portrait2),
    RECOMP_HOOK(0x80179DA8, results_portrait3),
    RECOMP_HOOK_RETURN(0x80179350, results_identity),
    RECOMP_HOOK(0x801A4510, scene_main),
    RECOMP_HOOK(0x801A1C18, title_frame),
    RECOMP_HOOK(0x8022DDA8, menu_enter),
    RECOMP_HOOK(0x8022DD38, menu_frame),
    RECOMP_HOOK(0x801B3DD8, classic_enter),
    RECOMP_HOOK(0x8016D800, combat_frame),
    RECOMP_HOOK(0x802669F4, css_frame),
    RECOMP_HOOK(0x8016D8AC, initialize_requested_form),
    RECOMP_HOOK(0x8025A998, stage_enter),
    RECOMP_HOOK(0x80014FC8, report_heap_exhaustion),
    RECOMP_HOOK(0x80388220, report_assert),
    RECOMP_HOOK(0x80388278, report_assert),
};
static const ModernGekkoModPatch patches[] = {
    RECOMP_PATCH(0x801A40B4, intro_scene_ready),
    RECOMP_PATCH(0x80184AB8, intro_animation),
    RECOMP_PATCH(0x80168C5C, intro_announce),
    RECOMP_PATCH(0x800243F4, intro_voice_track),
    RECOMP_PATCH(0x8002702C, intro_audio_banks),
    RECOMP_PATCH(0x80160980, css_name_patch),
    RECOMP_PATCH(0x803896F0, css_voice_patch),
    RECOMP_PATCH(0x800674F8, flash_return_patch),
    RECOMP_PATCH(0x80067568, flash_return_patch),
    RECOMP_PATCH(0x803709DC, normalized_draw_patch),
    RECOMP_PATCH(0x801A42F8, change_mode),
    RECOMP_PATCH(0x801A55EC, vs_on_load),
};
static const ModernGekkoModDesc descriptor = {
    .abi_version = MODERNGEKKO_MOD_ABI_VERSION,
    .cpu_abi_version = MODERNGEKKO_CPU_ABI_VERSION,
    .cpu_state_size = sizeof(CPUState),
    .game_id = "GALE01",
    .id = "opensmash_launch",
    .version = "0.1.0",
    .display_name = "OpenSmash match launch (USA 1.02)",
    .patches = patches,
    .num_patches = sizeof(patches)/sizeof(patches[0]),
    .hooks = hooks,
    .num_hooks = sizeof(hooks)/sizeof(hooks[0]),
    .on_load = on_load,
};
MODERNGEKKO_MOD_EXPORT const ModernGekkoModDesc* moderngekko_get_mod(void) {
    return &descriptor;
}
