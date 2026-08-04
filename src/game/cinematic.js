/* =========================================================================
   game/cinematic.js - the opening, and the moment the machine answers.

   Two directors in one file because they share a stage. Both drive the camera
   and the overlays directly and neither knows anything about the exam; the
   game asks them to run and asks them whether they are finished.

   ---- the opening ----

   A single timeline, in seconds:

      0.0 - 13.0   walking the corridor
     13.0 - 17.0   the head turns left; the exit, and its light
     17.0 - 17.6   shoved - through the door of 957, still looking left
     17.6 - 18.9   on the floor of the room, looking at the wall and the wires
     18.9 - 21.6   black, and one line of text
     21.6 - 28.6   the machine assembling itself, close
     28.6 - 32.4   pulling back to the seat

   Nothing here is load-bearing for the exam: R skips the whole thing, and
   with ANIMATIONS off it is never built in the first place. What matters is
   that both of those routes leave the world in exactly the state the long
   route leaves it in - the machine assembled, armed, and waiting.

   ---- the verdict ----

   Answering in Infinity puts the sheet down, because the player has to be
   looking at the machine when it decides. It scans, and then either the tick
   lights and the run continues, or it fires: half a second of flame, the
   table going over, and black.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;
const { clamp, lerp, smoothstep, noise1 } = SATG.util;
const { vec3 } = SATG;

const DISPLAY = SATG.MACHINE_DISPLAY;
const C = SATG.CORRIDOR_CONST;

/* Beat boundaries, named so the update below reads as the timeline above
   rather than as a wall of numbers. */
const T = {
  WALK_END:   13.0,
  LOOK_END:   17.0,
  /* Three tenths of a second, end to end. The shove is not a move the player
     watches happening - it is over before they have registered it started,
     which is the difference between being pushed and being shown a push. */
  SHOVE_END:  17.30,
  FLOOR_END:  18.40,
  BLACK_END:  21.10,
  BUILD_END:  28.10,
  PULL_END:   31.90
};

/* Where the seated player ends up. Read from the scene rather than restated,
   so moving the chair moves the end of the cutscene with it. */
const EYE = SATG.SCENE_CONST.EYE;
const REST_PITCH = SATG.SCENE_CONST.REST_PITCH;

const LINE = 'THIS DETERMINES MY FUTURE';

/* The three things worth looking at while the machine is being set up. The
   player cycles them with the arrow keys or a click; the cutscene runs on
   regardless, so this is a camera the player is lent, not a pause. */
const VIEWS = ['machine', 'calculator', 'door'];

/* =========================================================================
   Opening
   ========================================================================= */

class Opening {
  constructor(game) {
    this.game = game;
    this.corridor = null;         // built on first use, not at boot
    this.t = 0;
    this.done = true;
    this.view = 0;
    this._stepAt = 0;
    this._nextAmbient = 0;
    this._firedCrash = false;
    this._firedFall = false;
    this._clankAt = 0;
    this._blipAt = 0;
  }

  /* The corridor is thirty metres of geometry that a player who never turns
     animations on will never see. Building it on demand keeps it out of the
     boot path entirely. */
  ensureCorridor() {
    if (!this.corridor) {
      this.corridor = new SATG.Corridor(this.game.gl, this.game.textures);
    }
    return this.corridor;
  }

  start() {
    this.ensureCorridor();
    this.t = 0;
    this.done = false;
    this.view = 0;
    this._stepAt = 0;
    this._nextAmbient = 1.2;
    this._firedCrash = false;
    this._firedShove = false;
    this._firedFall = false;
    this._clankAt = 0;
    this._blipAt = 0;

    const M = this.game.scene.machine;
    M.assembly = 0;
    M.intensity = 0;
    M.setDisplay(DISPLAY.DEAD);

    SATG.audio.startAmbience();
  }

  /* Which world the frame should be drawn in. The cut happens at the crash,
     under a white flash, which is the only place a scene swap can hide. */
  get inCorridor() { return this.t < T.SHOVE_END; }

  /* True once the timeline has left the corridor for good, so the game can
     drop the exam-room ambience in at the right moment. */
  get inRoom() { return this.t >= T.SHOVE_END; }

