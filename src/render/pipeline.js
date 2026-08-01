/* =========================================================================
   pipeline.js - frame assembly.

   Chain, in order:

     1. world      -> lowRT       small buffer, PSX shader, Gouraud + fog
     2. composite   lowRT -> compRT   nearest upscale, scanlines, aberration
     3. overlays  -> compRT       exam paper / calculator / menus, native res
     4. present     compRT -> screen  grain, vignette, fade, barrel, then the
                                      single 5-bit quantise + dither

   Colour reduction happens exactly once, at the very end, over everything.
   That is what stops the readable UI from looking pasted onto a 5-bit scene:
   the world is genuinely low-resolution, but the whole composited frame
   shares one palette and one dither grid.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;
const { Program, RenderTarget, createFullscreenTri } = SATG.gl;
const S = SATG.shaders;
const { mat4, vec3 } = SATG;
const { clamp } = SATG.util;

/* Vertical resolution of the world buffer.
   960x540 - half of 1080p, so the upscale is a clean 2x. This is higher than
   a strict PS1 240p on purpose: the reference this game is chasing reads as
   "low-poly, filthy, and dim" rather than "unreadably coarse", and detail
   like the tools on the bench and the panelling on the walls needs the pixels
   to exist at all. The style is carried by the faceted geometry, the vertex
   lighting, the 5-bit palette and the vertex snapping, none of which need the
   resolution to be punishing. */
const INTERNAL_HEIGHT = 540;
/* Raised alongside INTERNAL_HEIGHT. The widest aspect the buffer can represent
   before this clamp kicks in is MAX_INTERNAL_WIDTH / INTERNAL_HEIGHT, and at
   1280 that was only 2.37:1 - narrower than a 21:9 monitor (2.39) and far
   narrower than 32:9 (3.56), so those displays would have had the room
   rendered at the wrong aspect and stretched to fit. 2048 covers both. */
const MAX_INTERNAL_WIDTH = 2048;

/* Default look.
   Quantisation, dithering and the low resolution are load-bearing and run at
   full strength. Aberration and barrel are NOT part of this aesthetic - they
   are lens and VHS artifacts, and cranking them is the standard tell of an
   imitation rather than a recreation. They sit near zero on purpose. */
const DEFAULT_GRADE = {
  quantLevels: 48,        // a little above RGB555; keeps banding without mud
  ditherAmount: 1.0,
  grain: 0.042,
  scanline: 0.07,
  aberration: 0.12,
  vignette: 0.56,
  barrel: 0.0,
  saturation: 0.82,
  colorLift: [0.012, 0.008, 0.006],
  colorGain: [1.05, 0.97, 0.90],   // warm highlights, cold shadows: rust and ash
  flicker: 0.0
};

class Camera {
  constructor() {
    this.position = vec3.create(0, 0, 0);
    this.pitch = 0;           // radians, +up
    this.yaw = 0;             // radians, +left
    this.roll = 0;
    this.fov = 62 * SATG.util.DEG;
    this.near = 0.03;
    this.far = 40;
    this.view = mat4.create();
    this.proj = mat4.create();
    this.viewProj = mat4.create();
  }

  /* Build view from yaw/pitch/roll without ever forming a look-at target,
     so the camera stays well behaved when pitched straight down at the desk. */
  update(aspect) {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);

    // forward for yaw about +Y then pitch about local X
    const fx = -sy * cp, fy = sp, fz = -cy * cp;
    const target = vec3.create(
      this.position[0] + fx,
      this.position[1] + fy,
      this.position[2] + fz
    );

    let up = vec3.create(0, 1, 0);
    if (this.roll !== 0) {
      const cr = Math.cos(this.roll), sr = Math.sin(this.roll);
      const right = vec3.create(cy, 0, -sy);
      up = vec3.create(
        up[0] * cr + right[0] * sr,
        up[1] * cr + right[1] * sr,
        up[2] * cr + right[2] * sr
      );
    }

    mat4.lookAt(this.view, this.position, target, up);
    mat4.perspective(this.proj, this.fov, aspect, this.near, this.far);
    mat4.multiply(this.viewProj, this.proj, this.view);
    return this;
  }

  forward(out) {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    return vec3.set(out || vec3.create(), -sy * cp, sp, -cy * cp);
  }

  /**
   * Unproject a point in 0..1 screen space (origin top-left) into a world
   * ray. Used for picking, so the player aims with the cursor rather than
   * having to centre the whole camera on a small object.
   * Call after update(); returns {origin, dir} with dir normalised.
   */
  rayFromScreen(u, v, out) {
    const inv = mat4.invert(_invVP, this.viewProj);
    if (!inv) return null;

    const nx = u * 2 - 1;
    const ny = 1 - v * 2;

    const near = unproject(_p0, nx, ny, -1, inv);
    const far  = unproject(_p1, nx, ny,  1, inv);

    const dir = out || vec3.create();
    vec3.normalize(dir, vec3.sub(dir, far, near));
    return { origin: this.position, dir };
  }
}

