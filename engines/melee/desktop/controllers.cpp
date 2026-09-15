#include <SDL3/SDL.h>
#include <iostream>
#include <map>
#include <string>
int main(){
 // macOS discovers MFi/GameController devices (DualSense, Xbox, Switch Pro
 // over Bluetooth) asynchronously through the Cocoa run loop. A gamepad-only
 // init never pumps that loop, so enumeration stays empty. Initialize video
 // as a background app (no Dock icon or window) and wait briefly for devices.
 SDL_SetHint(SDL_HINT_MAC_BACKGROUND_APP,"1");
#ifdef __APPLE__
 const Uint32 flags=SDL_INIT_GAMEPAD|SDL_INIT_VIDEO;
#else
 const Uint32 flags=SDL_INIT_GAMEPAD;
#endif
 if(!SDL_Init(flags))return 1;
 const Uint64 start=SDL_GetTicks();int count=0;SDL_JoystickID* ids=nullptr;
 for(;;){
  SDL_Event e;while(SDL_PollEvent(&e)){}
  ids=SDL_GetGamepads(&count);
  if(count>0||SDL_GetTicks()-start>=1000)break;
  SDL_free(ids);ids=nullptr;SDL_Delay(20);
 }
 std::map<std::string,int> sameNames;
 for(int i=0;i<count;i++){
  const char* value=SDL_GetJoystickNameForID(ids[i]);if(!value)continue;
  std::string name=value;if(name.find_first_of("\r\n")!=std::string::npos)continue;
  std::cout<<"SDL/"<<sameNames[name]++<<"/"<<name<<'\n';
 }
 SDL_free(ids);SDL_Quit();return 0;
}
