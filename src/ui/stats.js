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

/* LOGBOOK is not a fourth score view - it is the catalogue.

   The three score tabs answer "how am I doing". The logbook answers "what is
   actually on this test", which is a different question and needs a different
   shape: every question type the SAT can ask, arranged in chapters, whether or
   not the player has ever seen one. A type they have never met still has an
   entry, because not having met it is itself worth knowing.

   Its `scope` is 'overall' because a catalogue spans both sections; the tab is
   distinguished by `logbook: true` rather than by its scope, so nothing
   downstream has to special-case an invented scope name. */
const TABS = [
  { key: 'rw',      label: 'ENGLISH' },
  { key: 'math',    label: 'MATH' },
  { key: 'overall', label: 'OVERALL' },
  { key: 'overall', label: 'LOGBOOK', logbook: true },
  /* HISTORY is the other half of the SAVE TO STATS button. Without it that
     button wrote something the player could never read back, which is a worse
     state than not having offered to save at all. */
  { key: 'overall', label: 'HISTORY', history: true }
];

const TX = SATG.taxonomy;
const LINK = '#6fb7d8';

const clock = SATG.screens.formatClock;
const shortDomain = SATG.screens.shortDomain;
/* Defined in analysis.js, which loads first. Shrink-then-truncate, so a long
   run label cannot run under the score sitting at the other end of the row. */
