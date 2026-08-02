/* =========================================================================
   net/cloud.js - sign in by email, and keep your record across devices.

   Why this exists
   ---------------
   Signing in and STORING something are different problems, and only the second
   one ever mattered here. The game already knew who you were once you signed in
   with Google; it still had nowhere to put your results, so a second device
   showed an empty history and the stats page had to say so. This file is the
   somewhere.

   Why Supabase, and why no SDK
   ----------------------------
   The whole project has no build step, no bundler and no dependencies, and runs
   from file:// as happily as from a web host. Supabase has a plain REST API, so
   it can be driven with fetch() and that property survives. Firebase would have
   meant shipping its SDK and giving that up.

   Why a magic link
   ----------------
   No password is ever typed, stored, or transmitted here, so there is no
   password for this game to leak. You get a one-time link by email; clicking it
   returns you to the game with a session. It also avoids the Google Cloud
   Console setup entirely.

   Local first, always
   -------------------
   src/sat/profile.js remains the source of truth. Everything works signed out
   and offline; the cloud is a copy that is pushed when possible and pulled when
   it has more than we do. A sync failure must never lose a local run, so the
   local store is never cleared by a pull - runs are merged, and ties go to
   whichever copy has more questions recorded.

   ------------------------------------------------------------------ SETUP

   Roughly five minutes, once.

   1. Create a free project at supabase.com. Any region; the nearest is fastest.

   2. In the SQL editor, run this. It makes the table and locks it down so a
      row can only ever be read or written by the account that owns it:

        create table public.runs (
          id          bigint generated always as identity primary key,
          user_id     uuid not null references auth.users on delete cascade,
          at          bigint not null,
          payload     jsonb not null,
          inserted_at timestamptz not null default now(),
          unique (user_id, at)
        );

        alter table public.runs enable row level security;

        create policy "own rows readable"
          on public.runs for select
          using (auth.uid() = user_id);

        create policy "own rows writable"
          on public.runs for insert
          with check (auth.uid() = user_id);

   3. Authentication > URL Configuration: set Site URL to wherever the game is
      served from, and add it under Redirect URLs too. For local testing that is
      http://localhost:5510. For GitHub Pages it is the Pages URL.

   4. Settings > API: copy the Project URL and the `anon` `public` key into
      src/config.js.

      The anon key is MEANT to be public - it identifies the project, not you,
      and Row Level Security above is what actually protects the data. The
      `service_role` key is the opposite: it bypasses every policy. It must
      never appear in this repo, in config.js, or anywhere a browser can see it.

   5. Authentication > Providers: Email is on by default. Nothing else needed.

   Until steps 1-4 are done, everything here reports "not configured" and the
   game behaves exactly as it does today.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;

const SESSION_KEY = 'satgame.cloud.session.v1';

/* Supabase access tokens are short-lived and come with a refresh token. A
   minute of slack avoids using one that expires in transit. */
const EXPIRY_SLACK_MS = 60 * 1000;

let session = null;      // { access_token, refresh_token, expires_at, user }
let status = 'idle';     // idle | sending | sent | signedIn | error
let message = '';
let syncing = false;
let lastSync = null;

function cfg() {
  // SATG.CONFIG, not SATG.config - the rest of the project reads it that way.
  const c = SATG.CONFIG || {};
  return { url: (c.supabaseUrl || '').replace(/\/+$/, ''), key: c.supabaseAnonKey || '' };
}

function configured() {
  const { url, key } = cfg();
  return !!(url && key);
}

/* ------------------------------------------------------------- session io */

function loadSession() {
  try {
    const raw = global.localStorage && global.localStorage.getItem(SESSION_KEY);
    session = raw ? JSON.parse(raw) : null;
  } catch (e) { session = null; }
  if (session && !session.access_token) session = null;
  if (session) status = 'signedIn';
  return session;
}

function saveSession(s) {
  session = s || null;
  try {
    if (!global.localStorage) return;
    if (session) global.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else global.localStorage.removeItem(SESSION_KEY);
  } catch (e) { /* private mode; the session simply will not persist */ }
}

