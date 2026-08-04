/* =========================================================================
   sat/question-bank.js - hands the game its next question.

   Responsibilities:
     - hold the per-section time limits
     - alternate between Reading & Writing and Math in a way that feels like
       a real form rather than a coin flip
     - drift difficulty upward as the player's streak grows, mirroring the
       adaptive routing of the digital test
     - refuse to serve the same question twice in quick succession
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;

/* Per-question time limits, in seconds, exactly as specified.

   These are not the naive averages (which would be 71.1s and 95.5s). They
   correspond to the real per-question pacing once a flat five minutes per
   section is set aside for directions and review: 54 R&W questions in
   64 - 5 minutes, and 44 Math questions in 70 - 5 minutes. */
const TIME_RW = 65.5;
const TIME_MATH = 88.6;

/* Warning threshold. At ten seconds the tension cue starts and does not stop. */
const PANIC_SECONDS = 10;

class QuestionBank {
  constructor(rng) {
    this.rng = rng || SATG.util.rng;
    this.recent = [];          // fingerprints of recently served questions
    this.recentLimit = 14;
    this.served = 0;
    this.correctStreak = 0;
    this.totalCorrect = 0;
    this.totalWrong = 0;
    this.lastSection = null;
    this.byDomain = {};
    this.bySkill = {};
    this.skillSection = {};
    this.byQType = {};
    this.qtypeSection = {};
    this.byDifficulty = {};
    /* One record per question answered, so an Infinity run can produce the same
       per-question review a module test does. */
    this.items = [];
    /* 'rw', 'math', or 'both'. Infinity mode is the only thing that draws
       through here now - a module test builds its whole form up front - so
       this is what makes ENGLISH INFINITY serve only English. */
    this.only = 'both';
    /* When set, only this question type is served. Used by the logbook's
       "practice only this question type" button and by the specific-type game
       mode. Null means no restriction. */
    this.onlyQType = null;
  }

  reset(only) {
    this.recent.length = 0;
    this.served = 0;
    this.correctStreak = 0;
    this.totalCorrect = 0;
    this.totalWrong = 0;
    this.lastSection = null;
    this.byDomain = {};
    this.bySkill = {};
    this.skillSection = {};
    this.byQType = {};
    this.qtypeSection = {};
    this.byDifficulty = {};
    this.items.length = 0;
    if (only) this.only = only;
    this.onlyQType = null;
  }

  /* Difficulty drifts with the streak. The real test routes once, between
     modules; here it moves continuously, which suits a run that ends the
     first time the player is wrong. */
  currentDifficulty() {
    const s = this.correctStreak;
    if (s < 3) return this.rng.bool(0.65) ? 'easy' : 'medium';
    if (s < 7) return this.rng.bool(0.6) ? 'medium' : (this.rng.bool() ? 'easy' : 'hard');
    if (s < 12) return this.rng.bool(0.6) ? 'hard' : 'medium';
    return this.rng.bool(0.75) ? 'hard' : 'medium';
  }

  /* Section choice. The real form is 54 R&W to 44 Math, so R&W is slightly
     more likely - but never three of the same section in a row, which reads
     as a broken shuffle even when it is legitimately random. */
  nextSection() {
    // A single-section run has no choice to make, and the alternation rule
    // below would otherwise force it off its own section every third question.
    if (this.only === 'rw' || this.only === 'math') return this.only;
    if (this.lastSection === null) return this.rng.bool(0.5) ? 'rw' : 'math';
    const sameTwice = this.recent.length >= 2 &&
      this.recent[this.recent.length - 1].section === this.lastSection &&
      this.recent[this.recent.length - 2].section === this.lastSection;
    if (sameTwice) return this.lastSection === 'rw' ? 'math' : 'rw';
    return this.rng.bool(0.55) ? 'rw' : 'math';
  }

  /* A cheap identity for repeat detection: the skill plus the rendered stem. */
  fingerprint(q) {
    return q.skill + '|' + (q.passage || '').slice(0, 60) + '|' + q.stem.slice(0, 80);
  }

