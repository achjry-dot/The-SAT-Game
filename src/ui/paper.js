/* =========================================================================
   ui/paper.js - the exam sheet.

   The paper is drawn to its own 2D canvas and uploaded as a texture. It
   exists in two places:

     on the table   a quad in the 3D scene, low-res and warped like everything
                    else, legible only as "a form with writing on it"
     in the hands   a screen-space overlay at native resolution, drawn into
                    the composite buffer so the text is actually readable

   That split is the honest answer to the tension between the 270p world and
   a question the player has to read under a timer. The sheet still passes
   through the final quantise and grain, so it belongs to the same image.

   Body text is sized ADAPTIVELY: the largest step that still fits the sheet
   is used, so short questions get big type and only a 150-word passage falls
   back to something smaller. Whatever is chosen, the player can scroll to
   zoom on top of it.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;
const F = SATG.font;
const { clamp } = SATG.util;

/* Sheet proportions, near enough to A4. */
const W = 800;
const H = 1120;

const MARGIN = 48;
const COL = W - MARGIN * 2;

/* Candidate body sizes, largest first. */
const SCALE_STEPS = [1.75, 1.6, 1.45, 1.3, 1.15, 1.0];

/* Ink colours. Nothing is pure black - this is a photocopy of a photocopy. */
const INK       = '#241f1a';
const INK_SOFT  = '#4a4038';
const INK_FAINT = '#6d6154';
const INK_RULE  = '#7d7264';
const SELECT_BG = '#3a3129';
const SELECT_FG = '#e2d9c7';
const ALERT     = '#7a2b22';

/* Height of one module segment in the strip across the top of a module test. */
const NAV_BAR_H = 30;

/* Review colours. Green would not belong on a photocopied form, so "right" is
   simply ink and "wrong" is the same red the invalid-entry flash already uses. */
const MARK_OK   = '#241f1a';
const MARK_BAD  = '#7a2b22';
const MARK_NONE = '#a2977f';

/* Rebuild a drawable question from a stored review item.

   The item holds the outcome; item.paper holds what was on the sheet. Neither
   alone is enough, which is why this takes both. */
function questionFromItem(it) {
  const p = it.paper;
  return {
    stem: p.stem,
    passage: p.passage,
    format: p.format,
    section: p.section || it.section,
    domain: p.domain || it.domain || '',
    graphic: p.graphic,
    choices: p.choices || [],
    answerIndex: p.answerIndex,
    answerText: it.correctText,
    index: it.n
  };
}

class Paper {
  constructor(gl) {
    this.gl = gl;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');

    // The blank stock underneath - fibre, foxing, handled edges.
    this.stock = SATG.textures.paperStock(W, H, 0x9E3A11);

    this.texture = new SATG.gl.Texture(gl, {
      source: this.canvas,
      filter: gl.LINEAR,           // held sheet: the one place smoothing helps
      wrap: gl.CLAMP_TO_EDGE
    });

    this.question = null;
    this.selected = -1;            // highlighted MC choice
    this.typed = '';               // grid-in entry
    this.inputFocused = false;
    this.caretOn = true;
    this.invalidFlash = 0;
    this.bodyScale = 1.45;

    this.hitChoices = [];          // {x,y,w,h,index} in canvas pixels
    this.hitInput = null;
    this.hitNav = [];              // module segments and the question arrows
    /* Null in Infinity mode, where there is exactly one question and nothing
       to navigate. Set by the game for a module test:
         { modules:[{number,section,done,current}], qIndex, qCount, answered:[] } */
    this.nav = null;
    /* Choice presses and the module arrows. The sheet is an 800x1120 texture,
       so this is the one place where an animation has a real cost - but the
       sheet is already redrawn on the caret blink while it is held, and a
       quarter-second of extra dirty frames on a click is a fair price for the
       answer visibly registering. It never animates while the sheet is lying
       on the table, because nothing calls update() there. */
    this.fx = new SATG.fx.PressFX();
    /* Review state. Null during a run, which is what every other method tests
       to decide whether the sheet is live or a record of something finished. */
    this.review = null;
    this.reviewItems = null;
    this.reviewIndex = 0;
    this.reviewBack = false;
    this.dirty = true;
  }

  /* --------------------------------------------------------- review mode

     The same sheet, afterwards. The question is put back exactly as it was
     asked, with the answer marked and the player's own answer marked next to
     it - and the working is on the BACK of the sheet, reached by the circled i,
     which is the one place a paper form would actually put it.

     Nothing here can be answered. A review that let you change an answer would
     be quietly rewriting the record you came to read. */
  setReview(item, index, items) {
    this.review = item || null;
    this.reviewIndex = index | 0;
    this.reviewItems = items || null;
    this.reviewBack = false;
    if (!item || !item.paper) { this.setQuestion(null); return; }
    this.setQuestion(questionFromItem(item));
    if (item.answered) this.restore(item.response);
    this.dirty = true;
  }

