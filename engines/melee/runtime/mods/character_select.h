/* GALE01 1.02 CSS identities. OSCS data lives in the scene's own HSD archive;
 * no persistent pointers into a fighter heap and no texture changes in combat. */
#define CSS_ICONS 0x803F0B24u
#define CSS_DOORS 0x803F0DFCu
static unsigned css_registry, css_count, css_page, css_pages;
static unsigned css_selected[4], css_audio_selection[256];
static unsigned css_current_door=4, css_saved_trigger, css_trigger_address;
static unsigned css_get8(CPUState* s,unsigned p){return moderngekko_mod_read(s,p,1);}
static unsigned css_row(unsigned n){return n?css_registry+16+(n-1)*32:0;}
static unsigned css_for_slot(CPUState* s,unsigned fighter,unsigned color){
    for(unsigned i=1;i<=css_count;i++) {
        unsigned r=css_row(i);
        if(read32(s,r)==fighter && read32(s,r+4)==color)return i;
    }
    return 0;
}
static unsigned css_color_count(unsigned fighter){
    switch(fighter){case 0:return 6;case 2:case 7:return 4;case 6:case 8:case 9:return 5;default:return 0;}
}
static unsigned css_vanilla_color(CPUState* s,unsigned fighter){
    for(unsigned color=0;color<css_color_count(fighter);color++)
        if(!css_for_slot(s,fighter,color))return color;
    return 255;
}
static unsigned css_for_page(CPUState* s,unsigned fighter){
    for(unsigned i=1;i<=css_count;i++) {
        unsigned r=css_row(i);
        if(read32(s,r)==fighter && read32(s,r+8)==css_page)return i;
    }
    /* If every costume is injected, never advertise an unavailable vanilla. */
    if(css_color_count(fighter) && css_vanilla_color(s,fighter)==255)
        return css_for_slot(s,fighter,0);
    return 0;
}
static unsigned css_player(CPUState* s,unsigned door){
    unsigned port=door;
    if(css_get8(s,0x804D6CF5)==1)port=css_get8(s,door?0x804D6CF1:0x804D6CF0);
    unsigned data=read32(s,0x804D6CB0);
    return presentation_pointer(data)&&port<6?data+0x70+port*0x24:0;
}
static void css_keep_color(CPUState* s,unsigned door){
    unsigned n=css_selected[door],player=css_player(s,door);
    if(!n){
        unsigned icon=css_get8(s,CSS_DOORS+door*0x24+0xe);if(icon>=25)return;
        unsigned fighter=css_get8(s,CSS_ICONS+icon*28+1),color=css_get8(s,CSS_DOORS+door*0x24+0xd);
        if(css_for_slot(s,fighter,color)){
            color=css_vanilla_color(s,fighter);
            if(color<255){write8(s,CSS_DOORS+door*0x24+0xd,color);if(player)write8(s,player+3,color);}
        }
        return;
    }
    unsigned r=css_row(n);
    write8(s,CSS_DOORS+door*0x24+0xd,read32(s,r+4));
    if(player){write8(s,player,read32(s,r));write8(s,player+3,read32(s,r+4));}
}
static void css_enter_identity(CPUState* s){
    css_registry=css_count=css_page=0;css_pages=1;css_current_door=4;
    memset(css_selected,0,sizeof(css_selected));memset(css_audio_selection,0,sizeof(css_audio_selection));
    unsigned archive=read32(s,0x804D6CD0);
    if(!presentation_pointer(archive))return;
    unsigned data=read32(s,archive+0x20),table=read32(s,archive+0x28),count=read32(s,archive+0xc);
    if(!presentation_pointer(data)||!presentation_pointer(table)||count>100)return;
    for(unsigned i=0;i<count;i++) {
        unsigned r=data+read32(s,table+i*8);
        if(presentation_pointer(r)&&read32(s,r)==0x4f534353 && read32(s,r+4)==1) {
            unsigned n=read32(s,r+8),pages=read32(s,r+12);
            if(n>29||pages<2||pages>7)return;
            css_registry=r;css_count=n;css_pages=pages;break;
        }
    }
    if(!css_registry)return;
    unsigned preferences=read32(s,0x804D3EE0);
    if(presentation_pointer(preferences)) {
        moderngekko_mod_write(s,preferences+0x1868,0x7ff,2);
        moderngekko_mod_write(s,preferences+0x186a,0x7ff,2);
    }
    for(unsigned door=0;door<4;door++) {
        unsigned player=css_player(s,door);if(!player)continue;
        css_selected[door]=css_for_slot(s,css_get8(s,player),css_get8(s,player+3));
        if(css_selected[door] && !css_page)css_page=read32(s,css_row(css_selected[door])+8);
    }
    fprintf(stderr,"[opensmash] CSS injection entries=%u pages=%u page=%u\n",css_count,css_pages,css_page);
}
static void css_exit_identity(CPUState* s){
    intro_capture(s,css_registry,css_count);
    if(css_registry)for(unsigned i=0;i<4;i++)css_keep_color(s,i);
}
static void css_exited_identity(CPUState* s){(void)s;css_registry=css_count=0;}
static void css_door_identity(CPUState* s){
    if(!css_registry)return;
    unsigned door=s->gpr[3];if(door>=4)return;
    unsigned icon=css_get8(s,CSS_DOORS+door*0x24+0xe),model=read32(s,0x804A0BD0+door*4);
    if(icon>=25){css_selected[door]=0;return;}
    if(presentation_pointer(model)&&css_get8(s,model+5))
        css_selected[door]=css_for_page(s,css_get8(s,CSS_ICONS+icon*28+1));
    css_keep_color(s,door);
}
static void css_cursor_begin(CPUState* s){
    css_current_door=4;css_trigger_address=0;
    if(!css_registry||css_get8(s,0x804D6CF6))return;
    unsigned cursor=read32(s,s->gpr[3]+0x2c);
    if(!presentation_pointer(cursor))return;
    unsigned port=css_get8(s,cursor+4),door=css_get8(s,cursor+6);
    if(css_get8(s,0x804D6CF5)==1)port=css_get8(s,0x804D6CF0);
    if(port>=4)return;
    css_current_door=door<4?door:port;
    unsigned trigger=0x804C20BC+port*0x44+8,buttons=read32(s,trigger);
    float x=presentation_float(s,cursor+0xc),y=presentation_float(s,cursor+0x10);
    int direction=0;
    /* The corners are outside every original icon and player-panel hitbox. */
    if((buttons&0x100)&&y>-1&&y<6) {
        if(x>-31&&x<-24)direction=-1;
        if(x>24&&x<31)direction=1;
    }
    if(direction) {
        css_page=(css_page+css_pages+direction)%css_pages;
        css_trigger_address=trigger;css_saved_trigger=buttons;
        moderngekko_mod_write(s,trigger,buttons&~0x100u,4);
        fprintf(stderr,"[opensmash] CSS page=%u port=%u\n",css_page,port);
    }
}
static void css_cursor_end(CPUState* s){
    if(css_trigger_address)moderngekko_mod_write(s,css_trigger_address,css_saved_trigger,4);
    css_trigger_address=0;css_current_door=4;
}
/* Store identity per audio track when a name is requested. The sound driver
 * processes scripts later, so a global 'last character' would race other ports. */
