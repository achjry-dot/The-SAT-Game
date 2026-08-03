/* =========================================================================
   ui/touch.js - the two things a phone cannot do without.

   The game was built for a mouse and a keyboard. Most of that translates for
   free: pointer events already cover touch, and dragging to scroll is handled
   in the game's own input path. Two things do not translate at all, and both
   of them make a phone unable to finish a test rather than merely awkward.

   1. TYPING. A quarter of the Math section is student-produced response - you
      type the number. A phone has no keyboard until something asks for one, and
      a canvas never does. Without this, those questions cannot be answered at
      all.

      The fix is the standard one: a real <input> the browser can attach its
      keyboard to, positioned over the answer box but invisible, mirroring what
      is typed into the sheet. It is created only when a grid-in question is
      touched and destroyed the moment focus leaves - an input left lying over
      the canvas would swallow every tap meant for the game, which is the exact
      failure the sign-in panel had.

   2. PINCHING. The sheet can be zoomed with a wheel. There is no wheel on a
      phone, and a 150-word passage on a five-inch screen is the single hardest
      thing to read in the game.

   Neither is gated on "is this a phone". Feature detection decides: a laptop
   with a touchscreen gets both and loses nothing, and a phone that reports
   itself oddly still works. Nothing here changes desktop behaviour.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;

const state = {
  input: null,        // the live <input>, or null
  onCommit: null,
  pinch: null         // { d0, zoom0 } while two fingers are down
};

/* Does this device have a coarse pointer? Used only to decide whether to
   OFFER the keyboard, never to withhold anything. */
function isTouch() {
  return (global.matchMedia && global.matchMedia('(pointer: coarse)').matches) ||
         ('ontouchstart' in global) ||
         (global.navigator && global.navigator.maxTouchPoints > 0);
}

/* ------------------------------------------------------------ text entry */

/**
 * Ask the browser for a numeric keyboard and mirror what is typed.
 *
 * @param {string} initial   what is already in the answer box
 * @param {object} rect      {x,y,w,h} in 0..1 canvas coordinates, so the input
 *                           sits under the box it is standing in for - some
 *                           browsers scroll the focused element into view, and
 *                           one placed at the origin drags the whole page.
 * @param {function} onChange called with each new value
 * @param {function} onDone   called when the field is dismissed
 */
function openNumericInput(initial, rect, onChange, onDone) {
  closeNumericInput();
  const el = document.createElement('input');
  el.type = 'text';
  /* `decimal`, not `numeric`: grid-ins accept a minus sign and a slash, and
     `numeric` hides both on most phones. The paper still filters every
     character, so nothing invalid can reach the answer either way. */
  el.inputMode = 'decimal';
  el.autocapitalize = 'off';
  el.autocomplete = 'off';
  el.spellcheck = false;
  el.value = initial || '';
  el.setAttribute('aria-label', 'Answer');

  const canvas = document.getElementById('stage');
  const r = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
  el.style.cssText =
    'position:fixed;z-index:5;' +
    'left:' + (r.left + rect.x * r.width) + 'px;' +
    'top:' + (r.top + rect.y * r.height) + 'px;' +
    'width:' + Math.max(40, rect.w * r.width) + 'px;' +
    'height:' + Math.max(28, rect.h * r.height) + 'px;' +
    /* Transparent rather than hidden. The sheet already draws the box and the
       digits; this only has to be where the keyboard points at. `opacity:0`
       keeps it focusable, which `visibility:hidden` and `display:none` do
       not - a field the browser considers invisible cannot take focus, and no
       keyboard appears. */
    'opacity:0;border:0;padding:0;margin:0;background:transparent;' +
    'font-size:16px;';           // under 16px, iOS zooms the whole page on focus

  document.body.appendChild(el);
  state.input = el;
  state.onCommit = onDone || null;

  el.addEventListener('input', () => { if (onChange) onChange(el.value); });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); closeNumericInput(true); }
  });
  el.addEventListener('blur', () => closeNumericInput(true));

  // Focus after insertion, or Safari ignores it.
  global.setTimeout(() => { try { el.focus(); el.select(); } catch (err) { /* fine */ } }, 0);
  return el;
}

function closeNumericInput(commit) {
  const el = state.input;
  if (!el) return false;
  state.input = null;
  const done = state.onCommit;
  state.onCommit = null;
  try { el.remove(); } catch (err) { /* already gone */ }
  if (commit && done) done();
  return true;
}

function inputOpen() { return !!state.input; }

/* -------------------------------------------------------------- pinching */

/* Two-finger zoom, wired to the same zoom the wheel drives so there is one
   implementation of what zooming means. Registered on the canvas by main.js. */
function attachPinch(canvas, onZoom) {
  if (!canvas) return;
  const dist = (t) => {
    const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };
  const mid = (t) => {
    const r = canvas.getBoundingClientRect();
    return {
      u: r.width ? ((t[0].clientX + t[1].clientX) / 2 - r.left) / r.width : 0.5,
      v: r.height ? ((t[0].clientY + t[1].clientY) / 2 - r.top) / r.height : 0.5
    };
  };

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) return;
    state.pinch = { d0: dist(e.touches) };
  }, { passive: true });

  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2 || !state.pinch) return;
    e.preventDefault();
    const d = dist(e.touches);
    if (!state.pinch.d0) { state.pinch.d0 = d; return; }
    const ratio = d / state.pinch.d0;
    /* A threshold, so the small amount two fingers drift while a page is being
       dragged does not read as a pinch. */
    if (Math.abs(ratio - 1) < 0.06) return;
    state.pinch.d0 = d;
    onZoom(ratio < 1 ? 1 : -1, mid(e.touches));   // same sign convention as wheel
  }, { passive: false });

  const end = () => { state.pinch = null; };
  canvas.addEventListener('touchend', end, { passive: true });
  canvas.addEventListener('touchcancel', end, { passive: true });
}

SATG.touch = {
  isTouch, openNumericInput, closeNumericInput, inputOpen, attachPinch,
  get pinching() { return !!state.pinch; }
};

})(window);
