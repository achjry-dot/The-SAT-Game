/* =========================================================================
   audio.js - every sound in the game is synthesised here at runtime.

   No audio files, for the same reason there are no texture files: the game
   has to run straight off the file system. Web Audio is more than capable of
   the whole palette - a room tone, a bell, an explosion with its echo, the
   machine's bed and wheel, a corridor of footsteps and settling pipework, and
   a tension cue that swells under the last ten seconds of the clock.

   The context is created lazily on the first real user gesture, because every
   current browser refuses to start audio before one.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;
const { clamp } = SATG.util;

const state = {
  ctx: null,
  master: null,
  ready: false,
  muted: false,
  noiseBuffer: null,
  ambience: null,
  tension: null,
  volume: 0.85,
  explosionScale: 1,
  /* The machine's own noises - its bed, its wheel, its clanks - answer to a
     switch of their own, because the device is present in every run and a
     player who wants the room quiet should not have to mute the whole game to
     get it. The machine still stands there and still detonates either way. */
  machineAudio: true,
  machine: null,
  wheel: null
};

/* ------------------------------------------------------------------ core */

function init() {
  if (state.ctx) return state.ctx;
  const AC = global.AudioContext || global.webkitAudioContext;
  if (!AC) { console.warn('[audio] Web Audio unavailable; running silent'); return null; }

  const ctx = new AC();
  const master = ctx.createGain();
  /* Not a literal. The audio graph is not built until the player's first
     click, which is long after the settings file has been read, so hard-coding
     the level here silently discarded a saved volume the instant any sound
     was needed. state.volume already holds the right number by then. */
  master.gain.value = state.muted ? 0 : state.volume;

  // A gentle ceiling. The explosion is deliberately the loudest thing in the
  // game and without this it clips hard enough to sound like a bug.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.18;

  master.connect(limiter);
  limiter.connect(ctx.destination);

  state.ctx = ctx;
  state.master = master;
  state.ready = true;
  state.noiseBuffer = makeNoiseBuffer(ctx, 2.0);
  return ctx;
}

function resume() {
  if (state.ctx && state.ctx.state === 'suspended') state.ctx.resume();
}

function now() { return state.ctx ? state.ctx.currentTime : 0; }