const _invVP = mat4.create();
const _p0 = vec3.create();
const _p1 = vec3.create();

/* Apply an inverse view-projection to a clip-space point and divide by w. */
function unproject(out, x, y, z, m) {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  const iw = Math.abs(w) < 1e-9 ? 1 : 1 / w;
  out[0] = (m[0] * x + m[4] * y + m[8]  * z + m[12]) * iw;
  out[1] = (m[1] * x + m[5] * y + m[9]  * z + m[13]) * iw;
  out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) * iw;
  return out;
}

/* Default material. Anything the scene omits falls back to these. */
const DEFAULT_MATERIAL = {
  map: null,
  tint: [1, 1, 1],
  emissive: [0, 0, 0],
  alpha: 1,
  alphaCutoff: 0.5,
  snap: 1,              // lattice size in low-res pixels; 0 disables snapping
  /* Lower than before because the buffer is now 540 lines rather than 270:
     the lattice is half the size in world terms, so the same blend would read
     as twice the twitch. */
  jitter: 0.45,
  affine: 1,            // 0 disables the PS1 texture warp
  uvScale: [1, 1],
  uvScroll: 0,
  cull: true,
  depthWrite: true,
  depthTest: true,
  blend: false
};

class Pipeline {
  constructor(canvas) {
    const gl = SATG.gl.createContext(canvas);
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.canvas = canvas;

    this.progWorld   = new Program(gl, S.WORLD_VERT,   S.WORLD_FRAG,   'world');
    this.progPost    = new Program(gl, S.FS_VERT,      S.POST_FRAG,    'post');
    this.progBlit    = new Program(gl, S.FS_VERT,      S.BLIT_FRAG,    'blit');
    this.progOverlay = new Program(gl, S.OVERLAY_VERT, S.OVERLAY_FRAG, 'overlay');

    this.tri = createFullscreenTri(gl);
    // Attribute-less overlay quads still need *some* VAO bound in WebGL2.
    this.emptyVao = gl.createVertexArray();

    this.lowRT  = new RenderTarget(gl, 427, 240, { filter: gl.NEAREST });
    this.compRT = new RenderTarget(gl, 1280, 720, { filter: gl.NEAREST, depth: false });

    this.camera = new Camera();
    this.grade = Object.assign({}, DEFAULT_GRADE);

    this.fade = 1;                       // 1 visible, 0 black
    /* Player-set output gain, folded into uFade at present().

       It rides the same uniform as the transition fade on purpose: the shader
       does one multiply at the very end of the chain, which is exactly where a
       brightness control belongs, and reusing it means no shader change - the
       one part of this pipeline where a mistake shows up as corruption rather
       than as a wrong number. Above 1 the multiply simply clips at the
       framebuffer, which is the correct behaviour for "brighter". */
    this.brightness = 1;
    this.time = 0;
    this.fogColor = [0.016, 0.011, 0.009];
    this.fogDensity = 0.165;          // dense enough to swallow the far wall
    this.ambient = [0.014, 0.012, 0.011];
    this.lights = [];

    // Flattened light uniforms, refilled per world pass.
    this._lp = new Float32Array(S.MAX_LIGHTS * 3);
    this._lc = new Float32Array(S.MAX_LIGHTS * 3);
    this._lr = new Float32Array(S.MAX_LIGHTS);

    this._model = mat4.create();
    this._normal = new Float32Array(9);

    this.width = 1; this.height = 1;
    this.resize();
  }

  /* ------------------------------------------------------------- sizing */

