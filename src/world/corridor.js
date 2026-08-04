/* =========================================================================
   world/corridor.js - the walk in.

   A service corridor somewhere under the facility: poured floor, plated
   walls, a pipe run overhead, and a line of fluorescent fittings of which
   almost none still work. It exists for about eighteen seconds at the start
   of a run and is never seen again, so it is built to be atmospheric from one
   fixed vantage - straight down the middle - rather than to survive being
   walked around.

   Laid out along -Z. The player starts at the far end and walks toward the
   origin. At the end of the run:

     ahead, at -Z   the door to 957, which they are eventually put through
     to the left    an exit, with daylight of some kind under it

   The exit is the only warm light in the whole sequence, and it is the one
   thing in this game the player is never allowed to reach.

   Everything is drawn facing inward only. The player never leaves the
   corridor, so the outward faces would be geometry nobody could ever see.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;
const { Builder } = SATG.geom;
const { vec3 } = SATG;
const { clamp, noise1 } = SATG.util;

/* Extents. Narrow and low - a corridor you would have to turn sideways in to
   pass someone, which is most of the discomfort. */
const HALL = { w: 2.05, h: 2.45, len: 30 };

/* Where the walk starts and ends. The junction is at z = 0, and the walk
   stops in the middle of it - far enough in that the alcove is square to the
   player's left when they turn their head, and close enough to 957 that the
   shove only has to cover a metre. */
const START_Z = 26.5;
const END_Z = 0.55;

/* The fittings overhead. `live` is what still has a tube in it. */
const FITTINGS = [
  { z: 24.0, live: false },
  { z: 20.0, live: true },
  { z: 16.0, live: false },
  { z: 12.5, live: true },
  { z: 9.0,  live: false },
  { z: 5.5,  live: true },
  { z: 2.0,  live: false }
];

/* The exit, in the back of an alcove off the left-hand side of the junction.
   The alcove's mouth runs z -0.90 .. 1.10 and its back wall stands at
   x = -1.90; every number below is measured off those two. */
const EXIT = { x: -1.86, y: 1.02, z: 0.45, w: 0.92, h: 2.04 };
const ALCOVE = { backX: -1.90, z0: -0.55, z1: 1.45 };

/* Door 957, straight ahead. */
const DOOR = { x: 0, y: 1.02, z: -0.62, w: 0.96, h: 2.06 };

/* Cables ripped out of the ceiling on the way in: [x, z, drop]. Spread down
   the corridor so the walk passes one every few seconds, and kept off the
   centre line so none of them is ever walked through. */
const SEVERED = [
  [-0.62, 21.6, 0.85],
  [0.68, 15.2, 1.05],
  [-0.55, 9.4, 0.72],
  [0.60, 3.2, 0.95]
];

const AO_DARK = [0.30, 0.29, 0.28];
const AO_MID  = [0.58, 0.56, 0.54];
const AO_LIT  = [1.0, 1.0, 1.0];

/* =========================================================================
   The 957 plate

   Generated rather than modelled, because the number is the only thing in the
   corridor the player is meant to actually read.
   ========================================================================= */

function numberPlate(text) {
  const W = 192, H = 96;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const rng = SATG.util.makeRng(0x957);

  // Enamel, gone at the corners.
  ctx.fillStyle = '#c3baa4';
  ctx.fillRect(0, 0, W, H);
  /* Sparse and small. The plate is only 40cm wide but the player walks right
     up to it, so the texture ends up magnified - dense speckle at this size
     stopped reading as wear and started reading as static over the number,
     which is the one thing on it that has to survive. */
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = rng.bool() ? 'rgba(88,54,32,0.26)' : 'rgba(255,255,255,0.12)';
    ctx.fillRect(rng.float(0, W), rng.float(0, H), 1 + rng.float(0, 3), 1 + rng.float(0, 2));
  }
  ctx.strokeStyle = 'rgba(84,46,26,0.55)';
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, W - 8, H - 8);

  /* The game's bitmap font, not the canvas's. Everything the player is asked
     to read in this game is set in it, and the plate belongs to the same
     world as the exam sheet. Scaled to fill the plate, because at a distance
     the number IS the plate. */
  const F = SATG.font;
  const scale = F.fitScale(text, W - 34, 6, 4, 1);
  F.draw(ctx, text, W / 2, Math.round(H / 2 - F.cellH * scale / 2),
         { color: '#171511', scale: scale, tracking: 4, align: 'center' });

  return cv;
}

