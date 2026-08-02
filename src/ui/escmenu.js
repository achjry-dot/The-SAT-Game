/* =========================================================================
   ui/escmenu.js - the in-game menu, dropped from the top of the screen.

   The one thing that shapes every decision in this file: THE CLOCK DOES NOT
   STOP. This is not a pause screen. It is an overlay drawn on top of a running
   exam, and the exam goes on running underneath it - which is why it is a flag
   on the game rather than a state of its own. A separate state would skip
   updateExam, and skipping updateExam is exactly what "pause" means.

   That makes it a slightly dangerous piece of UI: it looks like every pause
   menu the player has ever seen, and it is not one. So it says so, in red, at
   the top, and the countdown stays visible behind it rather than being covered
   by the panel.

   Settings are shown INSIDE this panel rather than by opening the settings
   screen. Opening that screen would mean leaving the 'exam' state, which would
   stop the clock - the very thing this is built not to do. Both pages share
   SATG.settings, so there is one set of values and one place they are stored.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;
const F = SATG.font;
const FX = SATG.fx;
const { clamp } = SATG.util;

const BONE       = '#d9d2c4';
const BONE_DIM   = '#8e8779';
const BONE_FAINT = '#4f4a42';
const BLOOD      = '#a8382c';
const GREEN      = '#7dff9b';
const PANEL_BG   = '#0b0a09';
const PANEL_EDGE = '#2b2721';

const ROOT_ITEMS = [
  { key: 'resume',   label: 'RESUME',        note: 'BACK TO THE PAPER' },
  { key: 'settings', label: 'SETTINGS',      note: 'BRIGHTNESS, SOUND AND DISPLAY' },
  { key: 'restart',  label: 'RESTART RUN',   note: 'START THIS MODE AGAIN FROM THE BEGINNING' },
  { key: 'quit',     label: 'QUIT TO MENU',  note: 'ABANDON THIS RUN AND RETURN TO THE TITLE' }
];

/* How long the panel takes to drop in. Short enough that it never feels like
   something standing between the player and a running clock. */
const OPEN_SECONDS = 0.16;

class EscMenu extends SATG.screens.ScreenCanvas {
  constructor(gl) {
    super(gl, 1280, 720);
    this.open = false;
    this.page = 'root';          // 'root' | 'settings'
    this.index = 0;
    this.settingsIndex = 0;
    this.openT = 0;              // 0..1, drives the drop-in
    this.time = 0;
    this.fx = new FX.PressFX();
    this.hits = [];
    /* Set when the player leaves via an item, and read once by the game. A
       menu that acted on the game directly would need a reference to it, and
       then the panel could not be drawn or tested without one. */
    this.pending = null;
  }

  get items() {
    return this.page === 'settings' ? SATG.settings.CONTROLS : ROOT_ITEMS;
  }

  get cursor() {
    return this.page === 'settings' ? this.settingsIndex : this.index;
  }

  set cursor(i) {
    if (this.page === 'settings') this.settingsIndex = i; else this.index = i;
  }

  get selected() { return this.items[this.cursor] || null; }

  show() {
    this.open = true;
    this.page = 'root';
    this.index = 0;
    this.openT = 0;
    this.fx.clear();
    this.pending = null;
    this.dirty = true;
  }

  hide() {
    this.open = false;
    this.fx.clear();
    this.dirty = true;
  }

  move(dir) {
    const n = this.items.length;
    if (!n) return false;
    this.cursor = (this.cursor + dir + n) % n;
    this.dirty = true;
    return true;
  }

  setIndex(i) {
    if (i < 0 || i >= this.items.length || i === this.cursor) return false;
    this.cursor = i;
    this.dirty = true;
    return true;
  }

  /* Left/right on the settings page. Silent on the root page, where the
     entries have no value to move. */
  adjust(dir) {
    if (this.page !== 'settings') return false;
    const c = this.selected;
    if (!c) return false;
    if (c.kind === 'range') {
      const cur = SATG.settings.get(c.key);
      const next = clamp(Math.round((cur + dir * c.step) / c.step) * c.step, c.min, c.max);
      if (Math.abs(next - cur) < 1e-9) return false;
      SATG.settings.set(c.key, next);
      this.fx.press('s' + c.key);
      this.dirty = true;
      return true;
    }
    if (c.kind === 'toggle') {
      SATG.settings.set(c.key, !SATG.settings.get(c.key));
      this.fx.press('s' + c.key);
      this.dirty = true;
      return true;
    }
    return false;
  }

