/* =========================================================================
   ui/calculator.js - the issued calculator.

   Three parts:

     1. a real expression parser and evaluator (recursive descent, with
        implicit multiplication, so "2x(x+1)" behaves the way a student
        expects rather than throwing)
     2. the handheld view - scientific mode, a keypad, a running entry line
     3. the expanded view - a Desmos-shaped grapher rendered as a green
        vector CRT

   The expanded view follows the real Desmos where it matters:
     - scroll zooms toward the CURSOR, not the viewport centre
     - drag pans 1:1, uniformly, wherever the drag starts
     - gridline steps snap to the 1-2-5 x 10^n progression
     - hovering a curve snaps a marker ONTO the curve and labels it
     - points of interest (zeros, y-intercepts, extrema, and intersections
       between curves) are found by sampling at pixel resolution, bracketing
       sign changes, and refining by bisection
     - clicking a point of interest pins its label
     - clicking the expression bar raises an on-screen keypad carrying the
       symbols a physical keyboard cannot type
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;
const F = SATG.font;
const { clamp, lerp } = SATG.util;

/* =========================================================================
   1. Expression engine
   ========================================================================= */

const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  sqrt: Math.sqrt, abs: Math.abs,
  ln: Math.log, log: (v) => Math.log10(v), log10: (v) => Math.log10(v),
  exp: Math.exp, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  sign: Math.sign
};

const CONSTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

/* Longest-first, so "log10" is preferred over "log" and "tau" over "t". */
const FUNC_NAMES = Object.keys(FUNCS).sort((a, b) => b.length - a.length);
const CONST_NAMES = Object.keys(CONSTS).sort((a, b) => b.length - a.length);

function tokenize(src) {
  const out = [];
  let i = 0;
  const s = String(src).replace(/\s+/g, '')
                       .replace(/[−–—]/g, '-')
                       .replace(/×/g, '*')
                       .replace(/÷/g, '/')
                       .replace(/π/g, 'pi')
                       .replace(/√/g, 'sqrt');

  while (i < s.length) {
    const c = s[i];

    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const numText = s.slice(i, j);
      if ((numText.match(/\./g) || []).length > 1) throw new Error('bad number');
      out.push({ t: 'num', v: parseFloat(numText) });
      i = j;
      continue;
    }

    if (/[a-zA-Z]/.test(c)) {
      /* Letters only. Sweeping trailing digits into the identifier would let
         "5x3" become three variable tokens - and since every variable
         evaluates to the same input, it would quietly compute 5·x·x instead
         of reporting that the input is malformed. */
      let j = i;
      while (j < s.length && /[a-zA-Z]/.test(s[j])) j++;

      /* A few function names legitimately contain digits ("log10"), so the
         run is extended over trailing digits - but only when doing so spells
         a name we actually know. */
      let k = j;
      while (k < s.length && /[0-9]/.test(s[k])) k++;
      if (k > j) {
        const run = s.slice(i, k);
        for (let start = 0; start < run.length; start++) {
          if (FUNCS[run.slice(start)]) { j = k; break; }
        }
      }

      const word = s.slice(i, j);
      const callish = s[j] === '(';

      let pos = 0;
      let emittedFunc = false;
      while (pos < word.length) {
        const rest = word.slice(pos);

        let fn = null;
        for (const name of FUNC_NAMES) { if (rest.indexOf(name) === 0) { fn = name; break; } }
        if (fn && callish && pos + fn.length === word.length) {
          out.push({ t: 'func', v: fn });
          pos += fn.length;
          emittedFunc = true;
          continue;
        }

        let cn = null;
        for (const name of CONST_NAMES) { if (rest.indexOf(name) === 0) { cn = name; break; } }
        if (cn) { out.push({ t: 'num', v: CONSTS[cn] }); pos += cn.length; continue; }

        if (/[0-9]/.test(rest[0])) throw new Error('unexpected digit in name: ' + word);

        out.push({ t: 'var', v: rest[0] });
        pos += 1;
      }

      if (callish && word.length > 1 && !emittedFunc) {
        throw new Error('unknown function: ' + word);
      }

      i = j;
      continue;
    }

    if ('+-*/^(),'.indexOf(c) !== -1) { out.push({ t: 'op', v: c }); i++; continue; }
    throw new Error('unexpected character: ' + c);
  }
  return out;
}

/**
 * Recursive-descent parser producing a closure of one variable.
 *   expr    := term (('+'|'-') term)*
 *   term    := unary (('*'|'/'|implicit) unary)*
 *   unary   := '-' unary | power
 *   power   := atom ('^' unary)?      right-associative
 *   atom    := num | var | func '(' expr ')' | '(' expr ')'
 */
function parse(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (v) => {
    const t = tokens[pos];
    if (!t || t.t !== 'op' || t.v !== v) throw new Error('expected ' + v);
    pos++;
    return t;
  };

  function expr() {
    let node = term();
    while (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = tokens[pos++].v;
      const rhs = term();
      const lhs = node;
      node = op === '+' ? (x) => lhs(x) + rhs(x) : (x) => lhs(x) - rhs(x);
    }
    return node;
  }

  function term() {
    let node = unary();
    for (;;) {
      const t = peek();
      if (!t) break;
      if (t.t === 'op' && (t.v === '*' || t.v === '/')) {
        pos++;
        const rhs = unary();
        const lhs = node;
        node = t.v === '*' ? (x) => lhs(x) * rhs(x) : (x) => lhs(x) / rhs(x);
        continue;
      }
      // Implicit multiplication: 2x, 3(x+1), (x+1)(x-1), 2sin(x)
      if (t.t === 'num' || t.t === 'var' || t.t === 'func' ||
          (t.t === 'op' && t.v === '(')) {
        const rhs = unary();
        const lhs = node;
        node = (x) => lhs(x) * rhs(x);
        continue;
      }
      break;
    }
    return node;
  }

  function unary() {
    const t = peek();
    if (t && t.t === 'op' && t.v === '-') { pos++; const inner = unary(); return (x) => -inner(x); }
    if (t && t.t === 'op' && t.v === '+') { pos++; return unary(); }
    return power();
  }

  function power() {
    const base = atom();
    const t = peek();
    if (t && t.t === 'op' && t.v === '^') {
      pos++;
      const exp = unary();                 // right-associative
      return (x) => Math.pow(base(x), exp(x));
    }
    return base;
  }

  function atom() {
    const t = peek();
    if (!t) throw new Error('unexpected end of expression');
    if (t.t === 'num') { pos++; const v = t.v; return () => v; }
    if (t.t === 'var') { pos++; return (x) => x; }
    if (t.t === 'func') {
      pos++;
      const fn = FUNCS[t.v];
      eat('(');
      const arg = expr();
      eat(')');
      return (x) => fn(arg(x));
    }
    if (t.t === 'op' && t.v === '(') {
      pos++;
      const inner = expr();
      eat(')');
      return inner;
    }
    throw new Error('unexpected token');
  }

  const fn = expr();
  if (pos < tokens.length) throw new Error('trailing input');
  return fn;
}

/**
 * Compile a source string to f(x), or null if it does not parse.
 * The returned function carries `usesVariable`, so the scientific mode can
 * tell "an expression" apart from "a number".
 */
function compile(src) {
  if (!src || !String(src).trim()) return null;
  try {
    const tokens = tokenize(src);
    const fn = parse(tokens);
    fn.usesVariable = tokens.some((t) => t.t === 'var');
    return fn;
  } catch (e) {
    return null;
  }
}

