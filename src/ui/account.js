/* =========================================================================
   ui/account.js - Google sign-in, and the one piece of DOM in the game.

   Everything else here is drawn into a WebGL canvas. Google Identity Services
   will not work that way: it renders its own button, in its own iframe, and
   requires that the real element be visible and clickable. So this file owns a
   single absolutely-positioned <div> that is shown only on the stats page when
   nobody is signed in, and hidden the rest of the time.

   What sign-in does and does not do, stated plainly because it shapes every
   decision below:

     it DOES     decide which local record is being read and written, so two
                 people sharing a machine keep separate histories
     it DOES NOT move any data anywhere. Statistics live in this browser's
                 localStorage. Signing in on a second device shows an empty
                 history, and the stats screen says so rather than letting the
                 player believe their record was lost.

   The returned credential is a JWT, and its signature is NOT verified here.
   That is deliberate and safe in this design: the token is used only as a key
   into local storage, so the worst a forged one can do is let someone read
   data already sitting in their own browser, which they can read anyway. It
   would be badly wrong the moment any of this became a server record.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;

const GSI_SRC = 'https://accounts.google.com/gsi/client';
const HOST_ID = 'satg-signin';

const state = {
  status: 'idle',     // idle | loading | ready | unavailable | signedIn
  reason: null,       // why it is unavailable, in words the player can act on
  user: null,
  host: null,
  rendered: false,
  visible: false
};

function clientId() {
  const c = SATG.CONFIG || {};
  const id = c.googleClientId;
  if (!id || /YOUR_CLIENT_ID|PASTE|xxxx/i.test(id)) return null;
  return id;
}

/* Google will not accept file:// as an origin, and there is nothing to be done
   about that from here - so say which of the two situations the player is in
   rather than showing a button that silently fails. */
function originSupported() {
  return global.location && /^https?:$/.test(global.location.protocol);
}

function decodeJwt(token) {
  try {
    const part = String(token).split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64 + '==='.slice((b64.length + 3) % 4);
    const json = decodeURIComponent(
      atob(pad).split('').map((ch) =>
        '%' + ('00' + ch.charCodeAt(0).toString(16)).slice(-2)).join(''));
    return JSON.parse(json);
  } catch (e) { return null; }
}

function host() {
  if (state.host) return state.host;
  const el = document.createElement('div');
  el.id = HOST_ID;
  el.style.cssText = [
    'position:fixed', 'z-index:20', 'display:none',
    'left:50%', 'top:50%', 'transform:translate(-50%,-50%)',
    'padding:0', 'margin:0'
  ].join(';');
  document.body.appendChild(el);
  state.host = el;
  return el;
}

/* Where the button sits. The stats screen decides, in 0..1 screen space, and
   passes it here - keeping the layout in the screen that draws the rest of the
   page rather than hard-coding a position that would drift out of step. */
function place(u, v) {
  const el = host();
  el.style.left = (u * 100) + '%';
  el.style.top = (v * 100) + '%';
}

function show(visible) {
  const el = host();
  /* Only put the element on screen when a button could actually appear in it.
     Without a client id, or on file://, Google's script never runs and this
     stayed an empty <div> layered over the canvas - invisible, but real, and
     the sort of thing that turns into a mystery click-blocker later. The stats
     page explains the situation in text either way. */
  const possible = !!clientId() && originSupported();
  state.visible = !!visible && !state.user && possible;
  el.style.display = state.visible ? 'block' : 'none';
  if (state.visible) render();
}

function load() {
  if (state.status === 'loading' || state.status === 'ready' ||
      state.status === 'signedIn') return;

  if (!clientId()) {
    state.status = 'unavailable';
    state.reason = 'noClientId';
    return;
  }
  if (!originSupported()) {
    state.status = 'unavailable';
    state.reason = 'fileOrigin';
    return;
  }

  state.status = 'loading';
  const s = document.createElement('script');
  s.src = GSI_SRC;
  s.async = true;
  s.defer = true;
  s.onload = () => {
    if (!global.google || !google.accounts || !google.accounts.id) {
      state.status = 'unavailable';
      state.reason = 'blocked';
      return;
    }
    try {
      google.accounts.id.initialize({
        client_id: clientId(),
        callback: onCredential,
        auto_select: true,
        cancel_on_tap_outside: true
      });
      state.status = 'ready';
      if (state.visible) render();
    } catch (err) {
      state.status = 'unavailable';
      state.reason = 'blocked';
    }
  };
  // Offline, or an extension blocking third-party scripts. Both are ordinary.
  s.onerror = () => { state.status = 'unavailable'; state.reason = 'blocked'; };
  document.head.appendChild(s);
}

function render() {
  if (state.status !== 'ready' || state.rendered) return;
  try {
    google.accounts.id.renderButton(host(), {
      type: 'standard', theme: 'filled_black', size: 'large',
      text: 'signin_with', shape: 'rectangular', logo_alignment: 'left'
    });
    state.rendered = true;
  } catch (err) { /* leave it unrendered; the page still explains itself */ }
}

function onCredential(response) {
  const claims = decodeJwt(response && response.credential);
  if (!claims || !claims.sub) return;
  state.user = {
    id: claims.sub,
    name: claims.name || claims.given_name || 'PLAYER',
    email: claims.email || null,
    picture: claims.picture || null
  };
  state.status = 'signedIn';
  SATG.profile.setAccount(state.user);
  show(false);
  if (typeof state.onChange === 'function') state.onChange(state.user);
}

function signOut() {
  try {
    if (global.google && google.accounts && google.accounts.id) {
      google.accounts.id.disableAutoSelect();
    }
  } catch (e) { /* ignore */ }
  state.user = null;
  state.status = clientId() && originSupported() ? 'ready' : 'unavailable';
  state.rendered = false;
  if (state.host) state.host.innerHTML = '';
  SATG.profile.clearAccount();
  if (typeof state.onChange === 'function') state.onChange(null);
}

/* One sentence the stats screen can print. Every branch tells the player
   something they can act on, rather than "sign-in failed". */
function statusText() {
  if (state.user) return 'SIGNED IN AS ' + String(state.user.name).toUpperCase();

  /* The two blocking conditions are checked FIRST, before status.

     status is 'idle' until load() runs, and load() does not run until the
     stats page is opened - so reading status alone told an unconfigured build
     to promise "SIGN IN TO KEEP A RECORD" next to a button that was never
     going to appear. Whether a client id exists and whether the page is on
     http are both knowable at any moment, so answer from those. */
  if (!clientId())
    return 'SIGN-IN IS NOT CONFIGURED. ADD A GOOGLE CLIENT ID TO src/config.js';
  if (!originSupported())
    return 'SIGN-IN NEEDS A WEB ADDRESS. OPEN THE HOSTED PAGE RATHER THAN THE FILE';

  switch (state.status) {
    case 'loading': return 'CONTACTING GOOGLE...';
    case 'unavailable':
      return 'GOOGLE SIGN-IN COULD NOT LOAD. YOU MAY BE OFFLINE OR IT MAY BE BLOCKED';
    default: return 'SIGN IN TO KEEP A RECORD OF YOUR RESULTS';
  }
}

SATG.account = {
  load, show, place, signOut, statusText, decodeJwt,
  get user() { return state.user; },
  get status() { return state.status; },
  get reason() { return state.reason; },
  get configured() { return !!clientId(); },
  set onChange(fn) { state.onChange = fn; },
  /* Test seam. Sign-in cannot be driven from a script - it is an iframe owned
     by another origin - so the only way to check that everything downstream of
     a successful sign-in works is to hand it a credential directly. */
  _acceptCredential: onCredential
};

})(window);
