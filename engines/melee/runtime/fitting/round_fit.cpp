// Native round-fighter fitting experiment. No Python, SciPy, solved profiles,
// pre-fitted vertices or character-specific offsets are runtime inputs.
// Bounded optimizer port attribution: see SCIPY-LICENSE.txt.
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>
#include <map>
#include <stdexcept>
#include <vector>
#include <chrono>
#include "math.hpp"

namespace {
using Clock=std::chrono::steady_clock;
double ms(Clock::time_point t){return std::chrono::duration<double,std::milli>(Clock::now()-t).count();}
using namespace fitting;
struct Plane{V n;double d;double distance(V p)const{return dot(n,p)+d;}};
struct Face{int a,b,c;Plane plane;};
struct Hull{std::vector<Plane> planes;std::vector<int> vertices;};
Hull hull(const std::vector<V>& p){
    // Incremental 3D hull, oriented against a fixed strictly interior point.
    // Degenerate input fails; it is never replaced with a guessed sphere.
    if(p.size()<4)throw std::runtime_error("too few hull points");
    int a=0,b=0,c=0,d=0;
    for(unsigned i=1;i<p.size();i++)if(p[i].x<p[a].x)a=i;
    for(unsigned i=0;i<p.size();i++)if(dot(p[i]-p[a],p[i]-p[a])>dot(p[b]-p[a],p[b]-p[a]))b=i;
    V axis=p[b]-p[a];double best=-1;
    for(unsigned i=0;i<p.size();i++){double x=dot(cross(axis,p[i]-p[a]),cross(axis,p[i]-p[a]));if(x>best){best=x;c=i;}}
    V normal=cross(axis,p[c]-p[a]);best=-1;
    for(unsigned i=0;i<p.size();i++){double x=std::abs(dot(normal,p[i]-p[a]));if(x>best){best=x;d=i;}}
    if(length(normal)<1e-10 || best/length(normal)<1e-9)throw std::runtime_error("degenerate hull");
    V interior=(p[a]+p[b]+p[c]+p[d])*.25;
    auto face=[&](int x,int y,int z){V n=cross(p[y]-p[x],p[z]-p[x]);double l=length(n);if(l<1e-12)throw std::runtime_error("degenerate face");n=n*(1/l);double off=-dot(n,p[x]);if(dot(n,interior)+off>0){std::swap(y,z);n=n*-1;off=-off;}return Face{x,y,z,{n,off}};};
    std::vector<Face> faces={face(a,b,c),face(a,d,b),face(a,c,d),face(b,d,c)};
    for(unsigned i=0;i<p.size();i++){
        if(int(i)==a||int(i)==b||int(i)==c||int(i)==d)continue;
        std::map<std::pair<int,int>,int> edges;std::vector<Face> kept;
        auto edge=[&](int x,int y){auto reverse=edges.find({y,x});if(reverse!=edges.end())edges.erase(reverse);else edges[{x,y}]=1;};
        for(const auto& f:faces){if(f.plane.distance(p[i])>1e-9){edge(f.a,f.b);edge(f.b,f.c);edge(f.c,f.a);}else kept.push_back(f);}
        for(const auto& e:edges)kept.push_back(face(e.first.first,e.first.second,i));
        faces=std::move(kept);
    }
    Hull result;std::vector<bool> used(p.size());
    for(const auto& f:faces){result.planes.push_back(f.plane);used[f.a]=used[f.b]=used[f.c]=true;}
    for(unsigned i=0;i<p.size();i++){if(used[i])result.vertices.push_back(i);for(const auto& plane:result.planes)if(plane.distance(p[i])>1e-7)throw std::runtime_error("invalid hull containment");}
    return result;
}
double smooth(double lo,double hi,double x){double t=std::clamp((x-lo)/std::max(hi-lo,1e-8),0.,1.);return t*t*(3-2*t);}
struct Mesh{std::vector<V> p,n;std::vector<std::array<double,5>> env;};
struct Source{
    unsigned count,triCount,jointCount;
    const double *positions,*normals,*weights;
    const uint32_t *joints,*triangles,*parts;
    std::array<V,5> origins;
    double weight(unsigned v,uint32_t mask)const{double w=0;for(int k=0;k<4;k++)if(parts[joints[v*4+k]]&mask)w+=weights[v*4+k];return w;}
};
Mesh body(const Source& s,const std::array<V,5>& anchors,double radius,const std::array<V,2>& offsets){
    const unsigned n=s.count;Mesh out;out.p.resize(n);out.n.resize(n);out.env.resize(n);
    std::vector<double> raw(n),radial(n),support(n),jawRadii;
    double ymin=1e100,ymax=-1e100;for(unsigned i=0;i<n;i++){double y=s.positions[i*3+1];ymin=std::min(ymin,y);ymax=std::max(ymax,y);}
    const double height=ymax-ymin;V origin=s.origins[0];
    double xmin=1e100,xmax=-1e100;unsigned core=0;
    for(unsigned i=0;i<n;i++){raw[i]=s.weight(i,1);V p=read(s.positions+i*3);if(raw[i]>=.8 && p.y>=origin.y-.04*height){core++;xmin=std::min(xmin,p.x);xmax=std::max(xmax,p.x);}}
    const double width=xmax-xmin;if(core<20 || width<1e-6)throw std::runtime_error("insufficient head geometry");
    V center=origin+V{0,width*.32,0},dest=anchors[0];double scale=radius*2/width,floor=origin.y+.02*height;
    double shellFloor=floor-.06*height,jawMin=1e100;
    for(unsigned i=0;i<n;i++){V p=read(s.positions+i*3);radial[i]=std::hypot(p.x-origin.x,p.z-origin.z);if(raw[i]>=.8 && s.normals[i*3+1]<=.1 && p.y>=origin.y-.12*height && p.y<=floor){jawRadii.push_back(radial[i]);jawMin=std::min(jawMin,p.y);}}
    double reference=0;
    if(!jawRadii.empty()){std::sort(jawRadii.begin(),jawRadii.end());double index=(jawRadii.size()-1)*.2;unsigned k=index;reference=jawRadii[k]*(1-(index-k))+jawRadii[std::min(k+1,unsigned(jawRadii.size()-1))]*(index-k);shellFloor=std::max(origin.y-.10*height,std::min(floor,jawMin));}
    for(unsigned i=0;i<n;i++){
        V p=read(s.positions+i*3);double ny=s.normals[i*3+1];
        double shell=jawRadii.empty()?0:smooth(.55*reference,reference,radial[i])*(1-smooth(.25,.75,ny));
        double localFloor=floor+shell*(shellFloor-floor),collar=(1-smooth(floor,floor+.06*height,p.y))*smooth(.25,.75,ny)*(1-shell);
        support[i]=smooth(localFloor-.02*height,localFloor,p.y)*smooth(.5,.9,raw[i])*(1-collar);
        V head=orient(p-center)*scale+dest,plug=orient(p-center)*(scale*.035)+dest;
        out.p[i]=head*support[i]+plug*(1-support[i]);out.env[i][0]=1;
        for(int side=0;side<2;side++){double arm=s.weight(i,side?256:128)*(1-support[i]);double sign=s.origins[side+1].x-origin.x;sign=(sign>0)-(sign<0);V base=dest+orient({sign*radius*.15,-radius*.45,0});V tucked=plug+(base-dest);out.p[i]=out.p[i]*(1-arm)+tucked*arm;}
    }
    const uint32_t masks[]={2,4,8|16,32|64};
    for(int part=1;part<=4;part++){
        std::vector<double> weights(n);V low{1e100,1e100,1e100},high{-1e100,-1e100,-1e100};unsigned owned=0;
        for(unsigned i=0;i<n;i++){weights[i]=s.weight(i,masks[part-1])*(1-support[i]);if(weights[i]>.65){owned++;V p=read(s.positions+i*3);for(int k=0;k<3;k++){low[k]=std::min(low[k],p[k]);high[k]=std::max(high[k],p[k]);}}}
        if(!owned)continue;double span=std::max({high.x-low.x,high.y-low.y,high.z-low.z});double limbScale=radius*(part<=2?.42:.72)/std::max(span,1e-6);V target=anchors[part];if(part<=2)target=target+offsets[part-1];
        for(unsigned i=0;i<n;i++){double w=weights[i];V limb=orient(read(s.positions+i*3)-s.origins[part])*limbScale+target;out.p[i]=out.p[i]*(1-w)+limb*w;if(w>0){for(auto& e:out.env[i])e*=1-w;out.env[i][part]+=w;}}
    }
    for(unsigned t=0;t<s.triCount;t++){unsigned a=s.triangles[t*3],b=s.triangles[t*3+1],c=s.triangles[t*3+2];V f=cross(out.p[b]-out.p[a],out.p[c]-out.p[a]);out.n[a]=out.n[a]+f;out.n[b]=out.n[b]+f;out.n[c]=out.n[c]+f;}
    for(unsigned i=0;i<n;i++){double l=length(out.n[i]);out.n[i]=l>1e-12?out.n[i]*(1/l):orient(read(s.normals+i*3));}
    return out;
}
struct Sample{V point;M change;unsigned active=0;};
struct Objective{
    std::vector<Sample> samples;const std::vector<Plane>& planes;unsigned evaluations=0;
    double distance(Sample& sample,V x,bool exact=false){
        V p=sample.point+sample.change.vector(x);double best=planes[sample.active].distance(p);
        if(!exact && best>=.18)return best;
        for(unsigned i=0;i<planes.size();i++){double d=planes[i].distance(p);if(d>best){best=d;sample.active=i;}if(!exact && best>=.18)break;}return best;
    }
    double operator()(V x){
        if(++evaluations>30000)throw std::runtime_error("solver evaluation budget");
        double loss=0;for(auto& sample:samples){double gap=std::max(.18-distance(sample,x),0.);loss+=gap*gap;}
        return 100*loss/samples.size()+.001*dot(x,x);
    }
};
std::pair<double,double> bounds(V x,V dir,double limit){double lo=-1e100,hi=1e100;for(int k=0;k<3;k++)if(dir[k]!=0){double a=(-limit-x[k])/dir[k],b=(limit-x[k])/dir[k];lo=std::max(lo,std::min(a,b));hi=std::min(hi,std::max(a,b));}return {lo,hi};}
// Bounded Brent search and Powell direction updates use the same tolerances,
// seeds and objective as the reference; no collision checks are omitted.
double line(Objective& f,V& x,V& dir,double limit,double current){
    if(dot(dir,dir)==0)return current;
    auto [a,b]=bounds(x,dir,limit);if(a>b)throw std::runtime_error("invalid line bounds");
    constexpr double golden=.3819660112501051;
    double v=a+golden*(b-a),w=v,z=v,fz=f(x+dir*z),fv=fz,fw=fz,d=0,e=0;
    for(int iteration=0;iteration<500;iteration++){
        double mid=(a+b)*.5,tol=std::sqrt(2.2e-16)*std::abs(z)+.005/3,tol2=tol*2;
        if(std::abs(z-mid)<=tol2-.5*(b-a))break;
        bool useGolden=true;
        if(std::abs(e)>tol){double r=(z-w)*(fz-fv),q=(z-v)*(fz-fw),p=(z-v)*q-(z-w)*r;q=2*(q-r);if(q>0)p=-p;q=std::abs(q);double old=e;e=d;
            if(std::abs(p)<std::abs(.5*q*old)&&p>q*(a-z)&&p<q*(b-z)){d=p/q;double u=z+d;if(u-a<tol2||b-u<tol2)d=(mid>=z?tol:-tol);useGolden=false;}}
        if(useGolden){e=z>=mid?a-z:b-z;d=golden*e;}
        double u=z+(d>=0?1:-1)*std::max(std::abs(d),tol),fu=f(x+dir*u);
        if(fu<=fz){if(u>=z)a=z;else b=z;v=w;fv=fw;w=z;fw=fz;z=u;fz=fu;}
        else{if(u<z)a=u;else b=u;if(fu<=fw||w==z){v=w;fv=fw;w=u;fw=fu;}else if(fu<=fv||v==z||v==w){v=u;fv=fu;}}
    }
    dir=dir*z;x=x+dir;return fz;
}
std::pair<V,double> solve(Objective& f,V x,double limit){
    std::array<V,3> dirs={V{1,0,0},V{0,1,0},V{0,0,1}};double value=f(x);V previous=x;
    for(int iteration=0;iteration<100;iteration++){
        double start=value,delta=0;int biggest=0;
        for(int k=0;k<3;k++){V direction=dirs[k];double before=value;value=line(f,x,direction,limit,value);if(before-value>delta){delta=before-value;biggest=k;}}
        if(2*(start-value)<=1e-6*(std::abs(start)+std::abs(value))+1e-20)break;
        V direction=x-previous;previous=x;double hi=bounds(x,direction,limit).second;double extrapolated=f(x+direction*std::min(1.,hi));
        if(start>extrapolated){double t=2*(start+extrapolated-2*value)*std::pow(start-value-delta,2)-delta*std::pow(start-extrapolated,2);
            if(t<0){value=line(f,x,direction,limit,value);if(dot(direction,direction)>0){dirs[biggest]=dirs[2];dirs[2]=direction;}}}
    }return {x,value};
}
}