/** Evaluate a constant expression; returns NaN on failure. */
function evaluate(src) {
  const fn = compile(src);
  if (!fn) return NaN;
  /* Scientific mode has no value to give x. Evaluating at zero and showing
     the result would answer a different question than the one typed. */
  if (fn.usesVariable) return NaN;
  try {
    const v = fn(0);
    return typeof v === 'number' ? v : NaN;
  } catch (e) {
    return NaN;
  }
}

/* =========================================================================
   2. Palette - a green vector CRT
   ========================================================================= */

const HAND_W = 430;
const HAND_H = 640;

const GREEN       = '#8dffab';
const GREEN_MID   = '#3fbf63';
const GREEN_DIM   = '#2a8f47';
const GREEN_DARK  = '#1c5c2f';
const GREEN_DEEP  = '#06170c';
const CASE_LIGHT  = '#3b3a35';
const CASE_DARK   = '#1d1c19';
const POI_COLOR   = '#dff7e6';

/* Curve colours. Desmos cycles five; this keeps the count and the ordering
   but pulls them into the phosphor range so they read as one display. */
const CURVE_COLORS = ['#7dff9b', '#5fe6ff', '#ffe066', '#ff8fb4', '#c79bff'];

/* Keypad for the handheld (scientific) view. */
const KEYPAD = [
  ['7', '8', '9', '/', 'C'],
  ['4', '5', '6', '*', '('],
  ['1', '2', '3', '-', ')'],
  ['0', '.', '^', '+', '<'],
  ['sin', 'cos', 'tan', 'sqrt', '='],
  ['ln', 'log', 'pi', 'x', 'GRAPH']
];

/* -------------------------------------------------------- on-screen keypad
   Desmos's basic tab is three groups: a 4x4 block of math-structure keys, a
   4x4 numeric pad, and a right-hand column of navigation. The inequality
   keys of the real thing are replaced here with functions this engine
   actually supports - shipping a key that can only ever produce an error
   would be worse than not shipping it. */

const PAD_BASIC = {
  groupA: [
    [{ l: 'x', i: 'x' }, { l: 'y', i: 'y' }, { l: 'x²', i: '^2' }, { l: 'xᵇ', i: '^' }],
    [{ l: '(', i: '(' }, { l: ')', i: ')' }, { l: '√', i: 'sqrt(' }, { l: 'π', i: 'pi' }],
    [{ l: '|a|', i: 'abs(' }, { l: ',', i: ',' }, { l: 'e', i: 'e' }, { l: 'ln', i: 'ln(' }],
    [{ l: 'ABC', a: 'abc' }, { l: 'sin', i: 'sin(' }, { l: 'cos', i: 'cos(' }, { l: 'tan', i: 'tan(' }]
  ],
  groupB: [
    [{ l: '7', i: '7' }, { l: '8', i: '8' }, { l: '9', i: '9' }, { l: '÷', i: '/' }],
    [{ l: '4', i: '4' }, { l: '5', i: '5' }, { l: '6', i: '6' }, { l: '×', i: '*' }],
    [{ l: '1', i: '1' }, { l: '2', i: '2' }, { l: '3', i: '3' }, { l: '-', i: '-' }],
    [{ l: '0', i: '0' }, { l: '.', i: '.' }, { l: 'log', i: 'log(' }, { l: '+', i: '+' }]
  ],
  groupC: [
    { l: 'functions', a: 'funcs', span: 2 },
    { l: '<', a: 'left' }, { l: '>', a: 'right' },
    { l: 'DEL', a: 'back', span: 2 },
    { l: 'ENTER', a: 'enter', span: 2, accent: true }
  ]
};

const PAD_ABC = [
  'qwertyuiop'.split(''),
  'asdfghjkl'.split('').concat(['θ']),
  ['123'].concat('zxcvbnm'.split('')).concat(['DEL'])
];

const PAD_FUNCS = [
  { cat: 'Trig', keys: ['sin(', 'cos(', 'tan(', 'asin(', 'acos(', 'atan('] },
  { cat: 'Calculus', keys: ['exp(', 'ln(', 'log(', 'log10(', 'sqrt(', 'abs('] },
  { cat: 'Number theory', keys: ['floor(', 'ceil(', 'round(', 'sign(', 'pi', 'e'] }
];

/* Separator for the expression slots inside fullSignature(). Any character
   that cannot appear in an expression will do; it only has to stop "x"+"y"
   and "xy"+"" from hashing alike. */
const SLOT_SEP = '\u0001';

/* ---------------------------------------------------------------- sprites

   Small bitmaps that follow the pointer around the grapher. They are built
   once at first use and never re-uploaded - which is the entire point, since
   the thing they replaced was a full-panel repaint per frame. */
const DOT_PX = 14;        // trace marker
const CURSOR_PX = 24;     // arrow pointer
const CURSOR_INSET = 1;   // margin inside the sprite for the arrow's keyline
const DASH_PX = 8;        // one period of the crosshair dash
const LABEL_W = 288;      // scratch sheet for the coordinate readout
const LABEL_H = 30;

function spriteTexture(gl, size, paint, wrap) {
  const cv = document.createElement('canvas');
  cv.width = size[0]; cv.height = size[1];
  paint(cv.getContext('2d'));
  return new SATG.gl.Texture(gl, {
    source: cv, filter: gl.LINEAR, wrap: wrap || gl.CLAMP_TO_EDGE
  });
}

function buildSprites(gl) {
  return {
    /* White so the overlay tint can colour it to whichever curve is traced. */
    dot: spriteTexture(gl, [DOT_PX, DOT_PX], (ctx) => {
      const c = DOT_PX / 2;
      ctx.beginPath();
      ctx.arc(c, c, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#03140a';
      ctx.stroke();
    }),

    /* The classic arrow pointer, white with a black keyline. This is the only
       surface in the game with a real cursor. */
    cursor: spriteTexture(gl, [CURSOR_PX, CURSOR_PX], (ctx) => {
      const pts = [[0, 0], [0, 16.5], [3.7, 12.9], [6.3, 18.6], [8.9, 17.4],
                   [6.3, 11.9], [11.2, 11.6]];
      ctx.translate(CURSOR_INSET, CURSOR_INSET);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1.4;
      ctx.lineJoin = 'miter';
      ctx.stroke();
      ctx.fill();
    }),

    /* One dash period each, tiled along the crosshair rules. REPEAT wrapping
       is what lets an 8-texel strip stretch the whole plot.

       Two of them, one per axis, because the pattern has to run along the
       LONG side of the quad: a 1x8 strip tiled across a wide, 1px-tall rule
       samples a single row and comes out as a flat line, not a dashed one. */
    dashV: spriteTexture(gl, [1, DASH_PX], (ctx) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 1, DASH_PX / 2);
    }, gl.REPEAT),

    dashH: spriteTexture(gl, [DASH_PX, 1], (ctx) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, DASH_PX / 2, 1);
    }, gl.REPEAT)
  };
}

/* 6-digit hex to 0..1 rgb, for tinting the sprites. */
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/* =========================================================================
   3. The device
   ========================================================================= */