  clearReview() {
    this.review = null;
    this.reviewItems = null;
    this.reviewBack = false;
    this.setQuestion(null);
  }

  /* Turn the sheet over, and back. */
  flipReview() {
    if (!this.review) return false;
    this.reviewBack = !this.reviewBack;
    this.dirty = true;
    return true;
  }

  /* ------------------------------------------------------------- state */

  setQuestion(q) {
    this.question = q;
    this.selected = -1;
    this.typed = '';
    this.inputFocused = q && q.format === 'grid';
    this.invalidFlash = 0;
    /* A press still decaying belongs to the question that is leaving. The
       sheet is not animated while it lies on the table - nothing calls
       update() there - so a flash started by the answer that ended the last
       question would otherwise still be at full strength when the NEXT sheet
       is drawn, appearing on a choice the player never touched. */
    this.fx.clear();
    this.dirty = true;
  }

  /* Put back an answer the player already gave.

     On a module test they can page backwards, and a question they answered ten
     minutes ago has to come back with that answer still on it - otherwise
     going back to check your work silently erases it, which is the single most
     destructive thing a test interface can do. */
  restore(response) {
    if (!this.question) return;
    if (this.question.format === 'mc') {
      this.selected = (typeof response === 'number' && response >= 0 &&
                       response < this.question.choices.length) ? response : -1;
      this.typed = '';
    } else {
      this.typed = typeof response === 'string' ? response : '';
      this.selected = -1;
    }
    this.dirty = true;
  }

  setNav(nav) {
    this.nav = nav || null;
    this.dirty = true;
  }

  select(i) {
    // A review is a record. Nothing on it can be changed.
    if (this.review) return;
    if (!this.question || this.question.format !== 'mc') return;
    if (i < 0 || i >= this.question.choices.length) return;
    this.selected = i;
    this.fx.press(i);
    this.dirty = true;
  }

  /* Grid-in typing. The real answer box takes digits, a decimal point, a
     slash and a minus, and nothing else - so the paper refuses the rest
     rather than accepting characters that could never be graded. */
  typeChar(ch) {
    if (this.review) return false;
    if (!this.question || this.question.format !== 'grid') return false;
    if (!/^[0-9./-]$/.test(ch)) { this.flagInvalid(); return false; }

    const next = this.typed + ch;
    if (!SATG.satUtil.gridFits(next)) { this.flagInvalid(); return false; }
    // At most one decimal point and one slash, and a minus only in front.
    if (ch === '.' && this.typed.indexOf('.') !== -1) { this.flagInvalid(); return false; }
    if (ch === '/' && this.typed.indexOf('/') !== -1) { this.flagInvalid(); return false; }
    if (ch === '-' && this.typed.length > 0) { this.flagInvalid(); return false; }

    this.typed = next;
    this.dirty = true;
    return true;
  }

  backspace() {
    if (!this.typed.length) return false;
    this.typed = this.typed.slice(0, -1);
    this.dirty = true;
    return true;
  }

  flagInvalid() { this.invalidFlash = 0.5; this.dirty = true; }

  /* Whatever should be submitted right now. */
  currentResponse() {
    if (!this.question) return null;
    return this.question.format === 'mc' ? this.selected : this.typed;
  }

  hasResponse() {
    if (!this.question) return false;
    return this.question.format === 'mc' ? this.selected >= 0 : this.typed.length > 0;
  }

  update(dt) {
    if (this.fx.update(dt)) this.dirty = true;
    if (this.invalidFlash > 0) {
      this.invalidFlash = Math.max(0, this.invalidFlash - dt);
      this.dirty = true;
    }
    // Caret blink, only meaningful while a grid-in is open.
    if (this.question && this.question.format === 'grid') {
      const on = (Math.floor(performance.now() / 480) % 2) === 0;
      if (on !== this.caretOn) { this.caretOn = on; this.dirty = true; }
    }
  }

  /* ------------------------------------------------------------ layout
     Heights are measured before anything is drawn, so the body size can be
     chosen to fit rather than discovered to overflow. */

  get contentLimit() { return H - MARGIN - F.lineHeight(1) - 34; }

  headerHeight(s) { return F.lineHeight(s) * 2 + 22; }

