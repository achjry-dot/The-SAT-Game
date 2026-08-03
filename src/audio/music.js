/* =========================================================================
   audio/music.js - the one place the game plays a recorded file.

   Everything else you hear is synthesised at runtime in audio.js. Music is the
   exception, because a composed piece is not something a bank of oscillators
   can be talked into: you write it in a DAW, you export it, you drop it in.

   Nothing here is required. With no files present the game runs exactly as it
   does now, in silence, and says nothing about it.

   ---------------------------------------------------------------- why <audio>

   This deliberately does NOT route through the Web Audio graph in audio.js,
   which would otherwise be the obvious thing to do.

   The game has to run by double-clicking index.html, and on a file:// page
   every sibling file counts as a separate origin (Firefox has enforced this by
   default since 68). A MediaElementAudioSourceNode fed from a cross-origin
   resource is not an error - it is *silence*, with no warning anywhere. So the
   route that looks correct is the one that fails, and it fails invisibly, on
   the exact configuration this game is built for.

   An <audio> element playing straight to the speakers has no such rule. It
   works identically from file:// and from a web host, which is worth more here
   than sharing a compressor with the gunshot - a track exported from a DAW has
   already been mastered and does not need the game's limiter.

   The cost is that volume has to be set on the element itself, and iOS refuses
   that outright - there, volume is a hardware control and the assignment is
   silently ignored, which would leave every track stuck at full with no fades.
   So the level is applied through whichever of the two actually works, probed
   once at first play rather than guessed from the user agent:

     element volume   everywhere else, including file://
     a gain node      iOS, which is never on file:// anyway

   The two failure modes do not overlap, which is the only reason carrying both
   is worth it: file:// breaks the gain node, iOS breaks the element, and no
   configuration breaks both.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;
const { clamp } = SATG.util;

/* Which track plays on which game state.

   A state that is not named here plays nothing. That default is deliberate:
   the exam is carried by the room tone and the ten-second cue, so a state
   added later that forgets to appear in this table falls silent rather than
   playing menu music underneath the horror. Silence is the safe failure. */
const STATE_TRACK = {
  title: 'menu',
  types: 'menu',
  settings: 'menu',
  stats: 'menu',
  feedback: 'menu',

  moduleBreak: 'results',
  results: 'results',
  analysis: 'results',

  exam: 'exam'

  /* intro and exiting are intentionally absent - the head coming off the desk
     is meant to be the room and nothing else. */
};

/* Extension -> MIME, used only to ask the browser whether it is worth trying a
   candidate at all. An unknown extension is not rejected; it is simply handed
   to the element, which is a better judge than this table. */
const MIME = {
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg; codecs=opus',
  mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac',
  m4a: 'audio/mp4', aac: 'audio/aac', webm: 'audio/webm'
};

const STEP_MS = 40;          // fade resolution; 25 updates a second is inaudible

const M = {
  unlocked: false,
  wanted: null,              // track name the game has asked for
  voices: [],                // playing or fading; more than one only mid-crossfade
  resolved: {},              // track name -> path that loaded, or null if none did
  loading: {},               // track name -> true while candidates are being tried
  volume: 0.55,
  fadeSeconds: 1.2,
  timer: null,
  probe: null
};

/* ------------------------------------------------------------------ config */

function cfg() {
  return (SATG.CONFIG && SATG.CONFIG.music) || {};
}

/* A track may be configured as a single path or as a list of candidates tried
   in order - so "I exported OGG" and "I have not decided yet" are both one
   line of config. */
function candidates(name) {
  const tracks = cfg().tracks || {};
  const v = tracks[name];
  const list = Array.isArray(v) ? v : (v ? [v] : []);
  return list.filter((p) => typeof p === 'string' && p);
}

function playable(path) {
  const clean = path.split('?')[0].split('#')[0];
  const ext = (clean.split('.').pop() || '').toLowerCase();
  const mime = MIME[ext];
  if (!mime) return true;
  if (!M.probe) M.probe = document.createElement('audio');
  // '' means "definitely not"; 'maybe' and 'probably' are both worth trying.
  return M.probe.canPlayType(mime) !== '';
}

/* --------------------------------------------------------------- levelling */

/* Does assigning to el.volume actually do anything?

   Probed once, by writing a value and reading it back, because the platforms
   that ignore it do so silently - there is no flag to ask, and sniffing the
   user agent for "iPhone" would be wrong the moment anything else adopts the
   same rule. */
let elementVolumeWorks = null;

function volumeUsable(el) {
  if (elementVolumeWorks !== null) return elementVolumeWorks;
  try {
    el.volume = 0.5;
    elementVolumeWorks = Math.abs(el.volume - 0.5) < 0.01;
  } catch (err) {
    elementVolumeWorks = false;
  }
  if (!elementVolumeWorks) {
    console.info('[music] this browser ignores element volume; routing through Web Audio');
  }
  return elementVolumeWorks;
}

