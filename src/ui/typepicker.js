/* =========================================================================
   ui/typepicker.js - choose one question type, then drill it.

   Reached from PLAY > ENGLISH or MATH > SPECIFIC QUESTION TYPES. Lists every
   question type in that section as a bar: the name, a percentage from the
   player's own record, and their tally. Opening one shows a short summary and
   an example. START launches a drill on the open type.

   Deliberately lighter than the STATS logbook, which covers the same types.
   The two answer different questions and so carry different weight:

     this screen   "which one am I about to practise" - decide and go
     the logbook   "what is this, and where do I go to learn it" - reference,
                   with College Board's own skill name and every study link

   Duplicating the reference material here would make the pre-game menu a wall
   of text standing between the player and the thing they came to do.

   Types the question bank cannot yet produce are listed and greyed rather than
   hidden, because "the SAT asks this and the game does not" is worth knowing -
   but they cannot be started, since starting one would silently serve
   something else.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;
const F = SATG.font;
const { clamp } = SATG.util;
const TX = SATG.taxonomy;

const BONE       = '#d9d2c4';
const BONE_DIM   = '#8e8779';
const BONE_FAINT = '#4f4a42';
const BLOOD      = '#a8382c';
const GOOD       = '#7dff9b';
const WARN       = '#d8b45c';
const PANEL      = '#191713';
const PANEL_HI   = '#221f1a';

function pctColor(p) { return p >= 0.7 ? GOOD : p >= 0.45 ? WARN : BLOOD; }

class TypePickerScreen extends SATG.screens.ScreenCanvas {
  constructor(gl) {
    super(gl, 1280, 720);
    this.section = 'math';
    this.open = null;          // qtype id whose detail is showing
    this.scroll = 0;
    this.viewH = 1;
    this.contentH = 1;
    this.time = 0;
    this.hits = [];
    this.stats = {};
    this.fx = new SATG.fx.PressFX();
  }

  reset(section) {
    this.section = section === 'rw' ? 'rw' : 'math';
    this.open = null;
    this.scroll = 0;
    this.time = 0;
    this.refresh();
    this.dirty = true;
  }

  /* The percentage beside each type is the player's lifetime record on it, so
     the list doubles as a shortlist of what to work on. */
  refresh() {
    const sum = SATG.profile.summary(this.section);
    this.stats = {};
    for (const q of sum.qtypes || []) this.stats[q.qtype] = q;
    this.dirty = true;
  }

  get types() {
    return TX.QTYPES.filter((q) => TX.sectionOf(q.id) === this.section);
  }

  toggle(id) {
    this.fx.press('t' + id);
    this.open = this.open === id ? null : id;
    this.dirty = true;
    return true;
  }

  canStart() { return !!this.open && SATG.questionBank.canDraw(this.open); }

  scrollBy(d) {
    const max = Math.max(0, this.contentH - this.viewH);
    const next = clamp(this.scroll + d, 0, max);
    if (next === this.scroll) return false;
    this.scroll = next;
    this.dirty = true;
    return true;
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

    const left = Math.round(W * 0.07);
    const avail = Math.round(W * 0.86);

    /* Same discipline as the other long pages: the body's share of the height
       is reserved before the header takes any. */
    const MIN_BODY = Math.max(30 * s, Math.round(H * 0.26));
    const topY = Math.max(10 * s, Math.round(H * 0.05));
    let title = F.fitScale('SPECIFIC QUESTION TYPES', avail, 3 * s, 2 * s, s);
    let row = Math.max(s, Math.round(title * 0.42));
    for (;;) {
      const headH = F.lineHeight(title) + F.lineHeight(row) + 20 * s;
      const footH = F.lineHeight(row) + 22 * s;
      if (topY + headH + footH + MIN_BODY <= H) break;
      if (row > s) { row -= s; continue; }
      if (title > s) { title -= s; continue; }
      break;
    }
    const small = Math.max(s, Math.round(row * 0.82));

    this.hits = [];
    let y = topY;

    F.draw(ctx, 'SPECIFIC QUESTION TYPES', left, y,
           { color: BONE, scale: title, tracking: 3 * s });
    y += F.lineHeight(title) + 4 * s;
    F.draw(ctx, (this.section === 'rw' ? 'READING AND WRITING' : 'MATH') +
           '   ' + this.types.length + ' TYPES   PICK ONE, THEN START',
           left, y, { color: BONE_FAINT, scale: small, tracking: s });
    y += F.lineHeight(small) + 12 * s;

    const footH = F.lineHeight(row) + 22 * s;
    const footY = H - 8 * s - footH;
    const bodyTop = y;
    const bodyBottom = footY - 8 * s;
    this.viewH = Math.max(1, bodyBottom - bodyTop);
    this._bodyTop = bodyTop;
    this._bodyBottom = bodyBottom;

    const blocks = this.buildBlocks({ left, avail, row, small, s });
    this.contentH = blocks.reduce((n, b) => n + b.h, 0);
    this.scroll = clamp(this.scroll, 0, Math.max(0, this.contentH - this.viewH));

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, bodyTop, W, this.viewH);
    ctx.clip();
    let by = bodyTop - this.scroll;
    for (const b of blocks) {
      if (by + b.h >= bodyTop && by <= bodyBottom) b.draw(ctx, by);
      by += b.h;
    }
    ctx.restore();

    if (this.contentH > this.viewH) {
      const thumb = Math.max(12 * s, this.viewH * (this.viewH / this.contentH));
      const t = this.scroll / Math.max(1, this.contentH - this.viewH);
      ctx.fillStyle = '#1c1a17';
      ctx.fillRect(W - 6 * s, bodyTop, 3 * s, this.viewH);
      ctx.fillStyle = BONE_FAINT;
      ctx.fillRect(W - 6 * s, bodyTop + (this.viewH - thumb) * t, 3 * s, thumb);
    }

    this.drawFooter(ctx, left, avail, footY, row, small, s);
    this.upload();
  }

  buildBlocks(L) {
    const { left, avail, row, small, s } = L;
    const blocks = [];
    const slh = F.lineHeight(small);
    const lh = F.lineHeight(row);

    let lastSkill = null;
    for (const q of this.types) {
      const sk = TX.skillOf(q.id);
      if (sk && sk.id !== lastSkill) {
        lastSkill = sk.id;
        const name = sk.cb.toUpperCase();
        blocks.push({ h: slh + 10 * s, draw: (ctx, y) => {
          F.draw(ctx, name, left, y + 4 * s,
                 { color: BONE_FAINT, scale: small, tracking: 2 * s });
        }});
      }

      const st = this.stats[q.id] || { right: 0, total: 0, pct: 0 };
      const isOpen = this.open === q.id;
      const usable = SATG.questionBank.canDraw(q.id);

      blocks.push({ h: lh + 8 * s, draw: (ctx, y) => {
        ctx.fillStyle = isOpen ? PANEL_HI : PANEL;
        ctx.fillRect(left, y, avail, lh + 4 * s);
        const v = this.fx.value('t' + q.id);
        SATG.fx.drawPress(ctx, v, { x: left, y, w: avail, h: lh + 4 * s }, s);
        const dy = SATG.fx.pressOffset(v, s);

        const nameW = Math.round(avail * 0.46);
        const nf = F.fitScale(q.label, nameW - 12 * s, row, s, s);
        F.draw(ctx, (isOpen ? '>' : ' ') + ' ' + q.label, left + 6 * s, y + 2 * s + dy,
               { color: SATG.fx.brighten(usable ? (isOpen ? BONE : BONE_DIM) : BONE_FAINT, v),
                 scale: nf, tracking: s });

        /* The percent bar the brief asked for: how often this player has got
           this type right. Hollow until there is enough of a record to mean
           anything, rather than painting a confident colour over one attempt. */
        const barW = Math.round(avail * 0.26);
        const barX = left + avail - barW - 78 * s;
        const barH = Math.max(3 * s, Math.round(F.cellH * row * 0.5));
        const byy = y + Math.round((F.cellH * row - barH) / 2);
        ctx.fillStyle = '#241f1a';
        ctx.fillRect(barX, byy, barW, barH);
        if (st.total) {
          const filled = Math.max(1 * s, Math.round(barW * clamp(st.pct, 0, 1)));
          if (TX.enoughData(st.total)) {
            ctx.fillStyle = pctColor(st.pct);
            ctx.fillRect(barX, byy, filled, barH);
          } else {
            ctx.fillStyle = BONE_FAINT;
            ctx.fillRect(barX, byy, filled, 1 * s);
            ctx.fillRect(barX, byy + barH - 1 * s, filled, 1 * s);
          }
        }
        const tally = st.total ? Math.round(st.pct * 100) + '%  ' + st.right + '/' + st.total
                               : 'NEW';
        F.draw(ctx, tally, left + avail - 4 * s, y + 2 * s + dy,
               { color: st.total ? BONE_DIM : BONE_FAINT, scale: small,
                 align: 'right', tracking: s });

        this.hits.push({ x: left, y, w: avail, h: lh + 4 * s,
                         kind: 'type', qtype: q.id, scrolls: true });
      }});

      if (isOpen) {
        const asks = F.fitLines(q.asks, avail - 26 * s, small, s, 5, s);
        const ex = F.fitLines('EXAMPLE.  ' + q.example, avail - 26 * s, small, s, 6, s);
        const warn = usable ? null
          : F.fitLines('THIS TYPE IS NOT IN THE QUESTION BANK YET, SO IT CANNOT BE STARTED.',
                       avail - 26 * s, small, s, 3, s);
        const h = F.lineHeight(asks.scale) * asks.lines.length +
                  F.lineHeight(ex.scale) * ex.lines.length +
                  (warn ? F.lineHeight(warn.scale) * warn.lines.length + 6 * s : 0) + 18 * s;
        blocks.push({ h, draw: (ctx, y) => {
          ctx.fillStyle = '#100e0c';
          ctx.fillRect(left, y - 2 * s, avail, h - 6 * s);
          let yy = y + 4 * s;
          for (const ln of asks.lines) {
            F.draw(ctx, ln, left + 14 * s, yy, { color: BONE, scale: asks.scale, tracking: s });
            yy += F.lineHeight(asks.scale);
          }
          yy += 4 * s;
          for (const ln of ex.lines) {
            F.draw(ctx, ln, left + 14 * s, yy, { color: BONE_DIM, scale: ex.scale, tracking: s });
            yy += F.lineHeight(ex.scale);
          }
          if (warn) {
            yy += 4 * s;
            for (const ln of warn.lines) {
              F.draw(ctx, ln, left + 14 * s, yy, { color: WARN, scale: warn.scale, tracking: s });
              yy += F.lineHeight(warn.scale);
            }
          }
        }});
      }
      blocks.push({ h: 3 * s, draw: () => {} });
    }
    blocks.push({ h: 18 * s, draw: () => {} });
    return blocks;
  }

  /* START is pinned beside BACK and never scrolls away, for the same reason the
     results menu is pinned: a page whose only exit can be scrolled off screen
     is a soft-lock waiting to happen. */
  drawFooter(ctx, left, avail, y, row, small, s) {
    const bv = this.fx.value('back');
    const bdx = SATG.fx.pressOffset(bv, s);
    SATG.fx.drawPress(ctx, bv, { x: left - 10 * s, y: y - 6 * s,
                                 w: F.measure('BACK', row, 2 * s) + 40 * s,
                                 h: F.lineHeight(row) + 8 * s }, s);
    if (this._blink !== false) F.draw(ctx, '<', left + bdx, y, { color: BONE, scale: row });
    F.draw(ctx, 'BACK', left + F.advanceFor(row, 0) * 1.8 + bdx, y,
           { color: SATG.fx.brighten(BONE, bv), scale: row, tracking: 2 * s });
    this.hits.push({ x: left - 10 * s, y: y - 6 * s,
                     w: F.measure('BACK', row, 2 * s) + 40 * s,
                     h: F.lineHeight(row) + 10 * s, kind: 'back' });

    const ready = this.canStart();
    const label = ready ? 'START' : (this.open ? 'UNAVAILABLE' : 'PICK A TYPE');
    const w = F.measure(label, row, 3 * s) + 30 * s;
    const h = F.lineHeight(row) + 10 * s;
    const x = left + avail - w;
    const v = this.fx.value('start');
    ctx.fillStyle = ready ? '#1d2a1f' : PANEL;
    ctx.fillRect(x, y - 5 * s, w, h);
    SATG.fx.drawPress(ctx, v, { x, y: y - 5 * s, w, h }, s);
    F.draw(ctx, label, x + 15 * s, y + SATG.fx.pressOffset(v, s),
           { color: SATG.fx.brighten(ready ? GOOD : BONE_FAINT, v),
             scale: row, tracking: 3 * s });
    if (ready) this.hits.push({ x, y: y - 5 * s, w, h, kind: 'start' });

    F.draw(ctx, 'UP / DOWN - SCROLL    ENTER - START    ESC - BACK',
           left + avail, y - F.lineHeight(small) - 8 * s,
           { color: BONE_FAINT, scale: s, align: 'right', tracking: s });
  }

  hitTest(u, v) {
    if (!this.hits) return null;
    const x = u * this.W, y = v * this.H;
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (x < h.x || x > h.x + h.w || y < h.y || y > h.y + h.h) continue;
      // Rows are only live where the scrolling body is actually visible.
      if (h.scrolls && (y < this._bodyTop || y > this._bodyBottom)) continue;
      return h;
    }
    return null;
  }
}

SATG.screens.TypePickerScreen = TypePickerScreen;

})(window);
