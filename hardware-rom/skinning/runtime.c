/* ROM-only CPU skinning. No host filesystem, registry, or website code. */
#include <ft/fighter.h>

typedef struct {
    u32 id;
    s32 parent;
    f32 bind[12];
    f32 target_inv[9];
} SkinJoint;
typedef struct {
    s16 bind[3];
    u8 joint[4], weight[4];
    u16 pad;
} SkinVertex;
typedef struct {
    Gfx stop;
    u32 magic;
    void *bootstrap;
    u32 code_offset;
    u32 code_size;
    u32 nverts, nout, njoints, flags;
    SkinJoint *joints;
    SkinVertex *vertices;
    u16 *output_map;
    Vtx *template;
    Gfx *display_list;
    f32 root_offset[3];
    u32 failures;
    void *parity;
    void *render;
    u32 code_ready;
} SkinModel;
typedef struct { f32 o[3], m[9]; } Frame;
_Static_assert(__builtin_offsetof(GObj,user_data)==0x84,"GObj ABI changed");
_Static_assert(__builtin_offsetof(FTStruct,joints)==0x8e8,"Fighter ABI changed");
_Static_assert(__builtin_offsetof(DObj,dl)==0x50,"DObj ABI changed");
_Static_assert(__builtin_offsetof(SkinModel,code_offset)==16,"Bootstrap ABI changed");
_Static_assert(__builtin_offsetof(SkinModel,root_offset)==60,"Model ABI changed");
_Static_assert(sizeof(SkinVertex)==16 && sizeof(SkinJoint)==92,"Skin records changed");

#define WORLD ((void (*)(DObj *,Vec3f *))0x800edf24)
#define DRAW ((void (*)(DObj *))0x800f1e60)
#define HEAP ((SYMallocRegion *)0x800465d8)
#define HEADS ((Gfx **)0x800465b0)
#define INLINE static __attribute__((always_inline)) inline

INLINE void frame(DObj *joint, Frame *out)
{
    Vec3f origin={0,0,0}, basis;
    int axis, r;
    WORLD(joint,&origin);
    out->o[0]=origin.x; out->o[1]=origin.y; out->o[2]=origin.z;
    for (axis=0;axis<3;axis++) {
        basis.x=basis.y=basis.z=0;
        ((f32 *)&basis)[axis]=64;
        WORLD(joint,&basis);
        for(r=0;r<3;r++) out->m[r*3+axis]=(((f32 *)&basis)[r]-out->o[r])/64;
    }
}
INLINE void multiply(f32 *out, const f32 *a, const f32 *b)
{
    int r,c;
    for(r=0;r<3;r++) for(c=0;c<3;c++)
        out[r*3+c]=a[r*3]*b[c]+a[r*3+1]*b[c+3]+a[r*3+2]*b[c+6];
}
INLINE int inverse(f32 *out,const f32 *m)
{
    f32 d=m[0]*(m[4]*m[8]-m[5]*m[7])-m[1]*(m[3]*m[8]-m[5]*m[6])+m[2]*(m[3]*m[7]-m[4]*m[6]);
    /* Reject zeroed/stale first-frame transforms and non-finite values. */
    if (!((d>0.000001f && d<1000000.f)||(d<-.000001f && d>-1000000.f))) return 0;
    out[0]=(m[4]*m[8]-m[5]*m[7])/d; out[1]=(m[2]*m[7]-m[1]*m[8])/d;
    out[2]=(m[1]*m[5]-m[2]*m[4])/d; out[3]=(m[5]*m[6]-m[3]*m[8])/d;
    out[4]=(m[0]*m[8]-m[2]*m[6])/d; out[5]=(m[2]*m[3]-m[0]*m[5])/d;
    out[6]=(m[3]*m[7]-m[4]*m[6])/d; out[7]=(m[1]*m[6]-m[0]*m[7])/d;
    out[8]=(m[0]*m[4]-m[1]*m[3])/d;
    return 1;
}

