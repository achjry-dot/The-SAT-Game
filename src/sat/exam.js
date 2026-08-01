/* =========================================================================
   sat/exam.js - a whole test form, rather than one question at a time.

   The original game only ever needed the NEXT question, so the bank handed
   them out one by one and forgot them. A module test is a different object:
   its questions all exist before the clock starts, the player moves back and
   forth between them, unanswered ones are a real state, and the whole thing is
   graded at the end. That does not fit behind `next()`, so it lives here.

   Structure, from the College Board's published specification:

     Reading and Writing   2 modules  27 questions  32 minutes each
     Math                  2 modules  22 questions  35 minutes each
     A full form           those four modules in that order, 134 minutes

   Both sections are adaptive between their two modules: module 1 is a broad
   mix, and performance on it decides whether module 2 is the higher- or
   lower-difficulty form. That is modelled here, because it is the single most
   distinctive thing about the digital test and a simulator that skipped it
   would be teaching the wrong exam.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;
const { clamp } = SATG.util;

const RW = 'rw', MATH = 'math';

/* Per-section shape. `minutes` is the time for ONE module. */
const SECTION_SPEC = {
  [RW]:   { modules: 2, perModule: 27, minutes: 32, label: 'READING AND WRITING',
            short: 'ENGLISH' },
  [MATH]: { modules: 2, perModule: 22, minutes: 35, label: 'MATH', short: 'MATH' }
};

/* How many questions of each domain belong in one module.

   These are the published percentages applied to the module size and rounded
   so the parts still add up to the whole - 28/26/26/20 of 27 is 7.56/7.02/
   7.02/5.4, which rounds to 8/7/7/5 and sums to 27. Rounding each one
   independently and hoping is how a module ends up with 26 or 28 questions. */
const QUOTA = {
  [RW]: {
    'Craft and Structure': 8,
    'Information and Ideas': 7,
    'Standard English Conventions': 7,
    'Expression of Ideas': 5
  },
  [MATH]: {
    'Algebra': 8,
    'Advanced Math': 8,
    'Problem-Solving and Data Analysis': 3,
    'Geometry and Trigonometry': 3
  }
};

/* Share of a Math module that is student-produced response rather than
   multiple choice. The published specification is 8-12 of the 40 scored Math
   questions on a form, which is a quarter. Reading and Writing has none. */
const GRID_SHARE = 0.25;

/* Raw-correct to scaled-score, 200-800.

   The real conversion is item response theory over the specific questions a
   student saw, and College Board does not publish the mapping - two people
   with the same raw score on different forms can score differently. So this is
   an approximation fitted to the shape of published practice-test curves:
   roughly linear through the middle, compressed at both ends. It is honest
   about being an approximation on the results screen rather than presenting
   itself as the real conversion. */
const CURVE = {
  [RW]:   [[0,200],[5,290],[10,360],[15,420],[20,480],[25,530],
           [30,580],[35,620],[40,660],[45,700],[50,750],[54,800]],
  [MATH]: [[0,200],[4,280],[8,350],[12,420],[16,480],[20,530],
           [24,570],[28,610],[32,650],[36,690],[40,740],[44,800]]
};

/* A player routed to the lower-difficulty module 2 cannot reach the top of the
   scale on the real test - College Board says midlevel scores are reachable
   "from either path", which is only worth saying if the extremes are not.
   The exact ceiling is NOT published; the figure below is the middle of the
   range test-prep sources estimate, and it is labelled as an estimate wherever
   it is shown to the player. */
const LOWER_ROUTE_CAP = 650;

/* Fraction of module 1 that has to be right to be routed upward. The real
   break point sits near the median test taker, which is what this is aiming
   at rather than any published number. */
const ROUTE_THRESHOLD = 0.6;

function scaleScore(section, raw) {
  const pts = CURVE[section];
  const max = pts[pts.length - 1][0];
  raw = clamp(raw, 0, max);
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    if (raw <= x1) {
      const t = x1 === x0 ? 0 : (raw - x0) / (x1 - x0);
      return Math.round((y0 + (y1 - y0) * t) / 10) * 10;
    }
  }
  return pts[pts.length - 1][1];
}

