/* =========================================================================
   font.js - a real 1-bit bitmap font, built at boot.

   The brief calls for every string in the game to match the title card, so
   there is exactly one text path and everything goes through it. Rather than
   ship a font file (which would break running straight off the file system),
   each glyph is rasterised once from the platform monospace face at a small
   pixel size and then *thresholded to 1-bit*. That last step is the whole
   trick: it strips the antialiasing, so scaling up with nearest-neighbour
   yields hard, chunky pixels instead of a blurry system font.

   Everything downstream - menus, the exam paper, the calculator, the HUD -
   draws through `draw()` and inherits that look for free.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;

/* Base raster size. Small enough that thresholding reads as pixel art,
   large enough that lowercase stays distinguishable in exam passages. */
const FONT_PX = 12;

/* Alpha above which a sample counts as "ink". Tuned by eye: lower loses the
   thin strokes on 'e' and 's', higher makes everything look bolded. */
const INK_THRESHOLD = 100;

/* ASCII 32..126 plus the symbols SAT maths actually needs. */
const ASCII_FIRST = 32, ASCII_LAST = 126;
const EXTRA = '√π≤≥≠×÷°²³±' +
              '∞→←↑↓αβθ∑Δ•' +
              '‘’“”—–…';

const state = {
  ready: false,
  cellW: 8,
  cellH: 14,
  cols: 16,
  mask: null,           // white-on-transparent atlas
  index: Object.create(null),
  tinted: Object.create(null)
};

/* ------------------------------------------------------------------ build */

/* The character list, in atlas order. Both the baked path and the fallback
   path derive the layout from this, so they cannot drift apart. */
function charList() {
  const chars = [];
  for (let c = ASCII_FIRST; c <= ASCII_LAST; c++) chars.push(String.fromCharCode(c));
  for (const ch of EXTRA) if (chars.indexOf(ch) === -1) chars.push(ch);
  return chars;
}

/* ---- preferred path: decode the baked atlas from font-data.js.

   This is a WRITE into a canvas (putImageData), never a read. That matters:
   the old build step read a canvas back, and hardened browsers deliberately
   perturb canvas reads to defeat fingerprinting - which turned the font into
   noise on exactly those browsers. It also removes any dependence on which
   fonts happen to be installed, so the game's typography, line wrapping and
   layout are now byte-identical on every machine. */
function buildFromData(chars) {
  const D = SATG.FONT_DATA;
  if (!D || !D.bits) return null;
  if (D.glyphs !== chars.length) {
    console.warn('[font] baked atlas holds ' + D.glyphs + ' glyphs but the character ' +
                 'list has ' + chars.length + '; falling back to rasterising.');
    return null;
  }

  let bin;
  try {
    bin = atob(D.bits);
  } catch (err) {
    console.warn('[font] baked atlas failed to decode: ' + err.message);
    return null;
  }

  /* Verify the payload before trusting a single glyph of it.

     An earlier copy of font-data.js had been re-wrapped by hand and carried
     20 stray base64 characters. Everything downstream still "worked": the
     atlas decoded, the metrics were right, and the total ink count was
     exactly correct - because shifting the bits moves the ink without
     changing how much of it there is. What actually happened was that every
     glyph from the second row on came from the wrong cell, so the game
     rendered crisp, correctly-formed, completely wrong letters.

     Length and checksum both, because length alone would not have caught a
     substitution, and a checksum alone reads past a truncated file. */
  const total = D.width * D.height;
  const need = Math.ceil(total / 8);

  if (bin.length !== (D.bytes || need)) {
    console.warn('[font] baked atlas is ' + bin.length + ' bytes, expected ' +
                 (D.bytes || need) + '; falling back to rasterising.');
    return null;
  }

  if (D.checksum !== undefined) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < bin.length; i++) {
      hash ^= bin.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    if (hash !== D.checksum >>> 0) {
      console.warn('[font] baked atlas checksum is 0x' + hash.toString(16) +
                   ', expected 0x' + (D.checksum >>> 0).toString(16) +
                   '; the payload has been altered. Falling back to rasterising.');
      return null;
    }
  }

  const cv = document.createElement('canvas');
  cv.width = D.width;
  cv.height = D.height;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(D.width, D.height);
  const out = img.data;

  for (let i = 0; i < total; i++) {
    const on = (bin.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1;
    const o = i * 4;
    out[o] = out[o + 1] = out[o + 2] = 255;
    out[o + 3] = on ? 255 : 0;
  }
  ctx.putImageData(img, 0, 0);

  return { canvas: cv, cellW: D.cellW, cellH: D.cellH, cols: D.cols };
}

