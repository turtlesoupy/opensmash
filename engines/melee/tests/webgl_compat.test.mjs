import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({});
vm.runInContext(readFileSync(new URL('../runtime/web/webgl-compat.js',import.meta.url),'utf8'),context);
const {rewriteVertexShader}=context.OpenSmashWebGL;
test('preserves uniform layout and constant accesses while replacing dynamic matrix lookups',()=>{
 const source='layout(std140) uniform VSBlock { vec4 ctrmtx[64]; vec4 cnmtx[32]; };\nvoid main(){vec4 a=ctrmtx[posidx + 1];vec4 b=cnmtx[posidx & 31];vec4 c=ctrmtx[2];}';
 const output=rewriteVertexShader(source);
 assert.ok(output.startsWith(source.slice(0,source.indexOf('\n'))));
 assert.match(output,/a=opensmash_read_ctrmtx\(int\(posidx \+ 1\)\)/);
 assert.match(output,/b=opensmash_read_cnmtx\(int\(posidx & 31\)\)/);
 assert.match(output,/c=ctrmtx\[2\]/);
 assert.match(output,/if \(index == 63\) result = ctrmtx\[63\]/);
 assert.match(output,/if \(index == 31\) result = cnmtx\[31\]/);
 assert.equal(rewriteVertexShader(output),output);
});
test('leaves fragment shaders and constant-only vertex shaders unchanged',()=>{
 for(const source of ['uniform PSBlock { vec4 color[4]; };','uniform VSBlock {vec4 ctrmtx[64];}; void main(){vec4 a=ctrmtx[2];}'])assert.equal(rewriteVertexShader(source),source);
});

function contextWithDriver(renderer='Adreno 730') {
 class Driver {
  constructor(){Object.assign(this,{SCISSOR_TEST:1,READ_FRAMEBUFFER_BINDING:2,DRAW_FRAMEBUFFER_BINDING:3,FRAMEBUFFER:4,READ_FRAMEBUFFER:5,DRAW_FRAMEBUFFER:6,SHADER_TYPE:7,VERTEX_SHADER:8});this.queries=0;this.scissor=false;this.read=null;this.draw=null;this.lost=false;this.canvas={addEventListener:(_type,fn)=>{this.restore=fn;}};}
  isContextLost(){return this.lost;}
  getExtension(){return {UNMASKED_RENDERER_WEBGL:9};}
  getParameter(p){this.queries++;return p===9?renderer:p===1?this.scissor:p===2?this.read:p===3?this.draw:null;}
  shaderSource(){} getShaderParameter(){return 8;}
  enable(p){if(p===1)this.scissor=true;} disable(p){if(p===1)this.scissor=false;}
  bindFramebuffer(t,b){if(t===4||t===5)this.read=b;if(t===4||t===6)this.draw=b;}
  deleteFramebuffer(b){if(this.read===b)this.read=null;if(this.draw===b)this.draw=null;}
 }
 const realm=vm.createContext({WebGL2RenderingContext:Driver});
 vm.runInContext(readFileSync(new URL('../runtime/web/webgl-compat.js',import.meta.url),'utf8'),realm);
 const gl=new Driver();gl.shaderSource({},'void main(){}');gl.queries=0;return gl;
}
test('presentation state follows separate read/draw bindings, scissor, deletion, and restoration without querying the driver',()=>{
 const gl=contextWithDriver(),a={},b={};
 gl.enable(gl.SCISSOR_TEST);gl.bindFramebuffer(gl.FRAMEBUFFER,a);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,b);
 assert.equal(gl.getParameter(gl.SCISSOR_TEST),true);assert.equal(gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),b);assert.equal(gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),a);
 gl.deleteFramebuffer(b);assert.equal(gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),null);assert.equal(gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),a);
 gl.disable(gl.SCISSOR_TEST);assert.equal(gl.getParameter(gl.SCISSOR_TEST),false);assert.equal(gl.queries,0);
 gl.restore();assert.equal(gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),null);
 gl.lost=true;gl.getParameter(gl.SCISSOR_TEST);assert.equal(gl.queries,1);
});
test('other GPUs retain native state queries',()=>{
 const gl=contextWithDriver('Apple M5');gl.enable(gl.SCISSOR_TEST);assert.equal(gl.getParameter(gl.SCISSOR_TEST),true);assert.equal(gl.queries,1);
});