static void css_announce(CPUState* s){
    if(!css_registry)return;
    unsigned track=s->gpr[6],name=s->gpr[3];
    if(track<0x8a||track>=0x8a+25)return;
    unsigned icon=track-0x8a;
    if(name!=read32(s,CSS_ICONS+icon*28+8))return;
    unsigned n=css_current_door<4?css_selected[css_current_door]:0;
    css_audio_selection[track]=n;
}
static void css_voice_patch(CPUState* s){
    unsigned track=s->gpr[9];
    if(css_registry && s->gpr[3]>=295 && s->gpr[3]<318)s->gpr[3]+=0x7000-295;
    if(css_registry && track<256 && css_audio_selection[track]) {
        unsigned n=css_audio_selection[track];
        s->gpr[3]=read32(s,css_row(n)+12);
        s->fpr[1]=s->fpr[2]=1.; /* WAVs are already recorded at their intended pitch. */
        fprintf(stderr,"[opensmash] CSS announcer entry=%u sample=%u\n",n,s->gpr[3]);
    }
    if(intro_active && track==INTRO_TRACK && intro_sample){
        s->gpr[3]=intro_sample;s->fpr[1]=s->fpr[2]=1.;
        fprintf(stderr,"[opensmash] intro custom voice sample=%u\n",intro_sample);
    }
    /* Retail entry: mflr r0. Keep the original mixer, volume and voice groups. */
    s->gpr[0]=s->lr;s->pc=0x803896F4;
}
/* Replace only for the CSS GX callback, restoring every field afterwards.
 * Melee's material animation tables and shared vanilla portraits stay intact. */