/* ---- fallback: rasterise the platform monospace face and threshold it.
   Only reached if font-data.js is missing or unreadable. Kept so the game
   still runs from a partial checkout, but it is not the intended path. */
function buildFromSystemFont(chars) {
  const probe = document.createElement('canvas').getContext('2d');
  const fontSpec = FONT_PX + 'px "Consolas","DejaVu Sans Mono","Courier New",monospace';
  probe.font = fontSpec;
  const advance = probe.measureText('M').width || FONT_PX * 0.6;

  const cellW = Math.max(4, Math.ceil(advance) + 1);
  const cellH = Math.max(6, Math.ceil(FONT_PX * 1.25));
  const cols = 16;
  const rows = Math.ceil(chars.length / cols);

  const cv = document.createElement('canvas');
  cv.width = cellW * cols;
  cv.height = cellH * rows;
  const ctx = cv.getContext('2d', { willReadFrequently: true });

  ctx.font = fontSpec;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fff';

  // Sit the baseline so descenders (g, p, y, q) stay inside the cell.
  const baseline = Math.round(cellH * 0.78);

  chars.forEach((ch, i) => {
    ctx.fillText(ch, (i % cols) * cellW + 1, Math.floor(i / cols) * cellH + baseline);
  });

  /* Threshold to 1-bit. This is what turns a smoothed system font into a
     bitmap font; without it every upscale would look soft and modern. */
  try {
    const img = ctx.getImageData(0, 0, cv.width, cv.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const on = d[i + 3] >= INK_THRESHOLD;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = on ? 255 : 0;
    }
    ctx.putImageData(img, 0, 0);
  } catch (err) {
    // Readback blocked. The glyphs are still there, just antialiased.
    console.warn('[font] canvas readback unavailable (' + err.message +
                 '); text will be soft rather than 1-bit.');
  }

  return { canvas: cv, cellW, cellH, cols };
}

function init() {
  if (state.ready) return state;

  const chars = charList();
  chars.forEach((ch, i) => { state.index[ch] = i; });

  const built = buildFromData(chars) || buildFromSystemFont(chars);

  state.cellW = built.cellW;
  state.cellH = built.cellH;
  state.cols = built.cols;
  state.mask = built.canvas;
  state.ready = true;
  return state;
}

/* Colouring a 1-bit mask: stamp the mask, then flood the whole canvas with
   the colour using 'source-in' so only the ink survives. Cached per colour -
   the game uses a handful (bone white, CRT green, paper black, alarm red). */
function tintedAtlas(color) {
  if (state.tinted[color]) return state.tinted[color];
  const src = state.mask;
  const cv = document.createElement('canvas');
  cv.width = src.width; cv.height = src.height;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, cv.width, cv.height);
  state.tinted[color] = cv;
  return cv;
}

/* ----------------------------------------------------------------- metrics */

/* Horizontal advance for one character cell at a given scale/tracking. */
function advanceFor(scale, tracking) {
  return state.cellW * scale + (tracking || 0);
}

function measure(text, scale, tracking) {
  scale = scale || 1;
  if (!text.length) return 0;
  // n cells plus (n-1) gaps: the trailing gap is not part of the ink extent.
  return text.length * state.cellW * scale + Math.max(0, text.length - 1) * (tracking || 0);
}

function lineHeight(scale, leading) {
  return Math.round(state.cellH * (scale || 1) + (leading || 0));
}