  /* The module strip only exists on a module test, and its height has to go
     into measureHeight or the body type is chosen against a content area that
     is 76px taller than the one it actually gets - which is how a question
     ends up running off the bottom of the sheet. */
  navHeight(s) {
    // The review strip occupies the same band the module strip does.
    if (!this.nav && !this.review) return 0;
    const hs = Math.max(1, s * 0.8);
    return NAV_BAR_H + 8 + F.lineHeight(hs) + 14;
  }

  /* Width of the right-hand column that carries CORRECT / YOURS. Zero during a
     run, so the live sheet is laid out exactly as it always was - and folded
     into choicesHeight as well as drawChoices, or the type would be chosen
     against a column the text does not actually get. */
  reviewTagW(s) {
    if (!this.review) return 0;
    return F.measure('CORRECT', Math.max(1, s * 0.75), 1) + 16;
  }

  tableHeight(table, s) {
    return (F.lineHeight(s) + 10) * (table.rows.length + 1) + 12;
  }

  choicesHeight(q, s) {
    const box = Math.round(26 * s);
    const textW = COL - box - 14 - this.reviewTagW(s);
    let h = 0;
    for (const c of q.choices) {
      const lines = F.wrap(c.text, textW, s, 0).length;
      h += Math.max(box, lines * F.lineHeight(s, 3)) + 12;
    }
    return h + this.footHeight(s) + 12;
  }

  /* What sits under the answers. One hint line during a run; in review, the
     verdict sentence plus the circled i beneath it.

     Reserved generously - three lines rather than the two the verdict usually
     takes - because being an inch short here does not shrink the type, it runs
     the badge off the bottom of the sheet where it cannot be clicked. */
  footHeight(s) {
    if (!this.review) return F.lineHeight(s);
    return F.lineHeight(Math.max(1, s * 0.8)) * 3 + 8 + Math.round(30 * s);
  }

  gridHeight(s) {
    const extra = this.review ? this.footHeight(s) : 0;
    return F.lineHeight(s) + 10 + Math.round(54 * s) + 12 +
           F.lineHeight(s) * 2 + 12 + extra;
  }

  measureHeight(q, s) {
    let y = MARGIN + this.navHeight(s) + this.headerHeight(s) + 16;
    if (q.passage) y += F.measureWrapped(q.passage, COL, { scale: s, leading: 5 }) + 18;
    if (q.graphic && q.graphic.type === 'table') y += this.tableHeight(q.graphic, s) + 18;
    y += F.measureWrapped(q.stem, COL, { scale: s, leading: 5 }) + 22;
    y += q.format === 'mc' ? this.choicesHeight(q, s) : this.gridHeight(s);
    return y;
  }

  chooseScale(q) {
    for (const s of SCALE_STEPS) {
      if (this.measureHeight(q, s) <= this.contentLimit) return s;
    }
    return SCALE_STEPS[SCALE_STEPS.length - 1];
  }

  /* ------------------------------------------------------------ drawing */

  render() {
    if (!this.dirty) return;
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;

    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(this.stock, 0, 0);

    this.hitChoices.length = 0;
    this.hitInput = null;
    this.hitNav.length = 0;
    this.hitInfo = null;

    const q = this.question;
    if (!q) { this.upload(); return; }

    const s = this.chooseScale(q);
    this.bodyScale = s;

    /* The back of the sheet. Same stock, same strip along the top so you can
       keep moving through the paper without turning it over each time. */
    if (this.review && this.reviewBack) {
      let by = MARGIN;
      by = this.drawReviewNav(ctx, by, s);
      this.drawReviewBack(ctx, by, s);
      this.drawFooter(ctx);
      this.upload();
      return;
    }

    let y = MARGIN;
    if (this.review) y = this.drawReviewNav(ctx, y, s);
    else if (this.nav) y = this.drawNav(ctx, y, s);
    y = this.drawHeader(ctx, y, q, s);
    y += 16;

    if (q.passage) {
      y += F.drawWrapped(ctx, q.passage, MARGIN, y, COL, { color: INK, scale: s, leading: 5 });
      y += 18;
    }

    if (q.graphic && q.graphic.type === 'table') {
      y = this.drawTable(ctx, q.graphic, y, s);
      y += 18;
    }

    y += F.drawWrapped(ctx, q.stem, MARGIN, y, COL, { color: INK, scale: s, leading: 5 });
    y += 22;

    if (q.format === 'mc') this.drawChoices(ctx, y, q, s);
    else this.drawGridBox(ctx, y, q, s);

    this.drawFooter(ctx);
    this.upload();
  }