  cycleView(dir) {
    if (this.t < T.BLACK_END) return false;
    this.view = (this.view + dir + VIEWS.length) % VIEWS.length;
    SATG.audio.click(1300);
    return true;
  }

  setView(i) {
    if (this.t < T.BLACK_END || i < 0 || i >= VIEWS.length) return false;
    if (this.view === i) return false;
    this.view = i;
    SATG.audio.click(1300);
    return true;
  }

  /* Put the world in the state the timeline would have left it in, without
     playing any of it. Both R and the ANIMATIONS toggle come through here, so
     there is exactly one definition of "afterwards". */
  finish() {
    this.done = true;
    const M = this.game.scene.machine;
    M.assembly = 1;
    M.setDisplay(DISPLAY.ARMED);
    SATG.audio.stopTension(true);
  }

  update(dt) {
    if (this.done) return;
    this.t += dt;

    const cam = this.game.pipeline.camera;
    const M = this.game.scene.machine;
    const t = this.t;

    if (t < T.SHOVE_END) this.updateCorridor(dt, cam);
    else if (t < T.FLOOR_END) this.updateFloor(cam);
    else if (t < T.BLACK_END) this.updateBlack(cam);
    else if (t < T.BUILD_END) this.updateBuild(dt, cam, M);
    else if (t < T.PULL_END) this.updatePullBack(cam, M);
    else { this.finish(); return; }

    if (this.corridor && t < T.SHOVE_END) {
      this.corridor.update(dt, cam.position[2]);
    }
  }

  /* ---- 0.0 .. 17.6: the corridor */

  updateCorridor(dt, cam) {
    const t = this.t;

    /* Walking. Eased at both ends so the player is not teleported into motion
       and does not stop dead at the junction - the arrival should feel like
       being brought somewhere, which is most of the dread. */
    const walk = clamp(t / T.WALK_END, 0, 1);
    const eased = smoothstep(clamp(walk * 1.12, 0, 1));
    const z = t < T.WALK_END
      ? lerp(C.START_Z, C.END_Z, eased)
      : C.END_Z;

    /* Head bob. Two components at a 2:1 ratio - the vertical rise and fall of
       each step, and the slower side-to-side of the hips - which is what
       stops a bob reading as a bounce. It stops when the walking stops. */
    const moving = t < T.WALK_END;
    const pace = 2.05;                     // steps per second
    const phase = t * pace * Math.PI;
    const bobAmt = moving ? 1 : Math.max(0, 1 - (t - T.WALK_END) * 3);
    const bobY = Math.sin(phase * 2) * 0.026 * bobAmt;
    const bobX = Math.sin(phase) * 0.030 * bobAmt;
    const bobRoll = Math.sin(phase) * 0.020 * bobAmt;

    // A footstep on each downbeat, taken from the same phase that moves the
    // camera, so the sound is on the frame the foot actually lands.
    if (moving) {
      const step = Math.floor(t * pace * 2);
      if (step !== this._stepAt) {
        this._stepAt = step;
        SATG.audio.footstep(0.75 + Math.random() * 0.25);
      }
    }

    // The building, elsewhere. Sparse and irregular - a steady rhythm of
    // creaks would be a soundtrack rather than a place.
    if (t > this._nextAmbient) {
      const r = Math.random();
      if (r < 0.42) SATG.audio.pipeGroan();
      else if (r < 0.74) SATG.audio.drip();
      else SATG.audio.distantClank();
      this._nextAmbient = t + 1.6 + Math.random() * 2.8;
    }

    /* The head turns left onto the exit and stays there. It is still turned
       when the shove lands, which is the whole point of the beat - the player
       is looking at the way out when they are put through the other door. */
    const turn = clamp((t - T.WALK_END) / 1.1, 0, 1);
    const turned = smoothstep(turn);
    const yaw = turned * (Math.PI / 2);

    let x = bobX;
    let y = 1.62 + bobY;
    /* The head comes down as it comes round. The exit is two metres away and
       its door is only a metre from the eyeline, so at the walking pitch the
       widest gap - the one under the door, which is the whole reason the beat
       exists - falls below the bottom of the frame. */
    let pitch = -0.05 + noise1(t * 0.5) * 0.03 - turned * 0.24;
    let roll = bobRoll;
    let outZ = z;
    // How far the head is dragged back toward forward by the shove.
    let yawPull = 0;

    /* The shove. A hard shear forward with the head still left, the camera
       dropping and rolling as the feet come out from under it. Nothing about
       this is smooth: everything is on a squared curve so it is at its most
       violent immediately. */
    if (t >= T.LOOK_END) {
      const k = clamp((t - T.LOOK_END) / (T.SHOVE_END - T.LOOK_END), 0, 1);
      /* Cubed. Squared was already violent and still read as an acceleration
         - something building up to throwing them. This is at full speed on
         the first frame and covers the whole metre and a half before the eye
         has caught up, which is what a shove from behind actually is. */
      const punch = k * k * k;
      outZ = lerp(C.END_Z, C.DOOR.z - 0.55, punch);
      y = lerp(1.62, 0.92, punch) + bobY;
      roll += punch * 0.86;
      pitch -= punch * 0.52;
      /* The head is dragged back toward forward as the body is driven through
         - but only part of the way. They are still looking at the exit when
         they go through the other door, which is the entire point of the
         beat. */
      yawPull = punch * 0.55;
      x += (noise1(t * 140) - 0.5) * punch * 0.22;

      if (!this._firedShove) {
        this._firedShove = true;
        SATG.audio.shoveWhoosh();
      }
      if (!this._firedCrash && k > 0.30) {
        this._firedCrash = true;
        SATG.audio.crashThrough();
      }
    }

    vec3.set(cam.position, x, y, outZ);
    cam.yaw = yaw - yawPull;
    cam.pitch = pitch;
    cam.roll = roll;
  }

