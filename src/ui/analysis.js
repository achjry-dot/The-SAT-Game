/* =========================================================================
   ui/analysis.js - the score analysis, in the game's own voice.

   This is the screen the run ends on. It replaces a single fixed card that
   could say no more than "work on Algebra" - which is a third of the Math
   section, and tells a student nothing they can act on.

   Four things it has to be at once, which is what makes the layout awkward:

     a summary      the whole run in one screen-height, for someone who wants
                    the number and nothing else
     a diagnosis    every question type they touched, ranked, with the
                    sample size next to it so a claim can be judged
     a reference    links out to Khan Academy and, for Maths, the Organic
                    Chemistry Tutor
     a record       savable, so it can be reopened later from STATS

   Structure
   ---------
   Header  title, the GAME/PRINT switch, NORMAL/DETAILED, SAVE TO STATS.
           Pinned. Never scrolls away, because a report you cannot leave or
           re-scope is worse than a short one.
   Body    a list of blocks, each of which knows its own height before it is
           drawn, so the scroll extent is known without a trial render. Only
           blocks intersecting the window are drawn.
   Footer  BACK, pinned for the same reason as the header.

   PRINT is not rendered here at all. A canvas cannot be printed and cannot
   hold a real hyperlink, so PRINT hands off to ui/printdoc.js, which builds a
   genuine DOM document. Pretending otherwise would mean a "print" button that
   produces a screenshot and links that cannot be clicked.

   Sample size
   -----------
   Splitting to 65 question types means a leaf can hold one attempt and read
   0%. Every row shows its raw count, because a student is entitled to see
   0/1 - but a CLAIM ("you are weak here") is gated behind
   taxonomy.MIN_CLAIM. Showing a number and asserting what it means are
   different acts, and only the second one needs evidence.
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
const PANEL      = '#191713';
const PANEL_HI   = '#221f1a';
const BLOOD      = '#a8382c';
const GOOD       = '#7dff9b';
const WARN       = '#d8b45c';
const LINK       = '#6fb7d8';

const VIEWS  = [{ key: 'game', label: 'GAME' }, { key: 'print', label: 'PRINT' }];
const DEPTHS = [{ key: 'normal', label: 'NORMAL' }, { key: 'detailed', label: 'DETAILED' }];

function pctColor(p) { return p >= 0.7 ? GOOD : p >= 0.45 ? WARN : BLOOD; }

/* Shrink to fit, and if the smallest legible size still will not fit, cut and
   mark the cut.

   fitScale alone is not enough: it floors at the UI scale, so a long label -
   "Sine and cosine of complementary angles" - silently overflowed its column
   and collided with the bar next to it. Truncating is the honest failure: the
   row still reads, and the ellipsis says there is more rather than pretending
   the overlap is the whole name. */
