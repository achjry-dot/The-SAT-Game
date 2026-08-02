/* =========================================================================
   sat/util.js - shared machinery for the question generators.

   Two rules run through everything here, both taken from how the real test
   is actually built:

   1. Pick the ANSWER first, then derive the coefficients. Sampling
      coefficients and solving afterwards produces ugly fractional answers
      that immediately read as machine-generated.

   2. Every distractor must be a named, traceable misconception - a sign
      error, a reciprocal, an unfinished step - never a random nearby number.
      Distractors are then compared NUMERICALLY against the key, so a
      generator can never accidentally offer 3/8 and 0.375 as two options.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;
const { gcd } = SATG.util;

/* ------------------------------------------------------------- formatting */

/* Coefficient in front of a variable: 1x -> x, -1x -> -x, 0x -> '' */
function term(coef, v) {
  if (coef === 0) return '';
  if (coef === 1) return v;
  if (coef === -1) return '-' + v;
  return coef + v;
}

/* " + 5" / " - 5", for chaining onto an expression.
   Plain ASCII hyphen, not U+2212: the bitmap font is rasterised from the
   platform monospace face, and a true minus sign is not reliably present in
   one. A missing glyph in a maths stem is a wrong answer waiting to happen. */
function signed(n) {
  return n >= 0 ? ' + ' + n : ' - ' + Math.abs(n);
}

/* Same, but for a signed variable term: " + 3x" / " - 3x" */
function signedTerm(coef, v) {
  if (coef === 0) return '';
  const mag = Math.abs(coef) === 1 ? v : Math.abs(coef) + v;
  return (coef >= 0 ? ' + ' : ' - ') + mag;
}

function reduceFraction(num, den) {
  if (den < 0) { num = -num; den = -den; }
  const g = gcd(num, den);
  return [num / g, den / g];
}

function fmtFraction(num, den) {
  const [n, d] = reduceFraction(num, den);
  if (d === 1) return String(n);
  return n + '/' + d;
}

/* Trim floating point noise without printing 12 decimals. */
function fmtNumber(v) {
  if (!isFinite(v)) return String(v);
  if (Number.isInteger(v)) return String(v);
  const r = Math.round(v * 1e6) / 1e6;
  return String(r);
}

/* Money with thousands separators, for word problems. */
function fmtMoney(v) {
  return '$' + Math.round(v).toLocaleString('en-US');
}

function fmtCount(v) {
  return Math.round(v).toLocaleString('en-US');
}

/* --------------------------------------------------- numeric equivalence */

/**
 * Parse any answer form a student could legitimately type: an integer, a
 * decimal (with or without a leading zero), or a fraction. Returns NaN for
 * anything unparseable, which the caller treats as wrong rather than as an
 * error.
 */
function parseNumeric(s) {
  if (typeof s === 'number') return s;
  if (s === null || s === undefined) return NaN;

  let t = String(s).trim();
  if (!t) return NaN;

  // Normalise the minus signs a font or a copy-paste might introduce.
  t = t.replace(/[−–—]/g, '-').replace(/\s+/g, '');
  if (t === '-' || t === '.') return NaN;

  const frac = t.match(/^(-?\d*\.?\d*)\/(-?\d*\.?\d*)$/);
  if (frac) {
    const n = parseFloat(frac[1]);
    const d = parseFloat(frac[2]);
    if (!isFinite(n) || !isFinite(d) || d === 0) return NaN;
    return n / d;
  }

  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return NaN;
  const v = parseFloat(t);
  return isFinite(v) ? v : NaN;
}

const EPS = 1e-6;
function numericEquals(a, b, tol) {
  const av = parseNumeric(a), bv = parseNumeric(b);
  if (isNaN(av) || isNaN(bv)) return false;
  return Math.abs(av - bv) <= (tol === undefined ? EPS : tol);
}

/* ------------------------------------------------------------- grid-in
   The real test's answer box takes at most 5 characters (6 if the answer is
   negative), accepts digits / '.' / '/' / '-', and credits any mathematically
   equivalent form that fits. */