class Calculator {
  constructor(gl) {
    this.gl = gl;

    this.handCanvas = document.createElement('canvas');
    this.handCanvas.width = HAND_W;
    this.handCanvas.height = HAND_H;
    this.handCtx = this.handCanvas.getContext('2d');

    this.fullCanvas = document.createElement('canvas');
    this.fullCanvas.width = 1280;
    this.fullCanvas.height = 720;
    this.fullCtx = this.fullCanvas.getContext('2d');

    this.handTexture = new SATG.gl.Texture(gl, {
      source: this.handCanvas, filter: gl.LINEAR, wrap: gl.CLAMP_TO_EDGE
    });
    this.fullTexture = new SATG.gl.Texture(gl, {
      source: this.fullCanvas, filter: gl.LINEAR, wrap: gl.CLAMP_TO_EDGE
    });

    // Scientific state
    this.entry = '';
    this.result = '';
    this.history = [];

    // Graphing state
    this.slots = ['', '', '', '', ''];
    this.activeSlot = 0;
    this.compiled = [null, null, null, null, null];
    this.view = { cx: 0, cy: 0, scale: 40 };

    // Keypad
    this.padOpen = false;
    this.padTab = 'basic';

    // Trace and points of interest
    this.pointer = { u: 0.5, v: 0.5 };
    this.trace = null;
    this.poi = [];
    this.pinned = [];
    this._pinSeq = 0;
    this.poiDirty = true;

    this.expanded = false;
    this.dirtyHand = true;

    this.handHits = [];
    this.fullHits = [];
  }

  /* ------------------------------------------------------------- input */

  setExpanded(v) {
    this.expanded = !!v;
    this.dirtyHand = true;
    if (!this.expanded) this.padOpen = false;
  }

  typeChar(ch) {
    if (this.expanded) {
      if (this.slots[this.activeSlot].length > 90) return false;
      this.slots[this.activeSlot] += ch;
      this.recompile(this.activeSlot);
    } else {
      if (this.entry.length > 40) return false;
      this.entry += ch;
      this.dirtyHand = true;
    }
    return true;
  }

  /* Insert a multi-character fragment from the on-screen keypad. */
  insert(text) {
    for (const ch of String(text)) this.typeChar(ch);
    return true;
  }

  backspace() {
    if (this.expanded) {
      this.slots[this.activeSlot] = this.slots[this.activeSlot].slice(0, -1);
      this.recompile(this.activeSlot);
    } else {
      this.entry = this.entry.slice(0, -1);
      this.dirtyHand = true;
    }
    return true;
  }

  clear() {
    if (this.expanded) {
      this.slots[this.activeSlot] = '';
      this.recompile(this.activeSlot);
    } else {
      this.entry = '';
      this.result = '';
      this.dirtyHand = true;
    }
  }

  submit() {
    if (this.expanded) {
      this.activeSlot = (this.activeSlot + 1) % this.slots.length;
      return;
    }
    if (!this.entry.trim()) return;
    const v = evaluate(this.entry);
    this.result = isNaN(v) ? 'ERROR' : formatResult(v);
    this.history.unshift({ src: this.entry, out: this.result });
    if (this.history.length > 6) this.history.pop();
    this.dirtyHand = true;
  }

  key(label) {
    switch (label) {
      case 'C': this.clear(); return;
      case '<': this.backspace(); return;
      case '=': this.submit(); return;
      case 'GRAPH': this.setExpanded(!this.expanded); return;
      case 'sin': case 'cos': case 'tan': case 'sqrt': case 'ln': case 'log':
        this.insert(label + '('); return;
      case 'pi': this.insert('pi'); return;
      default: this.typeChar(label);
    }
  }

  recompile(i) {
    this.compiled[i] = compile(this.slots[i]);
    this.poiDirty = true;
  }

  setSlot(i) { this.activeSlot = clamp(i, 0, this.slots.length - 1); }

  /* ------------------------------------------------------- view control */

  /** Cursor-anchored zoom: the point under the pointer stays under it. */
  zoom(factor, anchorU, anchorV) {
    const before = this.screenToWorld(anchorU, anchorV);
    this.view.scale = clamp(this.view.scale * factor, 2, 4000);
    const after = this.screenToWorld(anchorU, anchorV);
    this.view.cx += before.x - after.x;
    this.view.cy += before.y - after.y;
    this.poiDirty = true;
  }

  /** Discrete 2x zoom about the viewport centre, matching Desmos's buttons. */
  zoomStep(inward) {
    this.view.scale = clamp(this.view.scale * (inward ? 2 : 0.5), 2, 4000);
    this.poiDirty = true;
  }

  pan(dxPixels, dyPixels) {
    this.view.cx -= dxPixels / this.view.scale;
    this.view.cy += dyPixels / this.view.scale;
    this.poiDirty = true;
  }

  resetView() {
    this.view = { cx: 0, cy: 0, scale: 40 };
    this.pinned.length = 0;
    this.poiDirty = true;
  }

  get panel() {
    const w = this.fullCanvas.width, h = this.fullCanvas.height;
    /* The 240px floor must never exceed the surface it is being carved out
       of, or the plot gets a negative width: the sidebar then covers the
       whole canvas and the graph is laid out past the right edge, off
       screen. Cap the sidebar at 60% so a plot always survives. */
    const listW = Math.round(Math.min(clamp(w * 0.28, 240, 420), w * 0.6));
    const padH = this.padOpen ? Math.round(h * 0.34) : 0;
    return { x: listW, y: 0, w: w - listW, h: h - padH, listW, padH, fullH: h };
  }

  worldToScreen(x, y) {
    const p = this.panel;
    return {
      sx: p.x + p.w / 2 + (x - this.view.cx) * this.view.scale,
      sy: p.h / 2 - (y - this.view.cy) * this.view.scale
    };
  }

  screenToWorld(u, v) {
    const p = this.panel;
    const sx = u * this.fullCanvas.width;
    const sy = v * this.fullCanvas.height;
    return {
      x: this.view.cx + (sx - (p.x + p.w / 2)) / this.view.scale,
      y: this.view.cy + (p.h / 2 - sy) / this.view.scale
    };
  }

  /* ==================================================================== */
  /* Points of interest                                                    */
  /* ==================================================================== */

