/* =========================================================================
   gl.js - a thin, honest WebGL2 layer: programs, meshes, textures, render
   targets. Deliberately small. Everything the game draws goes through here.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;

/* ------------------------------------------------------------ context */

function createContext(canvas) {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,          // never - hard pixel edges are the whole point
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
    desynchronized: false
  });
  if (!gl) return null;

  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

  /* PREMULTIPLIED, deliberately - every texture in this game is uploaded from
     a 2D canvas, and a 2D canvas stores its pixels premultiplied.
     Asking for un-premultiplied output means the browser has to run a
     conversion pass over the whole surface on every single upload, which is
     the slowest path in the texture-upload matrix. Matching the canvas's
     native format instead lets the upload be a straight copy.
     The overlay shader composites premultiplied, and the overlay pass blends
     with (ONE, ONE_MINUS_SRC_ALPHA) to match - see shaders.js. World textures
     are fully opaque, where the two formats are identical. */
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  return gl;
}

/* ------------------------------------------------------------ program */

function compileStage(gl, type, source, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    // Reprint the source with line numbers - GLSL errors are useless without it.
    const numbered = source.split('\n')
      .map((l, i) => String(i + 1).padStart(4, ' ') + ' | ' + l).join('\n');
    console.error('[gl] ' + label + ' failed to compile:\n' + log + '\n' + numbered);
    gl.deleteShader(sh);
    throw new Error(label + ' compile failed: ' + log);
  }
  return sh;
}

/* A linked program plus a cached uniform-location table and typed setters.
   Uniform lookups are done once at link time, so the draw loop never calls
   getUniformLocation. */
class Program {
  constructor(gl, vertSrc, fragSrc, name) {
    this.gl = gl;
    this.name = name || 'program';

    const vs = compileStage(gl, gl.VERTEX_SHADER, vertSrc, this.name + '.vert');
    const fs = compileStage(gl, gl.FRAGMENT_SHADER, fragSrc, this.name + '.frag');

    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p);
      console.error('[gl] ' + this.name + ' failed to link:\n' + log);
      throw new Error(this.name + ' link failed: ' + log);
    }
    // Stages are reference-counted by the program; safe to drop ours now.
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.program = p;

    // Cache every active uniform and attribute up front.
    this.uniforms = Object.create(null);
    const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < nu; i++) {
      const info = gl.getActiveUniform(p, i);
      if (!info) continue;
      // Array uniforms report as "name[0]"; store under the bare name too.
      const bare = info.name.replace(/\[0\]$/, '');
      this.uniforms[bare] = gl.getUniformLocation(p, info.name);
    }

    this.attribs = Object.create(null);
    const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < na; i++) {
      const info = gl.getActiveAttrib(p, i);
      if (!info) continue;
      this.attribs[info.name] = gl.getAttribLocation(p, info.name);
    }

    // Next free texture unit, reset each time the program is bound.
    this._unit = 0;
  }

  use() {
    this.gl.useProgram(this.program);
    this._unit = 0;
    return this;
  }

  /* All setters no-op silently on unknown names. That is intentional: shaders
     get edited constantly during tuning and a stale uniform set should not
     crash a frame. Compile-time typos still surface via the GLSL compiler. */
  int(n, v)   { const l = this.uniforms[n]; if (l) this.gl.uniform1i(l, v); return this; }
  float(n, v) { const l = this.uniforms[n]; if (l) this.gl.uniform1f(l, v); return this; }
  vec2(n, x, y)       { const l = this.uniforms[n]; if (l) this.gl.uniform2f(l, x, y); return this; }
  vec3(n, x, y, z)    { const l = this.uniforms[n]; if (l) this.gl.uniform3f(l, x, y, z); return this; }
  vec4(n, x, y, z, w) { const l = this.uniforms[n]; if (l) this.gl.uniform4f(l, x, y, z, w); return this; }
  vec3v(n, a) { const l = this.uniforms[n]; if (l) this.gl.uniform3fv(l, a); return this; }
  vec4v(n, a) { const l = this.uniforms[n]; if (l) this.gl.uniform4fv(l, a); return this; }
  floatv(n, a){ const l = this.uniforms[n]; if (l) this.gl.uniform1fv(l, a); return this; }
  mat3(n, m)  { const l = this.uniforms[n]; if (l) this.gl.uniformMatrix3fv(l, false, m); return this; }
  mat4(n, m)  { const l = this.uniforms[n]; if (l) this.gl.uniformMatrix4fv(l, false, m); return this; }

  /* Bind a texture to the next free unit and point the sampler at it. */
  tex(n, texture) {
    const l = this.uniforms[n];
    if (!l || !texture) return this;
    const gl = this.gl;
    const unit = this._unit++;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture.handle !== undefined ? texture.handle : texture);
    gl.uniform1i(l, unit);
    return this;
  }

  dispose() { this.gl.deleteProgram(this.program); }
}

