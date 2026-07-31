/* =========================================================================
   ui/screens.js - title card, lose screen, HUD.

   All three draw to their own canvases and are composited as native-res
   overlays, so they share the game's final grade but keep their text sharp.
   Every string goes through the same bitmap font as the exam paper.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;
const F = SATG.font;
const { clamp, lerp, smoothstep } = SATG.util;

const BONE      = '#d9d2c4';
const BONE_DIM  = '#8e8779';
const BONE_FAINT= '#4f4a42';
const BLOOD     = '#a8382c';
const GREEN     = '#7dff9b';

/* Carries the build stamp so the title card itself tells you which copy of
   the code is running. A stale cache and a broken fix look identical without
   it. */
const VERSION = 'v1.0  ' + (SATG.BUILD || '');

/* Corner stamp, in the spirit of Minecraft's version line: small, sat in the
   bottom-left, part of the furniture rather than an announcement. It is a
   disclosure as much as a label, so it is drawn in a legible tone rather than
   the near-invisible one used for the build string on the other side. */
const CORNER_STAMP = '-made with ai- demo';

/* ------------------------------------------------------------------ base */

class ScreenCanvas {
  constructor(gl, w, h, opts) {
    opts = opts || {};
    this.gl = gl;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w || 1280;
    this.canvas.height = h || 720;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new SATG.gl.Texture(gl, {
      source: this.canvas, filter: gl.LINEAR, wrap: gl.CLAMP_TO_EDGE
    });
    this.dirty = true;
    /* Floors for resize(). Full-screen layers keep the old 320x180 guard;
       strip layers set their own, since a strip is deliberately short and
       the default would silently inflate it (and its upload) 2x. */
    this.minW = opts.minW || 320;
    this.minH = opts.minH || 180;
    /* Whole-number UI scale. The composite buffer is sized in device pixels,
       so anything measured in absolute pixels - type, bars, margins - has to
       be multiplied by this or it shrinks as the display's scale factor
       rises. See the note above RETICLE_PX. */
    this.uiScale = 1;
  }

  resize(w, h, scale) {
    w = Math.max(this.minW, Math.round(w));
    h = Math.max(this.minH, Math.round(h));
    scale = Math.max(1, Math.round(scale || this.uiScale));
    if (this.canvas.width === w && this.canvas.height === h &&
        scale === this.uiScale) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    this.uiScale = scale;
    this.dirty = true;
    return true;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.imageSmoothingEnabled = false;
  }

  upload() {
    this.texture.update(this.canvas);
    this.dirty = false;
  }

  get W() { return this.canvas.width; }
  get H() { return this.canvas.height; }
}

/* =========================================================================
   TITLE

   Laid out like the reference: a hard black panel down the left carrying the
   title, byline and menu, with the room itself visible beyond it. The 3D
   scene renders behind this; only the panel is opaque.
   ========================================================================= */

const TITLE_ITEMS = [
  { key: 'start',    label: 'START' },
  { key: 'continue', label: 'CONTINUE' },
  { key: 'exit',     label: 'EXIT' }
];

class TitleScreen extends ScreenCanvas {
  constructor(gl) {
    super(gl, 1280, 720);
    this.index = 0;
    this.canContinue = false;
    this.time = 0;
  }

  setCanContinue(v) {
    if (this.canContinue === !!v) return;
    this.canContinue = !!v;
    this.dirty = true;
  }

  /* Skip over CONTINUE when there is nothing to continue. */
  move(dir) {
    const n = TITLE_ITEMS.length;
    let i = this.index;
    for (let guard = 0; guard < n; guard++) {
      i = (i + dir + n) % n;
      if (TITLE_ITEMS[i].key !== 'continue' || this.canContinue) break;
    }
    if (i !== this.index) { this.index = i; this.dirty = true; return true; }
    return false;
  }

  setIndex(i) {
    if (i < 0 || i >= TITLE_ITEMS.length) return false;
    if (TITLE_ITEMS[i].key === 'continue' && !this.canContinue) return false;
    if (i === this.index) return false;
    this.index = i;
    this.dirty = true;
    return true;
  }

