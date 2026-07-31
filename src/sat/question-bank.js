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
  }

  reset() {
    this.recent.length = 0;
    this.served = 0;
    this.correctStreak = 0;
    this.totalCorrect = 0;
    this.totalWrong = 0;
    this.lastSection = null;
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

  recordResult(wasCorrect) {
    if (wasCorrect) { this.correctStreak++; this.totalCorrect++; }
    else { this.correctStreak = 0; this.totalWrong++; }
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