/* Build the gain node this voice will be levelled with, for the platforms
   where the element's own volume is a no-op. Returns false if Web Audio is not
   up yet, in which case the track still plays - just at a fixed level. */
function route(v) {
  /* Never on file://, whatever the probe said.

     This is the one path in the module that can fail silently - a source node
     fed from a file:// sibling is treated as cross-origin and outputs silence
     with no error anywhere - so it is closed off by the address rather than by
     a judgement about which platforms need it. Nothing is lost: the only known
     platform that ignores element volume is iOS, which never runs on file://.
     Should both somehow be true at once the track still plays, just at a fixed
     level with no fades, which is a bad outcome rather than an invisible one. */
  if (global.location && global.location.protocol === 'file:') return false;

  const bus = SATG.audio.musicBus();
  if (!bus) return false;
  try {
    v.gain = bus.ctx.createGain();
    v.gain.gain.value = 0;
    v.source = bus.ctx.createMediaElementSource(v.el);
    v.source.connect(v.gain);
    v.gain.connect(bus.master);
    return true;
  } catch (err) {
    console.warn('[music] could not route through Web Audio', err);
    v.gain = null; v.source = null;
    return false;
  }
}

/* One number, assembled every time it is needed rather than cached, so that
   turning the master volume down in SETTINGS reaches the music on the next
   step without anything having to remember to push it. */
function applyLevel(v) {
  const g = SATG.audio.isMuted()
    ? 0
    : clamp(SATG.audio.getMasterVolume() * M.volume * v.level, 0, 1);

  if (v.gain) {
    /* Already downstream of the master gain, which has applied the master
       volume and the mute once. Applying them twice would square the slider. */
    const own = SATG.audio.isMuted() ? 0 : clamp(M.volume * v.level, 0, 1);
    v.gain.gain.value = own;
    return;
  }
  try { v.el.volume = g; } catch (err) { /* nothing else to try */ }
}

function startTimer() {
  if (M.timer) return;
  M.timer = global.setInterval(step, STEP_MS);
}

function step() {
  for (let i = M.voices.length - 1; i >= 0; i--) {
    const v = M.voices[i];
    if (v.level !== v.target) {
      const d = v.rate * (STEP_MS / 1000);
      v.level = v.target > v.level ? Math.min(v.target, v.level + d)
                                   : Math.max(v.target, v.level - d);
    }
    applyLevel(v);
    if (v.target <= 0 && v.level <= 0) {
      halt(v);
      M.voices.splice(i, 1);
    }
  }
  if (!M.voices.length) { global.clearInterval(M.timer); M.timer = null; }
}

function fadeTo(v, target, seconds) {
  v.target = clamp(target, 0, 1);
  const s = seconds === undefined ? M.fadeSeconds : seconds;
  v.rate = s > 0 ? 1 / s : 1000;
  startTimer();
}

function halt(v) {
  try { v.el.pause(); } catch (err) { /* already gone */ }
  if (v.source) { try { v.source.disconnect(); } catch (err) { /* fine */ } }
  if (v.gain) { try { v.gain.disconnect(); } catch (err) { /* fine */ } }
  v.source = v.gain = null;
  /* Dropping the source frees the decoder. Without this a run that walks in
     and out of the menu twenty times leaves twenty decoded tracks resident. */
  try { v.el.removeAttribute('src'); v.el.load(); } catch (err) { /* fine */ }
}

/* ----------------------------------------------------------------- loading */

/* Try each candidate in turn and call back with the first element that reports
   it can play through. Failure is not an error: no music file is the normal
   state of this game, so it is reported once, quietly, and never retried. */
function load(name, done) {
  if (M.resolved[name] === null) { done(null); return; }
  if (M.loading[name]) { done(null); return; }

  const known = M.resolved[name];
  const list = (known ? [known] : candidates(name)).filter(playable);
  if (!list.length) {
    M.resolved[name] = null;
    if (candidates(name).length) {
      console.info('[music] no playable format for "' + name + '" among: ' +
                   candidates(name).join(', '));
    }
    done(null);
    return;
  }

  M.loading[name] = true;
  let i = 0;

  const attempt = () => {
    if (i >= list.length) {
      M.loading[name] = false;
      M.resolved[name] = null;
      console.info('[music] no "' + name + '" track found (looked for ' +
                   list.join(', ') + ') - running without it');
      done(null);
      return;
    }
    const path = list[i++];
    const el = document.createElement('audio');
    el.preload = 'auto';
    el.loop = true;
    el.volume = 0;

    let settled = false;
    const ok = () => {
      if (settled) return;
      settled = true;
      cleanup();
      M.loading[name] = false;
      M.resolved[name] = path;
      done(el, path);
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      try { el.removeAttribute('src'); el.load(); } catch (err) { /* fine */ }
      attempt();
    };
    const cleanup = () => {
      el.removeEventListener('canplaythrough', ok);
      el.removeEventListener('loadeddata', ok);
      el.removeEventListener('error', fail);
    };

    /* loadeddata as well as canplaythrough: a long track streamed off a slow
       disk can take a while to promise the whole file, and there is no reason
       to make the player wait for that when the first frames are already
       decoded and the fade-in is a second long anyway. */
    el.addEventListener('canplaythrough', ok);
    el.addEventListener('loadeddata', ok);
    el.addEventListener('error', fail);
    el.src = path;
    el.load();
  };

  attempt();
}