  get selected() { return TITLE_ITEMS[this.index].key; }

  update(dt) {
    this.time += dt;
    // The cursor blinks, so the card is never completely static.
    const blink = (Math.floor(this.time * 2.2) % 2) === 0;
    if (blink !== this._blink) { this._blink = blink; this.dirty = true; }
  }

  render() {
    if (!this.dirty) return;
    const ctx = this.ctx;
    this.clear();

    const W = this.W, H = this.H;
    const panelW = Math.round(W * 0.52);

    // Opaque panel, feathering out so the room bleeds in at its edge.
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, panelW, H);
    const grad = ctx.createLinearGradient(panelW, 0, panelW + W * 0.14, 0);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(panelW, 0, W * 0.14, H);

    const left = Math.round(W * 0.085);
    let y = Math.round(H * 0.26);

    /* Title, scaled to the panel so it never overruns on a narrow window.
       The ceiling rises with the UI scale, or the card would occupy half as
       much of a 200%-scaled screen as it does of a 100% one. */
    const s = this.uiScale || 1;
    let titleScale = 6 * s;
    while (titleScale > 2 && F.measure('THE SAT GAME', titleScale, 3 * s) > panelW - left * 2) {
      titleScale -= 0.5 * s;
    }
    F.draw(ctx, 'THE SAT GAME', left, y, { color: BONE, scale: titleScale, tracking: 3 * s });
    y += F.lineHeight(titleScale) + 4;

    const byScale = Math.max(s, Math.round(titleScale * 0.34));
    F.draw(ctx, 'made by Joshua Augustine', left + 4, y,
           { color: BONE_DIM, scale: byScale, tracking: 1 });
    y += F.lineHeight(byScale) + 2;
    F.draw(ctx, 'Inspired by: Mike Klubnika', left + 4, y,
           { color: BONE_DIM, scale: byScale, tracking: 1 });

    y += F.lineHeight(byScale) + Math.round(H * 0.10);

    // Menu.
    const itemScale = Math.max(2 * s, Math.round(titleScale * 0.5));
    const step = F.lineHeight(itemScale) + 10 * s;
    this.hits = [];

    TITLE_ITEMS.forEach((item, i) => {
      const active = i === this.index;
      const disabled = item.key === 'continue' && !this.canContinue;
      const color = disabled ? BONE_FAINT : active ? BONE : BONE_DIM;

      if (active && this._blink !== false) {
        F.draw(ctx, '>', left, y, { color: BONE, scale: itemScale });
      }
      F.draw(ctx, item.label, left + F.advanceFor(itemScale, 0) * 1.6, y,
             { color, scale: itemScale, tracking: 2 });

      this.hits.push({ x: left, y: y - 6, w: panelW - left * 2, h: step, index: i });
      y += step;
    });

    F.draw(ctx, VERSION, W - 18 * s, H - 18 * s - F.cellH * s,
           { color: '#3a3630', scale: s, align: 'right' });

    // Bottom-left corner stamp. Same baseline as the build string opposite it.
    F.draw(ctx, CORNER_STAMP, 18 * s, H - 18 * s - F.cellH * s,
           { color: BONE_FAINT, scale: s });

    this.upload();
  }

  hitTest(u, v) {
    if (!this.hits) return null;
    const x = u * this.W, y = v * this.H;
    for (const h of this.hits) {
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h.index;
    }
    return null;
  }
}

/* =========================================================================
   LOSE

   Pitch black, everything centred, exactly two options. "YOU LOOSE" is the
   spelling the brief specified and is kept verbatim.
   ========================================================================= */

const LOSE_ITEMS = [
  { key: 'retry', label: 'RETRY' },
  { key: 'quit',  label: 'QUIT' }
];

/* Named once so the measuring pass and the drawing pass can never disagree. */
const LOSE_TITLE = 'YOU LOSE';

class LoseScreen extends ScreenCanvas {
  constructor(gl) {
    super(gl, 1280, 720);
    this.index = 0;
    this.time = 0;
    this.summary = null;
  }