/* ----------------------------------------------------------------- drawing */

/**
 * Draw a single line of text into a 2D context.
 * opts: { scale, color, tracking, align: 'left'|'center'|'right' }
 * Coordinates are the top-left of the text box (or its centre/right edge
 * when aligned). Everything is rounded to whole pixels - subpixel placement
 * would reintroduce exactly the softness the threshold pass removed.
 */
function draw(ctx, text, x, y, opts) {
  if (!state.ready) init();
  opts = opts || {};
  text = String(text);
  const scale = opts.scale || 1;
  const tracking = opts.tracking || 0;
  const color = opts.color || '#ffffff';

  const atlas = tintedAtlas(color);
  const w = measure(text, scale, tracking);

  let px = Math.round(x);
  if (opts.align === 'center') px = Math.round(x - w / 2);
  else if (opts.align === 'right') px = Math.round(x - w);
  const py = Math.round(y);

  const prevSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;

  const cw = state.cellW, ch = state.cellH;
  const step = advanceFor(scale, tracking);

  for (let i = 0; i < text.length; i++) {
    const idx = state.index[text[i]];
    if (idx === undefined) continue;          // unmapped glyph -> blank cell
    const dx = Math.round(px + i * step);
    const sx = (idx % state.cols) * cw;
    const sy = Math.floor(idx / state.cols) * ch;
    ctx.drawImage(atlas, sx, sy, cw, ch, dx, py, Math.round(cw * scale), Math.round(ch * scale));
  }

  ctx.imageSmoothingEnabled = prevSmoothing;
  return w;
}

/**
 * Greedy word wrap to a pixel width. Honours explicit \n, and hard-splits any
 * single token longer than the column (long algebraic expressions do this).
 */
function wrap(text, maxWidth, scale, tracking) {
  if (!state.ready) init();
  scale = scale || 1;
  const step = advanceFor(scale, tracking);
  const perLine = Math.max(1, Math.floor((maxWidth + (tracking || 0)) / step));

  const out = [];
  for (const paragraph of String(text).split('\n')) {
    if (!paragraph.length) { out.push(''); continue; }
    let line = '';
    for (const word of paragraph.split(' ')) {
      if (!word.length) continue;

      if (word.length > perLine) {
        if (line) { out.push(line); line = ''; }
        let rest = word;
        while (rest.length > perLine) {
          out.push(rest.slice(0, perLine));
          rest = rest.slice(perLine);
        }
        line = rest;
        continue;
      }

      const candidate = line ? line + ' ' + word : word;
      if (candidate.length <= perLine) {
        line = candidate;
      } else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * Draw wrapped text and report the height consumed.
 * opts adds: { leading, maxLines }
 */
function drawWrapped(ctx, text, x, y, maxWidth, opts) {
  opts = opts || {};
  const scale = opts.scale || 1;
  const leading = opts.leading || 0;
  const lh = lineHeight(scale, leading);
  let lines = wrap(text, maxWidth, scale, opts.tracking);
  if (opts.maxLines && lines.length > opts.maxLines) {
    lines = lines.slice(0, opts.maxLines);
    const last = lines.length - 1;
    lines[last] = lines[last].slice(0, Math.max(0, lines[last].length - 1)) + '…';
  }
  lines.forEach((ln, i) => draw(ctx, ln, x, y + i * lh, opts));
  return lines.length * lh;
}

/* Height a block of text will occupy, without drawing it. */
function measureWrapped(text, maxWidth, opts) {
  opts = opts || {};
  const lines = wrap(text, maxWidth, opts.scale || 1, opts.tracking);
  return lines.length * lineHeight(opts.scale || 1, opts.leading || 0);
}

/* --------------------------------------------------------------- exports */

SATG.font = {
  init, draw, drawWrapped, wrap, measure, measureWrapped, lineHeight, advanceFor,
  get cellW() { return state.cellW; },
  get cellH() { return state.cellH; },
  get ready() { return state.ready; }
};

})(window);