  /* The module strip: one segment per module in the form - two for a single
     section, four for a full SAT - plus the question counter and the arrows
     that move within the current module.

     Moving BETWEEN modules is deliberately not offered. The real test seals
     each module when its time runs out and never lets you back, and the whole
     point of the adaptive routing is that module 2 was chosen from how module
     1 went. The strip shows where you are in the form; the arrows move you
     inside the module you are actually sitting in. */
  drawNav(ctx, y, s) {
    const nav = this.nav;
    const hs = Math.max(1, s * 0.8);
    const mods = nav.modules || [];
    const gap = 6;
    const segW = mods.length ? Math.floor((COL - gap * (mods.length - 1)) / mods.length) : COL;

    mods.forEach((m, i) => {
      const x = MARGIN + i * (segW + gap);
      const current = !!m.current;

      ctx.fillStyle = current ? INK : (m.done ? INK_SOFT : '#b8ac97');
      ctx.fillRect(x, y, segW, NAV_BAR_H);
      if (!current && !m.done) {
        // Not yet reached: hollow, so the three states read at a glance.
        ctx.fillStyle = '#c9c0ad';
        ctx.fillRect(x + 2, y + 2, segW - 4, NAV_BAR_H - 4);
      }

      // Progress through the module currently being sat.
      if (current && nav.qCount) {
        const frac = clamp((nav.qIndex + 1) / nav.qCount, 0, 1);
        ctx.fillStyle = SELECT_FG;
        ctx.fillRect(x + 2, y + NAV_BAR_H - 6, Math.round((segW - 4) * frac), 4);
      }

      const label = 'M' + m.number;
      F.draw(ctx, label, x + segW / 2,
             y + Math.round((NAV_BAR_H - F.cellH * hs) / 2) - 2,
             { color: current || m.done ? SELECT_FG : INK_SOFT,
               scale: hs, align: 'center' });
      this.hitNav.push({ x, y, w: segW, h: NAV_BAR_H, type: 'module', index: i });
    });

    y += NAV_BAR_H + 8;

    // Question counter, with the arrows either side of it.
    const counter = 'QUESTION ' + (nav.qIndex + 1) + ' OF ' + nav.qCount;
    const answered = (nav.answered || 0) + ' ANSWERED';
    const arrowW = Math.round(30 * hs), arrowH = F.lineHeight(hs) + 8;

    const canPrev = nav.qIndex > 0;
    const canNext = nav.qIndex < nav.qCount - 1;

    const drawArrow = (glyph, x, enabled, type) => {
      const pv = this.fx.value(type);
      // Pressed arrows invert, which on a paper sheet reads as being pushed in.
      const pressedIn = pv > 0.05;
      ctx.fillStyle = enabled ? INK : '#b8ac97';
      ctx.fillRect(x, y - 4, arrowW, arrowH);
      ctx.fillStyle = pressedIn ? INK : '#c9c0ad';
      ctx.fillRect(x + 2, y - 2, arrowW - 4, arrowH - 4);
      F.draw(ctx, glyph, x + arrowW / 2, y + 1 + Math.round(pv * 2),
             { color: pressedIn ? '#c9c0ad' : (enabled ? INK : '#a2977f'),
               scale: hs, align: 'center' });
      if (enabled) this.hitNav.push({ x, y: y - 4, w: arrowW, h: arrowH, type });
    };

    drawArrow('<', MARGIN, canPrev, 'prev');
    drawArrow('>', MARGIN + arrowW + 6, canNext, 'next');

    F.draw(ctx, counter, MARGIN + arrowW * 2 + 20, y,
           { color: INK, scale: hs, tracking: 1 });
    F.draw(ctx, answered, W - MARGIN, y,
           { color: INK_FAINT, scale: hs, align: 'right', tracking: 1 });

    return y + F.lineHeight(hs) + 14;
  }

