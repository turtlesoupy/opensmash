#include "pc_gl.h"
#include "pc_runtime.h"
#include <emscripten/html5.h>
static int ready;
EM_JS(void,direct_register_canvas,(),{GL.offscreenCanvases.canvas=Module.canvas;});
int pc_window_open(int w,int h,const char* title){
 w=960;h=720;direct_register_canvas();
 EmscriptenWebGLContextAttributes a;emscripten_webgl_init_context_attributes(&a);a.majorVersion=2;a.alpha=0;a.depth=1;a.stencil=1;a.antialias=0;a.preserveDrawingBuffer=1;
 EMSCRIPTEN_WEBGL_CONTEXT_HANDLE c=emscripten_webgl_create_context("#canvas",&a);if(c<=0){fprintf(stderr,"A WebGL 2 context is required for Melee.\n");pc_exit(3);}emscripten_webgl_make_context_current(c);emscripten_set_canvas_element_size("#canvas",w,h);ready=1;return 1;
}
int pc_window_ready(void){return ready;}
EM_JS(void,direct_frame,(unsigned frame),{Module.onFrame?.(frame);});
int pc_window_pump(void){direct_frame(pc_frame_count);if(!pc_config.realtime&& !pc_config.headless)emscripten_sleep(0);return 1;}
EM_JS(void,direct_present,(),{Module.onPresent?.();});
void pc_window_present(void){direct_present();}
void pc_window_size(int* w,int* h){*w=960;*h=720;if(ready)emscripten_get_canvas_element_size("#canvas",w,h);}
void pc_window_viewport(int* x,int* y,int* w,int* h){pc_window_size(w,h);float aspect=(float)*w/ *h;*x=*y=0;if(aspect>4.0f/3){int nw=*h*4/3;*x=(*w-nw)/2;*w=nw;}else{int nh=*w*3/4;*y=(*h-nh)/2;*h=nh;}}
void pc_window_set_fullscreen(int on){if(on)emscripten_request_fullscreen("#canvas",1);else emscripten_exit_fullscreen();}
int pc_window_vsync_hz(void){return 0;}int pc_window_is_fullscreen(void){return 0;}
