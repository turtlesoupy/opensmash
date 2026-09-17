#pragma once
#include <algorithm>
#include <cmath>
#include <stdexcept>
namespace fitting {
struct V {
    double x=0,y=0,z=0;
    double& operator[](int i){return i==0?x:i==1?y:z;}
    double operator[](int i)const{return i==0?x:i==1?y:z;}
    V operator+(V b)const{return {x+b.x,y+b.y,z+b.z};}
    V operator-(V b)const{return {x-b.x,y-b.y,z-b.z};}
    V operator*(double s)const{return {x*s,y*s,z*s};}
};
inline double dot(V a,V b){return a.x*b.x+a.y*b.y+a.z*b.z;}
inline V cross(V a,V b){return {a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x};}
inline double length(V a){return std::sqrt(dot(a,a));}
inline V orient(V a){return {-a.z,a.y,a.x};}
inline V read(const double* p){return {p[0],p[1],p[2]};}
struct M {
    double a[16]{};
    V point(V v)const{return {a[0]*v.x+a[1]*v.y+a[2]*v.z+a[3],a[4]*v.x+a[5]*v.y+a[6]*v.z+a[7],a[8]*v.x+a[9]*v.y+a[10]*v.z+a[11]};}
    V vector(V v)const{return {a[0]*v.x+a[1]*v.y+a[2]*v.z,a[4]*v.x+a[5]*v.y+a[6]*v.z,a[8]*v.x+a[9]*v.y+a[10]*v.z};}
};
inline M matrix(const double* p){M m;std::copy(p,p+16,m.a);return m;}
inline M operator*(const M& a,const M& b){M c;for(int i=0;i<4;i++)for(int j=0;j<4;j++)for(int k=0;k<4;k++)c.a[i*4+j]+=a.a[i*4+k]*b.a[k*4+j];return c;}
inline M inverse(M m){
    M out;for(int i=0;i<4;i++)out.a[i*4+i]=1;
    for(int i=0;i<4;i++){
        int pivot=i;for(int k=i+1;k<4;k++)if(std::abs(m.a[k*4+i])>std::abs(m.a[pivot*4+i]))pivot=k;
        if(std::abs(m.a[pivot*4+i])<1e-12)throw std::runtime_error("singular matrix");
        for(int j=0;j<4;j++){std::swap(m.a[i*4+j],m.a[pivot*4+j]);std::swap(out.a[i*4+j],out.a[pivot*4+j]);}
        double scale=m.a[i*4+i];for(int j=0;j<4;j++){m.a[i*4+j]/=scale;out.a[i*4+j]/=scale;}
        for(int k=0;k<4;k++)if(k!=i){double f=m.a[k*4+i];for(int j=0;j<4;j++){m.a[k*4+j]-=f*m.a[i*4+j];out.a[k*4+j]-=f*out.a[i*4+j];}}
    }return out;
}
}