  /* The strip along the top of a review sheet: one cell per question, filled
     for right, hollow-red for wrong, blank for unanswered - so the shape of the
     whole run is visible from any single question, and any of them is one click
     away. */
  drawReviewNav(ctx, y, s) {
    const hs = Math.max(1, s * 0.8);
    const items = this.reviewItems || [];
    const n = Math.max(1, items.length);
    const cellW = COL / n;

    ctx.fillStyle = '#c9c0ad';
    ctx.fillRect(MARGIN, y, COL, NAV_BAR_H);

    items.forEach((it, i) => {
      const x = MARGIN + i * cellW;
      const w = Math.max(1, cellW - (cellW > 3 ? 1 : 0));
      if (!it.answered) {
        ctx.fillStyle = MARK_NONE;
        ctx.fillRect(x, y + NAV_BAR_H - 6, w, 4);
      } else if (it.right) {
        ctx.fillStyle = MARK_OK;
        ctx.fillRect(x, y + 4, w, NAV_BAR_H - 8);
      } else {
        ctx.fillStyle = MARK_BAD;
        ctx.fillRect(x, y + 4, w, NAV_BAR_H - 8);
        ctx.fillStyle = '#c9c0ad';
        if (w > 4) ctx.fillRect(x + 2, y + 6, w - 4, NAV_BAR_H - 12);
      }
      if (i === this.reviewIndex) {
        ctx.fillStyle = INK;
        ctx.fillRect(x, y - 3, Math.max(2, w), 3);
        ctx.fillRect(x, y + NAV_BAR_H, Math.max(2, w), 3);
      }
      this.hitNav.push({ x, y: y - 3, w: Math.max(3, cellW), h: NAV_BAR_H + 6,
                         type: 'reviewJump', index: i });
    });

    y += NAV_BAR_H + 8;

    const arrowW = Math.round(30 * hs), arrowH = F.lineHeight(hs) + 8;
    const canPrev = this.reviewIndex > 0;
    const canNext = this.reviewIndex < items.length - 1;

    const drawArrow = (glyph, x, enabled, type) => {
      const pv = this.fx.value(type);
      const pressedIn = pv > 0.05;
      ctx.fillStyle = enabled ? INK : '#b8ac97';
      ctx.fillRect(x, y - 4, arrowW, arrowH);
      ctx.fillStyle = pressedIn ? INK : '#c9c0ad';
      ctx.fillRect(x + 2, y - 2, arrowW - 4, arrowH - 4);
      F.draw(ctx, glyph, x + arrowW / 2, y + 1 + Math.round(pv * 2),
             { color: pressedIn ? '#c9c0ad' : (enabled ? INK : '#a2977f'),
               scale: hs, align: 'center' });
      if (enabled) this.hitNav.push({ x, y: y - 4, w: arrowW, h: arrowH, type });
    };
    drawArrow('<', MARGIN, canPrev, 'prev');
    drawArrow('>', MARGIN + arrowW + 6, canNext, 'next');

    const it = this.review;
    F.draw(ctx, 'REVIEW  ' + (this.reviewIndex + 1) + ' OF ' + items.length,
           MARGIN + arrowW * 2 + 20, y, { color: INK, scale: hs, tracking: 1 });
    const verdict = !it ? '' : (!it.answered ? 'BLANK' : it.right ? 'CORRECT' : 'WRONG');
    F.draw(ctx, verdict, W - MARGIN, y,
           { color: !it || !it.answered ? INK_FAINT : it.right ? INK : MARK_BAD,
             scale: hs, align: 'right', tracking: 1 });

    return y + F.lineHeight(hs) + 14;
  }

  /* The working, on the back of the sheet. Everything the review knows about
     this one question, in the order a student would ask it: what the answer
     was, what they put, why, and what the trap usually is. */
  drawReviewBack(ctx, y, s) {
    const it = this.review;
    const hs = Math.max(1, s * 0.8);
    const q = this.question;

    F.draw(ctx, 'QUESTION ' + (it.n || this.reviewIndex + 1) + ' - THE WORKING',
           MARGIN, y, { color: INK, scale: s, tracking: 1 });
    y += F.lineHeight(s) + 6;
    ctx.fillStyle = INK_RULE;
    ctx.fillRect(MARGIN, y, COL, 2);
    y += 12;

    const tx = SATG.taxonomy;
    const type = it.qtype ? tx.qtype(it.qtype) : null;

    const paras = [];
    if (type) paras.push({ h: 'THIS IS', t: type.label + '. ' + type.asks });
    if (type && type.cue) paras.push({ h: 'YOU CAN TELL BECAUSE', t: type.cue });
    paras.push({ h: 'THE ANSWER', t: it.correctText || (q && q.answerText) || '-' });
    paras.push({ h: 'YOU PUT',
                 t: it.answered ? (it.responseText || String(it.response))
                                : 'NOTHING - THIS ONE WAS LEFT BLANK.' });
    if (it.whyWrong) paras.push({ h: 'THAT IS WHAT YOU GET IF', t: it.whyWrong });
    if (it.explanation) paras.push({ h: 'WHY', t: it.explanation });
    if (type && type.trap) paras.push({ h: 'USUALLY MISSED BY', t: type.trap });

    const limit = this.contentLimit;
    for (const p of paras) {
      if (y > limit - F.lineHeight(hs) * 2) break;
      F.draw(ctx, p.h, MARGIN, y, { color: INK_FAINT, scale: hs, tracking: 1 });
      y += F.lineHeight(hs) + 2;
      y += F.drawWrapped(ctx, p.t, MARGIN + 10, y, COL - 10,
                         { color: INK, scale: hs, leading: 4 });
      y += 12;
    }

    /* Every other option's reason, where the generator has one. A player who
       got it right is usually here to ask why one of the others was not it. */
    const ch = (q && q.choices) || [];
    const others = ch.map((c, i) => ({ c, i }))
                     .filter((e) => e.c.why && e.i !== q.answerIndex);
    if (others.length && y < limit - F.lineHeight(hs) * 2) {
      F.draw(ctx, 'THE OTHERS', MARGIN, y, { color: INK_FAINT, scale: hs, tracking: 1 });
      y += F.lineHeight(hs) + 2;
      for (const e of others) {
        if (y > limit - F.lineHeight(hs)) break;
        y += F.drawWrapped(ctx, e.c.letter + '.  ' + e.c.why, MARGIN + 10, y, COL - 10,
                           { color: INK_SOFT, scale: hs, leading: 4 });
        y += 6;
      }
    }

    this.drawInfoBadge(ctx, MARGIN, H - MARGIN - F.lineHeight(1) - 46, s, true);
  }