function makeNoiseBuffer(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function noiseSource(loop) {
  const src = state.ctx.createBufferSource();
  src.buffer = state.noiseBuffer;
  src.loop = !!loop;
  return src;
}

/* Small helpers so the cue code below reads as intent rather than plumbing. */
function osc(type, freq, t) {
  const o = state.ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  return o;
}

function gain(v) {
  const g = state.ctx.createGain();
  g.gain.value = v === undefined ? 1 : v;
  return g;
}

function filter(type, freq, q) {
  const f = state.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  if (q !== undefined) f.Q.value = q;
  return f;
}

/* Percussive envelope: near-instant attack, exponential tail. */
function envelope(g, t, peak, attack, decay) {
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

/* =========================================================================
   One-shots
   ========================================================================= */

/* Correct answer. A struck bell: two partials a fifth apart plus a bright
   inharmonic top, which is what stops a pair of sines sounding like a test
   tone. Short, clean, and a genuine relief against the room tone. */
function ding() {
  if (!state.ready || state.muted) return;
  const t = now();
  const out = gain(0.0001);
  out.connect(state.master);

  const partials = [
    { f: 1318.5, a: 0.5,  d: 0.9 },   // E6
    { f: 1975.5, a: 0.28, d: 0.7 },   // B6
    { f: 2637.0, a: 0.12, d: 0.45 },  // E7
    { f: 3520.0, a: 0.07, d: 0.25 }   // inharmonic shimmer
  ];

  for (const p of partials) {
    const o = osc('sine', p.f, t);
    const g = gain(0);
    envelope(g, t, p.a, 0.004, p.d);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + p.d + 0.1);
  }

  out.gain.setValueAtTime(0.55, t);
  window.setTimeout(() => out.disconnect(), 1400);
}

/* The machine detonating: a wrong answer, or the clock running out. The
   loudest event in the game, and the one every run ends on.

   Five layers plus an echo. The echo is the part that makes it read as a
   BLAST rather than a bang - a concrete room this size returns the low end
   several times and dulls it a little more each pass, so the tail is a delay
   fed back through a lowpass rather than a fixed repeat. */
function explosion() {
  if (!state.ready || state.muted || state.explosionScale <= 0) return;
  const t = now();
  const out = gain(state.explosionScale);
  out.connect(state.master);

  /* ---- the echo.

     Three delay lines rather than one, at lengths with no common divisor, so
     the repeats interleave instead of landing on top of each other. One
     repeat is a slapback and sounds like a small room; three at prime-ish
     intervals, each fed back through its own lowpass, is a valley - the sound
     going out, hitting something a long way off, and coming back duller every
     time. That is the whole difference between a bang and a detonation.

     Feedback below 1 decays on its own, so nothing has to schedule the
     repeats; they run out, and the disconnect at the bottom collects the
     nodes once they are inaudible. */
  const dry = gain(1);
  dry.connect(out);

  const taps = [];
  for (const [time, fbAmt, cut, level] of [
    [0.19, 0.66, 1600, 0.55],
    [0.41, 0.62, 900, 0.60],
    [0.73, 0.58, 520, 0.52]
  ]) {
    const dly = state.ctx.createDelay(1.5);
    dly.delayTime.value = time;
    const lp = filter('lowpass', cut, 0.4);
    const fb = gain(fbAmt);
    dly.connect(lp); lp.connect(fb); fb.connect(dly);
    const wet = gain(level);
    dly.connect(wet); wet.connect(out);
    dry.connect(dly);
    taps.push(fb);
  }

  // 1. ignition - the sharp edge before the pressure wave
  const crack = noiseSource(false);
  const crackHp = filter('highpass', 2600, 0.7);
  const crackGain = gain(0);
  envelope(crackGain, t, 0.85, 0.001, 0.05);
  crack.connect(crackHp); crackHp.connect(crackGain); crackGain.connect(dry);
  crack.start(t); crack.stop(t + 0.2);

  /* 2. body - broadband, collapsing over a second and a half from bright to
     nothing but bottom end. The long sweep is what makes the size: a fast one
     is a gunshot, and the only thing separating the two is how long the top
     end takes to leave. */
  const body = noiseSource(false);
  const bodyLp = filter('lowpass', 6000, 1.1);
  bodyLp.frequency.setValueAtTime(6000, t);
  bodyLp.frequency.exponentialRampToValueAtTime(90, t + 1.5);
  const bodyGain = gain(0);
  envelope(bodyGain, t, 1.0, 0.004, 1.60);
  body.connect(bodyLp); bodyLp.connect(bodyGain); bodyGain.connect(dry);
  body.start(t); body.stop(t + 2.2);

  /* 3. sub - the concussion, felt rather than heard. Taken all the way down
     to 16 Hz, below where it is a pitch at all, over a second and a quarter. */
  const sub = osc('sine', 74, t);
  sub.frequency.exponentialRampToValueAtTime(16, t + 1.25);
  const subGain = gain(0);
  envelope(subGain, t, 1.0, 0.008, 1.45);
  sub.connect(subGain); subGain.connect(dry);
  sub.start(t); sub.stop(t + 1.9);

  /* 3b. a second sub a fifth above the first, detuned against it. Two low
     sines beating slowly is the difference between a note and a pressure
     front - the beat is what makes it feel like it is still arriving. */
  const sub2 = osc('sine', 110, t);
  sub2.frequency.exponentialRampToValueAtTime(23, t + 1.1);
  const sub2Gain = gain(0);
  envelope(sub2Gain, t, 0.55, 0.012, 1.20);
  sub2.connect(sub2Gain); sub2Gain.connect(dry);
  sub2.start(t); sub2.stop(t + 1.7);

  /* 4. debris - the machine coming apart. Scattered rather than regular:
     evenly spaced fragments read as a rhythm, and a rhythm reads as music. */
  for (let i = 0; i < 8; i++) {
    const at = t + 0.05 + Math.random() * 0.62;
    const frag = noiseSource(false);
    const bp = filter('bandpass', 700 + Math.random() * 2600, 4.0);
    const g = gain(0);
    envelope(g, at, 0.14 + Math.random() * 0.16, 0.002, 0.05 + Math.random() * 0.10);
    frag.connect(bp); bp.connect(g); g.connect(dry);
    frag.start(at); frag.stop(at + 0.25);
  }

  /* 5. roll - the long burn underneath everything, and the part that sells
     the scale. It swells rather than decaying: the sound of an explosion at
     distance arrives, peaks a moment later, and takes several seconds to go,
     and a tail that starts loud and fades is the shape of a small one. */
  const roll = noiseSource(true);
  const rollLp = filter('lowpass', 900, 0.7);
  rollLp.frequency.setValueAtTime(900, t);
  rollLp.frequency.exponentialRampToValueAtTime(150, t + 3.4);
  const rollGain = gain(0.0001);
  rollGain.gain.setValueAtTime(0.0001, t);
  rollGain.gain.exponentialRampToValueAtTime(0.42, t + 0.35);
  rollGain.gain.exponentialRampToValueAtTime(0.0001, t + 3.6);
  roll.connect(rollLp); rollLp.connect(rollGain); rollGain.connect(dry);
  roll.start(t); roll.stop(t + 4.0);

  /* Long enough for three feedback loops to fall below hearing. Cutting this
     short chops the echo off mid-repeat, which is far more noticeable than
     having no echo at all. */
  window.setTimeout(() => {
    for (const fb of taps) { try { fb.disconnect(); } catch (e) { /* gone */ } }
    out.disconnect();
  }, 7000);
}

/* Menu movement. A dry, quiet contact click - no pitch, no musicality. */
function click(pitch) {
  if (!state.ready || state.muted) return;
  const t = now();
  const out = gain(0.3);
  out.connect(state.master);

  const n = noiseSource(false);
  const bp = filter('bandpass', pitch || 1800, 3.0);
  const g = gain(0);
  envelope(g, t, 0.5, 0.001, 0.035);
  n.connect(bp); bp.connect(g); g.connect(out);
  n.start(t); n.stop(t + 0.1);
  window.setTimeout(() => out.disconnect(), 300);
}

/* Terminal confirmation blip, for the calculator and menu selection. */
function beep(freq, dur) {
  if (!state.ready || state.muted) return;
  const t = now();
  const out = gain(0.18);
  out.connect(state.master);
  const o = osc('square', freq || 880, t);
  const g = gain(0);
  const d = dur || 0.06;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.005);
  g.gain.setValueAtTime(0.5, t + d);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.03);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + d + 0.08);
  window.setTimeout(() => out.disconnect(), (d + 0.3) * 1000);
}

