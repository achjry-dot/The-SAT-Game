/* =========================================================================
   ui/results.js - the score report, and the card between modules.

   Two related screens in one class, because they are the same surface at
   different moments of the same run and sharing the layout code keeps them
   looking like one document:

     'break'    shown between modules. Says which module is next, and how the
                one just finished went in terms of pace rather than score -
                the real test tells you nothing about how you did, and neither
                does this.
     'results'  shown when the form is over. Scaled score, section split,
                per-domain performance drawn as bars and then stated in words.

   Everything is measured before it is drawn and dropped from the bottom up
   when the window is too short, in that order: skills, then module detail,
   then the domain bars, then the summary line. The two menu items at the
   bottom are never dropped, because a results screen you cannot leave is a
   soft-lock.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;
const F = SATG.font;
const { clamp } = SATG.util;

const BONE       = '#d9d2c4';
const BONE_DIM   = '#8e8779';
const BONE_FAINT = '#4f4a42';
const BLOOD      = '#a8382c';
const GOOD       = '#7dff9b';
const WARN       = '#d8b45c';

/* ANALYSIS comes first because it is the reason the run was worth taking:
   the score is one number, the analysis is what to do about it. */
const ITEMS = [
  { key: 'analysis', label: 'FULL ANALYSIS' },
  { key: 'retry',    label: 'RETRY' },
  { key: 'menu',     label: 'MAIN MENU' }
];

const BREAK_ITEMS = [
  { key: 'continue', label: 'CONTINUE' },
  { key: 'quit',     label: 'ABANDON' }
];

/* Seconds to H:MM:SS, or M:SS under an hour. */
function clock(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? h + ':' + p(m) + ':' + p(s) : m + ':' + p(s);
}

/* A domain name is long ("Problem-Solving and Data Analysis"); the bars need a
   short one that still identifies it. */
function shortDomain(d) {
  return String(d)
    .replace('Problem-Solving and Data Analysis', 'DATA ANALYSIS')
    .replace('Geometry and Trigonometry', 'GEOMETRY / TRIG')
    .replace('Standard English Conventions', 'CONVENTIONS')
    .replace('Information and Ideas', 'INFORMATION + IDEAS')
    .replace('Craft and Structure', 'CRAFT + STRUCTURE')
    .replace('Expression of Ideas', 'EXPRESSION OF IDEAS')
    .replace('Advanced Math', 'ADVANCED MATH')
    .toUpperCase();
}

function pctColor(p) {
  return p >= 0.7 ? GOOD : p >= 0.45 ? WARN : BLOOD;
}

class ResultsScreen extends SATG.screens.ScreenCanvas {
  constructor(gl) {
    super(gl, 1280, 720);
    this.mode = 'results';
    this.data = null;
    this.breakInfo = null;
    this.index = 0;
    this.time = 0;
    this.hits = [];
    this.fx = new SATG.fx.PressFX();
    /* The circled i beside the correct answer: its rectangle, whether the
       pointer is over it, and whether its panel is open. */
    this.infoRect = null;
    this.infoHover = false;
    this.explain = false;
  }

  setHover(u, v) {
    if (!this.infoRect) {
      if (this.infoHover) { this.infoHover = false; this.dirty = true; }
      return;
    }
    const x = u * this.W, y = v * this.H, r = this.infoRect;
    const over = x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    if (over !== this.infoHover) { this.infoHover = over; this.dirty = true; }
  }