  /* ---- 17.6 .. 18.9: on the floor of the room, still looking left.

     The scene has already swapped. The camera is low, rolled hard over, and
     pointed at the left-hand wall and the cable run along the skirting - the
     first thing the player ever sees of this room is the part of it nobody
     was meant to look at. */
  updateFloor(cam) {
    const k = clamp((this.t - T.SHOVE_END) / (T.FLOOR_END - T.SHOVE_END), 0, 1);
    const settle = smoothstep(k);

    if (!this._firedFall) {
      this._firedFall = true;
      SATG.audio.bodyFall();
    }

    // Sliding to a stop on the floor, near the left wall.
    vec3.set(cam.position,
      lerp(-0.20, -0.62, settle),
      lerp(0.62, 0.22, settle),
      lerp(-0.30, 0.10, settle));
    cam.yaw = Math.PI / 2;
    cam.pitch = lerp(-0.28, -0.16, settle);
    // Still rolling over as the body settles, then holding there.
    cam.roll = lerp(0.42, 1.02, settle) + (1 - settle) * (noise1(this.t * 40) - 0.5) * 0.16;
  }

  /* ---- 18.9 .. 21.6: black, and the line. */

  updateBlack(cam) {
    // Held where the fall left it; nothing is visible through the fade.
    vec3.set(cam.position, -0.62, 0.22, 0.10);
    cam.yaw = Math.PI / 2;
    cam.pitch = -0.16;
    cam.roll = 1.02;
  }

  /* ---- 21.6 .. 28.6: the machine going up.

     Close on whatever the player has chosen to look at, while the parts land.
     The tension bed runs underneath and the machine's own bed comes in on top
     of it - the same two cues the last ten seconds of a run use, which is the
     point: the player is being taught what the sound means before it costs
     them anything. */
  updateBuild(dt, cam, M) {
    const k = clamp((this.t - T.BLACK_END) / (T.BUILD_END - T.BLACK_END), 0, 1);

    M.assembly = clamp(k * 1.45, 0, 1);

    if (M.display === DISPLAY.DEAD && k > 0.10) M.setDisplay(DISPLAY.BOOT);
    if (k > 0.88 && M.display === DISPLAY.BOOT) {
      M.setDisplay(DISPLAY.ARMED);
      SATG.audio.clank(1.0);
    }

    // Bolts landing, then the signs. Four beats, on the same schedule the
    // renderer moves the parts on.
    const beats = [0.16, 0.28, 0.40, 0.52, 0.72];
    if (this._clankAt < beats.length && k >= beats[this._clankAt]) {
      SATG.audio.clank(this._clankAt >= 4 ? 0.9 : 0.45 + this._clankAt * 0.1);
      this._clankAt++;
    }

    // The code chattering across the terminals.
    if (this.t > this._blipAt && k < 0.9) {
      SATG.audio.dataBlip();
      this._blipAt = this.t + 0.05 + Math.random() * 0.11;
    }

    if (!SATG.audio.tensionActive) SATG.audio.startTension();
    SATG.audio.setTensionIntensity(0.18 + k * 0.52);
    SATG.audio.startMachineBed();
    SATG.audio.setMachineIntensity(k * 0.55);

    const shake = (1 - k) * 0.004 + M.blast * 0.02;
    this.frameView(cam, this.view, 0, shake);
  }