/* Sheet of paper being lifted or set down. Filtered noise with a wobble. */
function paperRustle(down) {
  if (!state.ready || state.muted) return;
  const t = now();
  const out = gain(0.35);
  out.connect(state.master);

  const n = noiseSource(false);
  const hp = filter('highpass', 1400, 0.5);
  const bp = filter('bandpass', down ? 2600 : 3400, 1.1);
  bp.frequency.setValueAtTime(down ? 3200 : 2400, t);
  bp.frequency.linearRampToValueAtTime(down ? 1800 : 3800, t + 0.22);
  const g = gain(0);
  envelope(g, t, 0.45, 0.02, 0.24);
  n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(out);
  n.start(t); n.stop(t + 0.5);
  window.setTimeout(() => out.disconnect(), 800);
}

/* Calculator key. Hard plastic, slightly hollow. */
function calcKey() {
  if (!state.ready || state.muted) return;
  const t = now();
  const out = gain(0.28);
  out.connect(state.master);

  const n = noiseSource(false);
  const bp = filter('bandpass', 2400 + Math.random() * 600, 5.0);
  const g = gain(0);
  envelope(g, t, 0.6, 0.001, 0.028);
  n.connect(bp); bp.connect(g); g.connect(out);
  n.start(t); n.stop(t + 0.1);

  const body = osc('triangle', 320 + Math.random() * 80, t);
  const bg = gain(0);
  envelope(bg, t, 0.18, 0.002, 0.04);
  body.connect(bg); bg.connect(out);
  body.start(t); body.stop(t + 0.12);

  window.setTimeout(() => out.disconnect(), 400);
}

/* Heavy metal latch - the seat restraint closing during the intro. */
function latch() {
  if (!state.ready || state.muted) return;
  const t = now();
  const out = gain(0.6);
  out.connect(state.master);

  const n = noiseSource(false);
  const bp = filter('bandpass', 900, 2.0);
  const g = gain(0);
  envelope(g, t, 0.7, 0.002, 0.12);
  n.connect(bp); bp.connect(g); g.connect(out);
  n.start(t); n.stop(t + 0.3);

  const clank = osc('triangle', 180, t);
  clank.frequency.exponentialRampToValueAtTime(90, t + 0.18);
  const cg = gain(0);
  envelope(cg, t, 0.5, 0.003, 0.22);
  clank.connect(cg); cg.connect(out);
  clank.start(t); clank.stop(t + 0.45);

  window.setTimeout(() => out.disconnect(), 900);
}

/* =========================================================================
   The machine

   Everything below answers to setMachineAudio(). The device is present in
   every run whatever the player has chosen; this only decides whether it is
   heard.
   ========================================================================= */

function setMachineAudio(on) {
  state.machineAudio = !!on;
  if (!state.machineAudio) { stopMachineBed(true); stopWheel(); }
}

function machineAudible() {
  return state.ready && !state.muted && state.machineAudio;
}

/* Heavy industrial plant, idling. A rumble you feel through the floor, a
   whirr from something spinning up inside it, and a band of air being pushed
   through ducting. Held as a rig and driven by intensity - the same shape the
   tension cue uses - because the brief is that it gets louder and more urgent
   as the player runs out of clock, not that it plays a fixed loop. */
