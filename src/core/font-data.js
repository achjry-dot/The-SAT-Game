/* =========================================================================
   font-data.js - the bitmap font, baked.

   WHY THIS FILE EXISTS

   The font used to be built at boot by drawing the platform's monospace face
   into a canvas, reading the pixels back, and thresholding them to 1 bit.
   That worked, but it made the game's typography depend on three things that
   are different on every machine:

     1. WHICH FONT is actually installed. "Consolas" is Windows-only; a Mac
        or Linux player silently got a different face, different metrics, and
        a different layout for every wrapped passage.
     2. HOW THE ENGINE ANTIALIASES text. Gecko and Blink produce different
        alpha ramps for the same glyph at the same size, so the 1-bit
        threshold kept different pixels on each - strokes that survived in
        one browser vanished in the other.
     3. WHETHER CANVAS READBACK IS HONEST. Hardened browsers (Firefox's
        resistFingerprinting, and the privacy modes built on it) perturb or
        block getImageData specifically to defeat canvas fingerprinting.
        Reading back a canvas is exactly what the old build step did.

   Baking the atlas removes all three. These bytes are the finished 1-bit
   glyphs; every browser decodes the same bitmap and draws it with
   putImageData, which is a WRITE and therefore untouched by any privacy
   setting.

   THIS FILE IS GENERATED. Do not hand-edit the payload, and in particular do
   not re-wrap it by hand. The first version of this file was wrapped by hand
   and picked up 20 stray characters; that shifted every glyph from the second
   atlas row onwards, so the game rendered fluent, correctly-shaped, entirely
   wrong letters - "THE SAT GAME" came out as "TEB SNT DNJB". The total ink
   count was unchanged, which is why it survived review. Hence `bytes` and
   `checksum` below, which font.js verifies before trusting any of it.

   FORMAT
     One bit per pixel, 1 = ink, packed MSB-first, row-major across a
     cellW*cols by cellH*rows atlas. Glyph i sits at column (i % cols),
     row floor(i / cols), in the character order font.js builds.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG || (global.SATG = {});

SATG.FONT_DATA = {
  cellW: 8,
  cellH: 15,
  cols: 16,
  width: 128,
  height: 120,
  glyphs: 124,          // must equal the character list length in font.js
  bytes: 1920,           // decoded length; a mis-edited payload fails here
  checksum: 0x630ef6e1,    // FNV-1a over the decoded bytes
  ink: 2672,             // set bits, for diagnostics
  bits:
    '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'
};

})(window);