// Parts: Head=1, L/R hand=2/4, L foot/toe=8/16, R foot/toe=32/64,
// L/R arm=128/256. origins/targetJoints ordered head,Lhand,Rhand,Lfoot,Rfoot.
// Outputs have five envelope slots per vertex, sorted by actual target joint.
extern "C" int fit_round(unsigned n,unsigned triangles,unsigned sourceJoints,unsigned targetCount,unsigned poses,
    const double* positions,const double* normals,const double* weights,const uint32_t* joints,const uint32_t* indices,
    const uint32_t* parts,const double* origins,const uint32_t* targetJoints,const double* inverseBinds,const double* worlds,
    double radius,double* outputPositions,double* outputNormals,uint32_t* outputJoints,float* outputWeights,double* stats){
    try{
        if(n<20||n>65535||triangles>100000||sourceJoints==0||sourceJoints>256||targetCount==0||targetCount>512||poses==0||poses>256||!std::isfinite(radius)||radius<=0||radius>10)return 1;
        std::fill(stats,stats+21,0.);
        for(unsigned i=0;i<n*3;i++)if(!std::isfinite(positions[i])||!std::isfinite(normals[i]))return 1;
        for(unsigned i=0;i<n;i++){double sum=0;for(int k=0;k<4;k++){unsigned at=i*4+k;if(joints[at]>=sourceJoints||!std::isfinite(weights[at])||weights[at]<0)return 1;sum+=weights[at];}if(std::abs(sum-1)>1e-5)return 1;}
        for(unsigned i=0;i<triangles*3;i++)if(indices[i]>=n)return 1;
        for(unsigned i=0;i<targetCount*16;i++)if(!std::isfinite(inverseBinds[i]))return 1;
        for(unsigned i=0;i<poses*targetCount*16;i++)if(!std::isfinite(worlds[i]))return 1;
        for(int i=0;i<15;i++)if(!std::isfinite(origins[i]))return 1;
        std::array<V,5> anchors;Source source{n,triangles,sourceJoints,positions,normals,weights,joints,indices,parts,{}};
        for(int k=0;k<5;k++){if(targetJoints[k]>=targetCount)return 1;source.origins[k]=read(origins+k*3);anchors[k]=inverse(matrix(inverseBinds+targetJoints[k]*16)).point({});}
        auto stamp=Clock::now();std::array<V,2> offsets{};Mesh base=body(source,anchors,radius,offsets);stats[14]=ms(stamp);
        stamp=Clock::now();std::vector<V> head;for(unsigned i=0;i<n;i++)if(source.weight(i,1)>.9)head.push_back(base.p[i]);Hull headHull=hull(head);stats[15]=ms(stamp);
        for(int hand=0;hand<2;hand++){
            stamp=Clock::now();std::vector<V> points;std::vector<unsigned> ids;
            for(unsigned i=0;i<n;i++)if(source.weight(i,hand?4:2)>.85){points.push_back(base.p[i]);ids.push_back(i);}
            if(ids.size()<4){for(int k=0;k<7;k++)stats[hand*7+k]=0;continue;}
            Hull handHull=hull(points);Objective objective{{},headHull.planes,0};
            for(unsigned pose=0;pose<poses;pose++){
                std::array<M,5> transforms;for(int k=0;k<5;k++)transforms[k]=matrix(worlds+(pose*targetCount+targetJoints[k])*16)*matrix(inverseBinds+targetJoints[k]*16);
                M headInv=inverse(transforms[0]);M handMatrix=headInv*transforms[hand+1];
                for(int vertex:handHull.vertices){unsigned id=ids[vertex];V posed{};
                    for(int k=0;k<5;k++){double weight=base.env[id][k];if(weight>1e-7)posed=posed+transforms[k].point(base.p[id])*double(float(weight));}
                    M change=handMatrix;double weight=base.env[id][hand+1]>1e-7?double(float(base.env[id][hand+1])):0;for(auto& a:change.a)a*=weight;
                    objective.samples.push_back({headInv.point(posed),change,0});}
            }
            stats[16+hand*2]=ms(stamp);stamp=Clock::now();
            auto best=solve(objective,{},radius*1.7),other=solve(objective,{0,-radius,0},radius*1.7);if(other.second<best.second)best=other;offsets[hand]=best.first;
            stats[17+hand*2]=ms(stamp);
            double minimum=1e100;unsigned inside=0;for(auto& sample:objective.samples){double d=objective.distance(sample,best.first,true);minimum=std::min(minimum,d);inside+=d<0;}
            for(int k=0;k<3;k++)stats[hand*7+k]=best.first[k];stats[hand*7+3]=best.second;stats[hand*7+4]=minimum;stats[hand*7+5]=inside;stats[hand*7+6]=objective.evaluations;
        }
        stamp=Clock::now();Mesh fitted=body(source,anchors,radius,offsets);stats[20]=ms(stamp);
        for(unsigned i=0;i<n;i++){
            for(int k=0;k<3;k++){outputPositions[i*3+k]=fitted.p[i][k];outputNormals[i*3+k]=fitted.n[i][k];}
            std::map<uint32_t,double> env;for(int k=0;k<5;k++)env[targetJoints[k]]+=fitted.env[i][k];unsigned k=0;
            for(auto [joint,w]:env)if(w>1e-7){outputJoints[i*5+k]=joint;outputWeights[i*5+k]=float(w);k++;}
            while(k<5){outputJoints[i*5+k]=UINT32_MAX;outputWeights[i*5+k]=0;k++;}
        }
        return 0;
    }catch(const std::exception&){return 2;}
}