  reset(summary) {
    this.index = 0;
    this.time = 0;
    this.summary = summary || null;
    this.dirty = true;
  }

  move(dir) {
    this.index = (this.index + dir + LOSE_ITEMS.length) % LOSE_ITEMS.length;
    this.dirty = true;
    return true;
  }

  setIndex(i) {
    if (i < 0 || i >= LOSE_ITEMS.length || i === this.index) return false;
    this.index = i;
    this.dirty = true;
    return true;
  }

  get selected() { return LOSE_ITEMS[this.index].key; }

  update(dt) {
    this.time += dt;
    const blink = (Math.floor(this.time * 2.2) % 2) === 0;
    if (blink !== this._blink) { this._blink = blink; this.dirty = true; }
  }

  render() {
    if (!this.dirty) return;
    const ctx = this.ctx;
    this.clear();

    const W = this.W, H = this.H;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    const cx = Math.round(W / 2);

    const us = this.uiScale || 1;
    let titleScale = 8 * us;
    while (titleScale > 3 && F.measure(LOSE_TITLE, titleScale, 6 * us) > W * 0.82) {
      titleScale -= 0.5 * us;
    }

    let y = Math.round(H * 0.24);
    F.draw(ctx, LOSE_TITLE, cx, y,
           { color: BONE, scale: titleScale, tracking: 6 * us, align: 'center' });
    y += F.lineHeight(titleScale) + Math.round(H * 0.06);

    // A quiet post-mortem: what the answer was, and how far they got.
    if (this.summary) {
      const s = this.summary;
      const small = Math.max(1, Math.round(titleScale * 0.2));
      const line = (txt, color) => {
        F.draw(ctx, txt, cx, y,
               { color: color || BONE_FAINT, scale: small, tracking: us, align: 'center' });
        y += F.lineHeight(small) + 4 * us;
      };

      line(s.reason === 'timeout' ? 'TIME EXPIRED' : 'INCORRECT RESPONSE', BLOOD);
      y += 6;
      line('QUESTIONS CLEARED: ' + s.cleared);
      if (s.answerText) line('CORRECT ANSWER WAS: ' + s.answerText, BONE_DIM);
      if (s.best !== undefined) line('BEST THIS SESSION: ' + s.best);
      y += Math.round(H * 0.05);
    }

    const itemScale = Math.max(2 * us, Math.round(titleScale * 0.38));
    const step = F.lineHeight(itemScale) + 12 * us;
    this.hits = [];

    LOSE_ITEMS.forEach((item, i) => {
      const active = i === this.index;
      const w = F.measure(item.label, itemScale, 3 * us);
      if (active && this._blink !== false) {
        F.draw(ctx, '>', cx - w / 2 - F.advanceFor(itemScale, 0) * 1.4, y,
               { color: BONE, scale: itemScale });
      }
      F.draw(ctx, item.label, cx, y,
             { color: active ? BONE : BONE_DIM, scale: itemScale,
               tracking: 3 * us, align: 'center' });
      this.hits.push({ x: cx - W * 0.3, y: y - 6, w: W * 0.6, h: step, index: i });
      y += step;
    });

    this.upload();
  }

  hitTest(u, v) {
    if (!this.hits) return null;
    const x = u * this.W, y = v * this.H;
    for (const h of this.hits) {
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h.index;
    }
    return null;
  }
}

/* =========================================================================
   HUD - reticle, clock, prompts

   Split into three surfaces on purpose, because the obvious single-canvas
   version is a performance trap that shows up as a *rendering* bug.

   Every one of these canvases is re-uploaded to the GPU whenever it is
   redrawn. When the reticle lived on one full-screen HUD canvas, moving the
   mouse marked that canvas dirty, so the game pushed a whole screen of RGBA
   to the driver on every single frame the pointer moved: 8.3 MB at 1080p,
   ~500 MB/s sustained. That flood is what tore the exam sheet into blocks
   and dropped the calculator out for whole frames - the symptoms looked like
   corruption, but the cause was simply asking the driver to move more
   texture data than it could keep up with, while the sheet and the
   calculator were trying to upload through the same path.

   So each element now lives on a surface that changes at its own rate:

     reticle   never re-uploaded  - two sprites, built once at boot
     clock     ~10 uploads/sec    - a small strip, not the whole screen
     base      a few per question - prompt line and cleared count

   Same image on screen, roughly three orders of magnitude less traffic.
   ========================================================================= */