const fitOrClip = SATG.screens.fitOrClip;

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
    /* Logbook state. Chapters collapse so the catalogue is navigable - 65
       question types laid out flat is a wall of text nobody reads. One chapter
       and one type are open at a time, which keeps the page short enough that
       the thing you just clicked is still on screen. */
    this.openChapter = null;
    this.openType = null;
    /* A review is the only thing on this page that can be destroyed, so
       deleting one takes two clicks: the first arms this, the second acts.
       Nothing else here is irreversible, and a saved report lost to a stray
       click is not recoverable from anywhere. */
    this.armedDelete = null;
  }

  get isLogbook() { return !!TABS[this.tab].logbook; }
  get isHistory() { return !!TABS[this.tab].history; }

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
    this.armedDelete = null;
    if (i === this.tab) return false;
    this.tab = i;
    this.scroll = 0;
    this.refresh();
    return true;
  }

  /* Two-step delete: the first click arms, the second acts, and a click on
     anything else cancels. Returns what it did, because the caller decides
     which sound to play and only one of these outcomes destroys anything. */
  armDelete(at) {
    this.fx.press('rd' + at);
    if (this.armedDelete !== at) {
      this.armedDelete = at;
      this.dirty = true;
      return 'armed';
    }
    this.armedDelete = null;
    const ok = SATG.profile.deleteReview(at);
    this.refresh();
    return ok ? 'deleted' : 'missing';
  }

  disarmDelete() {
    if (this.armedDelete === null) return false;
    this.armedDelete = null;
    this.dirty = true;
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

    /* Reserve the body's share of the height before the header takes any.

       With three tabs the strip always fitted one row and the header was
       comfortably short. A fourth tab wraps on a narrow window, and the extra
       row was enough to leave the body one pixel tall - the same failure the
       analysis screen had, from the same cause: sizing the header first and
       giving the body the remainder. So the header scales are chosen to leave
       the minimum, rather than discovering afterwards that nothing fits. */
    const MIN_BODY = Math.max(30 * s, Math.round(H * 0.24));
    const topY = Math.max(10 * s, Math.round(H * 0.05));

    let title = F.fitScale('STATS', avail, 4 * s, 3 * s, s);
    let tabS  = Math.max(s, Math.round(title * 0.45));
    let row   = Math.max(s, Math.round(title * 0.32));

    for (;;) {
      const rows = this.measureTabRows(left, avail, tabS, s);
      const headH = F.lineHeight(title) + 10 * s +
                    rows * (F.lineHeight(tabS) + 10 * s) + 6 * s;
      const footH = F.lineHeight(row) + 12 * s + 8 * s;
      if (topY + headH + footH + MIN_BODY <= H) break;
      if (tabS > s) { tabS -= s; continue; }
      if (title > s) { title -= s; row = Math.max(s, Math.round(title * 0.32)); continue; }
      break;
    }
    const small = Math.max(s, Math.round(row * 0.8));

    this.hits = [];

    let y = topY;
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
    let tabRow = 0;
    TABS.forEach((t, i) => {
      const active = i === this.tab;
      const w = F.measure(t.label, tabS, 2 * s) + 20 * s;
      /* Wrap onto another row rather than running off the right edge.

         Three tabs fitted any window this ever saw, so the strip never needed
         to wrap. A fourth does not fit at 320 wide, and without this the
         LOGBOOK tab was drawn past the edge - present, unreachable, and
         invisible, which is the worst of the three. */
      if (tx > left && tx + w > left + avail) {
        tx = left;
        tabRow++;
        y += F.lineHeight(tabS) + 10 * s;
      }
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

    /* Kept for hitTest: see the note there about rows scrolled behind the
       pinned tab strip. */
    this._bodyTop = bodyTop;
    this._bodyBottom = bodyBottom;

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

  /* How many rows the tab strip needs at this scale. Shares the wrap rule with
     the drawing code below; if the two ever disagree the header reports one
     height and occupies another, so the rule stays a single expression. */
  measureTabRows(left, avail, tabS, s) {
    let tx = left, rows = 1;
    for (const t of TABS) {
      const w = F.measure(t.label, tabS, 2 * s) + 20 * s;
      if (tx > left && tx + w > left + avail) { tx = left; rows++; }
      tx += w + 8 * s;
    }
    return rows;
  }

  /* ------------------------------------------------------------- logbook

     A catalogue rather than a report. Walks the taxonomy, not the player's
     history, so a question type they have never been asked still appears -
     with "not seen yet" against it, which is a real and useful finding.

     Layout: Section -> Domain -> Skill (the chapter) -> question types. Only
     the open chapter lists its types, and only the open type shows its detail. */
  buildLogbook(d, L) {
    const { left, avail, row, small, s } = L;
    const blocks = [];
    const lh = F.lineHeight(row);
    const slh = F.lineHeight(small);
    const push = (h, draw) => blocks.push({ h, draw });

    // Lifetime stats per question type, indexed for lookup.
    const stat = {};
    for (const q of d.qtypes || []) stat[q.qtype] = q;
    const history = d.qtypeHistory || {};

    push(lh + 10 * s, (ctx, y) => {
      F.draw(ctx, 'LOGBOOK', left, y, { color: BONE, scale: row, tracking: 3 * s });
    });
    const seen = Object.keys(stat).length;
    push(slh * 2 + 10 * s, (ctx, y) => {
      F.draw(ctx, 'EVERY QUESTION TYPE THE DIGITAL SAT CAN ASK - ' +
             TX.QTYPES.length + ' OF THEM, IN ' + TX.SKILLS.length + ' CHAPTERS.',
             left, y, { color: BONE_DIM, scale: small, tracking: s });
      F.draw(ctx, 'YOU HAVE MET ' + seen + '. CLICK A CHAPTER TO OPEN IT.',
             left, y + slh, { color: BONE_FAINT, scale: small, tracking: s });
    });
    blocks.push({ h: 12 * s, draw: () => {} });

    const bySection = { rw: [], math: [] };
    for (const sk of TX.SKILLS) bySection[sk.section].push(sk);

    for (const sec of ['rw', 'math']) {
      const skills = bySection[sec];
      if (!skills.length) continue;

      push(lh + 14 * s, (ctx, y) => {
        F.draw(ctx, sec === 'rw' ? 'READING AND WRITING' : 'MATHEMATICS',
               left, y + 6 * s,
               { color: sec === 'rw' ? ENGLISH_C : MATH_C, scale: row, tracking: 3 * s });
        ctx.fillStyle = sec === 'rw' ? ENGLISH_C : MATH_C;
        ctx.fillRect(left, y + 6 * s + lh + 3 * s, avail, 1 * s);
      });

      let lastDomain = null;
      for (const sk of skills) {
        if (sk.domain !== lastDomain) {
          lastDomain = sk.domain;
          const dn = shortDomain(sk.domain);
          push(slh + 8 * s, (ctx, y) => {
            F.draw(ctx, dn, left, y + 3 * s,
                   { color: BONE_FAINT, scale: small, tracking: 2 * s });
          });
        }

        const types = TX.QTYPES_BY_SKILL[sk.id] || [];
        const open = this.openChapter === sk.id;
        // Chapter totals, summed from whatever the player has actually done.
        let cr = 0, ct = 0, met = 0;
        for (const q of types) {
          const st = stat[q.id];
          if (st) { cr += st.right; ct += st.total; if (st.total) met++; }
        }

        push(lh + 10 * s, (ctx, y) => {
          const hovered = open;
          ctx.fillStyle = hovered ? '#1b1815' : PANEL;
          ctx.fillRect(left, y, avail, lh + 6 * s);
          const v = this.fx.value('ch' + sk.id);
          SATG.fx.drawPress(ctx, v, { x: left, y, w: avail, h: lh + 6 * s }, s);
          const dy = SATG.fx.pressOffset(v, s);
          F.draw(ctx, (open ? '-' : '+') + ' ' + sk.cb.toUpperCase(),
                 left + 8 * s, y + 3 * s + dy,
                 { color: SATG.fx.brighten(BONE, v), scale: row, tracking: s });
          const tally = ct ? cr + '/' + ct + '  (' + Math.round(cr / ct * 100) + '%)'
                           : 'NOT SEEN YET';
          F.draw(ctx, met + ' OF ' + types.length + ' TYPES MET    ' + tally,
                 left + avail - 8 * s, y + 3 * s + dy,
                 { color: ct ? pctColor(ct ? cr / ct : 0) : BONE_FAINT,
                   scale: small, align: 'right', tracking: s });
          this.hits.push({ x: left, y, w: avail, h: lh + 6 * s,
                           kind: 'chapter', skill: sk.id, scrolls: true });
        });
        blocks.push({ h: 4 * s, draw: () => {} });

        if (!open) continue;

        for (const q of types) {
          const st = stat[q.id] || { right: 0, total: 0, pct: 0 };
          const isOpen = this.openType === q.id;
          push(slh + 8 * s, (ctx, y) => {
            const v = this.fx.value('qt' + q.id);
            SATG.fx.drawPress(ctx, v, { x: left + 10 * s, y, w: avail - 10 * s,
                                        h: slh + 5 * s }, s);
            const dy = SATG.fx.pressOffset(v, s);
            F.draw(ctx, (isOpen ? '>' : ' ') + ' ' + q.label,
                   left + 14 * s, y + dy,
                   { color: SATG.fx.brighten(isOpen ? BONE : BONE_DIM, v),
                     scale: small, tracking: s });
            const barW = Math.round(avail * 0.18);
            const barX = left + avail - barW - 62 * s;
            const barH = Math.max(2 * s, Math.round(F.cellH * small * 0.5));
            const by = y + Math.round((F.cellH * small - barH) / 2);
            ctx.fillStyle = '#241f1a';
            ctx.fillRect(barX, by, barW, barH);
            if (st.total) {
              ctx.fillStyle = TX.enoughData(st.total) ? pctColor(st.pct) : BONE_FAINT;
              ctx.fillRect(barX, by, Math.max(1 * s, Math.round(barW * clamp(st.pct, 0, 1))), barH);
            }
            F.draw(ctx, st.total ? st.right + '/' + st.total : '-',
                   left + avail, y + dy,
                   { color: st.total ? BONE_DIM : BONE_FAINT, scale: small,
                     align: 'right', tracking: s });
            this.hits.push({ x: left + 10 * s, y, w: avail - 10 * s, h: slh + 5 * s,
                             kind: 'logtype', qtype: q.id, scrolls: true });
          });

          if (isOpen) blocks.push(this.logDetailBlock(L, q, st, history[q.id]));
        }
        blocks.push({ h: 10 * s, draw: () => {} });
      }
    }

    blocks.push({ h: 20 * s, draw: () => {} });
    return blocks;
  }

  /* The open question type. Deliberately fuller than the pre-game picker: that
     one needs enough to choose with, this one is the reference entry - what the
     question is, an example, how it is usually missed, what College Board calls
     the skill, the player's own record on it, and every link we have. */
  logDetailBlock(L, q, st, hist) {
    const { left, avail, small, s } = L;
    const r = TX.resources(q.id);
    const indent = left + 22 * s;
    const w = avail - 32 * s;
    const slh = F.lineHeight(small);

    const paras = [
      { t: q.asks, c: BONE },
      /* First, because it is the first thing that happens in the exam: you have
         to know which of the sixty-five you are looking at before anything else
         on this card is any use. */
      { t: 'YOU CAN TELL BECAUSE.  ' + q.cue, c: GOOD },
      { t: 'EXAMPLE.  ' + q.example, c: BONE_DIM },
      { t: 'USUALLY MISSED BY.  ' + q.trap, c: WARN }
    ];
    if (r.skillName) {
      paras.push({ t: 'COLLEGE BOARD CALLS THIS SKILL "' + r.skillName + '".', c: BONE_FAINT });
    }

    // Your record, stated plainly, with the evidence caveat where it applies.
    let recordLine;
    if (!st.total) {
      recordLine = 'YOUR RECORD.  NOT SEEN YET - THIS TYPE HAS NOT COME UP IN A RUN.';
    } else if (!TX.enoughData(st.total)) {
      recordLine = 'YOUR RECORD.  ' + st.right + ' OF ' + st.total +
                   ' - TOO FEW TO JUDGE (NEEDS ' + TX.MIN_CLAIM + ').';
    } else {
      recordLine = 'YOUR RECORD.  ' + st.right + ' OF ' + st.total + '  (' +
                   Math.round(st.pct * 100) + '%)' +
                   (hist && hist.length > 1
                     ? '  ACROSS ' + hist.length + ' RUNS' : '');
    }
    paras.push({ t: recordLine, c: st.total ? BONE : BONE_FAINT });

    const fits = paras.map((p) => ({ p, fit: F.fitLines(p.t, w, small, s, 8, s) }));
    const textH = fits.reduce(
      (n, f) => n + F.lineHeight(f.fit.scale) * f.fit.lines.length + 4 * s, 0);

    const links = [];
    if (r.video) links.push({ label: 'HELPFUL VIDEO  (KHAN ACADEMY)', url: r.video });
    if (r.page)  links.push({ label: 'HELPFUL PAGE   (KHAN ACADEMY)', url: r.page });
    if (r.oct)   links.push({ label: 'COVERS EVERYTHING ABOUT ' +
                                     (r.skillName || '').toUpperCase() +
                                     '  (ORGANIC CHEMISTRY TUTOR)', url: r.oct.url });
    const linkH = links.length * (slh + 5 * s);
    const btnH = slh + 12 * s;
    const h = textH + linkH + btnH + 16 * s;

    return { h, draw: (ctx, y) => {
      ctx.fillStyle = '#100e0c';
      ctx.fillRect(left + 10 * s, y - 2 * s, avail - 10 * s, h - 6 * s);
      ctx.fillStyle = '#2a2520';
      ctx.fillRect(left + 10 * s, y - 2 * s, 2 * s, h - 6 * s);

      let yy = y + 4 * s;
      for (const f of fits) {
        for (const ln of f.fit.lines) {
          F.draw(ctx, ln, indent, yy, { color: f.p.c, scale: f.fit.scale, tracking: s });
          yy += F.lineHeight(f.fit.scale);
        }
        yy += 4 * s;
      }
      for (const l of links) {
        F.draw(ctx, l.label, indent, yy, { color: LINK, scale: small, tracking: s });
        const lw = F.measure(l.label, small, s);
        ctx.fillStyle = LINK;
        ctx.fillRect(indent, yy + slh - 2 * s, lw, 1 * s);
        this.hits.push({ x: indent, y: yy, w: lw + 8 * s, h: slh + 3 * s,
                         kind: 'link', url: l.url, scrolls: true });
        yy += slh + 5 * s;
      }

      /* The drill button appears only where the bank can actually produce this
         type. Offering it otherwise would start a run that quietly served
         something else, which is worse than saying the type is not in yet. */
      if (SATG.questionBank.canDraw(q.id)) {
        const label = 'PRACTICE ONLY THIS QUESTION TYPE';
        const bw = F.measure(label, small, 2 * s) + 22 * s;
        const v = this.fx.value('pr' + q.id);
        ctx.fillStyle = '#1d2a1f';
        ctx.fillRect(indent, yy + 2 * s, bw, slh + 8 * s);
        SATG.fx.drawPress(ctx, v, { x: indent, y: yy + 2 * s, w: bw, h: slh + 8 * s }, s);
        F.draw(ctx, label, indent + 11 * s, yy + 6 * s + SATG.fx.pressOffset(v, s),
               { color: SATG.fx.brighten(GOOD, v), scale: small, tracking: 2 * s });
        this.hits.push({ x: indent, y: yy + 2 * s, w: bw, h: slh + 8 * s,
                         kind: 'practice', qtype: q.id, scrolls: true });
      } else {
        F.draw(ctx, 'NOT IN THE QUESTION BANK YET - THE SAT ASKS THIS, THE GAME DOES NOT.',
               indent, yy + 6 * s, { color: WARN, scale: small, tracking: s });
      }
    } };
  }

  /* ------------------------------------------------------------- history

     Two different things live here, and they are not the same record.

     The TOTAL REVIEW is built from every run ever finished - four hundred of
     them fit, because a run's aggregate is a few hundred bytes.

     A SAVED REVIEW is the whole run: every question, every answer, every
     explanation. Ninety-eight of those is far too much to keep four hundred
     times over, so they are opt-in and capped, and this page says what the cap
     is rather than letting a report quietly disappear off the end. */
  buildHistory(d, L) {
    const { left, avail, row, small, s } = L;
    const blocks = [];
    const lh = F.lineHeight(row);
    const slh = F.lineHeight(small);
    const push = (h, draw) => blocks.push({ h, draw });
    const gap = (n) => push(n, () => {});

    const heading = (text) => push(lh + 12 * s, (ctx, y) => {
      F.draw(ctx, text, left, y + 6 * s, { color: BONE, scale: row, tracking: 2 * s });
      ctx.fillStyle = '#241f1a';
      ctx.fillRect(left, y + 6 * s + lh + 2 * s, avail, 1 * s);
    });

    const line = (text, color, scale) => {
      const sc = scale || small;
      const fit = F.fitLines(text, avail, sc, s, 6, s);
      push(F.lineHeight(fit.scale) * fit.lines.length + 4 * s, (ctx, y) => {
        let yy = y;
        for (const ln of fit.lines) {
          F.draw(ctx, ln, left, yy,
                 { color: color || BONE_DIM, scale: fit.scale, tracking: s });
          yy += F.lineHeight(fit.scale);
        }
      });
    };

    const revs = SATG.profile.reviews();

    /* ---- the combined report */
    heading('TOTAL REVIEW');
    if (d.totalRunCount) {
      line('EVERY RUN YOU HAVE FINISHED, AS ONE REPORT - ACCURACY BY DIFFICULTY, ' +
           'BY DOMAIN, AND BY ALL ' + TX.QTYPES.length + ' QUESTION TYPES.', BONE_DIM);
      const label = 'OPEN TOTAL REVIEW';
      const bw = F.measure(label, row, 2 * s) + 26 * s;
      const bh = lh + 10 * s;
      push(bh + 12 * s, (ctx, y) => {
        const v = this.fx.value('combined');
        ctx.fillStyle = '#1d2a1f';
        ctx.fillRect(left, y, bw, bh);
        SATG.fx.drawPress(ctx, v, { x: left, y, w: bw, h: bh }, s);
        F.draw(ctx, label, left + 13 * s, y + 5 * s + SATG.fx.pressOffset(v, s),
               { color: SATG.fx.brighten(GOOD, v), scale: row, tracking: 2 * s });
        this.hits.push({ x: left, y, w: bw, h: bh, kind: 'combined', scrolls: true });
      });
    } else {
      line('NOTHING TO COMBINE YET - FINISH A RUN FIRST.', BONE_FAINT);
      gap(10 * s);
    }
    gap(8 * s);

    /* ---- the saved reviews */
    heading('SAVED REVIEWS   ' + revs.length + ' OF ' + SATG.profile.MAX_REVIEWS);
    if (!revs.length) {
      line('NONE SAVED YET.', BONE_DIM);
      line('FINISH A RUN, OPEN FULL ANALYSIS, AND PRESS SAVE TO STATS. ' +
           'A SAVED REVIEW KEEPS EVERY QUESTION AND EVERY EXPLANATION, SO YOU ' +
           'CAN REOPEN IT HERE LONG AFTER THE RUN IS OVER.', BONE_FAINT);
      gap(20 * s);
      return blocks;
    }

    line('CLICK ONE TO REOPEN IT IN FULL.', BONE_FAINT);
    gap(6 * s);

    for (const r of revs) {
      const armed = this.armedDelete === r.at;
      const when = new Date(r.at);
      const p2 = (n) => String(n).padStart(2, '0');
      const stamp = when.getFullYear() + '-' + p2(when.getMonth() + 1) + '-' +
                    p2(when.getDate()) + '  ' + p2(when.getHours()) + ':' +
                    p2(when.getMinutes());
      const items = r.items || [];
      const right = items.filter((i) => i.right).length;
      const score = r.kind === 'infinity'
        ? (r.cleared | 0) + ' CLEARED'
        : (r.scaled | 0) + (r.isFull ? ' / 1600' : ' / 800');
      const detail = items.length
        ? right + '/' + items.length + ' RIGHT   ' + clock(r.elapsed || 0)
        : clock(r.elapsed || 0);

      const rowH = slh * 2 + 14 * s;
      push(rowH + 4 * s, (ctx, y) => {
        ctx.fillStyle = PANEL;
        ctx.fillRect(left, y, avail, rowH);

        const delLabel = armed ? 'CONFIRM' : 'DELETE';
        const delW = F.measure('CONFIRM', small, 2 * s) + 18 * s;
        const openW = Math.max(1, avail - delW - 8 * s);

        const ov = this.fx.value('rv' + r.at);
        SATG.fx.drawPress(ctx, ov, { x: left, y, w: openW, h: rowH }, s);
        const dy = SATG.fx.pressOffset(ov, s);

        F.draw(ctx, fitOrClip(stamp + '   ' + (r.label || 'RUN'),
                              openW - 16 * s - F.measure(score, small, s), small, s),
               left + 8 * s, y + 4 * s + dy,
               { color: SATG.fx.brighten(BONE, ov), scale: small, tracking: s });
        F.draw(ctx, score, left + openW - 8 * s, y + 4 * s + dy,
               { color: BONE, scale: small, align: 'right', tracking: s });
        F.draw(ctx, detail, left + 8 * s, y + 4 * s + slh + dy,
               { color: BONE_FAINT, scale: small, tracking: s });
        this.hits.push({ x: left, y, w: openW, h: rowH,
                         kind: 'review-open', at: r.at, scrolls: true });

        const dvx = left + avail - delW;
        const dv = this.fx.value('rd' + r.at);
        ctx.fillStyle = armed ? '#3a1714' : '#1a1613';
        ctx.fillRect(dvx, y, delW, rowH);
        SATG.fx.drawPress(ctx, dv, { x: dvx, y, w: delW, h: rowH }, s);
        F.draw(ctx, delLabel, dvx + delW / 2,
               y + Math.round((rowH - F.cellH * small) / 2) + SATG.fx.pressOffset(dv, s),
               { color: SATG.fx.brighten(armed ? BLOOD : BONE_FAINT, dv),
                 scale: small, align: 'center', tracking: s });
        this.hits.push({ x: dvx, y, w: delW, h: rowH,
                         kind: 'review-delete', at: r.at, scrolls: true });
      });
    }

    if (this.armedDelete) {
      line('CLICK CONFIRM AGAIN TO DELETE THAT REVIEW. IT CANNOT BE UNDONE. ' +
           'CLICK ANYWHERE ELSE TO CANCEL.', BLOOD);
    }
    if (revs.length >= SATG.profile.MAX_REVIEWS) {
      line('AT THE LIMIT. SAVING ANOTHER WILL DROP THE OLDEST ONE.', WARN);
    }

    gap(20 * s);
    return blocks;
  }

  /* Each block knows its own height, so the scroll window can be computed
     without drawing anything. */
  buildBlocks(d, L) {
    const { left, avail, row, small, s } = L;
    const blocks = [];
    const lh = F.lineHeight(row);
    const slh = F.lineHeight(small);

    /* The logbook is a catalogue and the history is a filing cabinet. Both have
       something to say with no runs recorded, so both are answered before the
       empty-tab checks below. */
    if (this.isLogbook) return this.buildLogbook(d, L);
    if (this.isHistory) return this.buildHistory(d, L);

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
      /* The projection is stated in words as well as drawn, because a shaded
         wedge is easy to misread as measured data and a sentence is not. */
      const pr = tr.projection;
      if (d.scope === 'overall' && pr) {
        const dir = pr.perTest > 0.5 ? 'RISING' : pr.perTest < -0.5 ? 'FALLING' : 'FLAT';
        line('PROJECTED   ' + pr.lo + ' TO ' + pr.hi + ' IN ' + pr.ahead +
             ' MORE TEST' + (pr.ahead === 1 ? '' : 'S') + '   (' + dir +
             (dir === 'FLAT' ? '' : ' ' + (pr.perTest > 0 ? '+' : '') + pr.perTest + ' PER TEST') + ')',
             pr.perTest > 0.5 ? GOOD : pr.perTest < -0.5 ? BLOOD : BONE_DIM, row);
        line('THE SHADED WEDGE IS A PROJECTION FROM YOUR LAST ' + pr.points +
             ' SCORES, NOT A RESULT. IT ASSUMES YOU CARRY ON EXACTLY AS YOU HAVE BEEN.',
             BONE_FAINT);
        if (pr.clamped) {
          line('THE TREND RUNS OFF THE TOP OF THE SCALE, SO THE FIGURE ABOVE IS ' +
               'CAPPED AT THE REAL LIMIT RATHER THAN EXTENDED PAST IT.', WARN);
        }
      } else if (d.scope === 'overall' && tr.overall.length &&
                 tr.overall.length < 4) {
        line('A PROJECTION APPEARS ONCE YOU HAVE FOUR SCORED TESTS. THREE POINTS ' +
             'CAN BE FITTED BY ANY LINE AT ALL, WHICH IS NOT A FORECAST.', BONE_FAINT);
      }
      gap(14 * s);
    }

    /* ---- what you have actually been practising, against what the test is.

       A player who only ever runs MATH INFINITY has a domain breakdown that
       looks thorough and a preparation that is not. Nothing on this page said
       so: every other chart here is scaled to what they happened to answer, so
       a section they have never touched is simply absent rather than visibly
       missing. This is the one chart whose denominator is the real test. */
    if (d.scope === 'overall' && d.answered >= 20) {
      heading('WHAT YOU HAVE BEEN PRACTISING');
      const REAL = SATG.screens.REAL_DOMAIN_MIX;
      const mine = {};
      for (const dm of d.domains) mine[dm.domain] = dm.total;
      const rows = Object.keys(REAL).map((k) => ({
        domain: k, real: REAL[k],
        mine: d.answered ? (mine[k] || 0) / d.answered * 100 : 0
      })).sort((a, b) => (b.mine - b.real) - (a.mine - a.real));

      for (const r of rows) {
        blocks.push({ h: F.lineHeight(small) + 8 * s, draw: (ctx, y) => {
          this.drawMixRow(ctx, y, left, avail, small, r);
        }});
      }
      line('SOLID IS YOUR PRACTICE. THE MARK IS THE SHARE THAT DOMAIN HAS ON THE ' +
           'REAL TEST.', BONE_FAINT);
      const worst = rows[rows.length - 1];
      if (worst && worst.real - worst.mine > 6) {
        line('YOU ARE UNDER-PRACTISING ' + shortDomain(worst.domain).toUpperCase() +
             ' BY ' + Math.round(worst.real - worst.mine) + ' POINTS OF SHARE.', WARN);
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

  /* One domain's share of your practice against its share of the real test.

     A bullet chart rather than two bars: the comparison is a single quantity
     measured against a target, and two bars invite the eye to read them as two
     independent facts. Both are drawn on the same 0-40% scale so the rows can
     be compared with each other as well as with their own marks. */
  drawMixRow(ctx, y, left, avail, scale, r) {
    const s = this.uiScale || 1;
    const labelW = Math.round(avail * 0.40);
    const barX = left + labelW + 8 * s;
    const barW = Math.round(avail * 0.36);
    const barH = Math.max(3 * s, Math.round(F.cellH * scale * 0.65));
    const FULL = 40;                       // no domain is above 35% of the test

    const label = shortDomain(r.domain);
    const ls = F.fitScale(label, labelW - 4 * s, scale, s, s);
    F.draw(ctx, fitOrClip(label, labelW - 4 * s, ls, s), left, y,
           { color: BONE_DIM, scale: ls, tracking: s });

    const by = y + Math.round((F.cellH * scale - barH) / 2);
    ctx.fillStyle = '#241f1a';
    ctx.fillRect(barX, by, barW, barH);

    const gapPts = r.mine - r.real;
    ctx.fillStyle = gapPts < -6 ? BLOOD : Math.abs(gapPts) <= 6 ? GOOD : WARN;
    ctx.fillRect(barX, by, Math.max(1 * s, Math.round(barW * clamp(r.mine / FULL, 0, 1))), barH);

    // The target mark: a full-height tick the bar is read against.
    const tx = barX + Math.round(barW * clamp(r.real / FULL, 0, 1));
    ctx.fillStyle = BONE;
    ctx.fillRect(tx, by - 3 * s, Math.max(1, Math.round(s)), barH + 6 * s);

    F.draw(ctx, Math.round(r.mine) + '% / ' + r.real + '%', left + avail, y,
           { color: BONE_DIM, scale: scale, align: 'right', tracking: s });
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
      /* When a projection is drawn, the plot is wider than the data: the real
         points have to keep the same x positions the projection was built
         against, or the dashed line would start somewhere the last score is
         not. */
      const slots = this._projSlots || (n - 1);
      const px = (i) => (n === 1 && !this._projSlots) ? x0 + w / 2
                      : x0 + w * (slots ? i / slots : 0.5);
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

    /* The projection is drawn FIRST, under every real series, so that a band
       showing something that has not happened can never sit on top of a point
       that did. */
    const proj = tr.projection;
    if (scope === 'overall' && proj && tr.overall.length >= 2) {
      /* The x-axis is one slot per test taken, and the projection sits `ahead`
         slots past the last one - so the plot has to make room for them, which
         is why every series below is drawn against `slots` rather than against
         its own length. */
      const slots = tr.overall.length - 1 + proj.ahead;
      const px = (i) => x0 + w * (slots ? i / slots : 0.5);
      const py = (v) => y1 - ph * clamp((v - 400) / 1200, 0, 1);
      const lastX = px(tr.overall.length - 1);
      const lastY = py(tr.overall[tr.overall.length - 1].v);
      const tipX = px(proj.at);

      // The band: a wedge opening from the last real score to the range ahead.
      ctx.fillStyle = 'rgba(217,210,196,0.10)';
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(tipX, py(proj.hi));
      ctx.lineTo(tipX, py(proj.lo));
      ctx.closePath();
      ctx.fill();

      // The centre line, dashed, so it never reads as measured data.
      ctx.strokeStyle = BONE_FAINT;
      ctx.lineWidth = Math.max(1, s);
      if (ctx.setLineDash) ctx.setLineDash([Math.max(2, 3 * s), Math.max(2, 3 * s)]);
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(tipX, py(proj.centre));
      ctx.stroke();
      if (ctx.setLineDash) ctx.setLineDash([]);

      F.draw(ctx, String(proj.centre), Math.min(x1, tipX + 4 * s),
             py(proj.centre) - Math.round(F.cellH * s / 2),
             { color: BONE_FAINT, scale: s, tracking: 0 });

      this._projSlots = slots;
    } else {
      this._projSlots = null;
    }

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
    /* Later hits win, because the logbook draws a type row and then its open
       detail panel over the same span; the detail's links are the more specific
       target and are registered second. */
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (x < h.x || x > h.x + h.w || y < h.y || y > h.y + h.h) continue;
      /* Rows inside the scrolling body are only live where the body is
         visible. Drawing is clipped to that window but hit testing is not, so
         without this a chapter scrolled up under the tab strip stays clickable
         through it and the click lands on something off screen. */
      if (h.scrolls && (y < this._bodyTop || y > this._bodyBottom)) continue;
      return h;
    }
    return null;
  }

  /* One chapter open at a time. Opening a different one closes the previous,
     which keeps the page short enough that what you clicked stays on screen. */
  toggleChapter(id) {
    this.fx.press('ch' + id);
    if (this.openChapter === id) { this.openChapter = null; this.openType = null; }
    else { this.openChapter = id; this.openType = null; }
    this.dirty = true;
    return true;
  }

  toggleType(id) {
    this.fx.press('qt' + id);
    this.openType = this.openType === id ? null : id;
    this.dirty = true;
    return true;
  }

  /* Where the Google button should sit: under the account line, top right. */
  buttonSpot() { return { u: 0.78, v: 0.13 }; }
}

SATG.screens.StatsScreen = StatsScreen;
SATG.screens.STATS_TABS = TABS;

})(window);
