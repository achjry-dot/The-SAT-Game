/* =========================================================================
   game/game.js - state machine, timers, input, and frame orchestration.

   States
     title     the room drifts behind the title card
     intro     fade up from black as the player lifts their head off the desk
     exam      the loop: read, answer, submit, repeat
     lose      pitch black, YOU LOSE, RETRY / QUIT
     exiting   the session is over

   Within `exam` the player holds at most one object at a time:
     none      looking at the table
     paper     the exam sheet, filling the view
     calc      the calculator in the hand
     calcFull  the calculator expanded to the full-screen grapher

   Left click picks up; ESC sets down. From the expanded grapher, ESC steps
   back to the handheld before setting it down.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;
const { clamp, lerp, smoothstep } = SATG.util;
const QB = SATG.questionBank;

const SAVE_KEY = 'satgame.save.v1';

const HOLD = { NONE: 'none', PAPER: 'paper', CALC: 'calc', CALC_FULL: 'calcFull' };

class Game {
  constructor(pipeline, textures) {
    this.pipeline = pipeline;
    this.gl = pipeline.gl;
    this.textures = textures;

    this.scene = new SATG.Scene(this.gl, textures);
    this.paper = new SATG.Paper(this.gl);
    this.calculator = new SATG.Calculator(this.gl);

    this.title = new SATG.screens.TitleScreen(this.gl);
    this.lose = new SATG.screens.LoseScreen(this.gl);
    this.hud = new SATG.screens.Hud(this.gl);
    this.feedback = new SATG.screens.FeedbackScreen(this.gl);
    this.fader = new SATG.screens.Fader();

    this.bank = new QB.QuestionBank(SATG.util.rng);

    /* The sheet lying on the table shows the live question, not a placeholder.
       It is unreadable at 270p, which is the point - the player can see there
       is writing on it and has to pick it up to find out what it says. */
    this.scene.paperTexture = this.paper.texture;

    this.state = 'title';
    this.hold = HOLD.NONE;
    this.introT = 1;              // 1 = fully upright
    this.question = null;
    this.timeLeft = 0;
    this.timeLimit = 1;
    this.cleared = 0;
    this.best = 0;
    this.paused = false;
    this.transitioning = false;

    this.mouse = { u: 0.5, v: 0.5, down: false, dragging: false, lastX: 0, lastY: 0 };

    /* Held-sheet view. The paper is legible at 1.0, but a 150-word passage
       falls back to smaller type, so the player can always magnify. */
    this.paperZoom = 1;
    this.paperPan = { x: 0, y: 0 };
    this._paperDownAt = null;
    this._paperMoved = 0;
    this.hoverTarget = null;
    this.lookYaw = 0;
    this.lookPitch = 0;

    this.fader.snap(0);
    this.fader.to(1, 1.2);

    this.loadSave();
    this.title.setCanContinue(this.save && this.save.cleared > 0);
  }

  /* ==================================================================== */
  /* Save                                                                  */
  /* ==================================================================== */

  loadSave() {
    this.save = null;
    try {
      const raw = global.localStorage && global.localStorage.getItem(SAVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.cleared === 'number') this.save = parsed;
      }
    } catch (e) { /* private mode, quota, corrupt entry - all non-fatal */ }
    if (this.save) this.best = this.save.best || this.save.cleared || 0;
  }

  writeSave(data) {
    try {
      if (global.localStorage) global.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) { /* ignore */ }
  }

  clearSave() {
    try { if (global.localStorage) global.localStorage.removeItem(SAVE_KEY); } catch (e) {}
    this.save = null;
    this.title.setCanContinue(false);
  }

  /* ==================================================================== */
  /* Transitions                                                           */
  /* ==================================================================== */

  startRun(resume) {
    if (this.transitioning) return;
    this.transitioning = true;
    SATG.audio.init();
    SATG.audio.resume();

    this.fader.to(0, 0.9, () => {
      this.bank.reset();
      this.cleared = resume && this.save ? this.save.cleared : 0;
      if (resume && this.save) {
        this.bank.correctStreak = this.save.streak || 0;
        this.bank.served = this.save.cleared || 0;
      }
      this.best = Math.max(this.best, this.cleared);

      this.state = 'intro';
      this.introT = 0;
      this.hold = HOLD.NONE;
      this.scene.showPaper = true;
      this.scene.showCalc = true;
      this.lookYaw = this.lookPitch = 0;

      SATG.audio.startAmbience();
      this.nextQuestion(true);

      // Fade up slowly while the head comes off the desk.
      this.fader.to(1, 2.6, () => { this.transitioning = false; });
      SATG.audio.latch();
    });
  }

  nextQuestion(silent) {
    this.question = this.bank.next();
    this.timeLimit = this.question.timeLimit;
    this.timeLeft = this.timeLimit;
    this.paper.setQuestion(this.question);
    // Draw once here so the sheet on the table carries the new question even
    // though updateExam only refreshes it while it is being held.
    this.paper.render();
    this.panicStarted = false;
    SATG.audio.stopTension(true);
    if (!silent) SATG.audio.ding();
  }

  submit() {
    if (this.state !== 'exam' || !this.question) return;

    /* An answer cannot be given without the sheet in hand. This also keeps
       flagInvalid() from being raised while the paper is on the table, where
       nothing re-renders it - the flash would be swallowed silently now and
       then reappear, out of context, the next time the sheet was picked up. */
    if (this.hold !== HOLD.PAPER) return;

    if (!this.paper.hasResponse()) { this.paper.flagInvalid(); return; }

    const response = this.paper.currentResponse();
    const correct = this.bank.check(this.question, response);
    this.bank.recordResult(correct);

    if (correct) {
      this.cleared++;
      this.best = Math.max(this.best, this.cleared);
      this.writeSave({ cleared: this.cleared, streak: this.bank.correctStreak, best: this.best });
      this.title.setCanContinue(true);
      SATG.audio.ding();
      this.nextQuestion(true);
      // Answering returns the sheet to the table - the next question is a
      // new sheet, and the player has to pick it up again.
      this.setHold(HOLD.NONE, true);
    } else {
      this.die('wrong');
    }
  }

  die(reason) {
    if (this.state === 'lose') return;
    this.state = 'lose';
    this.hold = HOLD.NONE;

    SATG.audio.stopTension(true);
    SATG.audio.gunshot();
    SATG.audio.stopAmbience();

    /* Hard cut to black - no fade. The shot IS the transition, and it
       outranks whatever else was in progress: snap() drops any pending
       fade callback, so the flag guarding that fade has to be released
       here too. Leaving it set would mean toTitle() - which both RETRY and
       QUIT go through - returns early forever, stranding the player on the
       lose screen with no way out. Not currently reachable, because the
       opening transition finishes before the clock starts, but the cost of
       depending on that is a soft-lock and the cost of not depending on it
       is one line. */
    this.transitioning = false;
    this.fader.snap(0);
    this.fader.to(1, 0.55);

    this.lose.reset({
      reason: reason,
      cleared: this.cleared,
      best: this.best,
      answerText: this.question ? this.question.answerText : null
    });

    // A run that ended cannot be continued.
    this.clearSave();
    this.writeSave({ cleared: 0, streak: 0, best: this.best });
  }

  toTitle() {
    if (this.transitioning) return;
    this.transitioning = true;
    this.fader.to(0, 0.6, () => {
      this.state = 'title';
      this.hold = HOLD.NONE;
      this.question = null;
      this.introT = 1;
      SATG.audio.stopTension(true);
      SATG.audio.stopAmbience();
      this.title.setCanContinue(!!(this.save && this.save.cleared > 0));
      this.fader.to(1, 0.8, () => { this.transitioning = false; });
    });
  }

  doExit() {
    if (this.transitioning) return;
    this.transitioning = true;
    SATG.audio.stopTension(true);
    SATG.audio.stopAmbience();
    this.fader.to(0, 1.0, () => {
      this.state = 'exiting';
      this.transitioning = false;
      this.fader.to(1, 0.6);
    });
  }

  /* ==================================================================== */
  /* Holding                                                               */
  /* ==================================================================== */

  setHold(next, quiet) {
    if (this.hold === next) return;

    const wasHolding = this.hold !== HOLD.NONE;
    this.hold = next;

    // A fresh sheet is always presented un-zoomed.
    if (next !== HOLD.PAPER) this.resetPaperView();

    this.scene.showPaper = next !== HOLD.PAPER;
    this.scene.showCalc = next !== HOLD.CALC && next !== HOLD.CALC_FULL;
    this.calculator.setExpanded(next === HOLD.CALC_FULL);

    if (!quiet) {
      if (next === HOLD.PAPER) SATG.audio.paperRustle(false);
      else if (next === HOLD.NONE && wasHolding) SATG.audio.paperRustle(true);
      else if (next === HOLD.CALC) SATG.audio.calcKey();
      else if (next === HOLD.CALC_FULL) SATG.audio.beep(660, 0.09);
    }
  }

  /* ==================================================================== */
  /* Input                                                                 */
  /* ==================================================================== */

  onPointerMove(u, v, dx, dy) {
    const pu = this.mouse.u, pv = this.mouse.v;
    this.mouse.u = u;
    this.mouse.v = v;

    if (this.state === 'exam' && this.hold === HOLD.PAPER) {
      if (this.mouse.down) {
        this._paperMoved += Math.abs(u - pu) + Math.abs(v - pv);
        if (this.paperZoom > 1.01) {
          this.paperPan.x += u - pu;
          this.paperPan.y += v - pv;
          this.clampPaperPan();
        }
      }
      return;
    }

    if (this.state === 'exam' && this.hold === HOLD.CALC_FULL &&
        this.mouse.down && this.mouse.dragging) {
      /* Pan the graph. Scale by the fullscreen canvas so a drag moves the
         plot by the same number of graph pixels the cursor travelled.

         The denominator must be the canvas's CSS size, not pipeline.width:
         dx/dy come from clientX/clientY, which are CSS pixels and never
         scale with the display, whereas pipeline.width is now the device-
         pixel backing store. Dividing one by the other made the drag run at
         1/devicePixelRatio speed - half rate on a 200%-scaled screen. */
      const c = this.calculator;
      const cssW = this.pipeline.canvas.clientWidth || this.pipeline.width;
      const cssH = this.pipeline.canvas.clientHeight || this.pipeline.height;
      c.pan(dx * (c.fullCanvas.width / cssW),
            dy * (c.fullCanvas.height / cssH));
      return;
    }

    if (this.state === 'exam' && this.hold === HOLD.NONE) {
      // A shallow look offset, so the room breathes with the cursor without
      // ever letting the player turn away from the desk.
      this.lookYaw = (0.5 - u) * 0.30;
      this.lookPitch = (0.5 - v) * 0.22;
    }
  }

  onPointerDown(u, v) {
    SATG.audio.init();
    SATG.audio.resume();
    this.mouse.down = true;
    this.mouse.dragging = false;

    switch (this.state) {
      case 'title': {
        const i = this.title.hitTest(u, v);
        if (i !== null && this.title.setIndex(i)) SATG.audio.click();
        if (i !== null) this.activateTitle();
        return;
      }
      case 'lose': {
        const i = this.lose.hitTest(u, v);
        if (i !== null) { this.lose.setIndex(i); SATG.audio.click(); this.activateLose(); }
        return;
      }
      case 'feedback': {
        const h = this.feedback.hitTest(u, v);
        if (!h) return;
        if (h.key === 'back') { this.closeFeedback(); return; }
        if (h.key === 'send' && h.enabled) { SATG.audio.click(); this.feedback.send(this); }
        return;
      }
      case 'exam':
        this.examPointerDown(u, v);
        return;
      case 'exiting':
        this.toTitle();
        return;
    }
  }

  onPointerUp(u, v) {
    const wasDown = this.mouse.down;
    this.mouse.down = false;
    this.mouse.dragging = false;

    if (!wasDown || this.state !== 'exam' || this.hold !== HOLD.PAPER) {
      this._paperDownAt = null;
      return;
    }

    const down = this._paperDownAt;
    this._paperDownAt = null;
    // Anything past a few pixels of travel was a scroll, not a click.
    if (!down || this._paperMoved > 0.012) return;

    const local = rectToLocal(this.paperRect(), u === undefined ? down.u : u,
                                                v === undefined ? down.v : v);
    if (!local) return;
    const hit = this.paper.hitTest(local.u, local.v);
    if (!hit) return;

    if (hit.type === 'choice') {
      // Clicking a choice selects it; clicking the selected one commits.
      if (this.paper.selected === hit.index) this.submit();
      else { this.paper.select(hit.index); SATG.audio.click(1400); }
    } else if (hit.type === 'input') {
      this.paper.inputFocused = true;
      SATG.audio.click(1200);
    }
  }

  onWheel(delta) {
    if (this.state !== 'exam') return;
    if (this.hold === HOLD.CALC_FULL) {
      this.calculator.zoom(delta > 0 ? 0.88 : 1.136, this.mouse.u, this.mouse.v);
    } else if (this.hold === HOLD.PAPER) {
      this.zoomPaper(delta, this.mouse.u, this.mouse.v);
    }
  }

  examPointerDown(u, v) {
    if (this.hold === HOLD.NONE) {
      const ray = this.pipeline.camera.rayFromScreen(u, v);
      const hit = this.scene.pick(ray);
      if (hit === 'paper') this.setHold(HOLD.PAPER);
      else if (hit === 'calculator') this.setHold(HOLD.CALC);
      return;
    }

    if (this.hold === HOLD.PAPER) {
      /* Defer the action to pointer-up. While zoomed the sheet is dragged to
         scroll, and a drag that began on a choice must not also select it. */
      this._paperDownAt = { u, v };
      this._paperMoved = 0;
      this.mouse.dragging = true;
      return;
    }

    if (this.hold === HOLD.CALC) {
      const local = rectToLocal(this.calcRect(), u, v);
      if (!local) return;
      const hit = this.calculator.hitTestHand(local.u, local.v);
      if (hit && hit.type === 'key') {
        SATG.audio.calcKey();
        if (hit.label === 'GRAPH') this.setHold(HOLD.CALC_FULL);
        else this.calculator.key(hit.label);
      }
      return;
    }

    if (this.hold === HOLD.CALC_FULL) {
      const C = this.calculator;
      const hit = C.hitTestFull(u, v);
      if (!hit) return;

      switch (hit.kind) {
        case 'slot':
          C.setSlot(hit.slot);
          // Clicking the bar raises the keypad, as Desmos does.
          C.padOpen = true;
          SATG.audio.click(1500);
          return;
        case 'padToggle':
          C.padOpen = !C.padOpen;
          SATG.audio.beep(C.padOpen ? 720 : 520, 0.05);
          return;
        case 'padKey':
        case 'padAction':
          C.padPress(hit);
          SATG.audio.calcKey();
          return;
        case 'zoomIn':  C.zoomStep(true);  SATG.audio.click(1600); return;
        case 'zoomOut': C.zoomStep(false); SATG.audio.click(1300); return;
        case 'home':    C.resetView();     SATG.audio.beep(600, 0.06); return;
        case 'graph':
          // A click within reach of a point of interest pins its label;
          // otherwise the drag pans the view.
          if (C.clickPOI(u, v)) SATG.audio.beep(880, 0.05);
          else this.mouse.dragging = true;
          return;
      }
    }
  }

  onKeyDown(e) {
    const key = e.key;
    SATG.audio.init();
    SATG.audio.resume();

    if (this.state === 'title') {
      if (key === 'ArrowUp' || key === 'w' || key === 'W') { if (this.title.move(-1)) SATG.audio.click(); }
      else if (key === 'ArrowDown' || key === 's' || key === 'S') { if (this.title.move(1)) SATG.audio.click(); }
      else if (key === 'Enter' || key === ' ') this.activateTitle();
      return;
    }

    if (this.state === 'feedback') {
      if (key === 'Escape') { this.closeFeedback(); return; }
      if (key === 'Enter') {
        // Shift+Enter breaks the line; plain Enter sends, matching the way
        // Enter submits everywhere else in the game.
        if (e.shiftKey) { this.feedback.newline(); SATG.audio.click(1700); }
        else { this.feedback.send(this); SATG.audio.click(); }
        return;
      }
      if (key === 'Backspace') { e.preventDefault(); this.feedback.backspace(); return; }
      // Offered by name when a send fails, so there is always a way through.
      if ((key === 'm' || key === 'M') && this.feedback.status === 'failed') {
        this.feedback.mailFallback(this);
        return;
      }
      if (key.length === 1) { if (this.feedback.typeChar(key)) SATG.audio.click(1700); }
      return;
    }

    if (this.state === 'lose') {
      if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'w' || key === 's' ||
          key === 'W' || key === 'S') { this.lose.move(1); SATG.audio.click(); }
      else if (key === 'Enter' || key === ' ') this.activateLose();
      return;
    }

    if (this.state === 'exiting') {
      if (key === 'Enter' || key === 'Escape' || key === ' ') this.toTitle();
      return;
    }

    if (this.state !== 'exam') return;

    /* ---- Escape: step out of whatever is held. */
    if (key === 'Escape') {
      if (this.hold === HOLD.CALC_FULL) this.setHold(HOLD.CALC);
      else if (this.hold !== HOLD.NONE) this.setHold(HOLD.NONE);
      return;
    }

    if (key === 'Enter') {
      if (this.hold === HOLD.CALC_FULL) { this.calculator.submit(); return; }
      if (this.hold === HOLD.CALC) { this.calculator.submit(); SATG.audio.calcKey(); return; }
      // Enter with empty hands reaches for the sheet rather than doing nothing:
      // the hold resets after every correct answer, so this is the common case.
      if (this.hold !== HOLD.PAPER) { this.setHold(HOLD.PAPER); return; }
      this.submit();
      return;
    }

    if (key === 'Backspace') {
      e.preventDefault();
      if (this.hold === HOLD.PAPER) this.paper.backspace();
      else if (this.hold === HOLD.CALC || this.hold === HOLD.CALC_FULL) this.calculator.backspace();
      return;
    }

    /* ---- holding the paper */
    if (this.hold === HOLD.PAPER) {
      const q = this.question;
      if (q && q.format === 'mc') {
        const idx = 'abcd'.indexOf(key.toLowerCase());
        if (idx >= 0 && idx < q.choices.length) { this.paper.select(idx); SATG.audio.click(1400); return; }
        if (key === 'ArrowDown') { this.paper.select(clamp(this.paper.selected + 1, 0, q.choices.length - 1)); SATG.audio.click(); return; }
        if (key === 'ArrowUp')   { this.paper.select(clamp(this.paper.selected - 1, 0, q.choices.length - 1)); SATG.audio.click(); return; }
      } else if (q && key.length === 1) {
        if (this.paper.typeChar(key)) SATG.audio.click(1700);
        return;
      }
      return;
    }

    /* ---- holding the calculator, in either view */
    if (this.hold === HOLD.CALC || this.hold === HOLD.CALC_FULL) {
      // Home, not "r" - see the Tab note above; every letter is a variable.
      if (this.hold === HOLD.CALC_FULL && key === 'Home') {
        this.calculator.resetView();
        return;
      }
      /* Tab toggles the grapher, NOT "g". Every letter is a legal variable in
         an expression, so a letter shortcut can only ever fight with typing -
         pressing g to graph used to just insert the character instead. */
      if (key === 'Tab') {
        this.setHold(this.hold === HOLD.CALC ? HOLD.CALC_FULL : HOLD.CALC);
        return;
      }
      if (key.length === 1 && /[0-9a-zA-Z+\-*/^().]/.test(key)) {
        this.calculator.typeChar(key);
        SATG.audio.calcKey();
        return;
      }
      return;
    }

    /* ---- hands empty: keyboard shortcuts to pick things up */
    if (key === 'e' || key === 'E' || key === ' ') {
      const ray = this.pipeline.camera.rayFromScreen(this.mouse.u, this.mouse.v);
      const hit = this.scene.pick(ray);
      if (hit === 'paper') this.setHold(HOLD.PAPER);
      else if (hit === 'calculator') this.setHold(HOLD.CALC);
    } else if (key === 'q' || key === 'Q') {
      this.setHold(HOLD.PAPER);
    } else if (key === 'c' || key === 'C') {
      this.setHold(HOLD.CALC);
    }
  }

  activateTitle() {
    switch (this.title.selected) {
      case 'start': this.clearSave(); this.startRun(false); break;
      case 'feedback': this.openFeedback(); break;
      case 'exit': this.doExit(); break;
    }
  }

  /* The feedback screen is a plain state swap with no fade. It is a menu
     page, not a scene change, and making the player sit through a transition
     to reach a text box would be friction for nothing. */
  openFeedback() {
    SATG.audio.click();
    this.feedback.reset();
    this.state = 'feedback';
  }

  closeFeedback() {
    SATG.audio.click();
    this.state = 'title';
    this.title.dirty = true;
  }

  activateLose() {
    if (this.lose.selected === 'retry') this.startRun(false);
    else this.toTitle();
  }

  /* ==================================================================== */
  /* Update                                                                */
  /* ==================================================================== */

  update(dt) {
    this.fader.update(dt);
    this.pipeline.time += dt;

    const panic = this.state === 'exam' && this.question
      ? clamp(1 - this.timeLeft / QB.PANIC_SECONDS, 0, 1)
      : 0;

    this.scene.update(dt, panic);

    switch (this.state) {
      case 'title':
        this.title.update(dt);
        // A slow drift so the room behind the card is never a still image.
        this.scene.applyCamera(this.pipeline.camera, 1,
          Math.sin(this.pipeline.time * 0.09) * 0.16 - 0.22,
          Math.sin(this.pipeline.time * 0.07) * 0.05 + 0.06);
        break;

      case 'intro':
        this.introT = Math.min(1, this.introT + dt / 3.4);
        this.scene.applyCamera(this.pipeline.camera, this.introT, 0, 0);
        if (this.introT >= 1) this.state = 'exam';
        break;

      case 'exam':
        this.updateExam(dt, panic);
        break;

      case 'lose':
        this.lose.update(dt);
        break;

      case 'feedback':
        this.feedback.update(dt);
        // The room keeps drifting behind the panel, as on the title card.
        this.scene.applyCamera(this.pipeline.camera, 1,
          Math.sin(this.pipeline.time * 0.09) * 0.16 - 0.22,
          Math.sin(this.pipeline.time * 0.07) * 0.05 + 0.06);
        break;
    }

    // Grain and flicker rise with the pressure.
    this.pipeline.grade.grain = 0.05 + panic * 0.06;
    this.pipeline.grade.vignette = 0.58 + panic * 0.22;
    this.pipeline.grade.aberration = 0.14 + panic * 0.35;
    this.pipeline.fade = this.fader.value;
  }

  updateExam(dt, panic) {
    this.scene.applyCamera(this.pipeline.camera, 1, this.lookYaw, this.lookPitch);

    /* The sheet is only animated (caret blink, invalid flash) while it is in
       the player's hands. Re-rendering it while it lies on the table would
       re-upload an 800x1120 texture twice a second for detail nobody can read
       at 270p, and that upload traffic competes with the grapher's. */
    if (this.hold === HOLD.PAPER) {
      this.paper.update(dt);
      this.paper.render();
    }

    if (!this.question || this.transitioning) return;

    this.timeLeft -= dt;

    // The last ten seconds: the cue starts and swells until the shot.
    if (this.timeLeft <= QB.PANIC_SECONDS) {
      if (!this.panicStarted) { SATG.audio.startTension(); this.panicStarted = true; }
      SATG.audio.setTensionIntensity(panic);
    }

    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.die('timeout');
      return;
    }

    // What the crosshair is currently over, for the prompt.
    if (this.hold === HOLD.NONE) {
      const ray = this.pipeline.camera.rayFromScreen(this.mouse.u, this.mouse.v);
      this.hoverTarget = this.scene.pick(ray);
    } else {
      this.hoverTarget = null;
    }
  }

  /* ==================================================================== */
  /* Layout                                                                */
  /* ==================================================================== */

  /* Fit a canvas of the given aspect into `heightFraction` of the screen,
     centred, converting to the 0..1 screen-space rect the overlay expects. */
  fitRect(canvasAspect, heightFraction, offsetY) {
    const screenAspect = this.pipeline.width / this.pipeline.height;
    const h = heightFraction;
    const w = (h * canvasAspect) / screenAspect;
    return { x: (1 - w) / 2, y: (1 - h) / 2 + (offsetY || 0), w, h };
  }

  /* Un-panned sheet rect at the current zoom. */
  paperRectRaw() { return this.fitRect(this.paper.aspect, 0.94 * this.paperZoom, 0); }

  paperRect() {
    const r = this.paperRectRaw();
    r.x += this.paperPan.x;
    r.y += this.paperPan.y;
    return r;
  }

  calcRect() { return this.fitRect(this.calculator.handAspect, 0.86, 0); }

  /* Keep the sheet from being dragged off screen: once an axis is larger
     than the viewport it must still cover it; while it fits, it stays
     centred and the pan on that axis is pinned to zero. */
  clampPaperPan() {
    const raw = this.paperRectRaw();
    this.paperPan.x = raw.w <= 1 ? 0
      : clamp(this.paperPan.x, 1 - raw.x - raw.w, -raw.x);
    this.paperPan.y = raw.h <= 1 ? 0
      : clamp(this.paperPan.y, 1 - raw.y - raw.h, -raw.y);
  }

  /* Zoom about the cursor, so the word under the pointer stays under it. */
  zoomPaper(delta, u, v) {
    const before = this.paperRect();
    const lu = (u - before.x) / before.w;
    const lv = (v - before.y) / before.h;

    this.paperZoom = clamp(this.paperZoom * (delta > 0 ? 0.88 : 1.136), 1, 3.4);

    const raw = this.paperRectRaw();
    this.paperPan.x = u - raw.x - lu * raw.w;
    this.paperPan.y = v - raw.y - lv * raw.h;
    this.clampPaperPan();
  }

  resetPaperView() {
    this.paperZoom = 1;
    this.paperPan.x = this.paperPan.y = 0;
  }

  /* ==================================================================== */
  /* Render                                                                */
  /* ==================================================================== */

  render() {
    const P = this.pipeline;

    if (this.state === 'lose' || this.state === 'exiting') {
      P.beginFlat(0, 0, 0);
    } else {
      this.scene.render(P);
      P.endWorld();
    }

    P.beginOverlays();

    switch (this.state) {
      case 'title':
        /* Must track the viewport. Every overlay is drawn as a stretch-to-fit
           {0,0,1,1} quad with no aspect correction, so a canvas left at its
           construction size is squashed by whatever the window's real aspect
           ratio is - 108% distortion on a tall window. The HUD always got
           this right because it resizes each frame; these two never did. */
        this.title.resize(P.compRT.width, P.compRT.height, P.uiScale);
        this.title.render();
        P.drawOverlay(this.title.texture, { x: 0, y: 0, w: 1, h: 1 });
        break;

      case 'intro':
      case 'exam':
        this.renderExamOverlays(P);
        break;

      case 'lose':
        // Same reason as the title card above. renderExitScreen already did
        // this for the 'exiting' state, but dying is the common path and it
        // was the one left out.
        this.lose.resize(P.compRT.width, P.compRT.height, P.uiScale);
        this.lose.render();
        P.drawOverlay(this.lose.texture, { x: 0, y: 0, w: 1, h: 1 });
        break;

      case 'feedback':
        this.feedback.resize(P.compRT.width, P.compRT.height, P.uiScale);
        this.feedback.render();
        P.drawOverlay(this.feedback.texture, { x: 0, y: 0, w: 1, h: 1 });
        // A pointer, or the buttons cannot be aimed at.
        this.renderHudCursorOnly(P);
        break;

      case 'exiting':
        this.renderExitScreen(P);
        break;
    }

    P.present();
  }

  renderExamOverlays(P) {
    if (this.hold === HOLD.CALC_FULL) {
      this.calculator.resizeFull(P.compRT.width, P.compRT.height);
      this.calculator.pointer.u = this.mouse.u;
      this.calculator.pointer.v = this.mouse.v;
      this.calculator.renderFullscreen(P.time);
      P.drawOverlay(this.calculator.fullTexture, { x: 0, y: 0, w: 1, h: 1 });
      // Trace readout and arrow pointer, as quads on top of the panel.
      this.calculator.drawDynamic(P);
      // The grapher draws its own arrow pointer, so the HUD adds none.
      this.renderHud(P, 'none');
      return;
    }

    if (this.hold === HOLD.PAPER) {
      this.paper.render();
      // A soft scrim so the room recedes while reading.
      P.fillRect({ x: 0, y: 0, w: 1, h: 1 }, [0, 0, 0, 0.62]);
      P.drawOverlay(this.paper.texture, this.paperRect());
      this.renderHud(P, 'bright');
      return;
    }

    if (this.hold === HOLD.CALC) {
      this.calculator.renderHandheld();
      P.fillRect({ x: 0, y: 0, w: 1, h: 1 }, [0, 0, 0, 0.52]);
      P.drawOverlay(this.calculator.handTexture, this.calcRect());
      this.renderHud(P, 'bright');
      return;
    }

    this.renderHud(P, 'crosshair');
  }

  renderHud(P, cursorStyle) {
    // The intro plays without a HUD; the clock starts when the player is up.
    if (this.state === 'intro') return;

    this.hud.resize(P.compRT.width, P.compRT.height, P.uiScale);

    let prompt = '';
    if (this.hold === HOLD.NONE) {
      if (this.hoverTarget === 'paper') prompt = 'CLICK - TAKE THE PAPER';
      else if (this.hoverTarget === 'calculator') prompt = 'CLICK - TAKE THE CALCULATOR';
    } else if (this.hold === HOLD.PAPER) {
      const zoomHint = this.paperZoom > 1.01
        ? '(SCROLL) TO ZOOM  DRAG TO MOVE'
        : '(SCROLL) TO ZOOM';
      prompt = this.question && this.question.format === 'grid'
        ? 'TYPE YOUR ANSWER    ' + zoomHint + '    ENTER - SUBMIT    ESC - SET DOWN'
        : 'CLICK TO SELECT    ' + zoomHint + '    ENTER - SUBMIT    ESC - SET DOWN';
    } else if (this.hold === HOLD.CALC) {
      prompt = 'CLICK KEYS    TAB - GRAPH    ESC - SET DOWN';
    }

    this.hud.set({
      timeLeft: this.timeLeft,
      timeLimit: this.timeLimit,
      prompt,
      cleared: this.cleared,
      cursor: cursorStyle,
      usePointer: true,
      pointer: { u: this.mouse.u, v: this.mouse.v }
    });
    // draw() composites the HUD's three layers itself: the rarely-changing
    // base, the small clock strip, and the reticle sprite.
    this.hud.draw(P);
  }

  /* The feedback screen has buttons but no clock, prompt or counter, so it
     borrows only the HUD's pointer rather than the whole overlay. */
  renderHudCursorOnly(P) {
    this.hud.resize(P.compRT.width, P.compRT.height, P.uiScale);
    this.hud.set({
      timeLeft: this.timeLimit, timeLimit: this.timeLimit,
      prompt: '', cleared: this.cleared,
      cursor: 'bright', usePointer: true,
      pointer: { u: this.mouse.u, v: this.mouse.v }
    });
    const tex = this.hud.reticle.get('bright');
    if (!tex) return;
    const s = this.hud.s;
    const w = 32 * s / this.hud.W, h = 32 * s / this.hud.H;
    P.drawOverlay(tex, {
      x: this.mouse.u - w / 2, y: this.mouse.v - h / 2, w: w, h: h
    });
  }

  renderExitScreen(P) {
    const F = SATG.font;
    this.lose.resize(P.compRT.width, P.compRT.height, P.uiScale);
    const ctx = this.lose.ctx;
    this.lose.clear();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.lose.W, this.lose.H);
    const s = P.uiScale;
    // Fitted to the width like every other screen; at a fixed 3x these ran
    // off the edge on anything narrower than a tablet.
    const avail = Math.round(this.lose.W * 0.86);
    const big = F.fitScale('SESSION TERMINATED', avail, 3 * s, 4 * s, s);
    const small = F.fitScale('CLICK ANYWHERE TO RETURN', avail, s, 2 * s, s);
    F.draw(ctx, 'SESSION TERMINATED', this.lose.W / 2, this.lose.H / 2 - 40 * s,
           { color: '#8e8779', scale: big, tracking: 4 * s, align: 'center' });
    F.draw(ctx, 'CLICK ANYWHERE TO RETURN', this.lose.W / 2, this.lose.H / 2 + 30 * s,
           { color: '#4f4a42', scale: small, tracking: 2 * s, align: 'center' });
    this.lose.upload();
    P.drawOverlay(this.lose.texture, { x: 0, y: 0, w: 1, h: 1 });
  }
}

/* Map a screen-space point into 0..1 local coordinates of a rect, or null
   when the point falls outside it. */
function rectToLocal(rect, u, v) {
  const lu = (u - rect.x) / rect.w;
  const lv = (v - rect.y) / rect.h;
  if (lu < 0 || lu > 1 || lv < 0 || lv > 1) return null;
  return { u: lu, v: lv };
}

SATG.Game = Game;
SATG.HOLD = HOLD;

})(window);