function startMachineBed() {
  if (!machineAudible() || state.machine) return;
  const t = now();

  const out = gain(0.0001);
  out.connect(state.master);
  out.gain.exponentialRampToValueAtTime(0.09, t + 1.4);

  const nodes = [];

  // Rumble: two low saws a fifth apart, filtered to almost nothing but weight.
  const rumbleLp = filter('lowpass', 190, 1.0);
  rumbleLp.connect(out);
  for (const [f, a] of [[37, 0.34], [55.5, 0.20], [24.5, 0.16]]) {
    const o = osc('sawtooth', f, t);
    const g = gain(a);
    o.connect(g); g.connect(rumbleLp);
    o.start(t);
    nodes.push(o);
  }

  /* Whirr: a resonant band swept by a slow LFO, which is what turns a static
     saw into something rotating. The LFO depth is deliberately wide - a
     shallow one sounds like vibrato rather than machinery. */
  const whirr = osc('sawtooth', 158, t);
  const whirrBp = filter('bandpass', 520, 7.0);
  const whirrGain = gain(0.085);
  whirr.connect(whirrBp); whirrBp.connect(whirrGain); whirrGain.connect(out);
  whirr.start(t);
  nodes.push(whirr);

  const wobble = osc('sine', 3.1, t);
  const wobbleDepth = gain(230);
  wobble.connect(wobbleDepth); wobbleDepth.connect(whirrBp.frequency);
  wobble.start(t);
  nodes.push(wobble);

  // Ducted air.
  const air = noiseSource(true);
  const airBp = filter('bandpass', 620, 0.7);
  const airGain = gain(0.05);
  air.connect(airBp); airBp.connect(airGain); airGain.connect(out);
  air.start(t);
  nodes.push(air);

  state.machine = { out, nodes, rumbleLp, whirr, whirrBp, wobble, airGain, intensity: 0 };
  setMachineIntensity(0);
}

/**
 * @param {number} k 0 while the machine is merely idling, 1 when the player
 *   is about to lose. Drives level, pitch and how hard the whirr swings.
 */
function setMachineIntensity(k) {
  const M = state.machine;
  if (!M) return;
  k = clamp(k, 0, 1);
  M.intensity = k;
  const t = now();
  const ramp = 0.12;

  M.out.gain.setTargetAtTime(0.09 + k * k * 0.30, t, ramp);
  M.rumbleLp.frequency.setTargetAtTime(190 + k * 420, t, ramp);
  M.whirr.frequency.setTargetAtTime(158 + k * 330, t, ramp);
  M.wobble.frequency.setTargetAtTime(3.1 + k * 9.0, t, ramp);
  M.airGain.gain.setTargetAtTime(0.05 + k * 0.13, t, ramp);
}

function stopMachineBed(immediate) {
  const M = state.machine;
  if (!M) return;
  state.machine = null;
  const t = now();
  const fall = immediate ? 0.06 : 0.7;
  M.out.gain.cancelScheduledValues(t);
  M.out.gain.setValueAtTime(Math.max(M.out.gain.value, 0.0001), t);
  M.out.gain.exponentialRampToValueAtTime(0.0001, t + fall);
  window.setTimeout(() => {
    M.nodes.forEach((n) => { try { n.stop(); } catch (e) { /* already stopped */ } });
    M.out.disconnect();
  }, (fall + 0.3) * 1000);
}

/* The wheel on the machine's flank, turning for as long as the run lasts.

   Two parts: a bearing that never stops, and a tick every time a spoke passes
   the housing. The tick interval is randomised because a fixed one is a
   metronome, and the whole character of this thing is that it is worn out. */
function startWheel() {
  if (!machineAudible() || state.wheel) return;
  const t = now();

  const out = gain(0.0001);
  out.connect(state.master);
  out.gain.exponentialRampToValueAtTime(0.16, t + 1.0);

  // Bearing: a narrow band of noise, drifting, so it never sits still.
  const bearing = noiseSource(true);
  const bp = filter('bandpass', 280, 1.6);
  const bg = gain(0.34);
  bearing.connect(bp); bp.connect(bg); bg.connect(out);
  bearing.start(t);

  const drift = osc('sine', 0.83, t);
  const driftDepth = gain(110);
  drift.connect(driftDepth); driftDepth.connect(bp.frequency);
  drift.start(t);

  const W = { out, nodes: [bearing, drift], timer: 0, alive: true };
  state.wheel = W;

  const tick = () => {
    if (!W.alive) return;
    wheelTick(W.out);
    W.timer = window.setTimeout(tick, 120 + Math.random() * 210);
  };
  W.timer = window.setTimeout(tick, 260);
}

/* One spoke going past. Every so often the bearing catches and squeals - a
   dry rhythm of identical clicks stops sounding like metal after about ten
   seconds, and this run lasts a great deal longer than that. */
function wheelTick(out) {
  const t = now();

  const n = noiseSource(false);
  const bp = filter('bandpass', 1100 + Math.random() * 1500, 6.0);
  const g = gain(0);
  envelope(g, t, 0.22 + Math.random() * 0.18, 0.001, 0.03 + Math.random() * 0.04);
  n.connect(bp); bp.connect(g); g.connect(out);
  n.start(t); n.stop(t + 0.15);

  if (Math.random() < 0.16) {
    const squeal = osc('sawtooth', 900 + Math.random() * 700, t);
    squeal.frequency.linearRampToValueAtTime(1500 + Math.random() * 900, t + 0.22);
    const sbp = filter('bandpass', 2200, 9.0);
    const sg = gain(0);
    envelope(sg, t, 0.10, 0.03, 0.24);
    squeal.connect(sbp); sbp.connect(sg); sg.connect(out);
    squeal.start(t); squeal.stop(t + 0.4);
  }
}