/* -------------------------------------------------------------- transitions */

function currentName() {
  for (const v of M.voices) if (v.target > 0) return v.name;
  return null;
}

function play(name) {
  load(name, (el) => {
    // The player may have walked out of the menu while the file was decoding.
    if (!el) return;
    if (M.wanted !== name || !M.unlocked) { halt({ el }); return; }

    const v = { name, el, level: 0, target: 0, rate: 1, gain: null, source: null };
    /* Probe first, route only if the element's own volume is a no-op. Note the
       order: createMediaElementSource is irreversible - once an element is
       inside the graph it can never play to the speakers again - so it is only
       ever reached on a platform already proven to need it. */
    if (!volumeUsable(el) && route(v)) {
      try { el.volume = 1; } catch (err) { /* ignored there by definition */ }
    }
    M.voices.push(v);
    applyLevel(v);
    fadeTo(v, 1);

    const p = el.play();
    if (p && p.catch) {
      p.catch(() => {
        /* Autoplay was refused. Not a bug and not worth a warning - it means
           the gesture we counted on did not count. Drop back to locked so the
           next click tries again. */
        M.unlocked = false;
        const at = M.voices.indexOf(v);
        if (at !== -1) M.voices.splice(at, 1);
        halt(v);
      });
    }
  });
}

/**
 * Ask for the track that belongs to a game state. Safe to call every frame -
 * it returns immediately unless the answer has changed.
 *
 * @param {string} gameState one of the Game state names
 */
function forState(gameState) {
  set(STATE_TRACK[gameState] || null);
}

/**
 * Ask for a track by name directly, or null for silence.
 * @param {?string} name
 */
function set(name) {
  if (name === M.wanted) return;
  M.wanted = name;

  for (const v of M.voices) {
    if (v.name !== name) fadeTo(v, 0);
  }

  if (!name) return;

  // Already playing or fading back up - reuse it rather than decoding again.
  const held = M.voices.find((v) => v.name === name);
  if (held) { fadeTo(held, 1); return; }

  if (M.unlocked) play(name);
}

/**
 * Called from the first real user gesture. Browsers will not let any of this
 * make a sound before one, so the title card is silent until the player moves.
 */
function unlock() {
  if (M.unlocked) return;
  M.unlocked = true;
  if (M.wanted && !M.voices.some((v) => v.name === M.wanted)) play(M.wanted);
}

/* ------------------------------------------------------------------ volume */

function setVolume(v) {
  M.volume = clamp(v, 0, 1);
  refresh();
}

function getVolume() { return M.volume; }

/* Called by audio.js when the master volume or the mute flag moves, so the
   music follows the same slider as everything else. */
function refresh() {
  for (const v of M.voices) applyLevel(v);
}

function stop(immediate) {
  M.wanted = null;
  for (let i = M.voices.length - 1; i >= 0; i--) {
    if (immediate) { halt(M.voices[i]); M.voices.splice(i, 1); }
    else fadeTo(M.voices[i], 0);
  }
  if (immediate && M.timer) { global.clearInterval(M.timer); M.timer = null; }
}

/* --------------------------------------------------------------- boot-time */

(function readConfig() {
  const c = cfg();
  if (typeof c.volume === 'number') M.volume = clamp(c.volume, 0, 1);
  if (typeof c.fade === 'number') M.fadeSeconds = Math.max(0, c.fade);
})();

/* The elements are deliberately never added to the document - an <audio> tag
   with no controls has no business being in the tree, and the ones this game
   does put there have a history of quietly eating canvas clicks. That leaves
   nothing to inspect from a console, so this hands back what is actually
   happening. It is the only way to tell "the track is playing" apart from "the
   track was asked for and never started", which look identical from outside. */
function report() {
  return {
    unlocked: M.unlocked,
    wanted: M.wanted,
    levelledBy: elementVolumeWorks === null ? 'not probed yet'
              : (elementVolumeWorks ? 'element volume' : 'gain node'),
    resolved: Object.assign({}, M.resolved),
    voices: M.voices.map((v) => ({
      name: v.name,
      level: Math.round(v.level * 1000) / 1000,
      target: v.target,
      volume: v.gain ? v.gain.gain.value : v.el.volume,
      currentTime: Math.round(v.el.currentTime * 100) / 100,
      paused: v.el.paused,
      duration: v.el.duration,
      src: (v.el.currentSrc || '').split('/').pop()
    }))
  };
}

SATG.music = {
  forState, set, unlock, stop, refresh, report,
  setVolume, getVolume,
  STATE_TRACK,
  get playing() { return currentName(); },
  get unlocked() { return M.unlocked; }
};

})(window);