  /* ---- 28.6 .. 32.4: back into the seat. */

  updatePullBack(cam, M) {
    const k = smoothstep(clamp((this.t - T.BUILD_END) / (T.PULL_END - T.BUILD_END), 0, 1));
    M.assembly = 1;

    SATG.audio.setTensionIntensity((1 - k) * 0.7);
    if (k > 0.92) SATG.audio.stopTension(false);
    SATG.audio.setMachineIntensity(0.55 * (1 - k) * 0.5);

    /* Interpolate from wherever the player left the camera to the seat, so
       switching the view during the build never strands the pull-back. */
    const from = this.viewPose(this.view, 0);
    vec3.set(cam.position,
      lerp(from.pos[0], EYE.x, k),
      lerp(from.pos[1], EYE.y, k),
      lerp(from.pos[2], EYE.z, k));
    cam.yaw = lerp(from.yaw, 0, k);
    cam.pitch = lerp(from.pitch, REST_PITCH, k);
    cam.roll = lerp(from.roll || 0, 0, k);
  }

  /* ---- the three framings */

  viewPose(i, t) {
    const drift = Math.sin(t * 0.5) * 0.012;
    switch (VIEWS[i]) {
      case 'calculator':
        // Close over the desk, looking down at the gadget by the player's hand.
        return { pos: [0.34, 1.06, -0.10], yaw: -0.16, pitch: -0.86 + drift, roll: 0 };
      case 'door':
        // Turned round, at the door they came through. It is shut.
        return { pos: [0, 1.30, -0.35], yaw: Math.PI, pitch: -0.06 + drift, roll: 0 };
      case 'machine':
      default: {
        /* Square onto the readout in the middle of the housing - the panel
           that ends this sequence by saying ARMED. Aimed at the screen's own
           centre rather than at the machine's, which sits a good half metre
           higher and put the one thing worth reading at the bottom edge of
           the frame while the player looked at an empty gantry. */
        /* Far enough back to see what the readout is set into. Pressed right
           up against the glass, the housing fills the frame edge to edge and
           the machine stops being a machine and becomes a brown wall with a
           screen in it. */
        const S = SATG.MACHINE_CONST.SCREEN;
        const camZ = -0.24;
        const eyeY = S.y + 0.16;
        return {
          pos: [0, eyeY, camZ],
          yaw: 0,
          pitch: Math.atan2(S.y - eyeY, Math.abs(S.z - camZ)) + drift,
          roll: 0
        };
      }
    }
  }

  frameView(cam, i, t, shake) {
    const p = this.viewPose(i, this.t);
    const sx = shake ? (noise1(this.t * 53) - 0.5) * shake * 2 : 0;
    const sy = shake ? (noise1(this.t * 61 + 7) - 0.5) * shake * 2 : 0;
    vec3.set(cam.position, p.pos[0] + sx, p.pos[1] + sy, p.pos[2]);
    cam.yaw = p.yaw;
    cam.pitch = p.pitch;
    cam.roll = p.roll || 0;
  }

  /* ---- what the pipeline should be showing */