  resize() {
    /* Follow the display's real pixel ratio.

       This used to be pinned to 1, on the reasoning that the world buffer
       already sets the image's resolution so extra backbuffer pixels buy
       nothing. That reasoning is wrong, and the way it is wrong is ugly.

       Pinning to 1 means the backing store is CSS-pixel sized and the browser
       scales it to the physical display itself. On a screen at 125% or 150%
       - the default on a great many Windows laptops - that scale factor is
       FRACTIONAL, so nearest-neighbour gives some source pixels two device
       pixels and their neighbours one. Columns and rows come out unevenly
       wide, and one-pixel font strokes are duplicated in places and dropped
       in others. On the chunky 3D room that reads as shimmer; on the exam
       sheet, whose whole point is being readable, it reads as the text being
       eaten - which is exactly the kind of damage that gets reported as
       "corruption".

       Rendering at the device ratio makes the final blit 1:1 and the problem
       disappears. It costs fill rate only in the composite and overlay
       passes; the world buffer stays at INTERNAL_HEIGHT and stays chunky,
       which is where the look actually comes from. Capped at 2 so a 3x phone
       panel does not quadruple the cost for detail nobody can resolve. */
    const dpr = Math.max(1, Math.min(global.devicePixelRatio || 1, 2));

    /* Whole-number companion to `dpr`, for anything drawn in absolute pixels:
       HUD bars, menu type, the reticle sprite. Those live in composite-buffer
       pixels, which are now device pixels, so without this they would cover
       half the physical area on a 200%-scaled display. Rounded rather than
       fractional because the font is a bitmap and a 1.5x glyph resamples
       unevenly - which is the very artifact the dpr change removes. */
    this.uiScale = Math.max(1, Math.round(dpr));
    const cssW = this.canvas.clientWidth || global.innerWidth || 1280;
    const cssH = this.canvas.clientHeight || global.innerHeight || 720;

    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.width = w;
    this.height = h;
    this.aspect = w / h;

    // World buffer: fixed height, width follows aspect, both forced even so
    // the nearest-neighbour upscale stays on a regular lattice.
    const lowH = INTERNAL_HEIGHT;
    let lowW = Math.round(lowH * this.aspect);
    lowW = Math.min(MAX_INTERNAL_WIDTH, Math.max(160, lowW));
    lowW += lowW & 1;
    this.lowRT.resize(lowW, lowH);

    /* The composite buffer wants to be exactly the size of the canvas, so
       present() is a 1:1 blit and the overlays - which are drawn at this
       resolution precisely so the exam text is legible - are not resampled
       on the way to the screen. The cap only exists to stop a very large
       display from costing two enormous full-screen passes; at 2160 lines
       every ordinary monitor, including 1440p at 150%, lands on 1:1. */
    const compScale = Math.min(1, 2160 / Math.max(1, h));
    this.compRT.resize(Math.round(w * compScale), Math.round(h * compScale));
    return this;
  }

  /* -------------------------------------------------------------- world */

  setLights(lights) { this.lights = lights || []; return this; }

  beginWorld() {
    const gl = this.gl;
    this.lowRT.bind(true, this.fogColor[0], this.fogColor[1], this.fogColor[2]);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.disable(gl.BLEND);

    this.camera.update(this.lowRT.width / this.lowRT.height);

    const n = Math.min(this.lights.length, S.MAX_LIGHTS);
    for (let i = 0; i < n; i++) {
      const L = this.lights[i];
      this._lp[i * 3] = L.position[0];
      this._lp[i * 3 + 1] = L.position[1];
      this._lp[i * 3 + 2] = L.position[2];
      const inten = L.intensity === undefined ? 1 : L.intensity;
      this._lc[i * 3] = L.color[0] * inten;
      this._lc[i * 3 + 1] = L.color[1] * inten;
      this._lc[i * 3 + 2] = L.color[2] * inten;
      this._lr[i] = L.range === undefined ? 5 : L.range;
    }

    const p = this.progWorld.use();
    p.mat4('uView', this.camera.view)
     .mat4('uProj', this.camera.proj)
     .vec3v('uAmbient', this.ambient)
     .int('uLightCount', n)
     .vec3v('uLightPos', this._lp)
     .vec3v('uLightColor', this._lc)
     .floatv('uLightRange', this._lr)
     .vec3v('uFogColor', this.fogColor)
     .float('uFogDensity', this.fogDensity)
     .float('uTime', this.time);

    this._activeLightCount = n;
    return this;
  }

  /**
   * Draw one mesh. `modelMatrix` is a mat4; `material` is a partial override
   * of DEFAULT_MATERIAL.
   */
  drawMesh(mesh, modelMatrix, material) {
    const gl = this.gl;
    const m = material || DEFAULT_MATERIAL;
    const get = (k) => (m[k] !== undefined ? m[k] : DEFAULT_MATERIAL[k]);

    const p = this.progWorld;   // already in use from beginWorld
    gl.useProgram(p.program);
    p._unit = 0;

    mat4.normalMat3(this._normal, modelMatrix);

    // Snap grid in NDC units: 1 low-res pixel spans 2/width in NDC, so the
    // divisor is width/2. Scaling that down coarsens the twitch.
    const snapAmt = get('snap');
    const sx = snapAmt > 0 ? (this.lowRT.width * 0.5) / snapAmt : 0;
    const sy = snapAmt > 0 ? (this.lowRT.height * 0.5) / snapAmt : 0;

    const uv = get('uvScale');
    p.mat4('uModel', modelMatrix)
     .mat3('uNormalMat', this._normal)
     .vec2('uSnap', sx, sy)
     .float('uJitter', get('jitter'))
     .float('uAffine', get('affine'))
     .vec3v('uTint', get('tint'))
     .vec3v('uEmissive', get('emissive'))
     .float('uAlpha', get('alpha'))
     .float('uAlphaCutoff', get('alphaCutoff'))
     .vec2('uUvScale', uv[0], uv[1])
     .float('uUvScroll', get('uvScroll'));

    const map = get('map');
    p.float('uHasMap', map ? 1 : 0);
    if (map) p.tex('uMap', map);

    if (get('cull')) { gl.enable(gl.CULL_FACE); } else { gl.disable(gl.CULL_FACE); }
    gl.depthMask(!!get('depthWrite'));
    if (get('depthTest')) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
    if (get('blend')) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      gl.disable(gl.BLEND);
    }