/* The lit box above the door: white letters knocked out of a green panel, the
   way every emergency sign in every building the player has ever been in
   looks. Deliberately the one clean, working, maintained object in the whole
   sequence - and it is above a door that does not open. */
function exitSignFace() {
  const W = 192, H = 80;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  ctx.fillStyle = '#0a1a0e';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#127a34';
  ctx.fillRect(5, 5, W - 10, H - 10);

  const F = SATG.font;
  const scale = F.fitScale('EXIT', W - 36, 5, 5, 1);
  F.draw(ctx, 'EXIT', W / 2, Math.round(H / 2 - F.cellH * scale / 2),
         { color: '#f2fff5', scale: scale, tracking: 5, align: 'center' });

  // Age it, but only a little - see above.
  const rng = SATG.util.makeRng(0xE117);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.fillRect(rng.float(0, W), rng.float(0, H), 1 + rng.float(0, 3), 1 + rng.float(0, 2));
  }
  return cv;
}

/* =========================================================================
   Corridor
   ========================================================================= */

class Corridor {
  constructor(gl, textures) {
    this.gl = gl;
    this.tex = textures;
    this.time = 0;

    this.plateTex = new SATG.gl.Texture(gl, {
      source: numberPlate('957'), filter: gl.NEAREST, wrap: gl.CLAMP_TO_EDGE
    });

    this.meshes = {
      floor:   this.buildFloor(),
      walls:   this.buildWalls(),
      pipes:   this.buildPipes(),
      props:   this.buildProps(),
      doors:   this.buildDoors(),
      tubes:   this.buildTubes(),
      plate:   this.buildPlate(),
      exitSign: this.buildExitSign(),
      exitStencil: this.buildExitStencil(),
      exitGlow: this.buildExitGlow()
    };

    // An arc at the end of each severed cable, derived from the same table
    // the cables are, so the two cannot drift apart.
    this.sparks = new SATG.SparkSet(gl, SEVERED.map(([x, z, drop]) => ({
      x: x + 0.05, y: HALL.h - 0.05 - drop - 0.10, z: z + 0.02, size: 0.12
    })));

    /* Five lights: the three surviving fittings, the spill under the exit,
       and a soft carry-light travelling with the player.

       The carry-light is not a torch and is not meant to be noticed. Without
       it the seven-metre gaps between fittings go to literal black - the
       lighting is per-vertex and the ambient term is almost nothing - and a
       corridor you cannot see at all is not frightening, it is broken.

       Five of the shader's eight, which leaves headroom and costs nothing. */
    /* Warm, not white. These are old tubes in a building made of rust, and a
       clean fluorescent colour made the floor read as grey office carpet -
       the concrete and the oxide in it want a sodium cast to come alive. The
       only cold light in the corridor is the carry-light, and that one is not
       supposed to be noticed. */
    this.lights = [
      { position: vec3.create(0, HALL.h - 0.18, 20.0), color: [1.00, 0.76, 0.48], intensity: 2.3, range: 8.5 },
      { position: vec3.create(0, HALL.h - 0.18, 12.5), color: [1.00, 0.74, 0.45], intensity: 2.3, range: 8.5 },
      { position: vec3.create(0, HALL.h - 0.18, 5.5),  color: [0.98, 0.72, 0.44], intensity: 2.3, range: 8.5 },
      { position: vec3.create(EXIT.x + 0.34, EXIT.y - 0.42, EXIT.z), color: [1.00, 0.88, 0.62], intensity: 1.5, range: 4.0 },
      { position: vec3.create(0, 1.45, START_Z), color: [0.70, 0.56, 0.44], intensity: 0.80, range: 5.2 }
    ];
    // Which fitting each of the first three lights belongs to, for flicker.
    this.liveZ = [20.0, 12.5, 5.5];

    this.identity = SATG.mat4.create();
  }