const GRID_MAX_POSITIVE = 5;
const GRID_MAX_NEGATIVE = 6;

function gridFits(s) {
  const t = String(s);
  const max = t.charAt(0) === '-' ? GRID_MAX_NEGATIVE : GRID_MAX_POSITIVE;
  return t.length <= max;
}

function gridCharsValid(s) {
  return /^-?[0-9./]*$/.test(String(s));
}

/**
 * Canonical display forms for a grid-in key. Used to show the player what the
 * answer was after a miss, and to sanity-check at generation time that the
 * answer is even expressible in the box.
 */
function gridForms(value, fractionParts) {
  const out = [];
  if (fractionParts) {
    const [n, d] = reduceFraction(fractionParts[0], fractionParts[1]);
    if (d === 1) out.push(String(n));
    else if (gridFits(n + '/' + d)) out.push(n + '/' + d);
  }
  if (Number.isInteger(value)) {
    if (out.indexOf(String(value)) === -1) out.push(String(value));
  } else {
    // Longest terminating decimal that still fits the box.
    const neg = value < 0;
    const budget = (neg ? GRID_MAX_NEGATIVE : GRID_MAX_POSITIVE) - (neg ? 1 : 0);
    for (let dp = 4; dp >= 1; dp--) {
      const s = value.toFixed(dp).replace(/0+$/, '').replace(/\.$/, '');
      const bare = s.replace('-', '');
      if (bare.length <= budget) { if (out.indexOf(s) === -1) out.push(s); break; }
    }
  }
  return out;
}

/**
 * Is this value usable as a grid-in answer at all? A repeating decimal with a
 * three-digit denominator is legal on the real test only via truncation, which
 * is a miserable thing to ask of a player under a timer - so generators call
 * this and resample instead.
 */
function gridUsable(value, fractionParts) {
  if (!isFinite(value)) return false;
  const forms = gridForms(value, fractionParts);
  if (!forms.length) return false;
  // Require the *shown* form to round-trip within tolerance.
  return forms.some((f) => gridFits(f) && numericEquals(f, value, 5e-4));
}

/* -------------------------------------------------------- choice assembly */

/**
 * Shuffle the key in with its distractors and report where it landed.
 * `distractors` must already be deduped; see buildDistractors below.
 */
function packChoices(rng, correct, distractors) {
  const all = [correct].concat(distractors);
  const order = rng.shuffle(all.map((_, i) => i));
  const choices = order.map((i) => all[i]);
  return { choices, answerIndex: order.indexOf(0) };
}

/**
 * Turn a list of candidate traps into exactly `count` usable distractors.
 *
 * Candidates are compared numerically when they look numeric, and by
 * normalised string otherwise. `fallback(i)` supplies extras if too many
 * candidates collided - it should still be a plausible wrong answer, not
 * noise, so generators pass a nearby-but-wrong value.
 */
/* A distractor may be a bare value, or `{ v, why }` where `why` names the
   mistake that produces it.

   Every generator already documented that reasoning - as a trailing comment,
   which the runtime threw away. Promoting it to data is what lets a review say
   "you answered 14, which is the value of the expression rather than x"
   instead of only "that was wrong". Bare values keep working, so a generator
   that has not been converted still produces a valid question. */
function distractorValue(cand) {
  return (cand && typeof cand === 'object' && 'v' in cand) ? cand.v : cand;
}