function expired() {
  if (!session || !session.expires_at) return false;
  return Date.now() > session.expires_at * 1000 - EXPIRY_SLACK_MS;
}

/* --------------------------------------------------------------- requests */

async function api(path, opts) {
  const { url, key } = cfg();
  if (!url || !key) throw new Error('cloud is not configured');
  opts = opts || {};
  const headers = Object.assign({
    'apikey': key,
    'Content-Type': 'application/json'
  }, opts.headers || {});
  if (opts.auth && session && session.access_token) {
    headers['Authorization'] = 'Bearer ' + session.access_token;
  }
  const res = await global.fetch(url + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!res.ok) {
    const msg = (data && (data.msg || data.message || data.error_description)) ||
                ('HTTP ' + res.status);
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ------------------------------------------------------------------ auth */

/* Ask for a magic link. The address is sent to Supabase and nowhere else, and
   nothing is stored locally until the returned link is actually clicked. */
async function sendLink(email) {
  if (!configured()) { status = 'error'; message = 'CLOUD IS NOT SET UP - SEE src/config.js'; return false; }
  email = String(email || '').trim();
  /* Deliberately loose: the only authority on whether an address is real is
     whether the mail arrives, and a clever regex mostly rejects valid ones. */
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    status = 'error'; message = 'THAT DOES NOT LOOK LIKE AN EMAIL ADDRESS';
    return false;
  }
  status = 'sending'; message = 'SENDING...';
  try {
    await api('/auth/v1/otp', {
      method: 'POST',
      body: { email: email, create_user: true,
              options: { email_redirect_to: redirectTarget() } }
    });
    status = 'sent';
    message = 'CHECK ' + email + ' FOR A SIGN-IN LINK. IT OPENS THE GAME BACK UP.';
    return true;
  } catch (e) {
    status = 'error';
    message = 'COULD NOT SEND: ' + String(e.message || e).toUpperCase();
    return false;
  }
}

/* Where the emailed link should come back to. file:// cannot be a redirect
   target, so say so rather than sending a link that cannot work. */
function redirectTarget() {
  const loc = global.location;
  if (!loc || loc.protocol === 'file:') return null;
  return loc.origin + loc.pathname;
}

/* Supabase returns the session in the URL fragment. Consume it and scrub the
   address bar, so a shared or bookmarked URL never carries a live token. */
function consumeRedirect() {
  const loc = global.location;
  if (!loc || !loc.hash || loc.hash.length < 2) return false;
  const p = new global.URLSearchParams(loc.hash.slice(1));
  const access = p.get('access_token');
  if (!access) {
    /* Supabase reports link failures the same way - in the fragment - and an
       expired link is the single most likely outcome worth explaining. */
    const err = p.get('error_description') || p.get('error');
    if (err) {
      status = 'error';
      message = String(err).replace(/\+/g, ' ').toUpperCase();
      scrubHash();
      return true;
    }
    return false;
  }
  saveSession({
    access_token: access,
    refresh_token: p.get('refresh_token') || null,
    expires_at: Number(p.get('expires_at')) || 0,
    user: null
  });
  status = 'signedIn';
  message = 'SIGNED IN.';
  scrubHash();
  return true;
}

function scrubHash() {
  try {
    if (global.history && global.history.replaceState) {
      global.history.replaceState(null, '', global.location.pathname + global.location.search);
    }
  } catch (e) { /* not important enough to fail sign-in over */ }
}

async function refresh() {
  if (!session || !session.refresh_token) return false;
  try {
    const d = await api('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', body: { refresh_token: session.refresh_token }
    });
    saveSession({
      access_token: d.access_token,
      refresh_token: d.refresh_token || session.refresh_token,
      expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
      user: d.user || session.user
    });
    return true;
  } catch (e) {
    /* A refresh token that no longer works means the session is over. Drop it
       rather than retrying forever against a dead credential. */
    saveSession(null);
    status = 'idle';
    message = 'SESSION EXPIRED - SIGN IN AGAIN.';
    return false;
  }
}