  /* ==================================================================== */
  /* Construction                                                          */
  /* ==================================================================== */

  buildFloor() {
    const b = new Builder();
    const halfLen = HALL.len / 2;
    const midZ = HALL.len / 2 - 2;

    b.setColor(AO_MID);
    b.push();
    b.translate(0, 0, midZ).rotateX(-Math.PI / 2);
    b.grid(HALL.w, HALL.len, 6, 60, HALL.w * 1.6, HALL.len * 1.6);
    b.pop();

    b.setColor(AO_DARK);
    b.push();
    b.translate(0, HALL.h, midZ).rotateX(Math.PI / 2);
    b.grid(HALL.w, HALL.len, 5, 48, HALL.w * 1.4, HALL.len * 1.4);
    b.pop();

    /* The alcove's own floor and ceiling, filling the gap left in the wall.
       Without these the exit opens onto a hole in the world. */
    const aw = -HALL.w / 2 - ALCOVE.backX;                 // 0.875
    const acx = (ALCOVE.backX - HALL.w / 2) / 2;           // -1.4625
    const acz = (ALCOVE.z0 + ALCOVE.z1) / 2;               // 0.10
    const adz = ALCOVE.z1 - ALCOVE.z0;                     // 2.00

    b.setColor(AO_MID);
    b.push();
    b.translate(acx, 0, acz).rotateX(-Math.PI / 2);
    b.grid(aw, adz, 3, 5, 2, 3);
    b.pop();
    b.setColor(AO_DARK);
    b.push();
    b.translate(acx, HALL.h, acz).rotateX(Math.PI / 2);
    b.grid(aw, adz, 3, 4, 2, 3);
    b.pop();

    return b.build(this.gl);
  }

