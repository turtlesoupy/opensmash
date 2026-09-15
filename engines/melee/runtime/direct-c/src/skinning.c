/* The shared OSSK costume format, using live Melee joints directly. */
#include "pc_runtime.h"
#include <sysdolphin/baselib/pobj.h>
#include <sysdolphin/baselib/jobj.h>
#include <sysdolphin/baselib/list.h>
#include <sysdolphin/baselib/mtx.h>
#include <dolphin/gx.h>
#include <math.h>
#define SKIN_FAIL() do {fprintf(stderr,"[direct-c] invalid skin data at line %d\n",__LINE__);abort();}while(0)
static unsigned be32(const void* p){unsigned n;memcpy(&n,p,4);return __builtin_bswap32(n);}
static float bef(const void* p){unsigned n=be32(p);float f;memcpy(&f,&n,4);return f;}
static void putf(void* p,float f){unsigned n;memcpy(&n,&f,4);n=__builtin_bswap32(n);memcpy(p,&n,4);}
int direct_skin(HSD_PObj* pobj,MtxPtr view,MtxPtr zscale){
 if(!pobj||!pobj->verts)return 0;
 unsigned* attrs=(unsigned*)pobj->verts;
 if(attrs[24]!=255||be32(attrs+25)!=0x4f53534b)return 0;
 unsigned* meta=(unsigned*)attrs[29];if(be32(meta)!=0x4f53534b||be32(meta+1)!=1)SKIN_FAIL();
 unsigned vertices=be32(meta+2),envelopes=be32(meta+3),bones=be32(meta+4);
 if(!vertices||vertices>65535||!envelopes||envelopes>65535||!bones||bones>128)SKIN_FAIL();
 float* src=(float*)meta[5];float* normal=(float*)meta[6];unsigned** records=(unsigned**)meta[7];unsigned short* vertexenv=(unsigned short*)meta[8];float* dst=(float*)meta[9];float* dstnormal=(float*)meta[10];
 static unsigned oracle_draws;int verify=oracle_draws<4;float oracle_error=0;
 static Mtx transforms[128];static Mtx* posed;static Mtx* normals;static unsigned capacity;
 if(capacity<envelopes){posed=realloc(posed,envelopes*sizeof(Mtx));normals=realloc(normals,envelopes*sizeof(Mtx));if(!posed||!normals)SKIN_FAIL();capacity=envelopes;}
 HSD_Envelope* e=pobj->u.envelope_list->data;
 for(unsigned i=0;i<bones;i++){if(!e||!e->jobj||!e->jobj->envelopemtx){fprintf(stderr,"skin bone %u/%u node=%p joint=%p\n",i,bones,e,e?e->jobj:NULL);SKIN_FAIL();}HSD_JObjSetupMatrix(e->jobj);PSMTXConcat(e->jobj->mtx,e->jobj->envelopemtx,transforms[i]);e=e->next;}
 for(unsigned i=0;i<envelopes;i++){
  unsigned* record=records[i],count=be32(record);if(!count||count>8)SKIN_FAIL();Mtx blended={0},scaled;
  for(unsigned j=0;j<count;j++){unsigned bone=be32(record+1+j*2);float weight=bef(record+2+j*2);if(bone>=bones||!isfinite(weight))SKIN_FAIL();for(int r=0;r<3;r++)for(int c=0;c<4;c++)blended[r][c]=fmaf(weight,transforms[bone][r][c],blended[r][c]);}
  if(verify){Mtx reference={0};for(unsigned j=0;j<count;j++)HSD_MtxScaledAdd(transforms[be32(record+1+j*2)],reference,reference,bef(record+2+j*2));for(int r=0;r<3;r++)for(int c=0;c<4;c++){float error=fabsf(reference[r][c]-blended[r][c]);if(error>oracle_error)oracle_error=error;if(error>1e-4f*(1+fabsf(reference[r][c])))SKIN_FAIL();}}
  PSMTXConcat(view,blended,posed[i]);if(zscale){PSMTXConcat(zscale,posed[i],scaled);HSD_MtxInverseTranspose(scaled,normals[i]);}else HSD_MtxInverseTranspose(posed[i],normals[i]);
 }
 for(unsigned i=0;i<vertices;i++){
  unsigned env=__builtin_bswap16(vertexenv[i]);if(env>=envelopes)SKIN_FAIL();float p[3],n[3];for(int c=0;c<3;c++){p[c]=bef(src+i*3+c);n[c]=bef(normal+i*3+c);}
  for(int r=0;r<3;r++){float x=posed[env][r][0]*p[0]+posed[env][r][1]*p[1]+posed[env][r][2]*p[2]+posed[env][r][3],v=normals[env][r][0]*n[0]+normals[env][r][1]*n[1]+normals[env][r][2]*n[2];if(!isfinite(x)||!isfinite(v)){fprintf(stderr,"skin nonfinite vertex=%u env=%u axis=%d p=%g,%g,%g n=%g,%g,%g posed=%g,%g,%g,%g normal=%g,%g,%g view=%g,%g,%g,%g\n",i,env,r,p[0],p[1],p[2],n[0],n[1],n[2],posed[env][r][0],posed[env][r][1],posed[env][r][2],posed[env][r][3],normals[env][r][0],normals[env][r][1],normals[env][r][2],view[r][0],view[r][1],view[r][2],view[r][3]);SKIN_FAIL();}putf(dst+i*3+r,x);putf(dstnormal+i*3+r,v);}
 }
 if(verify){oracle_draws++;fprintf(stderr,"[opensmash] skin oracle draw=%u envelopes=%u max_matrix_error=%g\n",oracle_draws,envelopes,oracle_error);}
 Mtx identity;PSMTXIdentity(identity);HSD_PObjClearMtxMark(NULL,HSD_MTX_ENVELOPE);GXLoadPosMtxImm(identity,GX_PNMTX0);GXLoadNrmMtxImm(identity,GX_PNMTX0);
 static int logged;if(!logged){logged=1;fprintf(stderr,"[opensmash] direct skinning vertices=%u envelopes=%u bones=%u\n",vertices,envelopes,bones);}return 1;
}
