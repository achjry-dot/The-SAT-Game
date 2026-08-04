/* =========================================================================
   world/machine.js - the thing across the front of the room.

   Built from the reference: a rusted industrial housing with a green
   dot-matrix readout in its face, four heavy bolts driven up out of it, and a
   pair of enamelled sign panels overhead carrying a tick and a cross. A
   spoked wheel turns on its flank for as long as the run lasts.

   It is present in EVERY run, whatever the player has switched off. The
   ANIMATIONS setting decides whether it is watched arriving and watched
   firing; it never decides whether it is there. That is the whole point of
   the room.

   Split into several meshes rather than one because the parts move
   independently: the bolts drive, the signs drop, the wheel spins. Every mesh
   except the wheel is built with its resting position baked into the
   vertices and is offset at draw time along a single axis, so no part needs a
   pivot the Builder cannot express. The wheel is the exception - it has to
   turn about its own hub - so it alone is built centred on the origin and
   placed by its model matrix.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;
const { Builder } = SATG.geom;
const { mat4, vec3 } = SATG;
const { clamp, smoothstep, noise1 } = SATG.util;

/* Where it stands. Z is forward of the far wall so the corner terminals still
   throw their light past it through the open gantry, and the whole assembly
   is centred on the room's axis - the player is sat directly in front of it. */
const MZ = -1.62;
const HOUSE = { w: 1.34, h: 1.30, d: 0.52, y: 0.65 };

/* The readout. Placed above the far edge of the table as seen from the seated
   eye line - which is exactly where the player is already looking when the
   sheet goes down - and comfortably clear of the tabletop occluding it. */
const SCREEN = { w: 0.88, h: 0.37, y: 1.02, z: MZ + HOUSE.d / 2 + 0.012 };

/* The two sign panels, hung off the gantry. High enough to loom, low enough
   that the seated look-up range reaches them. */
const SIGN = { w: 0.64, h: 0.34, d: 0.14, y: 1.90, dx: 0.42, z: MZ + 0.14 };

/* The wheel, standing proud of the housing on the left flank so it is not
   buried inside it, and outboard of the table so the player can see it turn. */
const WHEEL = { x: -1.04, y: 1.34, z: MZ + 0.40, r: 0.38 };

/* Bolt columns driven up out of the housing's top face (y = 1.30). */
const BOLT_X = [-0.44, -0.16, 0.16, 0.44];
const BOLT = { r: 0.072, h: 0.34, y: 1.47, z: MZ + 0.08 };

const AO_DARK = [0.34, 0.32, 0.31];
const AO_MID  = [0.62, 0.60, 0.58];
const AO_LIT  = [1.0, 1.0, 1.0];

/* Readout surface. Small on purpose - it is a dot-matrix panel, and more
   texels would only let it render detail the format never had. */
const DISP_W = 320, DISP_H = 136;

/* The code panels either side of the readout, and the room's own terminals,
   share one streaming canvas. One surface updated a dozen times a second is
   cheaper than four, and four screens running the same feed is what a
   facility with one computer in it would actually look like. */
const CODE_W = 128, CODE_H = 128;

const GLYPHS = '0123456789ABCDEFXYZ+-*/=<>#%$&@';

/* Scratch matrices, so a frame of drawing allocates nothing. */
const _mBase = mat4.create();
const _mPart = mat4.create();
const _mSpin = mat4.create();

/* =========================================================================
   Sparks

   Severed cable ends, arcing. Shared by the corridor and the exam room
   because both are the same building and both are wired the same way - badly.

   Each spark is its own single-quad mesh rather than one mesh for all of
   them, because they have to fire independently: a set of arcs that all flash
   on the same frame reads as the lighting flickering, not as three separate
   broken things. Four draw calls for four sparks is a price worth paying for
   that, and there are never more than a handful.
   ========================================================================= */

class SparkSet {
  /* `points` is [{x, y, z, size}]. Each gets a quad facing the room and a
     schedule of its own. */
  constructor(gl, points) {
    this.gl = gl;
    this.items = points.map((p) => {
      const b = new Builder();
      b.setColor([1, 1, 1]);
      b.push();
      b.translate(p.x, p.y, p.z);
      b.grid(p.size || 0.11, p.size || 0.11, 1, 1, 1, 1);
      b.pop();
      return {
        mesh: b.build(gl),
        pos: [p.x, p.y, p.z],
        // Staggered, so they do not all fire for the first time together.
        next: Math.random() * 3.2,
        level: 0,
        burst: 0
      };
    });
    this.time = 0;
  }

  update(dt) {
    this.time += dt;
    for (const s of this.items) {
      s.level = Math.max(0, s.level - dt * 14);
      if (s.burst > 0) {
        // Inside a burst: a rapid, irregular stutter of contact.
        s.burst -= dt;
        if (Math.random() < 0.45) s.level = 0.55 + Math.random() * 0.45;
        if (s.burst <= 0) s.next = this.time + 1.6 + Math.random() * 5.0;
      } else if (this.time >= s.next) {
        s.burst = 0.10 + Math.random() * 0.22;
        s.level = 1;
        if (SATG.audio && SATG.audio.spark) SATG.audio.spark();
      }
    }
  }

