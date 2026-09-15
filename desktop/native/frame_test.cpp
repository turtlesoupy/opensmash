#undef NDEBUG
#include "OpenSmashFrameOutput.h"
#include <cassert>
#include <fstream>
int main(int argc,char** argv){
 assert(argc==2);{std::ofstream f(argv[1],std::ios::binary);f.seekp(3*OpenSmashFrameOutput::SlotSize-1);f.put(0);}
#ifdef _WIN32
 _putenv_s("OPENSMASH_FRAME_FILE",argv[1]);
#else
 setenv("OPENSMASH_FRAME_FILE",argv[1],1);
#endif
 OpenSmashMemory::Mapping map(argv[1],3*OpenSmashFrameOutput::SlotSize,true);
 unsigned char rgba[]={255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255};
 OpenSmashFrameOutput::Present(rgba,2,2);assert(map.data[0]==1);assert(map.data[64]==255);
 const auto bottom=64+(719*960)*4;assert(map.data[bottom+2]==255);
 OpenSmashFrameOutput::Present(rgba,2,2,true,true);auto* second=map.data+OpenSmashFrameOutput::SlotSize;assert(second[64]==255&&second[66]==0);
 OpenSmashFrameOutput::Present(rgba,2,2);OpenSmashFrameOutput::Present(rgba,2,2);
 uint32_t seq;std::memcpy(&seq,map.data+4,4);assert(seq==1); // producer drops rather than overwrite
 OpenSmashMemory::Store(map.data,0);OpenSmashFrameOutput::Present(rgba,2,2);std::memcpy(&seq,map.data+4,4);assert(seq==4);
}
