#pragma once
#include <array>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <mutex>
#ifdef _WIN32
#include <cwchar>
#endif
namespace OpenSmashLauncher {
inline bool Enabled(){return std::getenv("OPENSMASH_LAUNCHER_INPUT")!=nullptr;}
// A single snapshot is shared by the render/input and audio threads. Failed
// reads yield neutral input and silence rather than retaining held controls.
inline std::array<unsigned char,80> Read(){
 static std::mutex mutex;std::lock_guard<std::mutex> lock(mutex);
 static FILE* file=[](){
#ifdef _WIN32
  const wchar_t* path=_wgetenv(L"OPENSMASH_LAUNCHER_INPUT");
  FILE* result=path?_wfopen(path,L"rb"):nullptr;
#else
  const char* path=std::getenv("OPENSMASH_LAUNCHER_INPUT");
  FILE* result=path?std::fopen(path,"rb"):nullptr;
#endif
  if(result)std::setvbuf(result,nullptr,_IONBF,0);return result;
 }();
 std::array<unsigned char,80> bytes{};bytes[4]=1;
 if(!file)return bytes;
 std::rewind(file);
 if(std::fread(bytes.data(),1,bytes.size(),file)!=bytes.size()||bytes[0]!='O'||bytes[1]!='S'||bytes[2]!='I'||bytes[3]!='1'){bytes.fill(0);bytes[4]=1;}
 static unsigned sequence=256;
 static auto last=std::chrono::steady_clock::now();
 const auto now=std::chrono::steady_clock::now();
 if(bytes[5]!=sequence){sequence=bytes[5];last=now;}
 if(now-last>std::chrono::milliseconds(500))for(unsigned port=0;port<4;++port){const auto o=8+port*16;if(bytes[o]==3){bytes[o+1]=0;for(unsigned j=2;j<14;++j)bytes[o+j]=0;}}
 return bytes;
}
inline bool Muted(){return Enabled()&&Read()[4]!=0;}
inline int Signed(const std::array<unsigned char,80>& data,unsigned offset){int n=data[offset]|(data[offset+1]<<8);return n>=32768?n-65536:n;}
}
