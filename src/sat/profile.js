/* =========================================================================
   sat/profile.js - what the player has done, across every run.

   Storage is local (one browser, one machine). Sign-in decides WHOSE record is
   being read and written, not where it lives: signing in on a second device
   shows an empty history, and the stats screen says so rather than letting the
   player think their record was lost.

   Everything on the stats screen is derived from one flat list of finished
   runs. Aggregates are recomputed on read instead of being maintained
   incrementally, because a counter that drifts out of step with the list it
   summarises is a bug you cannot see - and reading happens once, when a screen
   opens, over a list that is a few hundred entries at worst.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;

const KEY = 'satgame.profile.v1';

/* The record used when nobody is signed in. It is kept and merged into the
   first account that signs in on this browser, so a session played before
   signing in is not thrown away. */
const LOCAL_ID = '__local';

/* A run is only worth keeping if it produced something to measure. */
const MAX_RUNS = 400;

let db = null;
let currentId = LOCAL_ID;

function blank() { return { version: 1, accounts: {} }; }

function load() {
  try {
    const raw = global.localStorage && global.localStorage.getItem(KEY);
    db = raw ? JSON.parse(raw) : null;
  } catch (e) { db = null; }
  if (!db || typeof db !== 'object' || !db.accounts) db = blank();
  return db;
}

function save() {
  try {
    if (global.localStorage) global.localStorage.setItem(KEY, JSON.stringify(db));
  } catch (e) { /* private mode or quota - the session still works */ }
}

function account(id) {
  if (!db) load();
  const key = id || currentId;
  if (!db.accounts[key]) {
    db.accounts[key] = { id: key, name: null, email: null, picture: null,
                         createdAt: Date.now(), runs: [] };
  }
  return db.accounts[key];
}

/* Point the store at a signed-in identity. The anonymous record is folded in
   the first time a real account appears, and only once. */
function setAccount(user) {
  if (!db) load();
  if (!user) { currentId = LOCAL_ID; return account(); }
  const a = account(user.id);
  a.name = user.name || a.name;
  a.email = user.email || a.email;
  a.picture = user.picture || a.picture;

  /* Runs played before signing in are copied into the account, not moved.

     Deleting the anonymous record was tidier and much worse to use: play a few
     rounds, sign in, sign out, and your history appears to have been wiped.
     It was not - it had been reattributed - but nothing on screen could say
     so. Copying costs a few kilobytes and means signing out shows you exactly
     what signing in showed you. */
  const local = db.accounts[LOCAL_ID];
  if (local && local.runs.length && !a.mergedLocal) {
    a.runs = local.runs.concat(a.runs)
      .sort((x, y) => x.at - y.at)
      .slice(-MAX_RUNS);
    a.mergedLocal = true;
  }
  currentId = user.id;
  save();
  return a;
}

function clearAccount() { currentId = LOCAL_ID; }

function currentAccount() { return account(); }

/* ---------------------------------------------------------------- record */

function tally(map) {
  const out = {};
  for (const k of Object.keys(map || {})) {
    out[k] = { right: map[k].right | 0, total: map[k].total | 0 };
  }
  return out;
}

/* Turn the array-of-objects a results screen wants into the plain map a run
   record stores. */
function fromRanked(list) {
  const out = {};
  for (const e of list || []) {
    const key = e.domain || e.skill;
    if (!key) continue;
    const entry = { right: e.right | 0, total: e.total | 0 };
    // Skills carry their section; domains do not need to, because the domain
    // name itself identifies the section.
    if (e.section) entry.section = e.section;
    out[key] = entry;
  }
  return out;
}

/* `result` is exactly what the results screen was handed - either a graded
   exam form or the Infinity summary. */
function record(result) {
  if (!result) return null;
  const a = account();
  const infinity = result.kind === 'infinity';

  const run = {
    at: Date.now(),
    kind: infinity ? 'infinity' : (result.isFull ? 'full' : 'module'),
    section: result.mode ? result.mode.section : 'both',
    label: result.modeLabel || '',
    reason: result.reason || null,
    elapsed: Math.round(result.elapsed || 0),
    domains: fromRanked(result.perDomain),
    skills: fromRanked(result.perSkill)
  };

  if (infinity) {
    run.cleared = result.cleared | 0;
  } else {
    run.scaled = result.totalScaled | 0;
    run.raw = result.rawTotal | 0;
    run.of = result.totalQuestions | 0;
    run.answered = result.answered | 0;
    run.sections = (result.sections || []).map((s) => ({
      section: s.section, raw: s.raw, total: s.total, scaled: s.scaled,
      route: s.route || null, capped: !!s.capped
    }));
  }

  a.runs.push(run);
  if (a.runs.length > MAX_RUNS) a.runs = a.runs.slice(-MAX_RUNS);
  save();
  return run;
}

/* ------------------------------------------------------------- aggregate */

const SECTION_OF_DOMAIN = {};
(function buildDomainIndex() {
  const M = SATG.mathQuestions && SATG.mathQuestions.domains;
  const V = SATG.verbalQuestions && SATG.verbalQuestions.domains;
  for (const k in M) SECTION_OF_DOMAIN[M[k]] = 'math';
  for (const k in V) SECTION_OF_DOMAIN[V[k]] = 'rw';
})();

function inScope(domain, scope) {
  if (scope === 'overall') return true;
  return SECTION_OF_DOMAIN[domain] === scope;
}

/* Everything the stats screen draws, for one of the three tabs.
   `scope` is 'rw', 'math' or 'overall'. */
