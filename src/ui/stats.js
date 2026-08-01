/* =========================================================================
   ui/stats.js - the record: what you have done, and what to work on.

   There is far more here than fits on a screen, so the page is built as a list
   of blocks - each one a height and a draw function - and only the blocks
   inside the scroll window are drawn. That is the same answer the settings
   list needed, for the same reason: shrinking type has a floor, and past it
   the only honest options are to scroll or to lie about what is there.

   Three tabs: ENGLISH, MATH, OVERALL. Not Science - the digital SAT has no
   science section, and College Board dropped the old cross-test science score
   when the test went digital, so a tab for it would be inventing a measure the
   exam does not report.
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
const ENGLISH_C  = '#6fa8dc';
const MATH_C     = '#e0915a';
const PANEL      = '#141210';

const TABS = [
  { key: 'rw',      label: 'ENGLISH' },
  { key: 'math',    label: 'MATH' },
  { key: 'overall', label: 'OVERALL' }
];

const clock = SATG.screens.formatClock;
const shortDomain = SATG.screens.shortDomain;

function pctColor(p) { return p >= 0.7 ? GOOD : p >= 0.45 ? WARN : BLOOD; }

/* 'words-in-context' -> 'WORDS IN CONTEXT' */
function skillLabel(k) {
  return String(k).replace(/-/g, ' ').toUpperCase();
}

class StatsScreen extends SATG.screens.ScreenCanvas {
  constructor(gl) {
    super(gl, 1280, 720);
    this.tab = 2;                 // OVERALL first: it is the headline number
    this.scroll = 0;
    this.time = 0;
    this.data = null;
    this.hits = [];
    this.contentH = 0;
    this.viewH = 1;
    this.fx = new SATG.fx.PressFX();
  }

  reset() {
    this.scroll = 0;
    this.time = 0;
    this.refresh();
    this.dirty = true;
  }

  refresh() {
    this.data = SATG.profile.summary(TABS[this.tab].key);
    this.dirty = true;
  }

  setTab(i) {
    if (i < 0 || i >= TABS.length) return false;
    // The flash fires even when the tab did not change, so a click on the tab
    // you are already on still acknowledges itself.
    this.fx.press('tab' + i);
    this.dirty = true;
    if (i === this.tab) return false;
    this.tab = i;
    this.scroll = 0;
    this.refresh();
    return true;
  }

  pressBack() { this.fx.press('back'); this.dirty = true; }

  moveTab(d) { return this.setTab((this.tab + d + TABS.length) % TABS.length); }

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

  /* ------------------------------------------------------------- render */