  /* The light an arc throws. Only ever the brightest one, and only while it
     is actually lit - the shader has eight lights total and a spark is not
     worth spending two of them on. */
  lights(out) {
    let best = null;
    for (const s of this.items) if (!best || s.level > best.level) best = s;
    if (best && best.level > 0.05) {
      out.push({
        position: vec3.create(best.pos[0], best.pos[1], best.pos[2]),
        color: [0.72, 0.86, 1.0],
        intensity: best.level * 2.2,
        range: 2.2
      });
    }
    return out;
  }

  render(pipeline) {
    for (const s of this.items) {
      if (s.level <= 0.02) continue;
      const k = s.level;
      pipeline.drawMesh(s.mesh, _mIdent, {
        map: null,
        tint: [0.85 + k * 0.15, 0.92 + k * 0.08, 1.0],
        emissive: [k * 1.3, k * 1.25, k * 1.4],
        jitter: 0.6, blend: false
      });
    }
  }
}

const _mIdent = mat4.create();

/* =========================================================================
   The fireball

   Real geometry, in the room, at the machine's own position - not a picture
   pasted over the finished frame.

   The difference is not decorative. A screen-space effect is painted after
   the camera has had its say, so it sits still while the room tumbles and it
   passes in front of the desk, the walls and the player's own hands
   regardless of where any of them are. This is a cluster of expanding
   spheres standing where the machine stands: it is occluded by the table
   until it is bigger than the table, it swings across the frame as the player
   is knocked sideways, and it arrives by getting closer rather than by
   getting wider. All of which is what "the room is on fire" looks like.

   Opaque, and drawn with culling off. Alpha-blended fire needs sorting the
   renderer does not do; solid emissive geometry needs none, and once a blob
   is large enough to contain the camera the disabled culling means its inside
   faces are what the player sees - which is the moment they are inside the
   explosion.
   ========================================================================= */

/* Where each blob starts, relative to the machine's face, and how it moves.
   Spread across the width of the housing so the front comes at the player as
   a wall rather than as a ball on the centre line. */
const BLOBS = [
  { x:  0.00, y: 1.05, z: 0.10, r: 0.30, vx:  0.00, vy: 0.55, vz: 2.30, hot: 1.00, lag: 0.00 },
  { x: -0.52, y: 0.92, z: 0.00, r: 0.26, vx: -0.85, vy: 0.70, vz: 2.05, hot: 0.90, lag: 0.02 },
  { x:  0.52, y: 0.96, z: 0.00, r: 0.26, vx:  0.85, vy: 0.62, vz: 2.05, hot: 0.90, lag: 0.02 },
  { x: -0.22, y: 1.55, z: -0.05, r: 0.22, vx: -0.35, vy: 1.60, vz: 1.65, hot: 0.72, lag: 0.05 },
  { x:  0.26, y: 1.62, z: -0.05, r: 0.22, vx:  0.40, vy: 1.70, vz: 1.55, hot: 0.72, lag: 0.05 },
  { x: -0.10, y: 0.45, z: 0.12, r: 0.24, vx: -0.20, vy: 0.20, vz: 2.45, hot: 0.85, lag: 0.03 },
  { x:  0.18, y: 0.40, z: 0.12, r: 0.24, vx:  0.30, vy: 0.15, vz: 2.55, hot: 0.85, lag: 0.03 }
];

class Fireball {
  constructor(gl) {
    this.gl = gl;
    const b = new Builder();
    b.setColor([1, 1, 1]);
    b.sphere(1, 9, 6);
    this.mesh = b.build(gl);

    /* A mottle for the surface. Without it the blobs are flat-shaded balls,
       and once one of them contains the camera the whole screen is a single
       untextured colour - which reads as the renderer having failed rather
       than as being inside an explosion. Turbulent rather than smooth: fire
       has structure at every scale and the coarse end of that is what carries
       at this size. */
    const T = SATG.textures;
    this.map = new SATG.gl.Texture(gl, {
      source: T.paint(128, (u, v) => {
        const n = T.fbm(u, v, 5, 5, 0x5EED);
        const r = T.ridged(u, v, 9, 3, 0x9F1E);
        const k = T.posterize(Math.min(1, n * 0.65 + r * 0.55), 6);
        // Hot cores stay white; the gaps between them fall to deep red.
        return T.mixRgb([150, 34, 8], [255, 250, 226], k * k);
      }),
      filter: gl.NEAREST, wrap: gl.REPEAT, mipmap: true
    });
    this.t = -1;                 // < 0 means nothing is happening
    this._m = mat4.create();
    this._s = mat4.create();
  }

  get active() { return this.t >= 0; }

  trigger() { this.t = 0; }
  clear() { this.t = -1; }

  update(dt) {
    if (this.t < 0) return;
    this.t += dt;
    // Held a little past the point the screen goes black, so a frame of it is
    // still there underneath if anything is still drawing.
    if (this.t > 0.9) this.t = -1;
  }

  /* The light it throws while it is arriving. One light, very bright, moving
     toward the player with the front of the ball - which is what makes the
     room's own walls flare in the right order. */
  lights(out) {
    if (this.t < 0) return out;
    const k = clamp(this.t / 0.24, 0, 1);
    out.push({
      position: vec3.create(0, 1.05 + k * 0.3, MZ + 0.10 + k * 1.9),
      color: [1.0, 0.62, 0.24],
      intensity: 14.0 * (1 - k * 0.35),
      range: 9.0
    });
    return out;
  }