function stopWheel() {
  const W = state.wheel;
  if (!W) return;
  state.wheel = null;
  W.alive = false;
  window.clearTimeout(W.timer);
  const t = now();
  W.out.gain.cancelScheduledValues(t);
  W.out.gain.setValueAtTime(Math.max(W.out.gain.value, 0.0001), t);
  W.out.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  window.setTimeout(() => {
    W.nodes.forEach((n) => { try { n.stop(); } catch (e) { /* already stopped */ } });
    W.out.disconnect();
  }, 900);
}

/* A piece of the machine dropping into place, or a bolt driving home.
   `weight` 0..1 moves it from a sharp rap to a full-bodied slam. */
function clank(weight) {
  if (!machineAudible()) return;
  const w = clamp(weight === undefined ? 0.6 : weight, 0, 1);
  const t = now();
  const out = gain(0.5 + w * 0.4);
  out.connect(state.master);

  const n = noiseSource(false);
  const bp = filter('bandpass', 1500 - w * 900, 1.6);
  const g = gain(0);
  envelope(g, t, 0.7, 0.001, 0.09 + w * 0.16);
  n.connect(bp); bp.connect(g); g.connect(out);
  n.start(t); n.stop(t + 0.4);

  const ring = osc('triangle', 240 - w * 150, t);
  ring.frequency.exponentialRampToValueAtTime(70 - w * 30, t + 0.16 + w * 0.2);
  const rg = gain(0);
  envelope(rg, t, 0.45 + w * 0.35, 0.003, 0.26 + w * 0.3);
  ring.connect(rg); rg.connect(out);
  ring.start(t); ring.stop(t + 0.8);

  window.setTimeout(() => out.disconnect(), 1300);
}

/* The verdict being computed. A sweep climbing under a chatter of data - the
   sound of being read, which is the only thing the player can do about it. */
function scanSound() {
  if (!machineAudible()) return;
  const t = now();
  const out = gain(0.34);
  out.connect(state.master);

  const sweep = osc('sawtooth', 220, t);
  sweep.frequency.exponentialRampToValueAtTime(880, t + 0.55);
  const sbp = filter('bandpass', 700, 5.0);
  sbp.frequency.exponentialRampToValueAtTime(2400, t + 0.55);
  const sg = gain(0);
  envelope(sg, t, 0.30, 0.05, 0.55);
  sweep.connect(sbp); sbp.connect(sg); sg.connect(out);
  sweep.start(t); sweep.stop(t + 0.7);

  for (let i = 0; i < 9; i++) {
    const at = t + i * 0.055;
    const o = osc('square', 1400 + Math.random() * 1600, at);
    const g = gain(0);
    envelope(g, at, 0.09, 0.001, 0.022);
    o.connect(g); g.connect(out);
    o.start(at); o.stop(at + 0.06);
  }

  window.setTimeout(() => out.disconnect(), 1100);
}

/* One character of the code streaming across the terminals. Tiny on purpose:
   these fire several times a second during the opening. */
function dataBlip() {
  if (!machineAudible()) return;
  const t = now();
  const out = gain(0.06);
  out.connect(state.master);
  const o = osc('square', 1800 + Math.random() * 2200, t);
  const g = gain(0);
  envelope(g, t, 0.4, 0.001, 0.014);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + 0.05);
  window.setTimeout(() => out.disconnect(), 220);
}

/* =========================================================================
   The corridor

   These belong to the opening rather than the machine, so they follow the
   master volume alone - a player who silenced the device still gets the walk.
   ========================================================================= */

/* A boot on wet concrete. Randomised every call so twenty of them in a row do
   not read as a loop. */
function footstep(weight) {
  if (!state.ready || state.muted) return;
  const w = clamp(weight === undefined ? 1 : weight, 0, 1);
  const t = now();
  const out = gain(0.34 * w);
  out.connect(state.master);

  // Heel: a dull thud with a little grit on top.
  const thud = osc('sine', 92 + Math.random() * 26, t);
  thud.frequency.exponentialRampToValueAtTime(44, t + 0.08);
  const tg = gain(0);
  envelope(tg, t, 0.6, 0.003, 0.09);
  thud.connect(tg); tg.connect(out);
  thud.start(t); thud.stop(t + 0.2);

  // Scuff: the sole dragging before it settles.
  const scuff = noiseSource(false);
  const lp = filter('lowpass', 1600 + Math.random() * 900, 0.8);
  const hp = filter('highpass', 260, 0.6);
  const sg = gain(0);
  envelope(sg, t, 0.28, 0.004, 0.075 + Math.random() * 0.04);
  scuff.connect(hp); hp.connect(lp); lp.connect(sg); sg.connect(out);
  scuff.start(t); scuff.stop(t + 0.25);

  window.setTimeout(() => out.disconnect(), 500);
}

/* Cold metal under load. A long detuned bend through a tight resonance -
   pipework settling, somewhere out of sight. */
