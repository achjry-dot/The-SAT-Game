/* =========================================================================
   shaders.js - the look, in GLSL.

   The brief was that the low-poly / PSX quality must be a real rendering
   style rather than a filter pasted over a modern image. So the defining
   artifacts are produced at the stage that actually produced them on the
   hardware being imitated:

     vertex stage    vertex snapping to an integer screen lattice
                     affine (non perspective-correct) UV interpolation
                     Gouraud lighting - lit per vertex, never per pixel
                     per-vertex exponential fog
     raster stage    a genuinely small framebuffer, point-sampled upward
     output stage    5-bit-per-channel quantisation + ordered dithering

   Only the last group is post-processing, and it is the group the PS1 also
   did last (in its DAC). Grain, vignette, scanlines and aberration sit on
   top as CRT/VHS presentation, tuned low - they flatter the image, they do
   not create the style.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;

/* Max simultaneous point lights. The exam room uses far fewer; the cap is
   sized so the loop stays fully unrollable on weak integrated GPUs. */
const MAX_LIGHTS = 8;

/* ------------------------------------------------------- shared preamble */

const COMMON = `
#define MAX_LIGHTS ${MAX_LIGHTS}

// 4x4 Bayer threshold matrix, returned in [0,1).
// Ordered dithering is what turns harsh 5-bit banding into the characteristic
// PSX crosshatch gradient. Without it, quantisation alone just looks broken.
float bayer4(vec2 p) {
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  int i = y * 4 + x;
  float v =
    i == 0  ?  0.0 : i == 1  ?  8.0 : i == 2  ?  2.0 : i == 3  ? 10.0 :
    i == 4  ? 12.0 : i == 5  ?  4.0 : i == 6  ? 14.0 : i == 7  ?  6.0 :
    i == 8  ?  3.0 : i == 9  ? 11.0 : i == 10 ?  1.0 : i == 11 ?  9.0 :
    i == 12 ? 15.0 : i == 13 ?  7.0 : i == 14 ? 13.0 :             5.0;
  return v / 16.0;
}

// Quantise to a fixed number of levels per channel, dithered.
// levels = 32 reproduces the PS1's RGB555 output.
vec3 quantizeDither(vec3 c, float levels, vec2 pixel, float amount) {
  float d = (bayer4(pixel) - 0.5) * amount;
  vec3 q = floor(c * levels + d + 0.5) / levels;
  return clamp(q, 0.0, 1.0);
}

// Cheap hash noise, used for film grain and lamp instability.
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

/* =========================================================================
   WORLD - the PSX pipeline proper
   ========================================================================= */

const WORLD_VERT = `#version 300 es
precision highp float;
${COMMON}

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
layout(location = 3) in vec3 aColor;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
uniform mat3 uNormalMat;

// Virtual lattice the vertices snap to, in half-pixels of the low-res target.
uniform vec2  uSnap;

// Blend toward the snapped position. Full strength every frame at 60fps reads
// as broken rather than retro - real PS1 games ran at 20-30fps, which masked
// it. 0.6-0.75 is the honest range; held/readable objects drop it further.
uniform float uJitter;

// 0 = perspective-correct UVs, 1 = full PS1 affine warping.
uniform float uAffine;

uniform vec3  uAmbient;
uniform int   uLightCount;
uniform vec3  uLightPos[MAX_LIGHTS];
uniform vec3  uLightColor[MAX_LIGHTS];
uniform float uLightRange[MAX_LIGHTS];
uniform vec3  uEmissive;
uniform float uFogDensity;
uniform vec2  uUvScale;
uniform float uUvScroll;
uniform float uTime;

out vec2  vUv;
out float vW;
out vec3  vLight;
out float vFog;
out vec3  vVertColor;