  /* Fade level for the frame, 1 visible and 0 black. Owned here rather than
     by the game's own fader because every one of these fades is part of the
     timeline and would otherwise need a callback chain to sequence. */
  fade() {
    const t = this.t;
    if (t < 1.2) return smoothstep(t / 1.2);                       // fade up on the walk
    if (t < T.SHOVE_END) return 1;
    if (t < T.FLOOR_END) return 1;
    if (t < T.FLOOR_END + 0.7) return 1 - (t - T.FLOOR_END) / 0.7; // out, on the floor
    if (t < T.BLACK_END - 0.4) return 0;
    if (t < T.BLACK_END) return 0;
    if (t < T.BLACK_END + 1.0) return (t - T.BLACK_END) / 1.0;     // up, onto the machine
    return 1;
  }

  /* A white slam at the instant the door gives way. It covers the scene swap,
     and it is the only frame in the game that is brighter than the lamp. */
  flash() {
    /* On the frame the door goes. Short and total - it is a blink, not a
       transition, and it is the only thing hiding the fact that the entire
       world is swapped underneath it. */
    const d = this.t - (T.LOOK_END + 0.14);
    if (d < 0 || d > 0.22) return 0;
    return Math.pow(1 - d / 0.22, 1.1);
  }

  /* The line, and how strongly it is showing. */
  caption() {
    const t = this.t;
    if (t < T.FLOOR_END + 0.8 || t > T.BLACK_END) return null;
    const k = (t - (T.FLOOR_END + 0.8)) / (T.BLACK_END - (T.FLOOR_END + 0.8));
    // In over the first fifth, hold, out over the last quarter.
    const a = k < 0.20 ? k / 0.20 : k > 0.76 ? (1 - k) / 0.24 : 1;
    return { text: LINE, alpha: clamp(a, 0, 1) };
  }

  /* Whether the player can be told about the controls yet. */
  get canSwitchView() { return this.t >= T.BLACK_END && this.t < T.PULL_END; }
  get viewName() { return VIEWS[this.view]; }

  /* ---- overlays

     Two surfaces, because the caption fades on its own curve and the hint
     does not - one canvas carrying both would have to be repainted every
     frame of the fade to animate one of them. Each is repainted only when the
     STRING on it changes; the fade is done by tinting the quad. */

  layer(gl, which, w, h, scale) {
    const key = '_layer_' + which;
    if (!this[key]) this[key] = new SATG.screens.ScreenCanvas(gl, w, h);
    const L = this[key];
    if (L.resize(w, h, scale)) L._text = null;
    return L;
  }

  renderOverlays(pipeline) {
    const gl = this.game.gl;
    const W = pipeline.compRT.width, H = pipeline.compRT.height;
    const s = pipeline.uiScale;

    /* The door giving way. Drawn first so the text, if any, sits over it -
       though in practice the two never overlap. */
    const fl = this.flash();
    if (fl > 0) pipeline.fillRect({ x: 0, y: 0, w: 1, h: 1 }, [fl, fl, fl, fl]);

    const cap = this.caption();
    if (cap) {
      const L = this.layer(gl, 'caption', W, H, s);
      if (L._text !== cap.text) {
        L._text = cap.text;
        L.clear();
        const F = SATG.font;
        const avail = Math.round(L.W * 0.84);
        const fit = F.fitLines(cap.text, avail, 3 * s, 3 * s, 2, s);
        let y = Math.round(L.H / 2 - (fit.lines.length * F.lineHeight(fit.scale)) / 2);
        for (const ln of fit.lines) {
          F.draw(L.ctx, ln, L.W / 2, y,
                 { color: '#d9d2c4', scale: fit.scale, tracking: 3 * s, align: 'center' });
          y += F.lineHeight(fit.scale);
        }
        L.upload();
      }
      const a = cap.alpha;
      // Premultiplied: one number scales the ink and the coverage together.
      pipeline.drawOverlay(L.texture, { x: 0, y: 0, w: 1, h: 1 },
                           { color: [a, a, a, a] });
    }

    /* What the player can do while this runs. Always says how to leave -
       thirty seconds is a long time to sit through twice, and a skip nobody
       is told about is a skip nobody uses. */
    const hint = this.canSwitchView
      ? 'R - SKIP    ARROWS - LOOK AROUND    ' + this.viewName.toUpperCase()
      : this.t > 1.5 ? 'R - SKIP' : '';

    if (hint) {
      const L = this.layer(gl, 'hint', W, H, s);
      if (L._text !== hint) {
        L._text = hint;
        L.clear();
        const F = SATG.font;
        const avail = Math.round(L.W * 0.9);
        const sc = F.fitScale(hint, avail, 2 * s, s, s);
        F.draw(L.ctx, hint, L.W / 2, L.H - 46 * s,
               { color: '#4f4a42', scale: sc, tracking: s, align: 'center' });
        L.upload();
      }
      pipeline.drawOverlay(L.texture, { x: 0, y: 0, w: 1, h: 1 },
                           { color: [0.8, 0.8, 0.8, 0.8] });
    }
  }
}

