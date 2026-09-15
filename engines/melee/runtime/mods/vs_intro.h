/* GALE01 1.02: real Classic scene, followed by the unchanged VS match.
 * Entry patches work in native/JIT and Wasm; no return-hook assumptions. */
#define INTRO_VS_STATE 0x803DD9D0u
#define INTRO_DATA 0x80490880u
#define INTRO_RUNTIME 0x8047368Cu
#define INTRO_TRACK 0xE9u
static unsigned intro_active, intro_resuming, intro_saved[4], intro_ports[4], intro_count, intro_left;
static unsigned intro_fighters[4], intro_samples[4], intro_durations[4], intro_name_base;
static unsigned char intro_saved_names[4*96];
static unsigned intro_label, intro_elapsed, intro_retrace, intro_next_sound, intro_voice, intro_sample;
static unsigned intro_ready_logged,intro_vs_spoken;
static unsigned intro_name_slot,intro_name_saved[4],intro_width_saved[4];
static const unsigned intro_name_tables[]={0x803D4FDC,0x803D4D74,0x803D50E4,0x803D5060};
static void intro_name_restore(CPUState* s);
typedef struct {unsigned fighter,color,sample,duration;unsigned char name[88];} IntroIdentity;
static IntroIdentity intro_identities[32];
static unsigned intro_identity_count;
#ifdef __EMSCRIPTEN__
static atomic_uint intro_state;
EMSCRIPTEN_KEEPALIVE unsigned opensmash_intro_state(void){return atomic_load(&intro_state);}
EMSCRIPTEN_KEEPALIVE void opensmash_finish_intro_preparation(void){
    unsigned expected=1;atomic_compare_exchange_strong(&intro_state,&expected,2);
}
#define INTRO_SET_STATE(v) atomic_store(&intro_state,(v))
#else
static unsigned intro_state;
unsigned opensmash_intro_state(void){return intro_state;}
#define INTRO_SET_STATE(v) (intro_state=(v))
#endif
static int intro_enabled(void){const char* v=getenv("OPENSMASH_VS_INTRO");return !v||strcmp(v,"0");}
static unsigned intro_read(CPUState* s,unsigned p,unsigned n){return moderngekko_mod_read(s,p,n);}
static void intro_write(CPUState* s,unsigned p,unsigned v,unsigned n){moderngekko_mod_write(s,p,v,n);}
static void intro_capture(CPUState* s,unsigned registry,unsigned count){
    intro_identity_count=0;
    if(!registry||count>32)return;
    for(unsigned i=0;i<count;i++){
        unsigned r=registry+16+i*32;
        IntroIdentity* id=&intro_identities[intro_identity_count++];
        id->fighter=read32(s,r);id->color=read32(s,r+4);id->sample=read32(s,r+12);
        id->duration=read32(s,r+28);if(!id->duration||id->duration>15000)id->duration=2500;
        unsigned name=read32(s,r+24);memset(id->name,0,sizeof(id->name));
        /* Copy Shift-JIS whole characters, never leave half of a glyph. */
        for(unsigned j=0;j<sizeof(id->name)-2;){
            unsigned c=intro_read(s,name+j,1);if(!c)break;
            unsigned wide=(c>=0x81&&c<=0x9f)||(c>=0xe0&&c<=0xfc);
            id->name[j]=c=='%'?' ':c;j++;
            if(wide){id->name[j]=intro_read(s,name+j,1);j++;}
        }
    }
}
static void intro_restore(CPUState* s){
    intro_name_restore(s);
    if(intro_active){
        for(unsigned i=0;i<4;i++)intro_write(s,INTRO_VS_STATE+8+i*4,intro_saved[i],4);
        for(unsigned i=0;i<sizeof(intro_saved_names);i++)intro_write(s,intro_name_base+i,intro_saved_names[i],1);
    }
    intro_active=0;intro_label=0;intro_sample=0;
}
static void intro_reset(CPUState* s){intro_restore(s);intro_resuming=0;INTRO_SET_STATE(0);}
static void intro_vs_enter(CPUState* s){
    if(intro_active){intro_restore(s);intro_resuming=1;fprintf(stderr,"[opensmash] intro restored VS match\n");}
}
static const char* const intro_vanilla_names[]={"Captain Falcon","Donkey Kong","Fox","Mr. Game & Watch","Kirby","Bowser","Link","Luigi","Mario","Marth","Mewtwo","Ness","Peach","Pikachu","Ice Climbers","Jigglypuff","Samus","Yoshi","Zelda","Sheik","Falco","Young Link","Dr. Mario","Roy","Pichu","Ganondorf"};
static int intro_prepare(CPUState* s){
    if(!intro_enabled()||intro_active)return 0;
    unsigned start=read32(s,INTRO_VS_STATE+16);intro_count=0;
    if(!presentation_pointer(start))return 0;
    for(unsigned p=0;p<6;p++){
        unsigned data=start+0x60+p*0x24;
        if(intro_read(s,data+1,1)==3)continue;
        if(intro_count==4||intro_read(s,data,1)>=26)return 0;
        intro_ports[intro_count++]=p;
    }
    if(intro_count<2)return 0;
    for(unsigned i=0;i<4;i++)intro_saved[i]=read32(s,INTRO_VS_STATE+8+i*4);
    intro_name_base=intro_saved[3];if(!presentation_pointer(intro_name_base))return 0;
    for(unsigned i=0;i<sizeof(intro_saved_names);i++)intro_saved_names[i]=intro_read(s,intro_name_base+i,1);
    for(unsigned i=0;i<32;i++)write8(s,INTRO_DATA+i,0);
    for(unsigned i=0;i<6;i++)write8(s,INTRO_DATA+13+i,0x21);
    intro_left=intro_count>2?2:1;
    write8(s,INTRO_DATA+8,intro_ports[0]);write8(s,INTRO_DATA+9,0x78);write8(s,INTRO_DATA+10,1);
    write8(s,INTRO_DATA+11,intro_left);write8(s,INTRO_DATA+12,intro_count-intro_left);
    for(unsigned i=0;i<intro_count;i++){
        unsigned p=start+0x60+intro_ports[i]*0x24;
        unsigned fighter=intro_read(s,p,1),color=intro_read(s,p+3,1);
        unsigned slot=i<intro_left?i:3+i-intro_left;
        intro_fighters[i]=fighter;intro_samples[i]=0;intro_durations[i]=1200;
        write8(s,INTRO_DATA+13+slot,fighter);write8(s,INTRO_DATA+19+slot,color);
        unsigned char name[96]={0};snprintf((char*)name,sizeof(name),"P%u %s",intro_ports[i]+1,intro_vanilla_names[fighter]);
        for(unsigned k=0;k<intro_identity_count;k++){
            IntroIdentity* id=&intro_identities[k];if(id->fighter!=fighter||id->color!=color)continue;
            snprintf((char*)name,sizeof(name),"P%u ",intro_ports[i]+1);
            memcpy(name+3,id->name,sizeof(id->name));intro_samples[i]=id->sample;intro_durations[i]=id->duration;break;
        }
        for(unsigned j=0;j<sizeof(name);j++)write8(s,intro_name_base+i*96+j,name[j]);
    }
    intro_write(s,INTRO_VS_STATE+8,0,4);write8(s,INTRO_VS_STATE+12,0x20);
    intro_write(s,INTRO_VS_STATE+16,INTRO_DATA,4);intro_write(s,INTRO_VS_STATE+20,0,4);
    intro_active=1;intro_label=0;intro_elapsed=0;intro_retrace=~0u;intro_next_sound=20;intro_voice=0;intro_vs_spoken=0;intro_sample=0;intro_ready_logged=0;
#ifdef __EMSCRIPTEN__
    INTRO_SET_STATE(1);
#else
    INTRO_SET_STATE(2);
#endif
    fprintf(stderr,"[opensmash] intro preparing players=%u\n",intro_count);return 1;
}
static void intro_scene_ready(CPUState* s){
    /* gm_801A4014 resumes here after the state's on_enter callback. */
    if(s->gpr[27]==INTRO_VS_STATE){
        if(intro_resuming)intro_resuming=0;
        else intro_prepare(s);
    }
    s->gpr[25]=s->gpr[27]+12;s->pc=0x801A40B8;
}
static unsigned intro_text_index(CPUState* s,unsigned text){
    if(!intro_active)return 0;
    for(unsigned i=0;i<intro_count;i++)
        if(read32(s,0x804735AC+(i<intro_left?7+i:10+i-intro_left)*4)==text)return i+1;
    return 0;
}
static void intro_name_restore(CPUState* s){
    if(!intro_name_slot)return;
    unsigned fighter=intro_name_slot-1;
    for(unsigned t=0;t<4;t++){
        intro_write(s,intro_name_tables[t]+fighter*4,intro_name_saved[t],4);
        intro_write(s,0x803B75F8+(fighter+t*33)*4,intro_width_saved[t],4);
    }
    intro_name_slot=0;
}
static void intro_name_begin(CPUState* s){
    intro_name_restore(s);
    unsigned i=intro_text_index(s,s->gpr[3]),fighter=s->gpr[4]&255;
    if(!i||fighter>=26)return;
    unsigned name=intro_name_base+(i-1)*96,length=0;
    for(unsigned j=0;j<95&&intro_read(s,name+j,1);j++){
        unsigned c=intro_read(s,name+j,1);length++;
        if((c>=0x81&&c<=0x9f)||(c>=0xe0&&c<=0xfc))j++;
    }
    float scale=intro_count>2?.8f:1.f;if(length>12)scale*=12.f/length;
    intro_name_slot=fighter+1;
    for(unsigned t=0;t<4;t++){
        intro_name_saved[t]=read32(s,intro_name_tables[t]+fighter*4);
        intro_width_saved[t]=read32(s,0x803B75F8+(fighter+t*33)*4);
        /* NULL alternate names select a different width; preserve that choice. */
        if(t<2||intro_name_saved[t])intro_write(s,intro_name_tables[t]+fighter*4,name,4);
        union {unsigned bits;float value;} width={.bits=intro_width_saved[t]};
        width.value*=scale;intro_write(s,0x803B75F8+(fighter+t*33)*4,width.bits,4);
    }
}
static void intro_hide_tree(CPUState* s,unsigned root,unsigned depth){
    if(depth>16||!presentation_pointer(root))return;
    intro_write(s,root+0x14,read32(s,root+0x14)|0x10,4);
    unsigned child=read32(s,root+0x10);
    for(unsigned n=0;n<32&&presentation_pointer(child);n++){intro_hide_tree(s,child,depth+1);child=read32(s,child+8);}
}
static void intro_camera(CPUState* s){
    intro_name_restore(s);
    if(intro_active)for(unsigned i=2;i<=3;i++)intro_hide_tree(s,read32(s,0x804735AC+i*4),0);
}
static void intro_animation(CPUState* s){
    if(intro_active){
        unsigned tick=read32(s,0x804D7420);
        if(intro_retrace==tick){s->pc=s->lr;return;}intro_retrace=tick;
        mark_ready();
        if(opensmash_intro_state()==1){intro_write(s,0x804735E0,0,2);intro_write(s,0x804735A8,0,4);}
        else {
            if(!intro_ready_logged){intro_ready_logged=1;fprintf(stderr,"[opensmash] intro playing players=%u\n",intro_count);}
            intro_elapsed++;
            unsigned skip=0;if(intro_elapsed>30)for(unsigned p=0;p<4;p++)skip|=read32(s,0x804C20C4+p*0x44)&0x1100;
            unsigned frame=intro_elapsed<20?intro_elapsed-1:101;
            if(frame==9)frame=10; /* Defer the original early "versus" cue. */
            if(skip||(intro_voice==intro_count&&intro_elapsed>=intro_next_sound))frame=140;
            else if(intro_elapsed>=intro_next_sound)frame=99; /* Melee's name cue is tick 100. */
            intro_write(s,0x804735E0,frame,2);
        }
    }
    s->gpr[0]=s->lr;s->pc=0x80184ABC;
}
static void intro_frame(CPUState* s){
    if(intro_active&&read32(s,0x804735A8)){
        write8(s,0x80479D35,intro_read(s,INTRO_VS_STATE,1)+1);
        if(opensmash_intro_state()!=3){INTRO_SET_STATE(3);fprintf(stderr,"[opensmash] intro complete\n");}
    }
}
static void intro_announce(CPUState* s){
    if(intro_active){
        if(intro_voice==1&&!intro_vs_spoken){
            intro_vs_spoken=1;intro_next_sound=intro_elapsed+42;
            s->gpr[3]=0x9C4A;s->gpr[4]=127;s->gpr[5]=64;s->pc=0x800237A8;
            fprintf(stderr,"[opensmash] intro versus\n");return;
        }
        if(intro_voice>=intro_count){s->pc=s->lr;return;}
        unsigned i=intro_voice++;s->gpr[3]=intro_fighters[i];intro_sample=intro_samples[i];
        intro_next_sound=intro_elapsed+(intro_durations[i]*60+999)/1000;
        fprintf(stderr,"[opensmash] intro announcer port=%u fighter=%u sample=%u\n",intro_ports[i],intro_fighters[i],intro_sample);
    }
    s->gpr[0]=s->lr;s->pc=0x80168C60;
}
static void intro_voice_track(CPUState* s){
    if(intro_active){s->gpr[4]=127;s->gpr[5]=64;s->gpr[6]=INTRO_TRACK;s->pc=0x80023870;return;}
    s->gpr[0]=s->lr;s->pc=0x800243F8;
}
static void intro_audio_banks(CPUState* s){
    if(intro_enabled()&&s->lr>=0x80168FC4&&s->lr<0x80169000&&intro_read(s,0x80479D30,1)==2)
        s->gpr[6]|=0x18; /* nr_select custom names + nr_1p vanilla name scripts */
    s->gpr[0]=s->lr;s->pc=0x80027030;
}