void main() {
  vec4 world   = uModel * vec4(aPosition, 1.0);
  vec4 viewPos = uView * world;
  vec4 clip    = uProj * viewPos;

  /* ---- vertex snapping ------------------------------------------------
     The PS1 had no floating-point rasteriser: transformed vertices landed on
     an integer lattice, so geometry visibly twitches as the camera moves.
     Snapping in NDC and multiplying back by w reproduces it exactly, and it
     correctly gets weaker with distance the way the hardware's did.
     Guarded on w > 0 so vertices behind the eye are not folded forward. */
  if (uSnap.x > 0.0 && uJitter > 0.0 && clip.w > 0.0) {
    vec2 ndc = clip.xy / clip.w;
    vec2 snapped = floor(ndc * uSnap + 0.5) / uSnap;
    clip.xy = mix(ndc, snapped, uJitter) * clip.w;
  }
  gl_Position = clip;

  /* ---- affine texture mapping ----------------------------------------
     The rasteriser interpolates (V/w) linearly in screen space and divides
     by the interpolated (1/w) to get a perspective-correct varying. Feeding
     it V = uv*w makes that division cancel out, leaving uv interpolated
     linearly in *screen* space - which is precisely the PS1's texture swim.
     The fragment stage completes it with vUv / vW. */
  float w  = max(clip.w, 1e-4);
  float aw = mix(1.0, w, uAffine);
  vUv = (aUv * uUvScale + vec2(0.0, uUvScroll)) * aw;
  vW  = aw;

  /* ---- Gouraud lighting ----------------------------------------------
     Lit once per vertex and interpolated. This is the single biggest reason
     PSX-era scenes read the way they do: light pools across a face as a flat
     gradient instead of wrapping around per-pixel detail. */
  vec3 N   = normalize(uNormalMat * aNormal);
  vec3 acc = uAmbient;

  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= uLightCount) break;
    vec3  d    = uLightPos[i] - world.xyz;
    float dist = length(d);
    float att  = clamp(1.0 - dist / max(uLightRange[i], 1e-3), 0.0, 1.0);
    att *= att;                                  // quadratic-ish falloff
    float ndl  = max(dot(N, d / max(dist, 1e-4)), 0.0);
    /* Only a slight lambert wrap. A large constant here acts as fill light on
       every surface at once and flattens the room into an evenly lit box -
       the pool of light stops being a pool. 0.12 keeps back faces from
       crushing to pure black without lighting the whole scene. */
    ndl = ndl * 0.88 + 0.12;
    acc += uLightColor[i] * ndl * att;
  }

  vLight     = acc + uEmissive;
  vVertColor = aColor;

  /* ---- per-vertex fog -------------------------------------------------
     Exp-squared, evaluated here rather than per fragment. On big floor polys
     this produces the slightly wrong, banded falloff of the era. */
  float fd = length(viewPos.xyz) * uFogDensity;
  vFog = 1.0 - exp(-fd * fd);
}
`;

const WORLD_FRAG = `#version 300 es
precision highp float;
${COMMON}

in vec2  vUv;
in float vW;
in vec3  vLight;
in float vFog;
in vec3  vVertColor;

uniform sampler2D uMap;
uniform float uHasMap;
uniform vec3  uTint;
uniform vec3  uFogColor;
uniform float uAlpha;
uniform float uAlphaCutoff;

out vec4 fragColor;

void main() {
  vec2 uv = vUv / vW;                  // completes the affine mapping

  vec4 texel = vec4(1.0);
  if (uHasMap > 0.5) texel = texture(uMap, uv);

  // Cutout transparency, the way the hardware did it - no sorting required.
  if (texel.a < uAlphaCutoff) discard;

  vec3 c = uTint * vVertColor * texel.rgb;
  c *= vLight;
  c = mix(c, uFogColor, clamp(vFog, 0.0, 1.0));

  fragColor = vec4(c, uAlpha * texel.a);
}
`;

/* =========================================================================
   FULLSCREEN passes
   ========================================================================= */

/* One oversized triangle. No diagonal seam, one vertex fewer than a quad. */
const FS_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const BLIT_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uMap;
uniform float uAlpha;
out vec4 fragColor;
void main() { fragColor = vec4(texture(uMap, vUv).rgb, uAlpha); }
`;

/* ------------------------------------------------------------------ post */

const POST_FRAG = `#version 300 es
precision highp float;
${COMMON}

in vec2 vUv;

uniform sampler2D uMap;
uniform vec2  uResolution;      // output resolution, device pixels
uniform vec2  uLowRes;          // the low-res buffer's own size
uniform float uTime;

uniform float uQuantLevels;     // 32.0 = RGB555
uniform float uDitherAmount;
uniform float uGrain;
uniform float uScanline;
uniform float uAberration;
uniform float uVignette;
uniform float uBarrel;
uniform float uFade;            // 1 = full image, 0 = black (scene transitions)
uniform vec3  uColorLift;       // crushed-black tint
uniform vec3  uColorGain;
uniform float uSaturation;
uniform float uFlicker;

out vec4 fragColor;

// Very slight barrel distortion. At the intensities used here it is felt as
// "the image sits on glass" rather than seen as a fisheye.
vec2 barrel(vec2 uv, float k) {
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);
  return 0.5 + c * (1.0 + k * r2);
}

void main() {
  vec2 uv = uBarrel > 0.0 ? barrel(vUv, uBarrel) : vUv;

  // Outside the tube is black, not clamped edge-smear.
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  /* Dither, grain and scanlines are all indexed in LOW-RES pixel space, not
     canvas space. Get this wrong and you get a fine-grained pattern sitting
     on top of chunky upscaled pixels - two mismatched grid frequencies, which
     reads as a rendering bug rather than as a style. */
  vec2 pixel = floor(vUv * uLowRes);

  /* Chromatic aberration, sampled along the radial axis so it vanishes at the
     centre of the screen where the player is actually reading. */
  vec3 c;
  if (uAberration > 0.0) {
    vec2 dir = (uv - 0.5);
    float amt = uAberration * (0.5 + dot(dir, dir) * 2.0) / uLowRes.x;
    c.r = texture(uMap, uv + dir * amt * 2.0).r;
    c.g = texture(uMap, uv).g;
    c.b = texture(uMap, uv - dir * amt * 2.0).b;
  } else {
    c = texture(uMap, uv).rgb;
  }

  // ---- grade: lift/gain, then desaturate toward the rust-and-ash palette
  c = c * uColorGain + uColorLift;
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(luma), c, uSaturation);

  // ---- mains hum on the practical lights
  if (uFlicker > 0.0) {
    float f = 1.0 - uFlicker * (0.5 + 0.5 * sin(uTime * 47.0)) * hash12(vec2(floor(uTime * 24.0), 3.7));
    c *= f;
  }

  // ---- scanlines, locked to the low-res buffer's rows, not the monitor's
  if (uScanline > 0.0) {
    float line = sin(uv.y * uLowRes.y * 3.14159265);
    c *= 1.0 - uScanline * 0.5 * (1.0 - line * line);
  }

  // ---- film grain, one sample per low-res texel so it moves with the pixels
  if (uGrain > 0.0) {
    float n = hash12(pixel + vec2(floor(uTime * 24.0) * 17.3, floor(uTime * 24.0) * 41.7));
    c += (n - 0.5) * uGrain;
  }

  // ---- vignette
  if (uVignette > 0.0) {
    vec2 d = uv - 0.5;
    float v = 1.0 - uVignette * dot(d, d) * 2.2;
    c *= clamp(v, 0.0, 1.0);
  }

  // ---- fade to black, applied before quantisation so the fade itself bands
  c *= uFade;

  /* ---- final colour-depth reduction.
     Guarded: this pass runs twice per frame, and the intermediate composite
     deliberately passes uQuantLevels = 0 so the image is only quantised once,
     at present(). Dividing by a zero level count would blacken the frame. */
  c = clamp(c, 0.0, 1.0);
  if (uQuantLevels > 0.0) {
    c = quantizeDither(c, uQuantLevels, pixel, uDitherAmount);
  }

  fragColor = vec4(c, 1.0);
}
`;