    mesh.draw();
    return this;
  }

  /* Upscale the world buffer into the composite buffer. */
  endWorld() {
    const gl = this.gl;
    this.compRT.bind(true, 0, 0, 0);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);

    const g = this.grade;
    const p = this.progPost.use();
    p.tex('uMap', this.lowRT.color)
     .vec2('uResolution', this.compRT.width, this.compRT.height)
     .vec2('uLowRes', this.lowRT.width, this.lowRT.height)
     .float('uTime', this.time)
     .float('uQuantLevels', 0)          // single quantise happens at present()
     .float('uDitherAmount', 0)
     .float('uGrain', 0)
     .float('uScanline', g.scanline)
     .float('uAberration', g.aberration)
     .float('uVignette', 0)
     .float('uBarrel', 0)
     .float('uFade', 1)
     .vec3v('uColorLift', g.colorLift)
     .vec3v('uColorGain', g.colorGain)
     .float('uSaturation', g.saturation)
     .float('uFlicker', g.flicker);
    this.tri.draw();
    return this;
  }

  /* ------------------------------------------------------------ overlays
     Drawn into the composite buffer at native resolution. `rect` is
     {x,y,w,h} in 0..1 screen space with the origin at the top-left. */

  beginOverlays() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.compRT.fbo);
    gl.viewport(0, 0, this.compRT.width, this.compRT.height);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    /* Premultiplied source: rgb is already scaled by alpha, so it is added
       rather than scaled again. Matches the canvas-native texture format the
       overlays are uploaded in - see gl.createContext. */
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.emptyVao);
    return this;
  }

  drawOverlay(texture, rect, opts) {
    const gl = this.gl;
    opts = opts || {};
    const c = opts.color || [1, 1, 1, 1];
    const uvr = opts.uvRect || [0, 0, 1, 1];

    const p = this.progOverlay.use();
    p.vec4('uRect', rect.x, rect.y, rect.w, rect.h)
     .vec4('uUvRect', uvr[0], uvr[1], uvr[2], uvr[3])
     .float('uRotate', opts.rotate || 0)
     .vec4('uColor', c[0], c[1], c[2], c[3])
     .float('uHasMap', texture ? 1 : 0)
     .float('uQuantLevels', opts.quantLevels || 0)
     .float('uDitherAmount', opts.ditherAmount || 0)
     .vec2('uResolution', this.compRT.width, this.compRT.height);
    if (texture) p.tex('uMap', texture);

    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this;
  }

  /* Solid colour rect - separators, letterboxing, flashes. */
  fillRect(rect, rgba) {
    return this.drawOverlay(null, rect, { color: rgba });
  }

  /* ------------------------------------------------------------- present */

  present() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);

    const g = this.grade;
    const p = this.progPost.use();
    p.tex('uMap', this.compRT.color)
     .vec2('uResolution', this.width, this.height)
     .vec2('uLowRes', this.lowRT.width, this.lowRT.height)
     .float('uTime', this.time)
     .float('uQuantLevels', g.quantLevels)
     .float('uDitherAmount', g.ditherAmount)
     .float('uGrain', g.grain)
     .float('uScanline', 0)             // already applied in endWorld()
     .float('uAberration', 0)
     .float('uVignette', g.vignette)
     .float('uBarrel', g.barrel)
     .float('uFade', clamp(this.fade, 0, 1) * this.brightness)
     .vec3v('uColorLift', [0, 0, 0])
     .vec3v('uColorGain', [1, 1, 1])
     .float('uSaturation', 1)
     .float('uFlicker', 0);
    this.tri.draw();
    return this;
  }

  /* A frame that is only 2D (title card, lose screen): skip the world pass
     entirely but keep the exact same grade so the menus belong to the game. */
  beginFlat(r, g, b) {
    const gl = this.gl;
    this.compRT.bind(true, r || 0, g || 0, b || 0);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    return this;
  }
}

/* --------------------------------------------------------------- exports */

SATG.render = { Pipeline, Camera, DEFAULT_MATERIAL, DEFAULT_GRADE, INTERNAL_HEIGHT };

})(window);