async function loadUser() {
  if (!session) return null;
  if (expired() && !(await refresh())) return null;
  try {
    const u = await api('/auth/v1/user', { auth: true });
    session.user = u;
    saveSession(session);
    return u;
  } catch (e) { return null; }
}

function signOut() {
  saveSession(null);
  status = 'idle';
  message = '';
  /* The local record is deliberately NOT cleared. Signing out is not "delete
     my practice history", and treating it that way once already looked exactly
     like data loss. */
  SATG.profile.clearAccount();
  return true;
}

/* ------------------------------------------------------------------ sync */

function userId() {
  return session && session.user ? session.user.id : null;
}

/* Push every local run the cloud does not have, then pull anything it has that
   we do not. `at` is the run's timestamp and is unique per user, so the same
   run cannot be stored twice even if a push is retried. */
async function sync() {
  if (!configured() || !session || syncing) return { ok: false, reason: 'not ready' };
  syncing = true;
  try {
    if (expired() && !(await refresh())) return { ok: false, reason: 'session expired' };
    const u = session.user || await loadUser();
    if (!u) return { ok: false, reason: 'no user' };

    SATG.profile.setAccount({ id: u.id, email: u.email, name: u.email });

    const local = SATG.profile.currentAccount().runs || [];
    const remote = await api('/rest/v1/runs?select=at,payload&order=at.asc', { auth: true });
    const remoteAt = new Set((remote || []).map((r) => Number(r.at)));
    const localAt = new Set(local.map((r) => Number(r.at)));

    const toPush = local.filter((r) => !remoteAt.has(Number(r.at)));
    if (toPush.length) {
      await api('/rest/v1/runs?on_conflict=user_id,at', {
        method: 'POST', auth: true,
        headers: { 'Prefer': 'resolution=ignore-duplicates,return=minimal' },
        body: toPush.map((r) => ({ user_id: u.id, at: r.at, payload: r }))
      });
    }

    const toPull = (remote || []).filter((r) => !localAt.has(Number(r.at)));
    if (toPull.length) SATG.profile.mergeRuns(toPull.map((r) => r.payload));

    lastSync = Date.now();
    return { ok: true, pushed: toPush.length, pulled: toPull.length,
             total: local.length + toPull.length };
  } catch (e) {
    return { ok: false, reason: String(e.message || e) };
  } finally {
    syncing = false;
  }
}

/* --------------------------------------------------------------- exports */

function statusText() {
  if (!configured()) return 'CLOUD SAVE NOT SET UP - RESULTS STAY IN THIS BROWSER';
  if (status === 'signedIn') {
    const who = session && session.user ? session.user.email : 'SIGNED IN';
    return String(who).toUpperCase() +
           (lastSync ? '   SYNCED' : '   NOT YET SYNCED');
  }
  if (message) return message;
  return 'SIGN IN BY EMAIL TO KEEP RESULTS ACROSS DEVICES';
}

/* Called once at boot: pick up a session from a clicked link, or restore the
   one already stored, then sync in the background. Never blocks the game. */
function init() {
  if (!configured()) return;
  const fromLink = consumeRedirect();
  if (!fromLink) loadSession();
  if (session) {
    loadUser().then((u) => { if (u) sync(); });
  }
}

/* ------------------------------------------------------------------- panel

   A real DOM form, for the same reason the printable report is real DOM: a
   canvas cannot host a text field, and an email address typed into a fake one
   would have to reimplement selection, clipboard, autofill and the on-screen
   keyboard. The panel is created on demand and destroyed on hide, never left
   hidden - a full-width invisible element over the canvas would swallow the
   clicks the game needs. */
const PANEL_ID = 'satg-cloud-panel';
let panel = null;

