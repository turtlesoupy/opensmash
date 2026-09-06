const nextTask = () => new Promise(resolve => setTimeout(resolve, 10));

// Submit both shaders and linking before asking the driver for any results.
// COMPLETION_STATUS_KHR is the only non-blocking readiness query. Without the
// extension, yield first; WebGL cannot guarantee that LINK_STATUS won't wait.
export async function compileProgramAsync(gl, vertexSource, fragmentSource, yieldToBrowser = nextTask) {
  const extension = gl.getExtension('KHR_parallel_shader_compile');
  const shaders = [];
  const program = gl.createProgram();
  if (!program) throw new Error('Could not allocate shader program');
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Could not allocate shader');
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    do {
      await yieldToBrowser();
      if (gl.isContextLost()) throw new Error('WebGL context lost during shader compilation');
    } while (extension && !gl.getProgramParameter(program, extension.COMPLETION_STATUS_KHR));
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const details = [gl.getProgramInfoLog(program), ...shaders.map(shader => gl.getShaderInfoLog(shader))];
      throw new Error(`Shader program failed to link: ${details.filter(Boolean).join('\n')}`);
    }
    return program;
  } catch (error) {
    gl.deleteProgram(program);
    throw error;
  } finally {
    for (const shader of shaders) gl.deleteShader(shader);
  }
}

// Three.js picks color-space/tone-mapping variants from the current target.
// Only hold that target while compileAsync submits work, never across awaits.
export async function compileSceneAsync(renderer, object, camera, targetScene, renderTarget = null) {
  const previousTarget = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(renderTarget);
    return renderer.compileAsync(object, camera, targetScene);
  } finally {
    renderer.setRenderTarget(previousTarget);
  }
}
