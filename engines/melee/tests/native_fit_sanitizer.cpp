// Standalone synthetic native API checks, no Nintendo or generated assets.
#include <array>
#include <cassert>
#include <cmath>
#include <cstdint>
#include <limits>
#include <vector>
extern "C" int fit_round(unsigned,unsigned,unsigned,unsigned,unsigned,const double*,const double*,const double*,const uint32_t*,const uint32_t*,const uint32_t*,const double*,const uint32_t*,const double*,const double*,double,double*,double*,uint32_t*,float*,double*);
extern "C" int fit_humanoid(unsigned,unsigned,unsigned,const double*,const double*,const double*,const uint32_t*,const uint32_t*,const double*,const uint32_t*,const double*,double*,double*,uint32_t*,float*);
int main(){
    constexpr unsigned n=60;
    std::vector<double> p(n*3),normal(n*3),weights(n*4),op(n*3),on(n*3);
    std::vector<uint32_t> joints(n*4),indices,oj(n*5);std::vector<float> ow(n*5);
    for(unsigned i=0;i<n;i++){
        double y=-.8+1.6*(i/12)/4.,angle=6.283185307179586*(i%12)/12.;
        double r=std::sqrt(1-y*y);p[i*3]=r*std::cos(angle);p[i*3+1]=y+.9;p[i*3+2]=r*std::sin(angle);
        normal[i*3]=r*std::cos(angle);normal[i*3+1]=y;normal[i*3+2]=r*std::sin(angle);weights[i*4]=1;
    }
    for(unsigned row=0;row<4;row++)for(unsigned col=0;col<12;col++){
        unsigned a=row*12+col,b=row*12+(col+1)%12,c=a+12,d=b+12;
        indices.insert(indices.end(),{a,b,c,b,d,c});
    }
    std::array<uint32_t,5> parts={1,2,4,8,32},target={0,1,2,3,4};
    std::array<double,15> origins{};std::array<double,80> matrices{};std::array<double,21> stats{};
    for(int bone=0;bone<5;bone++)for(int k=0;k<4;k++)matrices[bone*16+k*4+k]=1;
    auto run=[&](unsigned count=n,double radius=4.3){return fit_round(count,indices.size()/3,5,5,1,p.data(),normal.data(),weights.data(),joints.data(),indices.data(),parts.data(),origins.data(),target.data(),matrices.data(),matrices.data(),radius,op.data(),on.data(),oj.data(),ow.data(),stats.data());};
    for(int i=0;i<20;i++)assert(run()==0);
    for(double v:op)assert(std::isfinite(v));for(double v:on)assert(std::isfinite(v));
    assert(run(0)==1);assert(run(65536)==1);assert(run(n,-1)==1);
    joints[0]=99;assert(run()==1);joints[0]=0;
    indices[0]=n;assert(run()==1);indices[0]=0;
    weights[0]=-1;assert(run()==1);weights[0]=1;
    p[0]=std::numeric_limits<double>::quiet_NaN();assert(run()==1);p[0]=0;
    target[0]=7;assert(run()==1);target[0]=0;
    for(auto& v:matrices)v=0;assert(run()==2);
    std::array<uint32_t,5> semantics{};std::array<uint32_t,59> anatomy{};
    std::array<double,117> rigOrigins{};std::array<double,177> anchors{};
    auto humanoid=[&](){return fit_humanoid(n,5,0,p.data(),normal.data(),weights.data(),joints.data(),semantics.data(),rigOrigins.data(),anatomy.data(),anchors.data(),op.data(),on.data(),oj.data(),ow.data());};
    assert(humanoid()==2); // collapsed rig is rejected, never produces NaNs.
    semantics[0]=39;assert(humanoid()==1);semantics[0]=0;
    anatomy[0]=512;assert(humanoid()==1);
}