function buildDistractors(correct, candidates, count, fallback) {
  count = count === undefined ? 3 : count;
  const out = [];
  const cNum = parseNumeric(correct);
  const isNumericKey = !isNaN(cNum);

  const seenStr = new Set([normaliseKey(correct)]);
  const seenNum = isNumericKey ? [cNum] : [];

  const tryAdd = (original) => {
    /* Dedupe on the VALUE, but keep the original wrapper: two traps that
       collapse onto the same number are still one option, whatever their
       explanations say. */
    const cand = distractorValue(original);
    if (cand === null || cand === undefined || cand === '') return false;
    const key = normaliseKey(cand);
    if (seenStr.has(key)) return false;

    const n = parseNumeric(cand);
    if (!isNaN(n)) {
      // Numeric comparison catches 3/8 vs 0.375 vs .375, which string
      // comparison alone would happily let through as "different".
      for (const prev of seenNum) if (Math.abs(prev - n) <= EPS) return false;
      seenNum.push(n);
    }
    seenStr.add(key);
    out.push(original);
    return true;
  };

  for (const c of candidates) {
    if (out.length >= count) break;
    tryAdd(c);
  }

  /* Safety net. A generator whose named traps happened to collide with each
     other (or with the key) must still yield a full set of four options - a
     three-option question is instantly recognisable as a bug.

     For a plain numeric key, step away from it. For a key that is a number
     followed by a symbol - "12π", "3/4π", "9x²" - perturb the leading
     coefficient and keep the suffix, which stays plausible as an answer. */
  const suffixMatch = String(correct).match(/^(-?\d+(?:\/\d+)?(?:\.\d+)?)(\D.*)$/);

  let guard = 0;
  while (out.length < count && guard++ < 60) {
    let extra = null;
    if (fallback) {
      extra = fallback(out.length + guard);
    } else if (isNumericKey) {
      extra = cNum + (guard % 2 === 0 ? guard : -guard);
    } else if (suffixMatch) {
      const head = suffixMatch[1], tail = suffixMatch[2];
      if (head.indexOf('/') !== -1) {
        const parts = head.split('/');
        extra = (parseInt(parts[0], 10) + guard) + '/' + parts[1] + tail;
      } else {
        extra = (parseFloat(head) + guard) + tail;
      }
    }

    /* Last resort for an algebraic key that starts with a variable rather than
       a number - "x^2 + 4x + 4". Neither branch above can touch it: it is not
       numeric, and the suffix pattern requires a leading digit. So the loop
       used to give up here and the question shipped with three options.

       That is not a cosmetic fault. Four options is the one structural fact
       every student knows about an SAT multiple-choice item, and a three-option
       question tells them the practice test is fake. It surfaced exactly once
       in 6000 - on (x + 2)(x + 2), where the two factors are equal and two of
       the named traps collapse onto the same expression - which is precisely
       the frequency at which a warning in the console gets scrolled past.

       Bumping the trailing constant keeps the shape of the expression and
       changes its value, which is what a plausible wrong answer looks like. */
    if (extra === null && /\d/.test(String(correct))) {
      const delta = guard % 2 === 0 ? guard : -guard;
      extra = String(correct).replace(/(-?\d+)(?![\s\S]*\d)/,
                                      (m) => String(parseInt(m, 10) + delta));
      if (extra === String(correct)) extra = null;
    }

    if (extra === null) break;      // nothing sensible to synthesise
    tryAdd(extra);
  }

  /* Refuse to hand back a short set. The caller throws on this, `generate()`
     catches it and resamples, and the player sees a different question instead
     of a broken one - which is the behaviour the fallback in `generate()` was
     written for in the first place. Returning quietly, as this did, meant the
     one code path built to handle a bad sample never ran. */
  if (out.length < count) {
    throw new Error('only ' + out.length + ' of ' + count +
                    ' distractors could be built for key "' + correct + '"');
  }
  return out.slice(0, count);
}

function normaliseKey(v) {
  return String(v).replace(/\s+/g, ' ').trim().toLowerCase();
}

/* ------------------------------------------------------- question objects */

const LETTERS = ['A', 'B', 'C', 'D'];
let questionSerial = 0;

/**
 * @param {object} spec
 *   section     'math' | 'rw'
 *   domain      e.g. 'Algebra'
 *   skill       e.g. 'linear-1var'
 *   difficulty  'easy' | 'medium' | 'hard'
 *   passage     optional prose shown above the stem
 *   stem        the question itself
 *   correct     the key
 *   distractors array of 3 wrong answers
 *   explanation shown on the lose screen
 */