/* --------------------------------------------------------------- mesh
   Interleaved, non-instanced, indexed triangles. Vertex layout is fixed
   across the whole game so one VAO description covers every object:

     location 0 : vec3 aPosition
     location 1 : vec3 aNormal
     location 2 : vec2 aUv
     location 3 : vec3 aColor     (baked per-vertex tint / AO)

   14 floats?  No - 11 floats, 44 bytes per vertex.
   ---------------------------------------------------------------------- */

const VERTEX_FLOATS = 11;
const VERTEX_BYTES = VERTEX_FLOATS * 4;

class Mesh {
  /**
   * @param {WebGL2RenderingContext} gl
   * @param {Float32Array|Array} vertices interleaved, VERTEX_FLOATS per vertex
   * @param {Uint16Array|Uint32Array|Array} indices
   */
  constructor(gl, vertices, indices) {
    this.gl = gl;

    const verts = vertices instanceof Float32Array ? vertices : new Float32Array(vertices);

    // Pick the smallest index type that fits; keeps buffers tight on old GPUs.
    let idx;
    if (indices instanceof Uint16Array || indices instanceof Uint32Array) {
      idx = indices;
    } else {
      const maxIndex = indices.length ? Math.max.apply(null, indices) : 0;
      idx = maxIndex > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
    }
    this.indexType = idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    this.count = idx.length;
    this.vertexCount = verts.length / VERTEX_FLOATS;

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, VERTEX_BYTES, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, VERTEX_BYTES, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, VERTEX_BYTES, 24);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, VERTEX_BYTES, 32);

    this.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

    gl.bindVertexArray(null);
  }

  draw() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.count, this.indexType, 0);
  }

  dispose() {
    const gl = this.gl;
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.vbo);
    gl.deleteBuffer(this.ibo);
  }
}

/* ---------------------------------------------------- upload strategy

   Every readable surface in this game - the exam sheet, the calculator, the
   HUD - is a 2D canvas that gets uploaded to a texture whenever its contents
   change. There are two ways to perform that upload, and browser engines do
   NOT agree about them:

     canvas route      texSubImage2D(..., htmlCanvasElement)
                       The browser snapshots the canvas for us. On a
                       GPU-accelerated canvas that snapshot is a copy between
                       two different graphics contexts, and that copy is
                       where engines have historically handed back stale or
                       half-updated pixels for a canvas that was drawn to
                       moments earlier. It is also the only route that
                       honours UNPACK_PREMULTIPLY_ALPHA_WEBGL.

     ImageData route   texSubImage2D(..., Uint8ClampedArray)
                       Plain bytes with no snapshot and no cross-context
                       handoff, so it cannot go stale. Costs one extra copy,
                       and the UNPACK_* conversions do not apply to it, so
                       the premultiply has to be done here by hand.

   Rather than hard-code a guess about which browser is running - a guess
   that would be wrong on some machine I never got to test - the working
   route is MEASURED once at startup: upload a known pattern, read it back,
   and see whether what arrived is what was sent. The cheaper canvas route is
   kept for as long as it proves exact.

   The measurement itself depends on canvas readback being honest, and
   hardened browsers deliberately perturb readback to defeat fingerprinting.
   So readback is verified FIRST; if it is untrustworthy, the ImageData route
   would be unusable anyway (it is built on getImageData), and the canvas
   route is kept unconditionally. */

let uploadRoute = null;          // 'canvas' | 'imagedata'
let readbackTrusted = null;      // null = not yet probed

/* Draw exact colours, read them back, and see if they survived. */
function probeReadback() {
  const cv = document.createElement('canvas');
  cv.width = 8; cv.height = 8;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const want = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [137, 71, 29]];
  want.forEach((c, i) => {
    ctx.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
    ctx.fillRect(i * 2, 0, 2, 8);
  });
  try {
    const d = ctx.getImageData(0, 0, 8, 8).data;
    for (let i = 0; i < want.length; i++) {
      const o = (4 * 8 + i * 2 + 1) * 4;
      for (let k = 0; k < 3; k++) if (Math.abs(d[o + k] - want[i][k]) > 1) return false;
    }
    return true;
  } catch (err) {
    return false;
  }
}