  /* The circled i. In the same place on both faces of the sheet, because it is
     the control that turns it over. */
  drawInfoBadge(ctx, x, y, s, isBack) {
    const r = Math.round(12 * Math.max(1, s * 0.8));
    const cx = x + r, cy = y + r;
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(2, Math.round(s));
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    F.draw(ctx, isBack ? 'x' : 'i', cx, cy - Math.round(F.cellH * s * 0.5),
           { color: INK, scale: s, align: 'center' });
    const label = isBack ? 'BACK TO THE QUESTION' : 'SEE WHY';
    F.draw(ctx, label, cx + r + 8, cy - Math.round(F.cellH * Math.max(1, s * 0.7) * 0.5),
           { color: INK_FAINT, scale: Math.max(1, s * 0.7), tracking: 1 });
    this.hitInfo = { x: x - 4, y: y - 4, w: r * 2 + 16 +
                     F.measure(label, Math.max(1, s * 0.7), 1), h: r * 2 + 8 };
  }

  drawHeader(ctx, y, q, s) {
    const hs = Math.max(1, s * 0.8);
    const label = q.section === 'math' ? 'SECTION II - MATHEMATICS'
                                       : 'SECTION I - READING AND WRITING';
    F.draw(ctx, label, MARGIN, y, { color: INK_SOFT, scale: hs, tracking: 1 });
    F.draw(ctx, 'No. ' + String(q.index || 1).padStart(3, '0'),
           W - MARGIN, y, { color: INK_SOFT, scale: hs, align: 'right' });
    y += F.lineHeight(hs) + 6;

    ctx.fillStyle = INK_RULE;
    ctx.fillRect(MARGIN, y, COL, 2);
    y += 10;

    F.draw(ctx, q.domain.toUpperCase(), MARGIN, y, { color: INK_FAINT, scale: hs, tracking: 1 });
    F.draw(ctx, q.format === 'grid' ? 'WRITTEN RESPONSE' : 'SELECT ONE',
           W - MARGIN, y, { color: INK_FAINT, scale: hs, align: 'right', tracking: 1 });
    return y + F.lineHeight(hs) + 4;
  }

  drawTable(ctx, table, y, s) {
    const cols = table.columns.length;
    const cellW = Math.floor(COL / cols);
    const rowH = F.lineHeight(s) + 10;

    ctx.fillStyle = INK_RULE;
    ctx.fillRect(MARGIN, y, COL, 2);

    let ty = y + 6;
    table.columns.forEach((c, i) => {
      F.draw(ctx, String(c), MARGIN + i * cellW + 6, ty, { color: INK, scale: s });
    });
    ty += rowH - 6;
    ctx.fillStyle = INK_RULE;
    ctx.fillRect(MARGIN, ty, COL, 2);
    ty += 6;

    for (const row of table.rows) {
      row.forEach((cell, i) => {
        F.draw(ctx, String(cell), MARGIN + i * cellW + 6, ty, { color: INK_SOFT, scale: s });
      });
      ty += rowH - 4;
    }

    ctx.fillStyle = INK_RULE;
    ctx.fillRect(MARGIN, ty, COL, 2);
    return ty + 4;
  }