function makeMC(rng, spec) {
  const raw = buildDistractors(spec.correct, spec.distractors, 3, spec.fallback);
  /* Shuffle the value and its explanation together. packChoices is generic over
     whatever it is handed, so pairs survive the shuffle with their reasoning
     still attached to the right option - which is the entire point. */
  const pairs = [{ v: spec.correct, why: null }].concat(raw.map((c) => ({
    v: distractorValue(c),
    why: (c && typeof c === 'object' && c.why) ? c.why : null
  })));
  const { choices, answerIndex } = packChoices(rng, pairs[0], pairs.slice(1));
  return {
    id: ++questionSerial,
    section: spec.section,
    domain: spec.domain,
    skill: spec.skill,
    /* The specific form the question took, which is finer than `skill` and is
       what the analysis report is keyed on. Null is tolerated so an
       unconverted generator degrades to skill-level reporting instead of
       throwing, but taxonomy.verify() will name it at load. */
    qtype: spec.qtype || null,
    difficulty: spec.difficulty || 'medium',
    passage: spec.passage || null,
    graphic: spec.graphic || null,
    stem: spec.stem,
    format: 'mc',
    choices: choices.map((c, i) => ({
      letter: LETTERS[i], text: String(c.v),
      /* Why this option is wrong. Null on the key, and null on any option a
         generator has not yet annotated, so a review can ask without checking
         which generator produced the question. */
      why: c.why || null
    })),
    answerIndex,
    answerText: String(choices[answerIndex].v),
    explanation: spec.explanation || ''
  };
}

function makeGrid(rng, spec) {
  const forms = gridForms(spec.value, spec.fractionParts);
  return {
    id: ++questionSerial,
    section: spec.section,
    domain: spec.domain,
    skill: spec.skill,
    /* The specific form the question took, which is finer than `skill` and is
       what the analysis report is keyed on. Null is tolerated so an
       unconverted generator degrades to skill-level reporting instead of
       throwing, but taxonomy.verify() will name it at load. */
    qtype: spec.qtype || null,
    difficulty: spec.difficulty || 'medium',
    passage: spec.passage || null,
    graphic: spec.graphic || null,
    stem: spec.stem,
    format: 'grid',
    value: spec.value,
    acceptedForms: forms,
    answerText: forms[0] || String(spec.value),
    explanation: spec.explanation || ''
  };
}

/**
 * Grade a typed grid-in response the way the real test does: reject illegal
 * characters and over-length entries outright, then credit any numerically
 * equivalent form. Tolerance is loose enough to accept a legitimately
 * truncated decimal (the test explicitly permits 7.666 for 23/3).
 */
function checkGrid(question, input) {
  const raw = String(input == null ? '' : input).trim();
  if (!raw) return false;
  if (!gridCharsValid(raw)) return false;
  if (!gridFits(raw)) return false;

  const v = parseNumeric(raw);
  if (isNaN(v)) return false;

  const target = question.value;
  if (Number.isInteger(target)) return Math.abs(v - target) <= EPS;

  /* Accept a truncation or rounding at the box's precision limit: the test
     explicitly credits 7.666 for 23/3. The allowance is RELATIVE - a fixed
     absolute floor would make the tolerance wider than the answer itself for
     small values, so a target of 0.001 would credit a typed "0". */
  const tol = Math.max(Math.abs(target) * 1e-3, 1e-9);
  return Math.abs(v - target) <= tol;
}

/* What the player actually put down, as text.

   A stored response is a choice INDEX for multiple choice and a typed STRING
   for a grid-in, so a review screen printing it raw would show "2" for a
   multiple-choice answer - which is not what the player clicked and reads as a
   different answer entirely. Resolved here, in the one place both the exam form
   and the Infinity bank can reach. */
function describeResponse(question, response) {
  if (!question) return null;
  if (response === null || response === undefined || response === '') return null;
  if (question.format === 'mc') {
    const c = question.choices && question.choices[response];
    return c ? c.letter + '. ' + c.text : String(response);
  }
  return String(response);
}

