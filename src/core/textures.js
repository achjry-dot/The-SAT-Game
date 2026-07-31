/* =========================================================================
   textures.js - every surface in the game is generated here at load time.

   Nothing is fetched. That keeps the game runnable straight off the file
   system, but it is also the honest way to hit the target look: these are
   authored at 64-128px, in a deliberately narrow rust/ash palette, and are
   point-sampled forever after. A downloaded 2K PBR texture would fight the
   renderer instead of feeding it.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;
const { clamp, lerp, smoothstep, makeRng } = SATG.util;

/* --------------------------------------------------------------- helpers */

function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/* Integer hash -> [0,1). Used as the lattice for tileable value noise. */
function hash2(ix, iy, seed) {
  let h = ix * 374761393 + iy * 668265263 + seed * 1274126177;
  h = (h ^ (h >> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

/* Value noise on a lattice that wraps at `period`, so the result tiles. */
function valueNoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const w = (n) => ((n % period) + period) % period;

  const x0 = w(xi), x1 = w(xi + 1);
  const y0 = w(yi), y1 = w(yi + 1);

  const u = smoothstep(xf), v = smoothstep(yf);
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

/* Fractal sum of tileable value noise. `octaves` beyond ~5 is wasted at these
   texture sizes - the lattice is finer than a texel by then. */
function fbm(x, y, baseFreq, octaves, seed, lacunarity, gain) {
  lacunarity = lacunarity || 2;
  gain = gain === undefined ? 0.5 : gain;
  let sum = 0, amp = 1, norm = 0, freq = baseFreq;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x * freq, y * freq, freq, seed + o * 101) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/* Ridged noise - the sharp creases that read as scratches and weld seams. */
function ridged(x, y, baseFreq, octaves, seed) {
  let sum = 0, amp = 1, norm = 0, freq = baseFreq;
  for (let o = 0; o < octaves; o++) {
    const n = Math.abs(valueNoise(x * freq, y * freq, freq, seed + o * 71) * 2 - 1);
    sum += (1 - n) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/* Write a per-texel callback into a canvas. `fn(u, v, x, y)` returns
   [r,g,b] in 0..255 (alpha optional as a 4th element). */
function paint(size, fn) {
  const h = (typeof size === 'number') ? size : size.h;
  const w = (typeof size === 'number') ? size : size.w;
  const cv = newCanvas(w, h);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = fn(x / w, y / h, x, y);
      const i = (y * w + x) * 4;
      d[i]     = clamp(c[0], 0, 255) | 0;
      d[i + 1] = clamp(c[1], 0, 255) | 0;
      d[i + 2] = clamp(c[2], 0, 255) | 0;
      d[i + 3] = c.length > 3 ? (clamp(c[3], 0, 255) | 0) : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/* Collapse to a small palette. Real PS1 textures were 4- or 8-bit indexed,
   and that flatness is a big part of why they read as "of the era". */
function posterize(v, steps) {
  return Math.round(v * (steps - 1)) / (steps - 1);
}

function mixRgb(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/* --------------------------------------------------------------- palette
   Everything in the room is drawn from this. Narrow on purpose: dried blood,
   oxidised iron, cold concrete, nicotine light, and a single sickly CRT green. */

/* These are ALBEDO values, not final pixel values. Whatever is written here
   is the ceiling the lighting can reach - a surface can never be brighter
   than its own texture. Authoring them at "looks correctly gloomy in a paint
   program" brightness is the classic mistake: multiply that by a dim lamp and
   the room becomes literally invisible. So the palette sits mid-bright and
   desaturated, and the darkness is produced by the lighting, the fog and the
   grade, which is where it belongs and where it can be tuned. */
const PAL = {
  rustDark:   [ 74,  42,  30],
  rustMid:    [148,  80,  50],
  rustLight:  [206, 124,  78],
  ironDark:   [ 56,  56,  60],
  ironMid:    [116, 116, 122],
  ironLight:  [178, 178, 184],
  concDark:   [ 76,  71,  65],
  concMid:    [146, 138, 126],
  concLight:  [204, 196, 182],
  woodDark:   [ 66,  47,  33],
  woodMid:    [126,  90,  60],
  woodLight:  [180, 138,  96],
  paperDark:  [140, 128, 108],
  paperMid:   [196, 185, 163],
  paperLight: [226, 219, 202],
  crtGreen:   [ 86, 255, 128],
  crtDim:     [ 26,  64,  36],
  bloodDeep:  [ 84,  26,  24]
};

/* =========================================================================
   Surface generators. Each returns a canvas ready to hand to gl.Texture.
   ========================================================================= */

/* Oxidised sheet steel - the room's walls and most of its hardware. */
function rustedSteel(size, seed) {
  size = size || 128;
  return paint(size, (u, v) => {
    const grime = fbm(u, v, 4, 5, seed);
    const patch = fbm(u, v, 2, 3, seed + 500);
    const scratch = ridged(u, v, 12, 3, seed + 900);

    // Rust blooms where the low-frequency patch mask is strong.
    const rustMask = smoothstep(clamp((patch - 0.42) * 3.0, 0, 1));

    let c = mixRgb(PAL.ironDark, PAL.ironMid, posterize(grime, 6));
    c = mixRgb(c, mixRgb(PAL.rustDark, PAL.rustLight, posterize(grime, 5)), rustMask * 0.85);

    // Scratches expose brighter metal underneath.
    const s = smoothstep(clamp((scratch - 0.72) * 6.0, 0, 1));
    c = mixRgb(c, PAL.ironLight, s * 0.5);

    // Horizontal panel seams every quarter of the sheet.
    const seam = Math.abs(((v * 4) % 1) - 0.5) > 0.47 ? 1 : 0;
    c = mixRgb(c, PAL.ironDark, seam * 0.6);

    return c;
  });
}

/* Poured concrete - floor and ceiling. Coarser, colder, less saturated. */
function concrete(size, seed) {
  size = size || 128;
  return paint(size, (u, v) => {
    const grain = fbm(u, v, 8, 5, seed);
    const blotch = fbm(u, v, 3, 3, seed + 313);
    const speck = hash2((u * size) | 0, (v * size) | 0, seed + 77);

    let c = mixRgb(PAL.concDark, PAL.concMid, posterize(grain * 0.6 + blotch * 0.4, 7));
    // Aggregate showing through as darker/lighter chips.
    if (speck > 0.965) c = mixRgb(c, PAL.concLight, 0.7);
    else if (speck < 0.03) c = mixRgb(c, PAL.concDark, 0.8);

    // Damp staining creeping up from the low-frequency mask.
    const damp = smoothstep(clamp((blotch - 0.55) * 2.5, 0, 1));
    c = mixRgb(c, PAL.rustDark, damp * 0.35);
    return c;
  });
}

/* The examination table's top. Old hardwood, heavily worn, faint stains. */
function tableWood(size, seed) {
  size = size || 128;
  return paint(size, (u, v) => {
    // Stretch the noise along one axis so the grain runs with the boards.
    const g = fbm(u * 0.35, v * 4.0, 6, 5, seed);
    const rings = Math.abs(Math.sin((g * 9.0 + v * 22.0) * Math.PI));
    const wear = fbm(u, v, 3, 4, seed + 611);

    let c = mixRgb(PAL.woodDark, PAL.woodMid, posterize(rings, 5));
    c = mixRgb(c, PAL.woodLight, smoothstep(clamp((wear - 0.6) * 3, 0, 1)) * 0.35);

    // Plank joints running the length of the table.
    const plank = Math.abs(((u * 3) % 1) - 0.5) > 0.485 ? 1 : 0;
    c = mixRgb(c, [16, 11, 8], plank * 0.85);

    // Old dark stains, low frequency and sparse.
    const stain = fbm(u, v, 2, 3, seed + 1201);
    c = mixRgb(c, PAL.bloodDeep, smoothstep(clamp((stain - 0.68) * 4, 0, 1)) * 0.28);
    return c;
  });
}

/* Blank paper stock. The question text is drawn over this at runtime by
   paper.js; this layer supplies the fibre, foxing and age. */
function paperStock(w, h, seed) {
  return paint({ w: w, h: h }, (u, v) => {
    const fibre = fbm(u, v, 22, 4, seed);
    const age = fbm(u, v, 2.5, 3, seed + 404);
    let c = mixRgb(PAL.paperMid, PAL.paperLight, posterize(fibre, 5));

    // Foxing - the brown speckling old paper develops.
    const fox = smoothstep(clamp((age - 0.58) * 3.2, 0, 1));
    c = mixRgb(c, PAL.paperDark, fox * 0.55);

    // Edges darken; the sheet has been handled.
    const edge = Math.min(Math.min(u, 1 - u) * 12, Math.min(v, 1 - v) * 16);
    c = mixRgb(mixRgb(c, PAL.paperDark, 0.5), c, clamp(edge, 0, 1));
    return c;
  });
}

/* Dark moulded plastic - the calculator's shell. */
function plasticShell(size, seed) {
  size = size || 64;
  return paint(size, (u, v) => {
    const n = fbm(u, v, 14, 3, seed);
    const base = [38, 36, 34];
    const hi = [62, 60, 56];
    let c = mixRgb(base, hi, posterize(n, 4));
    const scuff = ridged(u, v, 9, 2, seed + 88);
    c = mixRgb(c, [78, 74, 68], smoothstep(clamp((scuff - 0.78) * 5, 0, 1)) * 0.4);
    return c;
  });
}

/* Unlit CRT glass. Emissive content is drawn onto its own canvas elsewhere;
   this is the dead tube - dusty, faintly green, slightly convex-looking. */
function crtGlass(size, seed) {
  size = size || 64;
  return paint(size, (u, v) => {
    const dust = fbm(u, v, 10, 3, seed);
    let c = mixRgb([10, 14, 11], PAL.crtDim, posterize(dust, 4));
    // Phosphor stripe, visible even when the tube is cold.
    const stripe = ((v * size) | 0) % 3 === 0 ? 0.75 : 1.0;
    c = [c[0] * stripe, c[1] * stripe, c[2] * stripe];
    return c;
  });
}

/* Cast iron with heavy pitting - chair frame, brackets, the seat restraint. */
function pittedIron(size, seed) {
  size = size || 64;
  return paint(size, (u, v) => {
    const pit = fbm(u, v, 16, 4, seed);
    const rust = fbm(u, v, 5, 3, seed + 222);
    let c = mixRgb(PAL.ironDark, PAL.ironMid, posterize(pit, 5));
    c = mixRgb(c, PAL.rustMid, smoothstep(clamp((rust - 0.5) * 2.6, 0, 1)) * 0.6);
    // Deep pits read almost black.
    c = mixRgb(c, [12, 10, 10], smoothstep(clamp((0.28 - pit) * 5, 0, 1)) * 0.8);
    return c;
  });
}

/* A flat, faintly noisy fill. For anything that needs to exist but not be
   looked at - cable runs, undersides, backing panels. */
function flatGrime(size, rgb, seed, strength) {
  size = size || 32;
  strength = strength === undefined ? 0.18 : strength;
  return paint(size, (u, v) => {
    const n = fbm(u, v, 8, 3, seed);
    const k = 1 + (posterize(n, 4) - 0.5) * strength * 2;
    return [rgb[0] * k, rgb[1] * k, rgb[2] * k];
  });
}

/* =========================================================================
   Build the full set once, at boot.
   ========================================================================= */

function buildAll(gl) {
  const rng = makeRng(0x5A7C0DE);           // fixed: the room looks the same every run
  const s = () => rng.int(1, 1 << 20);

  const mk = (canvas, opts) => new SATG.gl.Texture(gl, Object.assign({
    source: canvas,
    filter: gl.NEAREST,
    wrap: gl.REPEAT,
    mipmap: true            // NEAREST_MIPMAP_LINEAR: crisp texels, no shimmer
  }, opts || {}));

  /* Doubled from the original 64-128px set now that the world renders at 540
     lines. Detail in these textures is what carries the grime - the noise is
     authored at texel scale, so giving them more texels adds dirt rather than
     smoothing it away. Still tiny by modern standards, and still tiled hard. */
  return {
    steel:    mk(rustedSteel(256, s())),
    concrete: mk(concrete(256, s())),
    wood:     mk(tableWood(256, s())),
    plastic:  mk(plasticShell(128, s())),
    iron:     mk(pittedIron(128, s())),
    crt:      mk(crtGlass(128, s())),
    cable:    mk(flatGrime(64, [26, 24, 24], s(), 0.3)),
    rubber:   mk(flatGrime(64, [22, 21, 20], s(), 0.22)),
    paper:    mk(paperStock(256, 256, s()), { wrap: gl.CLAMP_TO_EDGE })
  };
}

/* --------------------------------------------------------------- exports */

SATG.textures = {
  buildAll, paint, newCanvas, fbm, ridged, valueNoise, posterize, mixRgb,
  paperStock, rustedSteel, concrete, tableWood, plasticShell, crtGlass,
  pittedIron, flatGrime, PAL
};

})(window);