#include "parity.h"
_Static_assert(sizeof(OSB5State)==124+92*SKIN_JOINT_CAP,"Parity state ABI");
#include "render_state.h"

__attribute__((visibility("hidden"),section(".text.entry")))
void skin_draw(GObj *gobj,SkinModel *model)
{
    FTStruct *fp=ftGetStruct(gobj);
    Frame top, skin[SKIN_JOINT_CAP],local_skin[SKIN_JOINT_CAP];
    float local_lift[2][3];
    f32 delta[SKIN_JOINT_CAP][9], top_inv[9];
    Vtx *out;
    u32 begin,end;
    int j,r,k,i;
    Gfx *saved;
    Vec3f original_scale;
    float fit=1.f;
    if (model->njoints>SKIN_JOINT_CAP || model->nverts>2000 || model->nout!=model->nverts || !fp->joints[0]) return;
    begin=((u32)HEAP->ptr+15)&~15u;
    end=begin+model->nout*sizeof(Vtx);
    if (end<begin || end>(u32)HEAP->end) {model->failures++;return;}
    out=(Vtx *)begin;
    original_scale=fp->joints[0]->scale.vec.f;
    if(model->render) {
        SkinRender *cfg=model->render;
        if(cfg->fit<.995f)fit=cfg->fit;
        if((model->flags&1) && osb5_on_menu_scene()) {
            if(fp->fkind==nFTKindKirby)fit*=.58f;
            if(fp->fkind==nFTKindPurin)fit*=.66f;
        }
    }
    fp->joints[0]->scale.vec.f.x*=fit;
    fp->joints[0]->scale.vec.f.y*=fit;
    fp->joints[0]->scale.vec.f.z*=fit;
    ((void (*)(DObj *))0x800eb528)(fp->joints[0]);
    frame(fp->joints[0],&top);
    if (!inverse(top_inv,top.m)) {model->failures++;goto restore_scale;}
    #ifndef SKIN_CLASSIC
    for(j=0;j<FTPARTS_JOINT_NUM_MAX;j++)live_valid[j]=0;
    live_world[0]=top;live_valid[0]=1;
    #endif
    for(j=0;j<model->njoints;j++) {
        SkinJoint *joint=&model->joints[j];
        if (joint->id>=FTPARTS_JOINT_NUM_MAX || !fp->joints[joint->id]) {model->failures++;goto restore_scale;}
        frame(fp->joints[joint->id],&skin[j]);
        #ifndef SKIN_CLASSIC
        live_world[joint->id]=skin[j];live_valid[joint->id]=1;
        #endif
    }
    if (model->flags&1) {
#ifndef SKIN_CLASSIC
        OSB5State *o=model->parity;
        static float jo[SKIN_JOINT_CAP][3],jm[SKIN_JOINT_CAP][3][3];
        if(!o || o->njoints!=model->njoints) {model->failures++;goto restore_scale;}
        for(j=0;j<model->njoints;j++) {
            memcpy(jo[j],skin[j].o,12);memcpy(jm[j],skin[j].m,36);
        }
        memset(sShLift,0,sizeof(sShLift));
        o->leg_ratio=0; o->van_leg=0;
        native_pose(o,fp,(unsigned)fp->player<4?fp->player:0,jo,jm,top.o,(float (*)[3])top.m,(float (*)[3][3])delta);
        for(j=0;j<model->njoints;j++) {
            memcpy(skin[j].m,delta[j],36);
            memcpy(skin[j].o,jo[j],12);
        }
#else
        model->failures++;goto restore_scale;
#endif
    }
    else {
        for(j=0;j<model->njoints;j++) {
            multiply(delta[j],skin[j].m,model->joints[j].target_inv);
            for(r=0;r<9;r++) skin[j].m[r]=delta[j][r];
        }
    }
    /* Precompose inverse bind once per bone instead of storing four bind-local
     * positions for every vertex. All vertices share one bind-space point. */
    for(j=0;j<model->njoints;j++) for(r=0;r<3;r++)
        for(k=0;k<3;k++) skin[j].o[r]-=skin[j].m[r*3+k]*model->joints[j].bind[k];
    /* Localize each bone once. Blend its matrix once per vertex and reuse
     * that blend for both position and normal. This is the same LBS algebra. */
    for(j=0;j<model->njoints;j++) {
        multiply(local_skin[j].m,top_inv,skin[j].m);
        for(r=0;r<3;r++) {local_skin[j].o[r]=0;for(k=0;k<3;k++)local_skin[j].o[r]+=top_inv[r*3+k]*(skin[j].o[k]-top.o[k]);}
    }
    for(j=0;j<2;j++)for(r=0;r<3;r++){local_lift[j][r]=0;for(k=0;k<3;k++)local_lift[j][r]+=top_inv[r*3+k]*sShLift[j][k];}
    for(i=0;i<model->nverts;i++) {
        SkinVertex *v=&model->vertices[i];
        Frame blend={0};float total=0,reciprocal,n[3];
        if(model->output_map[i]!=i) {model->failures++;goto restore_scale;}
        for(j=0;j<4;j++)if(v->weight[j]) {
            Frame *f;float w=v->weight[j];
            if(v->joint[j]>=model->njoints){model->failures++;goto restore_scale;}
            f=&local_skin[v->joint[j]];total+=w;
            for(k=0;k<9;k++)blend.m[k]+=w*f->m[k];
            for(r=0;r<3;r++)blend.o[r]+=w*f->o[r];
        }
        if(total<=0){model->failures++;goto restore_scale;}
        reciprocal=1.f/total;
        out[i]=model->template[i];
        for(r=0;r<3;r++) {
            float p=(blend.o[r]+blend.m[r*3]*v->bind[0]+blend.m[r*3+1]*v->bind[1]+blend.m[r*3+2]*v->bind[2])*reciprocal;
#ifndef SKIN_CLASSIC
            if(model->flags&1) {
                OSB5State *o=model->parity;u8 *prox=(u8 *)(o+1)+i*4;
                for(j=0;j<o->nsh;j++)p+=(float)prox[j]*(1.f/255.f)*(1.f-(float)prox[2]*(1.f/255.f))*local_lift[j][r];
            }
#endif
            if(!(p>-32767 && p<32767)){model->failures++;goto restore_scale;}
            out[i].v.ob[r]=(s16)p;
        }
        if(model->render) {
            SkinRender *cfg=model->render;s8 *normal=(s8 *)cfg+20+cfg->npins*sizeof(SkinPin)+i*4;
            float length;
            for(r=0;r<3;r++)n[r]=blend.m[r*3]*normal[0]+blend.m[r*3+1]*normal[1]+blend.m[r*3+2]*normal[2];
            length=skin_sqrtf(n[0]*n[0]+n[1]*n[1]+n[2]*n[2]);
            if(length>1e-6f){float scale=127.f/length;for(r=0;r<3;r++)out[i].n.n[r]=(s8)(n[r]*scale);}
        }
    }
    /* Output vertices live until this graphics context is recycled. */
    HEAP->ptr=(void *)end;
    /* Segments E and F belong to the engine's matrices/framebuffer. */
    HEADS[0]->words.w0=0xdb060034;
    HEADS[0]->words.w1=begin&0x1fffffff;
    HEADS[0]++;
    render_begin(fp,model,skin);
    saved=fp->joints[0]->dl;
    fp->joints[0]->dl=model->display_list;
    DRAW(DObjGetStruct(gobj));
    fp->joints[0]->dl=saved;
    render_end(fp,model);
restore_scale:
    fp->joints[0]->scale.vec.f=original_scale;
    ((void (*)(DObj *))0x800eb528)(fp->joints[0]);
}

/* LLVM can lower aggregate copies into libc calls even in freestanding mode. */
#undef memcpy
#undef memset
__attribute__((visibility("hidden"))) void *memcpy(void *d,const void *s,unsigned n) {return skin_memcpy(d,s,n);}
__attribute__((visibility("hidden"))) void *memset(void *d,int v,unsigned n) {return skin_memset(d,v,n);}
