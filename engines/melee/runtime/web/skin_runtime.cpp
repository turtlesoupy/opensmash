// Browser-only custom-mesh skinning. Melee still owns animation, physics and cameras.
#include "core/cpu.h"
#include "moderngekko/module_abi.h"
#include <array>
#include <vector>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
extern "C" const ModernGekkoModuleDesc* staticrecomp_get_module();
namespace {
using Matrix=std::array<float,12>;
constexpr unsigned Magic=0x4f53534b;
bool ram(CPUState* s,unsigned p,unsigned n){return get_ram_ptr(s,p,n,nullptr)!=nullptr;}
float readf(CPUState* s,unsigned p){unsigned bits=mem_read32(s,p);float x;std::memcpy(&x,&bits,4);return x;}
void writef(CPUState* s,unsigned p,float x){unsigned bits;std::memcpy(&bits,&x,4);mem_write32(s,p,bits);}
[[noreturn]] void fail(const char* why){std::fprintf(stderr,"[opensmash] guest assert browser skin: %s\n",why);std::abort();}
void call(CPUState* s,unsigned function,unsigned a=0,unsigned b=0,unsigned c=0,float weight=0){
    CPUState guest=*s;
    guest.gpr[1]-=2048;guest.gpr[3]=a;guest.gpr[4]=b;guest.gpr[5]=c;
    guest.fpr[1]=weight;guest.ps1[1]=weight;
    guest.lr=0xfffffff0;guest.pc=function;guest.downcount=0;
    const auto* module=staticrecomp_get_module();
    for(unsigned steps=0;guest.pc!=0xfffffff0;steps++){
        if(steps>100000||guest.exception||!module->dispatch(&guest,guest.pc)){
            std::fprintf(stderr,"[opensmash] skin call function=%08x pc=%08x lr=%08x steps=%u exception=%08x msr=%08x\n",function,guest.pc,guest.lr,steps,guest.exception,guest.msr);
            fail("joint/matrix call did not return");
        }
    }
    s->downcount+=guest.downcount;
}
Matrix readm(CPUState* s,unsigned p){if(!ram(s,p,48))fail("matrix outside game RAM");Matrix m;for(unsigned i=0;i<12;i++)m[i]=readf(s,p+i*4);return m;}
Matrix concat(const Matrix& a,const Matrix& b){
    Matrix out;
    for(unsigned r=0;r<3;r++)for(unsigned c=0;c<4;c++){
        float x=b[c]*a[r*4];x=b[4+c]*a[r*4+1]+x;x=b[8+c]*a[r*4+2]+x;
        if(c==3)x+=a[r*4+3];out[r*4+c]=x;
    }return out;
}
float fmadd(float a,float c,float b){
    // The binary32 product is exact in binary64; retain PPC's single-rounding correction.
    double x=double(a)*double(c)+double(b);auto bits=f64_bits(x);
    if((bits&0x1fffffffULL)==0x10000000ULL){
        double ap=double(b)-x,bp=x+ap;
        double error=(double(a)*double(c)+ap)+(double(b)-bp);
        if(error!=0){bits+=((error>0)==(x>0))?1:-1;x=f64_value(bits);}
    }return float(x);
}
Matrix inverse_transpose(const Matrix& m){
    float det=m[0]*m[5]*m[10]+m[1]*m[6]*m[8]+m[2]*m[4]*m[9]
             -m[8]*m[5]*m[2]-m[4]*m[1]*m[10]-m[0]*m[9]*m[6];
    if(std::abs(det)<1e-10f)return m;
    const float d=1.0f/det;
    return {(m[5]*m[10]-m[9]*m[6])*d,-(m[4]*m[10]-m[8]*m[6])*d,(m[4]*m[9]-m[8]*m[5])*d,0,
            -(m[1]*m[10]-m[9]*m[2])*d,(m[0]*m[10]-m[8]*m[2])*d,-(m[0]*m[9]-m[8]*m[1])*d,0,
            (m[1]*m[6]-m[5]*m[2])*d,-(m[0]*m[6]-m[4]*m[2])*d,(m[0]*m[5]-m[4]*m[1])*d,0};
}
}
extern "C" bool opensmash_skinning(CPUState* s){
    const unsigned pobj=s->gpr[3],view=s->gpr[4];
    if(!ram(s,pobj,24))return false;
    const unsigned desc=mem_read32(s,pobj+8);
    if(!ram(s,desc,120)||mem_read32(s,desc+96)!=255||mem_read32(s,desc+100)!=Magic)return false;
    const unsigned meta=mem_read32(s,desc+116);
    if(!ram(s,meta,48)||mem_read32(s,meta)!=Magic||mem_read32(s,meta+4)!=1)fail("invalid mesh descriptor");
    // Enter through the original instruction again after Melee's lazy-FPU
    // exception handler restores this thread's floating-point state.
    if(!ppc_fp_available(s,s->pc))return true;
    unsigned vertices=mem_read32(s,meta+8),envelopes=mem_read32(s,meta+12),bones=mem_read32(s,meta+16);
    if(!vertices||vertices>65535||!envelopes||envelopes>65535||!bones||bones>128)fail("mesh limits");
    const unsigned src=mem_read32(s,meta+20),normal=mem_read32(s,meta+24),records=mem_read32(s,meta+28),vertexenv=mem_read32(s,meta+32),dst=mem_read32(s,meta+36),dstnormal=mem_read32(s,meta+40);
    if(!ram(s,src,vertices*12)||!ram(s,normal,vertices*12)||!ram(s,dst,vertices*12)||!ram(s,dstnormal,vertices*12)||!ram(s,records,envelopes*4)||!ram(s,vertexenv,vertices*2))fail("mesh array outside RAM");
    const Matrix camera=readm(s,view);
    const bool zscale=s->pc==0x80074048u && (mem_read8(s,0x80459270u)&0x80)!=0;
    const Matrix scale=zscale?readm(s,0x80459240u):Matrix{};
    static std::vector<Matrix> transforms,posed,normals;
    static std::vector<unsigned> jointPointers;
    jointPointers.resize(bones);
    transforms.resize(bones);posed.resize(envelopes);normals.resize(envelopes);
    unsigned list=mem_read32(s,pobj+20);
    if(!ram(s,list,8))fail("missing live bone list");
    unsigned envelope=mem_read32(s,list+4);
    for(unsigned i=0;i<bones;i++){
        if(!ram(s,envelope,12))fail("incomplete live bone list");
        unsigned joint=mem_read32(s,envelope+4);
        if(!ram(s,joint,0x88))fail("invalid live joint");
        jointPointers[i]=joint;
        unsigned flags=mem_read32(s,joint+0x14);
        if(!(flags&0x800000)&&(flags&0x40))call(s,0x80373078,joint);
        transforms[i]=concat(readm(s,joint+0x44),readm(s,mem_read32(s,joint+0x78)));
        envelope=mem_read32(s,envelope);
    }
    for(unsigned i=0;i<envelopes;i++){
        unsigned record=mem_read32(s,records+i*4);
        if(!ram(s,record,4))fail("invalid envelope record");
        unsigned count=mem_read32(s,record);
        if(!count||count>8||!ram(s,record+4,count*8))fail("invalid influence count");
        Matrix blended{};
        for(unsigned j=0;j<count;j++){
            unsigned bone=mem_read32(s,record+4+j*8);float weight=readf(s,record+8+j*8);
            if(bone>=bones||!std::isfinite(weight))fail("invalid influence");
            for(unsigned k=0;k<12;k++)blended[k]=fmadd(weight,transforms[bone][k],blended[k]);
        }
        posed[i]=concat(camera,blended);normals[i]=inverse_transpose(zscale?concat(scale,posed[i]):posed[i]);
    }
    static unsigned poseCalls=0;poseCalls++;
    if(std::getenv("OPENSMASH_SKIN_VERIFY") && (poseCalls==1||poseCalls==120||poseCalls==600||poseCalls==1200)){
        const unsigned blend=s->gpr[1]-768,tmp=blend+64,nrm=blend+128,z=blend+192;
        float maxMatrix=0,maxNormal=0;
        for(unsigned i=0;i<envelopes;i++){
            for(unsigned k=0;k<12;k++)writef(s,blend+4*k,0);
            unsigned record=mem_read32(s,records+i*4),count=mem_read32(s,record);
            for(unsigned j=0;j<count;j++){
                unsigned bone=mem_read32(s,record+4+j*8),joint=jointPointers[bone];
                call(s,0x80342204,joint+0x44,mem_read32(s,joint+0x78),tmp);
                call(s,0x8037A54C,tmp,blend,blend,readf(s,record+8+j*8));
            }
            call(s,0x80342204,view,blend,tmp);
            unsigned input=tmp;
            if(zscale){call(s,0x80342204,0x80459240u,tmp,z);input=z;}
            call(s,0x80379A20,input,nrm);
            auto expected=readm(s,tmp),expectedNormal=readm(s,nrm);
            for(unsigned k=0;k<12;k++){
                float error=std::abs(expected[k]-posed[i][k]);maxMatrix=std::max(maxMatrix,error);
                if(error>0.0001f*(1+std::abs(expected[k])))fail("position matrix differs from Melee oracle");
                if(k%4==3)continue;
                error=std::abs(expectedNormal[k]-normals[i][k]);maxNormal=std::max(maxNormal,error);
                if(error>0.0005f*(1+std::abs(expectedNormal[k])))fail("normal matrix differs from Melee oracle");
            }
        }
        std::fprintf(stderr,"[opensmash] skin oracle pose=%u envelopes=%u matrix_max_abs=%g normal_max_abs=%g\n",poseCalls,envelopes,maxMatrix,maxNormal);
    }
    for(unsigned i=0;i<vertices;i++){
        unsigned env=mem_read16(s,vertexenv+i*2);if(env>=envelopes)fail("invalid vertex envelope");
        float p[3],n[3];for(unsigned j=0;j<3;j++){p[j]=readf(s,src+i*12+j*4);n[j]=readf(s,normal+i*12+j*4);}
        for(unsigned r=0;r<3;r++){
            const auto& m=posed[env];const auto& t=normals[env];
            float x=m[r*4]*p[0]+m[r*4+1]*p[1]+m[r*4+2]*p[2]+m[r*4+3];
            float v=t[r*4]*n[0]+t[r*4+1]*n[1]+t[r*4+2]*n[2];
            if(!std::isfinite(x)||!std::isfinite(v))fail("nonfinite skinned vertex");
            writef(s,dst+i*12+r*4,x);writef(s,dstnormal+i*12+r*4,v);
        }
    }
    // Vertex arrays now hold view-space data. Projection and materials remain Melee's.
    const unsigned scratch=s->gpr[1]-256;if(!ram(s,scratch,48))fail("invalid matrix scratch");
    for(unsigned i=0;i<12;i++)writef(s,scratch+i*4,(i==0||i==5||i==10)?1.0f:0.0f);
    call(s,0x8036E034,0,2);call(s,0x80341494,scratch,0);call(s,0x803414D0,scratch,0);
    static bool announced=false;if(!announced){announced=true;std::fprintf(stderr,"[opensmash] browser skinning vertices=%u envelopes=%u bones=%u\n",vertices,envelopes,bones);}
    s->pc=s->lr&~3u;return true;
}