function pipeGroan() {
  if (!state.ready || state.muted) return;
  const t = now();
  const dur = 1.4 + Math.random() * 1.6;
  const out = gain(0.20);
  out.connect(state.master);

  const base = 58 + Math.random() * 40;
  for (const [mult, amp, det] of [[1, 0.30, 0], [1.98, 0.18, 9], [2.51, 0.10, -7]]) {
    const o = osc('sawtooth', base * mult, t);
    o.detune.setValueAtTime(det, t);
    // The bend is the whole effect: a steady tone is a hum, not a groan.
    o.frequency.linearRampToValueAtTime(base * mult * (1.12 + Math.random() * 0.2), t + dur);
    const bp = filter('bandpass', 300 + Math.random() * 500, 8.0);
    const g = gain(0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(bp); bp.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.1);
  }

  window.setTimeout(() => out.disconnect(), (dur + 0.5) * 1000);
}

/* Water finding the floor. */
function drip() {
  if (!state.ready || state.muted) return;
  const t = now();
  const out = gain(0.20);
  out.connect(state.master);
  const o = osc('sine', 1500 + Math.random() * 900, t);
  o.frequency.exponentialRampToValueAtTime(420, t + 0.07);
  const g = gain(0);
  envelope(g, t, 0.5, 0.002, 0.13);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + 0.3);
  window.setTimeout(() => out.disconnect(), 600);
}

/* Something heavy, far off, in a part of the building the player will not
   see. Rolled off hard, because distance is mostly the loss of top end. */
function distantClank() {
  if (!state.ready || state.muted) return;
  const t = now();
  const out = gain(0.24);
  out.connect(state.master);

  const n = noiseSource(false);
  const lp = filter('lowpass', 520, 1.4);
  const g = gain(0);
  envelope(g, t, 0.5, 0.004, 0.5);
  n.connect(lp); lp.connect(g); g.connect(out);
  n.start(t); n.stop(t + 0.9);

  const body = osc('triangle', 96 + Math.random() * 50, t);
  body.frequency.exponentialRampToValueAtTime(48, t + 0.4);
  const bg = gain(0);
  envelope(bg, t, 0.35, 0.006, 0.55);
  body.connect(bg); bg.connect(out);
  body.start(t); body.stop(t + 1.0);

  window.setTimeout(() => out.disconnect(), 1500);
}

/* The hands in the player's back. A rising rush of air, then nothing - the
   impact that follows is crashThrough(). */
function shoveWhoosh() {
  if (!state.ready || state.muted) return;
  const t = now();
  const out = gain(0.55);
  out.connect(state.master);

  const n = noiseSource(false);
  const bp = filter('bandpass', 300, 1.1);
  bp.frequency.exponentialRampToValueAtTime(2600, t + 0.28);
  const g = gain(0);
  envelope(g, t, 0.7, 0.06, 0.24);
  n.connect(bp); bp.connect(g); g.connect(out);
  n.start(t); n.stop(t + 0.6);

  window.setTimeout(() => out.disconnect(), 900);
}

/* A door giving way. Splintering is a burst of many short grains at different
   pitches - one filtered noise hit reads as a slam, which is a different
   event entirely. */
function crashThrough() {
  if (!state.ready || state.muted) return;
  const t = now();
  const out = gain(0.9);
  out.connect(state.master);

  const slam = osc('sine', 150, t);
  slam.frequency.exponentialRampToValueAtTime(38, t + 0.24);
  const slamGain = gain(0);
  envelope(slamGain, t, 0.95, 0.003, 0.34);
  slam.connect(slamGain); slamGain.connect(out);
  slam.start(t); slam.stop(t + 0.6);

  const burst = noiseSource(false);
  const burstLp = filter('lowpass', 4200, 0.9);
  burstLp.frequency.exponentialRampToValueAtTime(400, t + 0.3);
  const burstGain = gain(0);
  envelope(burstGain, t, 0.85, 0.002, 0.36);
  burst.connect(burstLp); burstLp.connect(burstGain); burstGain.connect(out);
  burst.start(t); burst.stop(t + 0.7);

  for (let i = 0; i < 12; i++) {
    const at = t + Math.random() * 0.42;
    const frag = noiseSource(false);
    const bp = filter('bandpass', 900 + Math.random() * 3400, 7.0);
    const g = gain(0);
    envelope(g, at, 0.16 + Math.random() * 0.2, 0.001, 0.03 + Math.random() * 0.07);
    frag.connect(bp); bp.connect(g); g.connect(out);
    frag.start(at); frag.stop(at + 0.2);
  }

  window.setTimeout(() => out.disconnect(), 1600);
}

/* A cable end arcing. Short, bright, and gone - a burst of highpassed grains
   with a mains buzz under it, which is what makes it read as electrical
   rather than as something being dropped. */