  drawChoices(ctx, y, q, s) {
    const boxSize = Math.round(26 * s);
    const gap = 12;
    const textX = MARGIN + boxSize + 14;
    const tagW = this.reviewTagW(s);
    const textW = COL - boxSize - 14 - tagW;
    const rv = this.review;
    const ts = Math.max(1, s * 0.75);

    q.choices.forEach((choice, i) => {
      const isSel = i === this.selected;
      const isKey = rv && i === q.answerIndex;
      const isMine = rv && i === this.selected;
      const lines = F.wrap(choice.text, textW, s, 0);
      const blockH = Math.max(boxSize, lines.length * F.lineHeight(s, 3));

      if (isSel) {
        ctx.fillStyle = SELECT_BG;
        ctx.fillRect(MARGIN - 8, y - 5, COL + 16, blockH + 10);
      }

      /* The press is drawn UNDER the letter box and the text, so the flash
         reads as the row lighting up rather than as something covering it.
         The sheet is ink on paper, so the flash is dark - a white one on a
         pale stock is invisible. */
      const pv = this.fx.value(i);
      if (pv > 0) {
        SATG.fx.drawPress(ctx, pv,
          { x: MARGIN - 8, y: y - 5, w: COL + 16, h: blockH + 10 },
          Math.max(1, s), INK);
      }

      /* In review the key gets the filled box whether or not it was chosen, so
         "what the answer was" reads before "what I put" - which is the order
         somebody re-reading a paper actually wants them in. */
      const boxFilled = rv ? isKey : isSel;
      ctx.fillStyle = boxFilled ? SELECT_FG : (isMine ? MARK_BAD : INK);
      ctx.fillRect(MARGIN, y, boxSize, boxSize);
      ctx.fillStyle = boxFilled ? SELECT_BG : '#c9c0ad';
      ctx.fillRect(MARGIN + 2, y + 2, boxSize - 4, boxSize - 4);
      F.draw(ctx, choice.letter, MARGIN + boxSize / 2,
             y + Math.round((boxSize - F.cellH * s) / 2),
             { color: boxFilled ? SELECT_FG : (isMine ? MARK_BAD : INK),
               scale: s, align: 'center' });

      const textColor = isSel ? SELECT_FG
                      : (rv && !isKey && !isMine ? INK_SOFT : INK);
      lines.forEach((ln, li) => {
        F.draw(ctx, ln, textX, y + li * F.lineHeight(s, 3) + Math.round(3 * s),
               { color: textColor, scale: s });
      });

      if (rv && (isKey || isMine)) {
        const tag = isKey ? 'CORRECT' : 'YOURS';
        F.draw(ctx, tag, W - MARGIN, y + Math.round(3 * s),
               { color: isKey ? INK : MARK_BAD, scale: ts,
                 align: 'right', tracking: 1 });
      }

      this.hitChoices.push({ x: MARGIN - 8, y: y - 5, w: COL + 16, h: blockH + 10, index: i });
      y += blockH + gap;
    });

    const hs = Math.max(1, s * 0.8);
    if (rv) {
      /* The verdict in a sentence, because the marks alone do not say what a
         blank was, and a blank is the one outcome with no row to point at. */
      const it = this.review;
      const line = !it.answered
        ? 'YOU LEFT THIS BLANK. THE ANSWER IS ' + (it.correctText || '-') + '.'
        : it.right
          ? 'YOU ANSWERED ' + (it.responseText || '') + '. CORRECT.'
          : 'YOU ANSWERED ' + (it.responseText || '') + '. THE ANSWER IS ' +
            (it.correctText || '-') + '.';
      const vh = F.drawWrapped(ctx, line, MARGIN, y + 6, COL,
                               { color: it.right ? INK : MARK_BAD,
                                 scale: hs, leading: 3 });
      this.drawInfoBadge(ctx, MARGIN, y + 6 + vh + 8, s, false);
      return;
    }

    /* On a module test nothing is graded until the clock stops, so ENTER
       moves on rather than committing - saying "SUBMIT" there would promise
       feedback the player is never going to get. */
    const hint = this.selected >= 0
      ? (this.nav ? 'PRESS ENTER FOR THE NEXT QUESTION' : 'PRESS ENTER TO SUBMIT')
      : 'SELECT AN ANSWER';
    F.draw(ctx, hint, MARGIN, y + 6, { color: INK_FAINT, scale: hs, tracking: 1 });
  }