/* The ImageData route is the DEFAULT, and the canvas route is now only a
   fallback for browsers that will not give honest pixels back.

   This started out the other way round, gated on probeCanvasUpload(). That
   was the wrong call. The failure being guarded against - a large canvas
   upload the driver has not finished before the texture is sampled - is
   intermittent, and readPixels forces a flush, so the probe mostly hides the
   very thing it is looking for. Measured on a machine that was visibly
   shredding the exam sheet, a full-surface check caught it on about 1% of
   frames. A four-iteration boot probe would therefore clear a broken browser
   about 96% of the time, and the player would get the corruption anyway.

   So the choice is made on structure rather than on sampling. The ImageData
   path hands the GPU a CPU byte array: there is no canvas snapshot, no
   cross-context copy, and nothing that can still be in flight when the draw
   call reads the texture. It cannot exhibit this class of fault on any
   browser. It costs one extra copy of the surface per upload, and since the
   HUD and grapher stopped re-uploading themselves every frame, total upload
   traffic is small enough that the cost does not matter. Correct everywhere
   beats fast on the machines I happened to test. */
function chooseUploadRoute(gl) {
  if (uploadRoute) return uploadRoute;

  readbackTrusted = probeReadback();
  if (readbackTrusted) {
    uploadRoute = 'imagedata';
  } else {
    /* getImageData is being perturbed - anti-fingerprinting, almost always -
       so an ImageData upload would carry those perturbations into the
       texture. The canvas route is the only option left. */
    uploadRoute = 'canvas';
    console.warn('[gl] canvas readback is perturbed by this browser; falling back ' +
                 'to the direct canvas upload route.');
  }
  SATG.gl.uploadRoute = uploadRoute;
  SATG.gl.readbackTrusted = readbackTrusted;
  return uploadRoute;
}

/* Straight-alpha canvas bytes -> premultiplied, matching what the canvas
   route produces with UNPACK_PREMULTIPLY_ALPHA_WEBGL enabled. The UNPACK_*
   conversions do not apply to an ArrayBufferView source, so this has to be
   done explicitly or the overlay blend would be wrong. */
function premultipliedBytes(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  let img;
  try { img = ctx.getImageData(0, 0, canvas.width, canvas.height); }
  catch (err) { return null; }

  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a === 255) continue;            // the common case, already correct
    if (a === 0) { d[i] = d[i + 1] = d[i + 2] = 0; continue; }
    d[i]     = (d[i]     * a + 127) / 255 | 0;
    d[i + 1] = (d[i + 1] * a + 127) / 255 | 0;
    d[i + 2] = (d[i + 2] * a + 127) / 255 | 0;
  }
  return d;
}

/* ------------------------------------------------------------- texture */