function panelCSS() {
  return '#' + PANEL_ID + '{position:fixed;z-index:60;transform:translate(-50%,0);' +
    'font:12px/1.5 "Courier New",monospace;color:#d9d2c4;text-align:center;' +
    'letter-spacing:1px;text-transform:uppercase;width:min(92vw,420px)}' +
    '#' + PANEL_ID + ' form{display:flex;gap:6px;justify-content:center}' +
    '#' + PANEL_ID + ' input{flex:1 1 auto;min-width:0;background:#0d0b09;' +
    'border:1px solid #4f4a42;color:#d9d2c4;font:inherit;text-transform:none;' +
    'padding:7px 9px;border-radius:2px}' +
    '#' + PANEL_ID + ' input:focus{outline:none;border-color:#8e8779}' +
    '#' + PANEL_ID + ' button{background:#191713;border:1px solid #4f4a42;' +
    'color:#d9d2c4;font:inherit;letter-spacing:1px;text-transform:uppercase;' +
    'padding:7px 12px;cursor:pointer;border-radius:2px;white-space:nowrap}' +
    '#' + PANEL_ID + ' button:hover{background:#241f1a}' +
    '#' + PANEL_ID + ' button:focus-visible{outline:2px solid #6fb7d8;outline-offset:2px}' +
    '#' + PANEL_ID + ' p{margin:7px 0 0;color:#8e8779;font-size:11px}';
}

function showPanel(u, v, onChange) {
  hidePanel();
  if (!configured()) return null;
  const d = global.document;
  panel = d.createElement('div');
  panel.id = PANEL_ID;
  const style = d.createElement('style');
  style.textContent = panelCSS();
  panel.appendChild(style);

  const body = d.createElement('div');
  if (session) {
    body.innerHTML = '<form><button type="button" data-act="sync">SYNC NOW</button>' +
      '<button type="button" data-act="out">SIGN OUT</button></form>' +
      '<p data-role="msg"></p>';
  } else if (!redirectTarget()) {
    /* An emailed link cannot return to a file:// page, so offering the form
       would be offering something that provably cannot work. */
    body.innerHTML = '<p>OPEN THE GAME OVER HTTP TO SIGN IN.<br>' +
      'RUN <span style="text-transform:none">python serve.py</span> ' +
      'OR USE THE HOSTED COPY.</p>';
  } else {
    body.innerHTML = '<form><input type="email" name="email" ' +
      'placeholder="you@example.com" autocomplete="email" spellcheck="false">' +
      '<button type="submit">EMAIL ME A LINK</button></form>' +
      '<p data-role="msg"></p>';
  }
  panel.appendChild(body);

  const msg = () => panel && panel.querySelector('[data-role="msg"]');
  const say = (t) => { const m = msg(); if (m) m.textContent = t; };
  say(message || '');

  const form = body.querySelector('form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = form.querySelector('input[name="email"]');
      if (!input) return;
      say('SENDING...');
      await sendLink(input.value);
      say(message);
      if (onChange) onChange();
    });
  }
  body.addEventListener('click', async (e) => {
    const b = e.target.closest ? e.target.closest('button[data-act]') : null;
    if (!b) return;
    if (b.dataset.act === 'out') { signOut(); hidePanel(); if (onChange) onChange(); return; }
    if (b.dataset.act === 'sync') {
      say('SYNCING...');
      const r = await sync();
      say(r.ok ? ('SYNCED - ' + r.pushed + ' UP, ' + r.pulled + ' DOWN')
               : ('SYNC FAILED: ' + String(r.reason).toUpperCase()));
      if (onChange) onChange();
    }
  });

  /* Keys typed here must not reach the game, or every letter of an address
     would also be an answer keystroke. */
  panel.addEventListener('keydown', (e) => e.stopPropagation());

  place(u, v);
  d.body.appendChild(panel);
  return panel;
}

function place(u, v) {
  if (!panel) return;
  panel.style.left = (u * 100) + '%';
  panel.style.top = (v * 100) + '%';
}

function hidePanel() {
  if (!panel) return false;
  if (panel.parentNode) panel.parentNode.removeChild(panel);
  panel = null;
  return true;
}

SATG.cloud = {
  init, configured, sendLink, signOut, sync, statusText,
  showPanel, hidePanel, place,
  consumeRedirect, refresh, loadUser,
  get session() { return session; },
  get signedIn() { return !!session; },
  get status() { return status; },
  get message() { return message; },
  get email() { return session && session.user ? session.user.email : null; },
  get lastSync() { return lastSync; }
};

})(window);