  drawGridBox(ctx, y, q, s) {
    const ls = Math.max(1, s * 0.8);
    F.draw(ctx, 'ENTER YOUR ANSWER', MARGIN, y, { color: INK_SOFT, scale: ls, tracking: 1 });
    y += F.lineHeight(ls) + 10;

    const boxW = Math.round(300 * s), boxH = Math.round(54 * s);
    const bad = this.invalidFlash > 0;

    ctx.fillStyle = bad ? ALERT : INK;
    ctx.fillRect(MARGIN, y, boxW, boxH);
    ctx.fillStyle = '#0e0c0a';
    ctx.fillRect(MARGIN + 3, y + 3, boxW - 6, boxH - 6);

    const shown = this.typed || '';
    const ts = s * 1.4;
    const tx = MARGIN + 14;
    const ty = y + Math.round((boxH - F.cellH * ts) / 2);
    F.draw(ctx, shown, tx, ty, { color: '#9fd8a4', scale: ts });

    if (this.caretOn) {
      const caretX = tx + F.measure(shown, ts, 0) + (shown.length ? 3 : 0);
      ctx.fillStyle = '#9fd8a4';
      ctx.fillRect(caretX, ty + 2, 3, F.cellH * ts - 4);
    }

    this.hitInput = { x: MARGIN, y, w: boxW, h: boxH };
    y += boxH + 12;

    if (this.review) {
      const it = this.review;
      const line = !it.answered
        ? 'YOU LEFT THIS BLANK. THE ANSWER IS ' + (it.correctText || '-') + '.'
        : it.right
          ? 'YOU WROTE ' + (it.responseText || this.typed) + '. CORRECT.'
          : 'YOU WROTE ' + (it.responseText || this.typed) + '. THE ANSWER IS ' +
            (it.correctText || '-') + '.';
      const vh = F.drawWrapped(ctx, line, MARGIN, y, COL,
                               { color: it.right ? INK : MARK_BAD,
                                 scale: ls, leading: 3 });
      this.drawInfoBadge(ctx, MARGIN, y + vh + 8, s, false);
      return;
    }

    F.draw(ctx, 'DIGITS, - . / ONLY. MAX 5 CHARACTERS (6 IF NEGATIVE).',
           MARGIN, y, { color: INK_FAINT, scale: ls });
    y += F.lineHeight(ls) + 4;
    F.draw(ctx, this.typed.length
             ? (this.nav ? 'PRESS ENTER FOR THE NEXT QUESTION' : 'PRESS ENTER TO SUBMIT')
             : 'TYPE YOUR ANSWER',
           MARGIN, y, { color: bad ? ALERT : INK_FAINT, scale: ls, tracking: 1 });
  }

  drawFooter(ctx) {
    const y = H - MARGIN - F.lineHeight(1);
    ctx.fillStyle = INK_RULE;
    ctx.fillRect(MARGIN, y - 12, COL, 2);
    F.draw(ctx, this.review ? 'FORM 4-B  /  MARKED COPY' : 'FORM 4-B  /  DO NOT DETACH',
           MARGIN, y, { color: INK_FAINT, scale: 1, tracking: 1 });
    F.draw(ctx, this.review ? 'LEFT / RIGHT - QUESTION    I - WHY    ESC - BACK'
                            : 'ESC - SET DOWN',
           W - MARGIN, y, { color: INK_FAINT, scale: 1, align: 'right', tracking: 1 });
  }

  upload() {
    // update(), not setSource(): see gl.Texture.update - reallocating this
    // sheet every frame is what produced the blocks of garbage across it.
    this.texture.update(this.canvas);
    this.dirty = false;
  }

  /* ---------------------------------------------------------- hit test
     (u, v) are normalised coordinates within the displayed sheet, origin
     top-left. Returns a descriptor or null. */
  hitTest(u, v) {
    const x = u * W, y = v * H;
    /* The circled i first. It is the only control on the back of the sheet, and
       on the front it sits below the answers where nothing else is - but
       ordering it first means it stays reachable if the layout ever moves. */
    const inf = this.hitInfo;
    if (inf && x >= inf.x && x <= inf.x + inf.w && y >= inf.y && y <= inf.y + inf.h) {
      return { type: 'info' };
    }
    // Navigation next: its arrows sit above the question, so nothing else
    // can be under them, but ordering it early keeps that true if the layout
    // ever moves.
    for (const n of this.hitNav) {
      if (x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h) {
        return { type: n.type, index: n.index };
      }
    }
    for (const c of this.hitChoices) {
      if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) {
        return { type: 'choice', index: c.index };
      }
    }
    const i = this.hitInput;
    if (i && x >= i.x && x <= i.x + i.w && y >= i.y && y <= i.y + i.h) {
      return { type: 'input' };
    }
    return null;
  }

  get aspect() { return W / H; }
}

SATG.Paper = Paper;
SATG.PAPER_SIZE = { W, H };

})(window);