/* ------------------------------------------------------------------ build */

function sourceFor(section) {
  return section === MATH ? SATG.mathQuestions : SATG.verbalQuestions;
}

/* Difficulty mix per module. Module 1 is the broad routing module; module 2 is
   whichever form the player earned. */
const MIX = {
  routing: [['easy', 3], ['medium', 5], ['hard', 2]],
  upper:   [['easy', 1], ['medium', 4], ['hard', 5]],
  lower:   [['easy', 5], ['medium', 4], ['hard', 1]]
};

function pickDifficulty(rng, mix) {
  return rng.weighted(mix.map(([d, w]) => ({ w, d }))).d;
}

/* One question of a named domain that the form has not already used.

   The `used` set is what stops a 54-question section showing the same
   authored passage three times. It is bounded rather than absolute: the
   authored banks are finite, and serving a repeat is far better than
   deadlocking the exam, so after enough tries it takes what it can get. */
function drawQuestion(rng, section, domain, difficulty, used, wantFormat) {
  const source = sourceFor(section);
  let last = null;      // any question at all
  let fresh = null;     // an unused one, even if the format is wrong
  for (let attempt = 0; attempt < 60; attempt++) {
    const q = source.generateInDomain(rng, difficulty, domain);
    if (!q) continue;
    last = q;
    const fp = fingerprint(q);
    const unused = !used.has(fp);
    if (unused && !fresh) fresh = q;
    if (unused && (!wantFormat || q.format === wantFormat)) {
      used.add(fp);
      return q;
    }
  }
  /* Preferences are graded: an unused question in the wrong format beats a
     repeat in the right one. Repeating a question is visible to the player;
     being one grid-in short of the published ratio is not. */
  const chosen = fresh || last;
  if (chosen) used.add(fingerprint(chosen));
  return chosen;
}

function fingerprint(q) {
  return q.skill + '|' + (q.passage || '').slice(0, 80) + '|' + q.stem.slice(0, 100);
}

/* ------------------------------------------------------------------ module */

class ExamModule {
  constructor(section, number, ofTotal, minutes) {
    this.section = section;
    this.number = number;            // 1-based, across the whole form
    this.ofTotal = ofTotal;
    this.seconds = minutes * 60;
    this.timeLeft = this.seconds;
    this.questions = [];
    this.responses = [];             // parallel; null means unanswered
    this.index = 0;
    this.started = false;
    this.finished = false;
  }

  get question() { return this.questions[this.index] || null; }
  get count() { return this.questions.length; }

  get answeredCount() {
    let n = 0;
    for (const r of this.responses) if (r !== null && r !== undefined && r !== '') n++;
    return n;
  }

  /* Responses are stored, never graded here. Grading during the module would
     let the game react to a wrong answer, and on a module test it must not:
     the player is meant to be able to change their mind right up to the end,
     exactly as they can in Bluebook. */
  record(response) {
    this.responses[this.index] = response;
  }

  responseAt(i) {
    const r = this.responses[i];
    return r === undefined ? null : r;
  }

  go(i) {
    if (i < 0 || i >= this.questions.length || i === this.index) return false;
    this.index = i;
    return true;
  }

  step(d) { return this.go(this.index + d); }

  /* Correct answers in this module, by the bank's own grader. */
  rawScore(bank) {
    let n = 0;
    for (let i = 0; i < this.questions.length; i++) {
      const r = this.responseAt(i);
      if (r === null) continue;
      if (bank.check(this.questions[i], r)) n++;
    }
    return n;
  }
}

/* -------------------------------------------------------------------- form */