function fitOrClip(text, maxW, scale, s) {
  text = String(text == null ? '' : text);
  if (F.measure(text, scale, s) <= maxW) return text;
  let lo = 1, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (F.measure(text.slice(0, mid) + '...', scale, s) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  if (lo > 1) return text.slice(0, lo).replace(/[ ,]+$/, '') + '...';
  /* Not even the ellipsis fits. Drawing nothing is the only option that does
     not overflow; a column this narrow cannot occur at the minimum canvas size,
     but a truncating function that can still overflow is not a truncating
     function. */
  return F.measure('...', scale, s) <= maxW ? '...' : '';
}

function clock(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? h + ':' + p(m) + ':' + p(s) : m + ':' + p(s);
}

/* A domain name is long; the bars need a short one that still identifies it. */
function shortDomain(d) {
  return SATG.screens.shortDomain ? SATG.screens.shortDomain(d) : String(d).toUpperCase();
}

class AnalysisScreen extends SATG.screens.ScreenCanvas {
  constructor(gl) {
    super(gl, 1280, 720);
    this.data = null;
    this.view = 'game';
    this.depth = 'normal';
    this.scroll = 0;
    this.viewH = 1;
    this.contentH = 1;
    this.time = 0;
    this.hits = [];
    this.fx = new SATG.fx.PressFX();
    /* When set, an explanation or resource card is open over the report. The
       body keeps its scroll position underneath, so closing the card puts the
       player back exactly where they were rather than at the top. */
    this.card = null;
    this.saved = false;
    this.saveNote = null;
  }

  reset(result) {
    this.data = result || null;
    this.view = 'game';
    this.depth = 'normal';
    this.scroll = 0;
    this.card = null;
    this.saved = false;
    this.saveNote = null;
    this.time = 0;
    this.dirty = true;
  }

  setView(key) {
    if (key === this.view) return false;
    this.view = key;
    this.dirty = true;
    return true;
  }

  setDepth(key) {
    if (key === this.depth) return false;
    this.depth = key;
    /* Depth changes the content length completely, so a scroll offset carried
       over from the other depth would land somewhere arbitrary. */
    this.scroll = 0;
    this.dirty = true;
    return true;
  }

  openCard(card) { this.card = card || null; this.dirty = true; }
  closeCard() {
    if (!this.card) return false;
    this.card = null;
    this.dirty = true;
    return true;
  }

  scrollBy(d) {
    const max = Math.max(0, this.contentH - this.viewH);
    const next = clamp(this.scroll + d, 0, max);
    if (next === this.scroll) return false;
    this.scroll = next;
    this.dirty = true;
    return true;
  }

  press(key) { this.fx.press(key); this.dirty = true; }

  update(dt) {
    this.time += dt;
    const blink = (Math.floor(this.time * 2.2) % 2) === 0;
    if (blink !== this._blink) { this._blink = blink; this.dirty = true; }
    if (this.fx.update(dt)) this.dirty = true;
  }

  /* --------------------------------------------------------------- saving */

  save() {
    if (this.saved || !this.data) return false;
    const res = SATG.profile.saveReview(this.data);
    this.saved = true;
    this.saveNote = res && res.dropped
      ? 'SAVED. OLDEST REVIEW DROPPED (LIMIT ' + res.limit + ').'
      : 'SAVED TO STATS.';
    this.dirty = true;
    return true;
  }

  /* --------------------------------------------------------------- render */

  render() {
    if (!this.dirty) return;
    const ctx = this.ctx;
    this.clear();
    const W = this.W, H = this.H, s = this.uiScale || 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    const left = Math.round(W * 0.06);
    const avail = Math.round(W * 0.88);

    /* The body gets a guaranteed share of the height before the header is
       allowed to take any.

       Laid out the other way round - header first, body with whatever is left
       - a 320x240 window produced a body one pixel tall: the title and the
       three control groups consumed the entire screen, the report drew
       nothing, and because a block that never draws never registers its
       clickable regions, the answer sheet also became unclickable. Both
       symptoms had the same cause, so the fix is at the source: choose the
       header scales that leave the body its minimum, rather than discovering
       afterwards that nothing fits. */
    const MIN_BODY = Math.max(30 * s, Math.round(H * 0.26));
    const topY = Math.max(8 * s, Math.round(H * 0.04));

    let title = F.fitScale('ANALYSIS', avail, 4 * s, 3 * s, s);
    let btn   = Math.max(s, Math.round(title * 0.42));
    let row   = Math.max(s, Math.round(title * 0.32));

    for (;;) {
      const headBottom = topY + F.lineHeight(title) + 8 * s;
      const ctrlBottom = this.layoutControls(null, left, avail, headBottom, btn, s);
      const footRoom = F.lineHeight(row) + 12 * s + 16 * s;
      if (ctrlBottom + footRoom + MIN_BODY <= H) break;
      // Give up the controls first, then the title: the switches stay usable
      // at a small size, but a title nobody can read is just noise.
      if (btn > s) { btn -= s; continue; }
      if (title > s) { title -= s; row = Math.max(s, Math.round(title * 0.32)); continue; }
      break;
    }
    const small = Math.max(s, Math.round(row * 0.8));

    this.hits = [];

    let y = topY;
    F.draw(ctx, 'ANALYSIS', left, y, { color: BONE, scale: title, tracking: 4 * s });

    const d = this.data || {};
    const head = d.kind === 'infinity'
      ? 'INFINITY   SURVIVED ' + clock(d.elapsed || 0)
      : (d.modeLabel || 'PRACTICE') + '   ' + (d.totalScaled || 0) +
        (d.isFull ? ' / 1600' : ' / 800');
    const hf = F.fitScale(head, Math.round(avail * 0.55), row, s, s);
    F.draw(ctx, head, left + avail, y + Math.round(F.cellH * (title - hf) / 2),
           { color: BONE_DIM, scale: hf, align: 'right', tracking: s });
    y += F.lineHeight(title) + 8 * s;

    y = this.layoutControls(ctx, left, avail, y, btn, s);

    const footH = F.lineHeight(row) + 12 * s;
    const footY = H - 8 * s - footH;
    const bodyTop = y;
    const bodyBottom = footY - 8 * s;
    this.viewH = Math.max(1, bodyBottom - bodyTop);

    if (this.view === 'print') {
      this.drawPrintNotice(ctx, left, avail, bodyTop, row, small, s);
      this.contentH = this.viewH;
    } else {
      /* Body-region bounds, kept for hit testing.

         Blocks register their clickable regions while drawing, and drawing is
         clipped to this window - but hit testing is not, so a row scrolled up
         behind the pinned header would still be clickable through it. Recorded
         here and enforced in hitTest, which is the only place that can see
         both the region and the click. */
      this._bodyTop = bodyTop;
      this._bodyBottom = bodyBottom;

      const L = { left, avail, row, small, s, W };
      const blocks = this.buildBlocks(d, L);
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
        const trackH = this.viewH;
        const thumb = Math.max(12 * s, trackH * (this.viewH / this.contentH));
        const t = this.scroll / Math.max(1, this.contentH - this.viewH);
        ctx.fillStyle = '#1c1a17';
        ctx.fillRect(W - 6 * s, bodyTop, 3 * s, trackH);
        ctx.fillStyle = BONE_FAINT;
        ctx.fillRect(W - 6 * s, bodyTop + (trackH - thumb) * t, 3 * s, thumb);
      }
    }

    this.drawFooter(ctx, left, avail, footY, row, s);

    /* The card is drawn last and over everything, including the pinned
       header, so nothing behind it can be clicked by accident. hitTest
       returns only card targets while it is open. */
    if (this.card) this.drawCard(ctx, left, avail, row, small, s);

    this.upload();
  }

  /* Header controls: two switches and a save button, wrapping onto extra rows
     when the width will not take them.

     `ctx` may be null, in which case nothing is drawn and nothing is
     registered as clickable - the call is a measurement. Both passes run the
     same code deliberately: a separate measuring function is the classic way
     to end up with a header that reports one height and occupies another. */
  layoutControls(ctx, left, avail, y, btn, s) {
    const lh = F.lineHeight(btn);
    const h = lh + 8 * s;
    let x = left;

    const cell = (label, active, kind, key, color) => {
      const w = F.measure(label, btn, 2 * s) + 18 * s;
      if (x + w > left + avail) { x = left; y += h + 6 * s; }
      if (ctx) {
        const v = this.fx.value(kind + (key || ''));
        ctx.fillStyle = active ? PANEL_HI : PANEL;
        ctx.fillRect(x, y - 4 * s, w, h);
        if (active) {
          ctx.fillStyle = BONE;
          ctx.fillRect(x, y + lh + 1 * s, w, 2 * s);
        }
        SATG.fx.drawPress(ctx, v, { x, y: y - 4 * s, w, h }, s);
        F.draw(ctx, label, x + 9 * s, y + SATG.fx.pressOffset(v, s),
               { color: SATG.fx.brighten(color || (active ? BONE : BONE_DIM), v),
                 scale: btn, tracking: 2 * s });
        this.hits.push({ x, y: y - 4 * s, w, h, kind, key });
      }
      x += w + 6 * s;
      return w;
    };

    for (const it of VIEWS) cell(it.label, it.key === this.view, 'view', it.key);
    x += 14 * s;
    for (const it of DEPTHS) cell(it.label, it.key === this.depth, 'depth', it.key);
    x += 14 * s;

    // SAVE TO STATS, which reports its own outcome rather than going quiet.
    const label = this.saved ? 'SAVED' : 'SAVE TO STATS';
    if (this.saved) {
      const w = F.measure(label, btn, 2 * s) + 18 * s;
      if (x + w > left + avail) { x = left; y += h + 6 * s; }
      if (ctx) {
        ctx.fillStyle = PANEL;
        ctx.fillRect(x, y - 4 * s, w, h);
        F.draw(ctx, label, x + 9 * s, y, { color: GOOD, scale: btn, tracking: 2 * s });
      }
      x += w + 6 * s;
    } else {
      cell(label, false, 'save', null, BONE);
    }

    if (ctx && this.saveNote) {
      const room = Math.max(1, left + avail - x);
      const nf = F.fitScale(this.saveNote, room, s, s, s);
      if (F.measure(this.saveNote, nf, s) <= room) {
        F.draw(ctx, this.saveNote, x, y + Math.round(F.cellH * (btn - nf) / 2),
               { color: GOOD, scale: nf, tracking: s });
      }
    }

    return y + h + 12 * s;
  }

  drawFooter(ctx, left, avail, y, row, s) {
    const v = this.fx.value('back');
    const dx = SATG.fx.pressOffset(v, s);
    SATG.fx.drawPress(ctx, v, { x: left - 10 * s, y: y - 6 * s,
                                w: F.measure('BACK', row, 2 * s) + 40 * s,
                                h: F.lineHeight(row) + 8 * s }, s);
    if (this._blink !== false) {
      F.draw(ctx, '<', left + dx, y, { color: BONE, scale: row });
    }
    F.draw(ctx, this.card ? 'CLOSE' : 'BACK',
           left + F.advanceFor(row, 0) * 1.8 + dx, y,
           { color: SATG.fx.brighten(BONE, v), scale: row, tracking: 2 * s });
    this.hits.push({ x: left - 10 * s, y: y - 6 * s, w: avail * 0.4,
                     h: F.lineHeight(row) + 10 * s, kind: 'back' });

    const hint = this.card
      ? 'CLICK A LINK TO OPEN IT    ESC - CLOSE'
      : 'UP / DOWN - SCROLL    CLICK A ROW FOR DETAIL    ESC - BACK';
    F.draw(ctx, hint, left + avail, y,
           { color: BONE_FAINT, scale: s, align: 'right', tracking: s });
  }

  /* PRINT is a DOM document, not a canvas render. Say so, and say why. */
  drawPrintNotice(ctx, left, avail, y, row, small, s) {
    const lines = [
      { t: 'PRINT VIEW OPENS A FORMAL DOCUMENT', c: BONE, sc: row },
      { t: 'A printable report needs real text and real links. This canvas ' +
           'can give you neither, so the print view is built as an actual ' +
           'document in a separate layer.', c: BONE_DIM, sc: small },
      { t: 'It carries every question type you were tested on, one page each, ' +
           'with a Khan Academy video and page for each, and a broader video ' +
           'at the end of each group.', c: BONE_DIM, sc: small }
    ];
    let yy = y + 8 * s;
    for (const l of lines) {
      const fit = F.fitLines(l.t, avail, l.sc, s, 6, s);
      for (const ln of fit.lines) {
        F.draw(ctx, ln, left, yy, { color: l.c, scale: fit.scale, tracking: s });
        yy += F.lineHeight(fit.scale);
      }
      yy += 10 * s;
    }
    const label = 'OPEN PRINTABLE REPORT';
    const w = F.measure(label, row, 2 * s) + 24 * s;
    const h = F.lineHeight(row) + 10 * s;
    const v = this.fx.value('open-print');
    ctx.fillStyle = PANEL_HI;
    ctx.fillRect(left, yy, w, h);
    SATG.fx.drawPress(ctx, v, { x: left, y: yy, w, h }, s);
    F.draw(ctx, label, left + 12 * s, yy + 5 * s + SATG.fx.pressOffset(v, s),
           { color: SATG.fx.brighten(GOOD, v), scale: row, tracking: 2 * s });
    this.hits.push({ x: left, y: yy, w, h, kind: 'open-print' });
  }

  /* ---------------------------------------------------------- blocks */

  buildBlocks(d, L) {
    const { left, avail, row, small, s } = L;
    const blocks = [];
    const lh = F.lineHeight(row);
    const slh = F.lineHeight(small);
    const push = (h, draw) => blocks.push({ h, draw });

    const heading = (text) => push(lh + 14 * s, (ctx, y) => {
      F.draw(ctx, text, left, y + 6 * s,
             { color: BONE, scale: row, tracking: 3 * s });
      ctx.fillStyle = BONE_FAINT;
      ctx.fillRect(left, y + 6 * s + lh + 3 * s, avail, 1 * s);
    });

    const note = (text, color) => {
      const fit = F.fitLines(text, avail, small, s, 8, s);
      push(F.lineHeight(fit.scale) * fit.lines.length + 8 * s, (ctx, y) => {
        let yy = y;
        for (const ln of fit.lines) {
          F.draw(ctx, ln, left, yy,
                 { color: color || BONE_DIM, scale: fit.scale, tracking: s });
          yy += F.lineHeight(fit.scale);
        }
      });
    };

    const items = d.items || [];

    /* ---- headline numbers */
    if (d.kind !== 'infinity') {
      const secs = d.sections || [];
      const line = secs.map((sc) =>
        (sc.section === 'math' ? 'MATH ' : 'ENGLISH ') + sc.scaled).join('    ');
      heading('SCORE');
      if (line) note(line, BONE);
      note('RAW ' + (d.rawTotal || 0) + '/' + (d.totalQuestions || 0) +
           '    ANSWERED ' + (d.answered || 0) +
           '    TIME ' + clock(d.elapsed || 0));
      note('Estimated scale. The real raw-to-scaled conversion is not published, ' +
           'so treat this as a band rather than a point.', BONE_FAINT);
    } else {
      heading('RUN');
      note('CLEARED ' + (d.cleared || 0) + '    SURVIVED ' + clock(d.elapsed || 0), BONE);
    }

    /* ---- the answer sheet: every question, in order, right or wrong */
    if (items.length) {
      heading('EVERY QUESTION');
      const cell = Math.max(6 * s, Math.round(F.cellH * small * 0.9));
      const gap = Math.max(2 * s, Math.round(cell * 0.22));
      const perRow = Math.max(1, Math.floor((avail + gap) / (cell + gap)));
      const rows = Math.ceil(items.length / perRow);
      push(rows * (cell + gap) + 10 * s, (ctx, y) => {
        items.forEach((it, i) => {
          const cx = left + (i % perRow) * (cell + gap);
          const cy = y + Math.floor(i / perRow) * (cell + gap);
          ctx.fillStyle = !it.answered ? '#2a2621' : it.right ? GOOD : BLOOD;
          ctx.fillRect(cx, cy, cell, cell);
          /* A module boundary is a real feature of the form, so mark it
             rather than letting 98 identical squares run together. */
          if (it.indexInModule === 0 && i > 0) {
            ctx.fillStyle = BONE;
            ctx.fillRect(cx - Math.round(gap / 2) - 1 * s, cy, 1 * s, cell);
          }
          this.hits.push({ x: cx, y: cy, w: cell, h: cell,
                           kind: 'item', index: i, scrolls: true });
        });
      });
      const right = items.filter((i) => i.right).length;
      const blank = items.filter((i) => !i.answered).length;
      note(right + ' right    ' + (items.length - right - blank) + ' wrong    ' +
           blank + ' blank    -  click any square to see why', BONE_FAINT);
    }

    /* ---- accuracy by difficulty: the dimension nothing used to read */
    const diff = d.perDifficulty || [];
    if (diff.length) {
      heading('BY DIFFICULTY');
      note('Missing the hard ones and being careless on the easy ones are ' +
           'different problems. This is which one you have.', BONE_FAINT);
      for (const e of diff) blocks.push(this.barBlock(L, e.difficulty.toUpperCase(), e));
    }

    /* ---- domains */
    const doms = d.perDomain || [];
    if (doms.length) {
      heading('BY CONTENT DOMAIN');
      for (const e of doms) blocks.push(this.barBlock(L, shortDomain(e.domain), e));
    }

    /* ---- question types */
    const qts = (d.perQType || []).filter((q) => q.qtype);
    if (qts.length) {
      heading(this.depth === 'detailed' ? 'EVERY QUESTION TYPE' : 'WEAKEST QUESTION TYPES');
      const shown = this.depth === 'detailed'
        ? qts.slice().sort((a, b) => a.pct - b.pct || b.total - a.total)
        : qts.slice().sort((a, b) => a.pct - b.pct || b.total - a.total).slice(0, 6);

      if (this.depth !== 'detailed') {
        note('Ranked weakest first. Switch to DETAILED for all ' + qts.length +
             ' with worked examples and study links.', BONE_FAINT);
      }
      for (const e of shown) {
        blocks.push(this.qtypeBlock(L, e));
        if (this.depth === 'detailed') blocks.push(this.qtypeDetailBlock(L, e));
      }
    }

    /* ---- what to do about it, gated on evidence */
    const strong = (d.qtypeStrengths || []).filter((q) => TX.enoughData(q.total));
    const weak = (d.qtypeWeaknesses || []).filter((q) => TX.enoughData(q.total));
    heading('WHAT THIS SAYS');
    if (weak.length) {
      note('Weakest with enough attempts to be sure: ' +
           weak.map((q) => TX.labelOf(q.qtype) + ' (' + q.right + '/' + q.total + ')')
               .join(', '), BLOOD);
    }
    if (strong.length) {
      note('Reliable: ' +
           strong.map((q) => TX.labelOf(q.qtype) + ' (' + q.right + '/' + q.total + ')')
                 .join(', '), GOOD);
    }
    if (!weak.length && !strong.length) {
      note('Not enough attempts on any single question type to call it yet. ' +
           'Every type needs ' + TX.MIN_CLAIM + ' before this page will claim ' +
           'anything about it - the counts above are still real, they just are ' +
           'not evidence yet.', BONE_FAINT);
    }

    push(24 * s, () => {});
    return blocks;
  }

  /* A labelled accuracy bar. Shared by difficulty, domain and question type. */
  barBlock(L, label, e, opts) {
    const { left, avail, row, s } = L;
    const lh = F.lineHeight(row);
    const h = lh + 10 * s;
    opts = opts || {};
    return { h, draw: (ctx, y) => {
      const labelW = Math.round(avail * 0.42);
      const barW = Math.round(avail * 0.34);
      const barX = left + labelW + 8 * s;
      const barH = Math.max(3 * s, Math.round(F.cellH * row * 0.62));
      const ls = F.fitScale(label, labelW - 4 * s, row, s, s);
      F.draw(ctx, fitOrClip(label, labelW - 4 * s, ls, s), left, y,
             { color: opts.color || BONE_DIM, scale: ls, tracking: s });
      const by = y + Math.round((F.cellH * row - barH) / 2);
      ctx.fillStyle = '#241f1a';
      ctx.fillRect(barX, by, barW, barH);
      /* A row with too few attempts to judge is drawn hollow rather than
         coloured, so the eye does not read a confident red off one question. */
      if (TX.enoughData(e.total)) {
        ctx.fillStyle = pctColor(e.pct);
        ctx.fillRect(barX, by, Math.round(barW * clamp(e.pct, 0, 1)), barH);
      } else {
        ctx.fillStyle = BONE_FAINT;
        ctx.fillRect(barX, by, Math.max(1 * s, Math.round(barW * clamp(e.pct, 0, 1))), 1 * s);
        ctx.fillRect(barX, by + barH - 1 * s,
                     Math.max(1 * s, Math.round(barW * clamp(e.pct, 0, 1))), 1 * s);
      }
      const tally = e.right + '/' + e.total + (TX.enoughData(e.total) ? '' : '  ?');
      F.draw(ctx, tally, left + avail, y,
             { color: TX.enoughData(e.total) ? BONE_DIM : BONE_FAINT,
               scale: row, align: 'right', tracking: s });
    } };
  }

  /* A clickable question-type row. */
  qtypeBlock(L, e) {
    const b = this.barBlock(L, TX.labelOf(e.qtype), e, { color: BONE });
    const { left, avail, s } = L;
    const inner = b.draw;
    return { h: b.h, draw: (ctx, y) => {
      inner(ctx, y);
      this.hits.push({ x: left, y, w: avail, h: b.h,
                       kind: 'qtype', qtype: e.qtype, scrolls: true });
    } };
  }

  /* The detailed body under a question type: what it asks, an example, the
     trap, and the study links. */
  qtypeDetailBlock(L, e) {
    const { left, avail, small, s } = L;
    const q = TX.qtype(e.qtype);
    const r = TX.resources(e.qtype);
    const indent = left + 12 * s;
    const w = avail - 12 * s;

    const paras = [];
    if (q) {
      paras.push({ t: q.asks, c: BONE_DIM });
      paras.push({ t: 'Example.  ' + q.example, c: BONE });
      paras.push({ t: 'Usually missed by.  ' + q.trap, c: WARN });
    } else {
      paras.push({ t: 'No description recorded for this question type.', c: BONE_FAINT });
    }

    const fits = paras.map((p) => ({ p, fit: F.fitLines(p.t, w, small, s, 8, s) }));
    const textH = fits.reduce(
      (n, f) => n + F.lineHeight(f.fit.scale) * f.fit.lines.length + 5 * s, 0);

    const links = [];
    if (r.video) links.push({ label: 'HELPFUL VIDEO', url: r.video });
    if (r.page)  links.push({ label: 'HELPFUL PAGE',  url: r.page });
    if (r.oct)   links.push({ label: 'COVERS EVERYTHING: ' + (r.skillName || '').toUpperCase(),
                              url: r.oct.url });
    const linkH = links.length * (F.lineHeight(small) + 6 * s);

    const h = textH + linkH + 12 * s;
    return { h, draw: (ctx, y) => {
      ctx.fillStyle = PANEL;
      ctx.fillRect(left, y - 2 * s, avail, h - 4 * s);
      let yy = y + 3 * s;
      for (const f of fits) {
        for (const ln of f.fit.lines) {
          F.draw(ctx, ln, indent, yy, { color: f.p.c, scale: f.fit.scale, tracking: s });
          yy += F.lineHeight(f.fit.scale);
        }
        yy += 5 * s;
      }
      for (const l of links) {
        const t = l.label;
        F.draw(ctx, t, indent, yy, { color: LINK, scale: small, tracking: s });
        const lw = F.measure(t, small, s);
        ctx.fillStyle = LINK;
        ctx.fillRect(indent, yy + F.lineHeight(small) - 2 * s, lw, 1 * s);
        this.hits.push({ x: indent, y: yy, w: lw + 8 * s,
                         h: F.lineHeight(small) + 4 * s,
                         kind: 'link', url: l.url, scrolls: true });
        yy += F.lineHeight(small) + 6 * s;
      }
    } };
  }

  /* ----------------------------------------------------------- the card */

  drawCard(ctx, left, avail, row, small, s) {
    const W = this.W, H = this.H;
    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    ctx.fillRect(0, 0, W, H);

    const cw = Math.min(avail, Math.round(W * 0.8));
    const cx = Math.round((W - cw) / 2);
    const pad = 14 * s;
    const inner = cw - pad * 2;

    const c = this.card;
    const paras = c.lines.map((l) => ({
      c: l.c, fit: F.fitLines(l.t, inner, l.sc || small, s, 10, s)
    }));
    const textH = paras.reduce(
      (n, p) => n + F.lineHeight(p.fit.scale) * p.fit.lines.length + 6 * s, 0);
    const links = c.links || [];
    const linkH = links.length * (F.lineHeight(small) + 8 * s);
    const titleH = F.lineHeight(row) + 10 * s;
    const ch = Math.min(H - 40 * s, titleH + textH + linkH + pad * 2);
    const cy = Math.round((H - ch) / 2);

    ctx.fillStyle = PANEL_HI;
    ctx.fillRect(cx, cy, cw, ch);
    ctx.fillStyle = BONE_FAINT;
    ctx.fillRect(cx, cy, cw, 1 * s);
    ctx.fillRect(cx, cy + ch - 1 * s, cw, 1 * s);

    ctx.save();
    ctx.beginPath();
    ctx.rect(cx, cy, cw, ch);
    ctx.clip();

    let y = cy + pad;
    const tf = F.fitScale(c.title, inner, row, s, s);
    F.draw(ctx, c.title, cx + pad, y, { color: BONE, scale: tf, tracking: 2 * s });
    y += F.lineHeight(tf) + 8 * s;

    for (const p of paras) {
      for (const ln of p.fit.lines) {
        F.draw(ctx, ln, cx + pad, y, { color: p.c, scale: p.fit.scale, tracking: s });
        y += F.lineHeight(p.fit.scale);
      }
      y += 6 * s;
    }
    for (const l of links) {
      F.draw(ctx, l.label, cx + pad, y, { color: LINK, scale: small, tracking: s });
      const lw = F.measure(l.label, small, s);
      ctx.fillStyle = LINK;
      ctx.fillRect(cx + pad, y + F.lineHeight(small) - 2 * s, lw, 1 * s);
      this.hits.push({ x: cx + pad, y, w: lw + 8 * s,
                       h: F.lineHeight(small) + 4 * s, kind: 'link', url: l.url });
      y += F.lineHeight(small) + 8 * s;
    }
    ctx.restore();
  }

  /* Build the explanation card for one answered question. Five lines, in the
     order Khan's own guides use: what it tested, why the key is right, why
     yours was wrong, how to spot it next time, and the usual trap. The third
     is dropped on a correct answer and the rest still read properly, which is
     what lets the same card serve the review of a question you got right. */
  cardForItem(i) {
    const items = (this.data && this.data.items) || [];
    const it = items[i];
    if (!it) return null;
    const q = TX.qtype(it.qtype);
    const r = it.qtype ? TX.resources(it.qtype) : null;
    const lines = [];

    lines.push({ t: (it.answered ? (it.right ? 'CORRECT' : 'INCORRECT') : 'NOT ANSWERED') +
                    '   -   ' + (q ? q.label : TX.labelOf(it.qtype)), c: it.right ? GOOD : BLOOD });
    if (q) lines.push({ t: q.asks, c: BONE_DIM });
    if (it.correctText) lines.push({ t: 'Correct answer.  ' + it.correctText, c: BONE });
    if (it.answered && !it.right && it.responseText) {
      lines.push({ t: 'You answered.  ' + it.responseText, c: BLOOD });
      /* The most useful sentence on this card: not that the answer was wrong,
         but which mistake produces it. */
      if (it.whyWrong) lines.push({ t: 'That is what you get if.  ' + it.whyWrong, c: WARN });
    }
    if (it.explanation) lines.push({ t: 'Why.  ' + it.explanation, c: BONE_DIM });
    if (q) lines.push({ t: 'Usually missed by.  ' + q.trap, c: WARN });

    const links = [];
    if (r) {
      if (r.video) links.push({ label: 'HELPFUL VIDEO', url: r.video });
      if (r.page)  links.push({ label: 'HELPFUL PAGE',  url: r.page });
      if (r.oct)   links.push({ label: 'COVERS EVERYTHING: ' +
                                       (r.skillName || '').toUpperCase(), url: r.oct.url });
    }
    return { title: 'QUESTION ' + it.n, lines, links };
  }

  cardForQType(qtype) {
    const q = TX.qtype(qtype);
    const r = TX.resources(qtype);
    const lines = [];
    if (q) {
      lines.push({ t: q.asks, c: BONE_DIM });
      lines.push({ t: 'Example.  ' + q.example, c: BONE });
      lines.push({ t: 'Usually missed by.  ' + q.trap, c: WARN });
    }
    if (r.skillName) {
      lines.push({ t: 'College Board calls this skill "' + r.skillName + '".', c: BONE_FAINT });
    }
    const links = [];
    if (r.video) links.push({ label: 'HELPFUL VIDEO', url: r.video });
    if (r.page)  links.push({ label: 'HELPFUL PAGE',  url: r.page });
    if (r.oct)   links.push({ label: 'COVERS EVERYTHING: ' +
                                     (r.skillName || '').toUpperCase(), url: r.oct.url });
    return { title: TX.labelOf(qtype).toUpperCase(), lines, links };
  }

  /* ---------------------------------------------------------- hit testing */

  hitTest(u, v) {
    if (!this.hits) return null;
    const x = u * this.W, y = v * this.H;
    /* While a card is open only its own targets are live. Anything else would
       let a click land on the report behind the overlay. */
    const pool = this.card ? this.hits.filter((h) => h.kind === 'link' || h.kind === 'back')
                           : this.hits;
    for (let i = pool.length - 1; i >= 0; i--) {
      const h = pool[i];
      if (x < h.x || x > h.x + h.w || y < h.y || y > h.y + h.h) continue;
      /* A body row only counts where the body is actually visible. Without
         this a row scrolled up under the header stays clickable through it,
         and the click lands on something the player cannot see. */
      if (h.scrolls && !this.card &&
          (y < this._bodyTop || y > this._bodyBottom)) continue;
      return h;
    }
    return null;
  }
}

SATG.screens.AnalysisScreen = AnalysisScreen;
SATG.screens.analysisClock = clock;
/* Exported because the same overflow exists anywhere a long name sits beside a
   fixed column - the stats logbook and the type picker both do - and because a
   layout helper that cannot be measured from outside cannot be tested. */
SATG.screens.fitOrClip = fitOrClip;

})(window);