  render() {
    if (!this.dirty) return;
    const ctx = this.ctx;
    this.clear();
    const W = this.W, H = this.H, s = this.uiScale || 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    if (!this.data) this.refresh();
    const d = this.data;

    const left = Math.round(W * 0.07);
    const avail = Math.round(W * 0.86);

    const title = F.fitScale('STATS', avail, 4 * s, 3 * s, s);
    const tabS  = Math.max(s, Math.round(title * 0.45));
    const row   = Math.max(s, Math.round(title * 0.32));
    const small = Math.max(s, Math.round(row * 0.8));

    this.hits = [];

    let y = Math.max(10 * s, Math.round(H * 0.05));
    F.draw(ctx, 'STATS', left, y, { color: BONE, scale: title, tracking: 4 * s });

    /* The account line sits opposite the title. It always says something -
       signed in, or exactly why not and what to do about it. */
    const acct = SATG.account.statusText();
    const af = F.fitScale(acct, Math.round(avail * 0.62), small, s, s);
    F.draw(ctx, acct, left + avail, y + Math.round(F.cellH * (title - af) / 2),
           { color: SATG.account.user ? GOOD : BONE_FAINT, scale: af,
             align: 'right', tracking: s });
    y += F.lineHeight(title) + 10 * s;

    // Tabs.
    let tx = left;
    TABS.forEach((t, i) => {
      const active = i === this.tab;
      const w = F.measure(t.label, tabS, 2 * s) + 20 * s;
      if (active) {
        ctx.fillStyle = PANEL;
        ctx.fillRect(tx, y - 5 * s, w, F.lineHeight(tabS) + 8 * s);
        ctx.fillStyle = BONE;
        ctx.fillRect(tx, y + F.lineHeight(tabS) + 1 * s, w, 2 * s);
      }
      const v = this.fx.value('tab' + i);
      SATG.fx.drawPress(ctx, v, { x: tx, y: y - 5 * s, w: w,
                                  h: F.lineHeight(tabS) + 8 * s }, s);
      F.draw(ctx, t.label, tx + 10 * s, y + SATG.fx.pressOffset(v, s),
             { color: SATG.fx.brighten(active ? BONE : BONE_DIM, v),
               scale: tabS, tracking: 2 * s });
      this.hits.push({ x: tx, y: y - 5 * s, w, h: F.lineHeight(tabS) + 10 * s,
                       kind: 'tab', index: i });
      tx += w + 8 * s;
    });
    y += F.lineHeight(tabS) + 16 * s;

    // BACK is pinned to the bottom and is never scrolled away.
    const backH = F.lineHeight(row) + 12 * s;
    const backY = H - 8 * s - backH;
    const bodyTop = y;
    const bodyBottom = backY - 8 * s;
    this.viewH = Math.max(1, bodyBottom - bodyTop);

    const blocks = this.buildBlocks(d, { left, avail, row, small, s, W });
    this.contentH = blocks.reduce((n, b) => n + b.h, 0);
    this.scroll = clamp(this.scroll, 0, Math.max(0, this.contentH - this.viewH));

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, bodyTop, W, this.viewH);
    ctx.clip();
    let by = bodyTop - this.scroll;
    for (const b of blocks) {
      // Only pay for what is on screen.
      if (by + b.h >= bodyTop && by <= bodyBottom) b.draw(ctx, by);
      by += b.h;
    }
    ctx.restore();

    // Scroll position, when there is more than one screen of it.
    if (this.contentH > this.viewH) {
      const trackH = this.viewH;
      const thumb = Math.max(12 * s, trackH * (this.viewH / this.contentH));
      const t = this.scroll / Math.max(1, this.contentH - this.viewH);
      ctx.fillStyle = '#1c1a17';
      ctx.fillRect(W - 6 * s, bodyTop, 3 * s, trackH);
      ctx.fillStyle = BONE_FAINT;
      ctx.fillRect(W - 6 * s, bodyTop + (trackH - thumb) * t, 3 * s, thumb);
    }

    // Footer.
    const bv = this.fx.value('back');
    const bdx = SATG.fx.pressOffset(bv, s);
    SATG.fx.drawPress(ctx, bv, { x: left - 10 * s, y: backY - 6 * s,
                                 w: F.measure('BACK', row, 2 * s) + 40 * s,
                                 h: F.lineHeight(row) + 8 * s }, s);
    if (this._blink !== false) {
      F.draw(ctx, '<', left + bdx, backY, { color: BONE, scale: row });
    }
    F.draw(ctx, 'BACK', left + F.advanceFor(row, 0) * 1.8 + bdx, backY,
           { color: SATG.fx.brighten(BONE, bv), scale: row, tracking: 2 * s });
    this.hits.push({ x: left - 10 * s, y: backY - 6 * s, w: avail, h: backH,
                     kind: 'back' });
    F.draw(ctx, 'LEFT / RIGHT - SECTION    UP / DOWN - SCROLL    ESC - BACK',
           left + avail, backY, { color: BONE_FAINT, scale: s,
                                  align: 'right', tracking: s });