class ExamForm {
  /* `sections` is ['rw'], ['math'] or ['rw','math']. */
  constructor(sections, rng) {
    this.rng = rng || SATG.util.rng;
    this.sections = sections.slice();
    this.used = new Set();
    this.modules = [];
    this.index = 0;
    this.route = {};                 // section -> 'upper' | 'lower'
    this.elapsed = 0;

    /* Only module 1 of the first section is built up front. The rest are built
       as the player reaches them, because module 2's difficulty is not known
       until module 1 has been graded - building it early would mean building
       it from the wrong mix. */
    const total = this.sections.length * 2;
    let n = 0;
    for (const sec of this.sections) {
      const spec = SECTION_SPEC[sec];
      for (let m = 0; m < spec.modules; m++) {
        this.modules.push(new ExamModule(sec, ++n, total, spec.minutes));
      }
    }
    this.fill(0, 'routing');
  }

  get module() { return this.modules[this.index] || null; }
  get question() { return this.module ? this.module.question : null; }
  get isLast() { return this.index >= this.modules.length - 1; }

  /* Total seconds of testing time in this form, for the results screen. */
  get totalSeconds() {
    return this.modules.reduce((s, m) => s + m.seconds, 0);
  }

  fill(i, mixName) {
    const mod = this.modules[i];
    if (!mod || mod.questions.length) return;
    const spec = SECTION_SPEC[mod.section];
    const quota = QUOTA[mod.section];
    const mix = MIX[mixName] || MIX.routing;

    /* Plan the module before drawing it, so the student-produced-response
       share is a quota rather than an average.

       Each math generator used to flip its own coin for grid-in versus
       multiple choice, and only twelve of the thirty-one can produce a
       grid-in at all - so the ratio that actually came out was 18%, against
       the 25% the College Board publishes. Per-question randomness cannot hit
       a whole-form target; deciding the whole form's shape first can. */
    const plan = [];
    for (const domain of Object.keys(quota)) {
      for (let k = 0; k < quota[domain]; k++) plan.push({ domain: domain, format: 'mc' });
    }
    // Reading and Writing is entirely multiple choice, so this is math only.
    if (mod.section === MATH) {
      const want = Math.round(plan.length * GRID_SHARE);
      const order = this.rng.shuffle(plan.map((_, i) => i));
      for (let i = 0; i < want && i < order.length; i++) plan[order[i]].format = 'grid';
    }

    const list = [];
    for (const p of plan) {
      const q = drawQuestion(this.rng, mod.section, p.domain,
                             pickDifficulty(this.rng, mix), this.used, p.format);
      if (q) list.push(q);
    }

    /* Interleave rather than serving eight Algebra questions in a row. The
       real test groups loosely by domain and rises in difficulty; shuffling
       is closer to that than the block order the quota loop produces. */
    const shuffled = this.rng.shuffle(list);
    shuffled.forEach((q, k) => { q.index = k + 1; });
    mod.questions = shuffled;
    mod.responses = new Array(shuffled.length).fill(null);
    // A quota that could not be met is a content-bank problem, not a silent one.
    if (shuffled.length !== spec.perModule) {
      console.warn('[sat] module ' + mod.number + ' built ' + shuffled.length +
                   ' questions, expected ' + spec.perModule);
    }
  }

  /* Finish the current module and set up the next one, routing if the module
     just completed was the first of its section. Returns the next module, or
     null when the form is over. */
  advance(bank) {
    const done = this.module;
    if (!done) return null;
    done.finished = true;

    const next = this.modules[this.index + 1];
    if (!next) return null;

    if (next.section === done.section) {
      // Second module of a section: route on how module 1 went.
      const frac = done.count ? done.rawScore(bank) / done.count : 0;
      const which = frac >= ROUTE_THRESHOLD ? 'upper' : 'lower';
      this.route[next.section] = which;
      this.fill(this.index + 1, which);
    } else {
      this.fill(this.index + 1, 'routing');
    }

    this.index++;
    return this.module;
  }

  /* True when the next module belongs to a different section - the point at
     which the real test gives a ten-minute break. */
  get breakNext() {
    const cur = this.modules[this.index], next = this.modules[this.index + 1];
    return !!(cur && next && cur.section !== next.section);
  }