  /* Draw a question of one specific type.

     The generators are selected by domain, not by question type - a type is
     usually one branch inside a generator - so the only way to ask for a
     single type is to draw within its domain and resample until the branch
     comes up. That is cheap for a four-way branch and hopeless in the general
     case, so the loop is bounded and reports rather than spins: a practice
     mode that silently served the wrong type would be worse than one that says
     it could not. */
  nextOfType(qtypeId, difficulty, quiet) {
    const sk = SATG.taxonomy.skillOf(qtypeId);
    if (!sk) return null;
    const source = sk.section === 'math' ? SATG.mathQuestions : SATG.verbalQuestions;
    let fallback = null;
    for (let i = 0; i < 220; i++) {
      const q = source.generateInDomain(this.rng, difficulty || 'medium', sk.domain);
      if (!q) continue;
      if (!fallback) fallback = q;
      if (q.qtype === qtypeId) return q;
    }
    if (!quiet) {
      console.warn('[sat] could not draw question type "' + qtypeId +
                   '" in 220 attempts; serving its domain instead');
    }
    return fallback;
  }

  next() {
    const difficulty0 = this.currentDifficulty();
    if (this.onlyQType) {
      const q = this.nextOfType(this.onlyQType, difficulty0);
      if (q) {
        const sec = SATG.taxonomy.sectionOf(this.onlyQType) || q.section;
        q.timeLimit = sec === 'math' ? TIME_MATH : TIME_RW;
        q.index = ++this.served;
        this.recent.push({ fp: this.fingerprint(q), section: sec });
        while (this.recent.length > this.recentLimit) this.recent.shift();
        this.lastSection = sec;
        return q;
      }
      /* Fall through to the ordinary draw rather than returning null, which
         would stall the run. */
    }

    const section = this.nextSection();
    const difficulty = this.currentDifficulty();
    const source = section === 'math' ? SATG.mathQuestions : SATG.verbalQuestions;

    // Resample a few times to dodge a recent repeat. Bounded, because some
    // authored banks are small enough that a repeat is eventually unavoidable
    // and stalling the exam would be far worse than showing one again.
    let q = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      const candidate = source.generate(this.rng, difficulty);
      const fp = this.fingerprint(candidate);
      if (!this.recent.some((r) => r.fp === fp)) {
        q = candidate;
        break;
      }
      q = candidate;
    }

    q.timeLimit = section === 'math' ? TIME_MATH : TIME_RW;
    q.index = ++this.served;

    this.recent.push({ fp: this.fingerprint(q), section });
    while (this.recent.length > this.recentLimit) this.recent.shift();
    this.lastSection = section;