function spark() {
  if (!state.ready || state.muted) return;
  const t = now();
  const out = gain(0.20);
  out.connect(state.master);

  const n = noiseSource(false);
  const hp = filter('highpass', 3400, 0.7);
  const bp = filter('bandpass', 5200 + Math.random() * 3000, 2.2);
  const g = gain(0);
  envelope(g, t, 0.55, 0.001, 0.05 + Math.random() * 0.09);
  n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(out);
  n.start(t); n.stop(t + 0.3);

  // The 50 Hz buzz the arc rides on, very short.
  const buzz = osc('sawtooth', 100, t);
  const bf = filter('bandpass', 1800, 4.0);
  const bg = gain(0);
  envelope(bg, t, 0.16, 0.004, 0.07);
  buzz.connect(bf); bf.connect(bg); bg.connect(out);
  buzz.start(t); buzz.stop(t + 0.2);

  window.setTimeout(() => out.disconnect(), 600);
}

/* The body landing. Low, wet, and over immediately. */
function bodyFall() {
  if (!state.ready || state.muted) return;
  const t = now();
  const out = gain(0.7);
  out.connect(state.master);

  const thud = osc('sine', 84, t);
  thud.frequency.exponentialRampToValueAtTime(30, t + 0.2);
  const tg = gain(0);
  envelope(tg, t, 0.9, 0.004, 0.28);
  thud.connect(tg); tg.connect(out);
  thud.start(t); thud.stop(t + 0.5);

  const n = noiseSource(false);
  const lp = filter('lowpass', 900, 0.8);
  const g = gain(0);
  envelope(g, t, 0.4, 0.004, 0.16);
  n.connect(lp); lp.connect(g); g.connect(out);
  n.start(t); n.stop(t + 0.35);

  window.setTimeout(() => out.disconnect(), 900);
}

/* =========================================================================
   Continuous beds
   ========================================================================= */

/* Room tone: mains hum, a wash of filtered noise for air, and a barely
   audible sub. Always running once the exam starts. */
function startAmbience() {
  if (!state.ready || state.ambience) return;
  const t = now();
  const out = gain(0);
  out.connect(state.master);
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(0.30, t + 3.0);

  const nodes = [];

  // 50 Hz mains hum plus its third harmonic - the sound of bad wiring.
  for (const [f, a] of [[50, 0.05], [150, 0.022], [100, 0.012]]) {
    const o = osc('sine', f, t);
    const g = gain(a);
    o.connect(g); g.connect(out);
    o.start(t);
    nodes.push(o);
  }

  // Air: looped noise, heavily low-passed.
  const air = noiseSource(true);
  const airLp = filter('lowpass', 420, 0.4);
  const airGain = gain(0.06);
  air.connect(airLp); airLp.connect(airGain); airGain.connect(out);
  air.start(t);
  nodes.push(air);

  // A slow wobble on the hum's level, so it never sits perfectly still.
  const lfo = osc('sine', 0.07, t);
  const lfoDepth = gain(0.10);
  lfo.connect(lfoDepth); lfoDepth.connect(out.gain);
  lfo.start(t);
  nodes.push(lfo);

  state.ambience = { out, nodes };
}

function stopAmbience() {
  if (!state.ambience) return;
  const { out, nodes } = state.ambience;
  const t = now();
  out.gain.cancelScheduledValues(t);
  out.gain.setValueAtTime(Math.max(out.gain.value, 0.0001), t);
  out.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
  window.setTimeout(() => {
    nodes.forEach((n) => { try { n.stop(); } catch (e) { /* already stopped */ } });
    out.disconnect();
  }, 900);
  state.ambience = null;
}

/**
 * The last-ten-seconds cue.
 *
 * Built as a standing rig whose intensity is driven every frame from the
 * clock, rather than as a fixed piece of music - that way the crescendo is
 * exactly as long as the time remaining, and it cuts off mid-swell when the
 * machine goes up, which is the whole effect.
 *
 * Layers: a detuned minor-second cluster (the dissonance that reads as dread),
 * a rising tone, and a pulse that accelerates toward the end.
 */
function startTension() {
  if (!state.ready || state.tension) return;
  const t = now();

  const out = gain(0.0001);
  out.connect(state.master);

  // Pulse gate - everything is multiplied by this.
  const pulse = gain(1);
  pulse.connect(out);

  const lfo = osc('sine', 1.6, t);
  const lfoDepth = gain(0.35);
  lfo.connect(lfoDepth);
  lfoDepth.connect(pulse.gain);
  lfo.start(t);

  const lp = filter('lowpass', 400, 1.4);
  lp.connect(pulse);

  // Cluster: a root, its minor second, and a tritone. Deliberately ugly.
  const voices = [];
  for (const [f, a, detune] of [[55, 0.30, 0], [58.27, 0.24, 7], [77.78, 0.18, -5], [110, 0.14, 3]]) {
    const o = osc('sawtooth', f, t);
    o.detune.setValueAtTime(detune, t);
    const g = gain(a);
    o.connect(g); g.connect(lp);
    o.start(t);
    voices.push(o);
  }

  // A slow rise, swept by intensity - the classic "something is coming" line.
  const riser = osc('sawtooth', 180, t);
  const riserFilter = filter('bandpass', 400, 6.0);
  const riserGain = gain(0.10);
  riser.connect(riserFilter); riserFilter.connect(riserGain); riserGain.connect(pulse);
  riser.start(t);
  voices.push(riser);

  // Noise bed for pressure.
  const air = noiseSource(true);
  const airBp = filter('bandpass', 900, 0.8);
  const airGain = gain(0.05);
  air.connect(airBp); airBp.connect(airGain); airGain.connect(pulse);
  air.start(t);
  voices.push(air);

  state.tension = {
    out, pulse, lfo, lp, riser, riserFilter, airGain, voices: voices.concat([lfo]),
    intensity: 0
  };
  setTensionIntensity(0);
}

