/* =========================================================================
   game/game.js - state machine, timers, input, and frame orchestration.

   States
     title     the room drifts behind the title card
     opening   the walk in, and the machine being set up. See game/cinematic.js
     intro     fade up from black as the player lifts their head off the desk
     exam      the loop: read, answer, submit, repeat
     verdict   the sheet is down and the machine is deciding
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
    /* Still built, but no longer a destination: every ending now goes to the
       score report, which carries the YOU LOSE headline itself. This instance
       is the scratch surface renderExitScreen draws on. */
    this.lose = new SATG.screens.LoseScreen(this.gl);
    this.results = new SATG.screens.ResultsScreen(this.gl);
    this.analysis = new SATG.screens.AnalysisScreen(this.gl);
    this.typePicker = new SATG.screens.TypePickerScreen(this.gl);
    this.settings = new SATG.screens.SettingsScreen(this.gl);
    this.stats = new SATG.screens.StatsScreen(this.gl);
    /* Deliberately NOT a state. The in-game menu is an overlay over a running
       exam - see escmenu.js - and making it a state would route update()
       around updateExam, which is the definition of pausing. */
    this.escMenu = new SATG.screens.EscMenu(this.gl);
    this.hud = new SATG.screens.Hud(this.gl);
    this.feedback = new SATG.screens.FeedbackScreen(this.gl);
    this.fader = new SATG.screens.Fader();

    this.bank = new QB.QuestionBank(SATG.util.rng);

    /* The sheet lying on the table shows the live question, not a placeholder.
       It is unreadable at 270p, which is the point - the player can see there
       is writing on it and has to pick it up to find out what it says. */
    this.scene.paperTexture = this.paper.texture;

    this.state = 'title';
    /* Where BACK out of the analysis screen lands: 'results' after a run,
       'stats' when a saved review was opened from the history. */
    this.analysisFrom = 'results';
    this._reviewPaper = null;     // built on the first TEXT ANALYSIS
    this.reviewAt = 0;
    this.hold = HOLD.NONE;
    this.introT = 1;              // 1 = fully upright
    this.question = null;
    this.timeLeft = 0;
    this.timeLimit = 1;
    this.cleared = 0;
    this.best = 0;
    this.paused = false;
    this.transitioning = false;

    /* Set for a module or full-SAT run; null in Infinity, which still draws
       one question at a time from the bank. Everything that behaves
       differently between the two branches on this being present. */
    this.form = null;
    this.mode = null;
    this.result = null;           // grade() output, once a form is finished
    this.runElapsed = 0;          // seconds of testing time actually spent

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

    /* The two directors. Neither owns any state the exam depends on, so both
       can be skipped outright - which is exactly what R and the ANIMATIONS
       setting do. The corridor's geometry is not built until the opening
       first runs, so a player who never watches it never pays for it. */
    this.opening = new SATG.cinematic.Opening(this);
    this.verdict = new SATG.cinematic.Verdict(this);
    this._kick = { x: 0, y: 0, z: 0, roll: 0, pitch: 0 };
    /* How many times the machine has been watched going off this session.
       Past the first, Infinity stops staging it - see submit(). */
    this.deathsSeen = 0;

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

  /* `mode` is {kind, section} straight off the menu tree. It is stored before
     the fade so that a RETRY, which re-enters through here without going back
     to the menu, replays the same mode rather than silently reverting to the
     default one. */
  /* `opts.opening` asks for the full cutscene. Set only when a run is started
     from the title menu: RETRY and RESTART deliberately do not replay half a
     minute of corridor the player has just watched, and a drill is a practice
     tool rather than a story, so it never gets one either. */
  startRun(resume, mode, opts) {
    if (this.transitioning) return;
    this.transitioning = true;
    this.escMenu.hide();
    this._wantOpening = !!(opts && opts.opening);
    if (mode) this.mode = mode;
    if (!this.mode) {
      this.mode = { kind: SATG.menu.KIND.INFINITY, section: SATG.menu.SECTION.BOTH };
    }
    SATG.audio.init();
    SATG.audio.resume();

    this.fader.to(0, 0.9, () => {
      this.bank.reset(this.mode.section);
      /* A single-type drill is an Infinity run with the draw narrowed to one
         question type. Set after reset(), which clears it. */
      this.bank.onlyQType = this.mode.qtype || null;
      this.cleared = resume && this.save ? this.save.cleared : 0;
      if (resume && this.save) {
        this.bank.correctStreak = this.save.streak || 0;
        this.bank.served = this.save.cleared || 0;
      }
      this.best = Math.max(this.best, this.cleared);

      this.introT = 0;
      this.hold = HOLD.NONE;
      this.scene.showPaper = true;
      this.scene.showCalc = true;
      this.lookYaw = this.lookPitch = 0;
      this.result = null;
      this.runElapsed = 0;
      this.hoverTarget = null;
      // A previous run may have ended with the desk on its side.
      this.scene.tableFlip = 0;
      this.verdict.phase = 'idle';
      this.scene.machine.dread = 0;
      this.scene.fireball.clear();
      this.scene.machine.readout.setTimer(null);

      SATG.audio.startAmbience();

      if (this.isInfinity) {
        this.form = null;
        this.paper.setNav(null);
        this.nextQuestion(true);
      } else {
        this.buildForm();
      }

      /* The question is loaded BEFORE either opening runs, so whichever way
         the player gets to the desk the sheet is already the right one. The
         clock does not start until the state is 'exam', and neither opening
         is that state. */
      const cinematic = this._wantOpening && SATG.settings.values.animations &&
                        !this.isDrill;

      if (cinematic) {
        this.state = 'opening';
        /* The cutscene owns the fade for its whole length - every one of its
           fades is a beat of the timeline, and routing them through the
           game's fader would need a callback chain to sequence. */
        this.fader.snap(1);
        this.opening.start();
        this.transitioning = false;
      } else {
        this.state = 'intro';
        // The machine is simply already there, armed, as if it always had been.
        this.opening.finish();
        // Fade up slowly while the head comes off the desk.
        this.fader.to(1, 2.6, () => { this.transitioning = false; });
        SATG.audio.latch();
      }
    });
  }

  /* The one way out of the cutscene, however it ended - run to the last beat,
     cut short with R, or never started at all. */
  finishOpening() {
    if (this.state !== 'opening') return;
    this.opening.finish();
    this.state = 'exam';
    this.introT = 1;
    this.hold = HOLD.NONE;
    this.lookYaw = this.lookPitch = 0;
    this.transitioning = false;
    this.fader.snap(1);
    SATG.audio.latch();
  }

  /* A drill runs on the same machinery as Infinity - no form, one question at a
     time, drawn as you go - so everything that branches on "is this a form or a
     stream" must treat it as Infinity. What differs is only what happens on a
     wrong answer, which is asked separately through isDrill. */
  get isInfinity() {
    return !this.mode || this.mode.kind === SATG.menu.KIND.INFINITY ||
           this.mode.kind === SATG.menu.KIND.DRILL;
  }

  get isDrill() {
    return !!this.mode && this.mode.kind === SATG.menu.KIND.DRILL;
  }

  /* ==================================================================== */
  /* Module and full-SAT forms                                             */
  /* ==================================================================== */

  buildForm() {
    const S = SATG.menu.SECTION;
    const sections = this.mode.section === S.BOTH ? ['rw', 'math'] : [this.mode.section];
    this.form = new SATG.exam.ExamForm(sections, SATG.util.rng);
    this.loadFormQuestion(true);
  }

  /* Point the sheet at whatever question the form is currently on, and put
     back any answer already given for it. */
  loadFormQuestion(silent) {
    const mod = this.form.module;
    if (!mod) return;
    this.question = mod.question;
    this.timeLimit = mod.seconds;
    this.timeLeft = mod.timeLeft;
    this.paper.setQuestion(this.question);
    this.paper.restore(mod.responseAt(mod.index));
    this.paper.setNav(this.navState());
    this.paper.render();
    this.panicStarted = false;
    if (!silent) SATG.audio.click(1400);
  }

  navState() {
    const f = this.form;
    if (!f) return null;
    const mod = f.module;
    return {
      modules: f.modules.map((m, i) => ({
        number: m.number, section: m.section,
        done: i < f.index, current: i === f.index
      })),
      qIndex: mod.index, qCount: mod.count, answered: mod.answeredCount
    };
  }

  /* Save whatever is on the sheet before leaving the question, then move.
     Navigating away must never silently discard an answer. */
  goQuestion(delta) {
    if (!this.form || this.state !== 'exam') return false;
    const mod = this.form.module;
    if (this.paper.hasResponse()) mod.record(this.paper.currentResponse());
    if (!mod.step(delta)) return false;
    this.loadFormQuestion(false);
    /* AFTER the reload, not before: setQuestion() clears the effects for the
       outgoing question, which would take this one with it. One frame later
       than ideal, which is 16ms and not perceptible. */
    this.paper.fx.press(delta < 0 ? 'prev' : 'next');
    this.paper.dirty = true;
    return true;
  }

  gotoQuestion(i) {
    if (!this.form || this.state !== 'exam') return false;
    const mod = this.form.module;
    if (this.paper.hasResponse()) mod.record(this.paper.currentResponse());
    if (!mod.go(i)) return false;
    this.loadFormQuestion(false);
    return true;
  }

  /* End the module the player is sitting in: either the clock ran out or they
     answered the last question. Nothing has been graded up to this point. */
  finishModule(reason) {
    if (!this.form || this.form.module.finished) return;
    this.escMenu.hide();
    const mod = this.form.module;
    if (this.paper.hasResponse()) mod.record(this.paper.currentResponse());
    mod.timeLeft = Math.max(0, this.timeLeft);
    /* Seal it HERE, not in advance(). The guard at the top of this method
       tests exactly this flag, and advance() does not run until the player
       leaves the break card - so until now the guard was reading a flag that
       nothing had set yet and could not have stopped a second entry. Not
       reachable today, because the only two callers both leave the 'exam'
       state on their way in, but a guard that cannot guard is worse than no
       guard: it reads as though the case is handled. */
    mod.finished = true;

    SATG.audio.stopTension(true);
    SATG.audio.stopMachineBed(true);

    if (this.form.isLast) {
      /* The last module of the form ends the way every run in this game ends:
         the machine goes off, and the score report is what is waiting on the
         other side of it. Straight to the blast with no scan - a module test
         gets no pause between questions and no noise out of the machine, so
         it does not get a countdown to its own ending either. */
      if (SATG.settings.values.animations) {
        this.state = 'verdict';
        this.hold = HOLD.NONE;
        this.hoverTarget = null;
        this.verdict.begin(false, () => {
          SATG.audio.stopAmbience();
          SATG.audio.stopWheel();
          this.showResults(reason);
        }, { immediate: true });
      } else {
        SATG.audio.explosion();
        SATG.audio.stopAmbience();
        SATG.audio.stopWheel();
        this.showResults(reason);
      }
      return;
    }

    this.breakInfo = {
      wasBreak: this.form.breakNext,
      from: mod,
      to: this.form.modules[this.form.index + 1]
    };
    SATG.audio.beep(440, 0.3);
    this.hold = HOLD.NONE;
    this.state = 'moduleBreak';
    this.results.resetBreak(this.breakInfo, this.form);
  }

  beginNextModule() {
    if (!this.form) return;
    this.form.advance(this.bank);
    this.state = 'exam';
    this.hold = HOLD.NONE;
    this.loadFormQuestion(true);
  }

  showResults(reason) {
    this.form.elapsed = this.runElapsed;
    this.result = this.form.grade(this.bank);
    this.result.reason = reason || 'timeout';
    this.result.mode = this.mode;
    this.result.modeLabel = SATG.menu.modeLabel(this.mode);
    /* grade() ranks question types but does not judge them, because judging
       needs the evidence threshold and that lives with the profile. Without
       this the analysis screen's "WHAT THIS SAYS" section read the two fields,
       found nothing, and reported "not enough attempts on any single question
       type" after every run no matter how clear the picture was. */
    Object.assign(this.result, SATG.profile.rankQTypes(this.result.perQType));
    this.state = 'results';
    this.hold = HOLD.NONE;
    this.transitioning = false;
    this.fader.snap(0);
    this.fader.to(1, 0.55);
    this.results.reset(this.result);
    SATG.profile.record(this.result);
    this.clearSave();
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

    /* On a module test ENTER records and moves on. It deliberately does NOT
       grade: the player is entitled to change any answer until the module's
       clock stops, and reacting to a wrong answer here - with a ding, a shot,
       or anything else - would both leak the key and make going back
       pointless. The whole module is graded at once, afterwards. */
    if (this.form) {
      const mod = this.form.module;
      mod.record(this.paper.currentResponse());
      /* The machine reads the sheet on a module test too - but it cannot say
         whether the answer was right, because nothing is graded until the
         module's clock stops, and a verdict here would leak the key. So it
         scans and says nothing, over the top of the player carrying on: no
         pause between questions, and no sound, exactly as the brief asks. */
      this.scene.machine.pulseScan(0.55);
      if (mod.index >= mod.count - 1) {
        // Last question answered: end the module rather than sitting on it.
        this.finishModule('completed');
      } else {
        this.goQuestion(1);
      }
      return;
    }

    const response = this.paper.currentResponse();
    const correct = this.bank.check(this.question, response);
    /* Held for the death screen: once the run ends the paper is gone, so the
       answer the player actually gave has to be captured while it still
       exists. */
    this._lastResponse = response;
    /* The accumulator is zeroed for the next question rather than at the top of
       nextQuestion(), because a run can end here - and the time spent on the
       question that ended it still belongs in the report. */
    this.bank.recordResult(correct, this.question, response, this._questionTime || 0);
    this._questionTime = 0;

    /* Scored immediately, presented afterwards. A player who closes the tab
       while the machine is still deciding keeps the question they got right;
       tying the save to the end of an animation would lose it. */
    if (correct) {
      this.cleared++;
      this.best = Math.max(this.best, this.cleared);
      this.writeSave({ cleared: this.cleared, streak: this.bank.correctStreak, best: this.best });
      this.title.setCanContinue(true);
    }

    /* Answering always returns the sheet to the table. In Infinity that is the
       point rather than a side effect: the player has to be looking at the
       machine when it decides, and they cannot be if the paper is filling the
       screen. */
    this.setHold(HOLD.NONE, true);

    const M = this.scene.machine;

    /* The blast is worth watching once. After that it is a toll on every
       retry, and Infinity is a mode you are meant to retry - so the first
       death of a session plays in full and every one after it is the sound
       and the cut, with no half second of fire to sit through. Getting it
       RIGHT still animates every time: that is the loop, not the punishment.

       Session-scoped rather than saved. A reload is a deliberate act, and
       someone who reloads to show the thing to somebody else should get to. */
    const seenBlast = this.deathsSeen > 0;
    const animate = SATG.settings.values.animations && !this.isDrill &&
                    (correct || !seenBlast);

    if (!animate) {
      /* No pause and no cutscene - but the machine is still there and still
         reacts, because it is there in every run whatever is switched off.
         A drill never animates at all: drilling a weakness twelve times is
         the whole purpose, and a death animation between each one would make
         that unbearable. */
      /* A pulse, not a state: the verdict shows and the panel goes back to
         ARMED behind it, because on this path the run does not stop to let
         anyone read it. */
      M.pulse(correct ? SATG.MACHINE_DISPLAY.RIGHT : SATG.MACHINE_DISPLAY.WRONG, 0.7);
      if (correct) M.flashTick(); else M.flashCross();

      if (correct) {
        SATG.audio.ding();
        this.nextQuestion(true);
      } else if (this.isDrill) {
        /* A drill does not end on a wrong answer. The blast still fires,
           because the feedback is the point and a silent miss reads as an
           input that did not register - but the run continues to the next
           question of the same type. The tally comes from the bank, which
           already counts both, so there is no second copy to drift. */
        SATG.audio.explosion();
        this.nextQuestion(true);
      } else {
        this.die('wrong');
      }
      return;
    }

    // The machine takes it from here.
    this.state = 'verdict';
    this.hoverTarget = null;
    this.verdict.begin(correct, () => this.afterVerdict(correct));
  }

  /* What the machine's answer actually costs. Called once, whether the
     verdict played out in full or was cut short with R. */
  afterVerdict(correct) {
    if (correct) {
      this.state = 'exam';
      this.scene.machine.setDisplay(SATG.MACHINE_DISPLAY.ARMED);
      this.nextQuestion(true);
      return;
    }
    /* The blast already fired - its sound, its light, and its fade to black.
       die() must not stage a second one on top of it. */
    this.die('wrong', true);
  }

  /* `alreadyBlasted` is set when the verdict animation has already fired the
     machine. Everything else about dying is unchanged; only the noise and the
     cut to black would otherwise happen twice. */
  die(reason, alreadyBlasted) {
    if (this.state === 'results') return;
    this.hold = HOLD.NONE;
    // The clock does not stop for the menu, so the menu can still be up when
    // it reaches zero. Every exit from the exam has to take it down with it.
    this.escMenu.hide();

    SATG.audio.stopTension(true);
    if (!alreadyBlasted) SATG.audio.explosion();
    SATG.audio.stopAmbience();
    SATG.audio.stopMachineBed(true);
    SATG.audio.stopWheel();
    this.deathsSeen++;
    /* Whichever way the run ended, the machine registers it - the cross is
       lit and the panel says so even when nothing was staged. */
    this.scene.machine.flashCross();
    this.scene.machine.setDisplay(SATG.MACHINE_DISPLAY.WRONG);

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

    /* An Infinity run has no scaled score - there is no fixed number of
       questions to convert against - so it reports how long the player lasted
       instead, over the same per-domain breakdown the module tests use. */
    const b = this.bank.breakdown();
    this.result = {
      kind: 'infinity',
      reason: reason,
      mode: this.mode,
      modeLabel: SATG.menu.modeLabel(this.mode),
      cleared: this.cleared,
      best: this.best,
      elapsed: this.runElapsed,
      answerText: this.question ? this.question.answerText : null,
      perDomain: b.perDomain, perSkill: b.perSkill,
      perQType: b.perQType, perDifficulty: b.perDifficulty,
      items: b.items,
      pacing: b.pacing,
      strengths: b.strengths, weaknesses: b.weaknesses,
      /* Judged by the same rule a graded run uses. These were hard-coded empty,
         which meant an Infinity run of two hundred questions still reported
         that it could not tell you anything about any question type. */
      ...SATG.profile.rankQTypes(b.perQType),
      /* The question the run died on, kept whole.

         An Infinity death used to say only that it had happened. The player
         never learned what the answer was, which makes the loss teach nothing
         - the single most valuable moment in the mode was being thrown away.
         `answerText` alone was already here and unused; the rest is what turns
         it into an explanation. */
      lastQuestion: this.question ? {
        qtype: this.question.qtype || null,
        stem: this.question.stem || '',
        answerText: this.question.answerText != null
          ? String(this.question.answerText) : null,
        explanation: this.question.explanation || null,
        yours: SATG.satUtil.describeResponse(this.question, this._lastResponse),
        /* Why the option they picked is wrong, when the generator names it. */
        whyWrong: (this.question.format === 'mc' && this.question.choices &&
                   this.question.choices[this._lastResponse])
          ? (this.question.choices[this._lastResponse].why || null) : null,
        wasTimeout: reason === 'time'
      } : null,
      sections: []
    };
    this.state = 'results';
    this.results.reset(this.result);
    SATG.profile.record(this.result);

    // A run that ended cannot be continued.
    this.clearSave();
    this.writeSave({ cleared: 0, streak: 0, best: this.best });
  }

  toTitle() {
    if (this.transitioning) return;
    this.transitioning = true;
    // The sign-in button is real DOM sitting on top of the canvas, so it has
    // to be told to go away by every route out of the stats page, not just the
    // one that goes through closeStats().
    SATG.account.show(false);
    SATG.cloud.hidePanel();
    this.escMenu.hide();
    this.fader.to(0, 0.6, () => {
      this.state = 'title';
      this.hold = HOLD.NONE;
      this.question = null;
      // Leaving a run drops the form with it: keeping it would let a later
      // RETRY resume a half-finished module the player already walked away from.
      this.form = null;
      this.result = null;
      this.paper.setNav(null);
      this.introT = 1;
      this.scene.tableFlip = 0;
      this.verdict.phase = 'idle';
      this.scene.fireball.clear();
      this.scene.machine.dread = 0;
      /* Everything the run was holding open, in one call. A wheel still
         turning under the title card is the kind of bug that only shows up
         as "why can I hear that". */
      SATG.audio.stopAll();
      this.title.setCanContinue(!!(this.save && this.save.cleared > 0));
      this.fader.to(1, 0.8, () => { this.transitioning = false; });
    });
  }

  doExit() {
    if (this.transitioning) return;
    this.transitioning = true;
    SATG.audio.stopAll();
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

  /* The screens that scroll, and the object that owns each one's scroll.

     Kept as one lookup because three separate input paths need it: the wheel,
     the keyboard, and dragging. */
  scroller() {
    if (this.state === 'analysis') return this.analysis.card ? null : this.analysis;
    if (this.state === 'stats') return this.stats;
    if (this.state === 'types') return this.typePicker;
    return null;
  }

  onPointerMove(u, v, dx, dy) {
    const pu = this.mouse.u, pv = this.mouse.v;
    this.mouse.u = u;
    this.mouse.v = v;

    /* Drag to scroll.

       A phone has no wheel and no arrow keys, so without this the analysis
       report, the stats page and the type picker are all readable only as far
       as their first screenful - every one of them is several screens long.
       It costs nothing on a mouse, where dragging a report is also the natural
       thing to try.

       Content coordinates, not CSS pixels: v is a 0..1 fraction of the canvas,
       so multiplying by the screen's own height makes a drag move the content
       by exactly the distance the finger travelled. */
    const sc = this.scroller();
    if (sc && this.mouse.down) {
      const moved = Math.abs(v - pv) + Math.abs(u - pu);
      this._dragScrolled = (this._dragScrolled || 0) + moved;
      if (this._dragScrolled > 0.004) {
        this.mouse.dragging = true;
        sc.scrollBy(-(v - pv) * sc.H);
      }
      return;
    }

    /* Panning a zoomed sheet. The review paper needs this as much as the live
       one does - it is the same sheet at the same zoom, and on a phone the only
       way to read a magnified passage is to drag it. */
    const onSheet = (this.state === 'exam' && this.hold === HOLD.PAPER) ||
                    this.state === 'paperReview';
    if (onSheet) {
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
    /* No browser will let a sound play before a gesture, so the title card is
       silent until this happens - there is nowhere earlier to put it. */
    SATG.music.unlock();
    this.mouse.down = true;
    this.mouse.dragging = false;
    this._dragScrolled = 0;

    /* On a screen that scrolls, acting on pointer DOWN and dragging to scroll
       are the same gesture starting - so the action waits for the release and
       only happens if the finger did not travel. Without this, every attempt to
       scroll the report on a phone opens whatever happened to be under the
       thumb when it landed. */
    if (this.scroller() || this.state === 'paperReview') {
      this._pendingClick = { u, v };
      this._paperMoved = 0;
      return;
    }

    this.dispatchClick(u, v);
  }

  /* Where the pointer-down actions used to live. Called immediately on screens
     that do not scroll, and on release for the ones that do. */
  dispatchClick(u, v) {
    switch (this.state) {
      case 'opening':
        // A click moves the camera between the three things worth looking at;
        // it never skips, because skipping is a decision and R is where it
        // lives. Before the room appears there is nothing to look at, and
        // cycleView says so by refusing.
        this.opening.cycleView(1);
        return;

      case 'verdict':
        // Nothing to click. The machine is not taking questions.
        return;

      case 'title': {
        const i = this.title.hitTest(u, v);
        if (i !== null && this.title.setIndex(i)) SATG.audio.click();
        if (i !== null) this.activateTitle();
        return;
      }
      case 'results':
      case 'moduleBreak': {
        /* The circled i is checked before the menu, because it overlaps
           nothing but sits in the same click handler. */
        if (this.results.hitInfo(u, v)) {
          SATG.audio.click();
          this.results.toggleExplain();
          return;
        }
        const i = this.results.hitTest(u, v);
        if (i !== null) { this.results.setIndex(i); SATG.audio.click(); this.activateResults(); }
        return;
      }
      case 'analysis':
        this.activateAnalysis(this.analysis.hitTest(u, v));
        return;
      case 'paperReview':
        this.reviewPointerDown(u, v);
        return;
      case 'types':
        this.activateTypePicker(this.typePicker.hitTest(u, v));
        return;
      case 'stats': {
        const h = this.stats.hitTest(u, v);
        /* An armed DELETE is cancelled by any click that is not the confirm
           itself - including a click on nothing. That is what makes the second
           click a decision rather than a formality. */
        if (!h || h.kind !== 'review-delete') this.stats.disarmDelete();
        if (!h) return;
        if (h.kind === 'back') { this.closeStats(); return; }
        // History targets.
        if (h.kind === 'combined') {
          this.stats.fx.press('combined');
          SATG.audio.click();
          this.openCombinedReview();
          return;
        }
        if (h.kind === 'review-open') {
          this.stats.fx.press('rv' + h.at);
          SATG.audio.click();
          this.openSavedReview(h.at);
          return;
        }
        if (h.kind === 'review-delete') {
          const what = this.stats.armDelete(h.at);
          /* A sheet being put down, not the gunshot. The shot means the run is
             over and is the loudest thing in the game; firing it because a
             player tidied their history would read as something having gone
             badly wrong. */
          if (what === 'deleted') SATG.audio.paperRustle(true);
          else SATG.audio.click();
          return;
        }
        if (h.kind === 'tab') { if (this.stats.setTab(h.index)) SATG.audio.click(); return; }
        // Logbook targets.
        if (h.kind === 'chapter') { this.stats.toggleChapter(h.skill); SATG.audio.click(); return; }
        if (h.kind === 'logtype') { this.stats.toggleType(h.qtype); SATG.audio.click(); return; }
        if (h.kind === 'link') {
          SATG.audio.click();
          if (h.url) global.open(h.url, '_blank', 'noopener');
          return;
        }
        if (h.kind === 'practice') {
          this.stats.fx.press('pr' + h.qtype);
          SATG.audio.click();
          this.startTypePractice(h.qtype);
          return;
        }
        return;
      }
      case 'settings': {
        const i = this.settings.hitTest(u, v);
        if (i === null) return;
        /* Clicking a row you are not on selects it; clicking the row you are
           already on operates it. A slider that jumped the moment you touched
           its label would change a setting the player only meant to read. */
        if (this.settings.setIndex(i)) { SATG.audio.click(); return; }
        const c = this.settings.selected;
        if (c && c.kind === 'range') { if (this.settings.adjust(1)) SATG.audio.click(1500); return; }
        const r = this.settings.activate();
        if (!r) return;
        if (r.type === 'action' && r.action === 'back') this.closeSettings();
        else if (r.type === 'reset') SATG.audio.beep(520, 0.1);
        else SATG.audio.click();
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
        // The overlay takes the click before the room does, or picking an
        // item off the desk through the panel would be possible.
        if (this.escMenu.open) {
          const i = this.escMenu.hitTest(u, v);
          if (i === null) return;
          if (this.escMenu.setIndex(i)) SATG.audio.click();
          this.activateEscMenu();
          return;
        }
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

    /* A deferred click on a scrolling screen. Uses the position the finger came
       DOWN at, not where it left: a thumb rolls a few pixels on the way up, and
       the row the player aimed at is the one they touched. */
    const pending = this._pendingClick;
    this._pendingClick = null;
    if (wasDown && pending) {
      /* Two accumulators because there are two gestures this has to tell a tap
         apart from: dragging a report to scroll it, and dragging a zoomed sheet
         to pan it. Either one disqualifies the release from being a click. */
      const dragged = (this._dragScrolled || 0) > 0.004 ||
                      (this._paperMoved || 0) > 0.012;
      this._dragScrolled = 0;
      this._paperMoved = 0;
      if (!dragged) this.dispatchClick(pending.u, pending.v);
      return;
    }
    this._dragScrolled = 0;

    // A release that began under the open menu must not also answer a question.
    if (!wasDown || this.state !== 'exam' || this.hold !== HOLD.PAPER ||
        this.escMenu.open) {
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
      /* On a device with no physical keyboard this is the only way the answer
         can be typed at all, so it is offered whenever the pointer is coarse
         rather than being hidden behind a setting. */
      if (SATG.touch.isTouch()) this.openGridKeyboard();
    } else if (hit.type === 'prev') {
      this.goQuestion(-1);
    } else if (hit.type === 'next') {
      this.goQuestion(1);
    } else if (hit.type === 'module') {
      /* The strip is a position indicator, not a control. A module you have
         left is sealed, and a module you have not reached does not exist yet -
         its difficulty is chosen from how the current one goes. Saying so is
         better than a click that appears to do nothing. */
      if (this.form && hit.index !== this.form.index) {
        SATG.audio.beep(300, 0.1);
        this.paper.flagInvalid();
      }
    }
  }

  /* Put a real text field over the answer box so the phone offers a keyboard.

     Every character still goes through paper.typeChar, which is what enforces
     the grid-in rules - so a phone keyboard offering letters cannot get one
     into the answer any more than a physical one can. */
  openGridKeyboard() {
    const p = this.paper;
    if (!p.question || p.question.format !== 'grid' || !p.hitInput) return false;
    const sheet = this.paperRect();
    const { W, H } = SATG.PAPER_SIZE;
    const box = p.hitInput;
    const rect = {
      x: sheet.x + (box.x / W) * sheet.w,
      y: sheet.y + (box.y / H) * sheet.h,
      w: (box.w / W) * sheet.w,
      h: (box.h / H) * sheet.h
    };
    SATG.touch.openNumericInput(p.typed, rect, (value) => {
      /* Retype the whole value through the paper rather than assigning it, so
         the length cap and the character filter both still apply. */
      p.typed = '';
      for (const ch of String(value)) p.typeChar(ch);
      p.dirty = true;
    }, () => {
      p.inputFocused = false;
      p.dirty = true;
    });
    return true;
  }

  onWheel(delta) {
    /* The report is long enough that a wheel is the natural way through it,
       and a scrollable page that ignores the wheel reads as broken. */
    if (this.state === 'analysis') {
      if (!this.analysis.card) this.analysis.scrollBy(delta > 0 ? 60 : -60);
      return;
    }
    if (this.state === 'paperReview') {
      // Same wheel-to-zoom the held sheet has, because it is the same reading.
      this.zoomPaper(delta, this.mouse.u, this.mouse.v);
      return;
    }
    if (this.state === 'stats') { this.stats.scrollBy(delta > 0 ? 60 : -60); return; }
    if (this.state === 'types') { this.typePicker.scrollBy(delta > 0 ? 60 : -60); return; }
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
    SATG.music.unlock();

    /* R skips whatever the machine is currently doing to the player.

       Checked here and NOWHERE else, because R is a perfectly ordinary
       character elsewhere: it is a legal variable in the calculator and a
       keystroke on the answer line. Confining the shortcut to the two states
       that have something to skip is what keeps it from eating input during
       the exam. */
    if (this.state === 'opening') {
      if (key === 'r' || key === 'R' || key === 'Escape' || key === 'Enter') {
        this.finishOpening();
        return;
      }
      if (key === 'ArrowLeft'  || key === 'a' || key === 'A') { this.opening.cycleView(-1); return; }
      if (key === 'ArrowRight' || key === 'd' || key === 'D') { this.opening.cycleView(1); return; }
      if (key >= '1' && key <= '3') { this.opening.setView(Number(key) - 1); return; }
      return;
    }

    if (this.state === 'verdict') {
      if (key === 'r' || key === 'R') this.verdict.skip();
      return;
    }

    if (this.state === 'title') {
      if (key === 'ArrowUp' || key === 'w' || key === 'W') { if (this.title.move(-1)) SATG.audio.click(); }
      else if (key === 'ArrowDown' || key === 's' || key === 'S') { if (this.title.move(1)) SATG.audio.click(); }
      else if (key === 'Enter' || key === ' ' ||
               key === 'ArrowRight' || key === 'd' || key === 'D') this.activateTitle();
      else if (key === 'Escape' || key === 'Backspace' ||
               key === 'ArrowLeft' || key === 'a' || key === 'A') {
        // Backspace is "go back" in a browser too; without this the menu key
        // navigates the page away from the game.
        if (key === 'Backspace') e.preventDefault();
        this.titleBack();
      }
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

    if (this.state === 'paperReview') {
      if (key === 'Escape' || key === 'Backspace') {
        if (key === 'Backspace') e.preventDefault();
        /* ESC turns the sheet back over before it puts it down - the same rule
           the analysis card follows, for the same reason. */
        if (this.reviewPaper.reviewBack) {
          this.reviewPaper.flipReview();
          SATG.audio.paperRustle(true);
          return;
        }
        this.closeTextAnalysis();
        return;
      }
      if (key === 'ArrowLeft'  || key === 'a' || key === 'A') { this.goReview(-1); return; }
      if (key === 'ArrowRight' || key === 'd' || key === 'D') { this.goReview(1); return; }
      if (key === 'i' || key === 'I' || key === 'Enter' || key === ' ') {
        SATG.audio.paperRustle(!this.reviewPaper.reviewBack);
        this.reviewPaper.flipReview();
        return;
      }
      if (key === 'Home') { this.jumpReview(0); return; }
      if (key === 'End') {
        this.jumpReview(((this.reviewPaper.reviewItems) || []).length - 1);
        return;
      }
      return;
    }

    if (this.state === 'analysis') {
      if (key === 'Escape' || key === 'Backspace') {
        if (key === 'Backspace') e.preventDefault();
        /* ESC closes the open card first and only then leaves the report.
           Dismissing both at once would throw away the reader's scroll
           position for one keypress they meant as "close this panel". */
        if (!this.analysis.closeCard()) this.leaveAnalysis();
        SATG.audio.click();
        return;
      }
      if (this.analysis.card) return;   // the card owns the keyboard while open
      if (key === 'ArrowUp'   || key === 'w' || key === 'W') { this.analysis.scrollBy(-40); return; }
      if (key === 'ArrowDown' || key === 's' || key === 'S') { this.analysis.scrollBy(40); return; }
      if (key === 'PageUp')   { this.analysis.scrollBy(-this.analysis.viewH); return; }
      if (key === 'PageDown' || key === ' ') { this.analysis.scrollBy(this.analysis.viewH); return; }
      if (key === 'Home') { this.analysis.scrollBy(-1e9); return; }
      if (key === 'End')  { this.analysis.scrollBy(1e9); return; }
      if (key === 'ArrowLeft'  || key === 'a' || key === 'A') {
        this.analysis.setDepth('normal'); SATG.audio.click(); return;
      }
      if (key === 'ArrowRight' || key === 'd' || key === 'D') {
        this.analysis.setDepth('detailed'); SATG.audio.click(); return;
      }
      return;
    }

    if (this.state === 'types') {
      if (key === 'Escape' || key === 'Backspace') {
        if (key === 'Backspace') e.preventDefault();
        this.closeTypePicker(); return;
      }
      if (key === 'ArrowUp'   || key === 'w' || key === 'W') { this.typePicker.scrollBy(-40); return; }
      if (key === 'ArrowDown' || key === 's' || key === 'S') { this.typePicker.scrollBy(40); return; }
      if (key === 'PageUp')   { this.typePicker.scrollBy(-this.typePicker.viewH); return; }
      if (key === 'PageDown' || key === ' ') { this.typePicker.scrollBy(this.typePicker.viewH); return; }
      if (key === 'Enter') {
        if (this.typePicker.canStart()) this.startDrill(this.typePicker.open);
        return;
      }
      return;
    }

    if (this.state === 'stats') {
      if (key === 'Escape' || key === 'Backspace') {
        if (key === 'Backspace') e.preventDefault();
        /* ESC cancels an armed delete before it closes the page, the same way
           it closes an open card before leaving the report. */
        if (this.stats.disarmDelete()) { SATG.audio.click(); return; }
        this.closeStats(); return;
      }
      if (key === 'ArrowLeft'  || key === 'a' || key === 'A') {
        if (this.stats.moveTab(-1)) SATG.audio.click(); return;
      }
      if (key === 'ArrowRight' || key === 'd' || key === 'D') {
        if (this.stats.moveTab(1)) SATG.audio.click(); return;
      }
      if (key === 'ArrowUp'   || key === 'w' || key === 'W') { this.stats.scrollBy(-40); return; }
      if (key === 'ArrowDown' || key === 's' || key === 'S') { this.stats.scrollBy(40); return; }
      if (key === 'PageUp')   { this.stats.scrollBy(-this.stats.viewH); return; }
      if (key === 'PageDown' || key === ' ') { this.stats.scrollBy(this.stats.viewH); return; }
      if (key === 'Enter') { this.closeStats(); return; }
      return;
    }

    if (this.state === 'settings') {
      if (key === 'Escape') { this.closeSettings(); return; }
      if (key === 'ArrowUp' || key === 'w' || key === 'W') { this.settings.move(-1); SATG.audio.click(); return; }
      if (key === 'ArrowDown' || key === 's' || key === 'S') { this.settings.move(1); SATG.audio.click(); return; }
      if (key === 'ArrowLeft' || key === 'a' || key === 'A') {
        if (this.settings.adjust(-1)) SATG.audio.click(900);
        return;
      }
      if (key === 'ArrowRight' || key === 'd' || key === 'D') {
        if (this.settings.adjust(1)) SATG.audio.click(1500);
        return;
      }
      if (key === 'Enter' || key === ' ') {
        const r = this.settings.activate();
        if (!r) return;
        if (r.type === 'action' && r.action === 'back') this.closeSettings();
        // A restore is silent otherwise, and silence reads as a dead key.
        else if (r.type === 'reset') SATG.audio.beep(520, 0.1);
        else SATG.audio.click();
        return;
      }
      return;
    }

    if (this.state === 'results' || this.state === 'moduleBreak') {
      if (key === 'ArrowUp' || key === 'w' || key === 'W') { this.results.move(-1); SATG.audio.click(); }
      else if (key === 'ArrowDown' || key === 's' || key === 'S') { this.results.move(1); SATG.audio.click(); }
      else if (key === 'Enter' || key === ' ') this.activateResults();
      return;
    }

    if (this.state === 'exiting') {
      if (key === 'Enter' || key === 'Escape' || key === ' ') this.toTitle();
      return;
    }

    if (this.state !== 'exam') return;

    /* ---- the in-game menu owns the keyboard while it is up. */
    if (this.escMenu.open) {
      if (key === 'Escape') {
        if (this.escMenu.back() === 'close') this.closeEscMenu();
        else SATG.audio.click();
        return;
      }
      if (key === 'ArrowUp'   || key === 'w' || key === 'W') { if (this.escMenu.move(-1)) SATG.audio.click(); return; }
      if (key === 'ArrowDown' || key === 's' || key === 'S') { if (this.escMenu.move(1)) SATG.audio.click(); return; }
      if (key === 'ArrowLeft'  || key === 'a' || key === 'A') { if (this.escMenu.adjust(-1)) SATG.audio.click(900); return; }
      if (key === 'ArrowRight' || key === 'd' || key === 'D') { if (this.escMenu.adjust(1)) SATG.audio.click(1500); return; }
      if (key === 'Enter' || key === ' ') { this.activateEscMenu(); return; }
      return;
    }

    /* ---- Escape: step out of whatever is held, and open the menu when the
       hands are already empty. Setting something down is the more urgent
       meaning of the key during an exam, so it keeps first claim. */
    if (key === 'Escape') {
      if (this.hold === HOLD.CALC_FULL) this.setHold(HOLD.CALC);
      else if (this.hold !== HOLD.NONE) this.setHold(HOLD.NONE);
      else this.openEscMenu();
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
      /* Paging within the module. Checked before the answer keys because
         left/right are free in both question formats, whereas up/down are
         already how a multiple-choice answer is chosen. */
      if (this.form) {
        if (key === 'ArrowLeft')  { this.goQuestion(-1); return; }
        if (key === 'ArrowRight') { this.goQuestion(1);  return; }
      }
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

  /* The menu is a tree, so activating an entry can mean three different
     things. The tree itself reports which one without knowing anything about
     game state; this is the only place that turns that report into an action. */
  activateTitle() {
    const r = this.title.enter();
    switch (r.type) {
      case 'submenu':
      case 'back':
        SATG.audio.click();
        return;
      case 'mode':
        this.clearSave();
        // The only route that plays the full opening. RETRY and RESTART come
        // in through startRun() without it, on purpose.
        this.startRun(false, r.mode, { opening: true });
        return;
      case 'action':
        this.runMenuAction(r.action, r.item);
        return;
    }
  }

  runMenuAction(action, item) {
    switch (action) {
      case 'feedback': this.openFeedback(); return;
      case 'settings': this.openSettings(); return;
      case 'stats':    this.openStats(); return;
      case 'types':    this.openTypePicker(item && item.section); return;
      case 'exit':     this.doExit(); return;
    }
  }

  openTypePicker(section) {
    SATG.audio.click();
    this.typePicker.reset(section);
    this.state = 'types';
  }

  closeTypePicker() {
    SATG.audio.click();
    this.state = 'title';
    this.title.dirty = true;
  }

  activateTypePicker(hit) {
    if (!hit) return;
    if (hit.kind === 'back') { this.closeTypePicker(); return; }
    if (hit.kind === 'type') { this.typePicker.toggle(hit.qtype); SATG.audio.click(); return; }
    if (hit.kind === 'start') {
      this.typePicker.fx.press('start');
      this.startDrill(this.typePicker.open);
      return;
    }
  }

  /* The drill mode from the brief: one question type, endless, and a wrong
     answer costs the shot but not the run. */
  startDrill(qtypeId) {
    if (!qtypeId || !SATG.questionBank.canDraw(qtypeId)) return;
    const sk = SATG.taxonomy.skillOf(qtypeId);
    if (!sk) return;
    const q = SATG.taxonomy.qtype(qtypeId);
    this.clearSave();
    this.startRun(false, {
      kind: SATG.menu.KIND.DRILL,
      section: sk.section,
      qtype: qtypeId,
      label: (q ? q.label.toUpperCase() : qtypeId)
    });
  }

  openStats() {
    SATG.audio.click();
    // Loading is deferred to here rather than done at boot: the sign-in script
    // is a third-party request, and a player who never opens this page should
    // never make it.
    SATG.account.load();
    SATG.account.onChange = () => { this.stats.refresh(); };
    this.stats.reset();
    this.state = 'stats';
    const spot = this.stats.buttonSpot();
    SATG.account.place(spot.u, spot.v);
    SATG.account.show(true);
    /* The email form is NOT placed here. It goes in a band the stats page
       draws for it, and where that band lands is only known once the page has
       been laid out - so syncCloudPanel(), on the next frame, both creates
       and positions it. */
  }

  /* Keep the email form sitting in the band the stats page draws for it.

     Driven from the frame loop rather than set once when the page opens,
     because the band's position is a RESULT of laying the page out - it moves
     with the window, with the UI scale, and with how many rows the tab strip
     wrapped onto. Asking the screen where it ended up is the only answer that
     stays true.

     The panel is created and destroyed here too, and only on the frames where
     that actually changes: showPanel() tears down whatever is there first, so
     calling it every frame would rebuild the input sixty times a second and
     the player could never finish typing an address into it. */
  syncCloudPanel() {
    const spot = this.stats.signInSpot();
    if (!spot) {
      SATG.cloud.hidePanel();
      return;
    }
    /* The panel's contents differ either side of signing in - an address
       field, or SYNC NOW and SIGN OUT - so it has to be rebuilt when that
       flips. Only then: see above. */
    const inNow = SATG.cloud.signedIn;
    if (!SATG.cloud.panelVisible || this._panelSignedIn !== inNow) {
      this._panelSignedIn = inNow;
      SATG.cloud.showPanel(spot.u, spot.v, () => { this.stats.refresh(); }, spot.w);
    } else {
      SATG.cloud.place(spot.u, spot.v, spot.w);
    }
  }

  closeStats() {
    this.stats.pressBack();
    SATG.audio.click();
    SATG.account.show(false);
    SATG.cloud.hidePanel();
    this.state = 'title';
    this.title.dirty = true;
  }

  /* Drill one question type, straight from the logbook.

     This is an Infinity run with the draw narrowed, and deliberately NOT a
     scored one: a section score computed from twelve questions of a single type
     would be a number with no meaning, and printing it would undo the care
     taken everywhere else to only claim what the evidence supports. */
  /* The logbook's PRACTICE ONLY THIS QUESTION TYPE button.

     Routed through startDrill rather than repeating it. It used to build its
     own mode with kind INFINITY - which meant isDrill was false for anything
     launched from the logbook, so a drill started there killed the player on
     the first wrong answer and showed the Infinity counter instead of the
     running score. Two entry points to one mode, and only one of them was
     setting the flag that defines it. */
  startTypePractice(qtypeId) {
    if (!SATG.taxonomy.skillOf(qtypeId)) return;
    SATG.account.show(false);
    SATG.cloud.hidePanel();
    this.startDrill(qtypeId);
  }

  /* Like the feedback page: a menu page, not a scene change, so no fade. */
  openSettings() {
    SATG.audio.click();
    this.settings.reset();
    this.state = 'settings';
  }

  closeSettings() {
    SATG.audio.click();
    SATG.settings.save();
    this.state = 'title';
    this.title.dirty = true;
  }

  /* ESC steps back up one level of the menu, matching the way it steps out of
     whatever is held during the exam. At the root it does nothing, rather than
     quitting: EXIT is an entry the player has to choose. */
  titleBack() {
    if (this.title.back()) SATG.audio.click();
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

  openEscMenu() {
    if (this.state !== 'exam' || this.escMenu.open) return;
    SATG.audio.beep(520, 0.06);
    this.escMenu.show();
  }

  closeEscMenu() {
    if (!this.escMenu.open) return;
    SATG.audio.beep(380, 0.05);
    this.escMenu.hide();
  }

  activateEscMenu() {
    const r = this.escMenu.activate();
    if (!r) { SATG.audio.click(); return; }
    switch (r.do) {
      case 'page':    SATG.audio.click(); return;
      case 'reset':   SATG.audio.beep(520, 0.1); return;
      case 'resume':  this.closeEscMenu(); return;
      case 'restart':
        this.escMenu.hide();
        /* Same mode, from the top. startRun() rebuilds the form, so a module
           run gets a fresh set of questions rather than the ones already seen. */
        this.startRun(false);
        return;
      case 'quit':
        this.escMenu.hide();
        this.toTitle();
        return;
    }
  }

  activateResults() {
    this.results.press();
    switch (this.results.selected) {
      case 'continue': SATG.audio.click(); this.beginNextModule(); return;
      case 'analysis': SATG.audio.click(); this.toAnalysis(); return;
      case 'retry':    this.startRun(false); return;
      case 'quit':
      case 'menu':     this.toTitle(); return;
    }
  }

  toAnalysis() {
    this.analysis.reset(this.result);
    this.analysisFrom = 'results';
    this.state = 'analysis';
  }

  /* One click on the analysis screen. Everything it can do is here rather than
     inside the screen, so the screen stays a renderer and the game keeps the
     side effects - opening a browser tab, changing state, playing a sound. */
  activateAnalysis(hit) {
    if (!hit) return;
    switch (hit.kind) {
      case 'view':
        this.analysis.press('view' + hit.key);
        SATG.audio.click();
        this.analysis.setView(hit.key);
        return;
      case 'depth':
        this.analysis.press('depth' + hit.key);
        SATG.audio.click();
        this.analysis.setDepth(hit.key);
        return;
      case 'save':
        this.analysis.press('save');
        SATG.audio.click();
        this.analysis.save();
        return;
      case 'text':
        this.analysis.press('text');
        this.openTextAnalysis();
        return;
      case 'open-print':
        this.analysis.press('open-print');
        SATG.audio.click();
        /* Whatever the screen is showing, not whatever ran last. Reading
           this.result printed the previous run's document when the report on
           screen had been reopened from the history. */
        SATG.printDoc.open(this.analysis.data);
        return;
      case 'item':
        SATG.audio.click();
        this.analysis.openCard(this.analysis.cardForItem(hit.index));
        return;
      case 'qtype':
        SATG.audio.click();
        this.analysis.openCard(this.analysis.cardForQType(hit.qtype));
        return;
      case 'link':
        SATG.audio.click();
        /* A study link leaves the game, so it opens in a new tab rather than
           navigating away from a run the player may not have finished with.
           noopener because the opened page must not get a handle back. */
        if (hit.url) global.open(hit.url, '_blank', 'noopener');
        return;
      case 'back':
        this.analysis.press('back');
        SATG.audio.click();
        if (!this.analysis.closeCard()) this.leaveAnalysis();
        return;
    }
  }

  /* BACK out of the report goes wherever the report was opened from.

     Reached from a finished run it returns to the score screen; reached from
     the history it returns to STATS. Sending both to the score screen would
     show someone browsing old reviews the result of a run they finished an hour
     ago, which reads as the game having lost their place. */
  leaveAnalysis() {
    if (this.analysisFrom === 'stats') { this.restoreStats(); return; }
    this.state = 'results';
  }

  /* ==================================================================== */
  /* TEXT ANALYSIS - the paper, afterwards                                 */
  /* ==================================================================== */

  /* A second sheet, built the first time anybody asks for one.

     Not the exam paper. That one is bound into the 3D scene as the texture on
     the desk and is the live sheet a resumed run writes back onto; borrowing it
     to display a finished question would put a review of last week's test on
     the table in front of a player who is still sitting an exam. */
  get reviewPaper() {
    if (!this._reviewPaper) this._reviewPaper = new SATG.Paper(this.pipeline.gl);
    return this._reviewPaper;
  }

  openTextAnalysis() {
    const items = ((this.analysis.data && this.analysis.data.items) || [])
      .filter((i) => i && i.paper);
    if (!items.length) return false;
    this.reviewAt = 0;
    this.reviewPaper.setReview(items[0], 0, items);
    this.resetPaperView();
    this.state = 'paperReview';
    SATG.audio.paperRustle(false);
    return true;
  }

  goReview(d) {
    const p = this.reviewPaper;
    const items = p.reviewItems || [];
    const next = clamp(this.reviewAt + d, 0, items.length - 1);
    if (next === this.reviewAt) return false;
    this.reviewAt = next;
    p.fx.press(d > 0 ? 'next' : 'prev');
    p.setReview(items[next], next, items);
    SATG.audio.paperRustle(d > 0);
    return true;
  }

  jumpReview(i) {
    const p = this.reviewPaper;
    const items = p.reviewItems || [];
    if (i < 0 || i >= items.length || i === this.reviewAt) return false;
    this.reviewAt = i;
    p.setReview(items[i], i, items);
    SATG.audio.click(1400);
    return true;
  }

  closeTextAnalysis() {
    this.reviewPaper.clearReview();
    this.resetPaperView();
    SATG.audio.paperRustle(true);
    this.state = 'analysis';
  }

  /* Click anywhere on the review sheet. Same local-coordinate conversion the
     held sheet uses during a run, so zooming and panning behave identically. */
  reviewPointerDown(u, v) {
    const local = rectToLocal(this.paperRect(), u, v);
    if (!local) return;
    const hit = this.reviewPaper.hitTest(local.u, local.v);
    if (!hit) return;
    if (hit.type === 'info') {
      SATG.audio.paperRustle(!this.reviewPaper.reviewBack);
      this.reviewPaper.flipReview();
      return;
    }
    if (hit.type === 'prev') { this.goReview(-1); return; }
    if (hit.type === 'next') { this.goReview(1); return; }
    if (hit.type === 'reviewJump') { this.jumpReview(hit.index); return; }
  }

  /* Back into STATS without resetting it - the tab and scroll position are
     where the player left them. openStats() is this plus a reset, for arriving
     from the title menu. */
  restoreStats() {
    SATG.account.load();
    SATG.account.onChange = () => { this.stats.refresh(); };
    this.stats.refresh();
    this.state = 'stats';
    const spot = this.stats.buttonSpot();
    SATG.account.place(spot.u, spot.v);
    SATG.account.show(true);
    // The email form places itself from the frame loop; see syncCloudPanel().
  }

  /* Open a report over the top of STATS.

     The sign-in and cloud panels are real DOM elements sitting over the canvas,
     and they do not belong over a report - an overlay that is merely invisible
     still swallows the clicks meant for what is behind it. So they are taken
     down here and put back by restoreStats(). */
  toAnalysisFrom(result, opts) {
    if (!result) return false;
    SATG.account.show(false);
    SATG.cloud.hidePanel();
    this.analysis.reset(result, opts);
    this.analysisFrom = 'stats';
    this.state = 'analysis';
    return true;
  }

  openSavedReview(at) {
    const stored = SATG.profile.review(at);
    const result = SATG.profile.reviewAsResult(stored);
    // Already in the record: offering to save it again would store a duplicate.
    return this.toAnalysisFrom(result, { saved: true, note: 'FROM YOUR HISTORY.' });
  }

  /* The lifetime report. Not savable - it is a view OF the record, so saving it
     into the record would be a copy that goes stale the next time you play -
     and not printable, because the printable document is built around one
     sitting and there is no such thing for "everything". */
  openCombinedReview() {
    return this.toAnalysisFrom(SATG.profile.combined(),
                               { saveable: false, printable: false, depth: 'detailed' });
  }

  /* ==================================================================== */
  /* Update                                                                */
  /* ==================================================================== */

  update(dt) {
    this.fader.update(dt);
    this.pipeline.time += dt;

    /* Music follows the screen. Asked every frame rather than pushed from the
       twenty-odd places that assign this.state, because one of those would
       eventually be added without the push and the menu track would play
       through an exam. Costs a property lookup and a comparison. */
    SATG.music.forState(this.state);

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

      case 'opening':
        this.opening.update(dt);
        if (this.opening.done) this.finishOpening();
        break;

      case 'intro':
        this.introT = Math.min(1, this.introT + dt / 3.4);
        this.scene.applyCamera(this.pipeline.camera, this.introT, 0, 0);
        if (this.introT >= 1) this.state = 'exam';
        break;

      case 'exam':
        /* Both, in this order and unconditionally. The exam updating while
           the menu is up is the entire point: the clock keeps running, the
           ten-second cue still starts, and a module still ends on time with
           the panel open. */
        this.updateExam(dt, panic);
        this.escMenu.update(dt);
        break;

      case 'verdict':
        this.updateVerdict(dt);
        break;

      case 'results':
      case 'moduleBreak':
        /* Hover has to be pushed in every frame: the screen is a canvas, so
           there is no element to receive a mouseover. */
        this.results.setHover(this.mouse.u, this.mouse.v);
        this.results.update(dt);
        break;

      case 'analysis':
        this.analysis.update(dt);
        break;

      case 'paperReview':
        // Keeps the arrow presses animating; the sheet has no caret to blink.
        this.reviewPaper.update(dt);
        break;

      case 'types':
        this.typePicker.update(dt);
        // The room drifts behind the picker, as on the title card.
        this.scene.applyCamera(this.pipeline.camera, 1,
          Math.sin(this.pipeline.time * 0.09) * 0.16 - 0.22,
          Math.sin(this.pipeline.time * 0.07) * 0.05 + 0.06);
        break;

      case 'feedback':
        this.feedback.update(dt);
        // The room keeps drifting behind the panel, as on the title card.
        this.scene.applyCamera(this.pipeline.camera, 1,
          Math.sin(this.pipeline.time * 0.09) * 0.16 - 0.22,
          Math.sin(this.pipeline.time * 0.07) * 0.05 + 0.06);
        break;

      case 'settings':
        this.settings.update(dt);
        this.scene.applyCamera(this.pipeline.camera, 1,
          Math.sin(this.pipeline.time * 0.09) * 0.16 - 0.22,
          Math.sin(this.pipeline.time * 0.07) * 0.05 + 0.06);
        break;

      case 'stats':
        this.stats.update(dt);
        this.syncCloudPanel();
        break;
    }

    /* Grain and colour split rise with the pressure - unless the player has
       asked them not to, in which case the panic term is dropped and the base
       level is held. The scale factors come from the settings page and are
       applied here, every frame, because these three are rewritten every
       frame: setting them once when the slider moves would last exactly until
       the next tick. */
    const S = SATG.settings.values;
    const p = S.calmPanic ? 0 : panic;
    this.pipeline.brightness = S.brightness;
    this.pipeline.grade.grain = (0.05 + p * 0.06) * S.grain;
    this.pipeline.grade.vignette = (0.58 + p * 0.22) * S.vignette;
    this.pipeline.grade.aberration = 0.14 + p * 0.35;
    /* The opening runs its fades off its own timeline - see the note in
       startRun - so for those thirty seconds it, and not the fader, decides
       how much of the frame the player is allowed to see. */
    this.pipeline.fade = this.state === 'opening'
      ? this.opening.fade() : this.fader.value;
  }

  /* The machine is deciding. The exam clock is deliberately NOT running: the
     scan takes the best part of a second, and charging that to the question
     the player has already answered could kill them for a right answer. */
  updateVerdict(dt) {
    this.verdict.update(dt);

    const cam = this.pipeline.camera;
    const k = this.verdict.cameraKick(this._kick);

    this.scene.applyCamera(cam, 1, this.lookYaw, this.lookPitch);
    cam.position[0] += k.x;
    cam.position[1] += k.y;
    cam.position[2] += k.z;
    cam.pitch += k.pitch;
    cam.roll += k.roll;

    this.scene.tableFlip = this.verdict.tableFlip();
  }

  /* Start or stop what the machine is heard doing, from what the run IS.

     Asked every frame rather than pushed at the two or three places a run
     changes shape, because both calls are idempotent and because the
     MACHINE SOUND setting can be turned back on in the middle of a run - a
     flag consulted once at the start would leave the machine mute until the
     player died. */
  syncMachineAudio(panic) {
    if (this.isInfinity) {
      SATG.audio.startMachineBed();
      SATG.audio.startWheel();
      SATG.audio.setMachineIntensity(panic);
    } else {
      /* A full SAT: the wheel still turns - the scene animates it either way -
         but the room stays quiet around it. */
      SATG.audio.stopMachineBed(false);
      SATG.audio.stopWheel();
    }
  }

  updateExam(dt, panic) {
    this.scene.applyCamera(this.pipeline.camera, 1, this.lookYaw, this.lookPitch);
    this.syncMachineAudio(panic);
    // The desk is upright again; only a blast puts it over.
    this.scene.tableFlip = 0;

    /* The clock, on the machine's own panel. Same two formats the HUD picks
       between and for the same reason: tenths are the tension on a one-minute
       Infinity timer and are noise on a thirty-two-minute module. */
    const left = Math.max(0, this.timeLeft);
    this.scene.machine.readout.setTimer(this.timeLimit > 120
      ? Math.floor(left / 60) + ':' + String(Math.floor(left % 60)).padStart(2, '0')
      : left.toFixed(1));

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
    this.runElapsed += dt;
    // The module owns the clock on a module test, so the module is where the
    // remaining time has to be written back - otherwise paging between
    // questions reloads the module's stale timeLeft and the clock jumps back.
    if (this.form && this.form.module) {
      this.form.module.timeLeft = this.timeLeft;
      /* And charge the same second to whichever question is on screen, so the
         report can say where the time actually went. Deliberately in the same
         place as the clock: any path that advances one advances the other, and
         a question can never accrue time the module did not. */
      this.form.module.spend(dt);
    } else if (this.isInfinity) {
      this._questionTime = (this._questionTime || 0) + dt;
    }

    // The last ten seconds: the cue starts and swells until the shot.
    if (this.timeLeft <= QB.PANIC_SECONDS) {
      if (!this.panicStarted) { SATG.audio.startTension(); this.panicStarted = true; }
      SATG.audio.setTensionIntensity(panic);
    }

    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      if (this.form) this.finishModule('timeout');
      else this.die('timeout');
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

  /* Lifted and shortened so the bottom row of keys clears the prompt band.
     At 0.86 centred, the last row - which carries GRAPH - sat underneath it
     and could be read but not aimed at. */
  calcRect() { return this.fitRect(this.calculator.handAspect, 0.80, -0.035); }

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

    if (this.state === 'results' || this.state === 'moduleBreak' ||
        this.state === 'exiting') {
      P.beginFlat(0, 0, 0);
    } else if (this.state === 'opening' && this.opening.inCorridor) {
      /* A different world entirely for the first eighteen seconds. The cut
         between the two happens under the white flash of the door giving
         way, which is the only frame it could hide in. */
      this.opening.corridor.render(P);
      P.endWorld();
    } else {
      this.scene.render(P);
      P.endWorld();
    }

    P.beginOverlays();

    switch (this.state) {
      case 'opening':
        this.opening.renderOverlays(P);
        break;

      case 'verdict':
        this.renderExamOverlays(P);
        // Over the top of everything, including the HUD.
        this.verdict.drawFire(P);
        break;

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
        if (this.escMenu.open) {
          this.escMenu.resize(P.compRT.width, P.compRT.height, P.uiScale);
          this.escMenu.render();
          P.drawOverlay(this.escMenu.texture, { x: 0, y: 0, w: 1, h: 1 });
          /* The reticle is drawn UNDER the panel by renderExamOverlays, so a
             second one goes on top or the buttons cannot be aimed at.

             drawReticleOver, not renderHudCursorOnly. The latter calls
             hud.set() with an empty prompt, and renderHud() had just set the
             real one - so the two would fight, marking the prompt band dirty
             on every single frame the menu was open and re-uploading a
             full-width strip at 60fps. That is the exact texture-traffic
             pattern that tore the sheet into blocks before, and it would have
             been invisible in every check that did not measure uploads. */
          this.drawReticleOver(P);
        }
        break;

      case 'results':
      case 'moduleBreak':
        // Same reason as the title card above. renderExitScreen already did
        // this for the 'exiting' state, but dying is the common path and it
        // was the one left out.
        this.results.resize(P.compRT.width, P.compRT.height, P.uiScale);
        this.results.render();
        P.drawOverlay(this.results.texture, { x: 0, y: 0, w: 1, h: 1 });
        this.renderHudCursorOnly(P);
        break;

      case 'analysis':
        this.analysis.resize(P.compRT.width, P.compRT.height, P.uiScale);
        this.analysis.render();
        P.drawOverlay(this.analysis.texture, { x: 0, y: 0, w: 1, h: 1 });
        this.renderHudCursorOnly(P);
        break;

      case 'paperReview':
        /* Drawn exactly as the held sheet is during a run - same scrim, same
           rect, same zoom - because it is the same object being read. The room
           stays behind it rather than being blacked out: this is a sheet being
           looked at, not a menu. */
        this.reviewPaper.render();
        P.fillRect({ x: 0, y: 0, w: 1, h: 1 }, [0, 0, 0, 0.72]);
        P.drawOverlay(this.reviewPaper.texture, this.paperRect());
        this.renderHudCursorOnly(P);
        break;

      case 'types':
        this.typePicker.resize(P.compRT.width, P.compRT.height, P.uiScale);
        this.typePicker.render();
        P.drawOverlay(this.typePicker.texture, { x: 0, y: 0, w: 1, h: 1 });
        this.renderHudCursorOnly(P);
        break;

      case 'feedback':
        this.feedback.resize(P.compRT.width, P.compRT.height, P.uiScale);
        this.feedback.render();
        P.drawOverlay(this.feedback.texture, { x: 0, y: 0, w: 1, h: 1 });
        // A pointer, or the buttons cannot be aimed at.
        this.renderHudCursorOnly(P);
        break;

      case 'settings':
        this.settings.resize(P.compRT.width, P.compRT.height, P.uiScale);
        this.settings.render();
        P.drawOverlay(this.settings.texture, { x: 0, y: 0, w: 1, h: 1 });
        this.renderHudCursorOnly(P);
        break;

      case 'stats':
        this.stats.resize(P.compRT.width, P.compRT.height, P.uiScale);
        this.stats.render();
        P.drawOverlay(this.stats.texture, { x: 0, y: 0, w: 1, h: 1 });
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
    /* The intro plays without a HUD; the clock starts when the player is up.
       So does the blast - a reticle floating over the fire would be the one
       thing on screen insisting this is still a game with a cursor in it. */
    if (this.state === 'intro' || this.verdict.blasting) return;

    this.hud.resize(P.compRT.width, P.compRT.height, P.uiScale);

    let prompt = '';
    /* Nothing in the room can be reached while the panel is up, so promising
       "CLICK - TAKE THE PAPER" would be a lie. Blanking it here also keeps the
       band stable rather than changing as the cursor drifts over the desk
       behind the menu. */
    if (this.escMenu.open) {
      prompt = '';
    } else if (this.hold === HOLD.NONE) {
      if (this.hoverTarget === 'paper') prompt = 'CLICK - TAKE THE PAPER';
      else if (this.hoverTarget === 'calculator') prompt = 'CLICK - TAKE THE CALCULATOR';
    } else if (this.hold === HOLD.PAPER) {
      const zoomHint = this.paperZoom > 1.01
        ? '(SCROLL) TO ZOOM  DRAG TO MOVE'
        : '(SCROLL) TO ZOOM';
      const answerHint = this.question && this.question.format === 'grid'
        ? 'TYPE YOUR ANSWER' : 'CLICK TO SELECT';
      /* On a module test ENTER advances rather than commits, and the arrows
         page - the player has to be told, because nothing else on screen says
         that going back is allowed, and going back is the whole point. */
      prompt = this.form
        ? answerHint + '    ' + zoomHint + '    ARROWS - MOVE    ENTER - NEXT    ESC - SET DOWN'
        : answerHint + '    ' + zoomHint + '    ENTER - SUBMIT    ESC - SET DOWN';
    } else if (this.hold === HOLD.CALC) {
      prompt = 'CLICK KEYS    TAB - GRAPH    ESC - SET DOWN';
    }

    this.hud.set({
      timeLeft: this.timeLeft,
      timeLimit: this.timeLimit,
      prompt,
      // Nothing is graded during a module, so there is no "cleared" count to
      // show - only how many of the module's questions have been filled in.
      /* A drill shows right-out-of-answered, as the brief asked: the run cannot
         end on a wrong answer, so a bare "cleared" count would only ever climb
         and would hide the misses entirely - which are the reason for drilling
         in the first place. */
      cleared: this.isDrill
        ? this.bank.totalCorrect + ' / ' +
          (this.bank.totalCorrect + this.bank.totalWrong)
        : (this.form ? this.form.module.answeredCount : this.cleared),
      countLabel: this.isDrill ? 'CORRECT' : (this.form ? 'ANSWERED' : 'CLEARED'),
      cursor: cursorStyle,
      usePointer: true,
      pointer: { u: this.mouse.u, v: this.mouse.v }
    });
    // draw() composites the HUD's three layers itself: the rarely-changing
    // base, the small clock strip, and the reticle sprite.
    this.hud.draw(P);
  }

  /* Just the pointer sprite, changing no HUD state at all. Used when the HUD
     has already been set up this frame and only needs a cursor drawn over the
     top of something else. */
  drawReticleOver(P) {
    const tex = this.hud.reticle.get('bright');
    if (!tex) return;
    const s = this.hud.s;
    const w = 32 * s / this.hud.W, h = 32 * s / this.hud.H;
    P.drawOverlay(tex, {
      x: this.mouse.u - w / 2, y: this.mouse.v - h / 2, w: w, h: h
    });
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