static struct {unsigned address,value;} css_draw_saved[128];
static unsigned css_draw_count;
static void css_draw_write(CPUState* s,unsigned p,unsigned value){
    if(css_draw_count>=128)return;
    css_draw_saved[css_draw_count].address=p;css_draw_saved[css_draw_count++].value=read32(s,p);
    moderngekko_mod_write(s,p,value,4);
}
static unsigned css_joint_at(CPUState* s,unsigned root,unsigned* index,unsigned wanted,unsigned depth){
    if(depth>64)return 0;
    for(unsigned n=0;presentation_pointer(root)&&n<256;n++,root=read32(s,root+8)) {
        if((*index)++==wanted)return root;
        unsigned found=css_joint_at(s,read32(s,root+0x10),index,wanted,depth+1);if(found)return found;
    }
    return 0;
}
static unsigned css_joint(CPUState* s,unsigned root,unsigned index){unsigned n=0;return css_joint_at(s,root,&n,index,0);}
static void css_joint_image(CPUState* s,unsigned joint,unsigned image){
    if(!presentation_pointer(joint)||!presentation_pointer(image))return;
    unsigned target=0;
    /* Portrait is the final textured DObj; the preceding I4 texture is its mask. */
    for(unsigned d=read32(s,joint+0x18),n=0;presentation_pointer(d)&&n<16;d=read32(s,d+4),n++) {
        unsigned m=read32(s,d+8);if(!presentation_pointer(m))continue;
        unsigned t=read32(s,m+8);if(presentation_pointer(t))target=t;
    }
    if(target){css_draw_write(s,target+88,image);css_draw_write(s,target+92,0);}
}
static void css_draw_begin(CPUState* s){
    if(!css_registry)return;
    for(unsigned door=0;door<4;door++) {
        unsigned model=read32(s,0x804A0BD0+door*4);
        if(!presentation_pointer(model)||read32(s,model)!=s->gpr[3]||css_get8(s,model+5))continue;
        unsigned icon=css_get8(s,CSS_DOORS+door*0x24+0xe);if(icon>=25)continue;
        unsigned visible=css_for_page(s,css_get8(s,CSS_ICONS+icon*28+1));
        if(visible!=css_selected[door]) {
            unsigned joint=read32(s,s->gpr[3]+0x28);
            if(presentation_pointer(joint))css_draw_write(s,joint+0x14,(read32(s,joint+0x14)&~0x701c0000u)|16);
        }
    }
    if(s->gpr[3]!=read32(s,0x804D6CBC))return;
    unsigned root=read32(s,0x804D6CC0);if(!presentation_pointer(root))return;
    for(unsigned icon=0;icon<25;icon++) {
        unsigned n=css_for_page(s,css_get8(s,CSS_ICONS+icon*28+1));if(!n)continue;
        unsigned id=css_get8(s,CSS_ICONS+icon*28+(css_get8(s,0x804D6CF5)==1?5:4));
        css_joint_image(s,css_joint(s,root,id),read32(s,css_row(n)+16));
    }
    for(unsigned door=0;door<4;door++) {
        unsigned n=css_selected[door];if(!n)continue;
        unsigned id=css_get8(s,CSS_DOORS+door*0x24+1);
        if(css_get8(s,0x804D6CF5)==1){if(door)continue;id=0x2d;}
        css_joint_image(s,css_joint(s,root,id),read32(s,css_row(n)+20));
    }
}
static void css_draw_end(CPUState* s){
    while(css_draw_count){--css_draw_count;moderngekko_mod_write(s,css_draw_saved[css_draw_count].address,css_draw_saved[css_draw_count].value,4);}
}

/* Keep hooks out of the GObj scheduler's native chunk. Its return-hook
 * fallback stalls menu/result rendering in the native runtime. DispAll already
 * has the stature patch; restrict CSS overrides to the GObj render call site. */
static void css_draw_root_begin(CPUState* s){
    if(!css_registry || s->lr!=0x803910A0)return;
    unsigned root=s->gpr[3],gobj=0;
    if(root==read32(s,0x804D6CC0))gobj=read32(s,0x804D6CBC);
    else for(unsigned door=0;door<4;door++){
        unsigned model=read32(s,0x804A0BD0+door*4);
        if(!presentation_pointer(model))continue;
        unsigned candidate=read32(s,model);
        if(presentation_pointer(candidate)&&read32(s,candidate+0x28)==root){gobj=candidate;break;}
    }
    if(gobj){s->gpr[3]=gobj;css_draw_begin(s);s->gpr[3]=root;}
}
static void css_draw_root_end(CPUState* s){
    if(s->lr==0x803910A0)css_draw_end(s);
}

static void css_name_patch(CPUState* s){
    /* The verified DB34 name call retains the door in r31. */
    unsigned door=s->lr==0x8025DBEC?s->gpr[31]:4;
    if(css_registry && door<4) {
        unsigned arg=s->gpr[3];s->gpr[3]=door;css_door_identity(s);s->gpr[3]=arg;
    }
    if(css_registry && door<4 && css_selected[door]) {
        unsigned row=css_row(css_selected[door]);
        if(read32(s,row)==s->gpr[3]) {
            s->gpr[3]=read32(s,row+24);s->pc=s->lr;return;
        }
    }
    /* Retail entry: mflr r0. Observational hooks cannot replace return values. */
    s->gpr[0]=s->lr;s->pc=0x80160984;
}