function summary(scope) {
  const a = account();
  const runs = a.runs || [];
  scope = scope || 'overall';

  const domains = {};
  const skills = {};
  let right = 0, total = 0;
  /* Counted per tab, not per profile. "RUNS FINISHED 5" on the ENGLISH tab
     when only three of them contained any English is the page contradicting
     its own heading - every other number on that tab is scoped, so these two
     have to be as well. */
  let scopedRuns = 0, scopedTests = 0;

  const add = (into, key, e) => {
    const s = into[key] || (into[key] = { right: 0, total: 0, section: null });
    s.right += e.right; s.total += e.total;
    if (!s.section && e.section) s.section = e.section;
  };

  for (const r of runs) {
    let touched = false;
    for (const d of Object.keys(r.domains || {})) {
      if (!inScope(d, scope)) continue;
      touched = true;
      add(domains, d, r.domains[d]);
      right += r.domains[d].right;
      total += r.domains[d].total;
    }
    if (touched) {
      scopedRuns++;
      if (r.kind !== 'infinity') scopedTests++;
    }
    /* Skills carry their own section, so they can be filed exactly - including
       for a full SAT, where the run itself contains both.

       An older run, recorded before skills were tagged, has no section on it.
       Rather than drop it, fall back to the run's own shape: a single-section
       run can only have contributed skills from that section. A full SAT
       recorded back then genuinely cannot be split, so its skills stay on the
       OVERALL tab and nowhere else - which is the honest outcome. */
    for (const k of Object.keys(r.skills || {})) {
      const e = r.skills[k];
      if (scope !== 'overall') {
        const sec = e.section ||
          (r.section === 'rw' || r.section === 'math' ? r.section : null);
        if (sec !== scope) continue;
      }
      add(skills, k, e);
    }
  }

  const rank = (map, nameKey) => Object.keys(map).map((k) => {
    const e = map[k];
    const o = { right: e.right, total: e.total, pct: e.total ? e.right / e.total : 0,
                section: e.section || null };
    o[nameKey] = k;
    return o;
  }).sort((x, y) => y.pct - x.pct || y.total - x.total);

  const domainRank = rank(domains, 'domain');
  const skillRank = rank(skills, 'skill');

  // Infinity records.
  const infinityRuns = runs.filter((r) => r.kind === 'infinity' &&
    (scope === 'overall' || r.section === scope));
  const bestStreak = infinityRuns.reduce((m, r) => Math.max(m, r.cleared || 0), 0);
  const longestTime = infinityRuns.reduce((m, r) => Math.max(m, r.elapsed || 0), 0);

  // Scored tests, newest last - and only those that contain this tab's
  // section, so the ENGLISH tab does not list a Math-only module.
  const scored = runs.filter((r) => r.kind !== 'infinity' &&
    (scope === 'overall' ||
     Object.keys(r.domains || {}).some((d) => inScope(d, scope))));
  const tests = scored.map((r) => ({
    at: r.at, kind: r.kind, label: r.label, scaled: r.scaled,
    raw: r.raw, of: r.of, sections: r.sections || []
  }));

  const sectionBest = { rw: 0, math: 0 };
  for (const r of scored) {
    for (const s of r.sections || []) {
      if (s.scaled > (sectionBest[s.section] || 0)) sectionBest[s.section] = s.scaled;
    }
  }
  const bestTotal = scored.filter((r) => r.kind === 'full')
    .reduce((m, r) => Math.max(m, r.scaled || 0), 0);

  return {
    scope,
    signedIn: currentId !== LOCAL_ID,
    name: a.name, email: a.email,
    runCount: scopedRuns,
    testCount: scopedTests,
    /* The whole-profile figure, kept separately so the empty-page test does
       not fire on a tab that simply has nothing in it yet - "no results" and
       "no ENGLISH results" are different sentences. */
    totalRunCount: runs.length,
    answered: total, correct: right,
    accuracy: total ? right / total : 0,
    domains: domainRank,
    skills: skillRank,
    strengths: domainRank.filter((d) => d.total >= 4 && d.pct >= 0.7).slice(0, 3),
    weaknesses: domainRank.slice().reverse()
                          .filter((d) => d.total >= 4 && d.pct < 0.7).slice(0, 3),
    bestStreak, longestTime, tests, sectionBest, bestTotal,
    trend: trend()
  };
}

/* Three series for the improvement chart.

   English and Math are the section scores of every scored run, in order.
   OVERALL is the estimated composite: the most recent English score plus the
   most recent Math score at that point in time. It cannot start until both
   exist, and it is an estimate rather than a real total whenever the two
   halves came from different sittings - which the screen says out loud. */
function trend() {
  const a = account();
  const rw = [], math = [], overall = [];
  let lastRw = null, lastMath = null;

  for (const r of a.runs || []) {
    if (r.kind === 'infinity' || !r.sections) continue;
    let touched = false;
    for (const s of r.sections) {
      if (s.section === 'rw')   { lastRw = s.scaled;   rw.push({ at: r.at, v: s.scaled }); touched = true; }
      if (s.section === 'math') { lastMath = s.scaled; math.push({ at: r.at, v: s.scaled }); touched = true; }
    }
    if (touched && lastRw !== null && lastMath !== null) {
      overall.push({ at: r.at, v: lastRw + lastMath, exact: r.kind === 'full' });
    }
  }
  return { rw, math, overall };
}

function reset() {
  if (!db) load();
  delete db.accounts[currentId];
  save();
}

load();

SATG.profile = {
  LOCAL_ID, load, save, record, summary, trend, reset,
  setAccount, clearAccount, currentAccount,
  get accountId() { return currentId; },
  get signedIn() { return currentId !== LOCAL_ID; }
};

})(window);
