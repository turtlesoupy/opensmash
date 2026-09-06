/* Host reference: Battleship source math, host libm, synthetic engine frames. */
#include <stdint.h>
#include <string.h>
#include <math.h>
typedef float f32; typedef int32_t s32; typedef uint32_t u32; typedef uint8_t u8; typedef int8_t s8;
typedef struct DObj {struct DObj *parent;} DObj;
typedef struct {float x,y,z;} Vec;
typedef struct {Vec rotate;} DObjDesc;
typedef struct {DObjDesc *commonparts[2];} FTCommonPartContainer;
typedef struct {FTCommonPartContainer *commonparts_container;} Attr;
typedef struct {int fkind,detail_curr; DObj *joints[64]; Attr *attr;} FTStruct;
#define DOBJ_PARENT_NULL ((DObj *)1)
#define nFTPartsJointTopN 0
#define nFTPartsJointCommonStart 4
#define nFTPartsDetailStart 0
#define FTPARTS_JOINT_NUM_MAX 64
#define FTPARTS_GET_DOBJDESC(p) (*(p))
#define PORT_RESOLVE(p) (p)
enum {nFTKindMario,nFTKindFox,nFTKindDonkey,nFTKindSamus,nFTKindLuigi,nFTKindLink,nFTKindYoshi,nFTKindCaptain,nFTKindKirby,nFTKindPikachu,nFTKindPurin,nFTKindNess};
#include "pose_state.h"
#define OSB5_PLAYER_SLOTS 4
static float sShLift[2][3],parent_frame[12];
static int scene,tick;
static int port_current_scene(void) {return scene;}
static int port_get_frame_count(void) {return tick;}
#define getenv(name) ((char *)0)
#define port_log(...) ((void)0)
static void osb5_dobj_frame(DObj *j,float o[3],float m[3][3]) {memcpy(o,parent_frame,12);memcpy(m,parent_frame+3,36);}
#include "native_pose.inc"
void reference_pose(OSB5State *o,float *live,float *top,float *parent,int have_parent,int sc,int kind,int now,float *out,float *lift) {
    FTStruct fp={0};Attr attr={0};DObj joints[64]={0},cp={0};float jo[32][3],jm[32][3][3];int i;
    scene=sc;tick=now;fp.fkind=kind;fp.attr=&attr;
    for(i=0;i<64;i++)fp.joints[i]=&joints[i];
    if(have_parent) {fp.joints[o->joint_ids[0]]->parent=&cp;memcpy(parent_frame,parent,48);}
    for(i=0;i<o->njoints;i++){memcpy(jo[i],live+i*12,12);memcpy(jm[i],live+i*12+3,36);}
    memset(sShLift,0,sizeof(sShLift));o->leg_ratio=0;o->van_leg=0;
    native_pose(o,&fp,0,jo,jm,top,(float (*)[3])(top+3),0);
    for(i=0;i<o->njoints;i++){memcpy(out+i*12,jo[i],12);memcpy(out+i*12+3,jm[i],36);}
    memcpy(lift,sShLift,24);
}