  /**
   * Sample at roughly one point per horizontal pixel, bracket sign changes,
   * and refine by bisection. The same machinery serves zeros (f against the
   * axis), intersections (f - g), and extrema (the numeric derivative).
   *
   * Resampled on every pan, zoom or edit, because the sample grid is tied to
   * the visible range rather than to the function.
   */
  computePOI() {
    this.poi = [];
    const p = this.panel;
    if (p.w <= 0) return;

    const left = this.view.cx - (p.w / 2) / this.view.scale;
    const right = this.view.cx + (p.w / 2) / this.view.scale;
    const bottom = this.view.cy - (p.h / 2) / this.view.scale;
    const top = this.view.cy + (p.h / 2) / this.view.scale;

    const steps = Math.min(1400, Math.max(200, Math.round(p.w)));
    const dx = (right - left) / steps;
    const safe = (fn, x) => { try { const v = fn(x); return isFinite(v) ? v : NaN; } catch (e) { return NaN; } };

    // A bracketed root of `g`, refined by bisection.
    const bisect = (g, a, b) => {
      let fa = safe(g, a);
      for (let k = 0; k < 60; k++) {
        const m = (a + b) / 2;
        const fm = safe(g, m);
        if (isNaN(fm)) return NaN;
        if (Math.abs(b - a) * this.view.scale < 0.05) return m;
        if ((fa < 0) !== (fm < 0)) { b = m; } else { a = m; fa = fm; }
      }
      return (a + b) / 2;
    };

    /* A sign change is only a root if the curve actually CROSSED zero. Across
       a pole - tan(x) at pi/2, 1/(x-2) at 2 - consecutive samples also change
       sign, but by leaping through infinity rather than passing through zero,
       and bisection will happily "converge" on the asymptote.

       The discriminator is the DIRECTION the magnitude moves as the bracket
       tightens: refining a real crossing walks |g| toward zero, while refining
       a pole walks it toward infinity. Comparing the refined |g| against the
       bracket it came from is therefore exact, and - unlike any threshold on
       slope or jump size - completely independent of how steep the curve is.
       A tolerance in screen units would throw away the genuine zero of
       something like y = 2000x, which is merely steep, not discontinuous. */
    const isRoot = (g, r, a0, b0) => {
      if (!isFinite(r)) return false;
      const v = safe(g, r);
      if (!isFinite(v)) return false;
      const ea = Math.abs(safe(g, a0)), eb = Math.abs(safe(g, b0));
      if (!isFinite(ea) || !isFinite(eb)) return false;
      /* Compared against the LARGER endpoint, not the smaller: a sample can
         land exactly on the root, which makes that endpoint's magnitude zero,
         and nothing is <= 0. Using the max keeps that case working and still
         rejects poles, whose refined magnitude exceeds both endpoints. */
      return Math.abs(v) <= Math.max(ea, eb);
    };

    /* Likewise for turning points: confirm the neighbours actually sit on the
       same side of the candidate, which a discontinuity never satisfies. */
    const turningKind = (fn, xm) => {
      const h = Math.max(dx, 1e-7);
      const a = safe(fn, xm - h), b = safe(fn, xm), c2 = safe(fn, xm + h);
      if (!isFinite(a) || !isFinite(b) || !isFinite(c2)) return null;
      if (b <= a && b <= c2) return 'minimum';
      if (b >= a && b >= c2) return 'maximum';
      return null;
    };

    const inView = (x, y) => x >= left && x <= right && y >= bottom && y <= top;
    const push = (kind, x, y, color) => {
      if (!isFinite(x) || !isFinite(y) || !inView(x, y)) return;
      // Collapse points that would land on the same pixel.
      for (const q of this.poi) {
        if (Math.abs(q.x - x) * this.view.scale < 6 &&
            Math.abs(q.y - y) * this.view.scale < 6 && q.kind === kind) return;
      }
      this.poi.push({ kind, x, y, color: color || POI_COLOR });
    };

    // Central-difference derivative, used to locate extrema by the same
    // bracket-and-refine machinery the zeros use.
    const deriv = (fn) => (x) => {
      const hh = Math.max(1e-7, dx * 0.25);
      const a = safe(fn, x - hh), b = safe(fn, x + hh);
      return (b - a) / (2 * hh);
    };

    const active = this.compiled
      .map((fn, i) => ({ fn, i }))
      .filter((c) => c.fn);

    // ---- per-curve: zeros, y-intercept, extrema
    for (const c of active) {
      const color = CURVE_COLORS[c.i % CURVE_COLORS.length];

      const y0 = safe(c.fn, 0);
      if (!isNaN(y0)) push('y-intercept', 0, y0, color);

      let prevX = left, prevY = safe(c.fn, left);
      let prevD = NaN;
      for (let s = 1; s <= steps; s++) {
        const x = left + s * dx;
        const y = safe(c.fn, x);

        if (!isNaN(y) && !isNaN(prevY) && (prevY < 0) !== (y < 0)) {
          const r = bisect(c.fn, prevX, x);
          if (isRoot(c.fn, r, prevX, x)) push('zero', r, 0, color);
        }

        /* Extrema: a sign change in the slope brackets a turning point, then
           the derivative's own root is refined - reporting the raw sample
           midpoint would label the vertex several hundredths off. */
        const d = (!isNaN(y) && !isNaN(prevY)) ? (y - prevY) / dx : NaN;
        if (!isNaN(d) && !isNaN(prevD) && (prevD < 0) !== (d < 0)) {
          const g = deriv(c.fn);
          let xm = bisect(g, prevX - dx / 2, x + dx / 2);
          if (isNaN(xm)) xm = x - dx / 2;
          const kind = turningKind(c.fn, xm);
          if (kind) push(kind, xm, safe(c.fn, xm), color);
        }
        prevD = d; prevX = x; prevY = y;
      }
    }

    // ---- pairwise intersections
    for (let a = 0; a < active.length; a++) {
      for (let b = a + 1; b < active.length; b++) {
        const f = active[a].fn, g = active[b].fn;
        const diff = (x) => safe(f, x) - safe(g, x);
        let px = left, pd = diff(left);
        for (let s = 1; s <= steps; s++) {
          const x = left + s * dx;
          const d = diff(x);
          if (!isNaN(d) && !isNaN(pd) && (pd < 0) !== (d < 0)) {
            const r = bisect(diff, px, x);
            if (isRoot(diff, r, px, x)) push('intersection', r, safe(f, r), POI_COLOR);
          }
          px = x; pd = d;
        }
      }
    }

    this.poiDirty = false;
  }

  /* Snap a marker onto whichever curve is under the pointer. */
  updateTrace() {
    this.trace = null;
    const p = this.panel;
    const sx = this.pointer.u * this.fullCanvas.width;
    const sy = this.pointer.v * this.fullCanvas.height;
    if (sx < p.x || sy > p.h) return;

    const wx = this.view.cx + (sx - (p.x + p.w / 2)) / this.view.scale;

    let best = null, bestDist = 26;      // px
    this.compiled.forEach((fn, i) => {
      if (!fn) return;
      let wy;
      try { wy = fn(wx); } catch (e) { return; }
      if (!isFinite(wy)) return;
      const s = this.worldToScreen(wx, wy);
      const d = Math.abs(s.sy - sy);
      if (d < bestDist) { bestDist = d; best = { slot: i, x: wx, y: wy }; }
    });

    if (best) {
      best.color = CURVE_COLORS[best.slot % CURVE_COLORS.length];
      this.trace = best;
    }
  }

  /* Clicking within reach of a point of interest pins (or unpins) it. */
  clickPOI(u, v) {
    const sx = u * this.fullCanvas.width, sy = v * this.fullCanvas.height;
    let hit = null, bestD = 18;
    for (const q of this.poi) {
      const s = this.worldToScreen(q.x, q.y);
      const d = Math.hypot(s.sx - sx, s.sy - sy);
      if (d < bestD) { bestD = d; hit = q; }
    }
    if (!hit) return false;

    const idx = this.pinned.findIndex((q) =>
      Math.abs(q.x - hit.x) < 1e-9 && Math.abs(q.y - hit.y) < 1e-9);
    if (idx >= 0) this.pinned.splice(idx, 1);
    else this.pinned.push({ x: hit.x, y: hit.y, kind: hit.kind, color: hit.color });
    this._pinSeq++;
    return true;
  }

  /* ==================================================================== */
  /* Handheld rendering                                                    */
  /* ==================================================================== */

