// Some Adreno drivers reject linked programs with dynamically indexed matrix
// uniforms, despite accepting both stages. Keep the same UBO layout and values;
// independent fixed-index selections avoid that driver compiler path.
(function () {
  const arrays = {ctrmtx: 64, cnmtx: 32, ctexmtx: 24, cpostmtx: 64};
  function rewriteVertexShader(source) {
    if (!source.includes('uniform VSBlock')) return source;
    const used = new Set();
    const body = source.replace(/\b(ctrmtx|cnmtx|ctexmtx|cpostmtx)\[([^\]]+)\]/g, (match, name, index) => {
      if (/^\s*\d+\s*$/.test(index)) return match;
      used.add(name);
      return `opensmash_read_${name}(int(${index}))`;
    });
    if (!used.size) return source;
    let helpers = '\n';
    for (const name of used) {
      helpers += `vec4 opensmash_read_${name}(int index) { vec4 result = vec4(0.0);\n`;
      for (let index = 0; index < arrays[name]; index++) helpers += `if (index == ${index}) result = ${name}[${index}];\n`;
      helpers += 'return result; }\n';
    }
    // The helpers must follow their uniform declarations and precede all uses.
    return body.replace(/(uniform VSBlock\s*\{[\s\S]*?\};)/, '$1' + helpers);
  }
  globalThis.OpenSmashWebGL = {rewriteVertexShader};
  if (typeof WebGL2RenderingContext === 'undefined') return;
  const original = WebGL2RenderingContext.prototype.shaderSource;
  const affected = new WeakMap();
  // Track the two states Emscripten queries at every frame presentation.
  // On Adreno those synchronous getParameter calls stall command submission.
  const states = new WeakMap();
  const state = gl => {
    if (!states.has(gl)) {
      states.set(gl,{scissor:false,read:null,draw:null});
      gl.canvas?.addEventListener('webglcontextrestored',()=>states.delete(gl),{once:true});
    }
    return states.get(gl);
  };
  const getParameter = WebGL2RenderingContext.prototype.getParameter;
  WebGL2RenderingContext.prototype.getParameter = function(pname) {
    if (affected.get(this) && !this.isContextLost()) {
      const s=state(this);
      if (pname===this.SCISSOR_TEST) return s.scissor;
      if (pname===this.READ_FRAMEBUFFER_BINDING) return s.read;
      if (pname===this.DRAW_FRAMEBUFFER_BINDING) return s.draw;
    }
    return getParameter.call(this,pname);
  };
  for (const [name,value] of [['enable',true],['disable',false]]) {
    const original=WebGL2RenderingContext.prototype[name];
    WebGL2RenderingContext.prototype[name]=function(cap) {
      if(cap===this.SCISSOR_TEST) state(this).scissor=value;
      return original.call(this,cap);
    };
  }
  const bindFramebuffer=WebGL2RenderingContext.prototype.bindFramebuffer;
  WebGL2RenderingContext.prototype.bindFramebuffer=function(target,buffer) {
    const s=state(this);
    if(target===this.FRAMEBUFFER||target===this.READ_FRAMEBUFFER)s.read=buffer;
    if(target===this.FRAMEBUFFER||target===this.DRAW_FRAMEBUFFER)s.draw=buffer;
    return bindFramebuffer.call(this,target,buffer);
  };
  const deleteFramebuffer=WebGL2RenderingContext.prototype.deleteFramebuffer;
  WebGL2RenderingContext.prototype.deleteFramebuffer=function(buffer) {
    const s=state(this);if(s.read===buffer)s.read=null;if(s.draw===buffer)s.draw=null;
    return deleteFramebuffer.call(this,buffer);
  };

  WebGL2RenderingContext.prototype.shaderSource = function (shader, source) {
    if (!affected.has(this)) {
      const extension = this.getExtension('WEBGL_debug_renderer_info');
      affected.set(this, globalThis.location?.search.includes('debug-adreno=1') || !!extension && /Adreno/i.test(this.getParameter(extension.UNMASKED_RENDERER_WEBGL)));
    }
    if (affected.get(this) && this.getShaderParameter(shader, this.SHADER_TYPE) === this.VERTEX_SHADER)
      source = rewriteVertexShader(source);
    return original.call(this, shader, source);
  };
})();