  render(pipeline) {
    if (this.t < 0) return;
    const t = this.t;

    for (let i = 0; i < BLOBS.length; i++) {
      const B = BLOBS[i];
      const tt = t - B.lag;
      if (tt <= 0) continue;

      /* Radius grows on a square-root curve - fast at the front and easing
         out - which is how a pressure wave actually expands, and which keeps
         the first two frames from being a pop. */
      const r = B.r + Math.sqrt(tt) * 5.2 * (0.6 + B.hot * 0.6);
      const px = B.x + B.vx * tt;
      const py = B.y + B.vy * tt;
      const pz = MZ + B.z + B.vz * tt;

      const m = mat4.fromTranslation(this._m, px, py, pz);
      mat4.multiply(m, m, mat4.fromScaling(this._s, r, r * 0.92, r));

      /* Cooling from white through yellow to a deep red as it expands, with
         the outer blobs a stage behind the core. Emissive, so none of this
         depends on the room's lighting - the fire IS the light now. */
      /* Colour comes mostly from the texture; the tint and the glow only bias
         it. Driving the emissive hard enough to make the fire "bright" clips
         every texel to white and throws the mottle away - the thing then
         reads as a flat orange card, which is exactly what doing this in 3D
         was supposed to avoid. Kept close to 1 so the map survives. */
      const cool = clamp(tt / 0.34, 0, 1);
      const hot = B.hot * (1 - cool * 0.55);
      const rr = 1.0;
      const gg = clamp(0.62 + hot * 0.34, 0, 1);
      const bb = clamp(0.18 + hot * hot * 0.42, 0, 1);
      const glow = 0.52 + hot * 0.52;

      pipeline.drawMesh(this.mesh, m, {
        map: this.map,
        /* Tiled hard. A sphere that ends up four metres across with the map
           wrapped twice around it shows the player a fraction of one tile,
           which is a flat colour. Ten repeats keeps structure on screen even
           when a single blob is the entire frame. */
        uvScale: [9 + i * 1.7, 7 + i * 1.3],
        uvScroll: tt * (0.9 + i * 0.16),
        tint: [rr, gg, bb],
        emissive: [glow, glow * 0.86, glow * 0.66],
        cull: false,               // the player ends up inside these
        jitter: 0.8,
        depthWrite: true
      });
    }
  }
}

/* =========================================================================
   The streaming code panel
   ========================================================================= */

class CodeFeed {
  constructor(gl) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = CODE_W;
    this.canvas.height = CODE_H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new SATG.gl.Texture(gl, {
      source: this.canvas, filter: gl.NEAREST, wrap: gl.CLAMP_TO_EDGE
    });

    this.cell = 8;
    this.cols = Math.floor(CODE_W / this.cell);
    this.rows = Math.floor(CODE_H / this.cell);
    /* One falling head per column, each at its own speed. The effect is a
       trail of dimming glyphs behind a bright leading character; anything
       simpler reads as static noise rather than as something running. */
    this.heads = [];
    for (let i = 0; i < this.cols; i++) this.heads.push(this.newHead(true));

    this.time = 0;
    this.acc = 0;
    this.intensity = 1;
    this.paint();
  }

  newHead(anywhere) {
    return {
      y: anywhere ? Math.random() * this.rows : -Math.random() * 6,
      speed: 6 + Math.random() * 16,
      len: 4 + (Math.random() * 8) | 0
    };
  }

  /* Repainted on a fixed 14 Hz tick rather than every frame. The look is a
     stepping one, so a higher rate would cost uploads and buy nothing; much
     lower and it starts to read as a slideshow. */
  update(dt) {
    this.time += dt;
    this.acc += dt;
    if (this.acc < 1 / 14) return false;
    const step = this.acc;
    this.acc = 0;

    for (let i = 0; i < this.heads.length; i++) {
      const h = this.heads[i];
      h.y += h.speed * step * this.intensity;
      if (h.y > this.rows + h.len) this.heads[i] = this.newHead(false);
    }
    this.paint();
    return true;
  }

  paint() {
    const ctx = this.ctx;
    const c = this.cell;
    const n = GLYPHS.length;
    ctx.fillStyle = '#020a05';
    ctx.fillRect(0, 0, CODE_W, CODE_H);
    ctx.font = (c - 1) + 'px monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    const churn = (this.time * 6) | 0;
    for (let i = 0; i < this.cols; i++) {
      const h = this.heads[i];
      for (let k = 0; k < h.len; k++) {
        const row = Math.floor(h.y) - k;
        if (row < 0 || row >= this.rows) continue;
        // The head is white-hot; the tail falls away to nothing behind it.
        ctx.fillStyle = k === 0 ? '#dfffe8'
          : 'rgba(86,255,128,' + (0.85 * (1 - k / h.len)).toFixed(3) + ')';
        ctx.fillText(GLYPHS[(i * 31 + row * 17 + churn) % n], i * c, row * c);
      }
    }

    // The same phosphor stripe the terminals carry, so they read as one family.
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    for (let y = 0; y < CODE_H; y += 3) ctx.fillRect(0, y, CODE_W, 1);

    this.texture.update(this.canvas);
  }
}

/* =========================================================================
   The readout
   ========================================================================= */

/* Every state the panel can be in. The verdicts are the only ones with any
   urgency; the rest are the machine waiting, which is most of a run. */
const DISPLAY = {
  DEAD:     'dead',
  BOOT:     'boot',
  ARMED:    'armed',
  READY:    'ready',
  SCANNING: 'scanning',
  RIGHT:    'right',
  WRONG:    'wrong'
};