  renderHandheld() {
    if (!this.dirtyHand) return;
    const ctx = this.handCtx;
    ctx.imageSmoothingEnabled = false;
    this.handHits.length = 0;

    ctx.fillStyle = CASE_DARK;
    ctx.fillRect(0, 0, HAND_W, HAND_H);
    ctx.fillStyle = CASE_LIGHT;
    ctx.fillRect(6, 6, HAND_W - 12, HAND_H - 12);
    ctx.fillStyle = CASE_DARK;
    ctx.fillRect(12, 12, HAND_W - 24, HAND_H - 24);

    const sx = 26, sy = 26, sw = HAND_W - 52, sh = 150;
    ctx.fillStyle = '#05100a';
    ctx.fillRect(sx, sy, sw, sh);
    ctx.fillStyle = GREEN_DEEP;
    ctx.fillRect(sx + 3, sy + 3, sw - 6, sh - 6);

    F.draw(ctx, 'SCIENTIFIC', sx + 10, sy + 10, { color: GREEN_DIM, scale: 1, tracking: 1 });

    let hy = sy + 34;
    for (let i = Math.min(2, this.history.length - 1); i >= 0; i--) {
      const h = this.history[i];
      F.draw(ctx, h.src.slice(-30), sx + 10, hy, { color: GREEN_DARK, scale: 1 });
      F.draw(ctx, h.out, sx + sw - 10, hy, { color: GREEN_DIM, scale: 1, align: 'right' });
      hy += F.lineHeight(1) + 2;
    }

    F.draw(ctx, this.entry.slice(-26) || '_', sx + 10, sy + sh - 62, { color: GREEN, scale: 1 });
    F.draw(ctx, this.result || '', sx + sw - 10, sy + sh - 42,
           { color: GREEN, scale: 2, align: 'right' });

    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (let y = sy + 3; y < sy + sh - 3; y += 3) ctx.fillRect(sx + 3, y, sw - 6, 1);

    const padTop = sy + sh + 20;
    const cols = 5, rows = KEYPAD.length, gap = 8;
    const kw = Math.floor((HAND_W - 52 - gap * (cols - 1)) / cols);
    const kh = Math.floor((HAND_H - padTop - 30 - gap * (rows - 1)) / rows);

    KEYPAD.forEach((row, r) => {
      row.forEach((label, c) => {
        const x = 26 + c * (kw + gap), y = padTop + r * (kh + gap);
        const accent = label === '=' || label === 'GRAPH';
        ctx.fillStyle = '#0e0e0c';
        ctx.fillRect(x, y, kw, kh);
        ctx.fillStyle = accent ? '#25452e' : '#2b2a26';
        ctx.fillRect(x, y, kw - 2, kh - 2);
        ctx.fillStyle = accent ? '#1a3021' : '#201f1c';
        ctx.fillRect(x + 2, y + 2, kw - 4, kh - 4);
        const scale = label.length > 1 ? 1 : 2;
        F.draw(ctx, label, x + kw / 2, y + (kh - F.cellH * scale) / 2,
               { color: accent ? GREEN : '#b9b2a4', scale, align: 'center' });
        this.handHits.push({ x, y, w: kw, h: kh, label });
      });
    });

    F.draw(ctx, 'ESC - SET DOWN', HAND_W / 2, HAND_H - 24,
           { color: '#6a6459', scale: 1, align: 'center', tracking: 1 });

    this.handTexture.update(this.handCanvas);
    this.dirtyHand = false;
  }

  /* ==================================================================== */
  /* Expanded rendering                                                    */
  /* ==================================================================== */