/* =========================================================================
   Verdict - the machine answering, and the machine firing
   ========================================================================= */

/* Phases. `hold` is the pause the brief asks for in Infinity and explicitly
   does NOT want on a module test, so the module path simply never enters it. */
const V = {
  IDLE:  'idle',
  SCAN:  'scan',    // reading the sheet
  RIGHT: 'right',   // the tick, and on to the next question
  DREAD: 'dread',   // five seconds of the machine deciding to kill you
  BLAST: 'blast',   // and then, with no warning at all, none of that
  DONE:  'done'
};

/* How long each phase runs. DREAD is the long one on purpose: the machine
   spends five seconds winding up, loudly, in full view, and the player can do
   nothing but watch it. BLAST is three tenths of a second, because the whole
   point of the build is that what follows is too fast to take in - a blast
   that lasts as long as the dread would be a spectacle, and a spectacle is
   something you watch rather than something that happens to you. */
const V_TIME = { SCAN: 0.85, RIGHT: 0.60, DREAD: 5.0, BLAST: 0.32 };

/* The fireball reaches the far side of the room in a fifth of a second. */
const FILL = 0.20;

class Verdict {
  constructor(game) {
    this.game = game;
    this.phase = V.IDLE;
    this.t = 0;
    this.onFinish = null;
    this.fireSprites = null;
  }

  get active() { return this.phase !== V.IDLE && this.phase !== V.DONE; }
  get blasting() { return this.phase === V.BLAST; }

  /* Scan, then land on `correct`. `cb` is called once, when the whole thing
     is over and the game is free to move on.

     `opts.immediate` goes straight to the blast with no scan and no noise
     from the machine. That is how a full SAT ends: the brief gives a module
     test no pause between questions and no machine sound, so it does not get
     a countdown to its own ending either. */
  begin(correct, cb, opts) {
    this.correct = !!correct;
    this.onFinish = cb || null;
    this.t = 0;
    const M = this.game.scene.machine;

    if (opts && opts.immediate) {
      this.detonate();
      return;
    }

    this.phase = V.SCAN;
    M.setDisplay(DISPLAY.SCANNING);
    SATG.audio.scanSound();
  }

  /* The instant it goes. Separated out because three different routes reach
     it - the end of the dread, the end of a full SAT, and R pressed during
     the dread - and every one of them has to arrive at the same state. */
  detonate() {
    this.phase = V.BLAST;
    this.t = 0;
    this.game.scene.machine.detonate();
    this.game.scene.machine.dread = 0;
    // The fire itself is geometry in the room - see world/machine.js.
    this.game.scene.fireball.trigger();
    SATG.audio.stopTension(true);
    SATG.audio.stopMachineBed(true);
    SATG.audio.stopWheel();
    SATG.audio.explosion();
  }