/* Where the panel returns to between events, for the whole of every run. */
const REST = DISPLAY.ARMED;

class Readout {
  constructor(gl) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = DISP_W;
    this.canvas.height = DISP_H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new SATG.gl.Texture(gl, {
      source: this.canvas, filter: gl.NEAREST, wrap: gl.CLAMP_TO_EDGE
    });
    this.mode = DISPLAY.DEAD;
    this.time = 0;
    this._frame = -1;
    /* The exam clock, mirrored onto the panel. The machine is the thing the
       clock belongs to - it is counting down to firing, and the HUD's copy of
       the same number is a convenience, not the source. Null while no run is
       in progress, which is when the line is simply absent. */
    this.timer = null;
    this.paint();
  }

  set(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.time = 0;
    this._frame = -1;
    this.paint();
  }

  setTimer(text) {
    if (this.timer === text) return false;
    this.timer = text;
    this.paint();
    return true;
  }

  update(dt) {
    this.time += dt;
    /* Only the blinking states need repainting, and only on the frames the
       blink actually flips. A panel that re-uploads at 60 Hz to show a word
       that is not changing is pure texture traffic. */
    const rate = this.mode === DISPLAY.BOOT ? 14
               : this.mode === DISPLAY.RIGHT || this.mode === DISPLAY.WRONG ? 12
               : this.mode === DISPLAY.SCANNING ? 6
               : 1.4;
    const f = Math.floor(this.time * rate);
    if (f === this._frame) return false;
    this._frame = f;
    this.paint();
    return true;
  }

  /* Drawn with the canvas's own monospace rather than the game's bitmap font.
     This is a segment panel behind glass, not a printed label, and the two
     want to look like different objects. */
  paint() {
    const ctx = this.ctx;
    const f = this._frame < 0 ? 0 : this._frame;

    ctx.fillStyle = '#03150a';
    ctx.fillRect(0, 0, DISP_W, DISP_H);
    ctx.textBaseline = 'middle';

    switch (this.mode) {
      case DISPLAY.DEAD:
        break;

      case DISPLAY.BOOT: {
        // Rows of hex streaming past, as if something long is being loaded.
        ctx.font = '15px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        for (let r = 0; r < 5; r++) {
          let s = '';
          for (let i = 0; i < 22; i++) {
            s += GLYPHS[(r * 13 + i * 7 + f * 5) % GLYPHS.length];
          }
          ctx.fillStyle = r === 4 ? '#9dffb8' : 'rgba(86,255,128,0.55)';
          ctx.fillText(s, 10, 8 + r * 21);
        }
        break;
      }

      case DISPLAY.ARMED:
        this.word('ARMED', '#7dff9b', f % 2 === 0 ? 1 : 0.72);
        this.clock('#7dff9b');
        this.sub('SUBJECT SECURED');
        break;

      case DISPLAY.READY:
        this.word('STANDBY', '#3fbf63', 0.85);
        this.clock('#5fdc80');
        this.sub('AWAITING RESPONSE');
        break;

      case DISPLAY.SCANNING:
        this.word('SCANNING', '#7dff9b', f % 2 === 0 ? 1 : 0.6);
        this.clock('#7dff9b');
        this.sub('.'.repeat((f % 4) + 1));
        break;

      case DISPLAY.RIGHT:
        this.word('RIGHT', '#c8ffd8', f % 2 === 0 ? 1 : 0.35);
        this.clock('#c8ffd8');
        this.sub('PROCEED');
        break;

      case DISPLAY.WRONG:
        this.word('WRONG', '#ff6a52', f % 2 === 0 ? 1 : 0.3);
        this.clock('#ff6a52');
        this.sub('TERMINATING');
        break;
    }

    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    for (let y = 0; y < DISP_H; y += 3) ctx.fillRect(0, y, DISP_W, 1);
    // A little haze off the glass, so it is not a perfectly flat panel.
    ctx.fillStyle = 'rgba(120,255,160,0.05)';
    ctx.fillRect(0, 0, DISP_W, DISP_H);

    this.texture.update(this.canvas);
  }

  /* Fitted, not fixed: 'SCANNING' is eight characters and 'RIGHT' is five, and
     a size chosen for the short word runs the long one off both edges. */
  word(text, color, alpha) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let px = 46;
    do {
      ctx.font = 'bold ' + px + 'px monospace';
      if (ctx.measureText(text).width <= DISP_W - 24) break;
      px -= 2;
    } while (px > 12);
    ctx.fillText(text, DISP_W / 2, 44);
    ctx.restore();
  }

  /* The countdown, under the word. This is the machine saying how long it
     intends to wait, which is a different sentence from the HUD's bar saying
     how long the player has - same number, and the machine is the one that
     means it. */
  clock(color) {
    if (!this.timer) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = color || '#7dff9b';
    ctx.globalAlpha = 0.92;
    ctx.font = 'bold 30px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.timer, DISP_W / 2, 84);
    ctx.restore();
  }

  sub(text) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(86,255,128,0.55)';
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, DISP_W / 2, DISP_H - 16);
  }
}

/* =========================================================================
   Sign faces

   Painted here rather than in textures.js because nothing else in the game
   wants a half-metre enamelled tick, and on its own the image means nothing.
   ========================================================================= */

