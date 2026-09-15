#pragma once
#include "OpenSmashMemory.h"
#include <cstdint>
#include <cstring>
#include <memory>
namespace OpenSmashFrameOutput {
inline bool Enabled(){return std::getenv("OPENSMASH_FRAME_FILE")!=nullptr;}
constexpr unsigned Width=960,Height=720,SlotSize=Width*Height*4+64;
// Bounded triple buffer. Drop a frame when the consumer is behind; never block
// the game waiting for Electron. Publish only after all pixels are copied.
inline void Present(const unsigned char* pixels,unsigned width,unsigned height,bool bgra=false,bool flip=false){
 if(!Enabled()||!pixels||!width||!height)return;
 static OpenSmashMemory::Mapping memory(OpenSmashMemory::EnvironmentPath("OPENSMASH_FRAME_FILE").c_str(),3*SlotSize,true);
 static uint32_t sequence=0;
 for(unsigned i=0;i<3;++i){auto* slot=memory.data+i*SlotSize;if(OpenSmashMemory::Load(slot)!=0)continue;
  for(unsigned y=0;y<Height;++y){const unsigned sy=y*height/Height;
   for(unsigned x=0;x<Width;++x){const auto* src=pixels+((flip?height-1-sy:sy)*width+x*width/Width)*4;auto* dst=slot+64+(y*Width+x)*4;
    dst[0]=src[bgra?2:0];dst[1]=src[1];dst[2]=src[bgra?0:2];dst[3]=255;
   }
  }
  ++sequence;std::memcpy(slot+4,&sequence,4);OpenSmashMemory::Store(slot,1);return;
 }
}
}
