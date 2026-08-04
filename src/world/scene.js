/* =========================================================================
   world/scene.js - the examination room.

   Assembled from the brief's references: the lighting and framing of the
   first (a single hot lamp over a table, everything beyond it falling to
   black), the workbench of the second and third, and the enclosed
   industrial corridor-room of the fourth.

   Geometry is built once at boot into a handful of meshes grouped by
   material, so the whole room draws in about a dozen calls. Large surfaces
   are subdivided because lighting is per-vertex - an undivided floor would
   have four lit points and the lamp would cast no pool at all.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;
const { Builder } = SATG.geom;
const { mat4, vec3 } = SATG;
const { clamp, lerp, smoothstep, noise1, TAU } = SATG.util;

/* Room extents, in metres. Deliberately tight. */
const ROOM = { w: 3.3, h: 2.55, d: 4.6 };

/* Table. Top surface height matches a real desk so the seated framing reads
   correctly when the camera pitches down onto it. */
const TABLE = { w: 1.75, d: 1.30, top: 0.755, thick: 0.055, cz: -0.72 };

/* Where the two interactables sit. */
const PAPER_POS = { x: -0.20, y: TABLE.top + 0.002, z: -0.66, w: 0.30, d: 0.42, rot: 0.06 };
const CALC_POS  = { x: 0.47,  y: TABLE.top + 0.001, z: -0.63, w: 0.17, d: 0.30, rot: -0.14 };

/* Seated eye position and the resting look angle. */
const EYE = { x: 0, y: 1.235, z: 0.30 };
const REST_PITCH = -0.40;

/* The room's own atmosphere. These are the pipeline's shipped defaults, named
   and restated here because the corridor sets its own and something has to
   put them back. */
const ROOM_ATMOS = {
  ambient: [0.014, 0.012, 0.011],
  fogDensity: 0.165,
  fogColor: [0.016, 0.011, 0.009]
};

/* Cables ripped out of the ceiling and left hanging: [x, z, drop]. Placed off
   to the sides and behind the desk so they frame the room without ever
   getting between the player and the sheet they are trying to read. */
const SEVERED = [
  [-1.28, -0.35, 1.02],
  [1.24, 0.42, 0.86],
  [-0.95, 1.35, 1.24],
  [1.40, -1.55, 0.72]
];

/* Baked ambient occlusion, applied as vertex tint. */
const AO_DARK = [0.34, 0.32, 0.31];
const AO_MID  = [0.62, 0.60, 0.58];
const AO_LIT  = [1.0, 1.0, 1.0];

class Scene {
  constructor(gl, textures) {
    this.gl = gl;
    this.tex = textures;
    this.time = 0;

    this.meshes = {};
    this.build();

    /* Lights. Few, tight, and warm, with one sickly green accent from a
       terminal in the corner - never an evenly lit room. */
    /* Intensities are tuned against measured output, not guessed: at these
       values the tabletop peaks around 0.45 luminance while roughly a tenth
       of the frame stays at true black. Lower and the room is unreadable;
       higher and the pool of light stops being a pool. */
    this.lampBase = 1.90;
    this.lights = [
      { position: vec3.create(0, 1.98, TABLE.cz),      color: [1.00, 0.52, 0.24], intensity: 1.90, range: 3.4 },
      { position: vec3.create(0, 0.52, TABLE.cz),      color: [0.85, 0.42, 0.24], intensity: 0.26, range: 1.4 },
      { position: vec3.create(1.32, 1.02, -2.05),      color: [0.32, 1.00, 0.48], intensity: 0.48, range: 1.7 },
      { position: vec3.create(-0.10, 1.72, -ROOM.d / 2 + 0.25), color: [1.00, 0.16, 0.12], intensity: 0.50, range: 2.3 },
      { position: vec3.create(-1.35, 1.55, 1.10),      color: [0.90, 0.46, 0.22], intensity: 0.24, range: 1.7 }
    ];

    // Scratch matrices reused every frame.
    this._m = mat4.create();
    this._pos = vec3.create();
    this._rot = vec3.create();
    this._scl = vec3.create(1, 1, 1);

    this.identity = mat4.create();

    this.showPaper = true;
    this.showCalc = true;

    /* The machine across the front of the room. Present in every run, whatever
       the player has switched off - see world/machine.js. It contributes its
       own lights, so the rig handed to the pipeline is rebuilt each frame
       rather than being the fixed array above. */
    this.machine = new SATG.Machine(gl, textures);
    this._lightRig = [];

    /* An arc at the end of every severed cable. The positions are derived
       from SEVERED rather than restated, so a cable and its spark cannot
       drift apart when one of them is moved. */
    this.sparks = new SATG.SparkSet(gl, SEVERED.map(([x, z, len]) => ({
      x: x + 0.05, y: ROOM.h - 0.10 - len, z: z + 0.03, size: 0.13
    })));

    /* The explosion, as geometry standing where the machine stands. Idle and
       costing nothing until something triggers it. */
    this.fireball = new SATG.Fireball(gl);

    /* How far the desk has been thrown, 0..1. The table, the sheet and the
       calculator all ride the same transform, because they go over together. */
    this.tableFlip = 0;
    this._flipM = mat4.create();
    this._flipA = mat4.create();
    this._flipB = mat4.create();
  }