  /* Enter / click. Returns a short description of what the game should do,
     or null when the menu handled it itself. */
  activate() {
    const item = this.selected;
    if (!item) return null;
    this.fx.press((this.page === 'settings' ? 's' : 'r') + (item.key || this.cursor));
    this.dirty = true;

    if (this.page === 'settings') {
      if (item.kind === 'toggle') { this.adjust(1); return null; }
      if (item.kind === 'action') {
        if (item.key === 'reset') { SATG.settings.restoreDefaults(); return { do: 'reset' }; }
        if (item.key === 'back')  { this.page = 'root'; return { do: 'page' }; }
      }
      return null;                       // ranges move with left/right
    }

    switch (item.key) {
      case 'resume':   return { do: 'resume' };
      case 'settings': this.page = 'settings'; this.settingsIndex = 0; return { do: 'page' };
      case 'restart':  return { do: 'restart' };
      case 'quit':     return { do: 'quit' };
    }
    return null;
  }

  /* ESC inside the menu: out of settings, or shut the whole thing. */
  back() {
    if (this.page === 'settings') { this.page = 'root'; this.dirty = true; return 'page'; }
    return 'close';
  }

  update(dt) {
    if (!this.open) return;
    this.time += dt;
    if (this.openT < 1) {
      this.openT = Math.min(1, this.openT + dt / OPEN_SECONDS);
      this.dirty = true;
    }
    if (this.fx.update(dt)) this.dirty = true;
    const blink = (Math.floor(this.time * 2.2) % 2) === 0;
    if (blink !== this._blink) { this._blink = blink; this.dirty = true; }
  }

  /* ------------------------------------------------------------- render */

