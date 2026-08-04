/* =========================================================================
   main.js - boot, event wiring, and the frame loop.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;

function fatal(message) {
  const el = document.getElementById('fatal');
  if (el) {
    el.style.display = 'grid';
    if (message) {
      const p = document.createElement('div');
      p.style.cssText = 'margin-top:18px;font-size:12px;opacity:.55;letter-spacing:1px';
      p.textContent = message;
      el.firstElementChild.appendChild(p);
    }
  }
  const c = document.getElementById('stage');
  if (c) c.style.display = 'none';
}

function boot() {
  // Printed first so a bug report always says which build produced it.
  console.log('[THE SAT GAME] build ' + SATG.BUILD + '  |  ' + navigator.userAgent);

  const canvas = document.getElementById('stage');
  if (!canvas) { fatal('Canvas element missing.'); return; }

  let pipeline;
  try {
    SATG.font.init();
    pipeline = new SATG.render.Pipeline(canvas);
  } catch (err) {
    console.error('[boot]', err);
    fatal(String(err && err.message ? err.message : err));
    return;
  }

  /* Decide how canvas surfaces get uploaded BEFORE anything uploads one, and
     say so out loud - on a machine I cannot reach, this line is the evidence
     for which path that browser took. */
  SATG.gl.chooseUploadRoute(pipeline.gl);
  console.log('[THE SAT GAME] upload route: ' + SATG.gl.uploadRoute +
              '  |  canvas readback ' + (SATG.gl.readbackTrusted ? 'trusted' : 'PERTURBED') +
              '  |  font: ' + (SATG.FONT_DATA ? 'baked atlas' : 'system fallback'));

  let game;
  try {
    const textures = SATG.textures.buildAll(pipeline.gl);
    game = new SATG.Game(pipeline, textures);
  } catch (err) {
    console.error('[boot]', err);
    fatal(String(err && err.message ? err.message : err));
    return;
  }

  global.SATG.instance = { pipeline, game };

  /* Must run at boot, not when the stats page opens.

     A clicked magic link lands on the game with the session in the URL
     fragment, and the fragment has to be consumed and scrubbed before anything
     else can navigate or the token sits in the address bar. Deferring this the
     way the Google button is deferred would mean the link only worked if the
     player happened to open STATS first. Costs nothing when cloud save is not
     configured, which is the default. */
  try { SATG.cloud.init(); } catch (err) { console.warn('[cloud]', err); }

  // Settings were read from storage at load time, but could not reach the
  // pipeline until it existed. This is that moment.
  SATG.settings.apply();

  /* ------------------------------------------------------------ input */

  // Normalise a pointer event to 0..1 across the canvas.
  function norm(e) {
    const r = canvas.getBoundingClientRect();
    return {
      u: r.width ? (e.clientX - r.left) / r.width : 0.5,
      v: r.height ? (e.clientY - r.top) / r.height : 0.5
    };
  }

  let lastX = 0, lastY = 0;

  canvas.addEventListener('pointermove', (e) => {
    const p = norm(e);
    game.onPointerMove(p.u, p.v, e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX; lastY = e.clientY;
  });

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const p = norm(e);
    lastX = e.clientX; lastY = e.clientY;
    if (canvas.setPointerCapture) {
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* non-fatal */ }
    }
    game.onPointerDown(p.u, p.v);
  });

  const releasePointer = (e) => {
    if (canvas.releasePointerCapture && e.pointerId !== undefined) {
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* non-fatal */ }
    }
    const p = norm(e);
    game.onPointerUp(p.u, p.v);
  };
  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    game.onWheel(e.deltaY);
  }, { passive: false });

  /* Pinch is the wheel, on a device that has no wheel. Routed through the same
     handler so zooming means one thing, implemented once. */
  SATG.touch.attachPinch(canvas, (dir, at) => {
    game.mouse.u = at.u;
    game.mouse.v = at.v;
    game.onWheel(dir * 100);
  });

  /* An orientation change resizes in two stages on most phones, and the first
     one reports the OLD dimensions. Resizing again on the next frame is what
     stops the game being letterboxed into half the screen until something else
     happens to trigger a resize. */
  global.addEventListener('orientationchange', () => {
    pipeline.resize();
    requestAnimationFrame(() => pipeline.resize());
  });

  // No context menu - a right click in the middle of an exam is never wanted.
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  global.addEventListener('keydown', (e) => {
    // Let the browser keep its own shortcuts.
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // Keys the game consumes would otherwise scroll or leave the page.
    if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
         'Backspace', '/', 'Tab', 'Home'].indexOf(e.key) !== -1) {
      e.preventDefault();
    }
    game.onKeyDown(e);
  });

  global.addEventListener('resize', () => pipeline.resize());

  // Losing focus mid-question should not cost the player the run.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      game.paused = true;
      SATG.audio.stopTension(true);
    } else {
      game.paused = false;
      game.panicStarted = false;
      SATG.audio.resume();
    }
  });

  /* ------------------------------------------------------------- loop */

  let last = performance.now();

  function frame(now) {
    const rawDt = (now - last) / 1000;
    last = now;

    // Clamp: a background tab, a breakpoint, or a GC pause must not advance
    // the exam clock by ten seconds and shoot the player.
    const dt = Math.min(Math.max(rawDt, 0), 1 / 20);

    if (!game.paused) {
      try {
        game.update(dt);
      } catch (err) {
        console.error('[update]', err);
      }
    }

    try {
      game.render();
    } catch (err) {
      console.error('[render]', err);
    }

    requestAnimationFrame(frame);
  }

  pipeline.resize();
  requestAnimationFrame(frame);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

})(window);