  buildWalls() {
    const b = new Builder();
    const hw = HALL.w / 2;
    const midZ = HALL.len / 2 - 2;

    /* The side walls, split at the junction on the left so the exit alcove
       can open through. Everything is drawn facing inward - the player never
       leaves the corridor, so the outside faces would be waste. */
    b.setColor(AO_MID);

    // Right wall, full length.
    b.push();
    b.translate(hw, HALL.h / 2, midZ).rotateY(-Math.PI / 2);
    b.grid(HALL.len, HALL.h, 60, 10, HALL.len * 1.5, HALL.h * 1.5,
           [AO_DARK, AO_DARK, AO_MID, AO_MID]);
    b.pop();

    /* Left wall, in two pieces with the alcove mouth between them. The far
       piece runs from the mouth back to the start; the near piece is the
       short return between the mouth and the end wall. */
    const farLen = (START_Z + 1.6) - ALCOVE.z1;
    const nearLen = ALCOVE.z0 - (DOOR.z - 0.10);
    for (const [cz, len] of [[ALCOVE.z1 + farLen / 2, farLen],
                             [ALCOVE.z0 - nearLen / 2, nearLen]]) {
      if (len <= 0.01) continue;
      b.push();
      b.translate(-hw, HALL.h / 2, cz).rotateY(Math.PI / 2);
      b.grid(len, HALL.h, Math.max(4, Math.round(len * 2)), 10, len * 1.5, HALL.h * 1.5,
             [AO_DARK, AO_DARK, AO_MID, AO_MID]);
      b.pop();
    }

    // The alcove: back wall carrying the exit, plus its two returns.
    const adz = ALCOVE.z1 - ALCOVE.z0;
    const aw = -hw - ALCOVE.backX;
    b.push();
    b.translate(ALCOVE.backX, HALL.h / 2, (ALCOVE.z0 + ALCOVE.z1) / 2).rotateY(Math.PI / 2);
    b.grid(adz, HALL.h, 5, 10, 3, 4, [AO_DARK, AO_DARK, AO_MID, AO_MID]);
    b.pop();
    for (const [z, ry] of [[ALCOVE.z1, Math.PI], [ALCOVE.z0, 0]]) {
      b.push();
      b.translate((ALCOVE.backX - hw) / 2, HALL.h / 2, z).rotateY(ry);
      b.grid(aw, HALL.h, 3, 10, 2, 4);
      b.pop();
    }

    // The end wall, which door 957 is set into.
    b.push();
    b.translate(0, HALL.h / 2, DOOR.z - 0.10);
    b.grid(HALL.w, HALL.h, 6, 10, 3, 4, [AO_DARK, AO_DARK, AO_MID, AO_MID]);
    b.pop();

    // The wall behind the player, so turning round is not a hole.
    b.push();
    b.translate(0, HALL.h / 2, START_Z + 1.6).rotateY(Math.PI);
    b.grid(HALL.w, HALL.h, 4, 8, 3, 4);
    b.pop();

    /* Panel ribs down the right wall, every couple of metres. These are what
       give the walk its sense of distance covered - a smooth tunnel reads as
       standing still. */
    b.setColor(AO_DARK);
    for (let z = 1.5; z < HALL.len - 4; z += 2.2) {
      b.push();
      b.translate(hw - 0.05, HALL.h / 2, z);
      b.box(0.08, HALL.h - 0.2, 0.10, { seg: [1, 5, 1], uvScale: 3.0 });
      b.pop();
      b.push();
      b.translate(-hw + 0.05, HALL.h / 2, z);
      b.box(0.08, HALL.h - 0.2, 0.10, { seg: [1, 5, 1], uvScale: 3.0 });
      b.pop();
    }

    // A kick rail along the bottom of both walls.
    b.setColor(AO_MID);
    for (const sx of [-1, 1]) {
      b.push();
      b.translate(sx * (hw - 0.04), 0.14, midZ);
      b.box(0.07, 0.16, HALL.len - 1, { seg: [1, 1, 30], uvScale: 3.0 });
      b.pop();
    }

    return b.build(this.gl);
  }

  buildPipes() {
    const b = new Builder();
    const midZ = HALL.len / 2 - 2;
    b.setColor(AO_DARK);

    for (const [x, y, r] of [[-0.70, HALL.h - 0.15, 0.062],
                             [-0.52, HALL.h - 0.13, 0.038],
                             [0.74, HALL.h - 0.17, 0.050]]) {
      b.push();
      b.translate(x, y, midZ).rotateX(Math.PI / 2);
      b.cylinder(r, HALL.len, 7, { uvScale: 1.1, capped: false });
      b.pop();
    }

    // Collars, at irregular spacing so the run does not read as extruded.
    for (let z = 0.8; z < HALL.len - 3; z += 2.9) {
      b.push();
      b.translate(-0.70, HALL.h - 0.15, z).rotateX(Math.PI / 2);
      b.cylinder(0.082, 0.06, 7, { uvScale: 2.4 });
      b.pop();
    }

    // A conduit dropping down the right wall and running along the floor -
    // the wires the player ends up face to face with.
    for (const z of [7.4, 17.9]) {
      b.push();
      b.translate(HALL.w / 2 - 0.10, 1.2, z);
      b.cylinder(0.030, 2.2, 6, { uvScale: 2.0, capped: false });
      b.pop();
    }

    /* Cables torn out of the ceiling, hanging into the corridor with nothing
       on the end of them. The player walks straight past every one of these,
       close enough to touch, and the arcs at their ends are the only thing in
       the first thirteen seconds that makes any light of its own. */
    for (const [x, z, drop] of SEVERED) {
      const top = HALL.h - 0.05;
      b.push();
      b.translate(x, top - drop / 2, z);
      b.cylinder(0.014, drop, 5, { uvScale: 3.0, capped: false });
      b.pop();
      // A kink partway down, so it does not read as a rod.
      b.push();
      b.translate(x + 0.05, top - drop * 0.82, z + 0.02).rotateZ(0.5);
      b.cylinder(0.013, 0.22, 5, { uvScale: 3.0, capped: false });
      b.pop();
    }

    return b.build(this.gl);
  }