/* ------------------------------------------------------------- difficulty */

/* The heuristic rubric: score a few axes, bucket the sum. Nothing here
   pretends to be IRT - it just needs to sort questions consistently. */
function scoreDifficulty(axes) {
  let s = 0;
  for (const k in axes) s += axes[k] || 0;
  return s <= 2 ? 'easy' : s <= 5 ? 'medium' : 'hard';
}

/* Make the generator registry the single authority on which content domain a
   question counts toward.

   The domain is written down twice - once inside the generator, once in the
   weight table that decides how often the generator runs - and the whole point
   of the weight table is to hit the College Board's published domain
   percentages. When the two disagree, the table is measuring one thing and the
   test contains another, and nothing about the output looks wrong: the
   question is fine, the mix is silently off. That is exactly what happened
   with the composite-function generator, which was weighted as Algebra and
   emitted Advanced Math for months.

   So the registry value is stamped on and a disagreement is reported. Stamping
   alone would make the mix right and hide the inconsistency; warning alone
   would leave the mix wrong. Both, and neither failure mode survives. */
function stampDomain(question, domain, bank) {
  if (question.domain && question.domain !== domain) {
    console.warn('[sat] ' + bank + ' generator for skill "' + question.skill +
                 '" emits domain "' + question.domain + '" but is weighted as "' +
                 domain + '"; the registry wins. Fix one of the two.');
  }
  question.domain = domain;
  return question;
}

/* Draw one question from a weighted generator table, optionally restricted to
   a single content domain.

   Both banks had the same six lines of "pick, call, catch, fall back", and a
   module test needs a seventh behaviour - "give me an Algebra question" - so
   the whole thing lives here once instead of being written twice and drifting.

   Restricting by domain filters the table rather than generating repeatedly
   until something matches: Geometry is 15% of the Math bank, so the rejection
   approach would burn about seven generations per question and, worse, would
   be quietly biased toward whichever generators are cheapest to produce. */
function generateFrom(rng, GENERATORS, opts) {
  opts = opts || {};
  let pool = GENERATORS;
  if (opts.domain) {
    const narrowed = GENERATORS.filter((g) => g.d === opts.domain);
    // An unknown domain must not silently produce an off-domain question.
    if (!narrowed.length) {
      console.warn('[sat] no ' + (opts.bank || '') + ' generator for domain "' +
                   opts.domain + '"; drawing from the whole bank instead');
    } else {
      pool = narrowed;
    }
  }
  const pick = rng.weighted(pool);
  try {
    const q = pick.fn(rng, opts.difficulty || 'medium');
    if (q && pick.d) stampDomain(q, pick.d, opts.bank || '');
    return q;
  } catch (err) {
    /* A generator that rejected its own sample must never take a run down
       mid-exam. Retry within the same pool first, so a domain request still
       comes back in that domain, and only then fall back. */
    for (let i = 0; i < 8; i++) {
      try {
        const alt = rng.weighted(pool);
        const q = alt.fn(rng, opts.difficulty || 'medium');
        if (q && alt.d) stampDomain(q, alt.d, opts.bank || '');
        return q;
      } catch (e) { /* keep trying */ }
    }
    console.warn('[sat] ' + (opts.bank || '') + ' generator failed, falling back:', err);
    return opts.fallback ? opts.fallback(rng, opts.difficulty || 'medium') : null;
  }
}

/* --------------------------------------------------------------- exports */

SATG.satUtil = {
  term, signed, signedTerm, reduceFraction, fmtFraction, fmtNumber, fmtMoney, fmtCount,
  parseNumeric, numericEquals,
  gridFits, gridCharsValid, gridForms, gridUsable, checkGrid,
  GRID_MAX_POSITIVE, GRID_MAX_NEGATIVE,
  packChoices, buildDistractors, stampDomain, generateFrom,
  makeMC, makeGrid, scoreDifficulty, describeResponse, LETTERS
};

})(window);
