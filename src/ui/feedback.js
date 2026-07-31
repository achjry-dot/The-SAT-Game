/* =========================================================================
   ui/feedback.js - the in-game feedback screen.

   Reached from FEEDBACK on the title card. The player types a message, it is
   posted to a Discord webhook, and a short diagnostic block goes with it.

   That diagnostic block is the point of building this at all rather than just
   opening a mail client. Nearly every bug in this project turned out to hinge
   on which browser the player used and what their display scaling was - facts
   no reporter has any reason to think are relevant, and which turn "it looks
   broken" into something that can actually be chased. Collecting them
   automatically costs the player nothing.

   Nothing is gathered that the player would not expect: the build string, the
   browser's own user-agent, the window size, which upload path the renderer
   chose, and how far they got. No identifiers, no storage, nothing that
   persists between sessions.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;
const F = SATG.font;
const { clamp } = SATG.util;

const BONE       = '#d9d2c4';
const BONE_DIM   = '#8e8779';
const BONE_FAINT = '#4f4a42';
const GOOD       = '#7dff9b';
const BAD        = '#ff8f7a';

const HINT = 'ENTER - SEND     SHIFT+ENTER - NEW LINE     ESC - BACK';

/* Wrap without changing a single character.

   font.wrap() is the right tool for laying out a passage - it splits on
   spaces, drops the empty tokens that runs of spaces produce, and rejoins
   with one space. For prose being READ that is invisible and correct. For a
   box someone is TYPING into it is not: "hi  a" came out as "hi a" and a
   trailing space vanished entirely, so the text on screen was not the text
   being edited and the caret could not be placed from it. Pressing space
   looked like a dead key.

   The font is monospace, so a line's width is just its length times the
   glyph advance and the whole job can be done in character counts. Breaks
   prefer the last space that fits and fall back to a hard break for a word
   longer than the box. */
function wrapExact(text, perLine) {
  const out = [];
  for (const para of String(text).split('\n')) {
    if (!para.length) { out.push(''); continue; }
    let i = 0;
    while (i < para.length) {
      let end = Math.min(i + perLine, para.length);
      if (end < para.length) {
        for (let k = end; k > i; k--) {
          if (para[k - 1] === ' ') { end = k; break; }
        }
      }
      out.push(para.slice(i, end));
      i = end;                       // end > i always, so this terminates
    }
  }
  return out;
}

class FeedbackScreen extends SATG.screens.ScreenCanvas {
  constructor(gl) {
    super(gl, 1280, 720);
    this.text = '';
    this.status = 'idle';        // idle | sending | sent | failed
    this.statusText = '';
    this.time = 0;
    this.caretOn = true;
    this.cooldownLeft = 0;
    this.hits = [];
  }

  reset() {
    this.text = '';
    this.status = 'idle';
    this.statusText = '';
    this.dirty = true;
  }

  get maxChars() {
    const c = SATG.CONFIG || {};
    return c.feedbackMaxChars || 900;
  }

  /* ------------------------------------------------------------- input */

