/* =========================================================================
   ui/fx.js - the small amount of motion the interface has.

   Every screen in this game draws to a 2D canvas and only re-uploads that
   canvas when something on it changed. That is what keeps the texture traffic
   down, and it is also why animation needs a helper rather than a stray
   variable: an animating screen has to mark itself dirty on every frame the
   animation is running, and stop the moment it ends. Doing that by hand in six
   places is how you get a screen that either judders or re-uploads forever.

   So: press() records that something was hit, update() reports whether
   anything is still moving, and value() gives the 0..1 the drawing code reads.
   A screen's whole obligation is:

       update(dt) { if (this.fx.update(dt)) this.dirty = true; }

   The look is a punch rather than a glow - a hard flash that decays fast, with
   the label knocked sideways and settling back. It suits a game built out of
   bitmap type and hard edges, and it stays legible at one-pixel scale where a
   soft fade would just look like a rendering fault.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;

/* Short. A menu press wants to feel like a switch closing, and anything past
   about a quarter of a second starts to feel like lag instead of feedback. */
const PRESS_SECONDS = 0.26;

/* Ease-out cubic on the way down: most of the movement happens immediately,
   which is what makes it read as a hit rather than a fade. */
function decay(t) {
  const x = 1 - Math.min(1, Math.max(0, t));
  return x * x * x;
}

class PressFX {
  constructor(seconds) {
    this.duration = seconds || PRESS_SECONDS;
    this.live = Object.create(null);
    this.count = 0;
  }

  /* `id` is whatever identifies the thing that was hit - a menu index, a
     control key, a choice letter. Pressing the same id again restarts it. */
  press(id) {
    if (id === null || id === undefined) return false;
    if (this.live[id] === undefined) this.count++;
    this.live[id] = 0;
    return true;
  }

  /* Returns true while anything is still animating, which is exactly the
     condition for "redraw this screen". */
  update(dt) {
    if (!this.count) return false;
    for (const k in this.live) {
      const t = this.live[k] + dt;
      if (t >= this.duration) { delete this.live[k]; this.count--; }
      else this.live[k] = t;
    }
    /* True on the frame the last animation ENDS as well as while one runs -
       otherwise the screen keeps the final frame of the press forever, because
       nothing ever asked it to redraw without it. */
    return true;
  }

  /* 1 at the instant of the press, 0 when it is over. */
  value(id) {
    const t = this.live[id];
    return t === undefined ? 0 : decay(t / this.duration);
  }

  get busy() { return this.count > 0; }

  clear() { this.live = Object.create(null); this.count = 0; }
}

/* Blend a hex colour toward white by `k`. Used to make a pressed label flare
   rather than swapping it for a second hard-coded colour. */
function brighten(hex, k) {
  k = Math.min(1, Math.max(0, k));
  if (k <= 0) return hex;
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const mix = (c) => Math.round(c + (255 - c) * k);
  const r = mix(parseInt(m[1], 16)), g = mix(parseInt(m[2], 16)), b = mix(parseInt(m[3], 16));
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

/* The standard press decoration, so every screen's buttons behave the same
   way without each one inventing its own.

     ctx     target
     v       0..1 from PressFX.value()
     rect    {x,y,w,h} of the row being pressed
     s       ui scale

   Draws a flash behind the row and a pair of brackets that fly outward. The
   caller offsets its own text by pressOffset(v, s). */
function drawPress(ctx, v, rect, s, tint) {
  if (v <= 0) return;
  const pad = Math.round(4 * s);
  ctx.save();
  ctx.globalAlpha = 0.30 * v;
  ctx.fillStyle = tint || '#ffffff';
  ctx.fillRect(rect.x - pad, rect.y - pad, rect.w + pad * 2, rect.h + pad * 2);

  // Brackets, thrown outward as the flash dies.
  const fly = Math.round((1 - v) * 10 * s);
  const arm = Math.max(2 * s, Math.round(rect.h * 0.35));
  const th = Math.max(1, Math.round(s));
  ctx.globalAlpha = 0.85 * v;
  const L = rect.x - pad - fly, R = rect.x + rect.w + pad + fly;
  const T = rect.y - pad, B = rect.y + rect.h + pad;
  ctx.fillRect(L, T, th, arm);           ctx.fillRect(L, B - arm, th, arm);
  ctx.fillRect(R - th, T, th, arm);      ctx.fillRect(R - th, B - arm, th, arm);
  ctx.restore();
}

/* How far a pressed label is knocked sideways. Whole pixels, because the font
   is a bitmap and a fractional offset resamples the glyph grid. */
function pressOffset(v, s) {
  return Math.round(v * 5 * s);
}

SATG.fx = { PressFX, drawPress, pressOffset, brighten, PRESS_SECONDS, decay };

})(window);