  hitInfo(u, v) {
    if (!this.infoRect) return false;
    const x = u * this.W, y = v * this.H, r = this.infoRect;
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  toggleExplain() {
    this.explain = !this.explain;
    this.dirty = true;
    return this.explain;
  }

  get list() { return this.mode === 'break' ? BREAK_ITEMS : ITEMS; }
  get selected() { const i = this.list[this.index]; return i ? i.key : null; }

  reset(result) {
    this.mode = 'results';
    this.data = result || null;
    this.index = 0;
    this.time = 0;
    this.infoRect = null;
    this.infoHover = false;
    this.explain = false;
    this.dirty = true;
  }

  resetBreak(info, form) {
    this.mode = 'break';
    this.breakInfo = info || null;
    this.form = form || null;
    this.index = 0;
    this.time = 0;
    this.dirty = true;
  }

  move(dir) {
    const n = this.list.length;
    this.index = (this.index + dir + n) % n;
    this.dirty = true;
    return true;
  }

  setIndex(i) {
    if (i < 0 || i >= this.list.length || i === this.index) return false;
    this.index = i;
    this.dirty = true;
    return true;
  }

  /* Fired by the game just before it acts on the selection, so the flash is
     visible during the transition rather than being thrown away with the
     screen. */
  press() { this.fx.press(this.index); this.dirty = true; }

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
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.W, this.H);
    if (this.mode === 'break') this.renderBreak(ctx);
    else this.renderResults(ctx);
    this.upload();
  }

  /* ------------------------------------------------------------- break */

  renderBreak(ctx) {
    const W = this.W, H = this.H, s = this.uiScale || 1;
    const cx = Math.round(W / 2);
    const avail = Math.round(W * 0.86);
    const info = this.breakInfo || {};
    const to = info.to, from = info.from;

    const heading = info.wasBreak ? 'BREAK' : 'MODULE COMPLETE';
    const nextLine = to ? 'NEXT: MODULE ' + to.number + ' OF ' + to.ofTotal +
                          '   ' + (to.section === 'math' ? 'MATH' : 'READING AND WRITING')
                        : '';
    const pace = from
      ? from.answeredCount + ' OF ' + from.count + ' ANSWERED' +
        (from.timeLeft > 0 ? '   ' + clock(from.timeLeft) + ' UNUSED' : '   TIME EXPIRED')
      : '';
    /* The real test seals a module the moment its time is up, and gives no
       indication of how it went. Saying so here is the difference between the
       player thinking the game forgot to score them and understanding that
       this is what the exam does. */
    const note = 'THIS MODULE IS SEALED. YOU CANNOT RETURN TO IT.';
    const routed = info.wasBreak
      ? 'THE NEXT SECTION BEGINS. TAKE A MOMENT.'
      : 'THE NEXT MODULE IS SET BY HOW THIS ONE WENT.';

    /* Same discipline as the score report: the menu is placed first and the
       text fits above it. CONTINUE is the only way back into the exam, so it
       is the last thing that may be given up. */
    let big = F.fitScale(heading, avail, 6 * s, 5 * s, s);
    let itemScale = Math.max(s, Math.round(big * 0.34));
    let step = F.lineHeight(itemScale) + 12 * s;
    while (step * BREAK_ITEMS.length > H * 0.42 && itemScale > s) {
      itemScale -= s;
      step = F.lineHeight(Math.max(s, itemScale)) + 8 * s;
    }
    itemScale = Math.max(s, itemScale);
    const menuY = Math.max(F.lineHeight(itemScale),
                           H - 12 * s - step * BREAK_ITEMS.length);
    const floor = menuY - 8 * s;

    let top = Math.max(10 * s, Math.round(H * 0.12));
    while (big > s && top + F.lineHeight(big) + F.lineHeight(s) > floor) big -= s;
    big = Math.max(s, big);

    const mid = Math.max(s, Math.round(big * 0.28));
    const small = Math.max(s, Math.round(big * 0.2));

    // Ordered most to least important; the tail is dropped when short.
    const lines = [
      { t: nextLine, c: BONE,       sc: mid },
      { t: pace,     c: BONE_DIM,   sc: small },
      { t: routed,   c: BONE_FAINT, sc: small },
      { t: note,     c: BONE_FAINT, sc: small }
    ].filter((l) => l.t);

    let y = top;
    F.draw(ctx, heading, cx, y, { color: BONE, scale: big, tracking: 5 * s, align: 'center' });
    y += F.lineHeight(big) + Math.round(H * 0.05);

    for (const l of lines) {
      const fit = F.fitLines(l.t, avail, l.sc, s, 2, s);
      const h = F.lineHeight(fit.scale) * fit.lines.length + 8 * s;
      if (y + h > floor) break;
      for (const ln of fit.lines) {
        F.draw(ctx, ln, cx, y, { color: l.c, scale: fit.scale, tracking: s, align: 'center' });
        y += F.lineHeight(fit.scale);
      }
      y += 8 * s;
    }
    this.drawMenu(ctx, menuY, BREAK_ITEMS, itemScale, step);
  }

  /* ----------------------------------------------------------- results */

  renderResults(ctx) {
    const W = this.W, H = this.H, s = this.uiScale || 1;
    const cx = Math.round(W / 2);
    const avail = Math.round(W * 0.86);
    const d = this.data || {};
    const infinity = d.kind === 'infinity';

    const heading = infinity ? 'YOU LOSE' : String(d.totalScaled);
    const headColor = infinity ? BLOOD : BONE;
    const domains = (d.perDomain || []).slice();
    const sections = (d.sections || []).slice();

    /* The menu's position is decided FIRST and never moved.

       The obvious way round - lay the report out from the top and put the menu
       after it - is what this did, with a Math.max() to stop the two
       overlapping. That max is the bug: when the content is taller than the
       screen it wins, and RETRY and MAIN MENU are drawn past the bottom edge.
       It went off screen on a 1920x1080 display at 2x, which is an entirely
       ordinary setup, and a score report with no way out is a soft-lock.

       So: reserve the menu, reserve the disclaimer, and give whatever is left
       to the report. Anything that does not fit in that space is dropped,
       cheapest first. */
    let item = Math.max(s, Math.round(F.fitScale(heading, avail, 9 * s, 6 * s, s) * 0.26));
    let step = F.lineHeight(item) + 12 * s;
    // On a very short screen even the menu has to give ground.
    while (step * ITEMS.length > H * 0.42 && item > s) {
      item -= s;
      step = F.lineHeight(Math.max(s, item)) + 8 * s;
    }
    item = Math.max(s, item);
    const menuY = Math.max(F.lineHeight(item), H - 10 * s - step * ITEMS.length);

    // The disclaimer sits directly above the menu, if there is room for it.
    const capped = sections.some((sc) => sc.capped);
    const note = infinity ? null : (capped
      ? 'ESTIMATED SCALE. LOWER MODULE 2 CAPS THE SECTION NEAR ' +
        SATG.exam.LOWER_ROUTE_CAP + '.'
      : 'ESTIMATED SCALE. THE REAL CONVERSION IS NOT PUBLISHED.');
    const noteFit = note ? F.fitLines(note, avail, s, s, 2, s) : null;
    const noteH = noteFit ? F.lineHeight(noteFit.scale) * noteFit.lines.length + 8 * s : 0;

    let floor = menuY - 8 * s;
    const showNote = noteFit && floor - noteH > H * 0.3;
    if (showNote) floor -= noteH;

    /* Headline scale comes down until the headline plus the one line under it
       leaves room for at least the summary. */
    let big = F.fitScale(heading, avail, 9 * s, 6 * s, s);
    let top = Math.max(8 * s, Math.round(H * 0.07));
    while (big > s && top + F.lineHeight(big) + F.lineHeight(s) * 3 > floor) {
      big -= s;
    }
    big = Math.max(s, big);
    const sub = Math.max(s, Math.round(big * 0.22));
    const row = Math.max(s, Math.round(big * 0.16));
    const rowH = F.lineHeight(row) + 8 * s;

    let y = top;

    // Which run this was, above the number.
    if (d.modeLabel && y - F.lineHeight(row) - 4 * s >= 0) {
      F.draw(ctx, d.modeLabel, cx, y - F.lineHeight(row) - 4 * s,
             { color: BONE_FAINT, scale: row, tracking: 2 * s, align: 'center' });
    }

    F.draw(ctx, heading, cx, y,
           { color: headColor, scale: big, tracking: 5 * s, align: 'center' });
    y += F.lineHeight(big) + 6 * s;

    // Everything past this point asks permission before it draws.
    const room = (h) => y + h <= floor;

    if (!infinity && room(F.lineHeight(row) + 8 * s)) {
      F.draw(ctx, d.isFull ? 'OUT OF 1600' : 'OUT OF 800', cx, y,
             { color: BONE_FAINT, scale: row, tracking: 2 * s, align: 'center' });
      y += F.lineHeight(row) + 8 * s;
    }

    if (sections.length) {
      const txt = sections.map((sc) =>
        (sc.section === 'math' ? 'MATH ' : 'ENGLISH ') + sc.scaled).join('    ');
      const fit = F.fitScale(txt, avail, sub, 2 * s, s);
      if (room(F.lineHeight(fit) + 10 * s)) {
        F.draw(ctx, txt, cx, y, { color: BONE, scale: fit, tracking: 2 * s, align: 'center' });
        y += F.lineHeight(fit) + 10 * s;
      }
    }

    const summary = infinity
      ? 'SURVIVED ' + clock(d.elapsed || 0) + '    CLEARED ' + (d.cleared || 0) +
        '    BEST ' + (d.best || 0)
      : 'RAW ' + (d.rawTotal || 0) + '/' + (d.totalQuestions || 0) +
        '    ANSWERED ' + (d.answered || 0) +
        '    TIME ' + clock(d.elapsed || 0);
    const sfit = F.fitLines(summary, avail, sub, s, 2, s);
    if (room(F.lineHeight(sfit.scale) * sfit.lines.length + 12 * s)) {
      for (const ln of sfit.lines) {
        F.draw(ctx, ln, cx, y,
               { color: BONE_DIM, scale: sfit.scale, tracking: s, align: 'center' });
        y += F.lineHeight(sfit.scale);
      }
      y += 12 * s;
    }

    /* ---- what the answer actually was.

       Reserved before the bars, and for an Infinity death before almost
       everything: the run ended on one question, and the answer to it is the
       most useful thing this screen can say. The bars are context; this is the
       lesson. */
    const lq = d.lastQuestion;
    this.infoRect = null;
    if (infinity && lq && lq.answerText) {
      const lead = 'CORRECT ANSWER:  ';
      const answerFit = F.fitLines(lead + lq.answerText, avail, row, s, 3, s);
      const aH = F.lineHeight(answerFit.scale) * answerFit.lines.length + 10 * s;
      if (y + aH <= floor) {
        const first = answerFit.lines[0];
        let ay = y;
        for (const ln of answerFit.lines) {
          F.draw(ctx, ln, cx, ay,
                 { color: GOOD, scale: answerFit.scale, tracking: s, align: 'center' });
          ay += F.lineHeight(answerFit.scale);
        }
        /* The circled i sits just past the end of the first line. Centred text
           means measuring the line to find where it ends. */
        const fw = F.measure(first, answerFit.scale, s);
        const size = Math.max(7 * s, Math.round(F.cellH * answerFit.scale * 0.8));
        const ix = Math.round(cx + fw / 2 + 6 * s);
        const iy = y + Math.round((F.cellH * answerFit.scale - size) / 2);
        const r = size / 2;
        ctx.beginPath();
        ctx.arc(ix + r, iy + r, r, 0, Math.PI * 2);
        ctx.strokeStyle = this.infoHover || this.explain ? BONE : BONE_DIM;
        ctx.lineWidth = Math.max(1, Math.round(s));
        ctx.stroke();
        F.draw(ctx, 'i', ix + r - F.advanceFor(s, 0) * 0.5, iy + Math.round(r - F.cellH * s / 2),
               { color: this.infoHover || this.explain ? BONE : BONE_DIM, scale: s });
        this.infoRect = { x: ix - 4 * s, y: iy - 4 * s, w: size + 8 * s, h: size + 8 * s };

        // The hover label, which is what tells anyone the circle is a control.
        if (this.infoHover && !this.explain) {
          F.draw(ctx, 'SEE WHY', ix + size + 8 * s,
                 y + Math.round((F.cellH * answerFit.scale - F.cellH * s) / 2),
                 { color: BONE, scale: s, tracking: s });
        }
        y = ay + 10 * s;
      }
    }

    /* The open explanation replaces the bars rather than squeezing them: it is
       what the player asked for by clicking, and half an explanation is worth
       less than none. */
    if (this.explain && lq) {
      const parts = [];
      const tx = SATG.taxonomy;
      const q = lq.qtype ? tx.qtype(lq.qtype) : null;
      if (q) parts.push({ t: q.label.toUpperCase() + '.  ' + q.asks, c: BONE });
      if (lq.yours) parts.push({ t: 'YOU ANSWERED.  ' + lq.yours, c: BLOOD });
      if (lq.whyWrong) parts.push({ t: 'THAT IS WHAT YOU GET IF.  ' + lq.whyWrong, c: WARN });
      else if (lq.wasTimeout) parts.push({ t: 'YOU RAN OUT OF TIME ON THIS ONE.', c: BLOOD });
      if (lq.explanation) parts.push({ t: 'WHY.  ' + lq.explanation, c: BONE_DIM });
      if (q) parts.push({ t: 'USUALLY MISSED BY.  ' + q.trap, c: WARN });
      parts.push({ t: 'FULL ANALYSIS HAS THE STUDY LINKS FOR THIS QUESTION TYPE.', c: BONE_FAINT });

      for (const p of parts) {
        const fit = F.fitLines(p.t, avail, row, s, 6, s);
        const h = F.lineHeight(fit.scale) * fit.lines.length + 6 * s;
        if (y + h > floor) break;
        for (const ln of fit.lines) {
          F.draw(ctx, ln, cx, y,
                 { color: p.c, scale: fit.scale, tracking: s, align: 'center' });
          y += F.lineHeight(fit.scale);
        }
        y += 6 * s;
      }
      this.drawMenu(ctx, menuY, ITEMS, item, step);
      if (showNote) {
        let ny = menuY - 8 * s - F.lineHeight(noteFit.scale) * noteFit.lines.length;
        for (const ln of noteFit.lines) {
          F.draw(ctx, ln, cx, ny,
                 { color: BONE_FAINT, scale: noteFit.scale, tracking: s, align: 'center' });
          ny += F.lineHeight(noteFit.scale);
        }
      }
      return;
    }

    /* The two plain-English lines are reserved BEFORE the bars, because a bar
       chart shows the shape and a sentence tells you what to practise - and if
       only one of them fits, the sentence is the more useful. */
    const strong = (d.strengths || [])[0];
    const weak = (d.weaknesses || [])[0];
    const wordsH = F.lineHeight(row) * 2 + 16 * s;
    const barCeiling = floor - (room(wordsH) ? wordsH : 0);

    const maxRows = Math.max(0, Math.floor((barCeiling - y) / rowH));
    const shown = domains.slice(0, maxRows);

    if (shown.length) {
      const left = Math.round((W - avail) / 2);
      const labelW = Math.round(avail * 0.40);
      const barW = Math.round(avail * 0.36);
      const barX = left + labelW + 8 * s;
      const barH = Math.max(3 * s, Math.round(F.cellH * row * 0.7));

      for (const dm of shown) {
        const name = shortDomain(dm.domain);
        const ls = F.fitScale(name, labelW, row, s, s);
        F.draw(ctx, name, left, y, { color: BONE_DIM, scale: ls, tracking: s });

        const by = y + Math.round((F.cellH * row - barH) / 2);
        ctx.fillStyle = '#241f1a';
        ctx.fillRect(barX, by, barW, barH);
        ctx.fillStyle = pctColor(dm.pct);
        ctx.fillRect(barX, by, Math.round(barW * clamp(dm.pct, 0, 1)), barH);

        F.draw(ctx, dm.right + '/' + dm.total, left + avail, y,
               { color: BONE_DIM, scale: row, align: 'right', tracking: s });
        y += rowH;
      }
      y += 6 * s;
      if (shown.length < domains.length) {
        // Never let a truncated list read as the whole story.
        if (room(F.lineHeight(s) + 4 * s)) {
          F.draw(ctx, '+ ' + (domains.length - shown.length) + ' MORE', cx, y,
                 { color: BONE_FAINT, scale: s, tracking: s, align: 'center' });
          y += F.lineHeight(s) + 4 * s;
        }
      }
    }

    if (y + wordsH <= floor) {
      F.draw(ctx, strong ? 'STRONGEST: ' + shortDomain(strong.domain)
                         : 'STRONGEST: NOT ENOUGH DATA',
             cx, y, { color: GOOD, scale: row, tracking: s, align: 'center' });
      y += F.lineHeight(row) + 4 * s;
      F.draw(ctx, weak ? 'WORK ON: ' + shortDomain(weak.domain)
                       : 'WORK ON: NOT ENOUGH DATA',
             cx, y, { color: BLOOD, scale: row, tracking: s, align: 'center' });
    }

    /* The scale is an approximation of an unpublished conversion, and saying
       so is the difference between a practice tool and a fake score. */
    if (showNote) {
      let ny = menuY - 8 * s - F.lineHeight(noteFit.scale) * noteFit.lines.length;
      for (const ln of noteFit.lines) {
        F.draw(ctx, ln, cx, ny,
               { color: BONE_FAINT, scale: noteFit.scale, tracking: s, align: 'center' });
        ny += F.lineHeight(noteFit.scale);
      }
    }

    this.drawMenu(ctx, menuY, ITEMS, item, step);
  }

  drawMenu(ctx, y, list, itemScale, step) {
    const cx = Math.round(this.W / 2);
    const s = this.uiScale || 1;
    this.hits = [];
    list.forEach((item, i) => {
      const active = i === this.index;
      const w = F.measure(item.label, itemScale, 3 * s);

      const v = this.fx.value(i);
      const rect = { x: cx - w / 2 - 10 * s, y: y - 4 * s,
                     w: w + 20 * s, h: F.lineHeight(itemScale) + 8 * s };
      SATG.fx.drawPress(ctx, v, rect, s);
      const dy = SATG.fx.pressOffset(v, s);

      if (active && this._blink !== false) {
        F.draw(ctx, '>', cx - w / 2 - F.advanceFor(itemScale, 0) * 1.4, y + dy,
               { color: BONE, scale: itemScale });
      }
      // Centred items are knocked DOWN rather than sideways - a horizontal
      // nudge on centred text reads as the layout breaking, not as a press.
      F.draw(ctx, item.label, cx, y + dy,
             { color: SATG.fx.brighten(active ? BONE : BONE_DIM, v), scale: itemScale,
               tracking: 3 * s, align: 'center' });
      this.hits.push({ x: cx - this.W * 0.3, y: y - 6, w: this.W * 0.6, h: step, index: i });
      y += step;
    });
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

SATG.screens.ResultsScreen = ResultsScreen;
SATG.screens.formatClock = clock;
SATG.screens.shortDomain = shortDomain;

})(window);