  /* ==================================================================== */
  /* Construction                                                          */
  /* ==================================================================== */

  build() {
    this.meshes.concrete = this.buildConcrete();
    this.meshes.steel    = this.buildSteel();
    this.meshes.wood     = this.buildTable();
    this.meshes.iron     = this.buildIron();
    this.meshes.plastic  = this.buildProps();
    this.meshes.crt      = this.buildScreens();
    this.meshes.cable    = this.buildCables();
    this.meshes.paper    = this.buildPaperQuad();
    this.meshes.calc     = this.buildCalcBody();
    this.meshes.plate    = this.buildDoorPlate();
  }

  /* The number on the door behind the seat. The same plate the corridor hangs
     on the outside of it, so the room the player is put into is identifiably
     the room they were walked to. */
  buildDoorPlate() {
    this.plateTexture = new SATG.gl.Texture(this.gl, {
      source: SATG.numberPlate('957'), filter: this.gl.NEAREST,
      wrap: this.gl.CLAMP_TO_EDGE
    });
    const b = new Builder();
    b.setColor(AO_LIT);
    b.push();
    b.translate(0, 1.63, ROOM.d / 2 - 0.105).rotateY(Math.PI);
    b.grid(0.40, 0.20, 2, 2, 1, 1);
    b.pop();
    return b.build(this.gl);
  }

  /* Floor and ceiling. Heavily subdivided so the lamp reads as a pool. */
  buildConcrete() {
    const b = new Builder();
    const hw = ROOM.w / 2, hd = ROOM.d / 2;

    // Floor
    b.push();
    b.setColor(AO_MID);
    /* Densely subdivided. Lighting is per vertex, so the lamp's pool on the
       floor is literally made of these vertices - too few and the light does
       not fall off, it just tilts. */
    b.translate(0, 0, 0).rotateX(-Math.PI / 2);
    b.grid(ROOM.w, ROOM.d, 20, 26, ROOM.w * 1.6, ROOM.d * 1.6);
    b.pop();

    // Ceiling
    b.push();
    b.setColor(AO_DARK);
    b.translate(0, ROOM.h, 0).rotateX(Math.PI / 2);
    b.grid(ROOM.w, ROOM.d, 16, 20, ROOM.w * 1.4, ROOM.d * 1.4);
    b.pop();

    return b.build(this.gl);
  }