/* All of the sizes below are in COMPOSITE-BUFFER pixels, and the composite
   buffer is now sized in device pixels rather than CSS pixels. A fixed number
   of those is a shrinking number of physical millimetres as the display's
   scale factor rises: at 200% scaling an unscaled 32px reticle covers half
   the screen area it did at 100%. So every one of these is multiplied by a
   whole-number UI scale taken from the device pixel ratio.

   Whole-number on purpose. The font is a bitmap, and drawing it at 1.5x would
   resample glyph pixels unevenly - the exact defect the device-pixel change
   was made to remove. Rounding to 1x or 2x keeps every glyph crisp. */
const RETICLE_PX = 32;

/* Height of the clock strip, enough for the bar plus the scale-3 readout. */
const CLOCK_H = 80;
/* Distance from the top of the screen to the top of the strip. */
const CLOCK_TOP = 14;

/* Prompt band across the bottom. Full width, because a long prompt
   ("TYPE YOUR ANSWER  (SCROLL) TO ZOOM  ...") nearly spans the screen. */
const PROMPT_H = 60;
const PROMPT_BOTTOM = 34;    // gap from the bottom edge to the band

/* Cleared counter, top right. */
const CLEARED_W = 256;
const CLEARED_H = 32;

/* The pointer, pre-rendered.
   'crosshair' is the small circular reticle used while the hands are empty.
   'bright' is the same shape rendered heavier and pure white: it has to stay
   readable against the lit exam paper and the calculator's own screen, where
   the dim reticle simply disappeared and left the player unable to see what
   they were about to click. */
class Reticle {
  constructor(gl, scale) {
    this.gl = gl;
    this.scale = 0;
    this.map = {};
    this.setScale(scale || 1);
  }

  /* Rebuilt rather than stretched, so the ring's stroke stays a whole number
     of pixels wide at every scale instead of being resampled. */
  setScale(scale) {
    scale = Math.max(1, Math.round(scale));
    if (scale === this.scale) return;
    this.scale = scale;
    for (const k of Object.keys(this.map)) this.map[k].dispose();
    this.map = {
      crosshair: Reticle.build(this.gl, false, scale),
      bright: Reticle.build(this.gl, true, scale)
    };
  }