  buildProps() {
    const b = new Builder();
    const rng = SATG.util.makeRng(0xC0441D);

    // Crates and drums shoved against the walls at intervals.
    const clutter = [
      [-0.62, 0.22, 22.4, 0.44, 0.44, 0.42, 0.20],
      [0.66,  0.26, 18.1, 0.40, 0.52, 0.40, -0.30],
      [0.60,  0.20, 10.6, 0.46, 0.40, 0.44, 0.12],
      [-0.68, 0.30, 6.8,  0.38, 0.60, 0.38, -0.14],
      [-0.60, 0.62, 22.3, 0.32, 0.34, 0.30, 0.42]
    ];
    for (const [x, y, z, w, h, d, ry] of clutter) {
      b.setColor(rng.bool() ? AO_MID : AO_DARK);
      b.push();
      b.translate(x, y, z).rotateY(ry);
      b.box(w, h, d, { seg: [2, 2, 2], uvScale: 2.2 });
      b.pop();
    }

    // Fitting housings, live or dead.
    b.setColor(AO_DARK);
    for (const f of FITTINGS) {
      b.push();
      b.translate(0, HALL.h - 0.07, f.z);
      b.box(0.30, 0.10, 1.10, { seg: [1, 1, 3], uvScale: 3.0 });
      b.pop();
    }

    // A wall box with its cover hanging off, halfway down.
    b.setColor(AO_MID);
    b.push();
    b.translate(HALL.w / 2 - 0.09, 1.44, 14.2);
    b.box(0.16, 0.34, 0.26, { seg: [1, 2, 2], uvScale: 2.6 });
    b.pop();
    b.push();
    b.translate(HALL.w / 2 - 0.22, 1.28, 14.2).rotateZ(0.5);
    b.box(0.02, 0.30, 0.24, { uvScale: 2.6 });
    b.pop();

    return b.build(this.gl);
  }

  /* The doors: 957 at the end, the exit in the alcove, and a few dead ones
     passed on the way. */
  buildDoors() {
    const b = new Builder();

    b.setColor(AO_DARK);
    b.push();
    b.translate(DOOR.x, DOOR.y, DOOR.z);
    b.box(DOOR.w, DOOR.h, 0.10, { seg: [3, 6, 1], uvScale: 1.8, skip: ['nz'] });
    b.pop();

    b.setColor(AO_MID);
    for (const dx of [-0.54, 0.54]) {
      b.push();
      b.translate(DOOR.x + dx, DOOR.y, DOOR.z + 0.02);
      b.box(0.12, DOOR.h + 0.14, 0.12, { seg: [1, 6, 1], uvScale: 2.4 });
      b.pop();
    }
    b.push();
    b.translate(DOOR.x, DOOR.y + DOOR.h / 2 + 0.07, DOOR.z + 0.02);
    b.box(1.20, 0.12, 0.12, { uvScale: 2.4 });
    b.pop();

    // Handle, so it reads as a door rather than a panel.
    b.setColor(AO_MID);
    b.push();
    b.translate(DOOR.x + 0.34, DOOR.y - 0.05, DOOR.z + 0.09);
    b.box(0.06, 0.05, 0.14, { uvScale: 4.0 });
    b.pop();

    // The exit, standing slightly proud of the alcove's back wall.
    b.setColor(AO_DARK);
    b.push();
    b.translate(EXIT.x, EXIT.y, EXIT.z).rotateY(Math.PI / 2);
    b.box(EXIT.w, EXIT.h, 0.10, { seg: [3, 6, 1], uvScale: 1.8 });
    b.pop();

    // Its frame: two jambs and a head, so the gaps the light comes through
    // are gaps in something.
    b.setColor(AO_MID);
    for (const dz of [-1, 1]) {
      b.push();
      b.translate(EXIT.x + 0.04, EXIT.y, EXIT.z + dz * (EXIT.w / 2 + 0.07))
       .rotateY(Math.PI / 2);
      b.box(0.12, EXIT.h + 0.16, 0.12, { seg: [1, 6, 1], uvScale: 2.4 });
      b.pop();
    }
    b.push();
    b.translate(EXIT.x + 0.04, EXIT.y + EXIT.h / 2 + 0.08, EXIT.z).rotateY(Math.PI / 2);
    b.box(EXIT.w + 0.26, 0.12, 0.12, { uvScale: 2.4 });
    b.pop();

    // Dead doors passed on the way in, on alternating sides.
    for (const [z, sx] of [[19.2, 1], [11.8, -1], [4.6, 1]]) {
      b.setColor(AO_DARK);
      b.push();
      b.translate(sx * (HALL.w / 2 - 0.04), 1.02, z).rotateY(-sx * Math.PI / 2);
      b.box(0.90, 2.00, 0.08, { seg: [2, 5, 1], uvScale: 1.8 });
      b.pop();
    }

    return b.build(this.gl);
  }