  /* Walls, the door, and the wall panelling. */
  buildSteel() {
    const b = new Builder();
    const hw = ROOM.w / 2, hd = ROOM.d / 2;
    b.setColor(AO_MID);

    const wall = (tx, tz, ry, w) => {
      b.push();
      b.translate(tx, ROOM.h / 2, tz).rotateY(ry);
      b.grid(w, ROOM.h, Math.max(10, Math.round(w * 5)), 14, w * 1.5, ROOM.h * 1.5,
             [AO_DARK, AO_DARK, AO_MID, AO_MID]);
      b.pop();
    };

    wall(0, -hd, 0, ROOM.w);              // far wall, faces +Z
    wall(0, hd, Math.PI, ROOM.w);         // wall behind the player
    wall(-hw, 0, Math.PI / 2, ROOM.d);    // left
    wall(hw, 0, -Math.PI / 2, ROOM.d);    // right

    // A recessed door on the far wall - shut, and clearly not an option.
    b.push();
    b.setColor(AO_DARK);
    b.translate(0.62, 1.02, -hd + 0.045);
    b.box(0.86, 2.0, 0.09, { seg: [3, 6, 1], uvScale: 1.6, skip: ['nz'] });
    b.pop();

    // Door frame
    b.push();
    b.setColor(AO_MID);
    for (const [dx, dw] of [[-0.50, 0.10], [0.50, 0.10]]) {
      b.push();
      b.translate(0.62 + dx * 1.02, 1.02, -hd + 0.10);
      b.box(dw, 2.12, 0.10, { uvScale: 2.2 });
      b.pop();
    }
    b.push();
    b.translate(0.62, 2.08, -hd + 0.10);
    b.box(1.10, 0.10, 0.10, { uvScale: 2.2 });
    b.pop();
    b.pop();

    /* The door the player came through, directly behind the seat, with its
       number still on it. It is shut, and it is the only other way out of
       this room - which is why the opening spends four seconds on the one in
       the corridor that is not this. */
    b.setColor(AO_DARK);
    b.push();
    b.translate(0, 1.03, hd - 0.05);
    b.box(0.96, 2.06, 0.10, { seg: [3, 6, 1], uvScale: 1.8, skip: ['pz'] });
    b.pop();

    b.setColor(AO_MID);
    for (const dx of [-0.54, 0.54]) {
      b.push();
      b.translate(dx, 1.03, hd - 0.08);
      b.box(0.12, 2.20, 0.12, { seg: [1, 6, 1], uvScale: 2.4 });
      b.pop();
    }
    b.push();
    b.translate(0, 2.13, hd - 0.08);
    b.box(1.20, 0.12, 0.12, { uvScale: 2.4 });
    b.pop();

    // Wall plating either side of it, to break the flat surface.
    b.setColor(AO_DARK);
    for (const x of [-1.15, 1.15]) {
      b.push();
      b.translate(x, 1.55, hd - 0.05);
      b.box(0.70, 0.62, 0.06, { seg: [2, 2, 1], uvScale: 2.0, skip: ['pz'] });
      b.pop();
    }

    // Side shelf plate
    b.push();
    b.setColor(AO_MID);
    b.translate(hw - 0.22, 0.92, -2.05);
    b.box(0.42, 0.05, 1.10, { seg: [2, 1, 3], uvScale: 2.4 });
    b.pop();

    return b.build(this.gl);
  }

  /* The examination table. Heavy, worn, and empty. */
  buildTable() {
    const b = new Builder();

    // Top
    b.setColor(AO_LIT);
    b.push();
    b.translate(0, TABLE.top - TABLE.thick / 2, TABLE.cz);
    b.box(TABLE.w, TABLE.thick, TABLE.d, { seg: [14, 1, 11], uvScale: 1.9 });
    b.pop();

    // Apron rail under the top
    b.setColor(AO_MID);
    for (const [x, z, w, d] of [
      [0, TABLE.cz - TABLE.d / 2 + 0.05, TABLE.w - 0.12, 0.06],
      [0, TABLE.cz + TABLE.d / 2 - 0.05, TABLE.w - 0.12, 0.06],
      [-TABLE.w / 2 + 0.05, TABLE.cz, 0.06, TABLE.d - 0.12],
      [TABLE.w / 2 - 0.05, TABLE.cz, 0.06, TABLE.d - 0.12]
    ]) {
      b.push();
      b.translate(x, TABLE.top - 0.135, z);
      b.box(w, 0.10, d, { seg: [4, 1, 2], uvScale: 2.2 });
      b.pop();
    }

    // Legs
    b.setColor(AO_DARK);
    const lx = TABLE.w / 2 - 0.09, lz = TABLE.d / 2 - 0.09;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      b.push();
      b.translate(sx * lx, (TABLE.top - 0.06) / 2, TABLE.cz + sz * lz);
      b.box(0.075, TABLE.top - 0.06, 0.075, { seg: [1, 4, 1], uvScale: 3.0 });
      b.pop();
    }