  static build(gl, bright, scale) {
    const size = RETICLE_PX * scale;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    // Half-pixel offset so the stroked circle lands on pixel centres.
    const c = size / 2 + 0.5;

    if (bright) {
      // Dark keyline first, so the ring reads on a pale sheet too.
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 5 * scale;
      ctx.beginPath();
      ctx.arc(c, c, 7 * scale, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.strokeStyle = bright ? '#ffffff' : 'rgba(220,212,196,0.72)';
    ctx.lineWidth = (bright ? 3 : 2) * scale;
    ctx.beginPath();
    ctx.arc(c, c, (bright ? 7 : 5) * scale, 0, Math.PI * 2);
    ctx.stroke();

    const d = (bright ? 2 : 1) * scale;
    ctx.fillStyle = bright ? '#ffffff' : 'rgba(220,212,196,0.85)';
    ctx.fillRect(Math.round(c) - (d >> 1), Math.round(c) - (d >> 1), d, d);

    return new SATG.gl.Texture(gl, {
      source: cv, filter: gl.LINEAR, wrap: gl.CLAMP_TO_EDGE
    });
  }

  get(kind) { return this.map[kind] || null; }
}

class Hud {
  constructor(gl) {
    this.gl = gl;
    /* Every layer is sized to its own content, never to the screen. A
       full-screen layer costs 8.3 MB per upload at 1080p; these cost 30-460 KB,
       and each one only redraws when the thing ON it changes. */
    this.clock = new ScreenCanvas(gl, 576, CLOCK_H, { minW: 200, minH: CLOCK_H });
    this.promptBand = new ScreenCanvas(gl, 1280, PROMPT_H, { minW: 320, minH: PROMPT_H });
    this.clearedBadge = new ScreenCanvas(gl, CLEARED_W, CLEARED_H,
                                         { minW: CLEARED_W, minH: CLEARED_H });
    this.reticle = new Reticle(gl, 1);

    this.W = 1280;
    this.H = 720;
    this.s = 1;                      // whole-number UI scale, see RETICLE_PX

    this.timeLeft = 0;
    this.timeLimit = 1;
    this.prompt = '';
    this.cleared = 0;
    this.cursor = 'crosshair';       // 'crosshair' | 'bright' | 'none'
    this.pointer = { u: 0.5, v: 0.5 };
    this.usePointer = false;
  }

  /* Strip width: the bar is 34% of the screen, plus room for the readout to
     overhang it. Never wider than the screen itself. */
  clockWidth(w) { return Math.min(w, Math.round(w * 0.34) + 140 * this.s); }

  resize(w, h, scale) {
    w = Math.max(320, Math.round(w));
    h = Math.max(180, Math.round(h));
    scale = Math.max(1, Math.round(scale || 1));
    if (w === this.W && h === this.H && scale === this.s) return false;
    this.W = w;
    this.H = h;
    this.s = scale;
    this.reticle.setScale(scale);
    this.clock.resize(this.clockWidth(w), CLOCK_H * scale);
    this.promptBand.resize(w, PROMPT_H * scale);
    this.clearedBadge.resize(CLEARED_W * scale, CLEARED_H * scale);
    // resize() only reports dirty when the size actually moved; the bar's
    // width is derived from the screen, so force them regardless.
    this.clock.dirty = true;
    this.promptBand.dirty = true;
    this.clearedBadge.dirty = true;
    return true;
  }

  set(state) {
    /* Each surface is invalidated only by the things drawn ON it. The
       pointer deliberately invalidates nothing: it is a positioned sprite
       now, so moving the mouse costs one quad and zero uploads. */
    const t = Math.ceil(state.timeLeft * 10) / 10;
    const limit = state.timeLimit || 1;
    if (t !== this._lastT || limit !== this.timeLimit) this.clock.dirty = true;

    const cleared = state.cleared || 0;
    const prompt = state.prompt || '';
    if (prompt !== this.prompt) this.promptBand.dirty = true;
    if (cleared !== this.cleared) this.clearedBadge.dirty = true;

    this._lastT = t;
    this.timeLeft = state.timeLeft;
    this.timeLimit = limit;
    this.prompt = prompt;
    this.cleared = cleared;
    this.cursor = state.cursor || 'none';
    this.usePointer = !!state.usePointer;
    if (state.pointer) this.pointer = state.pointer;
  }

  /* ---- clock strip: progress bar and the mechanical readout above it. */
  renderClock() {
    const layer = this.clock;
    const ctx = layer.ctx;
    layer.clear();

    const CW = layer.W, s = this.s;
    const frac = clamp(this.timeLeft / this.timeLimit, 0, 1);
    const panic = this.timeLeft <= SATG.questionBank.PANIC_SECONDS;

    const barW = Math.round(this.W * 0.34);
    const barX = Math.round((CW - barW) / 2);
    const barY = 12 * s;

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(barX - 6 * s, barY - 6 * s, barW + 12 * s, 12 * s);
    ctx.fillStyle = panic ? BLOOD : '#6d6558';
    ctx.fillRect(barX, barY, Math.round(barW * frac), 4 * s);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(barX, barY, barW, s);

    F.draw(ctx, Math.max(0, this.timeLeft).toFixed(1), CW / 2, barY + 14 * s,
           { color: panic ? BLOOD : BONE_DIM, scale: 3 * s, align: 'center', tracking: 2 * s });

    layer.upload();
  }

  /* ---- contextual prompt, bottom centre. */
  renderPrompt() {
    const layer = this.promptBand;
    const ctx = layer.ctx;
    layer.clear();

    if (this.prompt) {
      const s = this.s;
      const ps = 2 * s;
      const W = layer.W;
      const pw = F.measure(this.prompt, ps, s);
      const py = Math.round((PROMPT_H * s - F.cellH * ps) / 2);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(W / 2 - pw / 2 - 14 * s, py - 8 * s, pw + 28 * s, F.cellH * ps + 16 * s);
      F.draw(ctx, this.prompt, W / 2, py, { color: BONE, scale: ps, align: 'center', tracking: s });
    }

    layer.upload();
  }

  /* ---- cleared counter, top right. Changes once per question. */
  renderCleared() {
    const layer = this.clearedBadge;
    layer.clear();
    F.draw(layer.ctx, 'CLEARED ' + String(this.cleared).padStart(3, '0'),
           CLEARED_W * this.s - 4 * this.s, 6 * this.s,
           { color: BONE_FAINT, scale: this.s, align: 'right', tracking: this.s });
    layer.upload();
  }

  render() {
    if (this.clock.dirty) this.renderClock();
    if (this.promptBand.dirty) this.renderPrompt();
    if (this.clearedBadge.dirty) this.renderCleared();
  }

  /* Composite the layers. The reticle is placed by the quad rather than drawn
     into a canvas, which is the whole point of the split. */
  draw(pipeline) {
    this.render();

    const s = this.s;

    pipeline.drawOverlay(this.clock.texture, {
      x: 0.5 - (this.clock.W / this.W) / 2,
      y: CLOCK_TOP * s / this.H,
      w: this.clock.W / this.W,
      h: this.clock.H / this.H
    });

    pipeline.drawOverlay(this.clearedBadge.texture, {
      x: 1 - (CLEARED_W + 16) * s / this.W,
      y: 16 * s / this.H,
      w: CLEARED_W * s / this.W,
      h: CLEARED_H * s / this.H
    });

    pipeline.drawOverlay(this.promptBand.texture, {
      x: 0,
      y: (this.H - (PROMPT_BOTTOM + PROMPT_H) * s) / this.H,
      w: 1,
      h: PROMPT_H * s / this.H
    });

    if (this.cursor !== 'none') {
      const tex = this.reticle.get(this.cursor);
      if (tex) {
        const w = RETICLE_PX * s / this.W, h = RETICLE_PX * s / this.H;
        const cx = this.usePointer ? this.pointer.u : 0.5;
        const cy = this.usePointer ? this.pointer.v : 0.5;
        pipeline.drawOverlay(tex, { x: cx - w / 2, y: cy - h / 2, w, h });
      }
    }
  }
}

/* =========================================================================
   Fade-to-black helper used between scenes.
   ========================================================================= */

class Fader {
  constructor() {
    this.value = 0;         // 0 = black, 1 = fully visible
    this.target = 0;
    this.speed = 1;
    this.onArrive = null;
  }

  to(target, seconds, cb) {
    this.target = clamp(target, 0, 1);
    this.speed = seconds > 0 ? 1 / seconds : 1e6;
    this.onArrive = cb || null;
    return this;
  }

  snap(v) { this.value = this.target = clamp(v, 0, 1); this.onArrive = null; }

  update(dt) {
    /* Already there? Still fire the callback.
       Returning early here instead would soft-lock the game: asking to fade
       to a value the fader already holds - START pressed while the opening
       fade is still at zero - would leave onArrive pending forever, and every
       transition guarded by `transitioning` would refuse to run again. */
    if (this.value === this.target) {
      if (this.onArrive) {
        const cb = this.onArrive;
        this.onArrive = null;
        cb();
      }
      return;
    }

    const d = this.speed * dt;
    if (Math.abs(this.target - this.value) <= d) {
      this.value = this.target;
      const cb = this.onArrive;
      this.onArrive = null;
      if (cb) cb();
    } else {
      this.value += Math.sign(this.target - this.value) * d;
    }
  }

  get busy() { return this.value !== this.target; }
}

SATG.screens = {
  TitleScreen, LoseScreen, Hud, Reticle, Fader, ScreenCanvas,
  TITLE_ITEMS, LOSE_ITEMS
};

})(window);