  /* The tubes themselves - emissive quads under the live fittings. Drawn
     unlit, and dimmed per fitting by the flicker in update(). */
  buildTubes() {
    const b = new Builder();
    b.setColor(AO_LIT);
    for (const f of FITTINGS) {
      if (!f.live) continue;
      b.push();
      b.translate(0, HALL.h - 0.125, f.z).rotateX(Math.PI / 2);
      b.grid(0.22, 0.98, 2, 3, 1, 1);
      b.pop();
    }
    return b.build(this.gl);
  }

  /* The word EXIT, twice: an illuminated box above the door and a stencil on
     the door itself.

     It matters that this is legible. The four seconds the player spends
     looking at it are the only four seconds in the game where they are shown
     a way out, and the beat only lands if they can read what it is. */
  buildExitSign() {
    this.signTex = new SATG.gl.Texture(this.gl, {
      source: exitSignFace(), filter: this.gl.NEAREST, wrap: this.gl.CLAMP_TO_EDGE
    });
    this.stencilTex = new SATG.gl.Texture(this.gl, {
      source: numberPlate('EXIT'), filter: this.gl.NEAREST, wrap: this.gl.CLAMP_TO_EDGE
    });

    const b = new Builder();
    b.setColor(AO_LIT);
    // The lit box over the head of the door.
    b.push();
    b.translate(EXIT.x + 0.14, EXIT.y + EXIT.h / 2 + 0.26, EXIT.z).rotateY(Math.PI / 2);
    b.grid(0.52, 0.20, 2, 2, 1, 1);
    b.pop();
    return b.build(this.gl);
  }

  buildExitStencil() {
    const b = new Builder();
    b.setColor(AO_LIT);
    // On the door, at head height.
    b.push();
    b.translate(EXIT.x + 0.055, EXIT.y + 0.44, EXIT.z).rotateY(Math.PI / 2);
    b.grid(0.46, 0.23, 2, 2, 1, 1);
    b.pop();
    return b.build(this.gl);
  }

  buildPlate() {
    const b = new Builder();
    b.setColor(AO_LIT);
    b.push();
    b.translate(DOOR.x, DOOR.y + 0.60, DOOR.z + 0.055);
    b.grid(0.40, 0.20, 2, 2, 1, 1);
    b.pop();
    return b.build(this.gl);
  }