    return b.build(this.gl);
  }

  /* Chair, restraint bar, lamp housing, pipework, shelf brackets. */
  buildIron() {
    const b = new Builder();

    /* ---- the seat the player is locked into. Mostly out of frame, but the
       restraint bar crosses the lower edge of the view and is the reason the
       player never stands up. */
    b.setColor(AO_DARK);
    b.push();
    b.translate(0, 0.44, 0.62);
    b.box(0.52, 0.06, 0.46, { seg: [3, 1, 3], uvScale: 2.6 });
    b.pop();

    b.push();
    b.translate(0, 0.72, 0.86);
    b.box(0.52, 0.60, 0.06, { seg: [3, 3, 1], uvScale: 2.6 });
    b.pop();

    for (const sx of [-1, 1]) {
      b.push();
      b.translate(sx * 0.22, 0.21, 0.62);
      b.box(0.05, 0.42, 0.05, { seg: [1, 2, 1], uvScale: 3.0 });
      b.pop();
    }

    // Restraint bar across the lap - the thing that makes this a trap.
    b.setColor(AO_MID);
    b.push();
    b.translate(0, 0.84, 0.30);
    b.box(0.62, 0.055, 0.055, { seg: [5, 1, 1], uvScale: 3.4 });
    b.pop();
    for (const sx of [-1, 1]) {
      b.push();
      b.translate(sx * 0.30, 0.68, 0.44);
      b.rotateX(0.5);
      b.box(0.05, 0.36, 0.05, { uvScale: 3.0 });
      b.pop();
    }

    /* ---- lamp over the table: a shallow cone shade on a stem. */
    b.setColor(AO_MID);
    b.push();
    b.translate(0, ROOM.h - 0.02, TABLE.cz);
    b.box(0.10, 0.06, 0.10, { uvScale: 3.0 });
    b.pop();

    b.push();
    b.translate(0, ROOM.h - 0.20, TABLE.cz);
    b.cylinder(0.018, 0.34, 6, { uvScale: 3.0 });
    b.pop();

    b.push();
    b.setColor(AO_LIT);
    b.translate(0, ROOM.h - 0.45, TABLE.cz);
    // Wider at the bottom: a shade, seen from below by the player.
    b.cylinder(0.30, 0.20, 8, { radiusTop: 0.10, uvScale: 2.0, capped: true });
    b.pop();

    /* ---- pipe run along the ceiling, the industrial signature. */
    b.setColor(AO_DARK);
    for (const [x, r] of [[-1.12, 0.055], [-0.94, 0.035]]) {
      b.push();
      b.translate(x, ROOM.h - 0.14, 0);
      b.rotateX(Math.PI / 2);
      b.cylinder(r, ROOM.d, 7, { uvScale: 1.2, capped: false });
      b.pop();
    }
    // Pipe collars
    for (let z = -1.7; z <= 1.7; z += 1.15) {
      b.push();
      b.translate(-1.12, ROOM.h - 0.14, z);
      b.rotateX(Math.PI / 2);
      b.cylinder(0.072, 0.06, 7, { uvScale: 2.4 });
      b.pop();
    }

    /* ---- shelf brackets on the right wall. */
    b.setColor(AO_DARK);
    for (const z of [-2.4, -1.7]) {
      b.push();
      b.translate(ROOM.w / 2 - 0.22, 0.80, z);
      b.box(0.36, 0.05, 0.05, { uvScale: 3.0 });
      b.pop();
    }

    /* ---- a wall box with conduit, left side. */
    b.setColor(AO_MID);
    b.push();
    b.translate(-ROOM.w / 2 + 0.10, 1.42, -1.30);
    b.box(0.14, 0.34, 0.26, { seg: [1, 2, 2], uvScale: 2.6 });
    b.pop();

    return b.build(this.gl);
  }

  /* Crates, boxes, a stack of forms - the room's clutter. */
  buildProps() {
    const b = new Builder();
    const rng = SATG.util.makeRng(0xC0FFEE);

    b.setColor(AO_MID);

    // Crates stacked in the far corner.
    const crates = [
      [-1.10, 0.22, -1.95, 0.44, 0.44, 0.40, 0.18],
      [-1.05, 0.62, -1.90, 0.36, 0.36, 0.34, -0.10],
      [-1.22, 0.20, -2.45, 0.40, 0.40, 0.38, -0.32]
    ];
    for (const [x, y, z, w, h, d, ry] of crates) {
      b.push();
      b.setColor(rng.bool() ? AO_MID : AO_DARK);
      b.translate(x, y, z).rotateY(ry);
      b.box(w, h, d, { seg: [2, 2, 2], uvScale: 2.2 });
      b.pop();
    }

    // A shallow tray of blank forms on the right shelf.
    b.setColor(AO_DARK);
    b.push();
    b.translate(ROOM.w / 2 - 0.24, 0.96, -2.05);
    b.box(0.26, 0.05, 0.34, { uvScale: 2.6 });
    b.pop();

    // The terminal chassis in the corner (its screen is a separate mesh).
    b.setColor(AO_MID);
    b.push();
    b.translate(1.30, 0.94, -2.10);
    b.rotateY(-0.55);
    b.box(0.40, 0.34, 0.34, { seg: [2, 2, 2], uvScale: 2.4 });
    b.pop();

    // Its pedestal.
    b.setColor(AO_DARK);
    b.push();
    b.translate(1.30, 0.38, -2.10);
    b.rotateY(-0.55);
    b.box(0.34, 0.76, 0.30, { seg: [2, 3, 2], uvScale: 2.4 });
    b.pop();

    // A second, dead monitor on the left.
    b.setColor(AO_DARK);
    b.push();
    b.translate(-1.28, 1.06, -2.30);
    b.rotateY(0.42);
    b.box(0.34, 0.30, 0.30, { seg: [2, 2, 2], uvScale: 2.4 });
    b.pop();

    return b.build(this.gl);
  }

  /* Emissive screens. Drawn unlit with an emissive tint. */
  buildScreens() {
    const b = new Builder();
    b.setColor(AO_LIT);

    // Live terminal, corner right.
    b.push();
    b.translate(1.30, 0.98, -2.10);
    b.rotateY(-0.55);
    b.translate(0, 0, 0.175);
    b.grid(0.30, 0.24, 3, 3, 3, 3);
    b.pop();

    // Dead monitor, left - same mesh, tinted almost to nothing at draw time.
    b.push();
    b.translate(-1.28, 1.08, -2.30);
    b.rotateY(0.42);
    b.translate(0, 0, 0.155);
    b.grid(0.26, 0.20, 2, 2, 3, 3);
    b.pop();

    return b.build(this.gl);
  }

  /* Slack cabling. Sagging runs read as hand-placed rather than modelled. */
  buildCables() {
    const b = new Builder();
    b.setColor(AO_DARK);

    const run = (x0, y0, z0, x1, y1, z1, sag, segs, r) => {
      const steps = segs || 7;
      for (let i = 0; i < steps; i++) {
        const t0 = i / steps, t1 = (i + 1) / steps;
        const p0 = catenary(t0), p1 = catenary(t1);
        const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
        const len = Math.hypot(dx, dy, dz) || 0.001;

        b.push();
        b.translate((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2);
        b.rotateY(Math.atan2(dx, dz));
        b.rotateX(Math.PI / 2 - Math.asin(clamp(dy / len, -1, 1)));
        b.cylinder(r || 0.012, len, 5, { uvScale: 4, capped: false });
        b.pop();
      }
      function catenary(t) {
        return [
          lerp(x0, x1, t),
          lerp(y0, y1, t) - Math.sin(t * Math.PI) * sag,
          lerp(z0, z1, t)
        ];
      }
    };

    run(-1.05, ROOM.h - 0.20, -2.30, -1.05, ROOM.h - 0.20, -0.30, 0.20, 7);
    run(1.30, ROOM.h - 0.12, -2.10, 1.30, 1.16, -2.10, 0.10, 5, 0.010);
    run(-1.55, ROOM.h - 0.24, 1.10, -0.40, ROOM.h - 0.30, 1.60, 0.26, 8);
    run(0, ROOM.h - 0.06, TABLE.cz, -1.05, ROOM.h - 0.20, TABLE.cz, 0.08, 5, 0.009);

    /* Along the floor at the foot of the left-hand wall. This is what the
       player lands facing at the end of the opening - the first thing they
       ever see in this room is its wiring, from the floor. Laid with almost
       no sag, because these are pinned to the skirting rather than hung. */
    run(-1.58, 0.035, 1.90, -1.58, 0.035, -2.10, 0.012, 10, 0.016);
    run(-1.52, 0.030, 1.40, -1.52, 0.030, -1.80, 0.010, 9, 0.011);
    // One that breaks off and runs under the table toward the machine.
    run(-1.52, 0.030, -0.40, -0.60, 0.028, -1.40, 0.015, 6, 0.010);

    /* Cables torn out of the ceiling and left hanging, ending in nothing.
       Straight drops rather than catenaries - these are not runs going
       anywhere, they are the severed halves of ones that were, and the ends
       are where the sparks live. See SPARKS below. */
    for (const [x, z, len] of SEVERED) {
      const top = ROOM.h - 0.10;
      run(x, top, z, x + 0.05, top - len, z + 0.03, 0.02, 5, 0.013);
      // A little slack where it comes out of the ceiling.
      run(x - 0.24, top - 0.04, z, x, top, z, 0.09, 4, 0.011);
    }

    return b.build(this.gl);
  }

  /* The sheet lying on the table. A single quad with its own texture. */
  buildPaperQuad() {
    const b = new Builder();
    b.setColor(AO_LIT);
    b.push();
    b.translate(PAPER_POS.x, PAPER_POS.y, PAPER_POS.z);
    b.rotateY(PAPER_POS.rot);
    b.rotateX(-Math.PI / 2);
    b.grid(PAPER_POS.w, PAPER_POS.d, 3, 4, 1, 1);
    b.pop();
    return b.build(this.gl);
  }

  /* The calculator sitting beside it. */
  buildCalcBody() {
    const b = new Builder();
    b.setColor(AO_MID);
    b.push();
    b.translate(CALC_POS.x, CALC_POS.y + 0.012, CALC_POS.z);
    b.rotateY(CALC_POS.rot);
    b.box(CALC_POS.w, 0.024, CALC_POS.d, { seg: [2, 1, 3], uvScale: 6 });
    // A dark inset for the screen so it is identifiable at a glance.
    b.setColor(AO_DARK);
    b.translate(0, 0.014, -CALC_POS.d * 0.26);
    b.rotateX(-Math.PI / 2);
    b.grid(CALC_POS.w * 0.74, CALC_POS.d * 0.30, 2, 2, 1, 1);
    b.pop();
    return b.build(this.gl);
  }

  /* ==================================================================== */
  /* Per-frame                                                             */
  /* ==================================================================== */

  update(dt, panic) {
    this.time += dt;

    /* The lamp is on failing wiring. Two noise bands - a slow sag and an
       occasional hard dropout - keep it from reading as a sine wave. */
    const slow = noise1(this.time * 0.7) * 0.16;
    const fast = noise1(this.time * 11.0) * 0.06;
    const dropout = noise1(this.time * 2.3) > 0.93 ? 0.45 : 0;
    let flicker = 1 - slow - fast - dropout;

    // Under pressure the room's own lighting starts to fail with the player.
    if (panic > 0) {
      const stutter = noise1(this.time * (18 + panic * 26)) > (0.72 - panic * 0.25) ? 1 : 0;
      flicker *= 1 - panic * 0.35 * stutter;
    }

    this.lights[0].intensity = this.lampBase * clamp(flicker, 0.25, 1.2);
    this.lights[1].intensity = 0.26 * clamp(flicker, 0.2, 1.2);

    // The green terminal breathes very slightly.
    this.lights[2].intensity = 0.48 + Math.sin(this.time * 1.7) * 0.06;

    // The far red lamp pulses, faster as time runs out.
    const pulse = 0.5 + 0.5 * Math.sin(this.time * (1.6 + panic * 5.0));
    this.lights[3].intensity = 0.26 + pulse * (0.36 + panic * 0.90);

    /* The machine winds up with the clock. Its own bed and its wheel follow
       this same number in game.js, so what is heard and what is seen are
       driven from one place and cannot drift apart. */
    this.machine.intensity = panic;
    this.machine.update(dt);
    this.sparks.update(dt);
    this.fireball.update(dt);
  }

  /* The rig actually handed to the pipeline: the room's five fixed lights
     plus whatever the machine is contributing this frame. Rebuilt rather than
     mutated, because the machine's contribution comes and goes. */
  lightRig() {
    const rig = this._lightRig;
    rig.length = 0;
    /* The fireball goes FIRST, and the room's own lamps after it. The shader
       takes the first eight and drops the rest, and while the room is
       exploding the explosion is the light source that matters - being
       silently discarded because the wall sconces got there first is exactly
       the kind of bug that shows up as "the fire doesn't light anything". */
    this.fireball.lights(rig);
    for (const l of this.lights) rig.push(l);
    this.machine.lights(rig);
    this.sparks.lights(rig);
    return rig;
  }

  /* The desk going over. Rotated about its own front edge - the edge nearest
     the player - so it lifts INTO the frame and hinges away, which is what a
     table does when something hits it from the far side.

     Built as translate(pivot) * rotate * translate(-pivot) because the table
     mesh has its world position baked into its vertices; rotating it about
     the origin would swing it through the far wall. */
  tableTransform() {
    if (this.tableFlip <= 0.0001) return this.identity;
    const k = clamp(this.tableFlip, 0, 1);
    const px = 0, py = TABLE.top, pz = TABLE.cz + TABLE.d / 2;

    const m = mat4.fromTranslation(this._flipM, px, py + k * 0.55, pz);
    mat4.multiply(m, m, mat4.fromXRotation(this._flipA, -k * 1.45));
    mat4.multiply(m, m, mat4.fromZRotation(this._flipB, k * 0.30));
    mat4.multiply(m, m, mat4.fromTranslation(this._flipA, -px, -py, -pz));
    return m;
  }

  /**
   * Drive the camera. `intro` runs 0 -> 1 across the opening; at 0 the player
   * is slumped with their head down over the table, at 1 they are upright in
   * the seat at the resting angle.
   */
  applyCamera(camera, intro, lookYaw, lookPitch) {
    const t = smoothstep(clamp(intro, 0, 1));

    // Head lifts and the gaze comes up off the tabletop.
    const y = lerp(EYE.y - 0.20, EYE.y, t);
    const z = lerp(EYE.z + 0.10, EYE.z, t);
    const pitch = lerp(-1.16, REST_PITCH, t);

    // A slow, shallow breath so the frame is never perfectly still.
    const breathe = Math.sin(this.time * 0.9) * 0.004 * t;
    const sway = noise1(this.time * 0.35) * 0.006 * t;

    vec3.set(camera.position, EYE.x + sway, y + breathe, z);
    camera.pitch = clamp(pitch + (lookPitch || 0) * t, -1.32, 0.35);
    camera.yaw = (lookYaw || 0) * t;
    camera.roll = lerp(0.06, 0, t);
    return camera;
  }

  /* --------------------------------------------------------------- draw */

  render(pipeline) {
    const T = this.tex;
    const I = this.identity;

    /* Restated every frame rather than set once at boot: the corridor is a
       second world with its own atmosphere, and after the opening has run,
       "whatever the last scene left behind" would be its numbers, not these. */
    pipeline.ambient = ROOM_ATMOS.ambient;
    pipeline.fogDensity = ROOM_ATMOS.fogDensity;
    pipeline.fogColor = ROOM_ATMOS.fogColor;

    pipeline.setLights(this.lightRig());
    pipeline.beginWorld();

    /* Rust-shifted, the floor most of all. The lamp overhead is already warm,
       but a neutral tint under it averaged out to grey and the floor read as
       swept concrete in an office. Weighting the tint toward the oxide lets
       the rust already in the texture take the light first. */
    pipeline.drawMesh(this.meshes.concrete, I, { map: T.concrete, tint: [0.96, 0.74, 0.60] });
    pipeline.drawMesh(this.meshes.steel,    I, { map: T.steel,    tint: [0.94, 0.80, 0.70] });
    pipeline.drawMesh(this.meshes.iron,     I, { map: T.iron,     tint: [0.92, 0.82, 0.74] });
    pipeline.drawMesh(this.meshes.plastic,  I, { map: T.plastic,  tint: [0.90, 0.82, 0.76] });
    pipeline.drawMesh(this.meshes.cable,    I, { map: T.cable,    tint: [0.82, 0.74, 0.70] });

    /* The terminals now run the same code the machine's own panels do. They
       were always meant to be part of it; until there was a machine, there
       was nothing for them to be part of. */
    pipeline.drawMesh(this.meshes.crt, I, {
      map: this.machine.code.texture, tint: [0.75, 1.0, 0.85],
      emissive: [0.85, 0.85, 0.85], jitter: 0.4
    });

    // The number on the door behind the seat.
    pipeline.drawMesh(this.meshes.plate, I, {
      map: this.plateTexture, tint: [1, 1, 1], emissive: [0.26, 0.25, 0.22], jitter: 0.2
    });

    this.machine.render(pipeline);
    this.sparks.render(pipeline);

    /* The desk and everything on it share one transform, so when it goes over
       the sheet and the calculator go with it rather than hanging in the air
       where the tabletop used to be. */
    const X = this.tableTransform();
    pipeline.drawMesh(this.meshes.wood, X, { map: T.wood, tint: [1.0, 0.94, 0.88] });

    if (this.showCalc) {
      pipeline.drawMesh(this.meshes.calc, X, { map: T.plastic, tint: [0.80, 0.80, 0.82] });
    }
    if (this.showPaper) {
      // Slightly reduced jitter: a twitching sheet of paper looks like an
      // error rather than an effect, and the player needs to find it.
      pipeline.drawMesh(this.meshes.paper, X, {
        map: this.paperTexture || T.paper, tint: [1, 1, 1], jitter: 0.35, affine: 0.6
      });
    }

    /* Last in the world pass, so it is depth-tested against everything the
       room has already put down. Until it is bigger than the desk, the desk
       is in front of it - which is the whole reason for doing this in 3D. */
    this.fireball.render(pipeline);
  }

  /* ------------------------------------------------------------ picking
     Ray/AABB against the two interactables. Both lie flat on the table, so
     slab boxes are exact enough and far cheaper than triangle picking. */

  pick(ray) {
    if (!ray) return null;
    const origin = ray.origin;
    const dir = ray.dir;

    const targets = [];
    if (this.showPaper) {
      targets.push({
        name: 'paper',
        min: [PAPER_POS.x - PAPER_POS.w * 0.62, PAPER_POS.y - 0.02, PAPER_POS.z - PAPER_POS.d * 0.62],
        max: [PAPER_POS.x + PAPER_POS.w * 0.62, PAPER_POS.y + 0.05, PAPER_POS.z + PAPER_POS.d * 0.62]
      });
    }
    if (this.showCalc) {
      targets.push({
        name: 'calculator',
        min: [CALC_POS.x - CALC_POS.w * 0.72, CALC_POS.y - 0.02, CALC_POS.z - CALC_POS.d * 0.62],
        max: [CALC_POS.x + CALC_POS.w * 0.72, CALC_POS.y + 0.08, CALC_POS.z + CALC_POS.d * 0.62]
      });
    }

    let best = null, bestT = Infinity;
    for (const t of targets) {
      const hit = rayAabb(origin, dir, t.min, t.max);
      if (hit !== null && hit < bestT && hit < 3.0) { bestT = hit; best = t.name; }
    }
    return best;
  }
}

/* Slab method. Returns the near intersection distance, or null. */
function rayAabb(o, d, min, max) {
  let tmin = -Infinity, tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) {
      if (o[i] < min[i] || o[i] > max[i]) return null;
      continue;
    }
    const inv = 1 / d[i];
    let t1 = (min[i] - o[i]) * inv;
    let t2 = (max[i] - o[i]) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return tmin >= 0 ? tmin : (tmax >= 0 ? tmax : null);
}

SATG.Scene = Scene;
SATG.SCENE_CONST = { ROOM, TABLE, PAPER_POS, CALC_POS, EYE, REST_PITCH };

})(window);
