// Optional rendering diagnostics, loaded only with profile=presentation or adreno.
(function () {
  if (typeof OffscreenCanvas !== 'undefined' && globalThis.location?.search.includes('debug-present=1')) {
    const transfer = OffscreenCanvas.prototype.transferToImageBitmap;
    let frames = 0;
    OffscreenCanvas.prototype.transferToImageBitmap = function (...args) {
      if (++frames % 60 === 0) {
        const gl = this.getContext('webgl2');
        if (gl) {
          const original = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
          const sample = () => {
            const bytes = new Uint8Array(16 * 16 * 4);
            gl.readPixels(200, 150, 16, 16, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
            return {rgb: bytes.reduce((n,b,i)=>n+(i%4===3?0:b),0),error:gl.getError()};
          };
          const priorError = gl.getError();
          const current = sample();
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER,this.GLctxObject?.defaultFbo || null);
          const emscripten = sample();
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER,null);
          const screen = sample();
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER,original);
          postMessage({cmd:'callHandler',handler:'printErr',args:['[mobile-present] '+JSON.stringify({frames,priorError,current,emscripten,screen,size:[this.width,this.height],offscreen:!!original,attrs:gl.getContextAttributes()})]});
        }
      }
      return transfer.apply(this,args);
    };
  }
  if (typeof WebGL2RenderingContext === 'undefined') return;
  if (globalThis.location?.search.includes('debug-present=1')) {
    for (const name of ['drawArrays','drawElements','blitFramebuffer','drawBuffers','readBuffer']) {
      const method = WebGL2RenderingContext.prototype[name];
      let calls = 0, errors = 0;
      WebGL2RenderingContext.prototype[name] = function (...args) {
        if (++calls > 1000) return method.apply(this,args);
        const prior = this.getError();
        const result = method.apply(this,args);
        const error = this.getError();
        if ((prior || error) && errors++ < 3) {
          const program = this.getParameter(this.CURRENT_PROGRAM);
          let details = {};
          if (program) {
            this.validateProgram(program);
            const blocks = [];
            for(let i=0;i<this.getProgramParameter(program,this.ACTIVE_UNIFORM_BLOCKS);i++) {
              const binding=this.getActiveUniformBlockParameter(program,i,this.UNIFORM_BLOCK_BINDING);
              blocks.push({name:this.getActiveUniformBlockName(program,i),required:this.getActiveUniformBlockParameter(program,i,this.UNIFORM_BLOCK_DATA_SIZE),binding,size:this.getIndexedParameter(this.UNIFORM_BUFFER_SIZE,binding),bound:!!this.getIndexedParameter(this.UNIFORM_BUFFER_BINDING,binding)});
            }
            details={valid:this.getProgramParameter(program,this.VALIDATE_STATUS),info:this.getProgramInfoLog(program),blocks,framebuffer:this.checkFramebufferStatus(this.FRAMEBUFFER),shaders:this.getAttachedShaders(program).map(s=>this.getShaderSource(s))};
          }
          postMessage({cmd:'callHandler',handler:'printErr',args:['[mobile-gl] '+JSON.stringify({name,calls,prior,error,args,details})]});
        }
        return result;
      };
    }
  }
})();