  /* Light escaping around the exit: four thin strips standing proud of the
     door, and the pool it throws on the alcove floor.

     Not one brightness. The gap under a door is the widest and leaks most;
     the jambs leak less; the head leaks least; and the floor is not a leak at
     all but light that has already landed, so it is the dimmest of the lot
     and falls off with distance. Drawn flat and equal, this read as a neon
     sign around a doorway rather than as a room with its light on behind it.

     The falloff is carried in the VERTEX COLOURS, which the shader multiplies
     into the emissive term - so all five pieces stay one mesh and one draw
     call, and no gradient texture has to exist. */
  buildExitGlow() {
    const b = new Builder();
    const x = EXIT.x + 0.055;          // just proud of the door's own face
    const hw = EXIT.w / 2, hh = EXIT.h / 2;

    const GAP  = [1.00, 1.00, 1.00];
    const JAMB = [0.62, 0.62, 0.62];
    const HEAD = [0.44, 0.44, 0.44];
    const POOL = [0.30, 0.30, 0.30];
    const NONE = [0.0, 0.0, 0.0];

    // Under the door - the widest gap, so the strongest bleed.
    b.setColor(GAP);
    b.push();
    b.translate(x, EXIT.y - hh + 0.025, EXIT.z).rotateY(Math.PI / 2);
    b.grid(EXIT.w * 0.94, 0.05, 3, 1, 1, 1);
    b.pop();

    b.setColor(JAMB);
    for (const dz of [-1, 1]) {
      b.push();
      b.translate(x, EXIT.y, EXIT.z + dz * hw * 0.96).rotateY(Math.PI / 2);
      b.grid(0.022, EXIT.h * 0.94, 1, 4, 1, 1);
      b.pop();
    }

    b.setColor(HEAD);
    b.push();
    b.translate(x, EXIT.y + hh - 0.01, EXIT.z).rotateY(Math.PI / 2);
    b.grid(EXIT.w * 0.94, 0.018, 3, 1, 1, 1);
    b.pop();

    /* The pool. Bright against the threshold and gone within half a metre -
       a hard-edged slab of light on the floor was the single most artificial
       thing in the sequence. Corner tints run bright at tx = 0, which after
       the rotation is the edge nearest the door. */
    b.push();
    b.translate(EXIT.x + 0.34, 0.006, EXIT.z).rotateX(-Math.PI / 2);
    b.grid(0.56, EXIT.w * 0.92, 6, 3, 1, 1, [POOL, NONE, NONE, POOL]);
    b.pop();

    return b.build(this.gl);
  }

  /* ==================================================================== */
  /* Per-frame                                                             */
  /* ==================================================================== */

  update(dt, walkerZ) {
    this.time += dt;
    this.sparks.update(dt);

    /* Each surviving tube fails in its own way and on its own clock. One
       shared flicker curve across all three would read as the mains browning
       out, which is a different and much less lonely idea. */
    for (let i = 0; i < this.liveZ.length; i++) {
      const t = this.time * (1.7 + i * 0.9) + i * 13.7;
      const slow = noise1(t * 0.6) * 0.26;
      /* A dropout, not a blackout. Cutting these to near nothing looked right
         in isolation and made the corridor unreadable for a third of every
         second - a fitting that is failing is still a fitting that is on. */
      const stutter = noise1(t * 9.0) > (0.74 + i * 0.05) ? 0.52 : 0;
      this.tubeLevel(i, clamp(1 - slow - stutter, 0.16, 1.2));
      this.lights[i].intensity = 0.75 + this.tubeLevel(i) * 1.85;
    }

    // The exit's light is steady. It is the only thing here that is.
    this.lights[3].intensity = 1.05 + Math.sin(this.time * 0.7) * 0.06;

    /* The carry-light follows the walker so the floor underfoot is never
       flat black, which at this fog density it otherwise would be between
       fittings. Faint enough to read as bounced light, not a torch. */
    if (walkerZ !== undefined) this.lights[4].position[2] = walkerZ;
  }

  tubeLevel(i, set) {
    if (!this._levels) this._levels = [1, 1, 1];
    if (set !== undefined) this._levels[i] = set;
    return this._levels[i];
  }

  /* ==================================================================== */
  /* Draw                                                                  */
  /* ==================================================================== */