/* =========================================================================
   OVERLAY - screen-space textured quads (paper, calculator, menus, HUD)

   Attribute-less: the quad is built from gl_VertexID with a 4-vertex
   TRIANGLE_STRIP, so no vertex buffer is needed. Rect is given in 0..1
   screen space with the origin top-left, which is how the 2D canvas code
   that produces these textures already thinks.
   ========================================================================= */

const OVERLAY_VERT = `#version 300 es
precision highp float;

uniform vec4 uRect;      // x, y, w, h  in 0..1 screen space, origin top-left
uniform vec4 uUvRect;    // u, v, w, h  in 0..1 texture space
uniform float uRotate;   // radians, about the quad's own centre

out vec2 vUv;

void main() {
  // 0->(0,0) 1->(1,0) 2->(0,1) 3->(1,1)
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));

  vUv = uUvRect.xy + corner * uUvRect.zw;

  vec2 p = corner - 0.5;
  if (uRotate != 0.0) {
    float s = sin(uRotate), co = cos(uRotate);
    p = vec2(p.x * co - p.y * s, p.x * s + p.y * co);
  }
  vec2 screen = uRect.xy + (p + 0.5) * uRect.zw;

  // 0..1 top-left origin -> clip space
  gl_Position = vec4(screen.x * 2.0 - 1.0, 1.0 - screen.y * 2.0, 0.0, 1.0);
}
`;

const OVERLAY_FRAG = `#version 300 es
precision highp float;
${COMMON}

in vec2 vUv;

uniform sampler2D uMap;
uniform vec4  uColor;        // rgb tint, a = opacity
uniform float uHasMap;
uniform float uQuantLevels;  // matches the world pass so overlays sit in-palette
uniform float uDitherAmount;
uniform vec2  uResolution;

out vec4 fragColor;

void main() {
  /* Sources are PREMULTIPLIED (see gl.createContext): rgb already carries the
     alpha. vec4(1.0) is the untextured case, which is valid premultiplied
     opaque white, so both branches stay in the same space.
     uColor is authored straight, so its alpha has to be folded into rgb here
     to keep the result premultiplied. The pass blends ONE, 1-SRC_ALPHA. */
  vec4 texel = uHasMap > 0.5 ? texture(uMap, vUv) : vec4(1.0);
  vec4 c = vec4(texel.rgb * uColor.rgb * uColor.a, texel.a * uColor.a);
  if (c.a <= 0.002) discard;

  // Overlays are drawn at native resolution so exam text stays legible.
  // Colour reduction is normally left to the final post pass so the image is
  // only quantised once; set uQuantLevels > 0 to band an overlay locally.
  if (uQuantLevels > 0.0) {
    c.rgb = quantizeDither(clamp(c.rgb, 0.0, 1.0), uQuantLevels,
                           gl_FragCoord.xy, uDitherAmount);
  }
  fragColor = c;
}
`;

/* --------------------------------------------------------------- exports */

SATG.shaders = {
  MAX_LIGHTS,
  WORLD_VERT, WORLD_FRAG,
  FS_VERT, BLIT_FRAG, POST_FRAG,
  OVERLAY_VERT, OVERLAY_FRAG
};

})(window);