  typeChar(ch) {
    if (this.status === 'sending') return false;
    if (ch.length !== 1) return false;
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) return false;      // the font has no others
    if (this.text.length >= this.maxChars) return false;
    this.text += ch;
    this.status = 'idle';
    this.dirty = true;
    return true;
  }

  newline() {
    if (this.status === 'sending') return false;
    if (this.text.length >= this.maxChars) return false;
    this.text += '\n';
    this.dirty = true;
    return true;
  }

  backspace() {
    if (this.status === 'sending' || !this.text.length) return false;
    this.text = this.text.slice(0, -1);
    this.dirty = true;
    return true;
  }

  update(dt) {
    this.time += dt;
    if (this.cooldownLeft > 0) {
      this.cooldownLeft = Math.max(0, this.cooldownLeft - dt);
      this.dirty = true;
    }
    const on = (Math.floor(this.time * 2.1) % 2) === 0;
    if (on !== this.caretOn) { this.caretOn = on; this.dirty = true; }
  }

  /* -------------------------------------------------------- diagnostics */

  diagnostics(game) {
    const P = game.pipeline;
    return {
      build: String(SATG.BUILD || '?'),
      browser: String(navigator.userAgent || '?'),
      display: P.width + 'x' + P.height +
               ' @ ' + (global.devicePixelRatio || 1) + 'x' +
               '  (ui ' + P.uiScale + 'x)',
      renderer: (SATG.gl.uploadRoute || '?') + ' upload' +
                (SATG.gl.readbackTrusted === false ? ', readback perturbed' : '') +
                (SATG.FONT_DATA ? ', baked font' : ', fallback font'),
      progress: 'cleared ' + game.cleared + ', best ' + game.best
    };
  }

  /* --------------------------------------------------------------- send */

  canSend() {
    return this.status !== 'sending' &&
           this.cooldownLeft <= 0 &&
           this.text.trim().length > 0;
  }

  /**
   * Post to the configured webhook. Returns a promise, but the screen's own
   * state is what the UI reads - callers do not need to await it.
   */
  send(game) {
    if (!this.canSend()) {
      if (!this.text.trim().length) {
        this.status = 'failed';
        this.statusText = 'WRITE SOMETHING FIRST';
        this.dirty = true;
      }
      return Promise.resolve(false);
    }

    const cfg = SATG.CONFIG || {};
    const url = (cfg.feedbackWebhook || '').trim();

    /* No webhook configured: try mail instead of dead-ending. mailFallback
       reports whether it actually had an address to use - claiming "opened
       your mail app" when nothing opened would leave the player believing a
       message was sent that never existed. */
    if (!url) {
      if (this.mailFallback(game)) {
        this.status = 'sent';
        this.statusText = 'OPENED YOUR MAIL APP';
      } else {
        this.status = 'failed';
        this.statusText = 'NO FEEDBACK ADDRESS IS SET UP IN THIS BUILD';
      }
      this.dirty = true;
      return Promise.resolve(this.status === 'sent');
    }

    this.status = 'sending';
    this.statusText = 'SENDING';
    this.dirty = true;

    const d = this.diagnostics(game);
    const payload = {
      username: 'THE SAT GAME',
      embeds: [{
        title: 'Feedback',
        description: this.text.slice(0, 4000),
        color: 0x8dffab,
        fields: [
          { name: 'build',    value: d.build,    inline: true },
          { name: 'display',  value: d.display,  inline: true },
          { name: 'progress', value: d.progress, inline: true },
          { name: 'renderer', value: d.renderer, inline: false },
          // Discord caps a field value at 1024 characters.
          { name: 'browser',  value: d.browser.slice(0, 1000), inline: false }
        ],
        timestamp: new Date().toISOString()
      }]
    };

    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then((res) => {
      // Discord answers 204 No Content on success.
      if (!res.ok) throw new Error('HTTP ' + res.status);
      this.status = 'sent';
      this.statusText = 'THANK YOU - SENT';
      this.text = '';
      this.cooldownLeft = cfg.feedbackCooldown || 20;
      this.dirty = true;
      return true;
    }).catch((err) => {
      /* Most likely causes, in order: the url is wrong or was deleted, the
         player is offline, or a content blocker refused the request. None of
         them are the player's problem to solve, so offer the mail route -
         but only when there is actually an address behind it, or the offer
         is a dead end dressed up as a way out. */
      console.warn('[feedback] webhook post failed:', err);
      this.status = 'failed';
      this.statusText = (cfg.feedbackEmail || '').trim()
        ? 'COULD NOT SEND - PRESS M TO EMAIL INSTEAD'
        : 'COULD NOT SEND - PLEASE TRY AGAIN LATER';
      this.dirty = true;
      return false;
    });
  }

  /* Hand the message to a mail client instead. */
  mailFallback(game) {
    const cfg = SATG.CONFIG || {};
    const to = cfg.feedbackEmail || '';
    if (!to) return false;

    const d = this.diagnostics(game);
    const body = this.text + '\n\n' +
      '--- please keep the lines below, they say which build this was ---\n' +
      'build:      ' + d.build + '\n' +
      'browser:    ' + d.browser + '\n' +
      'display:    ' + d.display + '\n' +
      'renderer:   ' + d.renderer + '\n' +
      'progress:   ' + d.progress + '\n';

    const url = 'mailto:' + to +
      '?subject=' + encodeURIComponent('THE SAT GAME - feedback (' + d.build + ')') +
      '&body=' + encodeURIComponent(body);

    /* A synthetic anchor rather than assigning location.href: handing a
       mailto: to the page's own location is what pop-up blockers object to,
       and with no mail handler registered it can strand the page on a dead
       navigation. An anchor simply does nothing instead. */
    try {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return true;
    } catch (err) {
      console.warn('[feedback] could not open a mail client:', err);
      return false;
    }
  }

  /* ------------------------------------------------------------ drawing */

  render() {
    if (!this.dirty) return;
    const ctx = this.ctx;
    this.clear();

    const W = this.W, H = this.H, s = this.uiScale || 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    const pad = Math.max(6 * s, Math.round(Math.min(W, H) * 0.08));
    const left = pad;
    const colW = Math.max(8 * s, W - pad * 2);

    let titleScale = 4 * s;
    while (titleScale > 2 && F.measure('SEND FEEDBACK', titleScale, 3 * s) > colW) {
      titleScale -= 0.5 * s;
    }

    /* ---- vertical budget.

       The box used to claim a fixed 40% of the height while everything around
       it was measured in absolute pixels. On a short window - or at 2x UI
       scale, which doubles every glyph and button - the fixed parts added up
       to more than the screen and the SEND and BACK buttons dropped off the
       bottom, which is the one thing on this screen that must never happen.

       So the chrome is measured first and the box takes whatever is left. If
       even that is not enough, optional lines are dropped in order of how
       little they are needed, rather than letting anything overflow. */
    const sub = F.fitLines('WHAT WENT WRONG, OR WHAT WOULD MAKE IT BETTER?',
                           colW, s, s, 2, s);
    const hintFit = F.fitLines(HINT, colW, s, s, 2, s);
    const noteFit = F.fitLines('SENT WITH YOUR MESSAGE: BUILD, BROWSER, WINDOW SIZE, PROGRESS.',
                               colW, s, s, 2, s);
    let statusFit = this.statusText
      ? F.fitLines(this.statusText, colW, s, s, 2, s) : { lines: [], scale: s };

    const bw = Math.round(Math.min(220 * s, colW * 0.34));
    const bh = Math.round(34 * s);
    const ts = 2 * s;
    const lineH = F.lineHeight(ts, 3);
    const MIN_BOX = lineH * 2 + 24 * s;             // two lines of typing, minimum

    const headH = F.lineHeight(titleScale) + 6 * s;
    const linesH = (fit) => fit.lines.length * F.lineHeight(fit.scale);

    let showSub = true, showNote = true, showCount = true;
    const chrome = () =>
      headH +
      (showSub ? linesH(sub) + 14 * s : 8 * s) +
      10 * s +
      (showCount ? F.lineHeight(s) + 12 * s : 6 * s) +
      bh + 14 * s +
      linesH(statusFit) +
      linesH(hintFit) + 4 * s +
      (showNote ? linesH(noteFit) : 0) +
      pad * 2;

    // Shed the least necessary things first; never the box or the buttons.
    if (H - chrome() < MIN_BOX) showNote = false;
    if (H - chrome() < MIN_BOX) showSub = false;
    if (H - chrome() < MIN_BOX) showCount = false;
    // Last resort: one line of status rather than two. Truncating a message
    // is poor, but pushing the buttons off the screen is worse.
    if (H - chrome() < MIN_BOX && statusFit.lines.length > 1) {
      statusFit = { lines: statusFit.lines.slice(0, 1), scale: statusFit.scale };
    }
    const boxH = Math.max(MIN_BOX, H - chrome());

    let y = pad;
    F.draw(ctx, 'SEND FEEDBACK', left, y,
           { color: BONE, scale: titleScale, tracking: 3 * s });
    y += headH;

    if (showSub) {
      for (const ln of sub.lines) {
        F.draw(ctx, ln, left, y, { color: BONE_DIM, scale: sub.scale, tracking: sub.scale });
        y += F.lineHeight(sub.scale);
      }
      y += 14 * s;
    } else {
      y += 8 * s;
    }
    ctx.fillStyle = '#16140f';
    ctx.fillRect(left, y, colW, boxH);
    ctx.strokeStyle = this.status === 'failed' ? BAD : '#3a352c';
    ctx.lineWidth = Math.max(1, s);
    ctx.strokeRect(left + 0.5, y + 0.5, colW - 1, boxH - 1);

    const inner = left + 12 * s;
    const innerW = Math.max(8 * s, colW - 24 * s);

    // Character-preserving, so what is drawn is exactly what was typed.
    const perLine = Math.max(1, Math.floor(innerW / F.advanceFor(ts, 0)));
    const lines = wrapExact(this.text, perLine);

    const maxLines = Math.max(1, Math.floor((boxH - 24 * s) / lineH));
    const shown = lines.slice(-maxLines);          // follow the caret
    let ty = y + 12 * s;
    shown.forEach((ln) => {
      F.draw(ctx, ln, inner, ty, { color: BONE, scale: ts });
      ty += lineH;
    });

    if (this.caretOn && this.status !== 'sending') {
      const lastLine = shown.length ? shown[shown.length - 1] : '';

      /* The wrapped line now holds every character that was typed, spaces
         included, so measuring it puts the caret in the right place with no
         correction needed. */
      let cx = inner + F.measure(lastLine, ts, 0);
      // A line filled to the edge should not draw the caret outside the box.
      cx = Math.min(cx, inner + innerW - 3 * s);

      const cy = y + 12 * s + Math.max(0, shown.length - 1) * lineH;
      ctx.fillStyle = BONE;
      ctx.fillRect(cx + 2 * s, cy, 2 * s, F.cellH * ts);
    }

    if (!this.text.length) {
      F.draw(ctx, 'TYPE HERE', inner, y + 12 * s, { color: '#3a352c', scale: ts });
    }

    y += boxH + 10 * s;

    if (showCount) {
      const remaining = this.maxChars - this.text.length;
      F.draw(ctx, remaining + ' CHARACTERS LEFT', left + colW, y,
             { color: remaining < 60 ? BAD : BONE_FAINT, scale: s, align: 'right' });
      y += F.lineHeight(s) + 12 * s;
    } else {
      y += 6 * s;
    }

    /* ---- buttons */
    this.hits = [];
    const mkButton = (x, label, key, enabled) => {
      ctx.fillStyle = enabled ? '#22201a' : '#141310';
      ctx.fillRect(x, y, bw, bh);
      ctx.strokeStyle = enabled ? '#5a5348' : '#2a2722';
      ctx.lineWidth = Math.max(1, s);
      ctx.strokeRect(x + 0.5, y + 0.5, bw - 1, bh - 1);
      F.draw(ctx, label, x + bw / 2, y + (bh - F.cellH * s * 1.5) / 2,
             { color: enabled ? BONE : BONE_FAINT, scale: s * 1.5,
               align: 'center', tracking: s });
      this.hits.push({ x, y, w: bw, h: bh, key, enabled });
    };

    const sendable = this.canSend();
    mkButton(left, this.cooldownLeft > 0
      ? 'WAIT ' + Math.ceil(this.cooldownLeft) : 'SEND', 'send', sendable);
    mkButton(left + bw + 14 * s, 'BACK', 'back', true);

    y += bh + 14 * s;

    /* ---- status */
    if (this.statusText) {
      const col = this.status === 'failed' ? BAD
                : this.status === 'sent' ? GOOD : BONE_DIM;
      // Uses the fit measured in the budget above, so what is drawn is
      // exactly what the layout reserved room for.
      for (const ln of statusFit.lines) {
        F.draw(ctx, ln, left, y, { color: col, scale: statusFit.scale, tracking: statusFit.scale });
        y += F.lineHeight(statusFit.scale);
      }
    }

    /* ---- hint + what gets attached, stated plainly */
    /* Built from the bottom edge upwards: either of these can wrap to two
       lines on a narrow window, and stacking them downwards from a fixed
       offset would push the second one off the screen. */
    const noteH = showNote ? linesH(noteFit) : 0;
    if (showNote) {
      let ny = H - pad - noteH;
      for (const ln of noteFit.lines) {
        F.draw(ctx, ln, left, ny, { color: '#3a352c', scale: noteFit.scale, tracking: noteFit.scale });
        ny += F.lineHeight(noteFit.scale);
      }
    }
    let fy = H - pad - noteH - linesH(hintFit) - 4 * s;
    for (const ln of hintFit.lines) {
      F.draw(ctx, ln, left, fy, { color: BONE_FAINT, scale: hintFit.scale, tracking: hintFit.scale });
      fy += F.lineHeight(hintFit.scale);
    }

    this.upload();
  }

  /* (u, v) in 0..1 across the screen. */
  hitTest(u, v) {
    const x = u * this.W, y = v * this.H;
    for (const h of this.hits) {
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
    }
    return null;
  }
}

SATG.screens.FeedbackScreen = FeedbackScreen;

})(window);
