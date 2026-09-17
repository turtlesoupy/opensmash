// Full ordinary-fighter fit from source rig and target anatomical anchors.
// Source-only smoothed normals are supplied; no target-specific profile is input.
#include "math.hpp"
#include <array>
#include <cstdint>
#include <vector>
#include <map>

namespace {
using namespace fitting;
// Semantic slots supplied by the source rig adapter. A twist shares its parent.
enum Bone {Root,Hip,Spine1,Spine2,Neck1,Neck2,Head,LClav,LUpper,LUpper1,LUpper2,LFore,LFore1,LFore2,LHand,LThigh,LThigh1,LThigh2,LCalf,LCalf1,LCalf2,LFoot,LToe,RClav,RUpper,RUpper1,RUpper2,RFore,RFore1,RFore2,RHand,RThigh,RThigh1,RThigh2,RCalf,RCalf1,RCalf2,RFoot,RToe,Count};
M identity(){M m;for(int i=0;i<4;i++)m.a[i*4+i]=1;return m;}
M rotation(V a,V b){
    a=a*(1/length(a));b=b*(1/length(b));double c=dot(a,b);M r=identity();
    if(c<-.999999){V axis=cross(a,std::abs(a.x)<.9?V{1,0,0}:V{0,1,0});axis=axis*(1/length(axis));for(int i=0;i<3;i++)for(int j=0;j<3;j++)r.a[i*4+j]=2*axis[i]*axis[j]-(i==j);return r;}
    V v=cross(a,b);M s;s.a[1]=-v.z;s.a[2]=v.y;s.a[4]=v.z;s.a[6]=-v.x;s.a[8]=-v.y;s.a[9]=v.x;M square=s*s;
    for(int i=0;i<3;i++)for(int j=0;j<3;j++)r.a[i*4+j]+=s.a[i*4+j]+square.a[i*4+j]/(1+c);return r;
}
M oriented(){M m=identity();m.a[0]=0;m.a[2]=-1;m.a[8]=1;m.a[10]=0;return m;}
struct Fitter {
    unsigned n,flags;const double *positions,*normals,*weights,*origins,*targetAnchors;const uint32_t *joints,*semantics,*anatomy;
    std::array<M,Count> transforms,rotations;
    std::array<uint32_t,Count> targets{};
    std::array<double,Count> widths{};
    std::vector<V> fitted;
    V source(int slot){return read(origins+slot*3);}
    V target(int slot){return read(targetAnchors+slot*3);}
    double weight(unsigned vertex,int bone){double w=0;for(int i=0;i<4;i++)if(semantics[joints[vertex*4+i]]==uint32_t(bone))w+=weights[vertex*4+i];return w;}
    void assign(std::initializer_list<int> slots,int joint,V from,V to,M linear,M rot,double width){
        V translation=to-linear.vector(from);linear.a[3]=translation.x;linear.a[7]=translation.y;linear.a[11]=translation.z;
        for(int slot:slots){transforms[slot]=linear;targets[slot]=anatomy[joint];rotations[slot]=rot;widths[slot]=width;}
    }
    void segment(std::initializer_list<int> slots,int joint,int from,V endpoint,int to,double body,double overrideScale=-1){
        V origin=source(from),av=orient(endpoint-origin),bv=target(to)-target(joint);
        if(length(av)<1e-7)throw std::runtime_error("collapsed source segment");
        if(length(bv)<1e-7){if(!(flags&4))throw std::runtime_error("collapsed target segment");bv=av;if(overrideScale<0)overrideScale=body;}
        double scale=overrideScale<0?length(bv)/length(av):overrideScale;V axis=av*(1/length(av));M stretch=identity();
        for(int i=0;i<3;i++)for(int j=0;j<3;j++)stretch.a[i*4+j]=(i==j?body:0)+(scale-body)*axis[i]*axis[j];
        M r=rotation(av,bv)*oriented();assign(slots,joint,origin,target(joint),rotation(av,bv)*stretch*oriented(),r,body);
    }
    void apply(){fitted.assign(n,{});for(unsigned i=0;i<n;i++)for(int k=0;k<4;k++){unsigned at=i*4+k;fitted[i]=fitted[i]+transforms[semantics[joints[at]]].point(read(positions+i*3))*weights[at];}}
    void build(){
        double ground=1e100;for(unsigned i=0;i<n;i++)ground=std::min(ground,positions[i*3+1]);
        double high=-1e100;for(unsigned i=0;i<n;i++)high=std::max(high,positions[i*3+1]);
        double span=source(Head).y-ground,body=(target(23).y-std::min(target(52).y,target(58).y))/span;
        if(flags&1)body=(target(24).y-target(51).y)/(high-ground);
        if(!std::isfinite(body)||body<=0)throw std::runtime_error("invalid stature");
        segment({Root,Hip},4,Hip,source(Spine1),5,body);
        segment({Spine1,Spine2},5,Spine1,source(Neck1),22,body);
        segment({Neck1,Neck2},22,Neck1,source(Head),23,body);
        M head=oriented();for(int i=0;i<3;i++)for(int j=0;j<3;j++)head.a[i*4+j]*=body;assign({Head},23,source(Head),target(23),head,oriented(),body);
        for(int side=0;side<2;side++){
            int clav=side?RClav:LClav,upper=side?RUpper:LUpper,fore=side?RFore:LFore,hand=side?RHand:LHand;
            int thigh=side?RThigh:LThigh,calf=side?RCalf:LCalf,foot=side?RFoot:LFoot,toe=side?RToe:LToe;
            int tc=side?29:6,tu=side?31:8,tf=side?32:9,th=side?33:10,ti=side?36:13,tt=side?54:48,tk=side?55:49,tfoot=side?57:51,ttoe=side?58:52;
            segment({clav},tc,clav,source(upper),tu,body);segment({upper,upper+1,upper+2},tu,upper,source(fore),tf,body);
            segment({fore,fore+1,fore+2},tf,fore,source(hand),th,body);
            double handScale=length(target(th)-target(tf))/length(source(hand)-source(fore));
            if(handScale<1e-7&&(flags&4))handScale=body;
            segment({hand},th,hand,source(hand)+(source(hand)-source(fore)),ti,body,handScale);
            segment({thigh,thigh+1,thigh+2},tt,thigh,source(calf),tk,body);segment({calf,calf+1,calf+2},tk,calf,source(foot),tfoot,body);
            V axis=source(toe)-source(foot);if(length(axis)<1e-7)throw std::runtime_error("invalid foot axis");axis=axis*(1/length(axis));double extent=-1e100;unsigned owned=0;
            for(unsigned i=0;i<n;i++)if(weight(i,foot)+weight(i,toe)>.5){owned++;extent=std::max(extent,dot(read(positions+i*3)-source(foot),axis));}
            if(owned){if(extent<=1e-5)throw std::runtime_error("invalid foot extent");segment({foot,toe},tfoot,foot,source(foot)+axis*extent,ttoe,body);}
            else segment({foot,toe},tfoot,foot,source(toe),ttoe,body,body);
        }
        refineHead();
        // refine_profile: polar rotation of the constructed forearm transform
        // is exactly its rotation factor, since its stretch is positive-definite.
        for(int side=0;side<2;side++){
            int hand=side?RHand:LHand,fore=side?RFore:LFore,foot=side?RFoot:LFoot,toe=side?RToe:LToe;
            for(int part:{hand,foot}){M r=part==hand?rotations[fore]:oriented(),m=r;for(int i=0;i<3;i++)for(int j=0;j<3;j++)m.a[i*4+j]*=widths[part];int anchor=part==hand?(side?33:10):(side?57:51);if(part==hand)assign({part},anchor,source(part),target(anchor),m,r,widths[part]);else assign({part,toe},anchor,source(part),target(anchor),m,r,widths[part]);}
        }
        apply();
        if(flags&2){refineHead();apply();}
    }
    void refineHead(){
        double sourceGround=1e100;for(unsigned i=0;i<n;i++)sourceGround=std::min(sourceGround,positions[i*3+1]);
        // source_head_fit: preserve uniform head scale and solve authored ratio.
        apply();double fittedGround=1e100;for(unsigned i=0;i<n;i++)if(weight(i,Head)<.5)fittedGround=std::min(fittedGround,fitted[i].y);
        double scale=(target(23).y-fittedGround)/(source(Head).y-sourceGround);if(!std::isfinite(scale)||scale<=0)throw std::runtime_error("invalid head scale");
        auto setHead=[&](double s){M m=oriented();for(int i=0;i<3;i++)for(int j=0;j<3;j++)m.a[i*4+j]*=s;assign({Head},23,source(Head),target(23),m,oriented(),s);};
        setHead(scale);apply();double sourceLow=1e100,sourceHigh=-1e100,coreLow=1e100,coreHigh=-1e100;unsigned core=0;
        for(unsigned i=0;i<n;i++){double y=positions[i*3+1];sourceLow=std::min(sourceLow,y);sourceHigh=std::max(sourceHigh,y);if(weight(i,Head)>.99){core++;coreLow=std::min(coreLow,y);coreHigh=std::max(coreHigh,y);}}
        double fraction=(coreHigh-coreLow)/(sourceHigh-sourceLow);
        auto error=[&](double s){double low=1e100,high=-1e100,cl=1e100,ch=-1e100;for(unsigned i=0;i<n;i++){double w=weight(i,Head),y=fitted[i].y+(s-scale)*w*(positions[i*3+1]-source(Head).y);low=std::min(low,y);high=std::max(high,y);if(w>.99){cl=std::min(cl,y);ch=std::max(ch,y);}}return (ch-cl)/(high-low)/fraction-1;};
        if(core>=4&&fraction>0&&std::abs(error(scale))>.05){double lo=scale*.5,hi=scale*2,le=error(lo),he=error(hi);if(std::isfinite(le+he)&&le*he<=0){for(int i=0;i<32;i++){double mid=(lo+hi)*.5,me=error(mid);if(me*le>0){lo=mid;le=me;}else hi=mid;}setHead((lo+hi)*.5);}}
    }
};
}