function signFace(which) {
  const size = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');

  // Enamel plate, chipped and stained - it has been in this room a long time.
  ctx.fillStyle = '#cfc6b2';
  ctx.fillRect(0, 0, size, size);
  const rng = SATG.util.makeRng(which === 'tick' ? 0x71C4 : 0xC205);
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = rng.bool() ? 'rgba(92,58,38,0.34)' : 'rgba(255,255,255,0.16)';
    ctx.fillRect(rng.float(0, size), rng.float(0, size),
                 1 + rng.float(0, 3), 1 + rng.float(0, 3));
  }
  // Rusted border, where the enamel has failed at the fixings.
  ctx.strokeStyle = 'rgba(96,52,30,0.55)';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, size - 8, size - 8);

  ctx.strokeStyle = '#14120f';
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.lineWidth = 15;
  ctx.beginPath();
  if (which === 'tick') {
    ctx.moveTo(26, 68);
    ctx.lineTo(52, 96);
    ctx.lineTo(104, 30);
  } else {
    ctx.moveTo(30, 30); ctx.lineTo(98, 98);
    ctx.moveTo(98, 30); ctx.lineTo(30, 98);
  }
  ctx.stroke();

  return cv;
}

/* =========================================================================
   The machine
   ========================================================================= */

class Machine {
  constructor(gl, textures) {
    this.gl = gl;
    this.tex = textures;

    this.readout = new Readout(gl);
    this.code = new CodeFeed(gl);

    const face = (which) => new SATG.gl.Texture(gl, {
      source: signFace(which), filter: gl.NEAREST, wrap: gl.CLAMP_TO_EDGE
    });
    this.tickTex = face('tick');
    this.crossTex = face('cross');

    this.meshes = {
      body:   this.buildBody(),
      bolts:  this.buildBolts(),
      signs:  this.buildSigns(),
      wheel:  this.buildWheel(),
      screen: this.buildScreenQuad(),
      repeaters: this.buildRepeaters(),
      panels: this.buildCodePanels(),
      tick:   this.buildSignFaceQuad(-1),
      cross:  this.buildSignFaceQuad(1)
    };

    /* 0 while the room is still empty, 1 once every part has landed. Only the
       opening cutscene ever moves it; a run that skips the cutscene starts at
       1 and the machine is simply already there. */
    this.assembly = 1;

    this.wheelAngle = 0;
    this.wheelSpeed = 1.15;         // radians per second at rest
    this.time = 0;
    this.intensity = 0;             // 0 idle, 1 about to fire
    /* 0 -> 1 across the five seconds between a wrong answer and the blast.
       Drives the wheel's runaway and the shake; see game/cinematic.js. */
    this.dread = 0;

    /* Which sign is lit, and how hard. Both decay back to unlit on their own,
       so nothing has to remember to clear them. The plates are physically
       there the whole time either way. */
    this.tickLamp = 0;
    this.crossLamp = 0;

    // Rises for the half second the thing is coming apart.
    this.blast = 0;

    // Seconds left before a pulsed scan falls back to STANDBY. See pulseScan.
    this._revert = 0;
  }

  /* ==================================================================== */
  /* Construction                                                          */
  /* ==================================================================== */

  /* Housing, gantry, ducting, plinth - everything that never moves. */
  buildBody() {
    const b = new Builder();

    // The block the readout is set into.
    b.setColor(AO_MID);
    b.push();
    b.translate(0, HOUSE.y, MZ);
    b.box(HOUSE.w, HOUSE.h, HOUSE.d, { seg: [6, 5, 3], uvScale: 2.0 });
    b.pop();

    /* A raised bezel, so the panel sits IN something rather than on it.

       Four bars around the opening, NOT a solid box. A box the size of the
       screen plus a margin, standing proud of the housing, is a lid: its
       front face sits in front of the glass and hides the one thing on this
       machine anybody needs to read. */
    b.setColor(AO_DARK);
    const bz = MZ + HOUSE.d / 2 + 0.02;
    const bw = SCREEN.w + 0.14, bh = SCREEN.h + 0.12;
    for (const [dx, dy, w, h] of [
      [0, (bh + 0.07) / 2, bw + 0.07, 0.07],      // head
      [0, -(bh + 0.07) / 2, bw + 0.07, 0.07],     // sill
      [-(bw + 0.07) / 2, 0, 0.07, bh + 0.07],     // left jamb
      [(bw + 0.07) / 2, 0, 0.07, bh + 0.07]       // right jamb
    ]) {
      b.push();
      b.translate(dx, SCREEN.y + dy, bz);
      b.box(w, h, 0.07, { seg: [3, 1, 1], uvScale: 4.0 });
      b.pop();
    }

    // Plinth, wider than the housing and bolted to the floor.
    b.push();
    b.translate(0, 0.05, MZ);
    b.box(HOUSE.w + 0.34, 0.10, HOUSE.d + 0.22, { seg: [6, 1, 3], uvScale: 2.4 });
    b.pop();

    /* The gantry: an upright against each side wall and a beam across the
       top. This is what makes it read as filling the front of the room rather
       than as a cabinet standing in it. Left open, so the corner terminals
       still throw green through it. */
    b.setColor(AO_MID);
    for (const sx of [-1, 1]) {
      b.push();
      b.translate(sx * 1.46, 1.12, MZ);
      b.box(0.16, 2.24, 0.30, { seg: [1, 8, 2], uvScale: 2.2 });
      b.pop();
    }
    b.push();
    b.translate(0, 2.30, MZ);
    b.box(3.10, 0.20, 0.30, { seg: [12, 1, 2], uvScale: 2.0 });
    b.pop();

    // Cross-brace the signs hang from.
    b.setColor(AO_DARK);
    b.push();
    b.translate(0, 2.14, MZ - 0.06);
    b.box(2.92, 0.09, 0.09, { seg: [10, 1, 1], uvScale: 3.0 });
    b.pop();

    /* Ducting off the top of the housing into the ceiling. Two runs, because
       one reads as a pipe and two read as plant. */
    b.setColor(AO_MID);
    for (const [x, r] of [[-0.70, 0.085], [0.70, 0.062]]) {
      b.push();
      b.translate(x, 1.86, MZ - 0.12);
      b.cylinder(r, 1.16, 7, { uvScale: 1.4, capped: false });
      b.pop();
    }
    b.setColor(AO_DARK);
    for (const x of [-0.70, 0.70]) {
      b.push();
      b.translate(x, 1.32, MZ - 0.12);
      b.cylinder(0.11, 0.09, 7, { uvScale: 2.6 });
      b.pop();
    }

    // The wheel's axle housing.
    b.setColor(AO_MID);
    b.push();
    b.translate(WHEEL.x, WHEEL.y, MZ + 0.22);
    b.box(0.30, 0.30, 0.34, { seg: [2, 2, 2], uvScale: 2.6 });
    b.pop();

    // A rack of dead switchgear, so the right flank is not a bare upright.
    b.setColor(AO_DARK);
    for (let i = 0; i < 3; i++) {
      b.push();
      b.translate(1.06, 0.74 + i * 0.32, MZ + 0.30);
      b.box(0.36, 0.26, 0.22, { seg: [2, 1, 1], uvScale: 3.0 });
      b.pop();
    }

    return b.build(this.gl);
  }