class Texture {
  constructor(gl, opts) {
    opts = opts || {};
    this.gl = gl;
    this.handle = gl.createTexture();
    this.width = opts.width || 1;
    this.height = opts.height || 1;
    // NEAREST by default. Any smoothing anywhere breaks the look.
    this.filter = opts.filter || gl.NEAREST;
    this.wrap = opts.wrap || gl.REPEAT;
    this._mip = !!opts.mipmap;
    this._allocated = false;      // set once storage exists; see update()

    gl.bindTexture(gl.TEXTURE_2D, this.handle);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, this.wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, this.wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.filter);
    // Mipmapped minification uses NEAREST_MIPMAP_LINEAR: crisp texels, but the
    // level blend kills the shimmer that raw NEAREST gets on distant surfaces.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER,
      this._mip ? gl.NEAREST_MIPMAP_LINEAR : this.filter);

    if (opts.source) this.setSource(opts.source);
    else this.setData(opts.data || null, this.width, this.height);
  }

  setSource(canvasOrImage) {
    const gl = this.gl;
    this.width = canvasOrImage.width;
    this.height = canvasOrImage.height;
    gl.bindTexture(gl.TEXTURE_2D, this.handle);

    let done = false;
    if (canvasOrImage.getContext && chooseUploadRoute(gl) === 'imagedata') {
      const bytes = premultipliedBytes(canvasOrImage);
      if (bytes) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.width, this.height, 0,
                      gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        done = true;
      }
    }
    if (!done) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvasOrImage);
    }

    if (this._mip) gl.generateMipmap(gl.TEXTURE_2D);
    this._allocated = true;
    return this;
  }

  /**
   * Re-upload a canvas whose size has not changed.
   *
   * texImage2D REALLOCATES the texture's storage on every call. Doing that
   * once a frame for a 780x1090 sheet churns GPU memory hard enough that the
   * sheet can be sampled while its new storage is still incomplete - which
   * shows up as blocks of garbage across the page, or as the whole surface
   * briefly vanishing. texSubImage2D writes into the existing allocation
   * instead, so there is never a moment where the texture has no valid
   * contents.
   */
  update(canvasOrImage) {
    const gl = this.gl;
    if (!this._allocated ||
        canvasOrImage.width !== this.width ||
        canvasOrImage.height !== this.height) {
      return this.setSource(canvasOrImage);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.handle);

    /* Route chosen by measurement at startup - see chooseUploadRoute. */
    let done = false;
    if (canvasOrImage.getContext && chooseUploadRoute(gl) === 'imagedata') {
      const bytes = premultipliedBytes(canvasOrImage);
      if (bytes) {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.width, this.height,
                         gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        done = true;
      }
    }
    if (!done) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, canvasOrImage);
    }

    if (this._mip) gl.generateMipmap(gl.TEXTURE_2D);
    return this;
  }

  setData(data, w, h) {
    const gl = this.gl;
    this.width = w; this.height = h;
    gl.bindTexture(gl.TEXTURE_2D, this.handle);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      data ? (data instanceof Uint8Array ? data : new Uint8Array(data)) : null);
    if (this._mip && data) gl.generateMipmap(gl.TEXTURE_2D);
    this._allocated = true;
    return this;
  }

  dispose() { this.gl.deleteTexture(this.handle); }
}

/* -------------------------------------------------------- render target */

class RenderTarget {
  constructor(gl, width, height, opts) {
    opts = opts || {};
    this.gl = gl;
    this.width = Math.max(1, width | 0);
    this.height = Math.max(1, height | 0);
    this.useDepth = opts.depth !== false;
    this.filter = opts.filter || gl.NEAREST;

    this.color = new Texture(gl, {
      width: this.width, height: this.height,
      filter: this.filter, wrap: gl.CLAMP_TO_EDGE
    });

    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D, this.color.handle, 0);

    if (this.useDepth) {
      this.depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, this.width, this.height);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,
        gl.RENDERBUFFER, this.depth);
    }

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.error('[gl] incomplete framebuffer: 0x' + status.toString(16));
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  resize(w, h) {
    w = Math.max(1, w | 0); h = Math.max(1, h | 0);
    if (w === this.width && h === this.height) return this;
    const gl = this.gl;
    this.width = w; this.height = h;
    this.color.setData(null, w, h);
    if (this.useDepth) {
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    }
    return this;
  }

  bind(clear, r, g, b) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.width, this.height);
    if (clear) {
      gl.clearColor(r || 0, g || 0, b || 0, 1);
      /* glClear respects the write masks. The post and overlay passes leave
         depthMask false, so without re-enabling it here the depth clear is
         silently dropped and the next frame tests against last frame's
         depth - which rejects almost everything. */
      if (this.useDepth) gl.depthMask(true);
      gl.clear(gl.COLOR_BUFFER_BIT | (this.useDepth ? gl.DEPTH_BUFFER_BIT : 0));
    }
    return this;
  }

  dispose() {
    const gl = this.gl;
    gl.deleteFramebuffer(this.fbo);
    if (this.depth) gl.deleteRenderbuffer(this.depth);
    this.color.dispose();
  }
}

/* --------------------------------------------------------- fullscreen quad
   A single triangle that covers the viewport. One vertex fewer than a quad
   and, more usefully, no seam down the diagonal for screen-space effects. */

function createFullscreenTri(gl) {
  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,  3, -1,  -1, 3
  ]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  return {
    draw() {
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() { gl.deleteVertexArray(vao); gl.deleteBuffer(vbo); }
  };
}

/* --------------------------------------------------------------- exports */

SATG.gl = {
  createContext, Program, Mesh, Texture, RenderTarget, createFullscreenTri,
  VERTEX_FLOATS, VERTEX_BYTES,
  /* Filled in by the startup probe; surfaced so a bug report from a machine
     I cannot reach still says which path that machine took. */
  uploadRoute: null,
  readbackTrusted: null,
  chooseUploadRoute
};

})(window);