  /* End it now, wherever it had got to, and run the callback. R comes through
     here, and so does the ANIMATIONS toggle - which is why the callback is
     fired rather than skipped: the run has to continue either way. */
  skip() {
    if (!this.active) return false;
    /* Skipping the dread does not skip the consequence - it brings it
       forward. R is "get on with it", not "let me off". */
    if (this.phase === V.DREAD || this.phase === V.SCAN) {
      if (!this.correct) { this.detonate(); return true; }
    }
    this.game.scene.machine.dread = 0;
    this.phase = V.DONE;
    const cb = this.onFinish;
    this.onFinish = null;
    if (cb) cb();
    return true;
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const M = this.game.scene.machine;

    switch (this.phase) {
      case V.SCAN:
        if (this.t >= V_TIME.SCAN) {
          this.t = 0;
          if (this.correct) {
            this.phase = V.RIGHT;
            M.setDisplay(DISPLAY.RIGHT);
            M.flashTick();
            SATG.audio.ding();
          } else {
            this.phase = V.DREAD;
            M.setDisplay(DISPLAY.WRONG);
            M.flashCross();
            SATG.audio.startMachineBed();
            if (!SATG.audio.tensionActive) SATG.audio.startTension();
          }
        }
        break;

      case V.RIGHT:
        if (this.t >= V_TIME.RIGHT) this.finish();
        break;

      /* Five seconds of the machine getting ready, at full volume, with the
         wheel accelerating and nothing on screen that can be interacted with.
         Every one of these numbers climbs to 1 and then stops - the cue is
         the swell, and a swell that plateaus at the top would tell the player
         when the end was coming. It never does. */
      case V.DREAD: {
        const k = clamp(this.t / V_TIME.DREAD, 0, 1);
        M.dread = k;
        M.intensity = Math.max(M.intensity, k);
        SATG.audio.setTensionIntensity(0.25 + k * 0.75);
        SATG.audio.setMachineIntensity(k);
        if (this.t >= V_TIME.DREAD) this.detonate();
        break;
      }

      case V.BLAST:
        /* Three tenths of a second, and the last tenth of that is already
           black. It has to be over before the player has finished flinching,
           or it stops being something that happened to them and starts being
           something they watched. */
        if (this.t >= V_TIME.BLAST) this.finish();
        break;
    }
  }

  finish() {
    this.phase = V.DONE;
    const cb = this.onFinish;
    this.onFinish = null;
    if (cb) cb();
  }

  /* ---- the blast, as seen from the chair */

  /* How far over the table has gone, 0..1. The game hands this to the scene,
     which applies it to the desk, the sheet and the calculator together. */
  tableFlip() {
    if (this.phase !== V.BLAST) return 0;
    /* Front-loaded, and deliberately not eased out. The desk is hit by a
       pressure wave, so it is already travelling by the time the first frame
       of it is drawn; a curve that accelerates would look like it decided to
       go over. */
    const k = clamp(this.t / (V_TIME.BLAST * 0.8), 0, 1);
    return 1 - (1 - k) * (1 - k);
  }

  /* The player going over with the chair.

     Returned as an offset the caller adds to the seated pose rather than as a
     pose of its own, so whatever the player happened to be looking at when
     they answered is still where the blast catches them.

     The shape is a hit, not a shake: everything is on `punch`, which is
     squared so it is at its most violent in the first two frames and then
     merely finishing what it started. They are lifted, thrown back, and
     rolled onto their side, and the last of it is still moving when the
     screen goes black - a knockdown that comes to a neat stop reads as an
     animation rather than as something happening to you. */
  cameraKick(out) {
    out.x = out.y = out.z = out.roll = out.pitch = 0;
    if (this.phase !== V.BLAST) return out;

    const k = clamp(this.t / V_TIME.BLAST, 0, 1);
    const punch = 1 - (1 - k) * (1 - k);          // fast out, still going
    const jitter = (1 - k) * (1 - k);             // the concussion, dying away

    // Lifted off the seat, then taken down past where it was.
    out.y = Math.sin(clamp(k * 2.4, 0, Math.PI)) * 0.16 - punch * 0.62;
    // Thrown back and off the centre line.
    out.z = punch * 0.52;
    out.x = punch * 0.22 + (noise1(this.t * 90) - 0.5) * 0.13 * jitter;
    // Over onto one side. This is the part that reads as being knocked down.
    out.roll = punch * 1.24 + (noise1(this.t * 63 + 9) - 0.5) * 0.42 * jitter;
    // Chin up as they go backwards, so the last thing in frame is the ceiling.
    out.pitch = punch * 0.52 + (noise1(this.t * 77 + 5) - 0.5) * 0.24 * jitter;
    return out;
  }