  /* The four bolts, built driven home. The draw slides them straight down the
     Y axis while the machine is still assembling. */
  buildBolts() {
    const b = new Builder();
    for (const x of BOLT_X) {
      b.setColor(AO_MID);
      b.push();
      b.translate(x, BOLT.y, BOLT.z);
      b.cylinder(BOLT.r, BOLT.h, 8, { uvScale: 3.0 });
      b.pop();

      b.setColor(AO_DARK);
      b.push();
      b.translate(x, BOLT.y - BOLT.h / 2 + 0.02, BOLT.z);
      b.cylinder(BOLT.r * 1.34, 0.06, 8, { uvScale: 4.0 });
      b.pop();

      // A wider head, so the column reads as a driven fastener.
      b.setColor(AO_MID);
      b.push();
      b.translate(x, BOLT.y + BOLT.h / 2 + 0.03, BOLT.z);
      b.cylinder(BOLT.r * 1.22, 0.08, 6, { uvScale: 4.0 });
      b.pop();
    }
    return b.build(this.gl);
  }

  /* The boxes the sign faces are mounted on, and their hangers. */
  buildSigns() {
    const b = new Builder();
    for (const sx of [-1, 1]) {
      b.setColor(AO_MID);
      b.push();
      b.translate(sx * SIGN.dx, SIGN.y, SIGN.z);
      b.box(SIGN.w, SIGN.h, SIGN.d, { seg: [4, 3, 1], uvScale: 2.4 });
      b.pop();

      b.setColor(AO_DARK);
      for (const hx of [-0.20, 0.20]) {
        b.push();
        b.translate(sx * SIGN.dx + hx, SIGN.y + SIGN.h / 2 + 0.07, SIGN.z - 0.05);
        b.box(0.05, 0.18, 0.05, { uvScale: 4.0 });
        b.pop();
      }
    }
    return b.build(this.gl);
  }

  /* Centred on the origin in the XY plane, so the draw can spin it about Z
     and then place it. A rim, eight spokes, a hub, and one handle. */
  buildWheel() {
    const b = new Builder();
    const R = WHEEL.r;

    /* The rim as a ring of short boxes. A real torus is more geometry than
       this silhouette needs at 540 lines, and the facets are the look. */
    b.setColor(AO_MID);
    const seg = 12;
    for (let i = 0; i < seg; i++) {
      b.push();
      b.rotateZ((i / seg) * Math.PI * 2);
      b.translate(0, R, 0);
      b.box(R * 0.56, 0.075, 0.10, { uvScale: 4.0 });
      b.pop();
    }

    b.setColor(AO_DARK);
    for (let i = 0; i < 8; i++) {
      b.push();
      b.rotateZ((i / 8) * Math.PI * 2);
      b.translate(0, R * 0.5, 0);
      b.box(0.045, R, 0.05, { seg: [1, 3, 1], uvScale: 5.0 });
      b.pop();
    }

    b.setColor(AO_MID);
    b.push();
    b.rotateX(Math.PI / 2);
    b.cylinder(0.11, 0.18, 8, { uvScale: 4.0 });
    b.pop();

    /* One handle on the rim. Without it, eight even spokes are rotationally
       symmetric enough that a turning wheel can look stationary. */
    b.setColor(AO_DARK);
    b.push();
    b.translate(0, R + 0.10, 0.08);
    b.box(0.07, 0.16, 0.07, { uvScale: 4.0 });
    b.pop();

    return b.build(this.gl);
  }

  buildScreenQuad() {
    const b = new Builder();
    b.setColor(AO_LIT);
    b.push();
    b.translate(0, SCREEN.y, SCREEN.z);
    b.grid(SCREEN.w, SCREEN.h, 2, 2, 1, 1);
    b.pop();
    return b.build(this.gl);
  }

