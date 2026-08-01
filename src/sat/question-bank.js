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
    /* 'rw', 'math', or 'both'. Infinity mode is the only thing that draws
       through here now - a module test builds its whole form up front - so
       this is what makes ENGLISH INFINITY serve only English. */
    this.only = 'both';
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
    if (only) this.only = only;
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

  next() {
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
  recordResult(wasCorrect, question) {
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
    // Same reason as the exam form: a skill has to carry its own section, or
    // the stats page cannot file it under the right tab.
    this.skillSection[question.skill] = question.section;
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

SATG.questionBank = {
  QuestionBank,
  TIME_RW, TIME_MATH, PANIC_SECONDS
};

})(window);