  /* Fire sprites, built once and reused. Four blobs at different scales makes
     a believable ball; painting a new canvas every frame for half a second
     would cost thirty full-screen uploads to show something on screen for
     less time than it takes to read this comment. */
  sprites() {
    if (this.fireSprites) return this.fireSprites;
    const gl = this.game.gl;
    const out = [];
    for (let i = 0; i < 4; i++) {
      const size = 256;
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      const ctx = cv.getContext('2d');
      const rng = SATG.util.makeRng(0xF12E + i * 977);

      /* Lumps rather than a clean radial: a symmetrical gradient reads as a
         glow, and what this needs to read as is burning fuel. */
      for (let b = 0; b < 26; b++) {
        const a = rng.float(0, Math.PI * 2);
        const d = rng.float(0, size * 0.34);
        const x = size / 2 + Math.cos(a) * d;
        const y = size / 2 + Math.sin(a) * d;
        const r = rng.float(size * 0.10, size * 0.26);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        const hot = rng.float(0, 1);
        g.addColorStop(0, hot > 0.6 ? 'rgba(255,248,214,0.95)' : 'rgba(255,196,86,0.85)');
        g.addColorStop(0.45, 'rgba(255,122,32,0.42)');
        g.addColorStop(1, 'rgba(120,26,6,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      out.push(new SATG.gl.Texture(gl, {
        source: cv, filter: gl.LINEAR, wrap: gl.CLAMP_TO_EDGE
      }));
    }
    this.fireSprites = out;
    return out;
  }

  /* Draw the flame over everything else. Additive, so it lights the frame
     rather than covering it. */
  /* The fireball. It leaves the machine and reaches the player in a fifth of
     a second, and there is nothing behind it but black.

     Everything here is on `fill`, which runs 0 -> 1 over FILL seconds and
     then stays there. Past that the room is simply inside the explosion and
     the only thing left to do is take the picture away. */
  drawFire(pipeline) {
    if (this.phase !== V.BLAST) return;
    const t = this.t;
    const fill = clamp(t / FILL, 0, 1);
    const sp = this.sprites();

    /* The flash arrives before the fire does - the light of it crosses the
       room instantly and the front of it does not. Two frames, and no more:
       the fire itself is real geometry now, and a white sheet held over the
       top of it for a fifth of a second hides the very thing it is announcing. */
    const flash = Math.pow(1 - clamp(t / 0.05, 0, 1), 1.6) * 0.72;
    if (flash > 0.002) {
      pipeline.fillRect({ x: 0, y: 0, w: 1, h: 1 },
        [flash, flash * 0.93, flash * 0.80, flash]);
    }

    /* Embers, and only embers. The body of the fire is real geometry in the
       room now, so painting a second ball on top of it would double-image
       the whole effect - these are the few bright fragments thrown past the
       camera that the world pass has no way to represent, and they are
       deliberately small, off-centre, and quick. */
    for (let i = 1; i < sp.length; i++) {
      const lead = 0.05 + i * 0.06;
      const kk = clamp((fill - lead) / Math.max(1 - lead, 0.001), 0, 1);
      if (kk <= 0) continue;
      const size = lerp(0.10, 1.10, kk * kk);
      const a = Math.pow(1 - kk, 0.7) * 0.55;
      const swing = (i % 2 ? 1 : -1) * (0.16 + i * 0.07) * kk;
      const rise = (noise1(t * 20 + i * 9) - 0.5) * 0.22 * kk;
      pipeline.drawOverlay(sp[i], {
        x: 0.5 - size / 2 + swing,
        y: 0.46 - size / 2 + rise,
        w: size, h: size
      }, { additive: true, color: [a, a * 0.88, a * 0.72, 1] });
    }

    /* A white core over the top once it is on top of the camera. This is what
       makes it read as a detonation rather than as a large fire. */
    const core = clamp((fill - 0.72) / 0.28, 0, 1);
    if (core > 0) {
      pipeline.fillRect({ x: 0, y: 0, w: 1, h: 1 },
        [core * 0.92, core * 0.74, core * 0.46, core * 0.88]);
    }

    /* And out. Black by three tenths, from a screen that was pure white a
       tenth of a second earlier - the cut is the point. */
    const shut = clamp((t - FILL) / (V_TIME.BLAST - FILL), 0, 1);
    if (shut > 0) {
      pipeline.fillRect({ x: 0, y: 0, w: 1, h: 1 }, [0, 0, 0, shut]);
    }
  }
}

SATG.cinematic = { Opening, Verdict, VIEWS, OPENING_BEATS: T };

})(window);