  /* ---------------------------------------------------------------- grade */

  grade(bank) {
    const perDomain = {};
    const perSkill = {};
    const perSection = {};
    /* Which section each skill came from.

       Without it, the stats page can only scope a skill by looking at what
       else was in the same run - which works for a single-section module and
       fails for a full SAT, where every run contains both. The effect was that
       somebody who only ever plays the full test sees an empty "BY SKILL" list
       on the ENGLISH and MATH tabs: the one place the page is meant to tell
       them what to practise. The question knows its own section, so record it. */
    const skillSection = {};

    const bump = (map, key, right) => {
      const e = map[key] || (map[key] = { right: 0, total: 0 });
      e.total++;
      if (right) e.right++;
    };

    for (const mod of this.modules) {
      if (!mod.questions.length) continue;
      const sec = perSection[mod.section] ||
        (perSection[mod.section] = { section: mod.section, raw: 0, total: 0,
                                     answered: 0, modules: [] });
      let modRight = 0;
      for (let i = 0; i < mod.questions.length; i++) {
        const q = mod.questions[i];
        const r = mod.responseAt(i);
        const answered = r !== null && r !== '';
        const right = answered && bank.check(q, r);
        bump(perDomain, q.domain, right);
        bump(perSkill, q.skill, right);
        skillSection[q.skill] = q.section;
        sec.total++;
        if (answered) sec.answered++;
        if (right) { sec.raw++; modRight++; }
      }
      sec.modules.push({ number: mod.number, right: modRight, of: mod.count,
                         timeLeft: Math.max(0, mod.timeLeft) });
    }

    const sections = [];
    let totalScaled = 0;
    for (const sec of Object.keys(perSection)) {
      const s = perSection[sec];
      let scaled = scaleScore(sec, s.raw);
      const routed = this.route[sec] || null;
      const capped = routed === 'lower' && scaled > LOWER_ROUTE_CAP;
      if (capped) scaled = LOWER_ROUTE_CAP;
      s.scaled = scaled;
      s.route = routed;
      s.capped = capped;
      s.label = SECTION_SPEC[sec].label;
      s.pct = s.total ? s.raw / s.total : 0;
      sections.push(s);
      totalScaled += scaled;
    }
    // Keep Reading and Writing before Math, as a real score report does.
    sections.sort((a, b) => (a.section === RW ? -1 : 1) - (b.section === RW ? -1 : 1));

    const rank = Object.keys(perDomain).map((d) => ({
      domain: d, right: perDomain[d].right, total: perDomain[d].total,
      pct: perDomain[d].total ? perDomain[d].right / perDomain[d].total : 0
    })).sort((a, b) => b.pct - a.pct || b.total - a.total);

    return {
      sections,
      totalScaled,
      isFull: this.sections.length > 1,
      perDomain: rank,
      perSkill: Object.keys(perSkill).map((k) => ({
        skill: k, section: skillSection[k] || null,
        right: perSkill[k].right, total: perSkill[k].total,
        pct: perSkill[k].total ? perSkill[k].right / perSkill[k].total : 0
      })).sort((a, b) => b.pct - a.pct),
      strengths: rank.filter((d) => d.pct >= 0.7).slice(0, 3),
      weaknesses: rank.slice().reverse().filter((d) => d.pct < 0.7).slice(0, 3),
      answered: sections.reduce((n, s) => n + s.answered, 0),
      rawTotal: sections.reduce((n, s) => n + s.raw, 0),
      totalQuestions: sections.reduce((n, s) => n + s.total, 0),
      elapsed: this.elapsed,
      approximateScale: true
    };
  }
}

SATG.exam = {
  ExamForm, ExamModule, SECTION_SPEC, QUOTA, CURVE, scaleScore,
  LOWER_ROUTE_CAP, ROUTE_THRESHOLD, GRID_SHARE, fingerprint
};

})(window);
