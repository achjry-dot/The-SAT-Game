/* =========================================================================
   audio.js - every sound in the game is synthesised here at runtime.

   No audio files, for the same reason there are no texture files: the game
   has to run straight off the file system. Web Audio is more than capable of
   the whole palette - a room tone, a bell, a gunshot, and a tension cue that
   swells under the last ten seconds of the clock.

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
  gunshotScale: 1
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

  // A gentle ceiling. The gunshot is deliberately the loudest thing in the
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

/* Wrong answer, or the clock running out. The loudest event in the game.
   Three layers: a click transient, a filtered noise body that decays fast,
   and a pitched-down sine thump for the chest hit. */
function gunshot() {
  if (!state.ready || state.muted || state.gunshotScale <= 0) return;
  const t = now();
  const out = gain(state.gunshotScale);
  out.connect(state.master);

  // 1. transient - the crack
  const crack = noiseSource(false);
  const crackHp = filter('highpass', 2200, 0.7);
  const crackGain = gain(0);
  envelope(crackGain, t, 0.9, 0.001, 0.045);
  crack.connect(crackHp); crackHp.connect(crackGain); crackGain.connect(out);
  crack.start(t); crack.stop(t + 0.2);

  // 2. body - broadband, swept down so it collapses inward
  const body = noiseSource(false);
  const bodyLp = filter('lowpass', 3000, 1.2);
  bodyLp.frequency.setValueAtTime(3400, t);
  bodyLp.frequency.exponentialRampToValueAtTime(220, t + 0.32);
  const bodyGain = gain(0);
  envelope(bodyGain, t, 1.0, 0.003, 0.34);
  body.connect(bodyLp); bodyLp.connect(bodyGain); bodyGain.connect(out);
  body.start(t); body.stop(t + 0.6);

  // 3. thump - the low end you feel rather than hear
  const thump = osc('sine', 140, t);
  thump.frequency.exponentialRampToValueAtTime(38, t + 0.22);
  const thumpGain = gain(0);
  envelope(thumpGain, t, 0.85, 0.004, 0.30);
  thump.connect(thumpGain); thumpGain.connect(out);
  thump.start(t); thump.stop(t + 0.5);

  // 4. tail - the room answering back
  const tail = noiseSource(false);
  const tailBp = filter('bandpass', 500, 0.6);
  const tailGain = gain(0);
  envelope(tailGain, t + 0.02, 0.22, 0.05, 0.85);
  tail.connect(tailBp); tailBp.connect(tailGain); tailGain.connect(out);
  tail.start(t); tail.stop(t + 1.2);

  window.setTimeout(() => out.disconnect(), 1800);
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
 * gunshot lands, which is the whole effect.
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
}

function getMasterVolume() { return state.volume; }

function setMuted(m) {
  state.muted = !!m;
  if (state.master) state.master.gain.value = m ? 0 : state.volume;
}

function isMuted() { return state.muted; }

/* The shot is deliberately the loudest thing in the game, which makes it the
   one sound a player may genuinely need to turn down on its own - through
   headphones it is startling by design, and "startling" and "painful" are not
   the same setting. Scaling its own output bus leaves the mix of its four
   layers intact. */
function setGunshotVolume(v) {
  state.gunshotScale = clamp(v, 0, 1);
}

function getGunshotVolume() { return state.gunshotScale; }

/* --------------------------------------------------------------- exports */

SATG.audio = {
  init, resume, ding, gunshot, click, beep, paperRustle, calcKey, latch,
  startAmbience, stopAmbience,
  startTension, stopTension, setTensionIntensity,
  setMasterVolume, getMasterVolume, setMuted, isMuted,
  setGunshotVolume, getGunshotVolume,
  get ready() { return state.ready; },
  get tensionActive() { return !!state.tension; }
};

})(window);
