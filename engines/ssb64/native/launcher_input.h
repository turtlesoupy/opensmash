#pragma once
#include "OpenSmashLauncher.h"
#include <SDL2/SDL.h>
inline void LauncherKeyboard(PortInputPad& pad){
 const auto* keys=SDL_GetKeyboardState(nullptr);
 const auto held=[&](SDL_Scancode code){return keys[code]!=0;};
 pad.button=0;pad.err=0;
 for(auto e:{std::pair{SDL_SCANCODE_J,0x8000},{SDL_SCANCODE_K,0x4000},{SDL_SCANCODE_L,0x2000},{SDL_SCANCODE_I,0x20},{SDL_SCANCODE_O,0x10},{SDL_SCANCODE_SPACE,0x1000},{SDL_SCANCODE_RETURN,0x1000},{SDL_SCANCODE_KP_ENTER,0x1000},{SDL_SCANCODE_U,8},{SDL_SCANCODE_T,0x800},{SDL_SCANCODE_G,0x400},{SDL_SCANCODE_F,0x200},{SDL_SCANCODE_H,0x100},{SDL_SCANCODE_LCTRL,0x8000},{SDL_SCANCODE_RCTRL,0x8000},{SDL_SCANCODE_LALT,0x4000},{SDL_SCANCODE_RALT,0x4000},{SDL_SCANCODE_LSHIFT,0x2000},{SDL_SCANCODE_RSHIFT,0x2000}})if(held(e.first))pad.button|=e.second;
 pad.stick_x=80*((held(SDL_SCANCODE_D)||held(SDL_SCANCODE_RIGHT))-(held(SDL_SCANCODE_A)||held(SDL_SCANCODE_LEFT)));
 pad.stick_y=80*((held(SDL_SCANCODE_W)||held(SDL_SCANCODE_UP))-(held(SDL_SCANCODE_S)||held(SDL_SCANCODE_DOWN)));
}
inline void LauncherPads(PortInputPad* pads,int* connected){
 const auto data=OpenSmashLauncher::Read();
 for(unsigned port=0;port<4;++port){const auto o=8+port*16;pads[port]={};
  if(data[o]==2&&!std::getenv("OPENSMASH_FRAME_FILE")){LauncherKeyboard(pads[port]);connected[port]=1;}
  else if(data[o]==3||data[o]==2){pads[port].button=data[o+1]?(data[o+2]|data[o+3]<<8):0;pads[port].stick_x=data[o+1]?OpenSmashLauncher::Signed(data,o+4):0;pads[port].stick_y=data[o+1]?OpenSmashLauncher::Signed(data,o+6):0;connected[port]=1;}
  else{pads[port].err=8;connected[port]=0;}
 }
}