  /* Repeater screens, all carrying the readout's own texture.

     One panel is a device with a display. Five of them, all saying the same
     word at the same moment, is a machine that has been told something and is
     telling everyone - which is the difference between a prop and a thing
     that is about to make a decision about you. They share the readout's
     texture rather than having their own, so ARMED appears on all of them the
     instant it appears anywhere, at no extra cost per frame. */
  buildRepeaters() {
    const b = new Builder();
    b.setColor(AO_LIT);

    // One on the inner face of each gantry upright, angled in at the player.
    for (const sx of [-1, 1]) {
      b.push();
      b.translate(sx * 1.36, 1.62, MZ + 0.16).rotateY(-sx * 0.62);
      b.grid(0.30, 0.11, 2, 2, 1, 1);
      b.pop();
    }

    // One on the switchgear rack, on the right flank.
    b.push();
    b.translate(1.06, 1.06, MZ + 0.42);
    b.grid(0.30, 0.11, 2, 2, 1, 1);
    b.pop();

    // One low on the plinth, under the housing - the one visible over the
    // table when the player is sitting down and looking at the desk.
    b.push();
    b.translate(-0.46, 0.28, MZ + HOUSE.d / 2 + 0.20).rotateX(-0.30);
    b.grid(0.34, 0.12, 2, 2, 1, 1);
    b.pop();

    // And one on the underside of the top beam, angled down.
    b.push();
    b.translate(-0.62, 2.18, MZ + 0.17).rotateX(0.52);
    b.grid(0.34, 0.12, 2, 2, 1, 1);
    b.pop();

    return b.build(this.gl);
  }

  /* The code panels flanking the readout, plus one set into the underside of
     the top beam where the player will see it when they look up. */
  buildCodePanels() {
    const b = new Builder();
    b.setColor(AO_LIT);
    for (const sx of [-1, 1]) {
      b.push();
      b.translate(sx * 0.74, SCREEN.y - 0.02, MZ + HOUSE.d / 2 + 0.004);
      b.grid(0.22, 0.26, 2, 2, 1, 1);
      b.pop();
    }
    /* Tilted to face down and forward. Rotating the other way would point it
       at the ceiling and the player would see its culled back face. */
    b.push();
    b.translate(0, 2.28, MZ + 0.17);
    b.rotateX(0.42);
    b.grid(0.54, 0.14, 2, 2, 1, 1);
    b.pop();
    return b.build(this.gl);
  }

  buildSignFaceQuad(which) {
    const b = new Builder();
    b.setColor(AO_LIT);
    b.push();
    b.translate(which * SIGN.dx, SIGN.y, SIGN.z + SIGN.d / 2 + 0.004);
    b.grid(SIGN.w * 0.82, SIGN.h * 0.78, 2, 2, 1, 1);
    b.pop();
    return b.build(this.gl);
  }

  /* ==================================================================== */
  /* Per-frame                                                             */
  /* ==================================================================== */

  update(dt) {
    this.time += dt;

    /* The wheel turns for the whole run, in every mode, and never once slows
       down. Three terms, all additive:

         wheelSpeed  a floor that creeps up the longer the run lasts, so a
                     player forty questions deep is sitting in front of a
                     noticeably faster machine than one who just sat down
         intensity   the last ten seconds of the clock
         dread       the five seconds before it fires, where it runs away

       Whether any of it is HEARD is a separate question, asked in game.js -
       on a full SAT the wheel turns in silence. */
    this.wheelSpeed = Math.min(1.15 + this.time * 0.022, 4.2);
    this.wheelAngle += dt * this.assembly *
      (this.wheelSpeed + this.intensity * 4.0 + this.dread * this.dread * 22.0);

    this.readout.update(dt);
    this.code.intensity = 0.6 + this.intensity * 1.6;
    this.code.update(dt);

    this.tickLamp = Math.max(0, this.tickLamp - dt * 2.2);
    this.crossLamp = Math.max(0, this.crossLamp - dt * 2.2);
    this.blast = Math.max(0, this.blast - dt * 2.0);

    if (this._revert > 0) {
      this._revert -= dt;
      if (this._revert <= 0) this.readout.set(REST);
    }
  }

  setDisplay(mode) { this._revert = 0; this.readout.set(mode); }
  get display() { return this.readout.mode; }

  /* Show something briefly and fall back to resting on its own.

     The resting state is ARMED for the whole of every run, in every mode -
     the machine is not idling between questions, it is loaded and waiting,
     and the countdown printed under the word is how long it intends to wait.
     That is also what puts the clock on the panel during a module test,
     where the per-question timer is a thirty-two minute one. */
  pulse(mode, seconds) {
    this.readout.set(mode);
    this._revert = seconds || 0.55;
  }

  /* What a module test gets when an answer goes in: the machine reads the
     sheet and returns no verdict, because nothing is graded until the clock
     stops and saying anything here would leak the key. No pause, no sound. */
  pulseScan(seconds) { this.pulse(DISPLAY.SCANNING, seconds || 0.55); }

  flashTick()  { this.tickLamp = 1; }
  flashCross() { this.crossLamp = 1; }

  /* Called the moment it goes off. The housing kicks toward the player and
     the cross peaks; the fire itself is an overlay and belongs to the
     cinematic, not to the geometry. */
  detonate() {
    this.blast = 1;
    this.crossLamp = 1;
    this.readout.set(DISPLAY.WRONG);
  }

