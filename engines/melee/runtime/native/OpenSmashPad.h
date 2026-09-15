#pragma once
#include "InputCommon/ControllerInterface/CoreDevice.h"
#include "OpenSmashLauncher.h"
namespace OpenSmashInput {
class Pad final: public ciface::Core::Device {
 unsigned port;
 std::array<unsigned char,80> snapshot{};
 class Value final: public Input {
  std::string name;unsigned port;int mask,axis,direction;const std::array<unsigned char,80>& snapshot;
 public:
  Value(const char* n,unsigned p,int m,const std::array<unsigned char,80>& s,int a=-1,int d=1):name(n),port(p),mask(m),axis(a),direction(d),snapshot(s){}
  std::string GetName() const override{return name;}
  ControlState GetState() const override{
   const auto& data=snapshot;const auto o=8+16*port;
   if(!data[o+1])return 0;
   if(axis>=4)return data[o+12+axis-4]/255.0;
   if(axis>=0)return std::max(0.0,OpenSmashLauncher::Signed(data,o+4+axis*2)*direction/100.0);
   return ((data[o+2]|(data[o+3]<<8))&mask)?1.0:0.0;
  }
 };
 public:
 explicit Pad(unsigned p):port(p){
  for(auto e:{std::pair{"A",0x100}, {"B",0x200},{"X",0x400},{"Y",0x800},{"Z",0x10},{"L",0x40},{"R",0x20},{"Start",0x1000},{"Up",8},{"Down",4},{"Left",1},{"Right",2}})AddInput(new Value(e.first,p,e.second,snapshot));
  for(int axis=0;axis<4;++axis){const char* positive[]={"StickRight","StickUp","CRight","CUp"};const char* negative[]={"StickLeft","StickDown","CLeft","CDown"};AddInput(new Value(positive[axis],p,0,snapshot,axis));AddInput(new Value(negative[axis],p,0,snapshot,axis,-1));}
  AddInput(new Value("AnalogL",p,0,snapshot,4));AddInput(new Value("AnalogR",p,0,snapshot,5));
 }
 ciface::Core::DeviceRemoval UpdateInput() override{snapshot=OpenSmashLauncher::Read();return ciface::Core::DeviceRemoval::Keep;}
 std::string GetName() const override{return "Pad"+std::to_string(port+1);}
 std::string GetSource() const override{return "OpenSmash";}
};
}
