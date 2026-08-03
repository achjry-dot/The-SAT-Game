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
const { clamp } = SATG.util;

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

/* Returns whether the write actually landed. Callers that only add a few bytes
   can ignore it; saveReview() cannot, because a saved review that silently
   failed to save is the one kind of loss the player would never notice until
   they went looking for it. */
function save() {
  try {
    if (!global.localStorage) return false;
    global.localStorage.setItem(KEY, JSON.stringify(db));
    return true;
  } catch (e) {
    /* Private mode, or the quota is full. The session still works. */
    return false;
  }
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
    const key = e.domain || e.skill || e.qtype || e.difficulty;
    if (!key) continue;
    const entry = { right: e.right | 0, total: e.total | 0 };
    // Skills and question types carry their section; domains do not need to,
    // because the domain name itself identifies the section.
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
    skills: fromRanked(result.perSkill),
    /* Question type is the level the analysis report is keyed on, and keeping
       it per run is what lets a later screen draw a per-type trend rather than
       only a snapshot of the run just finished. */
    qtypes: fromRanked(result.perQType),
    difficulty: fromRanked(result.perDifficulty)
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

/* Fold runs from another device into this account.

   Additive only. A pull must never be able to remove a run that exists here:
   the local store is the source of truth and the cloud is a copy of it, so the
   worst a bad sync can do is add a duplicate - and `at`, the run's timestamp,
   makes even that impossible. Runs already present win, because the local copy
   is the one that was actually played on this machine. */
function mergeRuns(incoming) {
  if (!incoming || !incoming.length) return { added: 0 };
  const a = account();
  if (!a.runs) a.runs = [];
  const have = new Set(a.runs.map((r) => Number(r.at)));
  let added = 0;
  for (const r of incoming) {
    if (!r || typeof r.at !== 'number' || have.has(Number(r.at))) continue;
    have.add(Number(r.at));
    a.runs.push(r);
    added++;
  }
  if (added) {
    a.runs.sort((x, y) => x.at - y.at);
    /* The cap is applied after merging, so the newest history survives rather
       than whichever device happened to sync first. */
    if (a.runs.length > MAX_RUNS) a.runs = a.runs.slice(-MAX_RUNS);
    save();
  }
  return { added, total: a.runs.length };
}

/* ---------------------------------------------------------- saved reviews

   A run's aggregate numbers are recorded automatically and cost a few hundred
   bytes. A REVIEW is different: to reopen it later the per-question detail has
   to survive, and a full SAT is 98 questions carrying stems, answers and
   explanations. Keeping one for all 400 remembered runs would be several
   megabytes and would blow the localStorage quota, at which point every later
   write fails - including the cheap ones.

   So reviews are opt-in, capped, and the oldest is dropped to make room. The
   cap is reported back to the caller rather than enforced silently, because
   quietly deleting somebody's saved report is exactly the kind of data loss
   that destroys trust in a tool like this. */
const MAX_REVIEWS = 12;

function saveReview(result) {
  if (!result) return { ok: false, reason: 'nothing to save' };
  const a = account();
  if (!a.reviews) a.reviews = [];

  const review = {
    at: Date.now(),
    kind: result.kind === 'infinity' ? 'infinity' : (result.isFull ? 'full' : 'module'),
    label: result.modeLabel || '',
    section: result.mode ? result.mode.section : 'both',
    elapsed: Math.round(result.elapsed || 0),
    scaled: result.totalScaled | 0,
    isFull: !!result.isFull,
    rawTotal: result.rawTotal | 0,
    totalQuestions: result.totalQuestions | 0,
    answered: result.answered | 0,
    cleared: result.cleared | 0,
    sections: (result.sections || []).map((s) => ({
      section: s.section, raw: s.raw, total: s.total, scaled: s.scaled,
      route: s.route || null, capped: !!s.capped
    })),
    perDomain: result.perDomain || [],
    perSkill: result.perSkill || [],
    perQType: result.perQType || [],
    perDifficulty: result.perDifficulty || [],
    items: result.items || []
  };
  /* Not stored. The items carry their own seconds, and pacing() derives
     everything else from them - so recomputing on read costs nothing and
     cannot fall out of step with the items it describes. */

  a.reviews.push(review);
  let dropped = 0;
  while (a.reviews.length > MAX_REVIEWS) { a.reviews.shift(); dropped++; }

  if (!save()) {
    /* The write failed, which on this storage almost always means the quota is
       full. Shed the oldest reviews and try again rather than reporting
       success for something that is not there. */
    let shed = 0;
    while (a.reviews.length > 1 && !save()) { a.reviews.shift(); shed++; dropped++; }
    if (!save()) {
      a.reviews.pop();
      save();
      return { ok: false, dropped, limit: MAX_REVIEWS, reason: 'storage full' };
    }
  }
  return { ok: true, dropped, limit: MAX_REVIEWS, count: a.reviews.length };
}

/* Saved reviews, newest first - the order a history list wants. */
function reviews() {
  const a = account();
  return (a.reviews || []).slice().reverse();
}

function review(at) {
  const a = account();
  return (a.reviews || []).find((r) => r.at === at) || null;
}

function deleteReview(at) {
  const a = account();
  if (!a.reviews) return false;
  const i = a.reviews.findIndex((r) => r.at === at);
  if (i < 0) return false;
  a.reviews.splice(i, 1);
  save();
  return true;
}

/* ------------------------------------------------- reopening a saved review

   A review is stored under its own field names and the analysis screen reads a
   run's, so one of them has to convert. Doing it here rather than teaching the
   screen two vocabularies keeps the storage shape free to change.

   The strength and weakness lists are recomputed rather than stored. That is
   the point: the evidence threshold is a judgement, and when it moves, a review
   saved last month should be re-judged by the new rule instead of preserving
   whatever the rule happened to be on the day it was written. */
function rankedQTypes(perQType) {
  const sorted = (perQType || [])
    .filter((q) => q && q.qtype && q.total)
    .sort((a, b) => b.pct - a.pct || b.total - a.total);
  return {
    qtypeStrengths: sorted
      .filter((q) => SATG.taxonomy.enoughData(q.total) && q.pct >= 0.8).slice(0, 5),
    qtypeWeaknesses: sorted.slice().reverse()
      .filter((q) => SATG.taxonomy.enoughData(q.total) && q.pct < 0.6).slice(0, 5)
  };
}

function reviewAsResult(r) {
  if (!r) return null;
  const ranked = rankedQTypes(r.perQType);
  return {
    kind: r.kind,
    at: r.at,
    modeLabel: r.label || '',
    isFull: !!r.isFull,
    totalScaled: r.scaled | 0,
    rawTotal: r.rawTotal | 0,
    totalQuestions: r.totalQuestions | 0,
    answered: r.answered | 0,
    cleared: r.cleared | 0,
    elapsed: r.elapsed | 0,
    sections: r.sections || [],
    perDomain: r.perDomain || [],
    perSkill: r.perSkill || [],
    perQType: r.perQType || [],
    perDifficulty: r.perDifficulty || [],
    items: r.items || [],
    pacing: SATG.satUtil.pacing(r.items),
    qtypeStrengths: ranked.qtypeStrengths,
    qtypeWeaknesses: ranked.qtypeWeaknesses
  };
}

/* ------------------------------------------------------- the total review

   Everything, as one report, in the same shape a single run produces - so the
   analysis screen renders it without knowing it is looking at a lifetime
   rather than an afternoon.

   One thing about it is genuinely uneven and the screen has to say so. The bars
   are summed from every remembered run, because a run's aggregate costs a few
   hundred bytes and four hundred of them fit. The per-question squares can only
   come from SAVED reviews, because those are the only records that kept their
   per-question detail. So the two halves of this page cover different spans,
   and both counts are returned rather than blended into one number that would
   be wrong for whichever half you were reading. */
function combined() {
  const a = account();
  const runs = a.runs || [];
  const revs = a.reviews || [];

  const domains = {}, skills = {}, qtypes = {}, difficulty = {};
  const add = (into, key, e) => {
    if (!key || !e) return;
    const t = into[key] || (into[key] = { right: 0, total: 0, section: null });
    t.right += e.right | 0;
    t.total += e.total | 0;
    if (!t.section && e.section) t.section = e.section;
  };

  let elapsed = 0, answered = 0, correct = 0;
  for (const r of runs) {
    elapsed += r.elapsed || 0;
    for (const k of Object.keys(r.domains || {})) {
      add(domains, k, r.domains[k]);
      answered += r.domains[k].total | 0;
      correct += r.domains[k].right | 0;
    }
    for (const k of Object.keys(r.skills || {})) add(skills, k, r.skills[k]);
    for (const k of Object.keys(r.qtypes || {})) add(qtypes, k, r.qtypes[k]);
    for (const k of Object.keys(r.difficulty || {})) add(difficulty, k, r.difficulty[k]);
  }

  const toRanked = (map, nameKey) => Object.keys(map).map((k) => {
    const e = map[k];
    const o = { right: e.right, total: e.total,
                pct: e.total ? e.right / e.total : 0, section: e.section || null };
    o[nameKey] = k;
    return o;
  }).sort((x, y) => y.pct - x.pct || y.total - x.total);

  const perQType = toRanked(qtypes, 'qtype');
  const ranked = rankedQTypes(perQType);

  /* Shallow copies: these objects live in the saved reviews, and the analysis
     screen has no business being handed the stored originals. */
  const items = [];
  for (const rev of revs) {
    for (const it of rev.items || []) items.push(Object.assign({}, it));
  }

  const bestTotal = runs.filter((r) => r.kind === 'full')
                        .reduce((m, r) => Math.max(m, r.scaled || 0), 0);

  return {
    kind: 'combined',
    screenTitle: 'TOTAL REVIEW',
    modeLabel: 'LIFETIME',
    runCount: runs.length,
    reviewCount: revs.length,
    elapsed, answered, correct,
    accuracy: answered ? correct / answered : 0,
    bestTotal,
    firstAt: runs.length ? runs[0].at : null,
    lastAt: runs.length ? runs[runs.length - 1].at : null,
    perDomain: toRanked(domains, 'domain'),
    perSkill: toRanked(skills, 'skill'),
    perQType,
    perDifficulty: ['easy', 'medium', 'hard']
      .filter((k) => difficulty[k])
      .map((k) => ({ difficulty: k, right: difficulty[k].right, total: difficulty[k].total,
                     pct: difficulty[k].total ? difficulty[k].right / difficulty[k].total : 0 })),
    items,
    pacing: SATG.satUtil.pacing(items),
    qtypeStrengths: ranked.qtypeStrengths,
    qtypeWeaknesses: ranked.qtypeWeaknesses,
    trend: trend()
  };
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
  const qtypes = {};
  const difficulty = {};
  /* qtype -> [{ at, pct, right, total }], oldest first. One entry per run that
     touched the type, which is what a per-type sparkline draws. */
  const qtypeHistory = {};
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

    /* Question types are scoped exactly as skills are, and for the same
       reason: a full SAT contains both sections, so only the entry's own
       section can file it under the right tab. */
    for (const k of Object.keys(r.qtypes || {})) {
      const e = r.qtypes[k];
      if (scope !== 'overall') {
        const sec = e.section ||
          (r.section === 'rw' || r.section === 'math' ? r.section : null);
        if (sec !== scope) continue;
      }
      add(qtypes, k, e);
      if (e.total) {
        (qtypeHistory[k] || (qtypeHistory[k] = []))
          .push({ at: r.at, right: e.right, total: e.total, pct: e.right / e.total });
      }
    }

    /* Difficulty is section-agnostic: "careless on easy questions" is the same
       finding whichever section it happens in, so it is not scoped. */
    for (const k of Object.keys(r.difficulty || {})) {
      add(difficulty, k, r.difficulty[k]);
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
  const qtypeRank = rank(qtypes, 'qtype');

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
    qtypes: qtypeRank,
    qtypeHistory,
    difficulty: ['easy', 'medium', 'hard']
      .filter((d) => difficulty[d])
      .map((d) => ({
        difficulty: d, right: difficulty[d].right, total: difficulty[d].total,
        pct: difficulty[d].total ? difficulty[d].right / difficulty[d].total : 0
      })),
    strengths: domainRank.filter((d) => d.total >= 4 && d.pct >= 0.7).slice(0, 3),
    weaknesses: domainRank.slice().reverse()
                          .filter((d) => d.total >= 4 && d.pct < 0.7).slice(0, 3),
    /* Question-type strengths and weaknesses use the taxonomy's own threshold
       rather than a local one, so a 65-way split cannot report "0% - your
       worst area" off a single attempt. The raw counts are still returned for
       every type; only the CLAIM is gated. */
    qtypeStrengths: qtypeRank
      .filter((q) => SATG.taxonomy.enoughData(q.total) && q.pct >= 0.8).slice(0, 5),
    qtypeWeaknesses: qtypeRank.slice().reverse()
      .filter((q) => SATG.taxonomy.enoughData(q.total) && q.pct < 0.6).slice(0, 5),
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
  return { rw, math, overall, projection: project(overall) };
}

/* Where the composite is heading, if nothing changes.

   A least-squares line through the scores so far, extended by a third of the
   run's length. This is the one device on the stats page that shows something
   that has not happened, so three rules govern it:

     - it needs at least four real scores. Two points define a line perfectly
       and predict nothing; three is a coin toss. Below four this returns null
       and the chart simply does not draw it.
     - it is drawn as a BAND, not a line. The residual spread around the fit is
       what says how much the projection is worth, and a single dotted line
       implies a precision that a handful of practice tests cannot support.
     - it is clamped to the real scale. A rising trend extrapolated far enough
       produces 1900 out of 1600, which would discredit everything else on the
       page. */
const PROJECT_MIN_POINTS = 4;

function project(points) {
  const n = points.length;
  if (n < PROJECT_MIN_POINTS) return null;

  // Regress on index rather than on timestamp: the question is "per test
  // taken", and a fortnight's gap between two of them does not change that.
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  points.forEach((p, i) => { sx += i; sy += p.v; sxx += i * i; sxy += i * p.v; });
  const denom = n * sxx - sx * sx;
  if (!denom) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;

  // Root-mean-square residual, which is what the band is built from.
  let ss = 0;
  points.forEach((p, i) => {
    const fit = intercept + slope * i;
    ss += (p.v - fit) * (p.v - fit);
  });
  const rms = Math.sqrt(ss / n);

  const ahead = Math.max(1, Math.round(n / 3));
  const at = n - 1 + ahead;
  const centre = clamp(Math.round(intercept + slope * at), 400, 1600);
  const spread = Math.max(20, Math.round(rms));

  return {
    /* Per test taken, which is the unit the chart's x-axis is actually in. */
    perTest: Math.round(slope * 10) / 10,
    ahead,
    at,
    centre,
    lo: clamp(centre - spread, 400, 1600),
    hi: clamp(centre + spread, 400, 1600),
    /* Set when the line was clipped by the scale. The chart says so out loud,
       because a projection resting against the ceiling is not a prediction of a
       perfect score - it is the model running out of room. */
    clamped: intercept + slope * at > 1600 || intercept + slope * at < 400,
    points: n
  };
}

function reset() {
  if (!db) load();
  delete db.accounts[currentId];
  save();
}

load();

SATG.profile = {
  LOCAL_ID, MAX_REVIEWS, load, save, record, summary, trend, reset,
  saveReview, reviews, review, deleteReview, mergeRuns,
  reviewAsResult, combined, rankQTypes: rankedQTypes,
  setAccount, clearAccount, currentAccount,
  get accountId() { return currentId; },
  get signedIn() { return currentId !== LOCAL_ID; }
};

})(window);