  render(pipeline) {
    const T = this.tex;
    const I = this.identity;

    /* This is a long space and the point of it is the distance still to walk,
       so it wants less fog and a touch more ambient than the exam room, which
       is a box the size of a cell and wants neither. Both scenes state what
       they need every frame rather than assuming what the last one left
       behind - there are two of them now, and "whatever was set last" is how
       that becomes a bug nobody can reproduce. */
    /* The ambient is doing real work here and is not a cheat. Light in a
       corridor of rusted plate bounces off the walls onto the floor, and this
       renderer has no bounce - lighting is one term per lamp, evaluated per
       vertex, and stops dead where the falloff ends. Without a floor of
       ambient, everything more than three metres from a fitting is literally
       black, and the fittings are seven metres apart. Tinted to the walls it
       is supposed to have come off. */
    pipeline.ambient = [0.075, 0.052, 0.038];
    pipeline.fogDensity = 0.090;
    pipeline.fogColor = [0.020, 0.014, 0.012];

    /* Five fixed lights plus, at most, one arc. Six of the shader's eight. */
    this._rig = this._rig || [];
    this._rig.length = 0;
    for (const l of this.lights) this._rig.push(l);
    this.sparks.lights(this._rig);

    pipeline.setLights(this._rig);
    pipeline.beginWorld();

    /* Rust-shifted, all of it. The floor especially: poured concrete tinted
       neutral came out as grey lino under a warm lamp, which is the one thing
       this corridor cannot look like. Pulling the red up and the blue down in
       the tint means the oxide already in the texture is what the light finds
       first, and the floor reads as iron-stained rather than swept. */
    pipeline.drawMesh(this.meshes.floor, I, { map: T.concrete, tint: [0.96, 0.70, 0.54] });
    pipeline.drawMesh(this.meshes.walls, I, { map: T.steel,    tint: [0.92, 0.76, 0.66] });
    pipeline.drawMesh(this.meshes.pipes, I, { map: T.iron,     tint: [0.90, 0.78, 0.70] });
    pipeline.drawMesh(this.meshes.props, I, { map: T.plastic,  tint: [0.90, 0.78, 0.70] });
    pipeline.drawMesh(this.meshes.doors, I, { map: T.steel,    tint: [0.86, 0.68, 0.58] });

    /* Tubes: unlit, and driven by the same flicker as the lights they stand
       in. No map - a dead phosphor texture was making them read as small
       green monitors bolted to the ceiling. */
    const lv = (this._levels && this._levels[1]) || 1;
    pipeline.drawMesh(this.meshes.tubes, I, {
      map: null, tint: [1.0, 0.94, 0.82],
      emissive: [lv * 1.0, lv * 0.94, lv * 0.82], jitter: 0.15
    });

    pipeline.drawMesh(this.meshes.plate, I, {
      map: this.plateTex, tint: [1, 1, 1], emissive: [0.28, 0.27, 0.24], jitter: 0.2
    });

    // EXIT: the lit box above the door, and the stencil on the door itself.
    pipeline.drawMesh(this.meshes.exitSign, I, {
      map: this.signTex, tint: [1, 1, 1], emissive: [0.95, 0.95, 0.95], jitter: 0.2
    });
    pipeline.drawMesh(this.meshes.exitStencil, I, {
      map: this.stencilTex, tint: [1, 1, 1], emissive: [0.34, 0.32, 0.28], jitter: 0.2
    });

    // The light under the exit. Warm, steady, and out of reach.
    pipeline.drawMesh(this.meshes.exitGlow, I, {
      map: null, tint: [1.0, 0.90, 0.66],
      emissive: [1.0, 0.90, 0.66], jitter: 0.15
    });

    this.sparks.render(pipeline);
  }
}

SATG.Corridor = Corridor;
/* Shared with the exam room, which puts the same plate on the door the player
   is thrown through - it is meant to be recognised from the inside. */
SATG.numberPlate = numberPlate;
SATG.CORRIDOR_CONST = { HALL, START_Z, END_Z, EXIT, DOOR, ALCOVE };

})(window);
