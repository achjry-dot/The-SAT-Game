/* =========================================================================
   ui/settings.js - player settings, and the screen that edits them.

   Two halves, deliberately separate:

     SATG.settings   the values, their defaults, how they persist, and how
                     they are applied to the pipeline and the mixer. Owns no
                     pixels, so it can be read and driven without a GPU.
     SettingsScreen  draws that list and moves a cursor over it.

   Everything here is applied through apply(), which is also called once at
   boot. A setting that is only applied by the screen that edits it is a
   setting that quietly resets every time the game is reopened.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;
const F = SATG.font;
const { clamp } = SATG.util;

const KEY = 'satgame.settings.v1';

const BONE       = '#d9d2c4';
const BONE_DIM   = '#8e8779';
const BONE_FAINT = '#4f4a42';
const GREEN      = '#7dff9b';

/* Each control names the value it edits and how to move it. `kind` is
   'range' (a bar), 'toggle' (on/off) or 'action' (does something now). */
const CONTROLS = [
  { key: 'brightness', label: 'BRIGHTNESS', kind: 'range',
    min: 0.60, max: 1.60, step: 0.05,
    note: 'THE ROOM IS MEANT TO BE DARK. RAISE THIS IF YOU CANNOT READ THE SHEET.',
    format: (v) => Math.round(v * 100) + '%' },

  { key: 'volume', label: 'MASTER VOLUME', kind: 'range',
    min: 0, max: 1, step: 0.05,
    note: 'EVERYTHING THE GAME PLAYS.',
    format: (v) => Math.round(v * 100) + '%' },

  { key: 'music', label: 'MUSIC VOLUME', kind: 'range',
    min: 0, max: 1, step: 0.05,
    /* Two lines is the hard cap the help area fits; anything longer is
       silently truncated mid-word. */
    note: 'THE WRITTEN MUSIC ONLY, NOT THE GAME\'S OWN SOUNDS. IT SITS UNDER ' +
          'THEM ON PURPOSE.',
    format: (v) => v <= 0 ? 'OFF' : Math.round(v * 100) + '%' },

  { key: 'explosion', label: 'EXPLOSION VOLUME', kind: 'range',
    min: 0, max: 1, step: 0.05,
    note: 'THE BLAST IS THE LOUDEST SOUND IN THE GAME. THIS TURNS IT DOWN ALONE.',
    format: (v) => v <= 0 ? 'OFF' : Math.round(v * 100) + '%' },

  { key: 'machineSound', label: 'MACHINE SOUND', kind: 'toggle',
    note: 'THE WHIRR OF THE MACHINE AND THE TURNING OF ITS WHEEL. THE MACHINE ' +
          'IS STILL THERE WITH THIS OFF, AND IT STILL GOES OFF.' },

  { key: 'animations', label: 'ANIMATIONS', kind: 'toggle',
    note: 'THE OPENING WALK, AND THE MACHINE FIRING. WITH THIS OFF A RUN BEGINS ' +
          'AT THE DESK AND A WRONG ANSWER IS THE BLAST ALONE.' },

  { key: 'grain', label: 'FILM GRAIN', kind: 'range',
    min: 0, max: 2, step: 0.1,
    note: 'THE MOVING NOISE OVER THE WHOLE IMAGE.',
    format: (v) => v <= 0 ? 'OFF' : Math.round(v * 100) + '%' },

  { key: 'vignette', label: 'VIGNETTE', kind: 'range',
    min: 0, max: 1.5, step: 0.1,
    note: 'HOW HARD THE CORNERS OF THE SCREEN DARKEN.',
    format: (v) => v <= 0 ? 'OFF' : Math.round(v * 100) + '%' },

  { key: 'calmPanic', label: 'REDUCE FLASHING', kind: 'toggle',
    note: 'HOLDS THE GRAIN AND COLOUR SPLIT STEADY IN THE LAST TEN SECONDS ' +
          'INSTEAD OF LETTING THEM CLIMB.' },

  { key: 'reset', label: 'RESTORE DEFAULTS', kind: 'action',
    note: 'PUT EVERY SETTING ON THIS PAGE BACK TO HOW IT SHIPPED.' },

  { key: 'back', label: 'BACK', kind: 'action', note: 'RETURN TO THE MENU.' }
];