    this.upload();
  }

  /* Each block knows its own height, so the scroll window can be computed
     without drawing anything. */
  buildBlocks(d, L) {
    const { left, avail, row, small, s } = L;
    const blocks = [];
    const lh = F.lineHeight(row);
    const slh = F.lineHeight(small);

    const heading = (text) => blocks.push({ h: lh + 12 * s, draw: (ctx, y) => {
      F.draw(ctx, text, left, y + 6 * s, { color: BONE, scale: row, tracking: 2 * s });
      ctx.fillStyle = '#241f1a';
      ctx.fillRect(left, y + 6 * s + lh + 2 * s, avail, 1 * s);
    }});

    const line = (text, color, scale) => {
      const sc = scale || small;
      blocks.push({ h: F.lineHeight(sc) + 4 * s, draw: (ctx, y) => {
        F.draw(ctx, text, left, y, { color: color || BONE_DIM, scale: sc, tracking: s });
      }});
    };

    const gap = (n) => blocks.push({ h: n, draw: () => {} });

    /* ---- not signed in: say what that means, above everything else. */
    if (!SATG.account.user) {
      blocks.push({ h: slh * 2 + 20 * s, draw: (ctx, y) => {
        ctx.fillStyle = PANEL;
        ctx.fillRect(left, y, avail, slh * 2 + 14 * s);
        F.draw(ctx, SATG.account.statusText(), left + 10 * s, y + 6 * s,
               { color: BONE, scale: small, tracking: s });
        F.draw(ctx, 'RESULTS BELOW ARE THIS BROWSER\'S RECORD AND ARE KEPT EITHER WAY.',
               left + 10 * s, y + 6 * s + slh, { color: BONE_FAINT, scale: small, tracking: s });
      }});
      gap(10 * s);
    }

    /* ---- nothing on this tab yet. Two different sentences: an empty profile
       and an empty tab are not the same problem, and telling someone who has
       played six Math runs that they have "no results" is simply wrong. */
    if (!d.runCount) {
      const tabName = TABS[this.tab].label;
      if (d.totalRunCount) {
        heading('NO ' + tabName + ' RESULTS YET');
        line('YOU HAVE FINISHED ' + d.totalRunCount + ' RUN' +
             (d.totalRunCount === 1 ? '' : 'S') + ', BUT NONE OF THEM INCLUDED ' +
             tabName + ' QUESTIONS.', BONE_DIM);
        line('PLAY A ' + tabName + ' MODE, OR CHECK THE OTHER TABS.', BONE_FAINT);
      } else {
        heading('NO RESULTS YET');
        line('FINISH A RUN AND IT WILL APPEAR HERE.', BONE_DIM);
        line('MODULE AND FULL SAT RUNS ARE SCORED; INFINITY RUNS RECORD HOW FAR YOU GOT.',
             BONE_FAINT);
      }
      return blocks;
    }

    /* ---- headline numbers. */
    heading('SUMMARY');
    const acc = Math.round(d.accuracy * 100);
    line('ACCURACY   ' + acc + '%   (' + d.correct + ' OF ' + d.answered + ' CORRECT)',
         pctColor(d.accuracy), row);
    line('RUNS FINISHED   ' + d.runCount + '    SCORED TESTS   ' + d.testCount);
    if (d.bestStreak) {
      line('LONGEST INFINITY RUN   ' + d.bestStreak + ' CLEARED   ' +
           clock(d.longestTime) + ' SURVIVED', BONE_DIM);
    }
    if (d.scope === 'overall' && d.bestTotal) {
      line('BEST FULL SAT   ' + d.bestTotal + ' / 1600', GOOD, row);
    }
    if (d.scope !== 'overall' && d.sectionBest[d.scope]) {
      line('BEST SECTION SCORE   ' + d.sectionBest[d.scope] + ' / 800', GOOD, row);
    }
    gap(14 * s);

    /* ---- the trend chart. */
    const tr = d.trend || { rw: [], math: [], overall: [] };
    const anySeries = tr.rw.length + tr.math.length + tr.overall.length;
    if (anySeries) {
      heading('PROGRESS');
      const chartH = Math.max(80 * s, Math.round(this.H * 0.26));
      blocks.push({ h: chartH + 10 * s,
                    draw: (ctx, y) => this.drawChart(ctx, y, left, avail, chartH, tr, L) });
      const legend = d.scope === 'overall'
        ? 'ENGLISH   MATH   COMPOSITE (THICK)'
        : (d.scope === 'rw' ? 'ENGLISH SECTION SCORES' : 'MATH SECTION SCORES');
      line(legend, BONE_FAINT);
      if (d.scope === 'overall') {
        line('A HOLLOW POINT ON THE COMPOSITE IS AN ESTIMATE - YOUR LATEST SCORE IN ' +
             'EACH SECTION, NOT ONE SITTING.', BONE_FAINT);
      }
      gap(14 * s);
    }

    /* ---- domains: the big picture of strength and weakness. */
    if (d.domains.length) {
      heading('BY CONTENT DOMAIN');
      for (const dm of d.domains) {
        blocks.push({ h: F.lineHeight(row) + 8 * s, draw: (ctx, y) => {
          this.drawBar(ctx, y, left, avail, row, shortDomain(dm.domain),
                       dm.pct, dm.right + '/' + dm.total);
        }});
      }
      gap(14 * s);
    }

    /* ---- skills: what to actually go and practise. */
    const skills = d.skills.filter((k) => k.total >= 3);
    if (skills.length) {
      heading('BY SKILL');
      const worst = skills.slice().reverse().slice(0, 12).reverse();
      for (const sk of worst) {
        blocks.push({ h: F.lineHeight(small) + 6 * s, draw: (ctx, y) => {
          this.drawBar(ctx, y, left, avail, small, skillLabel(sk.skill),
                       sk.pct, sk.right + '/' + sk.total);
        }});
      }
      line('SKILLS WITH FEWER THAN THREE ATTEMPTS ARE LEFT OUT - THERE IS NOTHING ' +
           'TO READ INTO ONE QUESTION.', BONE_FAINT);
      gap(14 * s);
    }

    /* ---- and the same thing in words. */
    heading('IN SHORT');
    if (d.strengths.length) {
      for (const st of d.strengths) {
        line('STRONG   ' + shortDomain(st.domain) + '   ' +
             Math.round(st.pct * 100) + '%', GOOD);
      }
    } else {
      line('NO CLEAR STRENGTH YET - KEEP PLAYING AND ONE WILL SHOW.', BONE_DIM);
    }
    if (d.weaknesses.length) {
      for (const wk of d.weaknesses) {
        line('WORK ON  ' + shortDomain(wk.domain) + '   ' +
             Math.round(wk.pct * 100) + '%', BLOOD);
      }
    } else if (d.domains.length) {
      line('NOTHING IS DRAGGING YOU DOWN AT THE MOMENT.', GOOD);
    }
    gap(14 * s);

    /* ---- every test taken. */
    if (d.tests.length) {
      heading('TESTS TAKEN');
      const list = d.tests.slice().reverse().slice(0, 20);
      for (const t of list) {
        blocks.push({ h: F.lineHeight(small) + 6 * s, draw: (ctx, y) => {
          const when = new Date(t.at);
          const stamp = when.getFullYear() + '-' +
                        String(when.getMonth() + 1).padStart(2, '0') + '-' +
                        String(when.getDate()).padStart(2, '0');
          F.draw(ctx, stamp + '   ' + (t.label || ''), left, y,
                 { color: BONE_DIM, scale: small, tracking: s });
          F.draw(ctx, String(t.scaled) + (t.kind === 'full' ? ' / 1600' : ' / 800'),
                 left + avail, y,
                 { color: BONE, scale: small, align: 'right', tracking: s });
        }});
      }
      if (d.tests.length > 20) {
        line('SHOWING THE LAST 20 OF ' + d.tests.length + '.', BONE_FAINT);
      }
    }

    gap(16 * s);
    return blocks;
  }

  drawBar(ctx, y, left, avail, scale, label, pct, tail) {
    const s = this.uiScale || 1;
    const labelW = Math.round(avail * 0.40);
    const barX = left + labelW + 8 * s;
    const barW = Math.round(avail * 0.36);
    const barH = Math.max(3 * s, Math.round(F.cellH * scale * 0.65));

    const ls = F.fitScale(label, labelW, scale, s, s);
    F.draw(ctx, label, left, y, { color: BONE_DIM, scale: ls, tracking: s });

    const by = y + Math.round((F.cellH * scale - barH) / 2);
    ctx.fillStyle = '#241f1a';
    ctx.fillRect(barX, by, barW, barH);
    ctx.fillStyle = pctColor(pct);
    ctx.fillRect(barX, by, Math.round(barW * clamp(pct, 0, 1)), barH);

    F.draw(ctx, tail, left + avail, y,
           { color: BONE_DIM, scale: scale, align: 'right', tracking: s });
  }

  /* The three series share one plot area. English and Math are section scores
     on 200-800; the composite is on 400-1600. Both are normalised to the same
     0..1 height so they can be read against each other, and the axis is
     labelled with both scales so neither is mistaken for the other. */
  drawChart(ctx, y, left, avail, h, tr, L) {
    const s = this.uiScale || 1;
    const padL = Math.round(46 * s);
    const x0 = left + padL, x1 = left + avail - 4 * s;
    const y0 = y + 4 * s, y1 = y + h - F.lineHeight(s) - 6 * s;
    const w = Math.max(1, x1 - x0), ph = Math.max(1, y1 - y0);

    ctx.fillStyle = PANEL;
    ctx.fillRect(x0, y0, w, ph);

    // Gridlines at the quarters, labelled on both scales.
    ctx.fillStyle = '#241f1a';
    for (let i = 0; i <= 4; i++) {
      const gy = Math.round(y0 + ph * (i / 4));
      ctx.fillRect(x0, gy, w, 1);
      const sec = Math.round(800 - (800 - 200) * (i / 4));
      F.draw(ctx, String(sec), x0 - 6 * s, gy - Math.round(F.cellH * s / 2),
             { color: BONE_FAINT, scale: s, align: 'right', tracking: 0 });
    }

    const norm = (v, lo, hi) => clamp((v - lo) / (hi - lo), 0, 1);
    const plot = (pts, lo, hi, color, thick, hollowWhenEstimated) => {
      if (!pts.length) return;
      const n = pts.length;
      const px = (i) => n === 1 ? x0 + w / 2 : x0 + w * (i / (n - 1));
      const py = (v) => y1 - ph * norm(v, lo, hi);

      ctx.strokeStyle = color;
      ctx.lineWidth = thick;
      ctx.beginPath();
      pts.forEach((p, i) => {
        const X = px(i), Y = py(p.v);
        if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      });
      ctx.stroke();

      const r = thick + 1;
      pts.forEach((p, i) => {
        const X = px(i), Y = py(p.v);
        const estimated = hollowWhenEstimated && p.exact === false;
        ctx.fillStyle = estimated ? PANEL : color;
        ctx.beginPath(); ctx.arc(X, Y, r, 0, Math.PI * 2); ctx.fill();
        if (estimated) {
          ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, thick - 1);
          ctx.beginPath(); ctx.arc(X, Y, r, 0, Math.PI * 2); ctx.stroke();
        }
      });
    };

    const scope = this.data.scope;
    if (scope === 'rw' || scope === 'overall') {
      plot(tr.rw, 200, 800, ENGLISH_C, Math.max(1, s), false);
    }
    if (scope === 'math' || scope === 'overall') {
      plot(tr.math, 200, 800, MATH_C, Math.max(1, s), false);
    }
    if (scope === 'overall') {
      // Thicker and brighter: this is the number that matters.
      plot(tr.overall, 400, 1600, BONE, Math.max(2, 2 * s), true);
      F.draw(ctx, '400-1600 COMPOSITE   200-800 SECTIONS', x1, y1 + 4 * s,
             { color: BONE_FAINT, scale: s, align: 'right', tracking: 0 });
    }

    const count = (scope === 'overall' ? tr.overall.length
                 : scope === 'rw' ? tr.rw.length : tr.math.length);
    if (count < 2) {
      F.draw(ctx, 'ONE POINT SO FAR - FINISH ANOTHER TEST TO SEE A TREND',
             x0 + w / 2, y0 + ph / 2 - Math.round(F.cellH * s / 2),
             { color: BONE_FAINT, scale: s, align: 'center', tracking: s });
    }
  }

  hitTest(u, v) {
    if (!this.hits) return null;
    const x = u * this.W, y = v * this.H;
    for (const h of this.hits) {
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
    }
    return null;
  }

  /* Where the Google button should sit: under the account line, top right. */
  buttonSpot() { return { u: 0.78, v: 0.13 }; }
}

SATG.screens.StatsScreen = StatsScreen;
SATG.screens.STATS_TABS = TABS;

})(window);
