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
    this.dirty = true;
  }

  /* ------------------------------------------------------------- state */

  setQuestion(q) {
    this.question = q;
    this.selected = -1;
    this.typed = '';
    this.inputFocused = q && q.format === 'grid';
    this.invalidFlash = 0;
    this.dirty = true;
  }

  select(i) {
    if (!this.question || this.question.format !== 'mc') return;
    if (i < 0 || i >= this.question.choices.length) return;
    this.selected = i;
    this.dirty = true;
  }

  /* Grid-in typing. The real answer box takes digits, a decimal point, a
     slash and a minus, and nothing else - so the paper refuses the rest
     rather than accepting characters that could never be graded. */
  typeChar(ch) {
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

  tableHeight(table, s) {
    return (F.lineHeight(s) + 10) * (table.rows.length + 1) + 12;
  }

  choicesHeight(q, s) {
    const box = Math.round(26 * s);
    const textW = COL - box - 14;
    let h = 0;
    for (const c of q.choices) {
      const lines = F.wrap(c.text, textW, s, 0).length;
      h += Math.max(box, lines * F.lineHeight(s, 3)) + 12;
    }
    return h + F.lineHeight(s) + 12;
  }

  gridHeight(s) {
    return F.lineHeight(s) + 10 + Math.round(54 * s) + 12 + F.lineHeight(s) * 2 + 12;
  }

  measureHeight(q, s) {
    let y = MARGIN + this.headerHeight(s) + 16;
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

    const q = this.question;
    if (!q) { this.upload(); return; }

    const s = this.chooseScale(q);
    this.bodyScale = s;

    let y = MARGIN;
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
    const textW = COL - boxSize - 14;

    q.choices.forEach((choice, i) => {
      const isSel = i === this.selected;
      const lines = F.wrap(choice.text, textW, s, 0);
      const blockH = Math.max(boxSize, lines.length * F.lineHeight(s, 3));

      if (isSel) {
        ctx.fillStyle = SELECT_BG;
        ctx.fillRect(MARGIN - 8, y - 5, COL + 16, blockH + 10);
      }

      ctx.fillStyle = isSel ? SELECT_FG : INK;
      ctx.fillRect(MARGIN, y, boxSize, boxSize);
      ctx.fillStyle = isSel ? SELECT_BG : '#c9c0ad';
      ctx.fillRect(MARGIN + 2, y + 2, boxSize - 4, boxSize - 4);
      F.draw(ctx, choice.letter, MARGIN + boxSize / 2,
             y + Math.round((boxSize - F.cellH * s) / 2),
             { color: isSel ? SELECT_FG : INK, scale: s, align: 'center' });

      lines.forEach((ln, li) => {
        F.draw(ctx, ln, textX, y + li * F.lineHeight(s, 3) + Math.round(3 * s),
               { color: isSel ? SELECT_FG : INK, scale: s });
      });

      this.hitChoices.push({ x: MARGIN - 8, y: y - 5, w: COL + 16, h: blockH + 10, index: i });
      y += blockH + gap;
    });

    F.draw(ctx, this.selected >= 0 ? 'PRESS ENTER TO SUBMIT' : 'SELECT AN ANSWER',
           MARGIN, y + 6, { color: INK_FAINT, scale: Math.max(1, s * 0.8), tracking: 1 });
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

    F.draw(ctx, 'DIGITS, - . / ONLY. MAX 5 CHARACTERS (6 IF NEGATIVE).',
           MARGIN, y, { color: INK_FAINT, scale: ls });
    y += F.lineHeight(ls) + 4;
    F.draw(ctx, this.typed.length ? 'PRESS ENTER TO SUBMIT' : 'TYPE YOUR ANSWER',
           MARGIN, y, { color: bad ? ALERT : INK_FAINT, scale: ls, tracking: 1 });
  }

  drawFooter(ctx) {
    const y = H - MARGIN - F.lineHeight(1);
    ctx.fillStyle = INK_RULE;
    ctx.fillRect(MARGIN, y - 12, COL, 2);
    F.draw(ctx, 'FORM 4-B  /  DO NOT DETACH', MARGIN, y,
           { color: INK_FAINT, scale: 1, tracking: 1 });
    F.draw(ctx, 'ESC - SET DOWN', W - MARGIN, y,
           { color: INK_FAINT, scale: 1, align: 'right', tracking: 1 });
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