  render() {
    if (!this.open) return;
    if (!this.dirty) return;
    const ctx = this.ctx;
    this.clear();

    const W = this.W, H = this.H, s = this.uiScale || 1;
    // Ease-out on the drop, so it arrives rather than slides to a halt.
    const e = 1 - Math.pow(1 - clamp(this.openT, 0, 1), 3);

    /* Scrim. Deliberately partial: the clock is still counting down up there
       and covering it would be the cruellest thing this menu could do. */
    ctx.fillStyle = 'rgba(0,0,0,' + (0.62 * e).toFixed(3) + ')';
    ctx.fillRect(0, 0, W, H);

    const items = this.items;
    const title = this.page === 'settings' ? 'SETTINGS' : 'PAUSED?';

    let head = F.fitScale(title, Math.round(W * 0.5), 3 * s, 3 * s, s);
    let row  = Math.max(s, Math.round(head * 0.62));
    let step = F.lineHeight(row) + 12 * s;
    let noteS = Math.max(s, Math.round(row * 0.8));
    const warn = 'THE CLOCK IS STILL RUNNING';

    const padX = Math.round(22 * s), padY = Math.round(18 * s);
    const maxPanelH = H - 20 * s;
    // Everything in the panel that is not a row: title, rule, and the note.
    const chromeH = () => F.lineHeight(head) + 6 * s +
                          F.lineHeight(noteS) + 12 * s +
                          F.lineHeight(noteS) * 2 + 10 * s;

    // Shrink the type while the WHOLE list could still be made to fit.
    let guard = 0;
    while (chromeH() + step * items.length + padY * 2 > maxPanelH && guard++ < 40) {
      if (row > s) { row -= s; noteS = Math.max(s, Math.round(row * 0.8));
                     step = F.lineHeight(row) + 8 * s; }
      else if (head > s) head -= s;
      else break;
    }

    /* Past the floor there is no scale that fits - the settings page is eight
       rows, and eight rows plus a title do not go into a 240px-tall window at
       any size. Shrinking further is not an option and drawing past the edge
       is not either, so the list scrolls, centred on the cursor. Same answer
       the standalone settings page needed, for the same reason. */
    const maxRows = Math.max(1,
      Math.floor((maxPanelH - padY * 2 - chromeH()) / step));
    const scrolls = items.length > maxRows;
    const first = scrolls
      ? Math.max(0, Math.min(this.cursor - (maxRows >> 1), items.length - maxRows))
      : 0;
    const visible = items.slice(first, first + maxRows);
    const bodyH = chromeH() + step * visible.length;

    const panelW = Math.min(Math.round(W * 0.62), Math.max(Math.round(W * 0.34), 420 * s));
    const panelH = bodyH + padY * 2;
    const panelX = Math.round(W * 0.5 - panelW / 2);
    /* Dropped from above: the panel's final rest is a little above centre, and
       it travels in from off the top edge. */
    const restY = Math.round(H * 0.5 - panelH / 2 - H * 0.04);
    const panelY = Math.round(-panelH + (restY + panelH) * e);

    ctx.fillStyle = PANEL_BG;
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.fillStyle = PANEL_EDGE;
    ctx.fillRect(panelX, panelY, panelW, Math.max(1, Math.round(s)));
    ctx.fillRect(panelX, panelY + panelH - Math.max(1, Math.round(s)),
                 panelW, Math.max(1, Math.round(s)));

    const left = panelX + padX;
    const avail = panelW - padX * 2;
    let y = panelY + padY;

    F.draw(ctx, title, left, y, { color: BONE, scale: head, tracking: 3 * s });
    // The honest bit, right under the title and in the colour of the gunshot.
    if (this.page === 'root') {
      const wf = F.fitScale(warn, avail, noteS, s, s);
      F.draw(ctx, warn, left + avail, y + Math.round(F.cellH * (head - wf) / 2),
             { color: BLOOD, scale: wf, align: 'right', tracking: s });
    }
    y += F.lineHeight(head) + 6 * s;

    ctx.fillStyle = '#1c1a17';
    ctx.fillRect(left, y, avail, Math.max(1, Math.round(s)));
    y += 10 * s;

    this.hits = [];
    const valX = left + Math.round(avail * 0.52);
    const barX = valX + Math.round(avail * 0.14);
    const barW = Math.round(avail * 0.30);

    visible.forEach((item, vi) => {
      const i = first + vi;
      const active = i === this.cursor;
      const id = (this.page === 'settings' ? 's' : 'r') + (item.key || i);
      const v = this.fx.value(id);
      const dx = FX.pressOffset(v, s);

      const rect = { x: left - 6 * s, y: y - 4 * s, w: avail + 12 * s,
                     h: F.lineHeight(row) + 8 * s };
      FX.drawPress(ctx, v, rect, s);

      if (active && this._blink !== false) {
        F.draw(ctx, '>', left - F.advanceFor(row, 0) * 1.4 + dx, y,
               { color: BONE, scale: row });
      }

      const base = active ? BONE : BONE_DIM;
      const ls = F.fitScale(item.label, Math.round(avail * 0.5), row, 2, s);
      F.draw(ctx, item.label, left + dx, y,
             { color: FX.brighten(base, v), scale: ls, tracking: 2 });

      if (this.page === 'settings') {
        if (item.kind === 'range') {
          const val = SATG.settings.get(item.key);
          F.draw(ctx, item.format(val), valX + dx, y,
                 { color: FX.brighten(active ? BONE : BONE_FAINT, v),
                   scale: row, tracking: s });
          const bh = Math.max(3 * s, Math.round(F.cellH * row * 0.5));
          const by = y + Math.round((F.cellH * row - bh) / 2);
          ctx.fillStyle = '#241f1a';
          ctx.fillRect(barX, by, barW, bh);
          ctx.fillStyle = FX.brighten(active ? BONE : BONE_DIM, v);
          ctx.fillRect(barX, by,
                       Math.round(barW * clamp((val - item.min) / (item.max - item.min), 0, 1)), bh);
        } else if (item.kind === 'toggle') {
          const on = SATG.settings.get(item.key);
          F.draw(ctx, on ? 'ON' : 'OFF', valX + dx, y,
                 { color: FX.brighten(on ? GREEN : BONE_FAINT, v), scale: row, tracking: s });
        }
      }

      this.hits.push({ x: rect.x, y: rect.y, w: rect.w, h: rect.h, index: i });
      y += step;
    });

    // Say when the list runs past the panel in either direction.
    if (scrolls) {
      const rest = items.length - (first + visible.length);
      const tag = (first ? '^' + first + ' ' : '') + (rest ? 'v' + rest : '');
      if (tag) {
        F.draw(ctx, tag.trim(), left + avail, y - step + 2 * s,
               { color: BONE_FAINT, scale: Math.max(s, noteS - s),
                 align: 'right', tracking: s });
      }
    }

    // What the highlighted entry does, and how to work it.
    const sel = items[this.cursor];
    if (sel) {
      const hint = this.page === 'settings'
        ? (sel.kind === 'range' ? '  (LEFT / RIGHT)' : sel.kind === 'toggle' ? '  (ENTER)' : '')
        : '';
      const text = (sel.note || '') + hint;
      const fit = F.fitLines(text, avail, noteS, s, 2, s);
      y += 4 * s;
      for (const ln of fit.lines) {
        F.draw(ctx, ln, left, y, { color: BONE_FAINT, scale: fit.scale, tracking: s });
        y += F.lineHeight(fit.scale);
      }
    }

    this.upload();
  }

  hitTest(u, v) {
    if (!this.open || !this.hits) return null;
    const x = u * this.W, y = v * this.H;
    for (const h of this.hits) {
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h.index;
    }
    return null;
  }
}

SATG.screens.EscMenu = EscMenu;
SATG.screens.ESC_ITEMS = ROOT_ITEMS;

})(window);