extern "C" int fit_humanoid(unsigned n,unsigned sourceCount,unsigned flags,const double* positions,const double* normals,
    const double* weights,const uint32_t* joints,const uint32_t* semantics,const double* origins,
    const uint32_t* anatomy,const double* targetAnchors,double* outputPositions,double* outputNormals,uint32_t* outputJoints,float* outputWeights){
    try{
        if(!n||n>65535||!sourceCount||sourceCount>256)return 1;
        for(unsigned i=0;i<sourceCount;i++)if(semantics[i]>=Count)return 1;
        for(unsigned i=0;i<n*3;i++)if(!std::isfinite(positions[i])||!std::isfinite(normals[i]))return 1;
        for(unsigned i=0;i<n;i++){double total=0;for(int k=0;k<4;k++){unsigned at=i*4+k;if(joints[at]>=sourceCount||!std::isfinite(weights[at])||weights[at]<0)return 1;total+=weights[at];}if(std::abs(total-1)>1e-5)return 1;}
        for(int i=0;i<Count*3;i++)if(!std::isfinite(origins[i]))return 1;
        for(int i=0;i<59*3;i++)if(!std::isfinite(targetAnchors[i]))return 1;
        for(int i=0;i<59;i++)if(anatomy[i]>=512)return 1;
        Fitter f{n,flags,positions,normals,weights,origins,targetAnchors,joints,semantics,anatomy,{},{},{},{},{}};f.build();
        std::array<M,Count> normalMatrices;for(int k=0;k<Count;k++)normalMatrices[k]=inverse(f.transforms[k]);
        for(unsigned i=0;i<n;i++){
            V normal{};std::map<uint32_t,double> env;
            for(int k=0;k<4;k++){unsigned at=i*4+k,s=semantics[joints[at]];double w=weights[at];if(w<=0)continue;const auto& m=normalMatrices[s];V p=read(normals+i*3);normal=normal+V{m.a[0]*p.x+m.a[4]*p.y+m.a[8]*p.z,m.a[1]*p.x+m.a[5]*p.y+m.a[9]*p.z,m.a[2]*p.x+m.a[6]*p.y+m.a[10]*p.z}*w;env[f.targets[s]]+=w;}
            double l=length(normal);if(l<1e-10)return 2;normal=normal*(1/l);for(int k=0;k<3;k++){outputPositions[i*3+k]=f.fitted[i][k];outputNormals[i*3+k]=normal[k];}
            double total=0;for(auto [j,w]:env)total+=w;int k=0;for(auto [j,w]:env){outputJoints[i*4+k]=j;outputWeights[i*4+k]=float(w/total);k++;}while(k<4){outputJoints[i*4+k]=UINT32_MAX;outputWeights[i*4+k]=0;k++;}
        }return 0;
    }catch(const std::exception&){return 2;}
}