  /* What the machine contributes to the room's light rig. Handed back to the
     scene so it joins the same eight-light budget as the lamp overhead,
     rather than being a second lighting system nobody remembers to update.

     At most two, deliberately: the room already runs five of the shader's
     eight, and a verdict lamp arriving on top of a full rig would silently
     drop whichever light happened to be last in the array. */
  lights(out) {
    if (this.assembly <= 0.01) return out;

    if (this.readout.mode !== DISPLAY.DEAD) {
      out.push({
        position: vec3.create(0, SCREEN.y, SCREEN.z + 0.10),
        color: [0.36, 1.0, 0.52],
        intensity: this.assembly * (0.34 + this.intensity * 0.55),
        range: 2.2
      });
    }

    // Whichever verdict is louder. They are never both up at once in practice.
    if (this.crossLamp > 0.01 && this.crossLamp >= this.tickLamp) {
      out.push({
        position: vec3.create(SIGN.dx, SIGN.y, SIGN.z + 0.30),
        color: [1.0, 0.24, 0.16],
        intensity: this.crossLamp * 2.6, range: 2.8
      });
    } else if (this.tickLamp > 0.01) {
      out.push({
        position: vec3.create(-SIGN.dx, SIGN.y, SIGN.z + 0.30),
        color: [0.30, 1.0, 0.42],
        intensity: this.tickLamp * 2.4, range: 2.6
      });
    }
    return out;
  }

  /* ==================================================================== */
  /* Draw                                                                  */
  /* ==================================================================== */

  render(pipeline) {
    if (this.assembly <= 0.001) return;
    const T = this.tex;

    /* The whole assembly trembles as it winds up and kicks forward when it
       fires. Applied as one transform over every part, so it moves as an
       object rather than as a pile of pieces. */
    const shake = this.intensity * 0.006 + this.dread * this.dread * 0.030 +
                  this.blast * 0.055;
    const jx = shake ? (noise1(this.time * 47) - 0.5) * shake * 2 : 0;
    const jy = shake ? (noise1(this.time * 39 + 11) - 0.5) * shake * 2 : 0;
    const jz = this.blast * 0.12;          // toward the player, not away
    const base = mat4.fromTranslation(_mBase, jx, jy, jz);

    pipeline.drawMesh(this.meshes.body, base,
      { map: T.steel, tint: [0.82, 0.72, 0.66] });

    /* The bolts drive up across the first half of the assembly and the signs
       drop in across the second. Sequencing them rather than sliding
       everything at once is what gives the cutscene beats to hang clanks on. */
    const boltT = smoothstep(clamp(this.assembly * 2.0, 0, 1));
    const bolts = mat4.fromTranslation(_mPart,
      jx, jy - (1 - boltT) * (BOLT.h + 0.30), jz);
    pipeline.drawMesh(this.meshes.bolts, bolts,
      { map: T.iron, tint: [0.90, 0.86, 0.82] });

    const signT = smoothstep(clamp(this.assembly * 2.0 - 1.0, 0, 1));
    const signs = mat4.fromTranslation(_mPart, jx, jy + (1 - signT) * 1.40, jz);
    pipeline.drawMesh(this.meshes.signs, signs,
      { map: T.steel, tint: [0.86, 0.80, 0.74] });

    /* The plates. Unlit and faintly self-lit at rest so they can be read in a
       dark room at all, then driven hard by whichever verdict just landed. */
    const plate = (mesh, tex, lamp) => {
      const k = 0.26 + lamp * 0.74;
      pipeline.drawMesh(mesh, signs, {
        map: tex, tint: [k, k, k],
        emissive: [0.55 + lamp * 0.45, 0.55 + lamp * 0.45, 0.55 + lamp * 0.45]
      });
    };
    plate(this.meshes.tick, this.tickTex, this.tickLamp);
    plate(this.meshes.cross, this.crossTex, this.crossLamp);

    // The one part built at the origin, so it can be spun before it is placed.
    const w = mat4.fromTranslation(_mPart, WHEEL.x + jx, WHEEL.y + jy, WHEEL.z + jz);
    mat4.multiply(w, w, mat4.fromZRotation(_mSpin, this.wheelAngle));
    pipeline.drawMesh(this.meshes.wheel, w,
      { map: T.iron, tint: [0.86, 0.80, 0.74] });

    // Readout and code: emissive, so they glow rather than being lit.
    pipeline.drawMesh(this.meshes.screen, base, {
      map: this.readout.texture, tint: [1, 1, 1],
      emissive: [0.95, 0.95, 0.95], jitter: 0.25
    });
    /* The repeaters, saying the same thing on the same texture. Slightly
       dimmer than the main panel so it stays the one being read. */
    pipeline.drawMesh(this.meshes.repeaters, base, {
      map: this.readout.texture, tint: [0.86, 0.94, 0.88],
      emissive: [0.72, 0.72, 0.72], jitter: 0.3
    });
    pipeline.drawMesh(this.meshes.panels, base, {
      map: this.code.texture, tint: [0.85, 1.0, 0.90],
      emissive: [0.80, 0.80, 0.80], jitter: 0.4
    });
  }
}

SATG.Machine = Machine;
SATG.SparkSet = SparkSet;
SATG.Fireball = Fireball;
SATG.MACHINE_DISPLAY = DISPLAY;
SATG.MACHINE_CONST = { MZ, HOUSE, SCREEN, SIGN, WHEEL };

})(window);