/**
 * @param {number} k 0 at the start of the cue, 1 at the moment of the shot.
 */
function setTensionIntensity(k) {
  const T = state.tension;
  if (!T) return;
  k = clamp(k, 0, 1);
  T.intensity = k;
  const t = now();
  const ramp = 0.08;                      // smooth over the frame, no zipper noise

  // Volume: quiet and creeping at first, then genuinely loud.
  const vol = 0.05 + k * k * 0.62;
  T.out.gain.setTargetAtTime(vol, t, ramp);

  // The cluster opens up as it gets louder.
  T.lp.frequency.setTargetAtTime(320 + k * 2600, t, ramp);

  // The riser climbs just over an octave across the cue.
  T.riser.frequency.setTargetAtTime(180 + k * 260, t, ramp);
  T.riserFilter.frequency.setTargetAtTime(400 + k * 2200, t, ramp);

  // The pulse accelerates from a slow throb to a fast panic.
  T.lfo.frequency.setTargetAtTime(1.6 + k * 6.5, t, ramp);

  T.airGain.gain.setTargetAtTime(0.05 + k * 0.16, t, ramp);
}

function stopTension(immediate) {
  const T = state.tension;
  if (!T) return;
  state.tension = null;
  const t = now();
  const fall = immediate ? 0.04 : 0.5;
  T.out.gain.cancelScheduledValues(t);
  T.out.gain.setValueAtTime(Math.max(T.out.gain.value, 0.0001), t);
  T.out.gain.exponentialRampToValueAtTime(0.0001, t + fall);
  window.setTimeout(() => {
    T.voices.forEach((n) => { try { n.stop(); } catch (e) { /* already stopped */ } });
    T.out.disconnect();
  }, (fall + 0.3) * 1000);
}

/* ---------------------------------------------------------------- volume */

function setMasterVolume(v) {
  // Remembered, so unmuting restores what the player chose rather than the
  // hard-coded 0.85 that setMuted used to snap back to.
  state.volume = clamp(v, 0, 1);
  if (state.master && !state.muted) state.master.gain.value = state.volume;
  musicFollow();
}

function getMasterVolume() { return state.volume; }

function setMuted(m) {
  state.muted = !!m;
  if (state.master) state.master.gain.value = m ? 0 : state.volume;
  musicFollow();
}

/* Music is the one thing in the game that is not synthesised here, so it hangs
   off an <audio> element and cannot be levelled by the master gain the way
   every cue above is. Pushing to it means the SETTINGS slider moves the whole
   mix, rather than everything except the part the player notices most.
   Guarded because music.js loads after this file and is optional. */
function musicFollow() {
  if (SATG.music && SATG.music.refresh) SATG.music.refresh();
}

/* The bus music.js attaches to on platforms that ignore an element's own
   volume - see the header of audio/music.js for why that path exists at all.
   Null until the first gesture has built the graph. */
function musicBus() {
  if (!state.ctx) init();
  return state.ctx && state.master ? { ctx: state.ctx, master: state.master } : null;
}

function isMuted() { return state.muted; }

/* The blast is deliberately the loudest thing in the game, which makes it the
   one sound a player may genuinely need to turn down on its own - through
   headphones it is startling by design, and "startling" and "painful" are not
   the same setting. Scaling its own output bus leaves the mix of its layers
   and the echo intact. */
function setExplosionVolume(v) {
  state.explosionScale = clamp(v, 0, 1);
}

function getExplosionVolume() { return state.explosionScale; }

/* Everything the machine and the corridor hold open, released in one call.
   Every route out of a run goes through here, so a player who quits mid-exam
   does not leave a wheel turning under the title card. */
function stopAll() {
  stopTension(true);
  stopAmbience();
  stopMachineBed(true);
  stopWheel();
}

/* --------------------------------------------------------------- exports */

SATG.audio = {
  init, resume, ding, explosion, click, beep, paperRustle, calcKey, latch,
  startAmbience, stopAmbience,
  startTension, stopTension, setTensionIntensity,
  startMachineBed, setMachineIntensity, stopMachineBed,
  startWheel, stopWheel,
  clank, scanSound, dataBlip,
  footstep, pipeGroan, drip, distantClank, shoveWhoosh, crashThrough, bodyFall,
  spark,
  setMachineAudio, stopAll,
  setMasterVolume, getMasterVolume, setMuted, isMuted,
  setExplosionVolume, getExplosionVolume, musicBus,
  get ready() { return state.ready; },
  get tensionActive() { return !!state.tension; },
  get machineActive() { return !!state.machine; }
};

})(window);