    return q;
  }

  /* `question` is optional only so old call sites keep working; pass it, or
     the Infinity run ends with a score report that has nothing in it. The
     module modes get their breakdown from the form instead, which is why this
     tracking lives here rather than being duplicated in the game. */
  recordResult(wasCorrect, question, response, seconds) {
    if (wasCorrect) { this.correctStreak++; this.totalCorrect++; }
    else { this.correctStreak = 0; this.totalWrong++; }

    if (!question) return;
    const bump = (map, key) => {
      if (!key) return;
      const e = map[key] || (map[key] = { right: 0, total: 0 });
      e.total++;
      if (wasCorrect) e.right++;
    };
    bump(this.byDomain, question.domain);
    bump(this.bySkill, question.skill);
    bump(this.byQType, question.qtype);
    bump(this.byDifficulty, question.difficulty);
    // Same reason as the exam form: a skill has to carry its own section, or
    // the stats page cannot file it under the right tab.
    this.skillSection[question.skill] = question.section;
    if (question.qtype) this.qtypeSection[question.qtype] = question.section;

    /* `response` is optional so the older two-argument call still works, but
       without it an Infinity death cannot say what the player put down - which
       is the whole point of the feedback the run currently lacks. */
    const answered = response !== null && response !== undefined && response !== '';
    this.items.push({
      n: this.items.length + 1,
      section: question.section,
      domain: question.domain,
      skill: question.skill,
      qtype: question.qtype || null,
      difficulty: question.difficulty || null,
      answered, right: !!wasCorrect,
      response: answered ? response : null,
      responseText: answered ? SATG.satUtil.describeResponse(question, response) : null,
      correctText: question.answerText != null ? String(question.answerText) : null,
      explanation: question.explanation || null,
      whyWrong: (!wasCorrect && answered && question.format === 'mc' &&
                 question.choices && question.choices[response])
        ? (question.choices[response].why || null) : null,
      // Same reason as the exam form: a review has to be able to show the sheet.
      paper: SATG.satUtil.paperSnapshot(question),
      // Optional, like `response` above, so an older two-argument call still works.
      seconds: seconds > 0 ? Math.round(seconds * 10) / 10 : 0
    });
  }

  /* The same shape the exam form's grade() produces, so one results screen can
     render an Infinity run and a module test without branching on which. */
  breakdown() {
    const rank = Object.keys(this.byDomain).map((d) => ({
      domain: d, right: this.byDomain[d].right, total: this.byDomain[d].total,
      pct: this.byDomain[d].total ? this.byDomain[d].right / this.byDomain[d].total : 0
    })).sort((a, b) => b.pct - a.pct || b.total - a.total);
    return {
      perDomain: rank,
      perSkill: Object.keys(this.bySkill).map((k) => ({
        skill: k, section: this.skillSection[k] || null,
        right: this.bySkill[k].right, total: this.bySkill[k].total,
        pct: this.bySkill[k].total ? this.bySkill[k].right / this.bySkill[k].total : 0
      })).sort((a, b) => b.pct - a.pct),
      perQType: Object.keys(this.byQType).map((k) => ({
        qtype: k, section: this.qtypeSection[k] || null,
        right: this.byQType[k].right, total: this.byQType[k].total,
        pct: this.byQType[k].total ? this.byQType[k].right / this.byQType[k].total : 0
      })).sort((a, b) => b.pct - a.pct || b.total - a.total),
      perDifficulty: ['easy', 'medium', 'hard']
        .filter((d) => this.byDifficulty[d])
        .map((d) => ({
          difficulty: d,
          right: this.byDifficulty[d].right, total: this.byDifficulty[d].total,
          pct: this.byDifficulty[d].total ? this.byDifficulty[d].right / this.byDifficulty[d].total : 0
        })),
      items: this.items.slice(),
      pacing: SATG.satUtil.pacing(this.items),
      strengths: rank.filter((d) => d.pct >= 0.7).slice(0, 3),
      weaknesses: rank.slice().reverse().filter((d) => d.pct < 0.7).slice(0, 3)
    };
  }

  /* Grade a response. `response` is a choice index for MC, or a typed string
     for grid-in. Returns true only for an unambiguously correct answer. */
  check(question, response) {
    if (!question) return false;
    if (question.format === 'mc') {
      return typeof response === 'number' && response === question.answerIndex;
    }
    return SATG.satUtil.checkGrid(question, response);
  }
}

/* Which question types the bank can actually produce.

   Derived by asking, not asserted in a list. Two types are currently declared
   in the taxonomy with no generator behind them, and a hand-maintained list of
   those would be one more thing to forget to update the day a generator lands.
   Probing costs a few hundred generations once per session and then answers
   from cache, so the logbook can offer a drill only where a drill would
   actually work - rather than launching a run that quietly serves the wrong
   question. */
let drawableCache = null;

function drawableTypes() {
  if (drawableCache) return drawableCache;
  const bank = new QuestionBank();
  drawableCache = new Set();
  for (const q of SATG.taxonomy.QTYPES) {
    for (let i = 0; i < 3; i++) {
      const got = bank.nextOfType(q.id, 'medium', true);
      if (got && got.qtype === q.id) { drawableCache.add(q.id); break; }
    }
  }
  return drawableCache;
}

function canDraw(qtypeId) { return drawableTypes().has(qtypeId); }

SATG.questionBank = {
  QuestionBank,
  drawableTypes, canDraw,
  TIME_RW, TIME_MATH, PANIC_SECONDS
};

})(window);