const DEFAULTS = {
  brightness: 1.00,
  volume: 0.85,
  /* Matches config.js's music.volume, which is what the slider is now the
     front end for. Both say 0.55 because music is a bed: it wants to be well
     under the cues, not level with them. */
  music: 0.55,
  explosion: 1.00,
  machineSound: true,
  animations: true,
  grain: 1.00,
  vignette: 1.00,
  calmPanic: false
};

const values = Object.assign({}, DEFAULTS);

function load() {
  try {
    const raw = global.localStorage && global.localStorage.getItem(KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    /* The shot became a blast, and the setting was renamed with it. Anyone who
       had already turned it down deserves to still have it turned down, so the
       old key is read once and then never again. */
    if (parsed.explosion === undefined && typeof parsed.gunshot === 'number') {
      parsed.explosion = parsed.gunshot;
    }
    for (const c of CONTROLS) {
      if (c.kind === 'action') continue;
      const v = parsed[c.key];
      if (v === undefined) continue;
      if (c.kind === 'toggle') values[c.key] = !!v;
      // A stored value outside the control's range is a corrupt or
      // out-of-date entry, not an instruction; clamp rather than trust it.
      else if (typeof v === 'number' && isFinite(v)) values[c.key] = clamp(v, c.min, c.max);
    }
  } catch (e) { /* private mode, quota, bad JSON - defaults are fine */ }
}

function save() {
  try {
    if (global.localStorage) global.localStorage.setItem(KEY, JSON.stringify(values));
  } catch (e) { /* ignore */ }
}

function get(key) { return values[key]; }

function set(key, v) {
  const c = CONTROLS.find((x) => x.key === key);
  if (!c || c.kind === 'action') return false;
  values[key] = c.kind === 'toggle' ? !!v : clamp(v, c.min, c.max);
  apply();
  save();
  return true;
}

function restoreDefaults() {
  Object.assign(values, DEFAULTS);
  apply();
  save();
}

/* Push the current values into the systems that consume them. Safe to call
   before the pipeline exists - it simply does the audio half. */
function apply() {
  const P = SATG.instance && SATG.instance.pipeline;
  if (P) P.brightness = values.brightness;
  /* Grain and vignette are deliberately NOT pushed here. Both are rewritten
     every frame by the panic ramp, so a value set at the moment the slider
     moved would survive exactly one tick; the game multiplies by
     SATG.settings.values itself, in the same place it computes them. */
  /* Music answers to its own slider AND to the master, in that order. It is
     the one sound in the game that is not synthesised here, so it hangs off
     an <audio> element rather than the master gain node - setVolume() folds
     the master in itself, which is why this is a push rather than a multiply.
     Guarded because music.js loads after this file. */
  if (SATG.music && SATG.music.setVolume) SATG.music.setVolume(values.music);
  if (SATG.audio) {
    SATG.audio.setMasterVolume(values.volume);
    SATG.audio.setExplosionVolume(values.explosion);
    /* Turning this off has to silence what is ALREADY running, not just refuse
       the next sound - the bed and the wheel are held open for the whole run,
       so a flag consulted only at start time would leave them going until the
       player died. setMachineAudio tears them down itself. */
    SATG.audio.setMachineAudio(values.machineSound);
  }
}

load();

SATG.settings = {
  CONTROLS, DEFAULTS, get, set, apply, save, load, restoreDefaults,
  get values() { return values; }
};

/* ====================================================================== */
/* Screen                                                                  */
/* ====================================================================== */

class SettingsScreen extends SATG.screens.ScreenCanvas {
  constructor(gl) {
    super(gl, 1280, 720);
    this.index = 0;
    this.time = 0;
    this.hits = [];
    this.fx = new SATG.fx.PressFX();
  }

  reset() { this.index = 0; this.time = 0; this.fx.clear(); this.dirty = true; }

  get selected() { return CONTROLS[this.index]; }

  move(dir) {
    const n = CONTROLS.length;
    this.index = (this.index + dir + n) % n;
    this.dirty = true;
    return true;
  }

  setIndex(i) {
    if (i < 0 || i >= CONTROLS.length || i === this.index) return false;
    this.index = i;
    this.dirty = true;
    return true;
  }

  /* Left/right on the highlighted row. Returns true when something changed,
     so the caller knows whether to make a noise about it. */
  adjust(dir) {
    const c = this.selected;
    if (!c) return false;
    if (c.kind === 'range') {
      const next = clamp(
        Math.round((values[c.key] + dir * c.step) / c.step) * c.step, c.min, c.max);
      if (Math.abs(next - values[c.key]) < 1e-9) return false;
      set(c.key, next);
      this.fx.press(c.key);
      this.dirty = true;
      return true;
    }
    if (c.kind === 'toggle') {
      set(c.key, !values[c.key]);
      this.fx.press(c.key);
      this.dirty = true;
      return true;
    }
    return false;
  }

  /* ENTER. Toggles flip, ranges do nothing (they are left/right), actions run
     and report themselves so the game can route them. */
  activate() {
    const c = this.selected;
    if (!c) return null;
    if (c.kind === 'toggle') { this.adjust(1); return { type: 'toggled' }; }
    if (c.kind === 'action') {
      this.fx.press(c.key);
      this.dirty = true;
      if (c.key === 'reset') { restoreDefaults(); return { type: 'reset' }; }
      return { type: 'action', action: c.key };
    }
    return null;
  }

  update(dt) {
    this.time += dt;
    const blink = (Math.floor(this.time * 2.2) % 2) === 0;
    if (blink !== this._blink) { this._blink = blink; this.dirty = true; }
    if (this.fx.update(dt)) this.dirty = true;
  }

  render() {
    if (!this.dirty) return;
    const ctx = this.ctx;
    this.clear();

    const W = this.W, H = this.H, s = this.uiScale || 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    const left = Math.round(W * 0.10);
    const avail = Math.round(W * 0.80);

    /* Same discipline as the other screens: measure the whole list, shrink
       until it fits, and never let the last row - BACK - leave the screen. */
    let title = F.fitScale('SETTINGS', avail, 5 * s, 4 * s, s);
    let row = Math.max(s, Math.round(title * 0.32));
    let step = F.lineHeight(row) + 12 * s;
    const noteH = () => F.lineHeight(Math.max(s, Math.round(row * 0.8))) * 2 + 10 * s;
    const blockH = () => F.lineHeight(title) + Math.round(H * 0.06) +
                         step * CONTROLS.length + noteH() + 12 * s;

    let guard = 0;
    while (blockH() > H - 24 * s && guard++ < 40) {
      if (row > s) { row -= s; step = F.lineHeight(row) + 8 * s; }
      else if (title > s) { title -= s; }
      else break;
    }

    let y = Math.max(12 * s, Math.round(H * 0.10));
    F.draw(ctx, 'SETTINGS', left, y, { color: BONE, scale: title, tracking: 4 * s });
    y += F.lineHeight(title) + Math.round(H * 0.06);

    const valX = left + Math.round(avail * 0.46);
    const barX = valX + Math.round(avail * 0.16);
    const barW = Math.round(avail * 0.30);
    const barH = Math.max(3 * s, Math.round(F.cellH * row * 0.55));

    /* Below a certain size the list simply does not fit, however small the
       type gets - eight rows plus a title plus the help line needs more than a
       240px-tall window has, and the row that fell off the bottom was BACK.

       So when it will not fit, it scrolls: a window of rows centred on the
       highlighted one, with markers saying there is more. The alternative -
       shrink until it fits - has no solution here, and "no solution" was being
       rendered as "draw it anyway, off the screen". */
    const noteReserve = noteH();
    const listTop = y;
    const listBottom = H - 10 * s - noteReserve;
    const maxRows = Math.max(1, Math.floor((listBottom - listTop) / step));
    const scrolls = CONTROLS.length > maxRows;
    const first = scrolls
      ? Math.max(0, Math.min(this.index - (maxRows >> 1), CONTROLS.length - maxRows))
      : 0;
    const visible = CONTROLS.slice(first, first + maxRows);

    this.hits = [];
    visible.forEach((c, vi) => {
      const i = first + vi;
      const active = i === this.index;
      const color = active ? BONE : BONE_DIM;

      const v = this.fx.value(c.key);
      const rect = { x: left - 10 * s, y: y - 4 * s,
                     w: avail + 20 * s, h: F.lineHeight(row) + 8 * s };
      SATG.fx.drawPress(ctx, v, rect, s);
      const dx = SATG.fx.pressOffset(v, s);

      if (active && this._blink !== false) {
        F.draw(ctx, '>', left - F.advanceFor(row, 0) * 1.6 + dx, y,
               { color: BONE, scale: row });
      }
      F.draw(ctx, c.label, left + dx, y,
             { color: SATG.fx.brighten(color, v), scale: row, tracking: 2 });

      if (c.kind === 'range') {
        F.draw(ctx, c.format(values[c.key]), valX + dx, y,
               { color: SATG.fx.brighten(active ? BONE : BONE_FAINT, v),
                 scale: row, tracking: s });
        const by = y + Math.round((F.cellH * row - barH) / 2);
        ctx.fillStyle = '#241f1a';
        ctx.fillRect(barX, by, barW, barH);
        const t = (values[c.key] - c.min) / (c.max - c.min);
        ctx.fillStyle = SATG.fx.brighten(active ? BONE : BONE_DIM, v);
        ctx.fillRect(barX, by, Math.round(barW * clamp(t, 0, 1)), barH);
        /* A tick at the shipped value, so "back to normal" is a place the
           player can see rather than a number they have to remember. */
        const dt = (DEFAULTS[c.key] - c.min) / (c.max - c.min);
        ctx.fillStyle = BONE_FAINT;
        ctx.fillRect(barX + Math.round(barW * clamp(dt, 0, 1)) - 1, by - 3 * s, 2, barH + 6 * s);
      } else if (c.kind === 'toggle') {
        F.draw(ctx, values[c.key] ? 'ON' : 'OFF', valX + dx, y,
               { color: SATG.fx.brighten(values[c.key] ? GREEN : BONE_FAINT, v),
                 scale: row, tracking: s });
      }

      this.hits.push({ x: left - 20 * s, y: y - 6, w: avail + 40 * s, h: step, index: i });
      y += step;
    });

    // Say so when there is more list than screen, in both directions.
    if (scrolls) {
      if (first > 0) {
        F.draw(ctx, '^ ' + first + ' ABOVE', left + avail, listTop - F.lineHeight(s) - 2 * s,
               { color: BONE_FAINT, scale: s, align: 'right', tracking: s });
      }
      const rest = CONTROLS.length - (first + visible.length);
      if (rest > 0) {
        F.draw(ctx, 'v ' + rest + ' BELOW', left + avail, y,
               { color: BONE_FAINT, scale: s, align: 'right', tracking: s });
      }
    }

    // What the highlighted row does, and how to change it.
    const c = CONTROLS[this.index];
    if (c) {
      const ns = Math.max(s, Math.round(row * 0.8));
      const hint = c.kind === 'range' ? '  (LEFT / RIGHT TO CHANGE)'
                 : c.kind === 'toggle' ? '  (ENTER TO TOGGLE)' : '';
      const fit = F.fitLines(c.note + hint, avail, ns, s, 2, s);
      // Pinned under the list's reserved area rather than under wherever the
      // rows happened to end, so a scrolled list cannot push it off.
      let ny = Math.min(y + 6 * s, H - 4 * s - F.lineHeight(ns) * fit.lines.length);
      for (const ln of fit.lines) {
        F.draw(ctx, ln, left, ny, { color: BONE_FAINT, scale: fit.scale, tracking: s });
        ny += F.lineHeight(fit.scale);
      }
    }

    this.upload();
  }

  hitTest(u, v) {
    if (!this.hits) return null;
    const x = u * this.W, y = v * this.H;
    for (const h of this.hits) {
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h.index;
    }
    return null;
  }
}

SATG.screens.SettingsScreen = SettingsScreen;

})(window);
