/* Temporary render transforms: preserve game-owned animation/collision state. */
typedef struct {
    u32 joint;
    float point[3],normal[3];
    u8 slots[4],weights[4];
    float embed,pitch,orient,scale,bind[9];
} SkinPin;
_Static_assert(sizeof(SkinPin)==88,"Accessory pin ABI");
typedef struct {u32 blank[2];float scale,fit;u32 npins;SkinPin pins[1];} SkinRender;
typedef struct {void *dl;u32 flags;
#ifndef SKIN_CLASSIC
s32 mode;float matrix[16];
#endif
} SavedPart;
static SavedPart saved_parts[FTPARTS_JOINT_NUM_MAX];
#ifndef SKIN_CLASSIC
static Frame render_world[FTPARTS_JOINT_NUM_MAX],live_world[FTPARTS_JOINT_NUM_MAX];
static u8 render_done[FTPARTS_JOINT_NUM_MAX],render_active[FTPARTS_JOINT_NUM_MAX],live_valid[FTPARTS_JOINT_NUM_MAX];
static int joint_id(FTStruct *fp,DObj *d) {int j;if(!d || d==DOBJ_PARENT_NULL)return -1;for(j=0;j<FTPARTS_JOINT_NUM_MAX;j++)if(fp->joints[j]==d)return j;return -1;}
static __attribute__((noinline,minsize)) void desired_frame(FTStruct *fp,SkinModel *model,Frame *skin,int id) {
    int j,k,r,c,slot=-1,pid;
    Frame *dst=&render_world[id];SkinRender *cfg=model->render;
    if(render_done[id])return;
    render_done[id]=1;
    pid=joint_id(fp,fp->joints[id]->parent);
    if(pid>=0 && pid!=id)desired_frame(fp,model,skin,pid);
    *dst=live_world[id];
    if(model->flags&1)for(j=0;j<model->njoints;j++)if(model->joints[j].id==id)slot=j;
    if(slot>=0) {
        multiply(dst->m,skin[slot].m,model->joints[slot].bind+3);
        for(r=0;r<3;r++) {dst->o[r]=skin[slot].o[r];for(k=0;k<3;k++)dst->o[r]+=skin[slot].m[r*3+k]*model->joints[slot].bind[k];}
    } else if(pid>=0 && pid!=id && (model->flags&1)) {
        float inv[9],local[9],off[3];
        if(inverse(inv,live_world[pid].m)) {
            multiply(local,inv,live_world[id].m);multiply(dst->m,render_world[pid].m,local);
            for(r=0;r<3;r++){off[r]=0;for(k=0;k<3;k++)off[r]+=inv[r*3+k]*(live_world[id].o[k]-live_world[pid].o[k]);}
            for(r=0;r<3;r++){dst->o[r]=render_world[pid].o[r];for(k=0;k<3;k++)dst->o[r]+=render_world[pid].m[r*3+k]*off[k]*cfg->scale;}
        }
    }
    for(j=0;j<cfg->npins;j++)if(cfg->pins[j].joint==id) {
        SkinPin *pin=&cfg->pins[j];float p[3]={0},n[3]={0},total=0,len;
        for(k=0;k<4;k++)if(pin->weights[k] && pin->slots[k]<model->njoints) {
            Frame *f=&skin[pin->slots[k]];float w=pin->weights[k];total+=w;
            for(r=0;r<3;r++){p[r]+=w*f->o[r];for(c=0;c<3;c++){p[r]+=w*f->m[r*3+c]*pin->point[c];n[r]+=w*f->m[r*3+c]*pin->normal[c];}}
        }
        if(total<=0)continue;
        len=skin_sqrtf(n[0]*n[0]+n[1]*n[1]+n[2]*n[2]);
        for(r=0;r<3;r++)dst->o[r]=p[r]/total-(len>1e-6f?n[r]*pin->embed/len:0);
        if(pin->orient>.5f && (model->flags&1)) {
            float rot[9],rx[9]={1,0,0,0,1,0,0,0,1};
            multiply(rot,skin[0].m,pin->bind);
            /* Native applies pitch in parent-local Euler space. */
            if(pid>=0) {
                float inv[9],local[9];
                if(inverse(inv,render_world[pid].m)) {
                    multiply(local,inv,rot);
                    float x=skin_atan2f(local[7],local[8])+pin->pitch;
                    float sy=local[6]>1.f?1.f:(local[6]<-1.f?-1.f:local[6]);
                    float y=skin_atan2f(-sy,skin_sqrtf(1.f-sy*sy));
                    float z=skin_atan2f(local[3],local[0]);
                    osb5_rpy_to_m3(x,y,z,(float (*)[3])rx);
                    if(pin->scale>0)for(k=0;k<9;k++)rx[k]*=pin->scale;
                    multiply(rot,render_world[pid].m,rx);
                }
            }
            for(k=0;k<9;k++)dst->m[k]=rot[k];
        }
    }
}
#endif
static void render_begin(FTStruct *fp,SkinModel *model,Frame *skin) {
    int j,k,r,c,pid;SkinRender *cfg=model->render;
    if(!cfg)return;
    #ifndef SKIN_CLASSIC
    for(j=0;j<FTPARTS_JOINT_NUM_MAX;j++)render_active[j]=render_done[j]=0;
    for(j=1;j<FTPARTS_JOINT_NUM_MAX;j++)if(fp->joints[j]) {
        int needed=fp->joints[j]->dv && fp->joints[j]->dv!=(void *)model && !((cfg->blank[j/32]>>(j%32))&1);
        for(k=0;k<cfg->npins;k++)if(cfg->pins[k].joint==j)needed=1;
        if(needed){int id=j,guard=0;while(id>=0 && !render_active[id] && guard++<FTPARTS_JOINT_NUM_MAX){render_active[id]=1;id=joint_id(fp,fp->joints[id]->parent);}}
    }
    render_active[0]=1;
    for(j=0;j<FTPARTS_JOINT_NUM_MAX;j++)if(render_active[j] && fp->joints[j] && !live_valid[j])frame(fp->joints[j],&live_world[j]);
    for(j=0;j<FTPARTS_JOINT_NUM_MAX;j++)if(render_active[j] && fp->joints[j])desired_frame(fp,model,skin,j);
    #endif
    for(j=0;j<FTPARTS_JOINT_NUM_MAX;j++)if(fp->joints[j]) {
        DObj *d=fp->joints[j];FTParts *parts=d->user_data.p;SavedPart *save=&saved_parts[j];
        save->dl=d->dv;
        if((cfg->blank[j/32]>>(j%32))&1)d->dv=0;
        if(!parts)continue;
        save->flags=parts->flags;
        #ifndef SKIN_CLASSIC
        if(!render_active[j])continue;
        save->mode=parts->transform_update_mode;
        for(k=0;k<16;k++)save->matrix[k]=((float *)parts->unk_dobjtrans_0x10)[k];
        if(j==0) {parts->flags&=~15u;continue;}
        pid=joint_id(fp,d->parent);
        if(pid>=0) {
            float inv[9],local[9];
            if(!inverse(inv,render_world[pid].m))continue;
            multiply(local,inv,render_world[j].m);
            for(r=0;r<4;r++)for(c=0;c<4;c++)parts->unk_dobjtrans_0x10[r][c]=(r==c);
            for(r=0;r<3;r++) {
                float v=0;for(k=0;k<3;k++)v+=inv[r*3+k]*(render_world[j].o[k]-render_world[pid].o[k]);
                parts->unk_dobjtrans_0x10[3][r]=v;
                for(c=0;c<3;c++)parts->unk_dobjtrans_0x10[c][r]=local[r*3+c];
            }
            parts->transform_update_mode=1;
        }
        #else
        if(j==0)parts->flags&=~15u;
        #endif
    }
}
static void render_end(FTStruct *fp,SkinModel *model) {
    int j,k;if(!model->render)return;
    for(j=0;j<FTPARTS_JOINT_NUM_MAX;j++)if(fp->joints[j]) {
        DObj *d=fp->joints[j];FTParts *parts=d->user_data.p;SavedPart *save=&saved_parts[j];d->dv=save->dl;
        if(parts){parts->flags=save->flags;
#ifndef SKIN_CLASSIC
if(!render_active[j])continue;
parts->transform_update_mode=save->mode;for(k=0;k<16;k++)((float *)parts->unk_dobjtrans_0x10)[k]=save->matrix[k];
#endif
}
    }
}