  /* Capped deliberately. The panel is a bitmap-font UI, so rendering it above
     roughly 720p buys nothing visible - and since the canvas is re-uploaded
     to the GPU whenever it changes, an uncapped 1440p surface costs about
     8 MB per upload. Slight stretching to fill the screen is invisible here
     and is what the rest of the game does anyway. */
  resizeFull(w, h) {
    const MAX_W = 1280, MAX_H = 720;
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));

    /* Both axes are scaled by the SAME factor, and nothing is clamped per-axis
       afterwards. Clamping the axes independently distorts the aspect ratio -
       a tall window came out 640x720 instead of a small 16:9-ish surface, and
       the whole panel appeared stretched. */
    const fit = Math.min(1, MAX_W / w, MAX_H / h);
    w = Math.max(2, Math.round(w * fit));
    h = Math.max(2, Math.round(h * fit));
    if (this.fullCanvas.width === w && this.fullCanvas.height === h) return;
    this.fullCanvas.width = w;
    this.fullCanvas.height = h;
    this.poiDirty = true;
    this._sig = null;
  }

  /* Everything that changes what the PANEL looks like. Redrawing and
     re-uploading only when this changes is the difference between ~2 uploads
     a second and 60 - and at 60 the upload traffic is heavy enough to tear
     the panel, which reads as a flickering CRT rather than as a bug.

     The pointer is deliberately NOT in here. It used to be, because the trace
     readout and the mouse cursor were painted onto this canvas - which meant
     that simply moving the mouse across the graph redrew and re-uploaded the
     largest surface in the game, up to 3.7 MB, on every single frame. That is
     what made the grapher strobe like a failing CRT. Both now draw as their
     own small quads (see drawDynamic), so this covers only what is painted
     here. */
  fullSignature() {
    const v = this.view;
    return this.slots.join(SLOT_SEP) +
      '|' + this.activeSlot +
      '|' + v.cx.toFixed(4) + ',' + v.cy.toFixed(4) + ',' + v.scale.toFixed(3) +
      '|' + (this.padOpen ? 1 : 0) + this.padTab +
      // A counter, not pinned.length: unpinning one point and pinning another
      // in the same frame leaves the length unchanged but the display stale.
      '|' + this._pinSeq +
      '|' + (Math.floor(performance.now() / 480) % 2) +
      '|' + this.fullCanvas.width + 'x' + this.fullCanvas.height;
  }

  renderFullscreen(time) {
    const sig = this.fullSignature();
    if (!this.poiDirty && sig === this._sig) return;
    this._sig = sig;

    const ctx = this.fullCtx;
    const W = this.fullCanvas.width, H = this.fullCanvas.height;
    this.fullHits.length = 0;

    if (this.poiDirty) this.computePOI();

    const p = this.panel;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#020604';
    ctx.fillRect(0, 0, W, H);

    this.drawGrid(ctx, p);
    this.drawAxes(ctx, p);
    this.drawCurves(ctx, p);
    this.drawPOI(ctx, p);
    this.drawExpressionList(ctx, p);
    this.drawGraphControls(ctx, p);
    if (this.padOpen) this.drawKeypad(ctx, p);
    this.drawCrtOverlay(ctx, W, H);

    this.fullTexture.update(this.fullCanvas);
  }

  /* ------------------------------------------------------ dynamic layer

     The two things that follow the mouse: the trace readout and the cursor.
     Both draw as their own quads on top of the panel, so a mouse move costs
     a few draw calls instead of a full-surface upload.

     Only the coordinate label needs pixels that change, and it gets a small
     scratch canvas - about 34 KB - instead of forcing the whole panel. */
  drawDynamic(pipeline) {
    this.updateTrace();

    const W = this.fullCanvas.width, H = this.fullCanvas.height;
    const p = this.panel;
    const sp = this.sprites || (this.sprites = buildSprites(this.gl));

    const t = this.trace;
    const s = t ? this.worldToScreen(t.x, t.y) : null;
    if (s && s.sx >= p.x && s.sy >= p.y && s.sy <= p.h) {
      /* Dashed crosshair rules out to the edges of the plot, the way a trace
         readout reads. The dashes are an 8x1 texture tiled along the quad, so
         the pattern survives the move off the canvas. */
      const rule = [1, 1, 1, 0.28];
      pipeline.drawOverlay(sp.dashV,
        { x: Math.round(s.sx) / W, y: p.y / H, w: 1 / W, h: (p.h - p.y) / H },
        { color: rule, uvRect: [0, 0, 1, (p.h - p.y) / DASH_PX] });
      pipeline.drawOverlay(sp.dashH,
        { x: p.x / W, y: Math.round(s.sy) / H, w: p.w / W, h: 1 / H },
        { color: rule, uvRect: [0, 0, p.w / DASH_PX, 1] });

      // Marker dot, tinted to the curve it is riding.
      const c = hexToRgb(t.color);
      pipeline.drawOverlay(sp.dot,
        { x: (s.sx - DOT_PX / 2) / W, y: (s.sy - DOT_PX / 2) / H,
          w: DOT_PX / W, h: DOT_PX / H },
        { color: [c[0], c[1], c[2], 1] });

      // Coordinate label, clamped inside the plot exactly as before.
      const text = '(' + trimNum(t.x, 3) + ', ' + trimNum(t.y, 3) + ')';
      const lab = this.renderLabel(text, t.color);
      const lx = clamp(s.sx + 12, p.x + 2, W - lab.w - 2);
      const ly = clamp(s.sy - F.cellH - 12, 2, p.h - lab.h - 2);
      pipeline.drawOverlay(this.labelTexture,
        { x: lx / W, y: ly / H, w: lab.w / W, h: lab.h / H },
        { uvRect: [0, 0, lab.w / LABEL_W, lab.h / LABEL_H] });
    }

    /* The classic arrow. Drawn 1:1 from its sprite so it stays crisp, and
       shifted back by the 1px inset the sprite leaves for its keyline, so the
       tip still lands exactly on the pointer. */
    pipeline.drawOverlay(sp.cursor, {
      x: (Math.round(this.pointer.u * W) - CURSOR_INSET) / W,
      y: (Math.round(this.pointer.v * H) - CURSOR_INSET) / H,
      w: CURSOR_PX / W, h: CURSOR_PX / H
    });
  }

  /* The label bitmap, rebuilt only when its text or colour actually change -
     which is far less often than the pointer moves, because the readout is
     rounded to three significant figures. Returns the used sub-rectangle so
     the quad can crop the scratch canvas. */
  renderLabel(text, color) {
    const gl = this.gl;
    if (!this.labelCanvas) {
      this.labelCanvas = document.createElement('canvas');
      this.labelCanvas.width = LABEL_W;
      this.labelCanvas.height = LABEL_H;
      this.labelCtx = this.labelCanvas.getContext('2d');
      this.labelTexture = new SATG.gl.Texture(gl, {
        source: this.labelCanvas, filter: gl.LINEAR, wrap: gl.CLAMP_TO_EDGE
      });
    }

    const h = Math.min(LABEL_H, F.cellH + 10);
    const key = text + '|' + color;
    if (key === this._labelKey) return { w: this._labelW, h };
    this._labelKey = key;

    const w = Math.min(LABEL_W, F.measure(text, 1, 0) + 14);
    this._labelW = w;

    const ctx = this.labelCtx;
    ctx.clearRect(0, 0, LABEL_W, LABEL_H);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = 'rgba(3,18,9,0.92)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    F.draw(ctx, text, 7, 5, { color: '#dff7e6', scale: 1 });

    this.labelTexture.update(this.labelCanvas);
    return { w, h };
  }

  drawGrid(ctx, p) {
    const s = this.view.scale;
    // 1-2-5 x 10^n, the conventional "nice step" progression.
    const raw = 64 / s;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
    this._step = step;

    const left = this.view.cx - (p.w / 2) / s;
    const right = this.view.cx + (p.w / 2) / s;
    const bottom = this.view.cy - (p.h / 2) / s;
    const top = this.view.cy + (p.h / 2) / s;

    ctx.save();
    ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip();

    for (const [mult, color, width] of [[step / 5, 'rgba(50,160,80,0.16)', 1],
                                        [step, 'rgba(80,225,120,0.30)', 1]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let x = Math.ceil(left / mult) * mult; x <= right; x += mult) {
        const px = Math.round(this.worldToScreen(x, 0).sx) + 0.5;
        ctx.moveTo(px, p.y); ctx.lineTo(px, p.h);
      }
      for (let y = Math.ceil(bottom / mult) * mult; y <= top; y += mult) {
        const py = Math.round(this.worldToScreen(0, y).sy) + 0.5;
        ctx.moveTo(p.x, py); ctx.lineTo(p.x + p.w, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  drawAxes(ctx, p) {
    const step = this._step || 1;
    const s = this.view.scale;
    ctx.save();
    ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip();

    const o = this.worldToScreen(0, 0);
    ctx.strokeStyle = 'rgba(170,255,200,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x, Math.round(o.sy) + 0.5); ctx.lineTo(p.x + p.w, Math.round(o.sy) + 0.5);
    ctx.moveTo(Math.round(o.sx) + 0.5, p.y); ctx.lineTo(Math.round(o.sx) + 0.5, p.h);
    ctx.stroke();

    const left = this.view.cx - (p.w / 2) / s;
    const right = this.view.cx + (p.w / 2) / s;
    const bottom = this.view.cy - (p.h / 2) / s;
    const top = this.view.cy + (p.h / 2) / s;

    const labelY = clamp(o.sy + 6, p.y + 4, p.h - F.cellH - 4);
    for (let x = Math.ceil(left / step) * step; x <= right; x += step) {
      if (Math.abs(x) < step * 0.01) continue;
      F.draw(ctx, trimNum(x), this.worldToScreen(x, 0).sx, labelY,
             { color: GREEN_MID, scale: 1, align: 'center' });
    }
    const labelX = clamp(o.sx - 8, p.x + 34, p.x + p.w - 8);
    for (let y = Math.ceil(bottom / step) * step; y <= top; y += step) {
      if (Math.abs(y) < step * 0.01) continue;
      F.draw(ctx, trimNum(y), labelX, this.worldToScreen(0, y).sy - F.cellH / 2,
             { color: GREEN_MID, scale: 1, align: 'right' });
    }
    ctx.restore();
  }

  drawCurves(ctx, p) {
    ctx.save();
    ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    this.compiled.forEach((fn, idx) => {
      if (!fn) return;
      const color = CURVE_COLORS[idx % CURVE_COLORS.length];

      // Glow underlay then the line itself: cheap phosphor bloom.
      for (const [width, alpha] of [[9, 0.10], [5, 0.18], [2.2, 1.0]]) {
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = width;
        ctx.beginPath();

        let penDown = false, prevY = NaN;
        for (let sx = p.x; sx <= p.x + p.w; sx += 1) {
          const wx = this.view.cx + (sx - (p.x + p.w / 2)) / this.view.scale;
          let wy;
          try { wy = fn(wx); } catch (e) { wy = NaN; }
          if (!isFinite(wy)) { penDown = false; prevY = NaN; continue; }

          const sy = p.h / 2 - (wy - this.view.cy) * this.view.scale;
          // Break the polyline at a discontinuity rather than drawing a
          // vertical bar through the asymptote.
          if (penDown && isFinite(prevY) && Math.abs(sy - prevY) > p.h * 1.5) penDown = false;
          if (!penDown) { ctx.moveTo(sx, sy); penDown = true; } else ctx.lineTo(sx, sy);
          prevY = sy;
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });
    ctx.restore();
  }

  drawPOI(ctx, p) {
    ctx.save();
    ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip();

    const drawDot = (q, pinned) => {
      const s = this.worldToScreen(q.x, q.y);
      ctx.beginPath();
      ctx.arc(s.sx, s.sy, pinned ? 5.5 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = q.kind === 'intersection' ? POI_COLOR : (q.color || POI_COLOR);
      ctx.globalAlpha = pinned ? 1 : 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#03140a';
      ctx.stroke();

      if (pinned) {
        const label = '(' + trimNum(q.x, 3) + ', ' + trimNum(q.y, 3) + ')';
        this.drawLabel(ctx, label, s.sx + 10, s.sy - F.cellH - 10, q.color || POI_COLOR);
      }
    };

    for (const q of this.poi) drawDot(q, false);
    for (const q of this.pinned) drawDot(q, true);
    ctx.restore();
  }


  drawLabel(ctx, text, x, y, color) {
    const w = F.measure(text, 1, 0) + 14;
    const h = F.cellH + 10;
    const bx = clamp(x, this.panel.x + 2, this.fullCanvas.width - w - 2);
    const by = clamp(y, 2, this.panel.h - h - 2);
    ctx.fillStyle = 'rgba(3,18,9,0.92)';
    ctx.fillRect(bx, by, w, h);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, h - 1);
    F.draw(ctx, text, bx + 7, by + 5, { color: '#dff7e6', scale: 1 });
  }

  drawExpressionList(ctx, p) {
    const w = p.listW, H = p.h;

    /* Clipped to its own column. Every other part of the panel clips itself,
       but this one used to rely on `listW` having a 240px floor - comfortably
       wider than the 142px "GRAPHING" header. Now that the sidebar is capped
       at 60% of the surface so the plot can never go negative, a very narrow
       window makes it narrower than its own heading, and the text would paint
       straight over the graph drawn to its right. */
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, H);
    ctx.clip();

    ctx.fillStyle = 'rgba(3,12,6,0.96)';
    ctx.fillRect(0, 0, w, H);
    ctx.fillStyle = 'rgba(90,220,130,0.32)';
    ctx.fillRect(w - 2, 0, 2, H);

    F.draw(ctx, 'GRAPHING', 16, 14, { color: GREEN, scale: 2, tracking: 2 });
    ctx.fillStyle = 'rgba(90,220,130,0.25)';
    ctx.fillRect(16, 14 + F.cellH * 2 + 8, w - 32, 2);

    const help = ['CLICK A ROW TO EDIT', 'CLICK THE BAR FOR KEYPAD',
                  'SCROLL = ZOOM   DRAG = PAN', 'HOVER A CURVE TO TRACE',
                  'CLICK A POINT TO PIN IT', 'HOME = RESET   ESC = CLOSE'];

    /* Lay the column out against the height actually available. With the
       keypad open (or a short window) `p.h` can be a fraction of the canvas,
       and a fixed 58px row would run the expression rows straight through the
       keypad toggle. Help lines are dropped first, then rows tighten. */
    const listTop = 14 + F.cellH * 2 + 24;
    const bh = 34;
    const by = H - bh - 16;
    const lineH = F.lineHeight(1) + 2;

    let helpCount = help.length;
    let rowH = 0;
    for (;;) {
      const helpH = helpCount ? helpCount * lineH + 12 : 0;
      rowH = Math.floor((by - helpH - listTop) / this.slots.length);
      if (rowH >= 34 || helpCount === 0) break;
      helpCount--;
    }
    rowH = clamp(rowH, 20, 58);

    let y = listTop;

    this.slots.forEach((src, i) => {
      const active = i === this.activeSlot;
      if (active) {
        ctx.fillStyle = 'rgba(60,190,100,0.15)';
        ctx.fillRect(6, y - 6, w - 12, rowH - 6);
        ctx.fillStyle = CURVE_COLORS[i % CURVE_COLORS.length];
        ctx.fillRect(6, y - 6, 3, rowH - 6);
      }

      // Rows scale with the available height, so offsets are proportional.
      const exprY = y + Math.round(rowH * 0.34);
      const errY = y + Math.round(rowH * 0.68);
      const roomForError = rowH >= 50;

      // Colour swatch, dimmed while the row does not parse.
      ctx.fillStyle = CURVE_COLORS[i % CURVE_COLORS.length];
      ctx.globalAlpha = this.compiled[i] ? 1 : 0.25;
      ctx.beginPath();
      ctx.arc(24, y + 9, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      F.draw(ctx, String(i + 1), 40, y + 2, { color: GREEN_DIM, scale: 1 });
      F.draw(ctx, 'y =', 56, y + 2, { color: GREEN_DIM, scale: 1 });

      const bad = src && !this.compiled[i];
      const shown = src || (active ? '' : '-');
      F.draw(ctx, shown.slice(-22), 40, exprY,
             { color: bad ? '#ff9c85' : GREEN, scale: 1.25 });

      if (active && (Math.floor(performance.now() / 480) % 2) === 0) {
        const cx = 40 + F.measure(shown.slice(-22), 1.25, 0) + 2;
        ctx.fillStyle = GREEN;
        ctx.fillRect(cx, exprY, 2, F.cellH * 1.25);
      }
      if (bad && roomForError) {
        F.draw(ctx, 'CHECK EXPRESSION', 40, errY, { color: '#ff9c85', scale: 1 });
      }

      this.fullHits.push({ x: 6, y: y - 6, w: w - 12, h: rowH - 6, kind: 'slot', slot: i });
      y += rowH;
    });

    /* Keyboard toggle, bottom-left, where Desmos puts it - but anchored to
       the VISIBLE height (`by`, computed above from p.h), not the canvas
       height, so the keypad never covers the button that dismisses it. */
    const bw = w - 32;
    ctx.fillStyle = this.padOpen ? 'rgba(70,200,110,0.28)' : 'rgba(20,60,32,0.9)';
    ctx.fillRect(16, by, bw, bh);
    ctx.strokeStyle = 'rgba(120,240,160,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(16.5, by + 0.5, bw - 1, bh - 1);
    F.draw(ctx, this.padOpen ? 'HIDE KEYPAD' : 'SHOW KEYPAD', 16 + bw / 2, by + (bh - F.cellH) / 2,
           { color: GREEN, scale: 1, align: 'center', tracking: 1 });
    this.fullHits.push({ x: 16, y: by, w: bw, h: bh, kind: 'padToggle' });

    // Only the lines the column had room for; see the layout pass above.
    const shownHelp = help.slice(0, helpCount);
    let hy = by - 12 - shownHelp.length * lineH;
    for (const line of shownHelp) {
      F.draw(ctx, line, 16, hy, { color: GREEN_DARK, scale: 1 });
      hy += lineH;
    }

    ctx.restore();          // closes the sidebar clip opened at the top
  }

  /* Zoom buttons and the reset control, top-right of the graph. */
  drawGraphControls(ctx, p) {
    const size = 34, gap = 8;
    const x = p.x + p.w - size - 14;
    const items = [{ l: '+', k: 'zoomIn' }, { l: '-', k: 'zoomOut' }, { l: 'H', k: 'home' }];
    items.forEach((it, i) => {
      const y = 14 + i * (size + gap);
      ctx.fillStyle = 'rgba(6,26,14,0.9)';
      ctx.fillRect(x, y, size, size);
      ctx.strokeStyle = 'rgba(120,240,160,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
      F.draw(ctx, it.l, x + size / 2, y + (size - F.cellH * 2) / 2,
             { color: GREEN, scale: 2, align: 'center' });
      this.fullHits.push({ x, y, w: size, h: size, kind: it.k });
    });
  }

  /* ------------------------------------------------------------ keypad */

  drawKeypad(ctx, p) {
    const H = p.fullH, W = this.fullCanvas.width;
    const top = p.h, h = p.padH;

    /* The basic tab divides the width into ten columns plus gutters, which
       goes negative below about 74px and draws the keys inside out. There is
       nothing usable to show at that size, so show nothing. */
    if (W < 96 || h < 40) return;

    ctx.fillStyle = 'rgba(4,16,9,0.98)';
    ctx.fillRect(0, top, W, h);
    ctx.fillStyle = 'rgba(90,220,130,0.4)';
    ctx.fillRect(0, top, W, 2);

    const pad = 10;
    const key = (x, y, kw, kh, label, hit, accent) => {
      ctx.fillStyle = accent ? 'rgba(60,180,95,0.35)' : 'rgba(16,48,26,0.95)';
      ctx.fillRect(x, y, kw, kh);
      ctx.strokeStyle = accent ? 'rgba(150,255,190,0.8)' : 'rgba(90,200,125,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, kw - 1, kh - 1);
      const sc = label.length > 3 ? 1 : label.length > 1 ? 1.25 : 1.75;
      F.draw(ctx, label, x + kw / 2, y + (kh - F.cellH * sc) / 2,
             { color: accent ? '#e6ffee' : GREEN, scale: sc, align: 'center' });
      if (hit) this.fullHits.push(Object.assign({ x, y, w: kw, h: kh }, hit));
    };

    if (this.padTab === 'basic') {
      const rows = 4;
      const kh = Math.floor((h - pad * 2 - (rows - 1) * 6) / rows);
      const totalCols = 10;
      const kw = Math.floor((W - pad * 2 - (totalCols - 1) * 6) / totalCols);
      const cx = (c) => pad + c * (kw + 6);
      const cy = (r) => top + pad + r * (kh + 6);

      PAD_BASIC.groupA.forEach((row, r) => row.forEach((k, c) =>
        key(cx(c), cy(r), kw, kh, k.l, k.a ? { kind: 'padAction', action: k.a } : { kind: 'padKey', insert: k.i })));

      PAD_BASIC.groupB.forEach((row, r) => row.forEach((k, c) =>
        key(cx(c + 4), cy(r), kw, kh, k.l, { kind: 'padKey', insert: k.i })));

      // right-hand navigation column
      key(cx(8), cy(0), kw * 2 + 6, kh, 'FUNCTIONS', { kind: 'padAction', action: 'funcs' });
      key(cx(8), cy(1), kw, kh, '<', { kind: 'padAction', action: 'left' });
      key(cx(9), cy(1), kw, kh, '>', { kind: 'padAction', action: 'right' });
      key(cx(8), cy(2), kw * 2 + 6, kh, 'DEL', { kind: 'padAction', action: 'back' });
      key(cx(8), cy(3), kw * 2 + 6, kh, 'ENTER', { kind: 'padAction', action: 'enter' }, true);

    } else if (this.padTab === 'abc') {
      const rows = PAD_ABC.length + 1;
      const kh = Math.floor((h - pad * 2 - (rows - 1) * 6) / rows);
      const kw = Math.floor((W - pad * 2 - 9 * 6) / 10);
      PAD_ABC.forEach((row, r) => {
        row.forEach((ch, c) => {
          const x = pad + c * (kw + 6), y = top + pad + r * (kh + 6);
          if (ch === '123') key(x, y, kw, kh, '123', { kind: 'padAction', action: 'basic' });
          else if (ch === 'DEL') key(x, y, kw, kh, 'DEL', { kind: 'padAction', action: 'back' });
          else key(x, y, kw, kh, ch, { kind: 'padKey', insert: ch });
        });
      });
      const y = top + pad + PAD_ABC.length * (kh + 6);
      key(pad, y, kw * 4 + 18, kh, 'FUNCTIONS', { kind: 'padAction', action: 'funcs' });
      key(pad + (kw + 6) * 6, y, kw * 4 + 18, kh, 'ENTER', { kind: 'padAction', action: 'enter' }, true);

    } else {
      // functions popover
      const colW = Math.floor((W - pad * 2) / PAD_FUNCS.length);
      PAD_FUNCS.forEach((group, gi) => {
        const gx = pad + gi * colW;
        F.draw(ctx, group.cat.toUpperCase(), gx + 6, top + pad,
               { color: GREEN_DIM, scale: 1, tracking: 1 });
        const kh = 34, kw = Math.floor((colW - 18) / 2);
        group.keys.forEach((k, i) => {
          const x = gx + 6 + (i % 2) * (kw + 6);
          const y = top + pad + F.lineHeight(1) + 8 + Math.floor(i / 2) * (kh + 6);
          key(x, y, kw, kh, k.replace('(', ''), { kind: 'padKey', insert: k });
        });
      });
      key(W - pad - 120, top + p.padH - 46, 120, 34, 'BACK',
          { kind: 'padAction', action: 'basic' });
    }
  }

  drawCrtOverlay(ctx, W, H) {
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.28,
                                       W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.65)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }


  /* ---------------------------------------------------------- hit test */

  hitTestHand(u, v) {
    const x = u * HAND_W, y = v * HAND_H;
    for (const h of this.handHits) {
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
        return { type: 'key', label: h.label };
      }
    }
    return null;
  }

  hitTestFull(u, v) {
    const x = u * this.fullCanvas.width, y = v * this.fullCanvas.height;
    /* Scanned in REVERSE. `fullHits` accumulates in draw order, so the last
       region added is the one drawn on top; taking the first match would let
       a control underneath the keypad steal clicks from the keys covering it. */
    for (let i = this.fullHits.length - 1; i >= 0; i--) {
      const h = this.fullHits[i];
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
    }
    const p = this.panel;
    if (x >= p.x && y <= p.h) return { kind: 'graph' };
    return null;
  }

  /** Route a keypad press. Returns true if it consumed the press. */
  padPress(hit) {
    if (hit.kind === 'padKey') { this.insert(hit.insert); return true; }
    if (hit.kind !== 'padAction') return false;
    switch (hit.action) {
      case 'abc':   this.padTab = 'abc'; return true;
      case 'basic': this.padTab = 'basic'; return true;
      case 'funcs': this.padTab = 'funcs'; return true;
      case 'back':  this.backspace(); return true;
      case 'enter': this.submit(); return true;
      case 'left': case 'right': return true;   // caret is always at the end here
    }
    return false;
  }

  get handAspect() { return HAND_W / HAND_H; }
}

/* --------------------------------------------------------------- format */

function formatResult(v) {
  if (!isFinite(v)) return isNaN(v) ? 'ERROR' : (v > 0 ? 'INF' : '-INF');
  if (Math.abs(v) >= 1e10 || (Math.abs(v) < 1e-6 && v !== 0)) return v.toExponential(6);
  return String(Math.round(v * 1e9) / 1e9);
}

function trimNum(v, dp) {
  const p = dp === undefined ? 4 : dp;
  if (Math.abs(v) < 1e-9) return '0';
  const r = Math.round(v * Math.pow(10, p)) / Math.pow(10, p);
  if (Math.abs(r) >= 1e6) return r.toExponential(1);
  return String(r);
}

SATG.Calculator = Calculator;
SATG.mathEval = { compile, evaluate, tokenize };
SATG.CURVE_COLORS = CURVE_COLORS;

})(window);
